import * as THREE from 'three';
import type { LoadProgress, RunResult, Screen, Settings } from '../types';
import type { HudStore } from '../react/useHudStore';
import { World } from '../game/World';
import { emptyInput, type PlayerInput } from '../game/Player';
import { LAMPS, STATIONS, zoneAt, type Zone } from '../content/level.city';
import { effectiveSpec, WEAPONS } from '../content/weapons.data';
import { buildMaterials, disposeMaterials, type MaterialLib } from '../procgen/textures/materials';
import { buildSprites, type SpriteLib } from '../procgen/textures/sprites';
import { buildCity, type CityBuild } from '../procgen/CityBuilder';
import { RendererHost } from './RendererHost';
import { CameraRig } from './CameraRig';
import { Input } from './Input';
import { PerfMonitor } from './PerfMonitor';
import { LightPool } from './LightPool';
import { ZombieRenderer } from './ZombieRenderer';
import { ViewModel } from './ViewModel';
import { Fx } from './Fx';
import { AudioBus } from './AudioBus';
import { clamp01, damp } from '../util/vec';

/**
 * The engine.
 *
 * Owns the single requestAnimationFrame loop, and the fixed-timestep accumulator
 * inside it. React never enters this file's call stack during a frame.
 *
 *   frameTime = min(now - last, 250ms)     <- alt-tab guard
 *   accumulator += frameTime
 *   while accumulator >= 1/60: simulate(1/60)
 *   alpha = accumulator / (1/60)
 *   render(alpha)                          <- interpolated
 *
 * The 250ms clamp is what stops the classic "alt-tab for thirty seconds, come
 * back, 1800 physics steps run in one frame, browser freezes, zombies teleport
 * into your face" failure.
 */

const STEP = 1 / 60;
const MAX_FRAME = 0.25;
const MAX_STEPS_PER_FRAME = 5;
const HUD_INTERVAL = 0.1;

export interface EngineCallbacks {
  onProgress(p: LoadProgress): void;
  onScreen(screen: Screen): void;
  onGameOver(result: RunResult): void;
  onNotice(message: string): void;
}

type Mode = 'menu' | 'playing' | 'gameover';

export class Engine {
  // --- Rendering ----------------------------------------------------------
  private readonly scene = new THREE.Scene();
  private readonly rig = new CameraRig();
  private readonly host: RendererHost;
  private readonly sun: THREE.DirectionalLight;
  private readonly sky: THREE.HemisphereLight;

  // --- Content ------------------------------------------------------------
  private readonly lib: MaterialLib;
  private readonly sprites: SpriteLib;
  private readonly city: CityBuild;
  private readonly zombies: ZombieRenderer;
  private readonly viewModel: ViewModel;
  private readonly fx: Fx;
  private readonly lights: LightPool;

  // --- Simulation ---------------------------------------------------------
  readonly world = new World();
  private readonly input: Input;
  private readonly playerInput: PlayerInput = emptyInput();
  private readonly perf = new PerfMonitor();
  readonly audio = new AudioBus();

  // --- Loop state ---------------------------------------------------------
  private raf = 0;
  private lastTime = 0;
  private accumulator = 0;
  private clock = 0;
  private hudT = 0;
  private perfT = 0;
  private mode: Mode = 'menu';
  private paused = false;
  private disposed = false;
  private currentZone: Zone = 'street';
  private damageFlash = 0;
  private readonly look = { x: 0, y: 0 };

  private settings: Settings;

