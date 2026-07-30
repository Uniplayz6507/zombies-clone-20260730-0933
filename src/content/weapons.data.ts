import type { WeaponId } from '../types';

/**
 * Weapon statistics. Original designs and names.
 *
 * Balance intent:
 *  - Sidewinder M1 (start): accurate, cheap on ammo, punishes poor aim. Two
 *    headshots kill early Blighted, four body shots do not.
 *  - Hornet SR-9: crowd control. High rate of fire, mediocre per-shot damage,
 *    burns reserve fast so the Ammo Cache stays relevant.
 *  - Breaker 12: the panic button. Deletes anything within 4m, useless past 9m,
 *    and the pump cycle is long enough to get you killed if you mistime it.
 *  - Trench Fang: infinite, silent, one-hit-kills for the first several waves.
 *    Reach is short and the swing commits you.
 */

export type FireMode = 'semi' | 'auto' | 'pump' | 'melee';

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  mode: FireMode;
  /** Damage per projectile. */
  damage: number;
  /** Number of projectiles per trigger pull (shotgun pellets). */
  pellets: number;
  /** Rounds per minute. */
  rpm: number;
  magSize: number;
  reserveMax: number;
  reloadTime: number;
  /** Cone half-angle in degrees, hip-fired, at rest. */
  spread: number;
  /** Extra spread added per shot, decays between shots. */
  bloom: number;
  /** Multiplier applied to spread while aiming down sights. */
  adsSpread: number;
  /** Effective range in metres; damage falls off linearly to 40% beyond it. */
  range: number;
  /** Vertical/horizontal recoil impulse, radians. */
  recoilPitch: number;
  recoilYaw: number;
  /** Viewmodel kick, metres. */
  kick: number;
  /** Zombies punched through per shot (overpenetration). */
  penetration: number;
  /** Points earned per point of damage dealt, scaled in Economy. */
  hitPointFactor: number;
  /** Melee arc half-angle, degrees. Melee only. */
  arc?: number;
  /** Cost to buy from a Requisition Panel. 0 = not purchasable. */
  cost: number;
  /** Cost of a reserve refill when already owned. */
  refill: number;
  /** Audio character - drives the procedural gunshot synth. */
  voice: { bodyHz: number; decay: number; crack: number; punch: number };
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  sidewinder: {
    id: 'sidewinder',
    name: 'Sidewinder M1',
    mode: 'semi',
    damage: 46,
    pellets: 1,
    rpm: 320,
    magSize: 12,
    reserveMax: 108,
    reloadTime: 1.45,
    spread: 0.5,
    bloom: 0.55,
    adsSpread: 0.35,
    range: 45,
    recoilPitch: 0.026,
    recoilYaw: 0.006,
    kick: 0.05,
    penetration: 1,
    hitPointFactor: 1,
    cost: 0,
    refill: 450,
    voice: { bodyHz: 190, decay: 0.24, crack: 0.85, punch: 1 },
  },
  hornet: {
    id: 'hornet',
    name: 'Hornet SR-9',
    mode: 'auto',
    damage: 27,
    pellets: 1,
    rpm: 820,
    magSize: 32,
    reserveMax: 288,
    reloadTime: 1.95,
    spread: 1.15,
    bloom: 0.32,
    adsSpread: 0.5,
    range: 32,
    recoilPitch: 0.014,
    recoilYaw: 0.008,
    kick: 0.032,
    penetration: 1,
    hitPointFactor: 1,
    cost: 1200,
    refill: 600,
    voice: { bodyHz: 240, decay: 0.16, crack: 0.7, punch: 0.8 },
  },
  breaker: {
    id: 'breaker',
    name: 'Breaker 12',
    mode: 'pump',
    damage: 26,
    pellets: 9,
    rpm: 72,
    magSize: 6,
    reserveMax: 54,
    reloadTime: 3.1,
    spread: 4.2,
    bloom: 0.1,
    adsSpread: 0.72,
    range: 12,
    recoilPitch: 0.075,
    recoilYaw: 0.012,
    kick: 0.13,
    // Buckshot tears through a crowd - this is what makes it worth 1600.
    penetration: 2,
    hitPointFactor: 0.85,
    cost: 1600,
    refill: 700,
    voice: { bodyHz: 120, decay: 0.42, crack: 1, punch: 1.4 },
  },
  fang: {
    id: 'fang',
    name: 'Trench Fang',
    mode: 'melee',
    damage: 220,
    pellets: 1,
    rpm: 96,
    magSize: Infinity,
    reserveMax: Infinity,
    reloadTime: 0,
    spread: 0,
    bloom: 0,
    adsSpread: 1,
    range: 2.3,
    recoilPitch: 0.01,
    recoilYaw: 0.02,
    kick: 0.06,
    penetration: 2,
    hitPointFactor: 1.4,
    arc: 48,
    cost: 0,
    refill: 0,
    voice: { bodyHz: 90, decay: 0.1, crack: 0.2, punch: 0.3 },
  },
};

/**
 * Retool Bench upgrade. Applied multiplicatively on top of the base spec so a
 * single flag on the weapon state is enough - no duplicated stat tables.
 */
export const RETOOL = {
  damage: 1.65,
  magSize: 1.5,
  reserveMax: 1.5,
  reloadTime: 0.78,
  spread: 0.82,
  namePrefix: 'Retooled ',
} as const;

/** Resolve the effective stats for a weapon, upgraded or not. */
export function effectiveSpec(id: WeaponId, upgraded: boolean): WeaponSpec {
  const base = WEAPONS[id];
  if (!upgraded) return base;
  return {
    ...base,
    name: RETOOL.namePrefix + base.name,
    damage: base.damage * RETOOL.damage,
    magSize: Number.isFinite(base.magSize) ? Math.round(base.magSize * RETOOL.magSize) : base.magSize,
    reserveMax: Number.isFinite(base.reserveMax) ? Math.round(base.reserveMax * RETOOL.reserveMax) : base.reserveMax,
    reloadTime: base.reloadTime * RETOOL.reloadTime,
    spread: base.spread * RETOOL.spread,
  };
}

/** Seconds between shots. */
export function fireInterval(spec: WeaponSpec): number {
  return 60 / spec.rpm;
}

/** Damage after range falloff. */
export function damageAtRange(spec: WeaponSpec, distance: number): number {
  if (distance <= spec.range) return spec.damage;
  const over = Math.min(1, (distance - spec.range) / spec.range);
  return spec.damage * (1 - 0.6 * over);
}

/** Body-part damage multipliers. Headshots are the entire skill ceiling here. */
export const HIT_MULTIPLIER = {
  head: 2.6,
  torso: 1,
  hips: 0.9,
  legs: 0.72,
} as const;

export type HitZone = keyof typeof HIT_MULTIPLIER;
