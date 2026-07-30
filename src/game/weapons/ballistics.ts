import type { Rng } from '../../util/rng';
import { raySlabAABB, raySphere } from '../physics/aabb';
import type { MoveContext } from '../physics/CharacterController';
import { damageAtRange, HIT_MULTIPLIER, type HitZone, type WeaponSpec } from '../../content/weapons.data';
import { HIT_SPHERES, type Zombie } from '../Zombie';
import type { EventQueue } from '../events';
import type { Player } from '../Player';
import type { Economy } from '../Economy';
import { SCORING } from '../../content/waves.data';

/**
 * Hitscan ballistics.
 *
 * Bullets are rays, not projectiles. At pistol-to-shotgun ranges inside a 55m map,
 * simulated projectiles would add per-frame integration and per-bullet state for
 * no perceptible benefit.
 *
 * Order of operations per pellet, and the order matters for both correctness and
 * cost:
 *   1. Find the nearest WALL hit along the ray (slab tests, broadphase filtered).
 *   2. Collect zombie sphere hits closer than that wall.
 *   3. Sort front-to-back, apply damage through `penetration` bodies.
 *
 * Testing the wall first means a shot into cover never damages the zombie standing
 * behind it, and we never pay to sort hits that were occluded anyway.
 */

export interface FireContext {
  zombies: Zombie[];
  ctx: MoveContext;
  events: EventQueue;
  economy: Economy;
  player: Player;
  rng: Rng;
}

interface Candidate {
  t: number;
  zombie: Zombie | null;
  zone: HitZone;
  x: number;
  y: number;
  z: number;
}

// Pre-allocated scratch. A shotgun blast is 9 pellets against up to 24 zombies;
// none of this may allocate.
const MAX_CANDIDATES = 32;
const candidates: Candidate[] = Array.from({ length: MAX_CANDIDATES }, () => ({
  t: 0,
  zombie: null,
  zone: 'torso' as HitZone,
  x: 0,
  y: 0,
  z: 0,
}));
const probe = { x: 0, y: 0, z: 0, r: 0, zone: 'torso' as HitZone };
const scratchIdx: number[] = [];
const dirScratch = { x: 0, y: 0, z: 0 };
const normal = { x: 0, y: 1, z: 0 };

/**
 * Nearest static-geometry hit along a ray.
 * Returns the distance, and writes the surface normal into `nrm`. -1 for a miss.
 */
function wallHit(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
  ctx: MoveContext,
  nrm: { x: number; y: number; z: number },
): number {
  let best = maxT;
  let bestIdx = -1;
  const cands = ctx.hash.querySegment(ox, oz, ox + dx * maxT, oz + dz * maxT, scratchIdx);
  for (let i = 0; i < cands.length; i++) {
    const c = ctx.colliders[cands[i]];
    if (c.doorId !== null && ctx.openDoors.has(c.doorId)) continue;
    const t = raySlabAABB(c, ox, oy, oz, dx, dy, dz, best);
    if (t >= 0 && t < best) {
      best = t;
      bestIdx = cands[i];
    }
  }

  // Ground plane. A cheap analytic test beats a map-sized floor collider.
  if (dy < -1e-6) {
    const tGround = -oy / dy;
    if (tGround > 0 && tGround < best) {
      best = tGround;
      bestIdx = -2;
    }
  }

  if (bestIdx === -2) {
    nrm.x = 0;
    nrm.y = 1;
    nrm.z = 0;
    return best;
  }
  if (bestIdx < 0) return -1;

  // Recover the face normal by asking which slab the hit point landed on.
  const c = ctx.colliders[bestIdx];
  const hx = ox + dx * best;
  const hy = oy + dy * best;
  const hz = oz + dz * best;
  const eps = 0.02;
  nrm.x = 0;
  nrm.y = 0;
  nrm.z = 0;
  if (Math.abs(hx - c.minX) < eps) nrm.x = -1;
  else if (Math.abs(hx - c.maxX) < eps) nrm.x = 1;
  else if (Math.abs(hy - c.minY) < eps) nrm.y = -1;
  else if (Math.abs(hy - c.maxY) < eps) nrm.y = 1;
  else if (Math.abs(hz - c.minZ) < eps) nrm.z = -1;
  else nrm.z = 1;
  return best;
}

/** Is the straight line between two points clear of static geometry? */
function losClear(ax: number, ay: number, az: number, bx: number, by: number, bz: number, ctx: MoveContext): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-5) return true;
  const scratchNormal = { x: 0, y: 0, z: 0 };
  return wallHit(ax, ay, az, dx / len, dy / len, dz / len, len, ctx, scratchNormal) < 0;
}

