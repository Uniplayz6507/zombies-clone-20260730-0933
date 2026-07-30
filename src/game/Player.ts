import { clamp, clamp01, damp, vec3, type Vec3 } from '../util/vec';
import { Arsenal, type SlotId } from './weapons/Arsenal';
import { moveAndCollide, STEP_HEIGHT, type MoveContext } from './physics/CharacterController';
import type { EventQueue } from './events';

/**
 * First-person character controller.
 *
 * Movement is Quake-lineage: accelerate toward a wish direction by projecting
 * current velocity onto it, apply friction when grounded and almost none in the
 * air. It is decades old because it feels correct - responsive without being
 * frictionless.
 */

export interface PlayerInput {
  /** -1..1 strafe. */
  moveX: number;
  /** -1..1 forward. */
  moveZ: number;
  yaw: number;
  pitch: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  fire: boolean;
  firePressed: boolean;
  ads: boolean;
  reload: boolean;
  melee: boolean;
  interact: boolean;
  interactPressed: boolean;
  switchTo: SlotId | null;
  cycle: boolean;
}

export const emptyInput = (): PlayerInput => ({
  moveX: 0,
  moveZ: 0,
  yaw: 0,
  pitch: 0,
  jump: false,
  sprint: false,
  crouch: false,
  fire: false,
  firePressed: false,
  ads: false,
  reload: false,
  melee: false,
  interact: false,
  interactPressed: false,
  switchTo: null,
  cycle: false,
});

const STAND_HEIGHT = 1.8;
const CROUCH_HEIGHT = 1.26;
const WALK_SPEED = 4.35;
const SPRINT_SPEED = 6.5;
const CROUCH_SPEED = 2.0;
const GROUND_ACCEL = 62;
const AIR_ACCEL = 9;
const GROUND_FRICTION = 11;
const JUMP_VELOCITY = 6.2;

export class Player {
  readonly pos: Vec3 = vec3(0, 0, 0);
  readonly prev: Vec3 = vec3(0, 0, 0);
  readonly vel: Vec3 = vec3(0, 0, 0);

  yaw = 0;
  pitch = 0;

  readonly radius = 0.34;
  height = STAND_HEIGHT;
  eyeHeight = STAND_HEIGHT - 0.16;

  maxHealth = 150;
  health = 150;
  private sinceHurt = 99;

  maxStamina = 100;
  stamina = 100;
  private staminaLock = 0;

  onGround = true;
  crouching = false;
  sprinting = false;

  /** 0-1 normalised planar speed, for headbob and viewmodel sway. */
  speed01 = 0;
  /** Advances with distance travelled, so bob can never desync from the feet. */
  bobPhase = 0;
  private stepAccum = 0;
  /** Decaying landing impulse, for the camera dip. */
  landImpact = 0;

  readonly arsenal = new Arsenal();

  // Run statistics for the game-over card.
  kills = 0;
  headshots = 0;
  meleeKills = 0;
  shotsFired = 0;
  shotsHit = 0;

  get dead(): boolean {
    return this.health <= 0;
  }

  get eyeY(): number {
    return this.pos.y + this.eyeHeight;
  }

  get health01(): number {
    return clamp(this.health / this.maxHealth, 0, 1);
  }

  reset(x: number, y: number, z: number, yaw: number): void {
    this.pos.x = x;
    this.pos.y = y;
    this.pos.z = z;
    this.prev.x = x;
    this.prev.y = y;
    this.prev.z = z;
    this.vel.x = 0;
    this.vel.y = 0;
    this.vel.z = 0;
    this.yaw = yaw;
    this.pitch = 0;
    this.health = this.maxHealth;
    this.stamina = this.maxStamina;
    this.sinceHurt = 99;
    this.staminaLock = 0;
    this.height = STAND_HEIGHT;
    this.eyeHeight = STAND_HEIGHT - 0.16;
    this.crouching = false;
    this.sprinting = false;
    this.onGround = true;
    this.speed01 = 0;
    this.bobPhase = 0;
    this.stepAccum = 0;
    this.landImpact = 0;
    this.kills = 0;
    this.headshots = 0;
    this.meleeKills = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.arsenal.reset();
  }

  /** Unit forward including pitch. Camera convention: yaw 0 looks down -Z. */
  forward(out: Vec3): Vec3 {
    const cp = Math.cos(this.pitch);
    out.x = -Math.sin(this.yaw) * cp;
    out.y = Math.sin(this.pitch);
    out.z = -Math.cos(this.yaw) * cp;
    return out;
  }

  /** Unit right vector in the horizontal plane. */
  right(out: Vec3): Vec3 {
    out.x = Math.cos(this.yaw);
    out.y = 0;
    out.z = -Math.sin(this.yaw);
    return out;
  }

  takeDamage(amount: number, fromX: number, fromZ: number, events: EventQueue): void {
    if (this.dead) return;
    this.health = Math.max(0, this.health - amount);
    this.sinceHurt = 0;
    // Getting hit costs you your sprint. Being surrounded should feel like
    // losing options, not just losing numbers.
    this.stamina = Math.max(0, this.stamina - 22);
    this.staminaLock = 0.9;
    events.push({ type: 'playerHurt', amount, health: this.health, fromX, fromZ });
    if (this.health <= 0) events.push({ type: 'playerDead' });
  }

