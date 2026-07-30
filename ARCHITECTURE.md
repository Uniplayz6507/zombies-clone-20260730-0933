# Rotwave Protocol - Architecture & Asset Strategy

> Working title: **Rotwave Protocol**. Original IP. No Activision names, characters, audio,
> level layouts, or trademarks (see "IP Risk Register" at the end).
>
> This document is written **before** any game code, per the project brief. It records the
> reasoning and the tradeoffs, not just the conclusions.

---

## 0. The one-paragraph summary

A first-person, single-player, wave-survival shooter running entirely in the browser on
Three.js + WebGL2. React owns **only** the 2D shell (menu, HUD, game-over). The simulation is a
plain TypeScript module graph driven by a fixed-timestep accumulator inside a single
`requestAnimationFrame` loop, mutating pre-allocated state that React never touches per frame.
Collision is hand-rolled: static AABB grid for the level, sphere/capsule for entities, hitscan
raycasts for bullets. Realism comes from PBR + IBL + one well-tuned shadow-casting light +
procedural detail maps, *not* from polygon count or real-time GI.

---

## 1. The game loop

### The options

**(a) React-driven loop - `useState` per frame.**
Dead on arrival. A 60fps sim means 60 React reconciliations per second, each one diffing a tree
and allocating fiber work. Even with `memo` everywhere you're burning 3-6ms/frame on bookkeeping
out of a 16.6ms budget, and GC pressure from per-frame object churn causes visible hitches. This
is the single most common way browser games die. Rejected.

**(b) Three.js `setAnimationLoop` / R3F `useFrame`, variable timestep.**
Simple, and what most Three.js demos do: `update(delta)` where `delta` is whatever the last frame
took. Problem: variable-timestep physics is non-deterministic and unstable. At 30fps a zombie
moving 4 m/s tunnels 13cm per step past a thin wall collider; at 144fps the same code produces
different knockback and different melee reach. Damage-over-time and spawn pacing drift with
framerate. Fine for a tech demo, not fine for a game where "did the zombie hit me" must be fair.

**(c) Fixed-timestep accumulator with interpolated rendering.** <- **chosen**

```
loop(now):
  frameTime = min(now - last, 250ms)   // clamp: tab-switch / alt-tab guard
  accumulator += frameTime
  while accumulator >= STEP:           // STEP = 1/60s
     simulate(STEP)                    // deterministic, framerate-independent
     accumulator -= STEP
  alpha = accumulator / STEP
  render(alpha)                        // interpolate visual transforms
```

Why this wins here:
- Deterministic sim. Collision, AI steering, wave pacing, and fire rate behave identically at
  30, 60, or 144fps.
- The 250ms clamp prevents the classic "alt-tab for 30s, come back, 1800 physics steps run in one
  frame, browser freezes, zombies teleport into your face" bug.
- Rendering can run *faster* than the sim (high-refresh monitors) and still look smooth via
  interpolation, and *slower* than the sim without breaking correctness.

Costs I'm accepting: two transform sets per interpolated entity (`prevPos`, `pos`) and slightly
more complex code. Worth it.

**Camera is deliberately excluded from the fixed step.** Mouse-look is sampled and applied at
render rate so aiming never feels like it's running at 60Hz on a 144Hz screen. Input is
accumulated as deltas between steps, so no input is dropped when two sim steps run in one frame.

**Single loop, not several.** One `requestAnimationFrame` owner (the renderer host). AI, spawning,
weapons, and wave logic are *called* by it as pure `update(dt, world)` functions. No `setInterval`
anywhere for gameplay - intervals drift, don't pause with the tab, and desync from the sim clock.
Wave intermission timers are sim-clock driven.

### React <-> Three.js: how the two render cycles actually interact

This is the part people get wrong, so, explicitly:

