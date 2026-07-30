import type { ZombieKind } from '../game/Zombie';
import type { WeaponSpec } from '../content/weapons.data';

/**
 * Every sound in this game is synthesised at runtime.
 *
 * No sample files, which means no audio licensing risk whatsoever - a real
 * concern for a game in this genre, where ripped voice lines and stingers are the
 * most common IP problem. It also means zero download weight and infinite
 * variation: each gunshot is a slightly different filter sweep rather than the
 * same wav for the hundredth time.
 *
 * Positional audio uses a manual gain + StereoPanner pair rather than PannerNode.
 * A full 3D panner per voice needs listener bookkeeping and HRTF convolution for
 * a result the player cannot distinguish from distance attenuation plus stereo
 * placement in a game this size.
 */
export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  /** Long, quiet noise buffer used as a cheap reverb tail source. */
  private tail: AudioBuffer | null = null;

  private muted = false;
  private volume = 0.75;

  // Listener state, updated once per frame.
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private lyaw = 0;

  private heartbeatT = 0;
  private heartbeatRate = 0;

  /**
   * Must be called from a user gesture (the Start button). Browsers will not
   * allow an AudioContext to start any other way.
   */
  async resume(): Promise<void> {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this.noise = this.makeNoise(1.2, 1);
      this.tail = this.makeNoise(1.6, 0.55);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  private makeNoise(seconds: number, amplitude: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      // Light one-pole smoothing takes the harshest top off pure white noise,
      // which makes filtered bursts sound like air rather than like static.
      last = last * 0.35 + white * 0.65;
      data[i] = last * amplitude;
    }
    return buf;
  }

  setMuted(v: boolean): void {
    this.muted = v;
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(v ? 0 : this.volume, this.ctx.currentTime, 0.03);
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setListener(x: number, y: number, z: number, yaw: number): void {
    this.lx = x;
    this.ly = y;
    this.lz = z;
    this.lyaw = yaw;
  }

  // -----------------------------------------------------------------------
  // Primitives
  // -----------------------------------------------------------------------

  /** Distance gain and stereo pan for a world position. */
  private spatial(x: number, y: number, z: number, falloff: number): { gain: number; pan: number } | null {
    const dx = x - this.lx;
    const dy = y - this.ly;
    const dz = z - this.lz;
    const d = Math.hypot(dx, dy, dz);
    // Inverse falloff with a soft near field, cut off entirely past the range.
    const gain = falloff / (falloff + d * d * 0.09);
    if (gain < 0.012) return null;
    // Project onto the listener's right vector for the pan.
    const rightX = Math.cos(this.lyaw);
    const rightZ = -Math.sin(this.lyaw);
    const pan = d > 0.01 ? Math.max(-1, Math.min(1, ((dx * rightX + dz * rightZ) / d) * 0.85)) : 0;
    return { gain, pan };
  }

  private chain(pan: number): { input: AudioNode; gain: GainNode } | null {
    if (!this.ctx || !this.master) return null;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    if (Math.abs(pan) > 0.01 && typeof this.ctx.createStereoPanner === 'function') {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = pan;
      gain.connect(panner);
      panner.connect(this.master);
    } else {
      gain.connect(this.master);
    }
    return { input: gain, gain };
  }

  /** Filtered noise burst with an exponential decay. */
  private burst(opts: {
    duration: number;
    level: number;
    filter: BiquadFilterType;
    freq: number;
    q?: number;
    sweepTo?: number;
    pan?: number;
    long?: boolean;
    attack?: number;
  }): void {
    if (!this.ctx) return;
    const buffer = opts.long ? this.tail : this.noise;
    if (!buffer) return;
    const c = this.chain(opts.pan ?? 0);
    if (!c) return;
    const t = this.ctx.currentTime;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;

    const filter = this.ctx.createBiquadFilter();
    filter.type = opts.filter;
    filter.frequency.value = opts.freq;
    filter.Q.value = opts.q ?? 1;
    if (opts.sweepTo) {
      filter.frequency.setValueAtTime(opts.freq, t);
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.sweepTo), t + opts.duration);
    }

    src.connect(filter);
    filter.connect(c.input);

    const attack = opts.attack ?? 0.001;
    c.gain.gain.setValueAtTime(0.0001, t);
    c.gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.level), t + attack);
    c.gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.duration);

    src.start(t, Math.random() * 0.3);
    src.stop(t + opts.duration + 0.02);
  }

  /** Oscillator with an optional pitch sweep. */
  private tone(opts: {
    freq: number;
    to?: number;
    duration: number;
    level: number;
    type?: OscillatorType;
    pan?: number;
    delay?: number;
    attack?: number;
  }): void {
    if (!this.ctx) return;
    const c = this.chain(opts.pan ?? 0);
    if (!c) return;
    const t = this.ctx.currentTime + (opts.delay ?? 0);

    const osc = this.ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, t);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t + opts.duration);
    osc.connect(c.input);

    const attack = opts.attack ?? 0.004;
    c.gain.gain.setValueAtTime(0.0001, t);
    c.gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.level), t + attack);
    c.gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.duration);

    osc.start(t);
    osc.stop(t + opts.duration + 0.02);
  }

  // -----------------------------------------------------------------------
  // Weapons
  // -----------------------------------------------------------------------

  /**
   * A gunshot is four layered elements: a transient crack, a filtered body, a
   * low thump, and a reverberant tail. Getting all four is the difference
   * between "a gun" and "a click".
   */
  gunshot(spec: WeaponSpec, upgraded: boolean): void {
    const v = spec.voice;
    const boost = upgraded ? 1.15 : 1;
    // 1. Crack: the supersonic snap.
    this.burst({ duration: 0.045, level: 0.5 * v.crack * boost, filter: 'highpass', freq: 2600, q: 0.7 });
    // 2. Body: the muzzle blast, sweeping down as the gas expands.
    this.burst({ duration: v.decay, level: 0.62 * boost, filter: 'lowpass', freq: v.bodyHz * 9, sweepTo: v.bodyHz * 2 });
    // 3. Thump: what you feel in your chest.
    this.tone({ freq: v.bodyHz, to: v.bodyHz * 0.42, duration: 0.1, level: 0.42 * v.punch * boost, type: 'sine' });
    // 4. Tail: the street answering back.
    this.burst({ duration: 0.34 + v.decay, level: 0.13 * boost, filter: 'lowpass', freq: 900, long: true, attack: 0.03 });
  }

  dryfire(): void {
    this.burst({ duration: 0.035, level: 0.22, filter: 'bandpass', freq: 2200, q: 4 });
    this.tone({ freq: 900, to: 500, duration: 0.03, level: 0.1, type: 'square' });
  }

  reloadStart(): void {
    // Magazine release, then the magazine dropping free.
    this.burst({ duration: 0.05, level: 0.2, filter: 'bandpass', freq: 1600, q: 3 });
    this.tone({ freq: 380, to: 200, duration: 0.07, level: 0.13, type: 'triangle', delay: 0.1 });
  }

  reloadEnd(): void {
    // Fresh magazine seats, then the bolt rides forward.
    this.burst({ duration: 0.06, level: 0.26, filter: 'bandpass', freq: 1100, q: 2.4 });
    this.burst({ duration: 0.07, level: 0.24, filter: 'highpass', freq: 2400, q: 1.2, attack: 0.004 });
    this.tone({ freq: 240, to: 150, duration: 0.06, level: 0.14, type: 'triangle', delay: 0.02 });
  }

  pump(): void {
    this.burst({ duration: 0.09, level: 0.3, filter: 'bandpass', freq: 900, q: 1.8, sweepTo: 1800 });
    this.burst({ duration: 0.07, level: 0.26, filter: 'bandpass', freq: 1700, q: 2.2, attack: 0.05 });
  }

  weaponSwap(): void {
    this.burst({ duration: 0.12, level: 0.16, filter: 'lowpass', freq: 900, sweepTo: 400 });
  }

  meleeSwing(): void {
    // Air moving past a blade: a fast bandpass sweep.
    this.burst({ duration: 0.16, level: 0.3, filter: 'bandpass', freq: 700, q: 1.1, sweepTo: 2600 });
  }

  meleeHit(): void {
    this.burst({ duration: 0.12, level: 0.42, filter: 'lowpass', freq: 700, sweepTo: 220 });
    this.tone({ freq: 130, to: 70, duration: 0.11, level: 0.3, type: 'sine' });
  }

  // -----------------------------------------------------------------------
  // Impacts
  // -----------------------------------------------------------------------

  impact(x: number, y: number, z: number): void {
    const s = this.spatial(x, y, z, 9);
    if (!s) return;
    this.burst({ duration: 0.09, level: 0.3 * s.gain, filter: 'bandpass', freq: 1500 + Math.random() * 900, q: 1.4, sweepTo: 500, pan: s.pan });
  }

  flesh(x: number, y: number, z: number, headshot: boolean): void {
    const s = this.spatial(x, y, z, 12);
    if (!s) return;
    this.burst({ duration: headshot ? 0.16 : 0.1, level: (headshot ? 0.5 : 0.34) * s.gain, filter: 'lowpass', freq: headshot ? 1100 : 750, sweepTo: 220, pan: s.pan });
    if (headshot) this.tone({ freq: 190, to: 80, duration: 0.14, level: 0.26 * s.gain, type: 'sine', pan: s.pan });
  }

  hitmarker(headshot: boolean): void {
    // Deliberately dry and non-spatial. This is UI feedback, not a world sound.
    this.tone({ freq: headshot ? 1750 : 1200, to: headshot ? 1300 : 980, duration: 0.05, level: 0.11, type: 'square' });
  }

  // -----------------------------------------------------------------------
  // The Blighted
  // -----------------------------------------------------------------------

  groan(x: number, y: number, z: number, kind: ZombieKind): void {
    const s = this.spatial(x, y, z, 16);
    if (!s) return;
    // Brutes are an octave down, runners a fifth up and much shorter.
    const base = kind === 'brute' ? 62 : kind === 'runner' ? 132 : 88;
    const dur = kind === 'runner' ? 0.5 : kind === 'brute' ? 1.5 : 1.0;
    const f = base * (0.85 + Math.random() * 0.3);
    // Two detuned saws through a lowpass reads as a vocal tract well enough.
    this.tone({ freq: f, to: f * 0.7, duration: dur, level: 0.2 * s.gain, type: 'sawtooth', pan: s.pan, attack: dur * 0.3 });
    this.tone({ freq: f * 1.49, to: f * 1.1, duration: dur * 0.8, level: 0.1 * s.gain, type: 'sawtooth', pan: s.pan, attack: dur * 0.35 });
    this.burst({ duration: dur * 0.7, level: 0.09 * s.gain, filter: 'bandpass', freq: 480, q: 1.6, sweepTo: 260, pan: s.pan, attack: dur * 0.3 });
  }

  zombieSwing(x: number, y: number, z: number): void {
    const s = this.spatial(x, y, z, 10);
    if (!s) return;
    this.burst({ duration: 0.14, level: 0.24 * s.gain, filter: 'bandpass', freq: 420, q: 0.9, sweepTo: 1400, pan: s.pan });
  }

  // -----------------------------------------------------------------------
  // Player
  // -----------------------------------------------------------------------

  footstep(sprint: boolean): void {
    this.burst({
      duration: sprint ? 0.1 : 0.08,
      level: sprint ? 0.15 : 0.09,
      filter: 'bandpass',
      freq: 320 + Math.random() * 220,
      q: 1.1,
      sweepTo: 180,
    });
  }

  jump(): void {
    this.burst({ duration: 0.07, level: 0.1, filter: 'bandpass', freq: 420, q: 1.2 });
  }

  land(force: number): void {
    this.burst({ duration: 0.12, level: 0.1 + force * 0.24, filter: 'lowpass', freq: 420, sweepTo: 140 });
  }

  hurt(): void {
    this.burst({ duration: 0.2, level: 0.4, filter: 'lowpass', freq: 620, sweepTo: 180 });
    this.tone({ freq: 150, to: 60, duration: 0.28, level: 0.3, type: 'sine' });
    // Ringing ears.
    this.tone({ freq: 3200, to: 2600, duration: 0.7, level: 0.05, type: 'sine', attack: 0.02 });
  }

  death(): void {
    this.tone({ freq: 180, to: 42, duration: 1.6, level: 0.34, type: 'sawtooth', attack: 0.05 });
    this.burst({ duration: 1.4, level: 0.2, filter: 'lowpass', freq: 700, sweepTo: 90, long: true, attack: 0.04 });
  }

  // -----------------------------------------------------------------------
  // UI and pacing
  // -----------------------------------------------------------------------

  purchase(): void {
    this.tone({ freq: 660, duration: 0.1, level: 0.16, type: 'triangle' });
    this.tone({ freq: 990, duration: 0.16, level: 0.14, type: 'triangle', delay: 0.07 });
    this.burst({ duration: 0.08, level: 0.14, filter: 'bandpass', freq: 2200, q: 3 });
  }

  denied(): void {
    this.tone({ freq: 220, to: 130, duration: 0.16, level: 0.16, type: 'square' });
  }

  doorOpen(): void {
    // Motor whine, rattling slats, and the clunk of the drum locking out.
    this.burst({ duration: 1.1, level: 0.26, filter: 'bandpass', freq: 700, q: 1.1, sweepTo: 1900, attack: 0.12 });
    this.tone({ freq: 96, to: 148, duration: 1.0, level: 0.16, type: 'sawtooth', attack: 0.1 });
    this.burst({ duration: 0.2, level: 0.3, filter: 'lowpass', freq: 400, sweepTo: 120, delay: 0 });
  }

  waveStart(wave: number): void {
    // A rising klaxon that gets a semitone higher every wave. By wave 15 it is
    // genuinely unpleasant, which is the intent.
    const base = 108 * Math.pow(1.03, Math.min(20, wave));
    this.tone({ freq: base, to: base * 1.5, duration: 1.5, level: 0.24, type: 'sawtooth', attack: 0.25 });
    this.tone({ freq: base * 1.005, to: base * 1.51, duration: 1.5, level: 0.18, type: 'sawtooth', attack: 0.3 });
    this.burst({ duration: 1.6, level: 0.1, filter: 'lowpass', freq: 500, long: true, attack: 0.3 });
  }

  waveClear(): void {
    for (let i = 0; i < 3; i++) {
      this.tone({ freq: 330 * Math.pow(1.26, i), duration: 0.3, level: 0.15, type: 'triangle', delay: i * 0.11 });
    }
  }

  lowAmmo(): void {
    this.tone({ freq: 1500, to: 1100, duration: 0.06, level: 0.07, type: 'square' });
  }

  /** Drives the low-health heartbeat. 0 disables it. */
  setHeartbeat(intensity: number): void {
    this.heartbeatRate = intensity;
  }

  update(dt: number): void {
    if (this.heartbeatRate <= 0.01 || !this.ctx) return;
    this.heartbeatT -= dt;
    if (this.heartbeatT > 0) return;
    // Faster and louder the closer to death you are.
    const period = 1.05 - this.heartbeatRate * 0.45;
    this.heartbeatT = period;
    const level = 0.1 + this.heartbeatRate * 0.24;
    this.tone({ freq: 62, to: 38, duration: 0.14, level, type: 'sine' });
    this.tone({ freq: 54, to: 34, duration: 0.13, level: level * 0.72, type: 'sine', delay: 0.19 });
  }

  dispose(): void {
    this.master?.disconnect();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.tail = null;
  }
}
