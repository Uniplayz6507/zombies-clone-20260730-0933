import * as THREE from 'three';
import { clamp, clamp01, damp } from '../util/vec';
import type { Player } from '../game/Player';

/**
 * First-person camera.
 *
 * Deliberately NOT part of the fixed 60Hz simulation. Mouse-look is sampled and
 * applied at render rate, so aiming feels native on a 144Hz display instead of
 * quantised into 60 steps a second. Only things that affect gameplay - position,
 * collision - live in the fixed step.
 *
 * Everything else here is feel: distance-driven headbob, spring recoil, a landing
 * dip, ADS field of view, and a directional kick when you get hit.
 */

const BASE_FOV = 76;
const ADS_FOV = 54;
const SPRINT_FOV_BOOST = 4;
const PITCH_LIMIT = Math.PI / 2 - 0.02;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;

  yaw = 0;
  pitch = 0;

  private recoilPitch = 0;
  private recoilYaw = 0;
  private recoilVelPitch = 0;
  private recoilVelYaw = 0;

  private kickPitch = 0;
  private kickRoll = 0;

  private bobX = 0;
  private bobY = 0;
  private bobRoll = 0;
  private landDip = 0;
  private fov = BASE_FOV;
  private shake = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 220);
    // YXZ is mandatory for an FPS camera: yaw then pitch, so looking up can
    // never introduce roll.
    this.camera.rotation.order = 'YXZ';
  }

  reset(yaw: number): void {
    this.yaw = yaw;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.recoilVelPitch = 0;
    this.recoilVelYaw = 0;
    this.kickPitch = 0;
    this.kickRoll = 0;
    this.bobX = 0;
    this.bobY = 0;
    this.bobRoll = 0;
    this.landDip = 0;
    this.shake = 0;
    this.fov = BASE_FOV;
    this.camera.fov = BASE_FOV;
    this.camera.updateProjectionMatrix();
  }

  /** Apply raw mouse deltas. Called once per rendered frame. */
  look(dx: number, dy: number, sensitivity: number, invertY: boolean, adsBlend: number): void {
    // Reduce sensitivity in proportion to the FOV change. That is what keeps
    // *angular* sensitivity constant; doing it any other way makes aiming feel
    // either sluggish or twitchy the moment you press right-click.
    const zoomComp = 1 - 0.45 * adsBlend;
    const s = 0.0022 * sensitivity * zoomComp;
    this.yaw -= dx * s;
    this.pitch -= dy * s * (invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  addRecoil(pitch: number, yaw: number): void {
    this.recoilVelPitch += pitch * 26;
    this.recoilVelYaw += yaw * 26 * (Math.random() < 0.5 ? -1 : 1);
    this.shake = Math.min(1, this.shake + pitch * 4);
  }

  /** Getting hit throws the view away from the attacker. */
  addHit(amount: number, fromDirDot: number, fromSideDot: number): void {
    const k = clamp01(amount / 45);
    this.kickPitch -= k * 0.16 * fromDirDot;
    this.kickRoll += k * 0.2 * fromSideDot;
    this.shake = Math.min(1.4, this.shake + k * 0.8);
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.6, this.shake + amount);
  }

  /**
   * `alpha` is the fixed-step interpolation factor, so the camera renders
   * *between* simulation states instead of snapping to them.
   */
  update(dt: number, player: Player, alpha: number, adsBlend: number): void {
    // --- Recoil spring: snaps up hard, settles without ringing -------------
    const stiffness = 190;
    const damping = 22;
    this.recoilVelPitch += (-this.recoilPitch * stiffness - this.recoilVelPitch * damping) * dt;
    this.recoilVelYaw += (-this.recoilYaw * stiffness - this.recoilVelYaw * damping) * dt;
    this.recoilPitch += this.recoilVelPitch * dt;
    this.recoilYaw += this.recoilVelYaw * dt;

    this.kickPitch = damp(this.kickPitch, 0, 6, dt);
    this.kickRoll = damp(this.kickRoll, 0, 5, dt);
    this.shake = damp(this.shake, 0, 7, dt);

    // --- Headbob, driven by distance travelled ----------------------------
    // Phase comes from the player's accumulated travel, so bob can never desync
    // from the footstep sounds regardless of what the framerate does.
    const bobAmount = player.speed01 * (player.crouching ? 0.4 : 1) * (1 - 0.7 * adsBlend);
    const ph = player.bobPhase;
    this.bobX = damp(this.bobX, Math.sin(ph) * 0.035 * bobAmount, 12, dt);
    this.bobY = damp(this.bobY, Math.abs(Math.cos(ph)) * 0.028 * bobAmount, 12, dt);
    this.bobRoll = damp(this.bobRoll, Math.sin(ph) * 0.014 * bobAmount, 10, dt);
    this.landDip = damp(this.landDip, player.landImpact * 0.16, 14, dt);

    // --- Field of view ----------------------------------------------------
    const targetFov = BASE_FOV + (player.sprinting ? SPRINT_FOV_BOOST : 0) + (ADS_FOV - BASE_FOV) * adsBlend;
    this.fov = damp(this.fov, targetFov, 11, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // --- Position: interpolate between simulation states -------------------
    const px = player.prev.x + (player.pos.x - player.prev.x) * alpha;
    const py = player.prev.y + (player.pos.y - player.prev.y) * alpha;
    const pz = player.prev.z + (player.pos.z - player.prev.z) * alpha;

    const sh = this.shake;
    const shakeX = sh * 0.012 * (Math.random() - 0.5);
    const shakeY = sh * 0.012 * (Math.random() - 0.5);

    // Bob is applied along the view's right vector so it swings with your aim.
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    this.camera.position.set(
      px + rightX * this.bobX + shakeX,
      py + player.eyeHeight + this.bobY - this.landDip + shakeY,
      pz + rightZ * this.bobX,
    );

    this.camera.rotation.set(
      this.pitch + this.recoilPitch + this.kickPitch,
      this.yaw + this.recoilYaw,
      this.bobRoll + this.kickRoll + sh * 0.01 * (Math.random() - 0.5),
    );
  }

  /** Slow crane move used behind the main menu. */
  menuUpdate(t: number): void {
    this.camera.fov = 46;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(-4 + Math.sin(t * 0.06) * 5.2, 4.2 + Math.sin(t * 0.04) * 0.7, 2 + Math.cos(t * 0.06) * 4.5);
    this.camera.rotation.set(0, 0, 0);
    this.camera.lookAt(2 + Math.sin(t * 0.05) * 3, 1.5, -1);
  }
}