```
+----------------------------- React tree (renders rarely) ---------------------------+
|  <App>                                                                             |
|    <MainMenu/>  <HUD/>  <GameOver/>   <- plain DOM + CSS, absolutely positioned     |
|    <GameCanvas/>         <- mounts ONCE. Its React output is a bare <canvas>.       |
+------------------------------------------------------------------------------------+
                                     | (imperative handoff on mount, via useEffect)
                                     v
+-------------- Engine (owns rAF, never re-enters React per frame) -------------------+
|  Renderer . Scene graph . fixed-step sim . input . audio                            |
|                                     |                                              |
|                                     | throttled publish @ ~10Hz (or on change)     |
|                                     v                                              |
|                           HUD store (tiny pub/sub)  --> <HUD/> re-renders ~10x/s    |
+------------------------------------------------------------------------------------+
```

Rules of engagement:
1. `GameCanvas` mounts once and is **never** re-rendered by parent state. Its `useEffect`
   constructs the engine, hands it the canvas, and returns a teardown that disposes geometries,
   materials, textures, render targets, and cancels the rAF. (Skipping disposal = context loss
   after 3 restarts. This is why "restart" recycles the engine instead of remounting the canvas.)
2. The engine **never** calls `setState` from inside the loop. It writes to a mutable snapshot
   object and flushes to a subscriber store at most ~10Hz, and only when values actually changed.
   Health, ammo, points, and wave don't need 60Hz updates - the human eye can't read a number
   changing 60 times a second anyway. Damage flashes and hitmarkers are CSS animations triggered
   by an event, not by per-frame state.
3. Screen transitions (menu -> playing -> game over) are the *only* React state machine, and they
   change a handful of times per session. That's what React is good at. Let it do that.

**On react-three-fiber:** I'm going **plain Three.js inside a React shell**, not R3F. R3F is
excellent for declarative scenes that change with app state; this scene is built once and then
mutated imperatively 60 times a second by non-React code. Using R3F here means either fighting
its reconciler or bypassing it with `useFrame` + refs everywhere, at which point it's plain
Three.js with extra indirection and a bigger bundle. The brief allows either. Decision recorded so
the reasoning isn't lost. (If we later want an editor or dynamic scene composition, R3F becomes
the right call.)

---

## 2. State management

### The options
- **Redux / Zustand / Jotai for game state.** No. Immutable updates allocate a new object per
  change; at 60fps x dozens of entities that's megabytes of garbage per second and a GC saw-tooth
  in the frame graph. Wrong tool.
- **ECS (bitECS-style, typed-array components).** Genuinely the right architecture at scale:
  cache-friendly, trivially instanceable, great for thousands of entities. But for ~20 zombies,
  ~1 player, and ~40 projectile events, the indirection tax outweighs the win, and it makes the
  code much less readable for anyone reading this repo. The brief prizes readable + modular.
- **Plain TS classes + pre-allocated pools + a two-tier split.** <- **chosen**

### The two tiers

**Tier 1 - Hot state (mutable, never crosses into React):**
`World` holds `player`, `zombies: Zombie[]` (fixed-size pool, `active` flag, never
`splice`d), `level` colliders, `bullets`/tracers pool, and `time`. Everything mutates in place.
Vectors are reused scratch objects (`_v1`, `_v2` module-scoped) - the #1 source of GC churn in
Three.js games is `new THREE.Vector3()` inside `update()`. Object pooling for zombies, tracers,
muzzle flashes, blood decals, and audio voices: allocate the max at load time, recycle forever.
Steady-state allocation target: **~zero per frame**.

**Tier 2 - Cold/UI state (React):**
`screen`, `settings` (mute, sensitivity, quality preset), and the throttled HUD snapshot
(`health`, `maxHealth`, `points`, `wave`, `ammoMag`, `ammoReserve`, `weaponName`, `prompt`).
Immutable, idiomatic React, updated a few times a second at most.

The bridge is one ~40-line pub/sub store - no library. It's a `Set` of callbacks and a
`publishIfDirty()`. Adding Zustand for this would be importing a dependency to do less.

**Game state machine** is explicit and typed:
`BOOT -> LOADING -> MENU -> (COUNTDOWN -> WAVE_ACTIVE -> INTERMISSION)* -> GAME_OVER`
plus an orthogonal `PAUSED` flag (pointer-lock loss auto-pauses - critical, because losing
pointer lock mid-wave and getting eaten while your cursor is on the taskbar is infuriating).

---

## 3. Collision detection

