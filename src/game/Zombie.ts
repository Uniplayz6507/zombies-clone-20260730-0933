import { vec3, type Vec3 } from '../util/vec';
import type { HitZone } from '../content/weapons.data';

/**
 * A single Blighted.
 *
 * Pooled: instances are created once at load and recycled forever via the
 * `active` flag. Nothing here allocates during a wave.
 *
 * Collision/hit representation is four spheres rather than a mesh. Ray-vs-sphere
 * is analytic and costs a handful of multiplies, so testing every zombie's four
 * spheres on every shot is cheaper than a single triangle-level Raycaster walk of
 * the scene graph - and it gives us clean headshot/limb zones for free.
 */

export type ZombieKind = 'shambler' | 'runner' | 'brute';

export type ZombieState = 'emerging' | 'chase' | 'windup' | 'strike' | 'stagger' | 'dead';

export interface ZombieProfile {
  /** Collision radius in XZ. */
  radius: number;
  /** Standing height, metres. */
  height: number;
  /** Uniform model scale. */
  scale: number;
  baseHealth: number;
  baseSpeed: number;
  /** Damage per successful strike. */
  damage: number;
  /** Seconds between strike attempts. */
  attackCooldown: number;
  /** Wind-up before the strike lands - the player's window to back off. */
  windup: number;
  /** How hard incoming damage has to be to interrupt them. */
  staggerThreshold: number;
  /** Reach measured from body centre. */
  reach: number;
  /** Animation tempo multiplier. */
  gait: number;
}

export const PROFILES: Record<ZombieKind, ZombieProfile> = {
  // The baseline. Slow, relentless, dies to two headshots for a long while.
  shambler: {
    radius: 0.4,
    height: 1.78,
    scale: 1,
    baseHealth: 150,
    baseSpeed: 2.15,
    damage: 22,
    attackCooldown: 1.15,
    windup: 0.34,
    staggerThreshold: 55,
    reach: 1.35,
    gait: 1,
  },
  // Introduced wave 4. Fast, fragile, ruins a lazy kiting pattern.
  runner: {
    radius: 0.36,
    height: 1.72,
    scale: 0.96,
    baseHealth: 95,
    baseSpeed: 4.3,
    damage: 16,
    attackCooldown: 0.8,
    windup: 0.22,
    staggerThreshold: 30,
    reach: 1.25,
    gait: 1.85,
  },
  // Introduced wave 8. Soaks a full magazine, cannot be staggered by pistol fire.
  brute: {
    radius: 0.52,
    height: 2.02,
    scale: 1.16,
    baseHealth: 620,
    baseSpeed: 1.75,
    damage: 44,
    attackCooldown: 1.6,
    windup: 0.5,
    staggerThreshold: 150,
    reach: 1.6,
    gait: 0.78,
  },
};

/** One hit sphere, in local (unscaled) model space. */
interface HitSphere {
  zone: HitZone;
  /** Height above the feet, as a fraction of standing height. */
  ty: number;
  /** Radius as a fraction of standing height. */
  tr: number;
}

/**
 * Ordered head-first so the loop naturally prefers the highest-value zone when
 * spheres overlap around the neck.
 */
export const HIT_SPHERES: HitSphere[] = [
  { zone: 'head', ty: 0.9, tr: 0.1 },
  { zone: 'torso', ty: 0.68, tr: 0.155 },
  { zone: 'hips', ty: 0.5, tr: 0.14 },
  { zone: 'legs', ty: 0.24, tr: 0.115 },
];

export class Zombie {
  active = false;

  kind: ZombieKind = 'shambler';
  profile: ZombieProfile = PROFILES.shambler;

  /** Feet position. */
  readonly pos: Vec3 = vec3();
  /** Previous step's position, for render interpolation. */
  readonly prev: Vec3 = vec3();
  readonly vel: Vec3 = vec3();

  /** Facing. The model's forward is +Z, so yaw = atan2(dx, dz). */
  yaw = 0;
  prevYaw = 0;

  health = 150;
  maxHealth = 150;
  speed = 2.15;
  radius = 0.4;
  height = 1.78;
  scale = 1;

  state: ZombieState = 'chase';
  stateT = 0;

  // --- Cosmetic per-instance variation. This is what stops a horde of shared
  // --- geometry from looking like a row of clones.
  /** Walk-cycle phase offset. */
  animPhase = 0;
  /** Asymmetric gait, 0 = even, 1 = badly broken. */
  limp = 0;
  /** Height multiplier on top of the profile. */
  sizeJitter = 1;
  skinVariant = 0;
  clothVariant = 0;
  /** Head tilt / lean, radians. */
  postureLean = 0;
  postureTilt = 0;

