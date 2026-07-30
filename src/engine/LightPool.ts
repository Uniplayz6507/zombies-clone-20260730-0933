import * as THREE from 'three';
import type { LampDef } from '../content/level.city';
import { damp } from '../util/vec';

/**
 * A fixed pool of real point lights, repositioned to whichever fixtures are
 * nearest the player.
 *
 * The naive approach - one PointLight per lamp, toggling `.visible` - is a trap.
 * Three bakes the light count into every material's shader program, so changing
 * visibility changes `numPointLights` and forces a full recompile of every
 * material in the scene. That is a guaranteed multi-hundred-millisecond stall,
 * mid-wave, every time you walk past a lamp.
 *
 * Keeping the count constant and moving the lights instead costs nothing. Every
 * fixture still carries emissive geometry, so lamps outside the pool continue to
 * read as lit through bloom, and the player never notices which five are real.
 */
export const POOL_SIZE = 5;

interface Slot {
  light: THREE.PointLight;
  lamp: number;
  /** Smoothed intensity, so a reassignment fades instead of popping. */
  current: number;
}

export class LightPool {
  private readonly slots: Slot[] = [];
  private readonly lamps: LampDef[];
  private readonly ranked: { idx: number; d2: number }[] = [];
  private repickT = 0;

  constructor(scene: THREE.Object3D, lamps: LampDef[]) {
    this.lamps = lamps;
    for (let i = 0; i < POOL_SIZE; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 10, 2);
      // Extra shadow-casting lights mean extra full scene passes. One shadow
      // caster, and it is the moon.
      light.castShadow = false;
      scene.add(light);
      this.slots.push({ light, lamp: -1, current: 0 });
    }
    for (let i = 0; i < lamps.length; i++) this.ranked.push({ idx: i, d2: 0 });
  }

  /**
   * `unlocked` gates lamps in areas the player has not opened yet, so a slot is
   * never wasted lighting a room behind a shut shutter.
   */
  update(dt: number, time: number, px: number, py: number, pz: number, unlocked: ReadonlySet<string>): void {
    this.repickT -= dt;
    if (this.repickT <= 0) {
      // Re-ranking four times a second is plenty; lamps are metres apart.
      this.repickT = 0.25;
      for (const r of this.ranked) {
        const l = this.lamps[r.idx];
        r.d2 = unlocked.has(l.zone)
          ? (l.x - px) * (l.x - px) + (l.y - py) * (l.y - py) + (l.z - pz) * (l.z - pz)
          : Infinity;
      }
      this.ranked.sort((a, b) => a.d2 - b.d2);
      for (let i = 0; i < this.slots.length; i++) {
        const pick = this.ranked[i];
        this.slots[i].lamp = pick && Number.isFinite(pick.d2) ? pick.idx : -1;
      }
    }

    for (const slot of this.slots) {
      if (slot.lamp < 0) {
        slot.current = damp(slot.current, 0, 6, dt);
        slot.light.intensity = slot.current;
        continue;
      }
      const lamp = this.lamps[slot.lamp];
      slot.light.position.set(lamp.x, lamp.y, lamp.z);
      slot.light.color.setHex(lamp.color);
      slot.light.distance = lamp.distance;

      // Failing ballast: a fast wobble plus an occasional hard dropout.
      let target = lamp.intensity;
      if (lamp.flicker) {
        const f = lamp.flicker;
        const wobble = 1 - f * 0.25 * (0.5 + 0.5 * Math.sin(time * 37 + slot.lamp * 2.1));
        const dropout = Math.sin(time * 3.1 + slot.lamp) > 0.985 - f * 0.35 ? 1 - f * 0.85 : 1;
        target *= wobble * dropout;
      }
      slot.current = damp(slot.current, target, 9, dt);
      slot.light.intensity = slot.current;
    }
  }

  dispose(): void {
    for (const s of this.slots) {
      s.light.removeFromParent();
      s.light.dispose();
    }
    this.slots.length = 0;
  }
}
