import { Rng } from '../util/rng';
import { rollKind, SCORING, waveSpec, type WaveSpec } from '../content/waves.data';
import type { RunPhase } from '../types';
import type { EventQueue } from './events';
import type { Horde } from './Horde';
import type { Player } from './Player';
import type { Economy } from './Economy';
import type { SpawnDef, Zone } from '../content/level.city';

/**
 * Wave pacing state machine.
 *
 *   countdown -> active -> intermission -> active -> ... -> dead
 *
 * Every timer here runs on the *simulation* clock, never on setInterval. A wall
 * clock keeps ticking through a paused tab and desyncs from the accumulator; a
 * sim-clock timer cannot.
 */
export class WaveDirector {
  phase: RunPhase = 'countdown';
  wave = 0;
  spec: WaveSpec = waveSpec(1);

  /** Blighted still to be released this wave. */
  remaining = 0;
  /** Seconds until the next spawn attempt. */
  private spawnT = 0;
  /** Countdown / intermission clock. */
  timer = 4;

  private readonly rng = new Rng(0xc0ffee);

  reset(seed = 0xc0ffee): void {
    this.phase = 'countdown';
    this.wave = 0;
    this.spec = waveSpec(1);
    this.remaining = 0;
    this.spawnT = 0;
    this.timer = 4;
    this.rng.reseed(seed);
  }

  private begin(events: EventQueue): void {
    this.wave++;
    this.spec = waveSpec(this.wave);
    this.remaining = this.spec.total;
    // First spawn comes fast so an intermission never feels dead.
    this.spawnT = 0.7;
    this.phase = 'active';
    events.push({ type: 'waveStart', wave: this.wave, total: this.spec.total });
  }

  update(
    dt: number,
    horde: Horde,
    player: Player,
    economy: Economy,
    spawns: SpawnDef[],
    unlockedZones: Set<Zone>,
    events: EventQueue,
  ): void {
    if (this.phase === 'dead') return;

    if (player.dead) {
      this.phase = 'dead';
      return;
    }

    if (this.phase === 'countdown' || this.phase === 'intermission') {
      this.timer -= dt;
      if (this.timer <= 0) this.begin(events);
      return;
    }

    // --- Active wave --------------------------------------------------------
    const alive = horde.countAlive();
    this.spawnT -= dt;

    if (this.remaining > 0 && alive < this.spec.aliveCap && this.spawnT <= 0) {
      const kind = rollKind(this.spec, this.rng.next());
      const z = horde.spawn(
        kind,
        spawns,
        unlockedZones as unknown as Set<string>,
        player,
        this.spec.healthMul,
        this.spec.speedMul,
        events,
      );
      if (z) {
        this.remaining--;
        this.spawnT = this.spec.spawnInterval;
      } else {
        // Pool saturated or no eligible breach; retry shortly.
        this.spawnT = 0.35;
      }
    }

    // Wave is cleared only once the last body is down, not once the last spawn
    // has been released.
    if (this.remaining === 0 && horde.countAlive() === 0) {
      const bonus = SCORING.waveClear + this.wave * 25;
      economy.award(bonus);
      this.phase = 'intermission';
      this.timer = this.spec.intermission;
      events.push({ type: 'waveClear', wave: this.wave, bonus });
    }
  }
}