  private constructor(
    canvas: HTMLCanvasElement,
    private readonly hud: HudStore,
    private readonly cbs: EngineCallbacks,
    settings: Settings,
    lib: MaterialLib,
    sprites: SpriteLib,
  ) {
    this.settings = settings;
    this.lib = lib;
    this.sprites = sprites;

    // --- Scene ------------------------------------------------------------
    this.scene.name = 'Blackpine';
    // Exponential fog: the map is only 55m across, so linear fog would either
    // do nothing or swallow the far wall. Exp2 gives depth without a hard edge.
    this.scene.fog = new THREE.FogExp2(0x0a0d12, 0.021);
    this.scene.background = new THREE.Color(0x070a0e);

    // Hemisphere light = the cheap stand-in for sky bounce. Blue-grey from above,
    // warm sodium spill from below.
    this.sky = new THREE.HemisphereLight(0x2a3a55, 0x1a130c, 0.55);
    this.scene.add(this.sky);

    // ONE shadow-casting light for the whole game. Every additional one is
    // another full scene pass.
    this.sun = new THREE.DirectionalLight(0x93a8d0, 0.7);
    this.sun.position.set(34, 44, -26);
    this.sun.target.position.set(5, 0, 8);
    this.sun.castShadow = true;
    const cam = this.sun.shadow.camera;
    // One static frustum covering the entire 55x47m map. At 2048 that is ~3cm
    // per texel, so there is no need to make it follow the player.
    cam.left = -36;
    cam.right = 36;
    cam.top = 36;
    cam.bottom = -36;
    cam.near = 1;
    cam.far = 140;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.028;
    this.scene.add(this.sun, this.sun.target);

    this.host = new RendererHost(canvas, this.scene, this.rig.camera);
    this.scene.add(this.rig.camera);

    // --- Content ----------------------------------------------------------
    this.city = buildCity(lib, sprites);
    this.scene.add(this.city.root);

    this.fx = new Fx(this.scene, sprites);
    this.zombies = new ZombieRenderer(this.scene, lib, sprites);
    this.viewModel = new ViewModel(this.rig.camera, this.scene, lib, sprites, this.fx);
    this.lights = new LightPool(this.scene, LAMPS);

    this.input = new Input(canvas);

    this.applySettings(settings);
  }

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * Build everything, then warm up.
   *
   * The warm-up is the step most projects skip and then spend a week debugging:
   * without it the first zombie spawn and the first shot each cost a 100-400ms
   * freeze while shaders compile and textures upload. With it, frame one of
   * gameplay is as smooth as frame one thousand.
   */
  static async create(
    canvas: HTMLCanvasElement,
    hud: HudStore,
    cbs: EngineCallbacks,
    settings: Settings,
  ): Promise<Engine> {
    const step = async (label: string, value: number) => {
      cbs.onProgress({ label, value });
      // Yield so the loading bar actually paints between phases.
      await new Promise<void>((r) => setTimeout(r, 0));
    };

    const lib = await buildMaterials(step);
    await step('Cutting decals and signage', 0.975);
    const sprites = buildSprites();

    await step('Raising Blackpine District', 0.98);
    const engine = new Engine(canvas, hud, cbs, settings, lib, sprites);

    await step('Compiling shaders', 0.99);
    await engine.warmUp();

    await step('Ready', 1);
    return engine;
  }

