import * as THREE from 'three';
import type { WeaponId } from '../types';
import type { Arsenal } from '../game/weapons/Arsenal';
import type { WeaponSpec } from '../content/weapons.data';
import type { Player } from '../game/Player';
import type { MaterialLib } from '../procgen/textures/materials';
import type { SpriteLib } from '../procgen/textures/sprites';
import { createWeaponModels, type WeaponModel, type WeaponModels } from '../procgen/WeaponFactory';
import { clamp, clamp01, damp, lerp } from '../util/vec';

/**
 * The first-person hands.
 *
 * The whole viewmodel rig is parented to the camera, so everything in here works
 * in camera space and needs no world transforms at all. It sits inside the
 * camera's near plane (0.05m), which is why it never clips against the world
 * geometry it is standing in front of - and why it does not need the separate
 * overlay render pass a second camera would cost.
 *
 * Nothing here affects the simulation. Every value is presentation: the weapon
 * that shoots is `Arsenal`, and it does not know this file exists. That means
 * viewmodel animation can run at render rate (smooth on a 144Hz display) while
 * the shot that actually fired was resolved at a fixed 60Hz.
 */

interface Spring {
  value: number;
  vel: number;
}

const _v = new THREE.Vector3();
const _e = new THREE.Euler();

function spring(s: Spring, target: number, stiffness: number, damping: number, dt: number): void {
  s.vel += (-(s.value - target) * stiffness - s.vel * damping) * dt;
  s.value += s.vel * dt;
}

export class ViewModel {
  readonly root = new THREE.Group();

  private readonly models: WeaponModels;
  private readonly order: WeaponId[] = ['sidewinder', 'hornet', 'breaker', 'fang'];

  private held: WeaponId = 'sidewinder';
  /** True while a quick-melee swing is showing the knife over the held weapon. */
  private showingKnife = false;

  // --- Animation state ---------------------------------------------------
  private readonly kick: Spring = { value: 0, vel: 0 };
  private readonly kickPitch: Spring = { value: 0, vel: 0 };
  private swayX = 0;
  private swayY = 0;
  private lagX = 0;
  private lagY = 0;
  private strafeRoll = 0;
  private bobPhase = 0;
  private lower = 0;
  private adsBlend = 0;

  /** 0-1 through the current action cycle (slide / handle / pump). */
  private actionT = 0;
  private actionDur = 0.085;
  private magDrop = 0;
  private meleeT = 0;
  private meleeDur = 0.001;

  // --- Muzzle flash ------------------------------------------------------
  private readonly flash: THREE.Mesh;
  private readonly flashLight: THREE.PointLight;
  private flashT = 0;
  private flashLife = 0.055;

