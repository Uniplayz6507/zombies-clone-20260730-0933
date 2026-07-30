import { useSyncExternalStore } from 'react';
import { EMPTY_HUD, type HudSnapshot } from '../types';

/**
 * The entire React <-> engine bridge. ~50 lines, no state library.
 *
 * The engine mutates a *draft* object as often as it likes (it's free - plain
 * property writes, zero allocation) and calls `flush()` on a throttle. Only a
 * flush that actually changed something allocates a new immutable snapshot and
 * notifies React. Result: the HUD re-renders ~10 times a second instead of 60,
 * and the render loop never enters the reconciler.
 */
export class HudStore {
  private draft: HudSnapshot = { ...EMPTY_HUD };
  private published: HudSnapshot = { ...EMPTY_HUD };
  private subs = new Set<() => void>();
  private dirty = false;

  /** Cheap, allocation-free write. Call from inside the game loop freely. */
  set(patch: Partial<HudSnapshot>): void {
    const d = this.draft as Record<string, unknown>;
    for (const k in patch) {
      const v = (patch as Record<string, unknown>)[k];
      if (d[k] !== v) {
        d[k] = v;
        this.dirty = true;
      }
    }
  }

  /** Bump a monotonic counter so the UI replays a one-shot animation. */
  bump(key: 'hitmarker' | 'headshotMarker' | 'damageTick' | 'toastTick' | 'bannerTick'): void {
    this.draft[key] = this.draft[key] + 1;
    this.dirty = true;
  }

  toast(message: string): void {
    this.draft.toast = message;
    this.draft.toastTick++;
    this.dirty = true;
  }

  banner(title: string, sub: string | null = null): void {
    this.draft.banner = title;
    this.draft.bannerSub = sub;
    this.draft.bannerTick++;
    this.dirty = true;
  }

  reset(): void {
    this.draft = { ...EMPTY_HUD };
    this.dirty = true;
    this.flush();
  }

  /** Publish if anything changed. Called on a ~100ms cadence by the engine. */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.published = { ...this.draft };
    for (const cb of this.subs) cb();
  }

  subscribe = (cb: () => void): (() => void) => {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  };

  getSnapshot = (): HudSnapshot => this.published;

  /** Direct read for engine-internal logic that needs the current draft. */
  get current(): HudSnapshot {
    return this.draft;
  }
}

/** React hook. Stable snapshot identity between flushes keeps bailouts working. */
export function useHud(store: HudStore): HudSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
