import type { WeaponId } from '../types';
import type { HitZone } from '../content/weapons.data';
import type { ZombieKind } from './Zombie';

/**
 * The simulation never touches audio, particles, or the DOM. It appends events
 * to a queue, and the engine drains that queue once per frame and turns entries
 * into sound and FX.
 *
 * This is what keeps `src/game/**` free of any renderer import, and it means the
 * whole sim can be driven headless in a test.
 */
export type GameEvent =
  | { type: 'shot'; weapon: WeaponId; upgraded: boolean; x: number; y: number; z: number; dx: number; dy: number; dz: number }
  | { type: 'dryfire' }
  | { type: 'tracer'; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }
  | { type: 'impactWorld'; x: number; y: number; z: number; nx: number; ny: number; nz: number }
  | { type: 'impactFlesh'; x: number; y: number; z: number; dx: number; dy: number; dz: number; zone: HitZone }
  | { type: 'hitmarker'; headshot: boolean }
  | { type: 'kill'; kind: ZombieKind; headshot: boolean; melee: boolean; x: number; y: number; z: number; points: number }
  | { type: 'reloadStart'; weapon: WeaponId; duration: number }
  | { type: 'reloadEnd' }
  | { type: 'pump' }
  | { type: 'melee' }
  | { type: 'meleeHit' }
  | { type: 'switchWeapon'; weapon: WeaponId }
  | { type: 'footstep'; x: number; y: number; z: number; sprint: boolean }
  | { type: 'land'; force: number }
  | { type: 'jump' }
  | { type: 'zombieSpawn'; x: number; y: number; z: number; kind: ZombieKind }
  | { type: 'zombieGroan'; x: number; y: number; z: number; kind: ZombieKind }
  | { type: 'zombieSwing'; x: number; y: number; z: number }
  | { type: 'playerHurt'; amount: number; health: number; fromX: number; fromZ: number }
  | { type: 'playerDead' }
  | { type: 'purchase'; kind: 'door' | 'weapon' | 'ammo' | 'upgrade'; label: string; cost: number }
  | { type: 'denied'; reason: string }
  | { type: 'doorOpen'; id: string; label: string }
  | { type: 'waveStart'; wave: number; total: number }
  | { type: 'waveClear'; wave: number; bonus: number }
  | { type: 'lowAmmo' };

/** Bounded queue: a runaway producer can never grow this without limit. */
export class EventQueue {
  private readonly items: GameEvent[] = [];
  private readonly limit: number;

  constructor(limit = 256) {
    this.limit = limit;
  }

  push(e: GameEvent): void {
    if (this.items.length < this.limit) this.items.push(e);
  }

  drain(consume: (e: GameEvent) => void): void {
    for (let i = 0; i < this.items.length; i++) consume(this.items[i]);
    this.items.length = 0;
  }

  clear(): void {
    this.items.length = 0;
  }

  get length(): number {
    return this.items.length;
  }
}
