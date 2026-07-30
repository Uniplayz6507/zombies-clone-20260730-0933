import type { Vec3 } from '../../util/vec';
import { circleVsAABB, overlapsY, type Collider, type Penetration } from './aabb';
import type { SpatialHash } from './SpatialHash';

/**
 * Kinematic capsule controller shared by the player and every zombie.
 *
 * Approach: integrate the full horizontal move, then run a few depenetration
 * iterations. Iterating rather than resolving axis-by-axis is what removes the
 * two classic artefacts - getting glued to outside corners, and losing all speed
 * when sliding along a wall.
 *
 * Tunnelling is impossible here *because the timestep is fixed*: the fastest
 * entity travels ~12cm per 1/60s step and the thinnest collider in the level is
 * 20cm. That guarantee evaporates the moment you switch to variable dt, which is
 * a large part of why the sim runs on an accumulator.
 */

export const STEP_HEIGHT = 0.42;
export const GRAVITY = 22;

const pen: Penetration = { nx: 0, nz: 0, depth: 0 };

export interface MoveResult {
  onGround: boolean;
  /** True if we were pushed by geometry this step - used to damp AI steering. */
  blocked: boolean;
  groundY: number;
}

const result: MoveResult = { onGround: false, blocked: false, groundY: 0 };

export interface MoveContext {
  colliders: Collider[];
  hash: SpatialHash;
  openDoors: Set<string>;
  scratch: number[];
}

/** A collider only blocks us if its door is shut (or it isn't a door at all). */
function active(c: Collider, openDoors: Set<string>): boolean {
  return c.doorId === null || !openDoors.has(c.doorId);
}

/**
 * Resolve horizontal overlap for a capsule at `pos` (feet origin).
 * Velocity is projected so we slide instead of stopping dead.
 */
export function resolveHorizontal(
  pos: Vec3,
  vel: Vec3,
  radius: number,
  height: number,
  ctx: MoveContext,
): boolean {
  let blocked = false;
  const candidates = ctx.hash.queryCircle(pos.x, pos.z, radius + 0.6, ctx.scratch);

  // 4 iterations converges for every corner case in this level; more is wasted.
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    const feet = pos.y;
    const head = pos.y + height;
    for (let i = 0; i < candidates.length; i++) {
      const c = ctx.colliders[candidates[i]];
      if (!active(c, ctx.openDoors)) continue;
      // Low geometry (kerbs, sandbags) is stepped over, not collided with.
      if (c.maxY <= feet + STEP_HEIGHT) continue;
      // Geometry above our head (ceilings, awnings, pipe runs) is ignored.
      if (c.minY >= head) continue;
      if (!overlapsY(c, feet, head)) continue;

      if (circleVsAABB(c, pos.x, pos.z, radius, pen)) {
        pos.x += pen.nx * pen.depth;
        pos.z += pen.nz * pen.depth;
        // Kill the component of velocity heading into the surface.
        const into = vel.x * pen.nx + vel.z * pen.nz;
        if (into < 0) {
          vel.x -= pen.nx * into;
          vel.z -= pen.nz * into;
        }
        moved = true;
        blocked = true;
      }
    }
    if (!moved) break;
  }
  return blocked;
}

/**
 * Highest surface under the capsule that we are allowed to stand on.
 * Returns 0 (street level) when nothing is found.
 */
export function groundHeight(pos: Vec3, radius: number, ctx: MoveContext, reach: number): number {
  let best = 0;
  const ceiling = pos.y + reach;
  const candidates = ctx.hash.queryCircle(pos.x, pos.z, radius, ctx.scratch);
  for (let i = 0; i < candidates.length; i++) {
    const c = ctx.colliders[candidates[i]];
    if (!active(c, ctx.openDoors)) continue;
    if (c.maxY > ceiling) continue; // too tall to be a floor from here
    if (c.maxY <= best) continue;
    // Circle-vs-rect overlap test in XZ.
    const px = pos.x < c.minX ? c.minX : pos.x > c.maxX ? c.maxX : pos.x;
    const pz = pos.z < c.minZ ? c.minZ : pos.z > c.maxZ ? c.maxZ : pos.z;
    const dx = pos.x - px;
    const dz = pos.z - pz;
    if (dx * dx + dz * dz <= radius * radius) best = c.maxY;
  }
  return best;
}

/**
 * Full integrate + collide + gravity step for one capsule.
 * `vel` is mutated in place; `pos` is the feet position.
 */
export function moveAndCollide(
  pos: Vec3,
  vel: Vec3,
  radius: number,
  height: number,
  dt: number,
  ctx: MoveContext,
  gravity = GRAVITY,
): MoveResult {
  pos.x += vel.x * dt;
  pos.z += vel.z * dt;
  result.blocked = resolveHorizontal(pos, vel, radius, height, ctx);

  vel.y -= gravity * dt;
  pos.y += vel.y * dt;

  const ground = groundHeight(pos, radius, ctx, STEP_HEIGHT);
  result.groundY = ground;

  if (pos.y <= ground) {
    pos.y = ground;
    if (vel.y < 0) vel.y = 0;
    result.onGround = true;
  } else {
    result.onGround = false;
  }

  return result;
}

/**
 * Is the straight line between two points clear of level geometry?
 * Used for zombie "can I just walk at the player" shortcuts and bullet
 * occlusion. Only tests colliders tall enough to matter at chest height.
 */
export function lineOfSight(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  ctx: MoveContext,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-5) return true;
  const inv = 1 / len;
  const ndx = dx * inv;
  const ndy = dy * inv;
  const ndz = dz * inv;

  const candidates = ctx.hash.querySegment(ax, az, bx, bz, ctx.scratch);
  for (let i = 0; i < candidates.length; i++) {
    const c = ctx.colliders[candidates[i]];
    if (!active(c, ctx.openDoors)) continue;
    if (c.maxY < Math.min(ay, by) - 0.1) continue; // we can see over it
    // Inlined slab test (importing raySlabAABB here would be identical, this
    // just keeps the hot loop free of a call per candidate).
    let tmin = 0;
    let tmax = len;
    let hit = true;
    for (let axis = 0; axis < 3 && hit; axis++) {
      const o = axis === 0 ? ax : axis === 1 ? ay : az;
      const d = axis === 0 ? ndx : axis === 1 ? ndy : ndz;
      const lo = axis === 0 ? c.minX : axis === 1 ? c.minY : c.minZ;
      const hi = axis === 0 ? c.maxX : axis === 1 ? c.maxY : c.maxZ;
      if (Math.abs(d) < 1e-8) {
        if (o < lo || o > hi) hit = false;
      } else {
        const invd = 1 / d;
        let t1 = (lo - o) * invd;
        let t2 = (hi - o) * invd;
        if (t1 > t2) {
          const t = t1;
          t1 = t2;
          t2 = t;
        }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) hit = false;
      }
    }
    if (hit) return false;
  }
  return true;
}