  // --- Navigation
  node = -1;
  replanT = 0;
  /** True when we have clear line of sight and can charge directly. */
  direct = false;

  attackCd = 0;
  groanT = 0;
  /** Decays to 0; drives the emissive hit flash on the renderer side. */
  hitFlash = 0;
  deathT = 0;
  /** Death direction, so bodies fall away from the shot. */
  deathYaw = 0;
  lastHitZone: HitZone = 'torso';
  /** Set on the killing blow so the renderer can pick a death animation. */
  killedByHead = false;
  killedByMelee = false;

  /** Render-side handle. Assigned by ZombieRenderer; the sim never reads it. */
  renderSlot = -1;

  get alive(): boolean {
    return this.active && this.state !== 'dead';
  }

  /** Body centre, used for steering and attack range checks. */
  get centreY(): number {
    return this.pos.y + this.height * 0.55;
  }

  /** World-space hit sphere `i`. Written into out to stay allocation-free. */
  sphere(i: number, out: { x: number; y: number; z: number; r: number; zone: HitZone }): void {
    const s = HIT_SPHERES[i];
    out.zone = s.zone;
    out.x = this.pos.x;
    out.y = this.pos.y + s.ty * this.height;
    out.z = this.pos.z;
    out.r = s.tr * this.height;
    // Nudge the head sphere forward: the Blighted walk badly hunched, so a
    // vertical stack of spheres would put the head behind where it is drawn.
    if (s.zone === 'head') {
      out.x += Math.sin(this.yaw) * this.height * 0.09;
      out.z += Math.cos(this.yaw) * this.height * 0.09;
      out.y -= this.height * 0.04;
    }
  }

  reset(kind: ZombieKind, x: number, z: number, yaw: number, healthMul: number, speedMul: number, r: { next(): number; float(a: number, b: number): number; int(a: number, b: number): number }): void {
    const p = PROFILES[kind];
    this.kind = kind;
    this.profile = p;

    this.sizeJitter = r.float(0.93, 1.08);
    this.height = p.height * this.sizeJitter;
    this.scale = p.scale * this.sizeJitter;
    this.radius = p.radius;

    this.maxHealth = p.baseHealth * healthMul;
    this.health = this.maxHealth;
    // Per-instance speed spread keeps a wave from arriving as one solid rank.
    this.speed = p.baseSpeed * speedMul * r.float(0.88, 1.12);

    this.pos.x = x;
    this.pos.y = 0;
    this.pos.z = z;
    this.prev.x = x;
    this.prev.y = 0;
    this.prev.z = z;
    this.vel.x = 0;
    this.vel.y = 0;
    this.vel.z = 0;

    this.yaw = yaw;
    this.prevYaw = yaw;

    this.state = 'emerging';
    this.stateT = 0;
    this.animPhase = r.float(0, Math.PI * 2);
    this.limp = r.next() < 0.45 ? r.float(0.25, 0.85) : 0;
    this.skinVariant = r.int(0, 2);
    this.clothVariant = r.int(0, 2);
    this.postureLean = r.float(0.12, 0.34);
    this.postureTilt = r.float(-0.22, 0.22);

    this.node = -1;
    this.replanT = r.float(0, 0.25);
    this.direct = false;
    this.attackCd = 0;
    this.groanT = r.float(0.5, 4);
    this.hitFlash = 0;
    this.deathT = 0;
    this.killedByHead = false;
    this.killedByMelee = false;
    this.active = true;
  }

  /** Returns true if this hit was lethal. */
  hurt(amount: number, zone: HitZone, melee: boolean): boolean {
    if (this.state === 'dead') return false;
    this.health -= amount;
    this.lastHitZone = zone;
    this.hitFlash = 1;
    if (this.health <= 0) {
      this.state = 'dead';
      this.stateT = 0;
      this.deathT = 0;
      this.killedByHead = zone === 'head';
      this.killedByMelee = melee;
      this.vel.x = 0;
      this.vel.z = 0;
      return true;
    }
    // Only meaningful damage interrupts, and brutes shrug off small arms.
    if (amount >= this.profile.staggerThreshold && this.state !== 'strike') {
      this.state = 'stagger';
      this.stateT = 0;
    }
    return false;
  }
}
