/**
 * All game audio, synthesised at runtime with WebAudio.
 *
 * There is not one sampled sound file in this project. Every gunshot, groan,
 * footstep and UI blip is built from oscillators and filtered noise. Two reasons:
 *
 *  1. **Zero IP risk.** Ripped game SFX are the single most common licensing
 *     landmine in a project like this. Synthesis makes the question unaskable.
 *  2. **No load cost.** One 2-second noise buffer, generated once, backs the
 *     entire sound design. Nothing to download, nothing to decode mid-wave.
 *
 * The tradeoff is honest: synthesised gunfire will never match a recorded
 * shotgun. What it CAN do is be tight, punchy and correctly layered - a hard
 * transient crack, a pitched body, and a tail - which is most of what makes
 * shooting feel good.
 */

export interface Voice {
  /** Fundamental of the pitched "body" layer, Hz. */
  bodyHz: number;
  /** Body decay time, seconds. */
  decay: number;
  /** Amount of high-frequency transient crack, 0-1.5. */
  crack: number;
  /** Low-end punch multiplier. */
  punch: number;
}

/** Hard cap on simultaneous nodes. A shotgun into a crowd must not blow this up. */
const MAX_VOICES = 24;

interface PlayOpts {
  /** World position for distance attenuation. Omit for UI / first-person sounds. */
  x?: number;
  y?: number;
  z?: number;
  /** Reference distance in metres: gain is ref / (ref + d). */
  ref?: number;
}

