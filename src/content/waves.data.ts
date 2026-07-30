import type { ZombieKind } from '../game/Zombie';

/**
 * Wave pacing.
 *
 * The important design constraint is a *rendering* one: we cannot animate more
 * than ~16 skinned characters at 60fps on a mid-range laptop GPU (see
 * ARCHITECTURE.md section 4). So difficulty is expressed almost entirely through
 * spawn rate, movement speed, health and enemy mix - not through raw simultaneous
 * count. In practice that is also better game feel: a steady stream of fast
 * zombies is more threatening than a static crowd of slow ones.
 */

export interface WaveSpec {
  wave: number;
  /** Total Blighted to spawn this wave. */
  total: number;
  /** Hard cap on how many may be alive simultaneously. */
  aliveCap: number;
  /** Seconds between spawn attempts. */
  spawnInterval: number;
  healthMul: number;
  speedMul: number;
  /** Weighted enemy mix. */
  mix: { kind: ZombieKind; weight: number }[];
  /** Seconds of intermission after the wave is cleared. */
  intermission: number;
}

export const MAX_ALIVE_HARD_CAP = 16;

export function waveSpec(wave: number): WaveSpec {
  const w = Math.max(1, wave);

  // Superlinear but gentle: ~8 on wave 1, ~24 on wave 5, ~60 by wave 12.
  const total = Math.round(6 + w * 2.4 + Math.pow(w, 1.38));

  const aliveCap = Math.min(MAX_ALIVE_HARD_CAP, 5 + Math.floor(w * 0.95));

  // Spawn pressure ramps hard, then floors out so it never becomes a firehose.
  const spawnInterval = Math.max(0.42, 2.3 - w * 0.115);

  // Health outpaces damage from ~wave 9, which is when the Retool Bench and
  // headshots stop being optional.
  const healthMul = 1 + (w - 1) * 0.24 + Math.pow(Math.max(0, w - 8), 1.5) * 0.06;

  // Capped: past ~1.7x the Blighted outrun the player, and being unable to
  // kite is not difficulty, it is just losing.
  const speedMul = 1 + Math.min(0.7, (w - 1) * 0.055);

  const mix: { kind: ZombieKind; weight: number }[] = [{ kind: 'shambler', weight: 100 }];
  // Runners from wave 4: the first real spike, and the reason to buy the SMG.
  if (w >= 4) mix.push({ kind: 'runner', weight: Math.min(55, (w - 3) * 9) });
  // Brutes from wave 8: soak damage, break a kiting loop, reward the shotgun.
  if (w >= 8) mix.push({ kind: 'brute', weight: Math.min(30, (w - 7) * 5) });

  const intermission = w === 1 ? 8 : Math.max(7, 13 - w * 0.35);

  return { wave: w, total, aliveCap, spawnInterval, healthMul, speedMul, mix, intermission };
}

/** Pick a kind from the weighted mix using a 0-1 roll. */
export function rollKind(spec: WaveSpec, roll: number): ZombieKind {
  let sum = 0;
  for (const m of spec.mix) sum += m.weight;
  let t = roll * sum;
  for (const m of spec.mix) {
    t -= m.weight;
    if (t <= 0) return m.kind;
  }
  return spec.mix[0].kind;
}

/** Points awarded for events. Tuned so a careful wave 5 funds the shotgun. */
export const SCORING = {
  perHit: 10,
  kill: 60,
  headshotKill: 120,
  meleeKill: 140,
  waveClear: 50,
  startingPoints: 500,
} as const;