  update(dt: number, input: PlayerInput, ctx: MoveContext, events: EventQueue): void {
    this.prev.x = this.pos.x;
    this.prev.y = this.pos.y;
    this.prev.z = this.pos.z;

    this.yaw = input.yaw;
    this.pitch = input.pitch;

    if (this.dead) {
      // Slump: collapse the eye height and bleed off momentum.
      this.eyeHeight = damp(this.eyeHeight, 0.42, 3.5, dt);
      this.vel.x = damp(this.vel.x, 0, 8, dt);
      this.vel.z = damp(this.vel.z, 0, 8, dt);
      moveAndCollide(this.pos, this.vel, this.radius, this.height, dt, ctx);
      return;
    }

    // --- Stance ------------------------------------------------------------
    this.crouching = input.crouch && this.onGround;
    this.height = damp(this.height, this.crouching ? CROUCH_HEIGHT : STAND_HEIGHT, 13, dt);
    this.eyeHeight = this.height - 0.16;

    // --- Stamina -----------------------------------------------------------
    const wishLen = Math.hypot(input.moveX, input.moveZ);
    this.staminaLock = Math.max(0, this.staminaLock - dt);
    const canSprint =
      input.sprint && !this.crouching && wishLen > 0.2 && this.stamina > 1 && this.staminaLock <= 0 && this.arsenal.ads < 0.5;
    this.sprinting = canSprint && this.onGround;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - 24 * dt);
      if (this.stamina <= 0) this.staminaLock = 1.4; // forced breather
    } else {
      this.stamina = Math.min(this.maxStamina, this.stamina + (this.staminaLock > 0 ? 10 : 19) * dt);
    }

    // --- Wish direction in world space -------------------------------------
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    let wx = fx * input.moveZ + rx * input.moveX;
    let wz = fz * input.moveZ + rz * input.moveX;
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-4) {
      wx /= wl;
      wz /= wl;
    }

    let maxSpeed = this.crouching ? CROUCH_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED;
    maxSpeed *= 1 - 0.42 * this.arsenal.ads;
    if (this.arsenal.reloading) maxSpeed *= 0.9;
    const wishSpeed = Math.min(wl, 1) * maxSpeed;

    // --- Friction ----------------------------------------------------------
    if (this.onGround) {
      const speed = Math.hypot(this.vel.x, this.vel.z);
      if (speed > 0.01) {
        const drop = speed * GROUND_FRICTION * dt;
        const scale = Math.max(0, speed - drop) / speed;
        this.vel.x *= scale;
        this.vel.z *= scale;
      } else {
        this.vel.x = 0;
        this.vel.z = 0;
      }
    }

    // --- Acceleration ------------------------------------------------------
    if (wishSpeed > 0.001) {
      const current = this.vel.x * wx + this.vel.z * wz;
      const add = wishSpeed - current;
      if (add > 0) {
        const accel = (this.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt * wishSpeed;
        const applied = Math.min(accel, add);
        this.vel.x += wx * applied;
        this.vel.z += wz * applied;
      }
    }

    // --- Jump --------------------------------------------------------------
    if (input.jump && this.onGround && !this.crouching) {
      this.vel.y = JUMP_VELOCITY;
      this.onGround = false;
      events.push({ type: 'jump' });
    }

    const wasAirborne = !this.onGround;
    const fallSpeed = this.vel.y;

    const res = moveAndCollide(this.pos, this.vel, this.radius, this.height, dt, ctx);
    this.onGround = res.onGround;

    if (wasAirborne && this.onGround && fallSpeed < -3) {
      this.landImpact = clamp01(-fallSpeed / 14);
      events.push({ type: 'land', force: this.landImpact });
    } else {
      this.landImpact = damp(this.landImpact, 0, 7, dt);
    }

    // --- Bob and footsteps, driven by distance travelled -------------------
    const planar = Math.hypot(this.vel.x, this.vel.z);
    this.speed01 = clamp01(planar / SPRINT_SPEED);
    if (this.onGround) {
      const travelled = planar * dt;
      this.bobPhase += travelled * 2.05;
      this.stepAccum += travelled;
      const stride = this.crouching ? 1.35 : this.sprinting ? 2.15 : 1.75;
      if (this.stepAccum >= stride) {
        this.stepAccum = 0;
        events.push({ type: 'footstep', x: this.pos.x, y: this.pos.y, z: this.pos.z, sprint: this.sprinting });
      }
    }

    // --- Health regeneration ----------------------------------------------
    this.sinceHurt += dt;
    if (this.sinceHurt > 5.5 && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + 15 * dt);
    }

    // --- Weapons -----------------------------------------------------------
    this.arsenal.update(
      dt,
      {
        fire: input.fire,
        firePressed: input.firePressed,
        ads: input.ads,
        reload: input.reload,
        melee: input.melee,
        switchTo: input.switchTo,
        cycle: input.cycle,
      },
      events,
    );
  }

  static get stepHeight(): number {
    return STEP_HEIGHT;
  }
}