  constructor(lib: MaterialLib, sprites: SpriteLib) {
    this.root.name = 'viewmodel';
    this.models = createWeaponModels(lib);

    for (const id of this.order) {
      const m = this.models[id];
      m.group.visible = id === 'sidewinder';
      // Nothing in the viewmodel is ever culled: it is always on screen, and a
      // bounding-sphere test on 4 groups every frame is pure waste.
      m.group.traverse((o) => {
        o.frustumCulled = false;
      });
      this.root.add(m.group);
    }

    // Additive flash quad, re-parented to whichever muzzle is current.
    const flashMat = new THREE.MeshBasicMaterial({
      map: sprites.muzzleFlash,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flashMat);
    this.flash.frustumCulled = false;
    this.flash.renderOrder = 20;
    this.flash.visible = false;
    this.models.sidewinder.muzzle.add(this.flash);

    /**
     * The muzzle light is created ONCE, here, and left in the graph forever at
     * zero intensity. Adding a light on fire and removing it after would change
     * `numPointLights`, which is baked into every compiled material - i.e. a
     * full shader recompile on the first shot of every burst. Same trap as
     * LightPool, same fix: keep the count constant, animate the intensity.
     */
    this.flashLight = new THREE.PointLight(0xffc98a, 0, 13, 2);
    this.flashLight.castShadow = false;
    this.root.add(this.flashLight);
  }

  /** Parent the rig to the camera. Camera must itself be in the scene. */
  attach(camera: THREE.Camera): void {
    camera.add(this.root);
  }

  private model(id: WeaponId): WeaponModel {
    return this.models[id];
  }

  private get visibleModel(): WeaponModel {
    return this.model(this.showingKnife ? 'fang' : this.held);
  }

  private setVisible(id: WeaponId): void {
    for (const other of this.order) this.models[other].group.visible = other === id;
    // Move the flash quad with the weapon so it always sits on the real muzzle.
    const muzzle = this.models[id].muzzle;
    if (this.flash.parent !== muzzle) muzzle.add(this.flash);
  }

  reset(held: WeaponId = 'sidewinder'): void {
    this.held = held;
    this.showingKnife = false;
    this.kick.value = 0;
    this.kick.vel = 0;
    this.kickPitch.value = 0;
    this.kickPitch.vel = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.lagX = 0;
    this.lagY = 0;
    this.strafeRoll = 0;
    this.bobPhase = 0;
    this.lower = 0;
    this.adsBlend = 0;
    this.actionT = 0;
    this.magDrop = 0;
    this.meleeT = 0;
    this.flashT = 0;
    this.flash.visible = false;
    this.flashLight.intensity = 0;
    this.setVisible(held);
  }

  // -----------------------------------------------------------------------
  // Triggers, called from the engine's event drain
  // -----------------------------------------------------------------------

  onShot(spec: WeaponSpec): void {
    // Recoil is a spring impulse, not a keyframed animation, so rapid fire
    // stacks correctly instead of restarting from zero every shot.
    this.kick.vel += spec.kick * 46;
    this.kickPitch.vel += spec.recoilPitch * 34;
    this.actionDur = spec.mode === 'pump' ? 0.11 : Math.max(0.045, Math.min(0.1, 30 / spec.rpm));
    this.actionT = 1;
    this.flashT = this.flashLife;
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    const s = 0.34 + Math.random() * 0.16 + (spec.pellets > 1 ? 0.22 : 0);
    this.flash.scale.set(s, s, s);
    this.flash.visible = true;
  }

  onDryfire(): void {
    this.kick.vel += 0.4;
  }

  onPump(): void {
    this.actionDur = 0.26;
    this.actionT = 1;
  }

  onReloadStart(duration: number): void {
    this.magDrop = Math.max(0.001, duration);
  }

  onMelee(duration: number): void {
    this.meleeDur = Math.max(0.001, duration);
    this.meleeT = this.meleeDur;
    this.showingKnife = true;
    this.setVisible('fang');
  }

  onSwitch(next: WeaponId): void {
    // Dip the model out of frame; the swap itself happens at the bottom, driven
    // by Arsenal.current, so the visual and the simulation cannot disagree.
    this.lower = 1;
    void next;
  }

  /** World-space muzzle position, for FX spawning. */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.visibleModel.muzzle.getWorldPosition(out);
  }

  /** World-space camera-right vector, for casing ejection direction. */
  ejectRight(camera: THREE.Camera, out: THREE.Vector3): THREE.Vector3 {
    return out.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  }

  // -----------------------------------------------------------------------
  // Per-frame update (render rate, NOT sim rate)
  // -----------------------------------------------------------------------

