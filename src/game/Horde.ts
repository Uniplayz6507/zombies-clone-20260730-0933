import { Rng } from '../util/rng';
import { angleDelta, approachAngle, clamp, damp, distXZ, yawFromDir } from '../util/vec';
import { lineOfSight, moveAndCollide, type MoveContext } from './physics/CharacterController';
import type { WaypointGraph } from './nav/WaypointGraph';
import { avoid, blend, seek, separation, wander, type SteerOut } from './nav/steering';
import { Zombie, type ZombieKind } from './Zombie';
import type { EventQueue } from './events';
import type { Player } from './Player';
import type { SpawnDef } from '../content/level.city';

/**
 * Horde manager: pooling, spawning, and the per-zombie AI update.
 *
 * Two deliberate cost-control decisions:
 *
 * 1. Re-planning is *staggered*. Each zombie re-evaluates its graph node on its
 *    own ~4Hz timer with a random phase offset, so we never pay the whole horde's
 *    navigation cost in a single frame. Spike-free budgeting matters more than
 *    total cost - a 6ms frame every 15 frames is far worse than 0.4ms every frame.
 *
 * 2. Line-of-sight raycasts are only issued when a zombie is within 16m and its
 *    own re-plan tick comes up. Distant zombies just follow the flow field.
 */

const POOL_SIZE = 24; // > any wave's aliveCap, so acquire() never fails

const dirSeek: SteerOut = { x: 0, z: 0 };
const dirSep: SteerOut = { x: 0, z: 0 };
const dirAvoid: SteerOut = { x: 0, z: 0 };
const dirWander: SteerOut = { x: 0, z: 0 };
const dirFinal: SteerOut = { x: 0, z: 0 };

export class Horde {
  readonly zombies: Zombie[] = [];
  private readonly rng = new Rng(0xb1i9 >>> 0 || 0xbadf00d);
  /** Round-robin cursor so spawns cycle across breaches instead of clustering. */
  private spawnCursor = 0;

  constructor() {
    for (let i = 0; i < POOL_SIZE; i++) this.zombies.push(new Zombie());
  }

  reseed(seed: number): void {
    this.rng.reseed(seed);
    this.spawnCursor = 0;
  }

  releaseAll(): void {
    for (const z of this.zombies) {
      z.active = false;
      z.renderSlot = -1;
    }
  }

  countAlive(): number {
    let n = 0;
    for (const z of this.zombies) if (z.alive) n++;
    return n;
  }

  countActive(): number {
    let n = 0;
    for (const z of this.zombies) if (z.active) n++;
    return n;
  }

  /**
   * Spawn at the breach furthest from the player among the unlocked ones, with a
   * round-robin tiebreak. Spawning behind the player is dramatic; spawning *on*
   * the player is just unfair.
   */
  spawn(
    kind: ZombieKind,
    spawns: SpawnDef[],
    unlocked: Set<string>,
    player: Player,
    healthMul: number,
    speedMul: number,
    events: EventQueue,
  ): Zombie | null {
    const z = this.zombies.find((c) => !c.active);
    if (!z) return null;

    const eligible = spawns.filter((s) => unlocked.has(s.zone));
    if (eligible.length === 0) return null;

    let pick = eligible[this.spawnCursor % eligible.length];
    this.spawnCursor++;
    // Reject anything uncomfortably close, then fall back to the furthest.
    if (Math.hypot(pick.x - player.pos.x, pick.z - player.pos.z) < 7) {
      let best = pick;
      let bestD = -1;
      for (const s of eligible) {
        const d = Math.hypot(s.x - player.pos.x, s.z - player.pos.z);
        if (d > bestD) {
          bestD = d;
          best = s;
        }
      }
      pick = best;
    }

    const jx = this.rng.jitter(0.5);
    const jz = this.rng.jitter(0.5);
    z.reset(kind, pick.x + jx, pick.z + jz, pick.yaw, healthMul, speedMul, this.rng);
    events.push({ type: 'zombieSpawn', x: z.pos.x, y: z.pos.y, z: z.pos.z, kind });
    return z;
  }

