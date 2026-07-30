/**
 * Local steering. The waypoint flow field answers "which way is the player";
 * this answers "don't walk into that wall, and stop standing inside your friend".
 *
 * The combination is deliberately imperfect. Zombies that shove each other and
 * clog a doorway are *better* for this genre than zombies that path cleanly
 * around one another - the chokepoint is the whole game.
 */

export interface SteerOut {
  x: number;
  z: number;
}

/** Anything with a position and a footprint. Matches Zombie without importing it. */
export interface Crowdable {
  pos: { x: number; z: number };
  active: boolean;
  radius: number;
}

/** Unit vector toward a target, written into out. */
export function seek(fromX: number, fromZ: number, toX: number, toZ: number, out: SteerOut): void {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const len = Math.hypot(dx, dz);
  if (len < 1e-5) {
    out.x = 0;
    out.z = 0;
    return;
  }
  out.x = dx / len;
  out.z = dz / len;
}

/**
 * Push away from neighbours that are too close, falling off with distance so the
 * horde compresses under pressure instead of exploding apart.
 */
export function separation(
  x: number,
  z: number,
  radius: number,
  neighbours: readonly Crowdable[],
  selfIndex: number,
  out: SteerOut,
): void {
  out.x = 0;
  out.z = 0;
  for (let i = 0; i < neighbours.length; i++) {
    if (i === selfIndex) continue;
    const n = neighbours[i];
    if (!n.active) continue;
    const dx = x - n.pos.x;
    const dz = z - n.pos.z;
    const d2 = dx * dx + dz * dz;
    const min = radius + n.radius;
    if (d2 > min * min || d2 < 1e-6) continue;
    const d = Math.sqrt(d2);
    const push = (min - d) / min;
    out.x += (dx / d) * push;
    out.z += (dz / d) * push;
  }
}

/**
 * Whisker avoidance: probe ahead-left and ahead-right, steer away from whichever
 * side is blocked. Cheap, and it produces a convincing wall-scraping shuffle.
 */
export function avoid(dirX: number, dirZ: number, leftBlocked: boolean, rightBlocked: boolean, out: SteerOut): void {
  out.x = 0;
  out.z = 0;
  if (leftBlocked === rightBlocked) return;
  const px = -dirZ;
  const pz = dirX;
  const sign = leftBlocked ? -1 : 1;
  out.x = px * sign;
  out.z = pz * sign;
}

/** Blend weighted contributions into a normalised direction. */
export function blend(out: SteerOut, parts: readonly { v: SteerOut; w: number }[]): void {
  out.x = 0;
  out.z = 0;
  for (const p of parts) {
    out.x += p.v.x * p.w;
    out.z += p.v.z * p.w;
  }
  const len = Math.hypot(out.x, out.z);
  if (len > 1e-5) {
    out.x /= len;
    out.z /= len;
  }
}

/** Small wander offset so blocked zombies never look frozen. */
export function wander(phase: number, amount: number, out: SteerOut): void {
  out.x = Math.sin(phase * 0.7) * amount;
  out.z = Math.cos(phase * 0.53) * amount;
}
