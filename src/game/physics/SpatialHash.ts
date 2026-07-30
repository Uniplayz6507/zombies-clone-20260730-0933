import type { AABB } from './aabb';

/**
 * Uniform-grid broadphase over the static world.
 *
 * At ~20 zombies brute force would honestly be fine, but this is ~70 lines and
 * it means the collider count and the entity cap can both grow later without a
 * rewrite. Query results are written into a caller-owned array so the hot path
 * never allocates.
 *
 * Dedupe uses a stamp array rather than a Set: `seen[i] === queryId` is a single
 * integer compare, and there is no hashing or GC pressure.
 */
export class SpatialHash {
  private readonly cell: number;
  private readonly buckets = new Map<number, number[]>();
  private seen: Int32Array;
  private queryId = 0;

  constructor(cell = 3, capacityHint = 1024) {
    this.cell = cell;
    this.seen = new Int32Array(capacityHint);
  }

  private key(gx: number, gz: number): number {
    // Cantor-ish pairing via large primes; collisions are harmless (just extra
    // candidates), and Map handles the sparse keyspace.
    return (Math.imul(gx, 73856093) ^ Math.imul(gz, 19349663)) | 0;
  }

  clear(): void {
    this.buckets.clear();
  }

  /** Insert an index for every cell the box touches. */
  insert(index: number, a: AABB): void {
    if (index >= this.seen.length) {
      const grown = new Int32Array(Math.max(index + 1, this.seen.length * 2));
      grown.set(this.seen);
      this.seen = grown;
    }
    const gx0 = Math.floor(a.minX / this.cell);
    const gx1 = Math.floor(a.maxX / this.cell);
    const gz0 = Math.floor(a.minZ / this.cell);
    const gz1 = Math.floor(a.maxZ / this.cell);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const k = this.key(gx, gz);
        let bucket = this.buckets.get(k);
        if (!bucket) {
          bucket = [];
          this.buckets.set(k, bucket);
        }
        bucket.push(index);
      }
    }
  }

  /**
   * Collect candidate indices overlapping an XZ region. `out.length` is reset,
   * so pass the same scratch array every frame.
   */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: number[]): number[] {
    out.length = 0;
    const id = ++this.queryId;
    const seen = this.seen;
    const gx0 = Math.floor(minX / this.cell);
    const gx1 = Math.floor(maxX / this.cell);
    const gz0 = Math.floor(minZ / this.cell);
    const gz1 = Math.floor(maxZ / this.cell);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const bucket = this.buckets.get(this.key(gx, gz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const idx = bucket[i];
          if (seen[idx] !== id) {
            seen[idx] = id;
            out.push(idx);
          }
        }
      }
    }
    return out;
  }

  /** Candidates around a circle. The common case for character movement. */
  queryCircle(x: number, z: number, r: number, out: number[]): number[] {
    return this.query(x - r, z - r, x + r, z + r, out);
  }

  /** Candidates along a segment's bounding box. Good enough for hitscan. */
  querySegment(x0: number, z0: number, x1: number, z1: number, out: number[]): number[] {
    return this.query(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), out);
  }
}