### The options
**(a) Full physics engine (Rapier / Cannon / Jolt).** Gives capsule controllers, CCD, ragdolls,
and stacking for free. Costs: 400KB-1.5MB wasm+glue, a second simulation clock to reconcile with
my fixed step, and a whole class of "why is my character controller vibrating" bugs. We need
*none* of what a solver is actually for: no stacking, no joints, no ragdolls (explicitly out of
scope), no dynamic rigid bodies. **Rejected - and per the brief, here's the justification for
rejecting rather than adopting:** paying 1MB and a solver's determinism headaches to get
kinematic sphere-vs-AABB tests I can write in 150 readable lines is a bad trade. If v2 adds
ragdolls or physicalized props, Rapier goes in then, deliberately.

**(b) Three.js `Raycaster` against the whole scene for movement.** Naive and slow: it walks the
scene graph and does triangle-level tests against the level mesh. At 60fps with several rays per
entity per frame it's the profiler's top entry. Fine for bullets against a *small candidate set*;
wrong for movement.

**(c) Hand-rolled: AABB world + sphere entities + spatial hash.** <- **chosen**

### The scheme
- **Level colliders are authored as AABBs**, decoupled from render meshes. The visual wall can be
  a beveled, normal-mapped, 3k-tri prop; its collider is one box. Colliders are built from a
  declarative level manifest (`rooms`, `walls`, `props`, `doors`), which also means the level
  layout is data, not geometry-archaeology.
- **Broadphase: uniform spatial hash** (2m cells) over static colliders, plus a second hash for
  zombies so zombie-vs-zombie separation is O(neighbors) not O(n^2). At n=20 brute force is
  honestly fine, but the grid is ~50 lines and lets us raise the cap later without a rewrite.
- **Player/zombie = vertical capsule approximated as sphere-per-slice** (feet sphere + head
  sphere). True capsule-vs-AABB is more math than this game needs; two spheres gives correct
  behavior against walls, low steps, and doorways.
- **Resolution: swept + depenetration.** Move along X, resolve; move along Z, resolve. Axis
  separation kills the "stuck on corner" and "slide along wall loses all speed" artifacts that
  plague naive push-out. Gravity/step handled on Y with a ground probe.
- **Tunneling guard.** Max travel per fixed step is bounded (`speed x 1/60` ~ 12cm at sprint),
  and the thinnest collider is 20cm, so discrete tests are safe. This is *only* true because the
  timestep is fixed - another payoff from section 1.
- **Bullets: hitscan, not projectiles.** A shot fires one ray. Zombies are tested with
  `ray-vs-sphere` (cheap, analytic) for a hit candidate, then a per-part sphere test for
  headshot/limb multipliers. Only on a confirmed body hit do we do a precise raycast, and only
  against the level's collision proxy to check line-of-sight/wall blocking. Shotgun = 8 rays with
  deterministic spread from a seeded RNG (so spread is reproducible and testable).
- **Melee:** a short sphere-cast in front of the camera with an arc dot-product test. No animation
  dependency, so it feels instant.

### Zombie navigation
No navmesh library, no A* over triangles. The map is 3 rooms:
- A hand-authored **waypoint graph** (nodes at room centers, doorways, corners) gives global
  routing via a tiny BFS/Dijkstra over ~15 nodes - microseconds.
- Between waypoints, zombies use **local steering**: seek + wall-avoid (whisker rays against the
  AABB grid) + separation from neighbors. This produces the shambling, crowding, doorway-clogging
  behavior the genre is built on, which is *better* than perfect pathing here.
- Path recompute is **staggered** (each zombie re-plans on its own frame offset, ~4Hz), so we
  never pay all the AI cost in one frame. Spike-free budgeting matters more than raw cost.
- Zombies only path when the door state allows it - the barricaded door is a graph edge that's
  disabled until purchased. One boolean, and the level's flow changes. Nice.

---

## 4. Rendering performance & how much realism WebGL will actually give us

Budget: **60fps on a mid-range laptop GPU** (think Iris Xe / MX550 / M1 base) at 1080p-ish.
That's roughly a **12ms GPU budget** and **~5ms CPU**. Concretely:

