import * as THREE from 'three';
import type { Zombie } from '../game/Zombie';
import type { MaterialLib } from '../procgen/textures/materials';
import type { SpriteLib } from '../procgen/textures/sprites';
import { createZombieAsset, MODEL_HEIGHT, poseZombie, type ZombieAsset, type ZombieInstance } from '../procgen/ZombieFactory';
import { clamp01, damp } from '../util/vec';

/**
 * Draws the horde.
 *
 * Every cost-control idea from ARCHITECTURE.md section 4 lives here:
 *
 *  - ONE shared geometry and ONE shared skin-weight solve across all instances.
 *  - Per-slot cloned materials, so a hit flash is per-zombie. Cloning a material
 *    changes uniforms, not shader parameters, so all 24 still share a single
 *    compiled program.
 *  - A strict animation budget. The nearest N zombies pose every frame, mid-range
 *    every second frame, distant ones every fourth. Off-screen zombies are not
 *    posed at all, and Three skips their skeleton update because the mesh is
 *    frustum culled.
 *  - Instanced blob contact shadows instead of real shadow casting from a second
 *    light, which would double the cost of the shadow pass.
 */

/** Matches the simulation's zombie pool, so a slot is always available. */
const CAPACITY = 24;

interface Slot {
  inst: ZombieInstance;
  skinMat: THREE.MeshStandardMaterial;
  clothMat: THREE.MeshStandardMaterial;
  zombie: Zombie | null;
  /** Frames since this slot was last posed. */
  since: number;
  flash: number;
}

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _flat = new THREE.Euler(-Math.PI / 2, 0, 0);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0).setPosition(0, -1000, 0);

export class ZombieRenderer {
  private readonly asset: ZombieAsset;
  private readonly slots: Slot[] = [];
  private readonly root = new THREE.Group();
  private readonly shadows: THREE.InstancedMesh;
  private readonly order: { slot: number; d2: number }[] = [];

  readonly trianglesEach: number;