  update(
    dt: number,
    player: Player,
    graph: WaypointGraph,
    ctx: MoveContext,
    events: EventQueue,
  ): void {
    const zombies = this.zombies;
    const px = player.pos.x;
    const pz = player.pos.z;
    const peyeY = player.pos.y + player.eyeHeight;

    for (let i = 0; i < zombies.length; i++) {
      const z = zombies[i];
      if (!z.active) continue;

      z.prev.x = z.pos.x;
      z.prev.y = z.pos.y;
      z.prev.z = z.pos.z;
      z.prevYaw = z.yaw;
      z.hitFlash = Math.max(0, z.hitFlash - dt * 5);
      z.stateT += dt;

      // --- Death -----------------------------------------------------------
      if (z.state === 'dead') {
        z.deathT += dt;
        // Sink and fade, then return to the pool. The renderer reads deathT.
        if (z.deathT > 2.6) {
          z.active = false;
          z.renderSlot = -1;
        }
        continue;
      }

      const dToPlayer = distXZ(z.pos, player.pos);

      // --- Ambient groans, spatially positioned by the audio bus ------------
      z.groanT -= dt;
      if (z.groanT <= 0) {
        z.groanT = 3 + this.rng.next() * 6;
        if (dToPlayer < 26) events.push({ type: 'zombieGroan', x: z.pos.x, y: z.centreY, z: z.pos.z, kind: z.kind });
      }

      // --- Emerging: climb out of the breach before becoming a threat -------
      if (z.state === 'emerging') {
        if (z.stateT >= 0.9) {
          z.state = 'chase';
          z.stateT = 0;
        }
        continue;
      }

      // --- Stagger ---------------------------------------------------------
      if (z.state === 'stagger') {
        z.vel.x = damp(z.vel.x, 0, 9, dt);
        z.vel.z = damp(z.vel.z, 0, 9, dt);
        moveAndCollide(z.pos, z.vel, z.radius, z.height, dt, ctx);
        if (z.stateT >= 0.34) {
          z.state = 'chase';
          z.stateT = 0;
        }
        continue;
      }

      // --- Attack: wind up, then land the blow -----------------------------
      if (z.state === 'windup') {
        // Rooted during the wind-up. That commitment is what makes backing out
        // of reach a real, learnable defensive skill.
        z.vel.x = damp(z.vel.x, 0, 14, dt);
        z.vel.z = damp(z.vel.z, 0, 14, dt);
        moveAndCollide(z.pos, z.vel, z.radius, z.height, dt, ctx);
        z.yaw = approachAngle(z.yaw, yawFromDir(px - z.pos.x, pz - z.pos.z), dt * 4);
        if (z.stateT >= z.profile.windup) {
          z.state = 'strike';
          z.stateT = 0;
          events.push({ type: 'zombieSwing', x: z.pos.x, y: z.centreY, z: z.pos.z });
          const reach = z.profile.reach + player.radius;
          if (dToPlayer <= reach && Math.abs(player.pos.y - z.pos.y) < 1.6) {
            player.takeDamage(z.profile.damage, z.pos.x, z.pos.z, events);
          }
        }
        continue;
      }

      if (z.state === 'strike') {
        if (z.stateT >= 0.42) {
          z.state = 'chase';
          z.stateT = 0;
          z.attackCd = z.profile.attackCooldown;
        }
        continue;
      }

      // --- Chase -----------------------------------------------------------
      z.attackCd = Math.max(0, z.attackCd - dt);
      z.replanT -= dt;

      if (z.replanT <= 0) {
        // ~4Hz, phase-offset per zombie so the cost is spread across frames.
        z.replanT = 0.22 + this.rng.next() * 0.1;
        z.node = graph.nearest(z.pos.x, z.pos.z);
        z.direct =
          dToPlayer < 16 &&
          lineOfSight(z.pos.x, z.centreY, z.pos.z, px, peyeY - 0.3, pz, ctx);
      }

      // Target: charge the player directly when we can see them, otherwise walk
      // to the next hop in the flow field.
      let tx = px;
      let tz = pz;
      if (!z.direct) {
        const hop = z.node >= 0 ? graph.nextHop[z.node] : -1;
        if (hop >= 0) {
          const n = graph.node(hop);
          tx = n.x;
          tz = n.z;
        }
      }

      seek(z.pos.x, z.pos.z, tx, tz, dirSeek);
      separation(z.pos.x, z.pos.z, z.radius + 0.16, zombies as unknown as { x: number; z: number; active: boolean; radius: number }[], i, dirSep);

      // Whisker probes. Two short line-of-sight tests are far cheaper than any
      // form of obstacle prediction and produce the shoulder-scraping shuffle we
      // want along alley walls.
      const probe = 1.15;
      const perpX = -dirSeek.z;
      const perpZ = dirSeek.x;
      const originY = z.pos.y + 0.9;
      const leftBlocked = !lineOfSight(
        z.pos.x,
        originY,
        z.pos.z,
        z.pos.x + (dirSeek.x * 0.8 - perpX * 0.5) * probe,
        originY,
        z.pos.z + (dirSeek.z * 0.8 - perpZ * 0.5) * probe,
        ctx,
      );
      const rightBlocked = !lineOfSight(
        z.pos.x,
        originY,
        z.pos.z,
        z.pos.x + (dirSeek.x * 0.8 + perpX * 0.5) * probe,
        originY,
        z.pos.z + (dirSeek.z * 0.8 + perpZ * 0.5) * probe,
        ctx,
      );
      avoid(dirSeek.x, dirSeek.z, leftBlocked, rightBlocked, dirAvoid);
      wander(z.animPhase + z.stateT, 0.12, dirWander);

      blend(dirFinal, [
        { v: dirSeek, w: 1 },
        { v: dirSep, w: 1.5 },
        { v: dirAvoid, w: 0.8 },
        { v: dirWander, w: 0.25 },
      ]);

      // Crowding slows the pack down, which is exactly the doorway-clog feel we
      // are after and stops the front rank from being shoved through walls.
      const crowd = Math.hypot(dirSep.x, dirSep.z);
      const speed = z.speed * (1 - Math.min(0.4, crowd * 0.3));

      z.vel.x = damp(z.vel.x, dirFinal.x * speed, 9, dt);
      z.vel.z = damp(z.vel.z, dirFinal.z * speed, 9, dt);

      moveAndCollide(z.pos, z.vel, z.radius, z.height, dt, ctx);

      // Face the way we are actually travelling, not the way we want to.
      const moveLen = Math.hypot(z.vel.x, z.vel.z);
      if (moveLen > 0.15) {
        const want = yawFromDir(z.vel.x, z.vel.z);
        const turnRate = z.kind === 'runner' ? 7 : 3.6;
        z.yaw = approachAngle(z.yaw, want, dt * turnRate);
      }

      // Advance the walk cycle by distance covered, not by time - that is what
      // stops feet from sliding when the horde is slowed by crowding.
      z.animPhase += (moveLen / Math.max(0.6, z.height * 0.42)) * dt * 3.1 * z.profile.gait;

      // --- Can we hit the player? ------------------------------------------
      const reach = z.profile.reach + player.radius;
      if (
        z.attackCd <= 0 &&
        dToPlayer <= reach + 0.25 &&
        Math.abs(player.pos.y - z.pos.y) < 1.7 &&
        Math.abs(angleDelta(z.yaw, yawFromDir(px - z.pos.x, pz - z.pos.z))) < 1.1
      ) {
        z.state = 'windup';
        z.stateT = 0;
      }
    }
  }

  /** Nearest living zombie within `maxDist`, or null. Used by melee. */
  nearestAlive(x: number, z: number, maxDist: number): Zombie | null {
    let best: Zombie | null = null;
    let bestD = maxDist * maxDist;
    for (const c of this.zombies) {
      if (!c.alive) continue;
      const d = (c.pos.x - x) * (c.pos.x - x) + (c.pos.z - z) * (c.pos.z - z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** Clamp helper re-exported for tuning code. */
  static clampSpeed = clamp;
}