| Metric | Target | Why |
|---|---|---|
| Draw calls | < 180 | Chrome/ANGLE overhead is ~30-60us per call on weak CPUs |
| Triangles | < 500k visible | Vertex-bound is rarely the issue; overdraw is |
| Shadow maps | **1** cascade-less, 2048^2, static half cached | Each extra shadow-casting light ~ another full scene pass |
| Real-time lights affecting PBR | <= 5 | Three's forward renderer recompiles/branches per light |
| Skinned characters on screen | <= 14 (hard cap 18) | CPU bone matrix updates + per-mesh draw calls |
| Render scale | dynamic 0.75-1.0 | Auto-downscale if frametime > 18ms for 30 frames |
| Postprocessing passes | <= 3 | Each full-screen pass at 1080p is ~0.4-1.2ms on integrated |

### Things that are NOT feasible in-browser at 60fps - and what we do instead

Being explicit, as the brief demands:

| Wanted | Verdict | Realistic-looking substitute we ship |
|---|---|---|
| **Real-time global illumination** (Lumen-style) | NOT FEASIBLE in WebGL at 60fps. Even WebGPU implementations are research-grade. | **IBL + baked ambient.** A CC0 HDRI (or procedural gradient env) through `PMREMGenerator` gives real-looking specular/diffuse environment response. Add a `HemisphereLight` tinted to the room palette for cheap bounce, plus **AO baked into the textures** and a low-cost SSAO pass for contact darkening. Reads as bounced light; costs ~1ms. |
| **Ray-traced reflections** | NOT FEASIBLE - no RT in WebGL. | **Screen-space reflections are also too costly** on integrated GPUs. Instead: env-map reflections from the PMREM cube, one small `CubeCamera` baked *once* per room for the wet-concrete floor, plus roughness maps that break up reflections so the cheat is invisible. |
| **Ray-traced / area shadows** | NOT FEASIBLE | One directional/spot light with **PCF-soft shadows**, `shadow.autoUpdate = false` for static geometry (render the static shadow map once, then only re-render when a dynamic caster moves). Fake contact shadows under zombies with a cheap blob decal - sounds hacky, looks great, costs nothing. |
| **Dozens of animated high-poly zombies** | NOT FEASIBLE - 30x 60k-tri skinned meshes = CPU bone hell + 30 draw calls of deep vertex shaders. | **Mid-poly (6-12k tris) with high-res normal maps**, geometry+material shared across all instances (`SkeletonUtils.clone`), **LOD** (full skinning near, reduced-bone/frozen pose far), **animation frameskip by distance** (near = every frame, mid = every 2nd, far = every 4th), frustum-culled zombies skip skinning entirely. Hard cap of 14-18 on screen; the wave system raises *pressure* via spawn rate, speed, and health rather than raw simultaneous count. A normal-mapped 8k-tri zombie at 3m under good lighting is indistinguishable from 60k in motion. |
| **Skinned `InstancedMesh`** (one draw call for all zombies) | POSSIBLE via **vertex animation textures** (bake animation to a texture, sample in vertex shader). Big perf win, meaningful complexity, and kills per-zombie animation blending. | **Stretch goal, flagged.** Ship shared-geometry clones first (proven, readable). VAT is the documented upgrade path if profiling says we're skinning-bound. |
| **Volumetric lighting / god rays** | True raymarched volumetrics: too expensive. | Billboarded **light-shaft quads** with soft additive blending + animated dust particles. Standard film trick, near-zero cost, sells the atmosphere better than physically-correct fog would. |
| **Screen-space subsurface skin shading** | NOT FEASIBLE | Normal + roughness + a slightly warm sheen/fresnel term on `MeshStandardMaterial`. |
| **High-res 4K textures everywhere** | VRAM + upload hitches. A 4K PBR set is ~50MB decompressed *per material*. | **1K-2K, KTX2/Basis compressed** (transcoded in a worker), tiling detail maps, `anisotropy: 4`. Trim sheets so 5 materials dress the whole level. |
| **Ragdolls, cloth, destructible barricades** | Out of v1 scope anyway | Death = short blended fall animation + fade/sink. |

### Other perf decisions
- **WebGL2 + `powerPreference: 'high-performance'`**, `antialias: false` + **FXAA/SMAA in the
  composer** (cheaper than MSAA when postprocessing, and MSAA is wasted once you resolve to a
  render target anyway).