  constructor(scene: THREE.Object3D, lib: MaterialLib, sprites: SpriteLib) {
    this.asset = createZombieAsset();
    this.trianglesEach = this.asset.triangles;
    this.root.name = 'horde';
    scene.add(this.root);

    for (let i = 0; i < CAPACITY; i++) {
      // Rotate through the three skin and clothing variants so the horde does
      // not read as clones even before per-instance colour drift.
      const skinMat = lib.skin[i % lib.skin.length].clone() as THREE.MeshStandardMaterial;
      const clothMat = lib.cloth[i % lib.cloth.length].clone() as THREE.MeshStandardMaterial;
      skinMat.color.multiplyScalar(0.9 + ((i * 37) % 13) / 60);
      clothMat.color.multiplyScalar(0.92 + ((i * 53) % 11) / 70);
      skinMat.emissive = new THREE.Color(0x000000);
      skinMat.emissiveIntensity = 0;

      const inst = this.asset.instance(skinMat, clothMat);
      inst.group.visible = false;
      this.root.add(inst.group);
      this.slots.push({ inst, skinMat, clothMat, zombie: null, since: 99, flash: 0 });
      this.order.push({ slot: i, d2: 0 });
    }

    // Fake contact shadows. Real shadow casting for 16 characters from a second
    // light would be another full scene pass; this is one instanced quad.
    const shadowGeo = new THREE.PlaneGeometry(1, 1);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: sprites.blobShadow,
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
      color: 0x000000,
    });
    this.shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, CAPACITY);
    this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    this.root.add(this.shadows);
  }

  /** Release every slot. Called when a run restarts. */
  clear(): void {
    for (const s of this.slots) {
      s.zombie = null;
      s.inst.group.visible = false;
      s.flash = 0;
    }
    for (let i = 0; i < CAPACITY; i++) this.shadows.setMatrixAt(i, HIDDEN);
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  /**
   * Reconcile render slots with simulation state, then pose and place.
   * `alpha` interpolates between fixed simulation steps.
   */
  sync(dt: number, zombies: readonly Zombie[], alpha: number, camera: THREE.Camera, animBudget: number): void {
    // --- Release slots whose zombie went inactive --------------------------
    for (const slot of this.slots) {
      if (slot.zombie && (!slot.zombie.active || slot.zombie.renderSlot < 0)) {
        slot.zombie = null;
        slot.inst.group.visible = false;
      }
    }

    // --- Claim slots for newly spawned zombies ----------------------------
    for (const z of zombies) {
      if (!z.active || z.renderSlot >= 0) continue;
      let free = -1;
      for (let i = 0; i < this.slots.length; i++) {
        if (this.slots[i].zombie === null) {
          free = i;
          break;
        }
      }
      if (free < 0) continue; // pool sizes match, so this should never happen
      const slot = this.slots[free];
      slot.zombie = z;
      slot.since = 99;
      slot.flash = 0;
      slot.inst.group.visible = true;
      z.renderSlot = free;
    }

    // --- Rank by distance so the animation budget goes where you can see it -
    camera.getWorldPosition(_v);
    const camX = _v.x;
    const camZ = _v.z;
    let live = 0;
    for (let i = 0; i < this.slots.length; i++) {
      const z = this.slots[i].zombie;
      if (!z) continue;
      const dx = z.pos.x - camX;
      const dz = z.pos.z - camZ;
      this.order[live].slot = i;
      this.order[live].d2 = dx * dx + dz * dz;
      live++;
    }
    // Insertion sort: `live` is at most 24 and nearly sorted frame to frame.
    for (let i = 1; i < live; i++) {
      const cur = this.order[i];
      let j = i - 1;
      while (j >= 0 && this.order[j].d2 > cur.d2) {
        this.order[j + 1] = this.order[j];
        j--;
      }
      this.order[j + 1] = cur;
    }

    let shadowCount = 0;

    for (let rank = 0; rank < live; rank++) {
      const slot = this.slots[this.order[rank].slot];
      const z = slot.zombie;
      if (!z) continue;
      const inst = slot.inst;
      const dist = Math.sqrt(this.order[rank].d2);

      // --- Transform: interpolate between simulation states ---------------
      const px = z.prev.x + (z.pos.x - z.prev.x) * alpha;
      const py = z.prev.y + (z.pos.y - z.prev.y) * alpha;
      const pz = z.prev.z + (z.pos.z - z.prev.z) * alpha;

      // Shortest-arc yaw interpolation, so a zombie turning past +/-PI does not
      // spin the long way round for a frame.
      let dyaw = z.yaw - z.prevYaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      inst.group.rotation.y = z.prevYaw + dyaw * alpha;
      inst.group.scale.setScalar(z.height / MODEL_HEIGHT);

      // --- Animation budget -----------------------------------------------
      const stride = rank < animBudget ? 1 : dist < 26 ? 2 : 4;
      slot.since++;
      if (slot.since >= stride || z.state === 'dead' || z.state === 'emerging') {
        // dt is scaled by the stride so time-based curves stay correct when we
        // skip frames - otherwise a distant death animation plays in slow motion.
        poseZombie(inst, {
          state: z.state,
          phase: z.animPhase,
          limp: z.limp,
          lean: z.postureLean,
          tilt: z.postureTilt,
          stateT: z.stateT,
          deathT: z.deathT,
          // Headshots and knife kills throw them backwards.
          fallBack: z.killedByHead || z.killedByMelee,
          intensity: clamp01(Math.hypot(z.vel.x, z.vel.z) / Math.max(0.5, z.speed)),
          dt: dt * slot.since,
        });
        slot.since = 0;
      }

      // Vertical offsets are owned HERE, not in the poser, so there is exactly
      // one authority on where the body sits.
      let yOffset = 0;
      if (z.state === 'emerging') {
        const t = clamp01(z.stateT / 0.9);
        yOffset = -(1 - t * t * (3 - 2 * t)) * 1.15;
      } else if (z.state === 'dead') {
        // Sink through the floor rather than alpha-fading: no transparency sort
        // artefacts when bodies pile up on each other.
        yOffset = -Math.min(1.2, Math.max(0, z.deathT - 1.3) * 0.95);
      }
      inst.group.position.set(px, py + yOffset, pz);

      // --- Hit flash -------------------------------------------------------
      slot.flash = damp(slot.flash, z.hitFlash, 18, dt);
      if (slot.flash > 0.004) {
        slot.skinMat.emissive.setRGB(slot.flash * 0.65, slot.flash * 0.1, slot.flash * 0.08);
        slot.skinMat.emissiveIntensity = 1;
      } else if (slot.skinMat.emissiveIntensity !== 0) {
        slot.skinMat.emissive.setRGB(0, 0, 0);
        slot.skinMat.emissiveIntensity = 0;
      }

      // --- Contact shadow --------------------------------------------------
      if (z.state !== 'dead' || z.deathT < 1.6) {
        const r = z.radius * 3.1 * (z.state === 'dead' ? 1.5 : 1);
        _q.setFromEuler(_flat);
        _s.set(r, r, r);
        _v.set(px, py + 0.03, pz);
        _m.compose(_v, _q, _s);
        this.shadows.setMatrixAt(shadowCount++, _m);
      }
    }

    // Park unused shadow instances rather than changing the instance count,
    // which would reallocate the buffer.
    for (let i = shadowCount; i < CAPACITY; i++) this.shadows.setMatrixAt(i, HIDDEN);
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const s of this.slots) {
      s.skinMat.dispose();
      s.clothMat.dispose();
      s.inst.skeleton.dispose();
      s.inst.group.removeFromParent();
    }
    this.slots.length = 0;
    this.shadows.geometry.dispose();
    (this.shadows.material as THREE.Material).dispose();
    this.shadows.dispose();
    this.asset.dispose();
    this.root.removeFromParent();
  }
}
