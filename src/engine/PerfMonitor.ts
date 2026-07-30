import type * as THREE from 'three';

/**
 * Frame timing.
 *
 * You cannot hold a performance budget you are not measuring, so this tracks a
 * rolling window and reports p50/p95 rather than instantaneous FPS. Instantaneous
 * FPS hides exactly the thing that ruins a game: occasional long frames. A steady
 * 55fps is fine. 60fps with a 40ms hitch every second is not.
 *
 * Auto-degrade triggers on *sustained* overrun, never on a single spike, so a GC
 * pause or an alt-tab cannot permanently downgrade your visuals.
 */
export class PerfMonitor {
  private readonly samples: number[] = [];
  private readonly window = 120;
  private cursor = 0;
  private readonly sorted: number[] = [];

  p50 = 16.7;
  p95 = 16.7;
  fps = 60;

  drawCalls = 0;
  triangles = 0;
  programs = 0;
  geometries = 0;
  textures = 0;

  private overBudget = 0;
  private degradesApplied = 0;

  constructor(
    private readonly budgetMs = 18,
    private readonly maxDegrades = 4,
  ) {}

  sample(frameMs: number): void {
    if (this.samples.length < this.window) this.samples.push(frameMs);
    else {
      this.samples[this.cursor] = frameMs;
      this.cursor = (this.cursor + 1) % this.window;
    }
  }

  /** Recompute percentiles. Called a few times a second, not every frame. */
  recompute(): void {
    const n = this.samples.length;
    if (n === 0) return;
    this.sorted.length = n;
    for (let i = 0; i < n; i++) this.sorted[i] = this.samples[i];
    this.sorted.sort((a, b) => a - b);
    this.p50 = this.sorted[Math.floor(n * 0.5)];
    this.p95 = this.sorted[Math.min(n - 1, Math.floor(n * 0.95))];
    this.fps = this.p50 > 0 ? 1000 / this.p50 : 0;
  }

  readRenderer(info: THREE.WebGLRenderer['info']): void {
    this.drawCalls = info.render.calls;
    this.triangles = info.render.triangles;
    this.programs = info.programs?.length ?? 0;
    this.geometries = info.memory.geometries;
    this.textures = info.memory.textures;
  }

  /**
   * Should we drop a quality stage? Requires roughly 1.5 seconds of consistently
   * slow frames before acting, and recovers twice as fast as it accumulates.
   */
  shouldDegrade(frameMs: number): boolean {
    if (this.degradesApplied >= this.maxDegrades) return false;
    if (frameMs > this.budgetMs) this.overBudget++;
    else this.overBudget = Math.max(0, this.overBudget - 2);
    if (this.overBudget > 90) {
      this.overBudget = 0;
      this.degradesApplied++;
      return true;
    }
    return false;
  }

  reset(): void {
    this.samples.length = 0;
    this.cursor = 0;
    this.overBudget = 0;
  }
}
