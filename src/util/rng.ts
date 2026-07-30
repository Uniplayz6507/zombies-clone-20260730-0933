/**
 * Seeded RNG (mulberry32). Deterministic by design: shotgun spread, procedural
 * geometry, debris scatter and zombie variation all draw from seeded streams so
 * a given seed produces an identical city and identical spread patterns.
 */
export class Rng {
  private s: number;

  constructor(seed = 0x5eed1e) {
    this.s = seed >>> 0;
  }

  reseed(seed: number): void {
    this.s = seed >>> 0;
  }

  /** Uniform [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  float(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  int(lo: number, hi: number): number {
    return Math.floor(this.float(lo, hi + 1));
  }

  /** Symmetric jitter in [-m, m]. */
  jitter(m: number): number {
    return (this.next() * 2 - 1) * m;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Approximate normal distribution (sum of 3 uniforms), mean 0, ~sd 0.33. */
  gauss(): number {
    return (this.next() + this.next() + this.next()) / 1.5 - 1;
  }

  /** Random point in a unit disc, written into out. */
  disc(out: { x: number; y: number }): void {
    const a = this.next() * Math.PI * 2;
    const r = Math.sqrt(this.next());
    out.x = Math.cos(a) * r;
    out.y = Math.sin(a) * r;
  }
}

/** Shared stream for cosmetic, non-gameplay randomness. */
export const cosmetic = new Rng(0x20260730);
