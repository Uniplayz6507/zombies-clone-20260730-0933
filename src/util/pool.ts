/**
 * Fixed-capacity object pool.
 *
 * The whole point: allocate every entity, tracer, decal and audio voice at load
 * time and never allocate again while a wave is running. `splice`/`push` on hot
 * arrays and `new Vector3()` inside `update()` are the two biggest sources of GC
 * saw-tooth in a Three.js game.
 */
export interface Poolable {
  active: boolean;
}

export class Pool<T extends Poolable> {
  readonly items: T[];

  constructor(capacity: number, factory: (index: number) => T) {
    this.items = new Array(capacity);
    for (let i = 0; i < capacity; i++) this.items[i] = factory(i);
  }

  get capacity(): number {
    return this.items.length;
  }

  /** First inactive item, or null when saturated. Never allocates. */
  acquire(): T | null {
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      if (!items[i].active) {
        items[i].active = true;
        return items[i];
      }
    }
    return null;
  }

  countActive(): number {
    let n = 0;
    for (let i = 0; i < this.items.length; i++) if (this.items[i].active) n++;
    return n;
  }

  releaseAll(): void {
    for (let i = 0; i < this.items.length; i++) this.items[i].active = false;
  }
}
