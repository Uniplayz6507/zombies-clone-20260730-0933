/**
 * Hand-rolled collision primitives.
 *
 * No physics engine (see ARCHITECTURE.md section 3): we have no stacking, no
 * joints, no ragdolls and no dynamic rigid bodies, so a solver would be 1MB of
 * wasm and a second simulation clock in exchange for tests we can write here in
 * a few hundred readable lines.
 *
 * Convention: the world is axis-aligned. Level geometry is boxes, characters are
 * vertical capsules approximated by spheres, bullets are rays.
 */

export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface Collider extends AABB {
  /** Non-null when this collider only exists while a door is shut. */
  doorId: string | null;
  /** Debug/gameplay label, e.g. 'wall', 'car', 'pillar'. */
  tag: string;
}

export function makeAABB(minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number): AABB {
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

export function collider(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
  tag = 'wall',
  doorId: string | null = null,
): Collider {
  return { minX, maxX, minY, maxY, minZ, maxZ, tag, doorId };
}

/** Axis-aligned box centred on (cx, cz) with the given footprint and height. */
export function boxAt(cx: number, cz: number, w: number, d: number, y0: number, y1: number, tag = 'prop'): Collider {
  return collider(cx - w / 2, cx + w / 2, y0, y1, cz - d / 2, cz + d / 2, tag);
}

export function expand(a: AABB, m: number): AABB {
  return { minX: a.minX - m, maxX: a.maxX + m, minY: a.minY - m, maxY: a.maxY + m, minZ: a.minZ - m, maxZ: a.maxZ + m };
}

export function pointInsideXZ(a: AABB, x: number, z: number): boolean {
  return x >= a.minX && x <= a.maxX && z >= a.minZ && z <= a.maxZ;
}

/** Do the vertical extents of a collider and a capsule overlap at all? */
export function overlapsY(a: AABB, feet: number, head: number): boolean {
  return a.maxY > feet && a.minY < head;
}

/**
 * Circle (XZ) vs AABB depenetration.
 *
 * Returns the minimum-translation normal and depth needed to push the circle out
 * of the box, or false if they are not intersecting. Writing the result into a
 * caller-owned object keeps this allocation-free in the hot path.
 */
export interface Penetration {
  nx: number;
  nz: number;
  depth: number;
}

export function circleVsAABB(a: AABB, cx: number, cz: number, r: number, out: Penetration): boolean {
  // Closest point on the rectangle to the circle centre.
  const px = cx < a.minX ? a.minX : cx > a.maxX ? a.maxX : cx;
  const pz = cz < a.minZ ? a.minZ : cz > a.maxZ ? a.maxZ : cz;
  const dx = cx - px;
  const dz = cz - pz;
  const d2 = dx * dx + dz * dz;

  if (d2 > r * r) return false;

  if (d2 > 1e-9) {
    // Outside the box: push straight out along the surface normal.
    const d = Math.sqrt(d2);
    out.nx = dx / d;
    out.nz = dz / d;
    out.depth = r - d;
    return true;
  }

  // Centre is *inside* the box (deep penetration, e.g. after a teleport or a
  // door closing on us). Escape along the nearest face, which is the classic
  // minimum-translation-vector resolution.
  const left = cx - a.minX;
  const right = a.maxX - cx;
  const back = cz - a.minZ;
  const front = a.maxZ - cz;
  const m = Math.min(left, right, back, front);
  if (m === left) {
    out.nx = -1;
    out.nz = 0;
    out.depth = left + r;
  } else if (m === right) {
    out.nx = 1;
    out.nz = 0;
    out.depth = right + r;
  } else if (m === back) {
    out.nx = 0;
    out.nz = -1;
    out.depth = back + r;
  } else {
    out.nx = 0;
    out.nz = 1;
    out.depth = front + r;
  }
  return true;
}

/**
 * Ray vs AABB using the slab method. Returns the entry distance along the ray,
 * or -1 for a miss. Used for bullet occlusion and zombie line-of-sight.
 */
export function raySlabAABB(
  a: AABB,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
): number {
  let tmin = 0;
  let tmax = maxT;

  // X slab
  if (Math.abs(dx) < 1e-8) {
    if (ox < a.minX || ox > a.maxX) return -1;
  } else {
    const inv = 1 / dx;
    let t1 = (a.minX - ox) * inv;
    let t2 = (a.maxX - ox) * inv;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  // Y slab
  if (Math.abs(dy) < 1e-8) {
    if (oy < a.minY || oy > a.maxY) return -1;
  } else {
    const inv = 1 / dy;
    let t1 = (a.minY - oy) * inv;
    let t2 = (a.maxY - oy) * inv;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  // Z slab
  if (Math.abs(dz) < 1e-8) {
    if (oz < a.minZ || oz > a.maxZ) return -1;
  } else {
    const inv = 1 / dz;
    let t1 = (a.minZ - oz) * inv;
    let t2 = (a.maxZ - oz) * inv;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  return tmin;
}

/**
 * Analytic ray vs sphere. Cheap enough that testing every zombie's four body
 * spheres per shot is free compared to a triangle-level Raycaster walk of the
 * scene graph.
 */
export function raySphere(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
): number {
  const mx = ox - cx;
  const my = oy - cy;
  const mz = oz - cz;
  const b = mx * dx + my * dy + mz * dz;
  const c = mx * mx + my * my + mz * mz - r * r;
  // Pointing away and already outside: early out.
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}

/** Sphere vs sphere overlap test in 3D. */
export function sphereOverlap(
  ax: number,
  ay: number,
  az: number,
  ar: number,
  bx: number,
  by: number,
  bz: number,
  br: number,
): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  const r = ar + br;
  return dx * dx + dy * dy + dz * dz <= r * r;
}
