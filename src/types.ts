/**
 * Shared contracts between the React UI shell and the imperative engine.
 *
 * Keeping these in one file makes the React <-> engine boundary explicit: the UI
 * only ever sees `HudSnapshot`, `Settings` and `RunResult`. It never touches the
 * hot simulation state.
 */

export type Screen = 'loading' | 'menu' | 'playing' | 'gameover';

export type QualityPreset = 'low' | 'medium' | 'high';

export type WeaponId = 'sidewinder' | 'hornet' | 'breaker' | 'fang';

/** Coarse phase of a run. Drives HUD banners and the wave counter. */
export type RunPhase = 'countdown' | 'active' | 'intermission' | 'dead';

/**
 * Everything the 2D HUD needs, and nothing else. Published from the engine at
 * ~10Hz (and only when a value actually changed) rather than every frame.
 */
export interface HudSnapshot {
  health: number;
  maxHealth: number;
  points: number;
  wave: number;
  phase: RunPhase;
  /** Seconds left on the intermission / countdown clock. */
  clock: number;
  zombiesLeft: number;
  zombiesAlive: number;

  weaponName: string;
  weaponUpgraded: boolean;
  mag: number;
  magSize: number;
  reserve: number;
  reloading: boolean;
  melee: boolean;

  /** Contextual "[E] Open shutter - 750" style prompt, or null. */
  prompt: string | null;
  promptCost: number;
  promptAffordable: boolean;

  /** Monotonic counters: bump = play the CSS animation again. */
  hitmarker: number;
  headshotMarker: number;
  damageTick: number;
  /** Transient toast (purchase, error) with its own bump counter. */
  toast: string | null;
  toastTick: number;
  banner: string | null;
  bannerSub: string | null;
  bannerTick: number;

  paused: boolean;
}

export const EMPTY_HUD: HudSnapshot = {
  health: 150,
  maxHealth: 150,
  points: 500,
  wave: 0,
  phase: 'countdown',
  clock: 0,
  zombiesLeft: 0,
  zombiesAlive: 0,
  weaponName: 'Sidewinder M1',
  weaponUpgraded: false,
  mag: 12,
  magSize: 12,
  reserve: 96,
  reloading: false,
  melee: false,
  prompt: null,
  promptCost: 0,
  promptAffordable: false,
  hitmarker: 0,
  headshotMarker: 0,
  damageTick: 0,
  toast: null,
  toastTick: 0,
  banner: null,
  bannerSub: null,
  bannerTick: 0,
  paused: false,
};

export interface Settings {
  muted: boolean;
  /** Mouse sensitivity multiplier, 0.2 - 3.0. */
  sensitivity: number;
  quality: QualityPreset;
  invertY: boolean;
  showPerf: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  muted: false,
  sensitivity: 1,
  quality: 'medium',
  invertY: false,
  showPerf: false,
};

/** Final scorecard handed to the game-over screen. */
export interface RunResult {
  wave: number;
  points: number;
  kills: number;
  headshots: number;
  meleeKills: number;
  shotsFired: number;
  shotsHit: number;
  timeSurvived: number;
  bestWeapon: string;
}

export interface LoadProgress {
  label: string;
  /** 0 - 1 */
  value: number;
}
