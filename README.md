# Rotwave Protocol

**An original, browser-based 3D wave-survival shooter.** React 18 + TypeScript + Three.js, WebGL2,
no game engine, no physics engine, and **no asset files of any kind** - every model, texture,
animation clip and sound is generated in code at load time.

> This is an **original game**, inspired by the wave-survival genre. It contains no
> Activision / Call of Duty intellectual property: no trademarked names, no characters or
> likenesses, no reproduced level layouts, no ripped audio, no extracted assets. See the IP Risk
> Register in [`ARCHITECTURE.md`](./ARCHITECTURE.md#9-ip-risk-register).

---

## What it is

The evacuation left you behind in **Blackpine District**, Sector 7. *The Blighted* come in waves
and they do not get tired. Kills and damage pay points; points buy hardware from wall-mounted
**Requisition Panels**, ammo from the **Ammo Cache**, a damage upgrade at the **Retool Bench**, and
roller shutters into new ground. New ground also means new spawn breaches, which is the trade you
keep having to make.

Three connected areas, unlocked in order:

| Area | Character | Unlock |
|---|---|---|
| **Kessler Street** | Open carriageway, sodium lamps, dead cars, boarded shopfronts | start |
| **Marrow Alley** | Cramped damp service lane, one failing fluorescent, emergency red | 750 pts |
| **Ferrus Parking** | Low concrete ceiling, pillar forest, best chokepoint on the map | 1250 pts |

Four weapons, all original designs: **Sidewinder M1** (service pistol, semi), **Hornet SR-9** (SMG,
auto), **Breaker 12** (pump shotgun, 9 pellets, overpenetrates), **Trench Fang** (quick-melee knife
that never costs you your gun). Three enemy kinds: shambler, runner, brute.

## Running it locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build to dist/
npm run preview    # serve the production build
npm run typecheck  # tsc --noEmit
```

Node 18+ and a WebGL2 browser (any current Chrome, Edge, Firefox, or Safari 16+). Nothing is
fetched at runtime, so it works fully offline after `npm install`.

First load spends roughly **3-6 seconds generating assets** behind the progress bar: ~30 PBR
material sets, the decal and sprite atlas, the whole city merged per material, a rigged skinned
zombie, four weapon viewmodels, then a PMREM environment bake and a shader warm-up pass. That is
deliberate - see *Asset loading* below.

### Controls

| | |
|---|---|
| `W` `A` `S` `D` | Move |
| Mouse | Look (click the canvas to lock the pointer) |
| `Shift` | Sprint (drains stamina, blocked while aiming) |
| `Space` / `Ctrl` | Jump / crouch |
| Left / right click | Fire / aim down sights |
| `R` | Reload (auto-reloads on empty) |
| `V` or `F` | Quick melee - Trench Fang |
| `1` `2` `3` / `Q` | Select / cycle weapon |
| `E` | Buy, refill, upgrade, open shutter |
| `M` | Mute |
| `Esc` | Release cursor (auto-pauses) |
| `F3` | Performance overlay |

Headshots pay 2.6x damage and double points. Chokepoints are the entire game: the Blighted use
local steering rather than perfect pathing, so they crowd and clog in doorways. Train them into a
line, then walk backwards and cut through them.

## How the code is organised

The hard rule, enforced by convention and visible in the imports: **`src/game/**` never imports
`src/engine/**`, never imports `three`, and never touches the DOM.** It deals in plain numbers and
plain vectors. That is what makes the simulation testable, deterministic, and framerate-independent.

```
src/
  main.tsx            React root (no StrictMode - it would build the scene twice)
  App.tsx             The ONLY React state machine: which screen is showing
  types.ts            The React <-> engine contract (HudSnapshot, Settings, RunResult)

  ui/                 2D overlays. Plain CSS only, no Tailwind, no component library
    MainMenu · ControlsPanel · LoadingScreen · HUD · PauseOverlay · PerfOverlay · GameOver

  react/
    GameCanvas.tsx    Mounts ONCE, hands the canvas to the engine, disposes on teardown
    useHudStore.ts    The whole bridge: ~50 lines of pub/sub, no state library

  engine/             Everything that knows about Three.js
    Engine.ts         Owns rAF, the fixed-step accumulator, the event drain, the HUD publish
    RendererHost.ts   WebGL2 context, ACES tone mapping, PMREM env, post chain, auto-degrade
    CameraRig.ts      FPS camera: headbob, spring recoil, ADS FOV, directional hit kick
    ViewModel.ts      First-person weapon: sway, action cycling, reload, swap, knife swing
    ZombieRenderer.ts Shared geometry, per-slot materials, LOD animation budget
    Fx.ts             Pooled instanced tracers, decals, sparks, mist, casings
    LightPool.ts      Five real PointLights, repositioned rather than toggled
    Input.ts          Pointer lock, accumulated mouse deltas, lock-loss auto-pause
    AudioBus.ts       Fully synthesised WebAudio. Zero sample files
    PerfMonitor.ts    p50/p95 frametime, sustained-overrun degrade trigger

  game/               PURE simulation. No renderer, no Three.js, no DOM
    World.ts          Owner of all hot state; one fixed 60Hz step
    Player.ts         Quake-lineage movement, stamina, regen-after-delay health
    Zombie.ts Horde.ts WaveDirector.ts Economy.ts Interaction.ts events.ts
    weapons/          Arsenal (fire state machine) + ballistics (hitscan, spread, penetration)
    nav/              Waypoint graph + Dijkstra flow field, recomputed 4Hz for the whole horde
    physics/          AABB, sphere, spatial hash, character controller. Hand-rolled

  content/            Data, not logic
    level.city.ts     The entire map: slabs, blocks, doors, stations, spawns, lamps, props, nav
    weapons.data.ts   Stats, prices, recoil, audio voices
    waves.data.ts     Per-wave count/speed/health curves and scoring

  procgen/            High-quality generated content
    textures/         ~30 canvas PBR material sets (albedo + normal + roughness + emissive)
    ZombieFactory.ts  21-bone rigged skinned humanoid + procedural bone-curve animation
    WeaponFactory.ts  Four part-built viewmodels with action/magazine/muzzle anchors
    PropFactory.ts    24 prop builders; CityBuilder.ts merges the map per zone per material

  util/               Vector maths, seeded RNG, pools
```

### The three decisions worth knowing

**Fixed 60Hz timestep with interpolated rendering.** `Engine.frame` accumulates real time, clamps
any frame to 250ms (the alt-tab guard), and runs whole 1/60s simulation steps. Rendering
interpolates between the last two states with an `alpha`. Collision, AI, fire rate and wave pacing
are therefore identical at 30, 60 and 144fps. One-shot inputs are consumed after the first
sub-step, so a double-step frame cannot fire your weapon twice.

**React never renders during play.** `GameCanvas` mounts once and is never re-rendered by parent
state. The engine mutates a HUD draft object (free - plain property writes) and flushes an immutable
snapshot at ~10Hz, or immediately when a one-shot marker fires. So the HUD re-renders about ten
times a second instead of sixty, and the render loop never enters the reconciler. Restarting a run
recycles the engine rather than remounting the canvas, because remounting is how browser games lose
their WebGL context.

**No physics engine, on purpose.** We have no stacking, no joints, no ragdolls and no dynamic rigid
bodies. Rapier would cost ~1MB of wasm and a second simulation clock to reconcile with our fixed
step, to give us kinematic sphere-vs-AABB tests that fit in ~150 readable lines. Colliders are
derived from the same level data the renderer consumes, so a visible wall and its collider cannot
drift apart. Bullets are hitscan with analytic ray-vs-sphere against a four-sphere hit model
(head / torso / hips / legs).

Full reasoning, including the options rejected and why: [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Asset sources and licences

**Everything is procedural and original.** There are no `.gltf`, `.png`, `.hdr`, `.wav` or `.mp3`
files in this repository, and nothing is downloaded at runtime.

- **Materials** - ~30 PBR sets built on canvas at 256-512px: tileable value-noise FBM, Sobel
  height-to-normal baking, and per-material roughness/metalness masks. Asphalt, brick, stucco, lit
  window facades, concrete, painted and rusted steel, roller shutter, chainlink, timber, car paint,
  Blighted skin, cloth.
- **Characters** - `ZombieFactory` builds a 21-bone skeleton and a ~5k-triangle skinned mesh, with
  automatic smooth skin weighting from bone-segment distance. Animation is procedural bone curves:
  emerge, lurch walk with per-instance limp, wind-up, strike, stagger, collapse.
- **Weapons** - `WeaponFactory` builds each viewmodel from real parts at real scale, with a hard
  material split between machined steel, moulded polymer and timber.
- **Audio** - `AudioBus` synthesises every sound from one shared noise buffer plus oscillators and
  filters. A gunshot is four layers: transient crack, filtered body, low thump, reverberant tail.
- **Environment lighting** - a procedural gradient sky plus emissive panels, convolved once by
  `PMREMGenerator` into a real irradiance and specular cube.

A hot-swappable CC0 upgrade path (Poly Haven, ambientCG, Quaternius, Kenney) is documented in
[`ASSETS.md`](./ASSETS.md) along with the licensing rules. Nothing has been taken from it, and
nothing needs to be.

**Code: MIT** (see [`LICENSE`](./LICENSE)). Generated assets: same, since they are source code.

## Performance: budget, and what we fake

Target is **60fps at 1080p on a mid-range laptop GPU** (Iris Xe / MX550 / M1 base): roughly 12ms
GPU, 5ms CPU. Measured budget is `< 180` draw calls and `< 500k` visible triangles, verified with
the `F3` overlay, which reports p50/p95 frametime rather than instantaneous FPS - a steady 55fps is
fine, 60fps with a 40ms hitch every second is not.

### Not feasible in WebGL, and what ships instead

| Wanted | What we actually do |
|---|---|
| Real-time global illumination | PMREM image-based lighting + a palette-matched hemisphere light + AO baked into the roughness/albedo maps. Reads as bounced light; costs one bake. |
| Ray-traced reflections / SSR | Environment-cube reflections broken up by roughness maps. Wet asphalt gets `envMapIntensity` and a gloss mask, not a reflection pass. |
| Area / ray-traced shadows | **One** shadow-casting light (the moon), PCF-soft, `shadow.autoUpdate = false`. The map is static, so the shadow map renders once and only re-renders when a shutter moves. |
| Zombies casting real shadows | Instanced blob contact-shadow quads. A second shadow caster is a whole extra scene pass; the blob looks better up close anyway. |
| Dozens of high-poly animated zombies | 24 pooled slots, hard cap ~16 on screen, sharing **one** geometry and **one** skin-weight solve. Nearest N pose every frame, mid-range every 2nd, far every 4th, off-screen not at all. Wave pressure comes from spawn rate, speed and health, not raw simultaneous count. |
| Skinned `InstancedMesh` (one draw call for the horde) | Not done. Vertex animation textures would work and would be a real win, but they kill per-zombie animation blending. Documented upgrade path if profiling ever says we are skinning-bound. |
| Volumetric god rays | Emissive geometry through a high-threshold bloom, plus fog. |
| Screen-space subsurface skin | `sheen` + a warm grazing highlight on the skin material. |
| 4K PBR textures | 256-512px generated sets. A single 4K PBR set is ~50MB decompressed; all ~30 of ours fit in a few MB of VRAM with no upload hitch. |
| Ragdolls, cloth, destructible cover | Out of v1 scope. Death is a blended collapse, then the body sinks through the floor (no transparency sort artefacts when bodies pile up). |

### The optimisations that actually bought the budget

- **Per-zone, per-material merging.** The whole city - walls, kerbs, road markings, ~100 props,
  shutters, panels - lands at roughly 60 draw calls instead of the 800+ an object-per-prop graph
  would produce.
- **Zone portal culling.** Areas you cannot see from your current area are hidden with one boolean,
  which roughly halves the worst-case scene.
- **A fixed pool of five point lights**, repositioned to the nearest fixtures. Toggling light
  `.visible` instead would change `numPointLights`, which is baked into every compiled material -
  a guaranteed multi-hundred-millisecond recompile stall every time you walk past a lamp. Same
  reason the muzzle-flash light is permanent and animated by intensity.
- **Zero steady-state allocation.** Zombies, tracers, decals, sparks, casings and particles are all
  pooled at load and recycled forever. Vector maths uses module-scoped scratch objects, because
  `new THREE.Vector3()` inside `update()` is the number one source of GC saw-tooth in Three.js.
- **A real warm-up pass.** `PMREMGenerator` bake, `renderer.compile()`, then one forced render with
  every material, every weapon and several zombies visible. Skip this and the first shot and first
  spawn each cost a 100-400ms freeze.
- **Staged auto-degrade** on *sustained* overrun only (~1.5s of slow frames, recovering twice as
  fast as it accumulates): bloom off, then render scale to 0.8, then 0.66, then shadows off. The
  player is told once, via a HUD toast.
- **ACESFilmic tone mapping, sRGB output, physically-scaled light intensities.** Not an
  optimisation, but the single biggest reason this does not look like a 2005 Flash game. Realism
  here is roughly 70% lighting and tone-mapping discipline, 30% asset quality.

## Known limitations

- **The viewmodel is parented to the camera**, not drawn in a separate overlay pass. With a 5cm near
  plane it never clips the world unless you physically press into a wall. A second pass would be
  more correct and would not survive the post chain cleanly; this was the better trade.
- **No animation blend trees.** Zombie animation is procedural bone curves with per-instance phase,
  limp and posture variation. Transitions are cross-faded by hand, not by a state machine.
- **Navigation is a 28-node waypoint graph plus local steering**, not a navmesh. Zombies will crowd
  and jostle in doorways. That is a feature of the genre, but it does mean they are not smart.
- **AABB colliders only.** Rotated props snap their footprint on quarter turns; there are no
  oriented boxes, so a diagonally-parked car has a slightly generous collider.
- **Deterministic-per-seed, not replay-safe.** The simulation is deterministic for a given seed and
  input sequence, but nothing records inputs, so there is no replay or spectator system.
- **Single-player only.** No netcode anywhere, by design.
- **Mobile is unsupported.** It needs pointer lock and a keyboard.

## Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) - the reasoning written *before* the code: game loop, state
  management, collision, the rendering performance budget, asset loading, and the IP risk register.
- [`ASSETS.md`](./ASSETS.md) - asset provenance, licensing rules, and the CC0 upgrade path.