/**
 * Deviate a direction inside a cone.
 *
 * The basis is (right, up, forward) where up = right x forward. Building it that
 * way rather than assuming world-up is what keeps vertical spread correct when
 * the player is aiming steeply up or down.
 */
function applySpread(
  dir: { x: number; y: number; z: number },
  rightX: number,
  rightZ: number,
  spreadRad: number,
  rng: Rng,
): void {
  if (spreadRad <= 1e-6) return;

  // right = (rightX, 0, rightZ); up = right x forward
  const upX = -rightZ * dir.y;
  const upY = rightZ * dir.x - rightX * dir.z;
  const upZ = rightX * dir.y;
  const ul = Math.hypot(upX, upY, upZ) || 1;
  const ux = upX / ul;
  const uy = upY / ul;
  const uz = upZ / ul;

  // Uniform sample over the cone's disc: sqrt(u) avoids clustering at the centre.
  const angle = rng.next() * Math.PI * 2;
  const radius = Math.sqrt(rng.next()) * Math.tan(spreadRad);
  const ox = Math.cos(angle) * radius;
  const oy = Math.sin(angle) * radius;

  dir.x += rightX * ox + ux * oy;
  dir.y += uy * oy;
  dir.z += rightZ * ox + uz * oy;
  const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
  dir.x /= l;
  dir.y /= l;
  dir.z /= l;
}

/**
 * Resolve one trigger pull: fires `spec.pellets` rays from the eye.
 * Spread comes from the seeded RNG, so a given pattern is reproducible.
 */
export function fireShot(fc: FireContext, spec: WeaponSpec, spreadRad: number): void {
  const { player, events, zombies, ctx, economy, rng } = fc;

  const ox = player.pos.x;
  const oy = player.eyeY;
  const oz = player.pos.z;

  const cp = Math.cos(player.pitch);
  const baseX = -Math.sin(player.yaw) * cp;
  const baseY = Math.sin(player.pitch);
  const baseZ = -Math.cos(player.yaw) * cp;
  const rightX = Math.cos(player.yaw);
  const rightZ = -Math.sin(player.yaw);

  const maxT = spec.range * 2.4;
  player.shotsFired++;
  let anyHit = false;
  let anyHeadshot = false;

  events.push({
    type: 'shot',
    weapon: spec.id,
    upgraded: spec.name.startsWith('Retooled'),
    x: ox,
    y: oy,
    z: oz,
    dx: baseX,
    dy: baseY,
    dz: baseZ,
  });

  for (let pellet = 0; pellet < spec.pellets; pellet++) {
    dirScratch.x = baseX;
    dirScratch.y = baseY;
    dirScratch.z = baseZ;
    applySpread(dirScratch, rightX, rightZ, spreadRad, rng);
    const dx = dirScratch.x;
    const dy = dirScratch.y;
    const dz = dirScratch.z;

    // 1. Where does the world stop this pellet?
    const tWall = wallHit(ox, oy, oz, dx, dy, dz, maxT, ctx, normal);
    const limit = tWall < 0 ? maxT : tWall;

    // 2. Which bodies are in front of that?
    let count = 0;
    for (let i = 0; i < zombies.length && count < MAX_CANDIDATES; i++) {
      const z = zombies[i];
      if (!z.alive) continue;
      // Broad reject on one bounding sphere before testing four small ones.
      const gross = raySphere(ox, oy, oz, dx, dy, dz, z.pos.x, z.pos.y + z.height * 0.55, z.pos.z, z.height * 0.62);
      if (gross < 0 || gross > limit) continue;

      let bestT = Infinity;
      let bestZone: HitZone = 'torso';
      for (let s = 0; s < HIT_SPHERES.length; s++) {
        z.sphere(s, probe);
        const t = raySphere(ox, oy, oz, dx, dy, dz, probe.x, probe.y, probe.z, probe.r);
        if (t >= 0 && t < bestT && t <= limit) {
          bestT = t;
          bestZone = probe.zone;
        }
      }
      if (bestT === Infinity) continue;

      const c = candidates[count++];
      c.t = bestT;
      c.zombie = z;
      c.zone = bestZone;
      c.x = ox + dx * bestT;
      c.y = oy + dy * bestT;
      c.z = oz + dz * bestT;
    }

    if (count === 0) {
      if (tWall >= 0) {
        events.push({
          type: 'impactWorld',
          x: ox + dx * tWall,
          y: oy + dy * tWall,
          z: oz + dz * tWall,
          nx: normal.x,
          ny: normal.y,
          nz: normal.z,
        });
        events.push({ type: 'tracer', x0: ox, y0: oy, z0: oz, x1: ox + dx * tWall, y1: oy + dy * tWall, z1: oz + dz * tWall });
      }
      continue;
    }

    // 3. Front to back. Insertion sort: `count` is tiny and this never allocates.
    for (let i = 1; i < count; i++) {
      const cur = candidates[i];
      let j = i - 1;
      while (j >= 0 && candidates[j].t > cur.t) {
        candidates[j + 1] = candidates[j];
        j--;
      }
      candidates[j + 1] = cur;
    }

    const pierce = Math.max(1, Math.min(spec.penetration, count));
    for (let i = 0; i < pierce; i++) {
      const c = candidates[i];
      const z = c.zombie;
      if (!z) continue;
      // Each body passed through costs the pellet a third of its punch.
      const falloff = Math.pow(0.66, i);
      const raw = damageAtRange(spec, c.t) * HIT_MULTIPLIER[c.zone] * falloff;
      const killed = z.hurt(raw, c.zone, false);
      anyHit = true;
      if (c.zone === 'head') anyHeadshot = true;

      economy.award(Math.round(SCORING.perHit * spec.hitPointFactor));
      events.push({ type: 'impactFlesh', x: c.x, y: c.y, z: c.z, dx, dy, dz, zone: c.zone });

      if (killed) {
        const headshot = c.zone === 'head';
        const points = headshot ? SCORING.headshotKill : SCORING.kill;
        economy.award(points);
        player.kills++;
        if (headshot) player.headshots++;
        events.push({ type: 'kill', kind: z.kind, headshot, melee: false, x: z.pos.x, y: z.centreY, z: z.pos.z, points });
      }
    }

    const last = candidates[pierce - 1];
    events.push({ type: 'tracer', x0: ox, y0: oy, z0: oz, x1: last.x, y1: last.y, z1: last.z });
  }

  if (anyHit) {
    player.shotsHit++;
    events.push({ type: 'hitmarker', headshot: anyHeadshot });
  }
}

