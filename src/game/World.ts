import { Rng } from '../util/rng';
import type { RunResult } from '../types';
import {
  buildColliders,
  PLAYER_START,
  SPAWNS,
  WAYPOINT_EDGES,
  WAYPOINTS,
  type Zone,
} from '../content/level.city';
import { WEAPONS } from '../content/weapons.data';
import type { Collider } from './physics/aabb';
import { SpatialHash } from './physics/SpatialHash';
import type { MoveContext } from './physics/CharacterController';
import { WaypointGraph } from './nav/WaypointGraph';
import { EventQueue } from './events';
import { Player, type PlayerInput } from './Player';
import { Horde } from './Horde';
import { WaveDirector } from './WaveDirector';
import { Economy } from './Economy';
import { findPrompt, resolveInteract, type Prompt } from './Interaction';
import { fireShot, meleeSwing, type FireContext } from './weapons/ballistics';

/**
 * The simulation.
 *
 * Everything in here is mutable, pre-allocated hot state that React never sees.
 * `step()` is called from the engine's fixed-timestep accumulator at exactly
 * 60Hz, so all of this is framerate-independent and deterministic for a given
 * seed and input sequence.
 *
 * Deliberately imports nothing from `src/engine/**` and nothing from `three`.
 */
export class World {
  readonly colliders: Collider[];
  readonly hash: SpatialHash;
  readonly graph: WaypointGraph;
  readonly ctx: MoveContext;

  readonly player = new Player();
  readonly horde = new Horde();
  readonly waves = new WaveDirector();
  readonly economy = new Economy();
  readonly events = new EventQueue();

  readonly openDoors = new Set<string>();
  readonly unlockedZones = new Set<Zone>(['street']);

  /** Simulated seconds since the run began. */
  runTime = 0;
  /** Current contextual prompt, republished to the HUD by the engine. */
  prompt: Prompt | null = null;

  private readonly rng = new Rng(0x5eed);
  private flowT = 0;
  private lastFlowTarget = -1;
  private readonly fireCtx: FireContext;

  constructor() {
    this.colliders = buildColliders();
    this.hash = new SpatialHash(3, this.colliders.length + 8);
    for (let i = 0; i < this.colliders.length; i++) this.hash.insert(i, this.colliders[i]);

    this.graph = new WaypointGraph(WAYPOINTS, WAYPOINT_EDGES);

    this.ctx = {
      colliders: this.colliders,
      hash: this.hash,
      openDoors: this.openDoors,
      scratch: [],
    };

    this.fireCtx = {
      zombies: this.horde.zombies,
      ctx: this.ctx,
      events: this.events,
      economy: this.economy,
      player: this.player,
      rng: this.rng,
    };
  }

  get phase() {
    return this.waves.phase;
  }

  /** Start (or restart) a run. The scene and all GPU resources are reused. */
  reset(seed = Date.now() & 0xffffff): void {
    this.rng.reseed(seed);
    this.openDoors.clear();
    this.unlockedZones.clear();
    this.unlockedZones.add('street');
    this.horde.releaseAll();
    this.horde.reseed(seed ^ 0x9e3779b9);
    this.waves.reset(seed ^ 0x85ebca6b);
    this.economy.reset();
    this.events.clear();
    this.player.reset(PLAYER_START.x, PLAYER_START.y, PLAYER_START.z, PLAYER_START.yaw);
    this.runTime = 0;
    this.prompt = null;
    this.flowT = 0;
    this.lastFlowTarget = -1;
    this.recomputeFlow();
  }

  private recomputeFlow(): void {
    const target = this.graph.nearest(this.player.pos.x, this.player.pos.z);
    this.lastFlowTarget = target;
    this.graph.computeFlow(target, this.openDoors);
  }

  /**
   * One fixed simulation step. Order matters:
   *   player -> shooting -> horde -> waves -> interaction
   * so a zombie killed by this step's bullet cannot also land a hit in it.
   */
  step(dt: number, input: PlayerInput): void {
    if (this.waves.phase !== 'dead') this.runTime += dt;

    // 1. Player movement + weapon timers.
    this.player.update(dt, input, this.ctx, this.events);
    const intent = this.player.arsenal.lastIntent;

    // 2. Resolve weapon output.
    if (!this.player.dead) {
      if (intent.shots > 0) {
        fireShot(this.fireCtx, this.player.arsenal.spec, this.player.arsenal.spreadRadians());
      }
      if (intent.melee) {
        meleeSwing(this.fireCtx, this.player.arsenal.meleeSpec);
      }
    }

    // 3. Navigation flow field, ~4Hz. 28 nodes of Dijkstra is a rounding error,
    //    and doing it once for the whole horde is what makes per-zombie nav free.
    this.flowT -= dt;
    if (this.flowT <= 0) {
      this.flowT = 0.25;
      const target = this.graph.nearest(this.player.pos.x, this.player.pos.z);
      if (target !== this.lastFlowTarget) {
        this.lastFlowTarget = target;
        this.graph.computeFlow(target, this.openDoors);
      }
    }

    // 4. Horde AI + contact damage.
    this.horde.update(dt, this.player, this.graph, this.ctx, this.events);

    // 5. Wave pacing and spawning.
    this.waves.update(dt, this.horde, this.player, this.economy, SPAWNS, this.unlockedZones, this.events);

    // 6. Interaction.
    this.prompt = this.player.dead ? null : findPrompt(this.player, this.economy, this.openDoors);
    if (input.interactPressed && this.prompt) {
      const res = resolveInteract(this.prompt, this.player, this.economy, this.openDoors, this.events);
      if (res.unlockedZone) this.unlockedZones.add(res.unlockedZone);
      if (res.openedDoor) {
        // The shutter was both a collider and a set of graph edges. Both change
        // in the same instant, so re-plan immediately rather than waiting 250ms.
        this.recomputeFlow();
        for (const z of this.horde.zombies) z.replanT = 0;
      }
    }
  }

  /** Scorecard for the game-over screen. */
  result(): RunResult {
    const a = this.player.arsenal;
    let bestWeapon = WEAPONS[a.current].name;
    if (a.slot.upgraded) bestWeapon = `Retooled ${bestWeapon}`;
    return {
      wave: this.waves.wave,
      points: this.economy.points,
      kills: this.player.kills,
      headshots: this.player.headshots,
      meleeKills: this.player.meleeKills,
      shotsFired: this.player.shotsFired,
      shotsHit: this.player.shotsHit,
      timeSurvived: this.runTime,
      bestWeapon,
    };
  }
}
