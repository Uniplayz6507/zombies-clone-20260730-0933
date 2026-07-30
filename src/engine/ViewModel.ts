import * as THREE from 'three';
import type { WeaponId } from '../types';
import type { Arsenal } from '../game/weapons/Arsenal';
import type { Player } from '../game/Player';
import type { MaterialLib } from '../procgen/textures/materials';
import type { SpriteLib } from '../procgen/textures/sprites';
import { createWeaponModels, type WeaponModel, type WeaponModels } from '../procgen/WeaponFactory';
import type { Fx } from './Fx';
import { clamp01, damp, lerp } from '../util/vec';

/**
 * The weapon in your hands.
 *
 * Parented directly to the camera rather than rendered in a separate overlay
 * pass. With a 5cm near plane and the model kept inside ~0.6m, it never clips
 * geometry unless you physically press into a wall - and a second render pass
 * would not survive the post chain cleanly. (Known trade-off, documented in the
 * README.)
 *
 * Lighting: the gunmetal, polymer and timber materials are weapon-exclusive, so
 * their envMapIntensity is pushed up here. That gets a well-lit weapon out of the
 * PMREM environment alone, without a dedicated viewmodel light adding to the
 * global point-light count (and therefore to every material's shader cost).
 *
 * The muzzle flash light IS real and permanent (intensity 0 at rest) because
 * having your shots light up the alley is worth one light slot.
 */

const _v = new THREE.Vector3();

export class ViewModel {
  private readonly root = new THREE.Group();
  private readonly models: WeaponModels;
  private current: WeaponId = 'sidewinder';
  private shown: WeaponModel;

  // --- Sway and bob -------------------------------------------------------
  private swayX = 0;
  private swayY = 0;
  private bobX = 0;
  private bobY = 0;

  // --- Recoil springs -----------------------------------------------------
  private kickZ = 0;
  private kickVelZ = 0;
  private kickPitch = 0;
  private kickVelPitch = 0;
  private kickRoll = 0;

  // --- Action cycle -------------------------------------------------------
  /** 1 -> 0 over the cycle. Drives the slide/bolt/pump travel. */
  private actionT = 0;
  private actionSpeed = 12;

  // --- Muzzle flash -------------------------------------------------------
  private readonly flashSprite: THREE.Sprite;
  private readonly flashLight: THREE.PointLight;
  private flashT = 0;
  private flashRoll = 0;

  private adsBlend = 0;

  constructor(
    camera: THREE.Camera,
    scene: THREE.Object3D,
    private readonly lib: MaterialLib,
    sprites: SpriteLib,
    private readonly fx: Fx,
  ) {
    this.models = createWeaponModels(lib);

    // Weapon-only materials, so we can crank their environment response without
    // affecting anything in the world.
    for (const m of [lib.gunmetal, lib.gunSteelBright, lib.gunPolymer, lib.gunWood]) {
      m.envMapIntensity = 1.85;
    }

    this.root.name = 'viewmodel';
    // Drawn after the world so it always sits on top of transparent FX.
    this.root.renderOrder = 10;
    camera.add(this.root);

    for (const id of Object.keys(this.models) as WeaponId[]) {
      const model = this.models[id];
      model.group.visible = false;
      this.root.add(model.group);
    }
    this.shown = this.models.sidewinder;
    this.shown.group.visible = true;

    // Muzzle flash: an additive billboard for the shape, and a real light for
    // the effect it has on the street.
    const flashMat = new THREE.SpriteMaterial({
      map: sprites.muzzleFlash,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
      opacity: 0,
    });
    this.flashSprite = new THREE.Sprite(flashMat);
    this.flashSprite.scale.setScalar(0.001);
    this.flashSprite.renderOrder = 12;
    this.root.add(this.flashSprite);

    this.flashLight = new THREE.PointLight(0xffc07a, 0, 14, 2);
    this.flashLight.castShadow = false;
    // Parented to the scene, not the camera, so it lights the world from where
    // the muzzle actually is.
    scene.add(this.flashLight);
  }

  /** Which model is currently drawn - the held gun, or the knife mid-swing. */
  private resolveModel(arsenal: Arsenal): WeaponId {
    return arsenal.meleeT > 0 ? 'fang' : arsenal.current;
  }

