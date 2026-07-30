import type { WeaponId } from '../../types';
import { effectiveSpec, fireInterval, WEAPONS, type WeaponSpec } from '../../content/weapons.data';
import { clamp, damp } from '../../util/vec';
import type { EventQueue } from '../events';

/**
 * Weapon inventory and firing state machine.
 *
 * Design note: the knife is *not* an inventory slot. Pressing melee performs a
 * quick swing and returns you to whatever you were holding. That is the genre
 * convention, it removes an entire class of "I died holding a knife" frustration,
 * and it lets the swing animate over the held viewmodel.
 */

export type SlotId = Extract<WeaponId, 'sidewinder' | 'hornet' | 'breaker'>;

export const SLOT_ORDER: SlotId[] = ['sidewinder', 'hornet', 'breaker'];

export interface WeaponSlot {
  id: SlotId;
  owned: boolean;
  upgraded: boolean;
  mag: number;
  reserve: number;
}

export interface FireIntent {
  /** Trigger pulls to resolve this step (0 or 1 in practice). */
  shots: number;
  /** True on the single step the melee swing connects. */
  melee: boolean;
}

export class Arsenal {
  readonly slots: Record<SlotId, WeaponSlot> = {
    sidewinder: { id: 'sidewinder', owned: true, upgraded: false, mag: 0, reserve: 0 },
    hornet: { id: 'hornet', owned: false, upgraded: false, mag: 0, reserve: 0 },
    breaker: { id: 'breaker', owned: false, upgraded: false, mag: 0, reserve: 0 },
  };

  current: SlotId = 'sidewinder';

  cooldown = 0;
  reloadT = 0;
  reloadTotal = 0;
  /** Pump/bolt cycle after a shot. Blocks firing, not movement. */
  pumpT = 0;
  switchT = 0;
  private switchTo: SlotId | null = null;

  meleeT = 0;
  meleeCd = 0;
  private meleeResolved = true;

  /** Accumulated inaccuracy from sustained fire, 0-1. */
  bloom = 0;
  /** Aim-down-sights blend, 0-1. */
  ads = 0;

  private wasFiring = false;
  private readonly intent: FireIntent = { shots: 0, melee: false };

  reset(): void {
    for (const id of SLOT_ORDER) {
      const s = this.slots[id];
      const spec = WEAPONS[id];
      s.owned = id === 'sidewinder';
      s.upgraded = false;
      s.mag = s.owned ? spec.magSize : 0;
      s.reserve = s.owned ? spec.reserveMax : 0;
    }
    this.current = 'sidewinder';
    this.cooldown = 0;
    this.reloadT = 0;
    this.pumpT = 0;
    this.switchT = 0;
    this.switchTo = null;
    this.meleeT = 0;
    this.meleeCd = 0;
    this.meleeResolved = true;
    this.bloom = 0;
    this.ads = 0;
    this.wasFiring = false;
  }

  get slot(): WeaponSlot {
    return this.slots[this.current];
  }

  get spec(): WeaponSpec {
    return effectiveSpec(this.current, this.slot.upgraded);
  }

  get meleeSpec(): WeaponSpec {
    return WEAPONS.fang;
  }

  get busy(): boolean {
    return this.reloadT > 0 || this.switchT > 0 || this.pumpT > 0 || this.meleeT > 0;
  }

  get reloading(): boolean {
    return this.reloadT > 0;
  }

  /** 0-1 through the reload, for the viewmodel animation. */
  get reloadProgress(): number {
    return this.reloadTotal > 0 ? 1 - this.reloadT / this.reloadTotal : 1;
  }

  owns(id: SlotId): boolean {
    return this.slots[id].owned;
  }

  grant(id: SlotId, events: EventQueue): void {
    const s = this.slots[id];
    const spec = effectiveSpec(id, s.upgraded);
    const firstTime = !s.owned;
    s.owned = true;
    s.mag = spec.magSize;
    s.reserve = spec.reserveMax;
    if (firstTime) this.select(id, events);
  }

  refillAll(): void {
    for (const id of SLOT_ORDER) {
      const s = this.slots[id];
      if (!s.owned) continue;
      const spec = effectiveSpec(id, s.upgraded);
      s.reserve = spec.reserveMax;
      if (s.mag < spec.magSize) s.mag = spec.magSize;
    }
  }

  upgradeCurrent(): void {
    const s = this.slot;
    s.upgraded = true;
    const spec = effectiveSpec(s.id, true);
    // A Retool is also a full resupply. It costs 3000; it should feel like it.
    s.mag = spec.magSize;
    s.reserve = spec.reserveMax;
  }

  select(id: SlotId, events: EventQueue): void {
    if (id === this.current || !this.slots[id].owned) return;
    if (this.switchT > 0) return;
    this.switchTo = id;
    this.switchT = 0.42;
    this.reloadT = 0;
    this.pumpT = 0;
    events.push({ type: 'switchWeapon', weapon: id });
  }