/**
 * Melee swing: a short sphere sweep in front of the camera, gated by an arc test.
 * No animation dependency, so the hit registers the instant the timer says it
 * should - which is what makes a panic knife feel trustworthy.
 */
export function meleeSwing(fc: FireContext, spec: WeaponSpec): void {
  const { player, events, zombies, ctx, economy } = fc;
  const reach = spec.range;
  const arc = Math.cos(((spec.arc ?? 45) * Math.PI) / 180);

  const fx = -Math.sin(player.yaw);
  const fz = -Math.cos(player.yaw);
  const ox = player.pos.x;
  const oz = player.pos.z;
  const eyeY = player.eyeY - 0.3;

  let hits = 0;
  let connected = false;
  let killedAnything = false;

  for (let i = 0; i < zombies.length && hits < spec.penetration; i++) {
    const z = zombies[i];
    if (!z.alive) continue;
    const dx = z.pos.x - ox;
    const dz = z.pos.z - oz;
    const d = Math.hypot(dx, dz);
    if (d > reach + z.radius) continue;
    if (Math.abs(z.pos.y - player.pos.y) > 1.8) continue;
    if (d > 1e-4 && (dx / d) * fx + (dz / d) * fz < arc) continue;
    // A wall between us stops the blade, exactly as it would a bullet.
    if (!losClear(ox, eyeY, oz, z.pos.x, z.centreY, z.pos.z, ctx)) continue;

    // The Trench Fang aims for the head. It is a one-hit kill for many waves,
    // and rewarding a committed swing feels better than a flat damage number.
    const zone: HitZone = 'head';
    const killed = z.hurt(spec.damage, zone, true);
    hits++;
    connected = true;
    economy.award(Math.round(SCORING.perHit * spec.hitPointFactor));
    events.push({ type: 'impactFlesh', x: z.pos.x, y: z.centreY, z: z.pos.z, dx: fx, dy: 0, dz: fz, zone });
    if (killed) {
      killedAnything = true;
      economy.award(SCORING.meleeKill);
      player.kills++;
      player.meleeKills++;
      events.push({
        type: 'kill',
        kind: z.kind,
        headshot: true,
        melee: true,
        x: z.pos.x,
        y: z.centreY,
        z: z.pos.z,
        points: SCORING.meleeKill,
      });
    }
  }

  if (connected) {
    events.push({ type: 'meleeHit' });
    events.push({ type: 'hitmarker', headshot: killedAnything });
  }
}
