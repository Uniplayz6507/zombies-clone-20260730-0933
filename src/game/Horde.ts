import { Rng } from '../util/rng';
import { angleDelta, approachAngle, damp, distXZ, yawFromDir } from '../util/vec';
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
 *    own ~4Hz timer with a random phase, so we never pay the whole horde's
 *    navigation cost in one frame. Spike-free budgeting matters more than total
 *    cost: a 6ms frame every 15 frames is far worse than 0.4ms every frame.
 *
 * 2. Line-of-sight rays are only cast within 16m and only on a re-plan tick.
 *    Everyone else just reads the flow field, which is a single array lookup.
 */

/** Larger than any wave's aliveCap, so acquiring a zombie never fails. */
const POOL_SIZE = 24;

const dirSeek: SteerOut = { x: 0, z: 0 };
const dirSep: SteerOut = { x: 0, z: 0 };
const dirAvoid: SteerOut = { x: 0, z: 0 };
const dirWander: SteerOut = { x: 0, z: 0 };
const dirFinal: SteerOut = { x: 0, z: 0 };
const blendParts = [
  { v: dirSeek, w: 1 },
  { v: dirSep, w: 1.5 },
  { v: dirAvoid, w: 0.8 },
  { v: dirWander, w: 0.25 },
];

export class Horde {
  readonly zombies: Zombie[] = [];
  private readonly rng = new Rng(0xbadf00d);
  /** Round-robin cursor so spawns cycle breaches instead of clustering. */
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
   * Spawn at an unlocked breach, cycling round-robin but rejecting anything
   * uncomfortably close to the player. Spawning behind you is dramatic;
   * spawning *on* you is just unfair.
   */
  spawn(
    kind: ZombieKind,
    spawns: readonly SpawnDef[],
    unlocked: ReadonlySet<string>,
    player: Player,
    healthMul: number,
    speedMul: number,
    events: EventQueue,
  ): Zombie | null {
    let z: Zombie | null = null;
    for (const c of this.zombies) {
      if (!c.active) {
        z = c;
        break;
      }
    }
    if (!z) return null;

    const eligible: SpawnDef[] = [];
    for (const s of spawns) if (unlocked.has(s.zone)) eligible.push(s);
    if (eligible.length === 0) return null;

    let pick = eligible[this.spawnCursor % eligible.length];
    this.spawnCursor++;
    if (Math.hypot(pick.x - player.pos.x, pick.z - player.pos.z) < 7) {
      let bestD = -1;
      for (const s of eligible) {
        const d = Math.hypot(s.x - player.pos.x, s.z - player.pos.z);
        if (d > bestD) {
          bestD = d;
          pick = s;
        }
      }
    }

    z.reset(kind, pick.x + this.rng.jitter(0.5), pick.z + this.rng.jitter(0.5), pick.yaw, healthMul, speedMul, this.rng);
    events.push({ type: 'zombieSpawn', x: z.pos.x, y: z.pos.y, z: z.pos.z, kind });
    return z;
  }