  cycle(events: EventQueue): void {
    const owned = SLOT_ORDER.filter((id) => this.slots[id].owned);
    if (owned.length < 2) return;
    const i = owned.indexOf(this.current);
    this.select(owned[(i + 1) % owned.length], events);
  }

  beginReload(events: EventQueue): void {
    const s = this.slot;
    const spec = this.spec;
    if (this.busy) return;
    if (s.mag >= spec.magSize || s.reserve <= 0) return;
    this.reloadT = spec.reloadTime;
    this.reloadTotal = spec.reloadTime;
    events.push({ type: 'reloadStart', weapon: s.id, duration: spec.reloadTime });
  }

  private finishReload(events: EventQueue): void {
    const s = this.slot;
    const spec = this.spec;
    const take = Math.min(spec.magSize - s.mag, s.reserve);
    s.mag += take;
    s.reserve -= take;
    events.push({ type: 'reloadEnd' });
  }

  /**
   * Advance every timer and resolve what the player is trying to do.
   * The World turns the returned intent into hitscans.
   */
  update(
    dt: number,
    input: {
      fire: boolean;
      firePressed: boolean;
      ads: boolean;
      reload: boolean;
      melee: boolean;
      switchTo: SlotId | null;
      cycle: boolean;
    },
    events: EventQueue,
  ): FireIntent {
    this.intent.shots = 0;
    this.intent.melee = false;

    this.cooldown = Math.max(0, this.cooldown - dt);
    this.meleeCd = Math.max(0, this.meleeCd - dt);
    this.bloom = damp(this.bloom, 0, 3.4, dt);

    if (this.pumpT > 0) {
      this.pumpT -= dt;
      if (this.pumpT <= 0) events.push({ type: 'pump' });
    }

    if (this.switchT > 0) {
      this.switchT -= dt;
      // Swap the model halfway through the animation, at the bottom of the dip.
      if (this.switchTo && this.switchT <= 0.21) {
        this.current = this.switchTo;
        this.switchTo = null;
      }
      if (this.switchT <= 0) this.switchT = 0;
    }

    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.reloadT = 0;
        this.finishReload(events);
      }
    }

    // Melee: blocks firing, and a swing cancels a reload. It is the panic option.
    const meleeTotal = 60 / this.meleeSpec.rpm;
    if (this.meleeT > 0) {
      this.meleeT -= dt;
      if (!this.meleeResolved && this.meleeT <= meleeTotal * 0.55) {
        this.meleeResolved = true;
        this.intent.melee = true;
      }
      if (this.meleeT <= 0) this.meleeT = 0;
    } else if (input.melee && this.meleeCd <= 0 && this.switchT <= 0) {
      this.meleeT = meleeTotal;
      this.meleeCd = meleeTotal + 0.12;
      this.meleeResolved = false;
      this.reloadT = 0;
      events.push({ type: 'melee' });
    }

    const wantAds = input.ads && !this.busy;
    this.ads = damp(this.ads, wantAds ? 1 : 0, 14, dt);

    if (input.switchTo && input.switchTo !== this.current) this.select(input.switchTo, events);
    if (input.cycle) this.cycle(events);
    if (input.reload) this.beginReload(events);

    const spec = this.spec;
    const s = this.slot;
    const wantsShot = spec.mode === 'auto' ? input.fire : input.firePressed;

    if (wantsShot && !this.busy && this.cooldown <= 0) {
      if (s.mag > 0) {
        s.mag--;
        this.cooldown = fireInterval(spec);
        this.bloom = clamp(this.bloom + spec.bloom, 0, 1);
        this.intent.shots = 1;
        if (spec.mode === 'pump') this.pumpT = Math.min(0.62, fireInterval(spec) * 0.55);
        if (s.mag === 0 && s.reserve > 0) {
          // Auto-reload on empty. Nobody enjoys dry-firing into a horde.
          this.reloadT = spec.reloadTime;
          this.reloadTotal = spec.reloadTime;
          events.push({ type: 'reloadStart', weapon: s.id, duration: spec.reloadTime });
        } else if (s.mag <= Math.max(1, Math.floor(spec.magSize * 0.2))) {
          events.push({ type: 'lowAmmo' });
        }
      } else if (!this.wasFiring || spec.mode !== 'auto') {
        events.push({ type: 'dryfire' });
        this.cooldown = 0.28;
      }
    }

    this.wasFiring = input.fire;
    return this.intent;
  }

  /** Cone half-angle in radians, including bloom and ADS. */
  spreadRadians(): number {
    const spec = this.spec;
    const base = spec.spread * (1 + this.bloom * 1.8);
    const adsFactor = 1 + (spec.adsSpread - 1) * this.ads;
    return base * adsFactor * (Math.PI / 180);
  }
}