export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private voices = 0;

  private lx = 0;
  private ly = 0;
  private lz = 0;

  private muted = false;
  private volume = 0.85;

  // Rate limits, so a dense frame cannot machine-gun the same cue.
  private lastGroan = 0;
  private lastStep = 0;

  /**
   * Create (or resume) the context. MUST be called from a user gesture -
   * browsers will not let audio start otherwise, and a suspended context fails
   * silently, which is a miserable bug to chase.
   */
  async resume(): Promise<void> {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return; // no WebAudio: the game still plays, just silently
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this.noiseBuf = this.makeNoise(2);
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        /* ignore - autoplay policy */
      }
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      // Ramp rather than jump: an instant gain change on a live graph clicks.
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
    }
  }

  /** Listener position, updated once per frame from the camera. */
  setListener(x: number, y: number, z: number): void {
    this.lx = x;
    this.ly = y;
    this.lz = z;
  }

  // -----------------------------------------------------------------------
  // Primitives
  // -----------------------------------------------------------------------

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Deterministic LCG rather than Math.random, so the noise floor is identical
    // between sessions and nothing about the mix drifts.
    let s = 0x2f6e2b1;
    for (let i = 0; i < len; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (s / 0x3fffffff - 1) * 0.9;
    }
    return buf;
  }

  /** Distance attenuation. Simple inverse falloff - no HRTF, no panner cost. */
  private gainAt(o: PlayOpts): number {
    if (o.x === undefined) return 1;
    const d = Math.hypot(o.x - this.lx, (o.y ?? 0) - this.ly, (o.z ?? 0) - this.lz);
    const ref = o.ref ?? 8;
    if (d > ref * 14) return 0; // fully inaudible: skip the nodes entirely
    return ref / (ref + d * d * 0.06 + d);
  }

  private take(): boolean {
    if (!this.ctx || this.muted || this.voices >= MAX_VOICES) return false;
    this.voices++;
    return true;
  }

  private release(node: AudioScheduledSourceNode, at: number): void {
    node.stop(at);
    node.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
      node.disconnect();
    };
  }

  /** Filtered noise burst: transients, impacts, footsteps, breath. */
  private noise(
    dur: number,
    gain: number,
    filter: BiquadFilterType,
    freq: number,
    freqEnd: number,
    q: number,
    opts: PlayOpts = {},
    attack = 0.002,
  ): void {
    const g0 = gain * this.gainAt(opts);
    if (g0 < 0.002 || !this.take()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf!;
    // Random read offset so repeated bursts never sound like a loop.
    const offset = Math.random() * 1.5;

    const bq = ctx.createBiquadFilter();
    bq.type = filter;
    bq.frequency.setValueAtTime(freq, t);
    bq.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t + dur);
    bq.Q.value = q;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(g0, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(bq).connect(env).connect(this.master!);
    src.start(t, offset, dur + 0.02);
    this.release(src, t + dur + 0.03);
  }

  /** Pitched layer: bodies, tones, groans, UI. */
  private tone(
    type: OscillatorType,
    freq: number,
    freqEnd: number,
    dur: number,
    gain: number,
    opts: PlayOpts = {},
    attack = 0.004,
    detune = 0,
  ): void {
    const g0 = gain * this.gainAt(opts);
    if (g0 < 0.002 || !this.take()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    if (detune) osc.detune.value = detune;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(g0, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(env).connect(this.master!);
    osc.start(t);
    this.release(osc, t + dur + 0.02);
  }

  // -----------------------------------------------------------------------
  // Weapons
  // -----------------------------------------------------------------------

  /**
   * A gunshot in three layers, which is roughly how a real one reads:
   *   1. crack  - very short, very bright noise transient (the supersonic snap)
   *   2. body   - fast downward pitch sweep (the muzzle blast)
   *   3. tail   - low band-passed noise (the room)
   * Retooled weapons get a slightly lower, meaner body and a longer tail.
   */
  gunshot(voice: Voice, upgraded: boolean): void {
    const heavier = upgraded ? 0.86 : 1;
    this.noise(0.045, 0.5 * voice.crack, 'highpass', 5200, 2600, 0.7, {}, 0.001);
    this.tone('square', voice.bodyHz * heavier, voice.bodyHz * 0.28 * heavier, voice.decay, 0.34 * voice.punch, {}, 0.001);
    this.tone('sine', voice.bodyHz * 0.5 * heavier, voice.bodyHz * 0.16, voice.decay * 1.4, 0.26 * voice.punch, {}, 0.002);
    this.noise(voice.decay * (upgraded ? 2.4 : 1.9), 0.2 * voice.punch, 'bandpass', 900, 260, 1.1, {}, 0.006);
  }

  dryfire(): void {
    this.noise(0.045, 0.22, 'bandpass', 2400, 900, 3.5, {}, 0.001);
    this.tone('square', 160, 90, 0.05, 0.1);
  }

  /** Mechanical click-clack of a slide, bolt or pump. */
  action(pitch = 1, weight = 1): void {
    this.noise(0.05, 0.2 * weight, 'bandpass', 1800 * pitch, 700 * pitch, 4, {}, 0.001);
    this.tone('square', 240 * pitch, 120 * pitch, 0.05, 0.09 * weight);
  }

  reloadStart(duration: number): void {
    this.action(1.1, 0.8);
    // Magazine seating, timed to land at the end of the animation.
    window.setTimeout(() => this.action(0.8, 1.1), Math.max(60, duration * 620));
  }

  reloadEnd(): void {
    this.action(1.35, 0.9);
  }

  pump(): void {
    this.action(0.75, 1.3);
    this.noise(0.09, 0.16, 'bandpass', 1100, 420, 2.2, {}, 0.004);
  }

  switchWeapon(): void {
    this.noise(0.11, 0.14, 'bandpass', 900, 380, 1.6, {}, 0.004);
  }

  lowAmmo(): void {
    this.tone('triangle', 1500, 1500, 0.05, 0.06);
  }

  // -----------------------------------------------------------------------
  // Impacts
  // -----------------------------------------------------------------------

  impactWorld(x: number, y: number, z: number): void {
    this.noise(0.1, 0.5, 'bandpass', 2600, 700, 1.4, { x, y, z, ref: 7 }, 0.001);
    this.tone('triangle', 320, 120, 0.06, 0.18, { x, y, z, ref: 7 });
  }

  /** Wet, dull, and lower than a wall hit. Heavy = a limb came off. */
  impactFlesh(x: number, y: number, z: number, heavy: boolean): void {
    this.noise(heavy ? 0.19 : 0.11, heavy ? 0.6 : 0.42, 'lowpass', heavy ? 900 : 1300, 220, 0.9, { x, y, z, ref: 9 }, 0.001);
    this.tone('sine', heavy ? 110 : 160, 55, heavy ? 0.16 : 0.1, 0.22, { x, y, z, ref: 9 });
  }

  /** First-person confirmation tick. Deliberately dry and non-positional. */
  hitmarker(headshot: boolean): void {
    this.tone('square', headshot ? 1650 : 1080, headshot ? 1250 : 900, 0.035, headshot ? 0.14 : 0.085);
  }

  kill(headshot: boolean): void {
    this.tone('sine', headshot ? 300 : 220, 70, 0.26, 0.2);
    this.noise(0.3, 0.22, 'lowpass', 700, 160, 0.8, {}, 0.008);
  }

  melee(): void {
    this.noise(0.13, 0.2, 'bandpass', 2200, 520, 1.1, {}, 0.006);
  }

  meleeHit(): void {
    this.noise(0.17, 0.5, 'lowpass', 1000, 200, 0.9, {}, 0.001);
    this.tone('sine', 130, 52, 0.15, 0.24);
  }

  // -----------------------------------------------------------------------
  // Player
  // -----------------------------------------------------------------------

  footstep(x: number, y: number, z: number, sprint: boolean): void {
    const now = performance.now();
    if (now - this.lastStep < 110) return;
    this.lastStep = now;
    const g = sprint ? 0.17 : 0.11;
    this.noise(0.075, g, 'bandpass', 1500 + Math.random() * 500, 380, 1.1, { x, y, z, ref: 3 }, 0.002);
    this.tone('sine', 92, 58, 0.06, g * 0.55, { x, y, z, ref: 3 });
  }

  jump(): void {
    this.noise(0.07, 0.08, 'bandpass', 900, 360, 1, {}, 0.004);
  }

  land(force: number): void {
    this.noise(0.14, 0.1 + force * 0.22, 'lowpass', 900, 180, 0.9, {}, 0.001);
    this.tone('sine', 80, 44, 0.12, 0.1 + force * 0.16);
  }

  hurt(amount: number): void {
    const k = Math.min(1, amount / 40);
    this.tone('sawtooth', 220 - k * 60, 90, 0.2, 0.16 + k * 0.14);
    this.noise(0.24, 0.16 + k * 0.14, 'lowpass', 1400, 300, 0.8, {}, 0.002);
  }

  dead(): void {
    // Long descending sine + noise wash. Reads as "the run is over" without
    // needing music.
    this.tone('sine', 180, 34, 1.9, 0.3);
    this.tone('sine', 118, 26, 2.4, 0.22, {}, 0.06);
    this.noise(2.2, 0.16, 'lowpass', 900, 90, 0.7, {}, 0.25);
  }

  // -----------------------------------------------------------------------
  // The Blighted
  // -----------------------------------------------------------------------

  /**
   * Groan: two detuned saws through a narrow band-pass, which is a crude but
   * effective vocal-formant stand-in. Brutes go lower and slower.
   */
  groan(x: number, y: number, z: number, kind: string): void {
    const now = performance.now();
    if (now - this.lastGroan < 90) return;
    this.lastGroan = now;
    const base = kind === 'brute' ? 68 : kind === 'runner' ? 138 : 96;
    const f = base * (0.85 + Math.random() * 0.35);
    const dur = kind === 'brute' ? 1.15 : 0.7;
    this.tone('sawtooth', f, f * 0.72, dur, 0.2, { x, y, z, ref: 11 }, 0.09);
    this.tone('sawtooth', f * 1.01, f * 0.7, dur, 0.14, { x, y, z, ref: 11 }, 0.11, 18);
    this.noise(dur * 0.8, 0.09, 'bandpass', f * 8, f * 4, 3.2, { x, y, z, ref: 11 }, 0.12);
  }

  zombieSpawn(x: number, y: number, z: number): void {
    this.noise(0.5, 0.2, 'lowpass', 1300, 240, 0.9, { x, y, z, ref: 10 }, 0.05);
  }

  zombieSwing(x: number, y: number, z: number): void {
    this.noise(0.15, 0.2, 'bandpass', 1700, 420, 1.2, { x, y, z, ref: 6 }, 0.01);
  }

  // -----------------------------------------------------------------------
  // Economy / UI
  // -----------------------------------------------------------------------

  purchase(): void {
    this.tone('square', 620, 620, 0.06, 0.1);
    this.tone('square', 930, 930, 0.09, 0.1, {}, 0.004);
    this.noise(0.09, 0.07, 'bandpass', 3000, 1200, 2, {}, 0.002);
  }

  denied(): void {
    this.tone('square', 190, 130, 0.16, 0.12);
  }

  doorOpen(): void {
    // Rattling roller shutter: a rising band-pass sweep with a metallic tail.
    this.noise(1.15, 0.3, 'bandpass', 420, 1900, 1.4, {}, 0.05);
    this.tone('sawtooth', 90, 150, 1.1, 0.11, {}, 0.08);
    window.setTimeout(() => this.action(0.6, 1.4), 1150);
  }

  waveStart(wave: number): void {
    // Rises a semitone-ish per wave, so later waves literally sound higher and
    // more urgent without needing new assets.
    const base = 150 + Math.min(18, wave) * 9;
    this.tone('sawtooth', base, base * 1.5, 0.7, 0.2, {}, 0.04);
    this.tone('sawtooth', base * 0.5, base * 0.76, 1.0, 0.16, {}, 0.06);
    this.noise(1.1, 0.12, 'lowpass', 1200, 220, 0.8, {}, 0.1);
  }

  waveClear(): void {
    for (const [i, f] of [392, 523, 659].entries()) {
      window.setTimeout(() => this.tone('triangle', f, f, 0.2, 0.13), i * 110);
    }
  }

  uiClick(): void {
    this.tone('square', 780, 620, 0.035, 0.07);
  }

  dispose(): void {
    this.master?.disconnect();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.voices = 0;
  }
}