  update(dt: number, arsenal: Arsenal, player: Player, lookDX: number, lookDY: number): void {
    const spec = arsenal.spec;

    // --- Melee window ----------------------------------------------------
    if (this.meleeT > 0) {
      this.meleeT = Math.max(0, this.meleeT - dt);
      if (this.meleeT === 0) {
        this.showingKnife = false;
        this.setVisible(this.held);
      }
    }

    // --- Weapon swap: follow Arsenal, dip on change -----------------------
    if (!this.showingKnife && arsenal.current !== this.held) {
      this.held = arsenal.current;
      this.setVisible(this.held);
      this.lower = Math.max(this.lower, 0.8);
    }
    // Lower while switching, reloading a shotgun, or sprinting hard.
    const wantLower = arsenal.switchT > 0 ? 1 : player.sprinting ? 0.35 : 0;
    this.lower = damp(this.lower, wantLower, 9, dt);

    // --- Springs ---------------------------------------------------------
    spring(this.kick, 0, 210, 20, dt);
    spring(this.kickPitch, 0, 190, 18, dt);

    // --- Look lag ---------------------------------------------------------
    // The gun trails the camera slightly. This is the single cheapest thing you
    // can do to stop a viewmodel feeling glued to the screen.
    this.lagX = damp(this.lagX, clamp(-lookDX * 0.0022, -0.05, 0.05), 9, dt);
    this.lagY = damp(this.lagY, clamp(-lookDY * 0.0018, -0.04, 0.04), 9, dt);

    // --- Idle sway + bob --------------------------------------------------
    // Bob is driven by the player's distance-based phase, exactly like the
    // camera and the footsteps, so all three stay locked together.
    const moving = player.speed01;
    this.bobPhase = player.bobPhase;
    const bobAmp = moving * (player.crouching ? 0.45 : 1) * (1 - 0.75 * this.adsBlend);
    const idle = performance.now() * 0.001;
    this.swayX = damp(this.swayX, Math.sin(this.bobPhase) * 0.012 * bobAmp + Math.sin(idle * 0.7) * 0.0035, 12, dt);
    this.swayY = damp(this.swayY, Math.abs(Math.cos(this.bobPhase)) * 0.014 * bobAmp + Math.sin(idle * 0.53) * 0.003, 12, dt);
    this.strafeRoll = damp(this.strafeRoll, clamp(-player.vel.x * 0.004 + player.vel.z * 0.001, -0.05, 0.05), 8, dt);

    // --- ADS --------------------------------------------------------------
    this.adsBlend = arsenal.ads;

    // --- Action cycle (slide / charging handle / pump) --------------------
    const m = this.visibleModel;
    if (this.actionT > 0) {
      this.actionT = Math.max(0, this.actionT - dt / this.actionDur);
      if (m.action) {
        // Triangle profile: snap rearward, return a little slower.
        const t = this.actionT;
        const travel = t > 0.5 ? (1 - t) * 2 : t * 2;
        m.action.position.z = m.actionTravel * travel;
      }
    } else if (m.action && m.action.position.z !== 0) {
      m.action.position.z = 0;
    }

    // --- Reload: drop and reseat the magazine ----------------------------
    if (m.magazine) {
      let drop = 0;
      let tilt = 0;
      if (arsenal.reloading) {
        const p = arsenal.reloadProgress;
        // Out fast, hold, back in at the end.
        drop = p < 0.45 ? p / 0.45 : p < 0.72 ? 1 : 1 - (p - 0.72) / 0.28;
        tilt = drop * 0.5;
      }
      m.magazine.position.y = -0.13 * drop;
      m.magazine.rotation.x = tilt * 0.6;
    }

    // --- Compose the final transform --------------------------------------
    const restP = m.restPosition;
    const adsP = m.adsPosition;
    const a = this.adsBlend;

    // Reload also drags the whole weapon down and inward.
    const reloadDip = arsenal.reloading ? Math.sin(arsenal.reloadProgress * Math.PI) : 0;

    // Melee: a committed arc across the screen. Wind up, strike, recover.
    let meleeX = 0;
    let meleeY = 0;
    let meleeZ = 0;
    let meleeYaw = 0;
    let meleePitch = 0;
    let meleeRoll = 0;
    if (this.meleeT > 0) {
      const p = 1 - this.meleeT / this.meleeDur; // 0 -> 1
      const windup = clamp01(p / 0.32);
      const strike = clamp01((p - 0.32) / 0.3);
      const recover = clamp01((p - 0.62) / 0.38);
      const swing = windup - strike * 1.9 + recover * 0.9;
      meleeX = swing * 0.34;
      meleeY = -0.06 + windup * 0.1 - strike * 0.14;
      meleeZ = 0.1 - strike * 0.26 + recover * 0.16;
      meleeYaw = swing * 1.15;
      meleePitch = windup * 0.35 - strike * 0.55;
      meleeRoll = -swing * 0.8;
    }

    this.root.position.set(0, 0, 0);

    const px = lerp(restP.x, adsP.x, a) + this.swayX + this.lagX + meleeX;
    const py = lerp(restP.y, adsP.y, a) + this.swayY + this.lagY - this.lower * 0.34 - reloadDip * 0.05 + meleeY;
    const pz = lerp(restP.z, adsP.z, a) + this.kick.value + meleeZ;

    m.group.position.set(px, py, pz);

    const rr = m.restRotation;
    const ar = m.adsRotation;
    _e.set(
      lerp(rr.x, ar.x, a) + this.kickPitch.value + this.lagY * 1.6 - this.lower * 0.5 - reloadDip * 0.28 + meleePitch,
      lerp(rr.y, ar.y, a) + this.lagX * 2.2 + meleeYaw,
      lerp(rr.z, ar.z, a) + this.strafeRoll + this.lower * 0.22 + reloadDip * 0.2 + meleeRoll,
    );
    m.group.rotation.copy(_e);

    // --- Muzzle flash decay -----------------------------------------------
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      const k = this.flashT / this.flashLife;
      const mat = this.flash.material as THREE.MeshBasicMaterial;
      mat.opacity = k;
      this.flash.visible = k > 0.02;
      // The flash is a real light source for a few milliseconds. On a dark map
      // this does more for the feel of shooting than the sprite does.
      m.muzzle.getWorldPosition(_v);
      this.root.worldToLocal(_v);
      this.flashLight.position.copy(_v);
      this.flashLight.intensity = k * k * (spec.pellets > 1 ? 26 : 15);
    } else if (this.flashLight.intensity !== 0) {
      this.flashLight.intensity = 0;
      this.flash.visible = false;
    }
  }

  dispose(): void {
    for (const id of this.order) {
      const m = this.models[id];
      m.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      m.group.removeFromParent();
    }
    this.flash.geometry.dispose();
    (this.flash.material as THREE.Material).dispose();
    this.flashLight.dispose();
    this.root.removeFromParent();
  }
}
