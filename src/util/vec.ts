/**
 * Minimal 3-vector maths for the simulation layer.
 *
 * Deliberately NOT THREE.Vector3: `src/game/**` must not import the renderer
 * (see ARCHITECTURE.md section 7). These are plain objects so the sim is
 * testable in isolation and has no coupling to WebGL.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export function set(o: Vec3, x: number, y: number, z: number): Vec3 {
  o.x = x;
  o.y = y;
  o.z = z;
  return o;
}

export function copy(o: Vec3, a: Vec3): Vec3 {
  o.x = a.x;
  o.y = a.y;
  o.z = a.z;
  return o;
}

export function addScaled(o: Vec3, a: Vec3, s: number): Vec3 {
  o.x += a.x * s;
  o.y += a.y * s;
  o.z += a.z * s;
  return o;
}

export function scale(o: Vec3, s: number): Vec3 {
  o.x *= s;
  o.y *= s;
  o.z *= s;
  return o;
}

export function lengthXZ(a: Vec3): number {
  return Math.hypot(a.x, a.z);
}

export function distXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function distXZSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Framerate-independent exponential approach. Prefer this over `lerp(a,b,0.1)`
 * inside an update: raw lerp factors are silently tied to the timestep.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Shortest signed angular difference, in radians. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function approachAngle(current: number, target: number, maxStep: number): number {
  const d = angleDelta(current, target);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

/** Yaw such that (sin yaw, 0, cos yaw) points along (dx, dz). Model faces +Z. */
export function yawFromDir(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/** Camera-convention forward: yaw 0 looks down -Z (matches THREE defaults). */
export function camForwardX(yaw: number): number {
  return -Math.sin(yaw);
}
export function camForwardZ(yaw: number): number {
  return -Math.cos(yaw);
}
export function camRightX(yaw: number): number {
  return Math.cos(yaw);
}
export function camRightZ(yaw: number): number {
  return -Math.sin(yaw);
}