  /**
   * Force every shader variant to compile and every texture to upload, before
   * the player can see a frame.
   */
  private async warmUp(): Promise<void> {
    // Make one of everything visible directly in front of the camera.
    this.rig.camera.position.set(0, 1.6, 0);
    this.rig.camera.rotation.set(0, 0, 0);
    for (const g of Object.values(this.city.zoneGroups)) g.visible = true;
    const models = this.viewModel.allObjects();
    for (const m of models) m.visible = true;

    // Spawn one zombie of each kind so the skinning shader variant compiles.
    this.world.reset(1);
    for (const kind of ['shambler', 'runner', 'brute'] as const) {
      this.world.horde.spawn(kind, [{ id: 'warm', zone: 'street', x: 0, z: -3, kind: 'grate', yaw: 0 }], new Set(['street']), this.world.player, 1, 1, this.world.events);
    }
    this.zombies.sync(0.016, this.world.horde.zombies, 0, this.rig.camera, 24);

    // Fire one of every FX so their materials and buffers are hot.
    this.fx.tracer(0, 1.5, 0, 0, 1.5, -6);
    this.fx.impact(0, 1.5, -6, 0, 0, 1);
    this.fx.blood(0, 1.4, -3, 0, 0, -1, true);
    this.fx.ejectCasing(0.3, 1.4, 0, 1, 0);
    this.fx.update(0.016);

    // This is the line that does the real work.
    this.host.renderer.compile(this.scene, this.rig.camera);
    // ...and this forces the actual texture uploads and one pass through every
    // post-processing stage.
    this.host.render(0);
    await new Promise<void>((r) => setTimeout(r, 0));

    // Tear the warm-up state back down.
    this.world.horde.releaseAll();
    this.zombies.clear();
    this.fx.clear();
    for (const m of models) m.visible = false;
    this.world.events.clear();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  applySettings(s: Settings): void {
    const qualityChanged = s.quality !== this.settings.quality;
    this.settings = s;
    this.audio.setMuted(s.muted);
    if (qualityChanged || this.host.quality.renderScale === undefined) {
      this.host.setQuality(s.quality);
      const aniso = this.host.quality.anisotropy;
      // Anisotropy is a per-texture property, so apply it to everything at once.
      this.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const m of mats) {
          const map = (m as THREE.MeshStandardMaterial).map;
          if (map && map.anisotropy !== aniso) {
            map.anisotropy = aniso;
            map.needsUpdate = true;
          }
        }
      });
    }
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.host.setSize(cssWidth, cssHeight, dpr);
  }

  /** Enter the menu: live scene, slow crane camera, no simulation. */
  toMenu(): void {
    this.mode = 'menu';
    this.paused = false;
    this.input.setEnabled(false);
    this.input.releaseLock();
    this.viewModel.setVisible(false);
    for (const g of Object.values(this.city.zoneGroups)) g.visible = true;
    this.zombies.clear();
    this.fx.clear();
    this.audio.setHeartbeat(0);
    this.cbs.onScreen('menu');
  }

  /** Start (or restart) a run. Reuses every GPU resource. */
  startRun(): void {
    this.world.reset();
    this.zombies.clear();
    this.fx.clear();
    this.viewModel.reset();
    this.viewModel.setVisible(true);
    this.rig.reset(this.world.player.yaw);
    this.hud.reset();
    this.accumulator = 0;
    this.damageFlash = 0;
    this.perf.reset();
    this.mode = 'playing';
    this.paused = false;
    this.input.setEnabled(true);
    this.input.lockLost = false;
    this.input.requestLock();
    void this.audio.resume();
    this.publishHud(true);
    this.cbs.onScreen('playing');
  }

  setPaused(v: boolean): void {
    if (this.mode !== 'playing') return;
    this.paused = v;
    this.hud.set({ paused: v });
    this.hud.flush();
    if (v) this.input.releaseLock();
    else {
      this.input.lockLost = false;
      this.input.requestLock();
    }
  }

  get isPaused(): boolean {
    return this.paused;
  }

  requestLock(): void {
    this.input.requestLock();
  }

  get perfStats(): PerfMonitor {
    return this.perf;
  }

  start(): void {
    if (this.raf) return;
    this.lastTime = performance.now();
    const loop = (now: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // -----------------------------------------------------------------------
  // The loop
  // -----------------------------------------------------------------------

  private frame(nowMs: number): void {
    const frameMs = nowMs - this.lastTime;
    this.lastTime = nowMs;
    // Clamp: an alt-tab must not queue up thousands of simulation steps.
    const frameTime = Math.min(frameMs / 1000, MAX_FRAME);
    this.clock += frameTime;

    this.perf.sample(frameMs);
    this.perfT += frameTime;
    if (this.perfT > 0.25) {
      this.perfT = 0;
      this.perf.recompute();
      this.perf.readRenderer(this.host.renderer.info);
    }
    if (this.mode === 'playing' && !this.paused && this.perf.shouldDegrade(frameMs)) {
      const note = this.host.degrade();
      if (note) this.cbs.onNotice(note);
    }

    // --- Menu: no simulation, just a slow crane over the street -----------
    if (this.mode === 'menu') {
      this.rig.menuUpdate(this.clock);
      this.animateWorld(frameTime);
      this.lights.update(frameTime, this.clock, 0, 2, 0, new Set(['street', 'alley', 'garage']));
      this.host.render(this.clock);
      return;
    }

    // --- Pointer lock lost mid-run: pause instead of dying ----------------
    if (this.input.lockLost && !this.paused) {
      this.input.lockLost = false;
      this.setPaused(true);
    }
    if (this.input.locked && this.paused) this.setPaused(false);

    if (this.paused) {
      this.animateWorld(frameTime);
      this.host.render(this.clock);
      return;
    }

    // --- Look, at render rate --------------------------------------------
    this.input.takeLook(this.look);
    const ads = this.world.player.arsenal.ads;
    this.rig.look(this.look.x, this.look.y, this.settings.sensitivity, this.settings.invertY, ads);
    this.viewModel.addLook(this.look.x, this.look.y);

    // --- Fixed-step simulation -------------------------------------------
    this.buildInput();
    this.accumulator += frameTime;
    let steps = 0;
    while (this.accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
      this.world.step(STEP, this.playerInput);
      this.accumulator -= STEP;
      steps++;
      // One-shot inputs must not fire on more than one sub-step.
      this.consumeOneShots();
    }
    // If we hit the step cap the machine cannot keep up; drop the backlog rather
    // than accumulating a debt we will never repay.
    if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0;
    const alpha = clamp01(this.accumulator / STEP);

    // --- Drain simulation events into audio and FX ------------------------
    this.drainEvents();

    // --- Render-rate presentation ----------------------------------------
    this.rig.update(frameTime, this.world.player, alpha, ads);
    this.viewModel.update(frameTime, this.world.player, this.world.player.arsenal);
    this.fx.update(frameTime);
    this.zombies.sync(frameTime, this.world.horde.zombies, alpha, this.rig.camera, this.host.quality.animBudget);

    const p = this.world.player;
    this.audio.setListener(p.pos.x, p.eyeY, p.pos.z, this.rig.yaw);
    this.audio.update(frameTime);
    this.lights.update(frameTime, this.clock, p.pos.x, p.eyeY, p.pos.z, this.world.unlockedZones);

    this.updateZoneVisibility();
    this.animateWorld(frameTime);
    this.updateGrade(frameTime);

    // --- HUD, at ~10Hz ---------------------------------------------------
    this.hudT += frameTime;
    if (this.hudT >= HUD_INTERVAL) {
      this.hudT = 0;
      this.publishHud(false);
    }

    // --- Death ------------------------------------------------------------
    if (this.world.phase === 'dead' && this.mode === 'playing') {
      this.mode = 'gameover';
      this.input.setEnabled(false);
      this.input.releaseLock();
      this.audio.setHeartbeat(0);
      this.audio.death();
      this.publishHud(true);
      this.cbs.onGameOver(this.world.result());
      this.cbs.onScreen('gameover');
    }

    this.host.render(this.clock);
  }

  /** Translate raw device state into the simulation's input struct. */
  private buildInput(): void {
    const i = this.playerInput;
    i.moveX = this.input.moveX;
    i.moveZ = this.input.moveZ;
    i.yaw = this.rig.yaw;
    i.pitch = this.rig.pitch;
    i.jump = this.input.jump;
    i.sprint = this.input.sprint;
    i.crouch = this.input.crouch;
    i.fire = this.input.mouseLeft;
    i.firePressed = this.input.takeFirePressed();
    i.ads = this.input.mouseRight;
    i.reload = this.input.reloadPressed;
    i.melee = this.input.meleePressed;
    i.interact = this.input.interact;
    i.interactPressed = this.input.interactPressed;
    i.switchTo = this.input.switchTo;
    i.cycle = this.input.cycleWeapon;
  }

  private consumeOneShots(): void {
    const i = this.playerInput;
    i.firePressed = false;
    i.interactPressed = false;
    i.reload = false;
    i.melee = false;
    i.switchTo = null;
    i.cycle = false;
  }

  // -----------------------------------------------------------------------
  // Event drain: the only place the simulation reaches the presentation layer
  // -----------------------------------------------------------------------

  private drainEvents(): void {
    const arsenal = this.world.player.arsenal;
    this.world.events.drain((e) => {
      switch (e.type) {
        case 'shot': {
          const spec = effectiveSpec(e.weapon, e.upgraded);
          this.audio.gunshot(spec, e.upgraded);
          this.rig.addRecoil(spec.recoilPitch, spec.recoilYaw);
          this.viewModel.onShot(e.weapon, spec.recoilPitch, spec.kick, spec.mode === 'pump');
          break;
        }
        case 'dryfire':
          this.audio.dryfire();
          break;
        case 'tracer':
          this.fx.tracer(e.x0, e.y0, e.z0, e.x1, e.y1, e.z1);
          break;
        case 'impactWorld':
          this.fx.impact(e.x, e.y, e.z, e.nx, e.ny, e.nz);
          this.audio.impact(e.x, e.y, e.z);
          break;
        case 'impactFlesh':
          this.fx.blood(e.x, e.y, e.z, e.dx, e.dy, e.dz, e.zone === 'head');
          this.audio.flesh(e.x, e.y, e.z, e.zone === 'head');
          break;
        case 'hitmarker':
          this.hud.bump(e.headshot ? 'headshotMarker' : 'hitmarker');
          this.audio.hitmarker(e.headshot);
          break;
        case 'kill':
          // Nothing extra: the impact and flesh events already fired. Keeping
          // kills quiet is what makes headshot stings read clearly.
          break;
        case 'reloadStart':
          this.audio.reloadStart();
          break;
        case 'reloadEnd':
          this.audio.reloadEnd();
          break;
        case 'pump':
          this.audio.pump();
          this.viewModel.onPump();
          break;
        case 'melee':
          this.audio.meleeSwing();
          break;
        case 'meleeHit':
          this.audio.meleeHit();
          this.rig.addShake(0.35);
          break;
        case 'switchWeapon':
          this.audio.weaponSwap();
          break;
        case 'footstep':
          this.audio.footstep(e.sprint);
          break;
        case 'jump':
          this.audio.jump();
          break;
        case 'land':
          this.audio.land(e.force);
          break;
        case 'zombieSpawn':
          this.fx.muzzleDebris(e.x, e.y + 0.1, e.z, 0, 1, 0);
          break;
        case 'zombieGroan':
          this.audio.groan(e.x, e.y, e.z, e.kind);
          break;
        case 'zombieSwing':
          this.audio.zombieSwing(e.x, e.y, e.z);
          break;
        case 'playerHurt': {
          this.audio.hurt();
          this.damageFlash = 1;
          this.hud.bump('damageTick');
          // Kick the view away from whoever hit us.
          const dx = e.fromX - this.world.player.pos.x;
          const dz = e.fromZ - this.world.player.pos.z;
          const d = Math.hypot(dx, dz) || 1;
          const fx = -Math.sin(this.rig.yaw);
          const fz = -Math.cos(this.rig.yaw);
          const rx = Math.cos(this.rig.yaw);
          const rz = -Math.sin(this.rig.yaw);
          this.rig.addHit(e.amount, (dx / d) * fx + (dz / d) * fz, (dx / d) * rx + (dz / d) * rz);
          break;
        }
        case 'playerDead':
          break;
        case 'purchase':
          this.audio.purchase();
          this.hud.toast(`${e.label}  -${e.cost}`);
          break;
        case 'denied':
          this.audio.denied();
          this.hud.toast(e.reason);
          break;
        case 'doorOpen':
          this.audio.doorOpen();
          this.rig.addShake(0.4);
          this.hud.banner('Shutter Open', e.label);
          break;
        case 'waveStart':
          this.audio.waveStart(e.wave);
          this.hud.banner(`Wave ${e.wave}`, `${e.total} incoming`);
          break;
        case 'waveClear':
          this.audio.waveClear();
          this.hud.banner(`Wave ${e.wave} Cleared`, `+${e.bonus} points`);
          break;
        case 'lowAmmo':
          this.audio.lowAmmo();
          break;
        default:
          break;
      }
    });
    void arsenal;
  }

  // -----------------------------------------------------------------------
  // Presentation details
  // -----------------------------------------------------------------------

  /**
   * Portal culling. Show the zone the player is in, plus any neighbour whose
   * connecting shutter is open. For a three-area map this is all the occlusion
   * culling we need, and it roughly halves the worst-case scene.
   */
  private updateZoneVisibility(): void {
    const p = this.world.player;
    this.currentZone = zoneAt(p.pos.x, p.pos.z);
    const open = this.world.openDoors;
    const show = (z: Zone) => {
      if (z === this.currentZone) return true;
      if (this.currentZone === 'street') return z === 'alley' && open.has('shutter_alley');
      if (this.currentZone === 'alley') {
        return (z === 'street' && open.has('shutter_alley')) || (z === 'garage' && open.has('shutter_garage'));
      }
      return z === 'alley' && open.has('shutter_garage');
    };
    for (const zone of ['street', 'alley', 'garage'] as Zone[]) {
      this.city.zoneGroups[zone].visible = show(zone);
    }
  }

  /** Shutters, failing lights, and the affordability pulse on the panels. */
  private animateWorld(dt: number): void {
    // Shutters roll up into the lintel over about a second.
    for (const s of this.city.shutters) {
      const target = this.world.openDoors.has(s.id) ? 1 : 0;
      if (Math.abs(s.openness - target) > 0.0005) {
        s.openness = damp(s.openness, target, 3.2, dt);
        s.group.position.y = s.openness * s.travel;
        s.group.visible = s.openness < 0.995;
      }
    }

    // Failing fluorescents and sodium lamps. Emissive geometry only - the actual
    // illumination flicker lives in LightPool.
    for (const f of this.city.flickers) {
      const mat = f.mesh.material as THREE.MeshStandardMaterial;
      if (f.amount <= 0.001) {
        if (mat.emissiveIntensity !== f.base) mat.emissiveIntensity = f.base;
        continue;
      }
      const wobble = 1 - f.amount * 0.3 * (0.5 + 0.5 * Math.sin(this.clock * 41 + f.base));
      const dropout = Math.sin(this.clock * 3.3 + f.base * 2) > 0.985 - f.amount * 0.4 ? 1 - f.amount * 0.9 : 1;
      mat.emissiveIntensity = f.base * wobble * dropout;
    }

    // Requisition Panels pulse when you can afford them. This is the readability
    // trick that lets you learn what is purchasable from across the street
    // without reading a single word.
    const points = this.world.economy.points;
    const pulse = 1.9 + Math.sin(this.clock * 3.1) * 0.9;
    for (const st of STATIONS) {
      const glow = this.city.panelGlows.get(st.id);
      if (!glow) continue;
      const mat = glow.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = points >= st.cost ? pulse : 0.35;
    }
  }

  private updateGrade(dt: number): void {
    this.damageFlash = damp(this.damageFlash, 0, 3.4, dt);
    const u = this.host.gradeUniforms;
    const health = this.world.player.health01;
    // Below 45% health the frame starts to desaturate and the edges bleed.
    const critical = clamp01((0.45 - health) / 0.45);
    u.uDamage.value = this.damageFlash;
    u.uCritical.value = critical;
    this.audio.setHeartbeat(critical);
  }

  private publishHud(force: boolean): void {
    const p = this.world.player;
    const a = p.arsenal;
    const slot = a.slot;
    const spec = effectiveSpec(slot.id, slot.upgraded);
    const w = this.world.waves;
    const prompt = this.world.prompt;

    this.hud.set({
      health: Math.round(p.health),
      maxHealth: p.maxHealth,
      points: this.world.economy.points,
      wave: w.wave,
      phase: w.phase,
      clock: Math.max(0, Math.ceil(w.timer)),
      zombiesLeft: w.remaining,
      zombiesAlive: this.world.horde.countAlive(),
      weaponName: a.meleeT > 0 ? WEAPONS.fang.name : spec.name,
      weaponUpgraded: slot.upgraded,
      mag: slot.mag,
      magSize: spec.magSize,
      reserve: slot.reserve,
      reloading: a.reloading,
      melee: a.meleeT > 0,
      prompt: prompt ? prompt.label : null,
      promptCost: prompt ? prompt.cost : 0,
      promptAffordable: prompt ? prompt.affordable : false,
    });
    if (force) this.hud.flush();
    else this.hud.flush();
  }

  // -----------------------------------------------------------------------

  dispose(): void {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.input.dispose();
    this.audio.dispose();
    this.lights.dispose();
    this.viewModel.dispose();
    this.zombies.dispose();
    this.fx.dispose();
    this.city.dispose();
    this.sun.dispose();
    this.sky.dispose();
    disposeMaterials(this.lib);
    for (const t of Object.values(this.sprites)) t.dispose();
    this.host.dispose();
  }
}