  update(dt: number, player: Player, graph: WaypointGraph, ctx: MoveContext, events: EventQueue): void {
    const zombies = this.zombies;
    const px = player.pos.x;
    const pz = player.pos.z;
    const peyeY = player.eyeY;

    for (let i = 0; i < zombies.length; i++) {
      const z = zombies[i];
      if (!z.active) continue;

      z.prev.x = z.pos.x;
      z.prev.y = z.pos.y;
      z.prev.z = z.pos.z;
      z.prevYaw = z.yaw;
      z.hitFlash = Math.max(0, z.hitFlash - dt * 5);
      z.stateT += dt;

      // --- Dead: the renderer reads deathT to sink and fade the body ---------
      if (z.state === 'dead') {
        z.deathT += dt;
        if (z.deathT > 2.6) {
          z.active = false;
          z.renderSlot = -1;
        }
        continue;
      }

      const dToPlayer = distXZ(z.pos, player.pos);

      z.groanT -= dt;
      if (z.groanT <= 0) {
        z.groanT = 3 + this.rng.next() * 6;
        if (dToPlayer < 26) events.push({ type: 'zombieGroan', x: z.pos.x, y: z.centreY, z: z.pos.z, kind: z.kind });
      }

      // --- Emerging: climb out of the breach before becoming a threat --------
      if (z.state === 'emerging') {
        if (z.stateT >= 0.9) {
          z.state = 'chase';
          z.stateT = 0;
        }
        continue;
      }

      // --- Stagger ----------------------------------------------------------
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

      // --- Wind-up: rooted. Backing out of reach is a real, learnable skill --
      if (z.state === 'windup') {
        z.vel.x = damp(z.vel.x, 0, 14, dt);
        z.vel.z = damp(z.vel.z, 0, 14, dt);
        moveAndCollide(z.pos, z.vel, z.radius, z.height, dt, ctx);
        z.yaw = approachAngle(z.yaw, yawFromDir(px - z.pos.x, pz - z.pos.z), dt * 4);
        if (z.stateT >= z.profile.windup) {
          z.state = 'strike';
          z.stateT = 0;
          events.push({ type: 'zombieSwing', x: z.pos.x, y: z.centreY, z: z.pos.z });
          if (dToPlayer <= z.profile.reach + player.radius && Math.abs(player.pos.y - z.pos.y) < 1.6) {
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

      // --- Chase ------------------------------------------------------------
      z.attackCd = Math.max(0, z.attackCd - dt);
      z.replanT -= dt;

      if (z.replanT <= 0) {
        z.replanT = 0.22 + this.rng.next() * 0.1;
        z.node = graph.nearest(z.pos.x, z.pos.z);
        z.direct = dToPlayer < 16 && lineOfSight(z.pos.x, z.centreY, z.pos.z, px, peyeY - 0.3, pz, ctx);
      }

      // Charge directly when we can see them; otherwise follow the flow field.
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
      separation(z.pos.x, z.pos.z, z.radius + 0.16, zombies, i, dirSep);

      // Two short whisker rays. Cheaper than any obstacle prediction, and they
      // produce the shoulder-scraping shuffle we want along alley walls.
      const perpX = -dirSeek.z;
      const perpZ = dirSeek.x;
      const oy = z.pos.y + 0.9;
      const probe = 1.15;
      const leftBlocked = !lineOfSight(
        z.pos.x,
        oy,
        z.pos.z,
        z.pos.x + (dirSeek.x * 0.8 - perpX * 0.5) * probe,
        oy,
        z.pos.z + (dirSeek.z * 0.8 - perpZ * 0.5) * probe,
        ctx,
      );
      const rightBlocked = !lineOfSight(
        z.pos.x,
        oy,
        z.pos.z,
        z.pos.x + (dirSeek.x * 0.8 + perpX * 0.5) * probe,
        oy,
        z.pos.z + (dirSeek.z * 0.8 + perpZ * 0.5) * probe,
        ctx,
      );
      avoid(dirSeek.x, dirSeek.z, leftBlocked, rightBlocked, dirAvoid);
      wander(z.animPhase + z.stateT, 0.12, dirWander);
      blend(dirFinal, blendParts);

      // Crowding slows the pack. This is the doorway-clog feel we are after, and
      // it stops the front rank being shoved through geometry.
      const crowd = Math.hypot(dirSep.x, dirSep.z);
      const speed = z.speed * (1 - Math.min(0.4, crowd * 0.3));

      z.vel.x = damp(z.vel.x, dirFinal.x * speed, 9, dt);
      z.vel.z = damp(z.vel.z, dirFinal.z * speed, 9, dt);

      moveAndCollide(z.pos, z.vel, z.radius, z.height, dt, ctx);

      // Face where we are actually travelling, not where we want to be.
      const moveLen = Math.hypot(z.vel.x, z.vel.z);
      if (moveLen > 0.15) {
        z.yaw = approachAngle(z.yaw, yawFromDir(z.vel.x, z.vel.z), dt * (z.kind === 'runner' ? 7 : 3.6));
      }

      // Advance the walk cycle by distance covered, not by time. This is what
      // stops feet from sliding when crowding slows the horde down.
      z.animPhase += (moveLen / Math.max(0.6, z.height * 0.42)) * dt * 3.1 * z.profile.gait;

      // --- In range? --------------------------------------------------------
      if (
        z.attackCd <= 0 &&
        dToPlayer <= z.profile.reach + player.radius + 0.25 &&
        Math.abs(player.pos.y - z.pos.y) < 1.7 &&
        Math.abs(angleDelta(z.yaw, yawFromDir(px - z.pos.x, pz - z.pos.z))) < 1.1
      ) {
        z.state = 'windup';
        z.stateT = 0;
      }
    }
  }
}