- **ACESFilmic tone mapping + sRGB output + physically-scaled light intensities.** This is *the*
  single biggest "why does my Three.js scene look like a 2005 Flash game" fix. Filmic rolloff,
  correct color space. Realism is 70% tone mapping and lighting discipline, 30% asset quality.
- **Merge static geometry** (`BufferGeometryUtils.mergeGeometries`) per material per room ->
  collapses hundreds of prop draw calls into a handful. `InstancedMesh` for repeated props
  (crates, pipes, barrels, debris).
- **Frustum culling on** by default; manual **room-based occlusion**: rooms not visible through the
  current doorway have their merged mesh `.visible = false`. Trivial portal culling for a 3-room
  map, and it roughly halves the worst-case scene.
- **Post chain:** SMAA -> SSAO (quality-gated) -> Bloom (threshold high, muzzle flash + emissives
  only) -> vignette/grain/grade in one final shader pass. Everything after SMAA is toggleable via
  a Low/Medium/High quality preset. **Auto-degrade**: if median frametime > 18ms, drop SSAO, then
  render scale, then shadow resolution, in that order, and tell the player once.
- **`renderer.info` driven dev overlay** (F3): fps, frametime p95, draw calls, tris, zombie count,
  allocation counter. You cannot hit a perf budget you aren't measuring.

---

## 5. Asset loading (without ever stalling the game loop)

Non-negotiable rule: **no asset I/O, no shader compile, no texture upload happens during a wave.**
Every hitch players notice comes from breaking that rule.

**Phases:**
1. **Boot** - tiny bundle, immediately paint the menu. No 3D work yet.
2. **Preload (during menu / behind a progress bar)** - `LoadingManager` drives everything:
   `GLTFLoader` + `DRACOLoader` (worker) + `KTX2Loader` (worker, transcodes off main thread) +
   `RGBELoader` for the HDRI + audio buffers. `onProgress` feeds a real percentage into React,
   because that's a cold state update and React is good at those.
3. **Warm-up (still behind the loader)** - the killer step most projects skip:
   - `PMREMGenerator` bakes the env map once.
   - `renderer.compile(scene, camera)` pre-compiles every shader variant.
   - Force one off-screen render with all materials + one instance of every zombie/weapon visible
     so textures actually upload to VRAM and skinning shaders compile.
   - Pre-instantiate all pools (zombies, tracers, decals, audio voices).
   Without this, the first zombie spawn and the first shot each cause a 100-400ms freeze. With it,
   frame 1 of gameplay is as smooth as frame 1000.
4. **Runtime** - zero loading. Everything is recycled from pools. If we ever add streaming, it goes
   behind the intermission timer, budgeted at <= 2ms/frame.

**Everything is `async/await` around the loaders, so nothing blocks the main thread**; the rAF loop
literally does not start until `loadAll()` resolves and warm-up completes. There is no
"load-while-playing" code path to get wrong.

---

## 6. Asset & art-direction strategy

**Two-track, and this is a deliberate call given "make high quality models":**

**Track A - Procedural, in-repo, zero-dependency (the default, always works).**
High-detail *code-generated* content so the repo clones-and-runs with no downloads, no dead
links, and no license ambiguity:
- **Zombies**: a properly proportioned humanoid built from lathed/tapered segments with a real
  `THREE.Skeleton` (spine, hips, 2x arm chains, 2x leg chains, head/jaw) - so we get genuine
  skinned animation, not rigid boxes. Procedural walk/lurch/attack/death cycles authored as bone
  curves, with per-zombie phase offset, height/limp/speed variation, and a lopsided gait. Skin gets
  **canvas-generated PBR maps**: mottled albedo with blotching and wound decals, an FBM-noise
  normal map for gaunt skin detail, roughness variation for wet/dry, plus torn-clothing
  submeshes. Variation via per-instance color/material tweaks so the horde isn't clones.
- **Weapons**: viewmodel-quality procedural hardware - pistol, SMG, shotgun - built from real
  parts (slide, barrel, frame, rail, magazine, stock, ejection port) with metal-vs-polymer
  roughness split, worn-edge maps, emissive sights, animated slide/pump/bolt, recoil + sway +
  ADS-lite, and a trench-knife melee model.
