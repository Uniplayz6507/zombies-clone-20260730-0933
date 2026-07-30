# Rotwave Protocol

**An original, browser-based 3D wave-survival shooter.** React + TypeScript + Three.js, WebGL2, no game engine.

> Stage 0 of 5 - repo scaffold and architecture. Code lands in stages 1-5.
>
> This is an **original game** inspired by the wave-survival genre. It contains no
> Activision/Call of Duty IP: no trademarked names, characters, likenesses, level
> layouts, audio, or assets. See the IP Risk Register in
> [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## What it is

You are alone in **Blackpine Substation**, a decommissioned power relay station. *The Blighted*
come in waves. You get points for kills, and you spend them on a barricaded door and better
hardware at a wall-mounted **Requisition Panel**. Then you die, because everyone does.

## Status

| Stage | Scope | State |
|---|---|---|
| 0 | Repo init, `.gitignore`, architecture reasoning, asset ledger | ✅ done |
| 1 | Menu + 3D scene shell + camera + lighting + render loop | ⏳ next |
| 2 | Player movement + collision + shooting + melee | ⏳ |
| 3 | Zombie models, spawning, pathing | ⏳ |
| 4 | Wave system + points + door/buy-station economy | ⏳ |
| 5 | HUD + polish + audio + perf pass | ⏳ |

## Running it locally

Not yet runnable - stage 1 adds the toolchain. Once it lands:

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # production build to dist/
npm run preview # serve the production build
```

Requires Node 18+ and a WebGL2-capable browser (any current Chrome, Edge, Firefox, or Safari 16+).

## Documentation

- **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** - the full reasoning: game loop, state management,
  collision, rendering performance budget, asset loading, and an explicit list of realism features
  that WebGL *cannot* sustain at 60fps plus what we ship instead.
- **[`ASSETS.md`](./ASSETS.md)** - asset provenance and licenses.

## License

Code: MIT (see stage 1). Assets: see [`ASSETS.md`](./ASSETS.md).