  private show(id: WeaponId): void {
    if (id === this.current) return;
    this.shown.group.visible = false;
    this.current = id;
    this.shown = this.models[id];
    this.shown.group.visible = true;
  }

  /** Called on every shot. */
  onShot(weapon: WeaponId, recoilPitch: number, kick: number, pump: boolean): void {
    this.kickVelZ += kick * 34;
    this.kickVelPitch += recoilPitch * 30;
    this.kickRoll += (Math.random() - 0.5) * kick * 3;
    this.actionT = 1;
    // A pump cycles slowly and deliberately; a slide snaps.
    this.actionSpeed = pump ? 4.2 : 15;
    this.flashT = 1;
    this.flashRoll = Math.random() * Math.PI * 2;

    // Eject a case, thrown along the camera's right vector.
    const model = this.models[weapon];
    model.ejectPort.getWorldPosition(_v);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()));
    this.fx.ejectCasing(_v.x, _v.y, _v.z, right.x, right.z);

    model.muzzle.getWorldPosition(_v);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()));
    this.fx.muzzleDebris(_v.x, _v.y, _v.z, fwd.x, fwd.y, fwd.z);
  }

  /** Manual pump cycle at the end of a shotgun shot. */
  onPump(): void {
    this.actionT = 1;
    this.actionSpeed = 5.5;
  }

  /** Feed raw mouse movement in so the weapon lags behind your aim. */
  addLook(dx: number, dy: number): void {
    // Clamped so a fast flick does not fling the model off screen.
    this.swayX += Math.max(-40, Math.min(40, dx)) * 0.00035;
    this.swayY += Math.max(-40, Math.min(40, dy)) * 0.00035;
  }

  update(dt: number, player: Player, arsenal: Arsenal): void {
    this.show(this.resolveModel(arsenal));
    const model = this.shown;
    this.adsBlend = arsenal.ads;

    // --- Springs ----------------------------------------------------------
    const stiff = 160;
    const damping = 19;
    this.kickVelZ += (-this.kickZ * stiff - this.kickVelZ * damping) * dt;
    this.kickZ += this.kickVelZ * dt;
    this.kickVelPitch += (-this.kickPitch * stiff - this.kickVelPitch * damping) * dt;
    this.kickPitch += this.kickVelPitch * dt;
    this.kickRoll = damp(this.kickRoll, 0, 8, dt);

    // --- Sway decays back to centre ---------------------------------------
    this.swayX = damp(this.swayX, 0, 7, dt);
    this.swayY = damp(this.swayY, 0, 7, dt);

    // --- Bob, from the player's travelled distance ------------------------
    const bobAmount = player.speed01 * (1 - 0.75 * this.adsBlend) * (player.crouching ? 0.5 : 1);
    this.bobX = damp(this.bobX, Math.sin(player.bobPhase) * 0.022 * bobAmount, 11, dt);
    this.bobY = damp(this.bobY, Math.abs(Math.cos(player.bobPhase)) * 0.018 * bobAmount, 11, dt);

    // --- Base pose: rest -> ADS -------------------------------------------
    const a = this.adsBlend;
    let px = lerp(model.restPosition.x, model.adsPosition.x, a);
    let py = lerp(model.restPosition.y, model.adsPosition.y, a);
    let pz = lerp(model.restPosition.z, model.adsPosition.z, a);
    let rx = lerp(model.restRotation.x, model.adsRotation.x, a);
    let ry = lerp(model.restRotation.y, model.adsRotation.y, a);
    let rz = lerp(model.restRotation.z, model.adsRotation.z, a);

    // --- Reload: tip the weapon down and out of the sight line ------------
    if (arsenal.reloadT > 0 && arsenal.meleeT <= 0) {
      const p = arsenal.reloadProgress;
      // Down fast, hold, back up fast. sin gives that shape for free.
      const swing = Math.sin(clamp01(p) * Math.PI);
      py -= swing * 0.14;
      px += swing * 0.05;
      rx += swing * 0.75;
      rz -= swing * 0.35;
      if (model.magazine) {
        // Magazine drops out in the first third, new one seats in the last.
        const drop = p < 0.42 ? p / 0.42 : p > 0.66 ? 1 - (p - 0.66) / 0.34 : 1;
        model.magazine.position.y = -drop * 0.22;
        model.magazine.position.z = drop * 0.03;
      }
    } else if (model.magazine) {
      model.magazine.position.set(0, 0, 0);
    }

    // --- Weapon swap: dip out of frame and back ---------------------------
    if (arsenal.switchT > 0) {
      const t = 1 - Math.abs(arsenal.switchT / 0.42 - 0.5) * 2; // 0 -> 1 -> 0
      py -= t * 0.3;
      rx += t * 1.1;
    }

    // --- Melee swing ------------------------------------------------------
    if (arsenal.meleeT > 0) {
      const total = 60 / 96; // Trench Fang cycle, matches the weapon spec
      const p = clamp01(1 - arsenal.meleeT / total);
      // Wind back, then slash left-to-right across the screen.
      const windup = clamp01(p / 0.35);
      const slash = clamp01((p - 0.35) / 0.4);
      const recover = clamp01((p - 0.75) / 0.25);
      px += lerp(0.1, -0.34, slash) * (1 - recover) + windup * 0.06;
      py += lerp(-0.04, 0.1, slash) * (1 - recover);
      pz += lerp(0.05, -0.24, slash) * (1 - recover);
      ry += lerp(0.5, -0.9, slash) * (1 - recover);
      rz += lerp(0.6, -1.5, slash) * (1 - recover);
      rx += windup * 0.4 - slash * 0.5;
    }

    // --- Compose ----------------------------------------------------------
    this.root.position.set(
      px + this.swayX + this.bobX,
      py + this.swayY + this.bobY - player.landImpact * 0.05,
      pz + this.kickZ,
    );
    this.root.rotation.set(
      rx + this.kickPitch - this.swayY * 1.6,
      ry - this.swayX * 1.9,
      rz + this.kickRoll * 0.4 + this.swayX * 0.9,
    );

    // --- Action travel ----------------------------------------------------
    if (model.action) {
      this.actionT = Math.max(0, this.actionT - dt * this.actionSpeed);
      // Rearward snap with a softer return, which is what a real cycle looks like.
      const travel = Math.sin(clamp01(this.actionT) * Math.PI * 0.5) * model.actionTravel;
      model.action.position.z = travel;
    }

    // --- Muzzle flash -----------------------------------------------------
    this.flashT = Math.max(0, this.flashT - dt * 22);
    const flashMat = this.flashSprite.material as THREE.SpriteMaterial;
    if (this.flashT > 0.01) {
      model.muzzle.getWorldPosition(_v);
      this.flashLight.position.copy(_v);
      // Flicker the intensity so two consecutive shots never look identical.
      this.flashLight.intensity = this.flashT * this.flashT * 190 * (0.75 + Math.random() * 0.5);

      this.flashSprite.position.copy(model.muzzle.position);
      const scale = 0.24 + (1 - this.flashT) * 0.1;
      this.flashSprite.scale.setScalar(scale * (0.8 + Math.random() * 0.4));
      this.flashSprite.material.rotation = this.flashRoll;
      flashMat.opacity = this.flashT;
      this.flashSprite.visible = true;
    } else {
      this.flashLight.intensity = 0;
      this.flashSprite.visible = false;
      flashMat.opacity = 0;
    }
  }

  /** Hide everything (menu, game over). */
  setVisible(v: boolean): void {
    this.root.visible = v;
    if (!v) {
      this.flashLight.intensity = 0;
      this.flashSprite.visible = false;
    }
  }

  reset(): void {
    this.swayX = 0;
    this.swayY = 0;
    this.bobX = 0;
    this.bobY = 0;
    this.kickZ = 0;
    this.kickVelZ = 0;
    this.kickPitch = 0;
    this.kickVelPitch = 0;
    this.kickRoll = 0;
    this.actionT = 0;
    this.flashT = 0;
    this.show('sidewinder');
  }

  /** Every mesh in every viewmodel, for the shader warm-up pass. */
  allObjects(): THREE.Object3D[] {
    return Object.values(this.models).map((m) => m.group);
  }

  dispose(): void {
    for (const model of Object.values(this.models)) {
      model.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      model.group.removeFromParent();
    }
    (this.flashSprite.material as THREE.Material).dispose();
    this.flashSprite.removeFromParent();
    this.flashLight.removeFromParent();
    this.flashLight.dispose();
    this.root.removeFromParent();
    void this.lib;
  }
}