- **Environment**: procedural trim-sheet PBR (stained concrete, painted steel, rusted panel,
  tiled floor, wood plank) generated once to canvas at 1-2K with matching normal/roughness/AO,
  plus modular props (crates, barrels, pipe runs, conduit, lockers, wall lamps, the barricade).
- **Why procedural is genuinely good here:** total control, tiny repo, no third-party licensing
  risk, no CDN dependency, and it scales to any resolution. The realism comes from *lighting +
  materials + tone mapping*, which procedural handles fine.

**Track B - Optional CC0 upgrade path (documented, hot-swappable).**
A single `content/assets.manifest.ts` maps logical names -> optional external GLTF/HDRI/texture
URLs. Drop files into `/public/assets/` and the loader prefers them; absent, it falls back to
Track A. So we can upgrade fidelity without touching game code. Recommended sources, all CC0 or
properly free:
- **Poly Haven** (CC0) - HDRIs and PBR texture sets. Best-in-class, no attribution required.
- **ambientCG** (CC0) - concrete/metal/rust PBR sets.
- **Quaternius** (CC0) - rigged characters and weapons.
- **Kenney.nl** (CC0) - props, UI, audio.
- **Sketchfab** - CC0 filter *only*, verified per-model.

Every third-party file gets logged in `ASSETS.md` with source URL, author, license, and date.
CC-BY assets get attribution in-repo *and* on an in-game credits screen; anything NC/ND/unclear is
rejected outright.

**Art direction (original):** *Blackpine Substation* - a decommissioned cold-war power relay
station. Three rooms: **Generator Hall** (tall, one hot sodium-vapor practical + failing
fluorescents), **Maintenance Corridor** (cramped, emergency red, the barricaded chokepoint), and
**Cold Storage** (blue-green, frost, fog). Palette is desaturated with two hot accent lights per
room so the PBR materials have something to actually reflect. Zombies are "**the Blighted**" -
industrial-accident bodies, not movie zombies.

---

## 7. Proposed file structure

```
zombies-clone-20260730-0933/
|- ARCHITECTURE.md            # this document
|- ASSETS.md                  # third-party asset ledger + licenses
|- README.md
|- index.html . vite.config.ts . tsconfig.json . package.json
|- public/assets/             # optional CC0 drop-in (gltf / hdr / ktx2 / audio)
\- src/
   |- main.tsx
   |- App.tsx                        # screen state machine only
   |- ui/                            # React + plain CSS, 2D only
   |  |- MainMenu.tsx / .css
   |  |- HUD.tsx / .css              # health, wave, points, ammo, crosshair, prompts
   |  |- GameOver.tsx / .css
   |  |- LoadingScreen.tsx / .css
   |  |- ControlsPanel.tsx
   |  \- theme.css
   |- react/
   |  |- GameCanvas.tsx              # mounts once; imperative engine handoff
   |  \- useHudStore.ts              # ~40-line pub/sub bridge
   |- engine/                        # rendering & platform (knows Three.js)
   |  |- Engine.ts                   # owns rAF, fixed-step accumulator, phases
   |  |- RendererHost.ts             # WebGLRenderer, tone mapping, resize, render scale
   |  |- PostFX.ts                   # SMAA/SSAO/Bloom/grade + quality presets
   |  |- CameraRig.ts                # FPS camera, sway, recoil, headbob
   |  |- Input.ts                    # pointer lock, key/mouse deltas, rebinding
   |  |- AudioBus.ts                 # pooled voices, mute, positional
   |  |- PerfMonitor.ts              # frametime p95, auto-degrade, F3 overlay
   |  \- loaders/                    # AssetLoader, warmup, manifest resolution
   |- game/                          # PURE simulation - imports no renderer code
   |  |- World.ts                    # hot state container + pools
   |  |- GameState.ts                # BOOT->LOADING->MENU->WAVE->INTERMISSION->OVER
   |  |- Player.ts                   # movement, stamina, health, regen
   |  |- Zombie.ts                   # per-entity state, damage, death
   |  |- Horde.ts                    # spawning, caps, staggered AI budget
   |  |- WaveDirector.ts             # wave curves, intermission, difficulty
   |  |- Economy.ts                  # points, costs, door + buy-station purchases
   |  |- weapons/                    # WeaponBase, Pistol, SMG, Shotgun, Knife, ballistics
   |  |- nav/                        # WaypointGraph, steering, separation
   |  \- physics/                    # AABB, sphere, SpatialHash, resolve, raycast
   |- content/                       # data, not logic
   |  |- level.blackpine.ts          # rooms, colliders, props, lights, doors, spawns
   |  |- weapons.data.ts             # damage, rpm, spread, mag, prices
   |  \- waves.data.ts               # per-wave curves
   |- procgen/                       # high-quality generated assets
   |  |- textures/                   # canvas PBR: concrete, steel, rust, skin, cloth
   |  |- ZombieFactory.ts            # skinned humanoid + procedural anim clips
   |  |- WeaponFactory.ts            # viewmodel geometry
   |  \- PropFactory.ts              # crates, barrels, pipes, lamps, barricade
   \- util/                          # math, seeded RNG, pool, easing, events
```

The hard boundary: **`src/game/` never imports from `src/engine/` or Three's renderer.** It deals
in plain vectors and numbers. That's what makes it testable and what satisfies "game logic
separate from rendering code." Rendering *reads* game state and syncs transforms.

---

## 8. Build & commit plan

| Stage | Contents |
|---|---|
| **0** | Repo init, `.gitignore`, README stub, **this document**, asset ledger |
| **1** | Scaffold, Vite/TS config, React shell, main menu + controls + mute, RendererHost, tone mapping, level shell, lighting, shadows, PostFX, camera, fixed-step loop, perf overlay |
| **2** | Input + pointer lock, player movement/collision, AABB+sphere physics, spatial hash, weapon viewmodels, hitscan ballistics, recoil, reload, knife, impact FX |
| **3** | ZombieFactory (skinned + procedural anim), procedural skin PBR, horde pooling, waypoint nav + steering, damage on contact, hit reactions, death, LOD/frameskip |
| **4** | WaveDirector, intermission, difficulty curves, Economy, barricaded door purchase, wall buy-station + weapon upgrades |
| **5** | Full HUD, damage vignette, hitmarkers, prompts, game-over + restart, audio, quality presets + auto-degrade, README/ASSETS finalization, perf pass |

One commit minimum per stage, with a summary of additions, perf concerns, and known limitations
after each.

---

## 9. IP Risk Register

| Risk | Mitigation |
|---|---|
| Trademarked mode/feature names (*Der Riese*, *Pack-a-Punch*, *Juggernog*, *Mystery Box*, *Perk-a-Cola*, the "Zombies" wordmark as branding) | Original names throughout: **Rotwave Protocol**, *Requisition Panel* (buy station), *Retool Bench* (upgrade), *the Blighted* (enemies), *Blackpine Substation* (map). "Wave survival" is a genre descriptor, not a mark. |
| Character likeness (named CoD crew members) | No named characters. Silent protagonist; enemies are anonymous industrial-accident bodies. |
| Copied level layout | *Blackpine Substation* is designed from scratch around our 3-room brief. |
| Audio (voice lines, the theme, SFX rips) | 100% procedural (WebAudio synthesis) or CC0. No ripped SFX, no soundalike voice lines, no licensed music. |
| Logos / fonts | System font stack or an OFL font. No game logos. |
| Model/texture provenance | Every third-party file recorded in `ASSETS.md` with source + license. CC0 preferred; NC/ND/unclear rejected. |
| Repo framing | Described as an *original* wave-survival shooter "inspired by the genre," never as a Call of Duty product, and not using the CoD name in branding. |

---

## 10. Open questions for the human

1. **Camera:** the brief allows either. I'm defaulting to **first-person** - it's the genre
   standard, it hides the fact that we have no full character rig, and it makes procedural
   viewmodels the star. Say the word if you want third-person.
2. **Weapon set:** starting pistol + two purchasable (SMG, shotgun) + knife. Enough?
3. **Quality default:** auto-detect and start at Medium, with Low/Medium/High in the menu.
