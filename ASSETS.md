# Asset Ledger & Licensing

Every asset in this project is either **generated procedurally in code** (the default) or sourced
from a **CC0 / permissively licensed** library and recorded in the table below.

**Hard rules:**
1. No Call of Duty / Activision assets, models, textures, audio, fonts, logos, names, or level
   layouts. Ever.
2. No asset with an unclear, NonCommercial (NC), or NoDerivatives (ND) license.
3. Every third-party file gets a row below: file path, source URL, author, license, date added.
4. CC-BY assets also get credit on an in-game credits screen, not just here.

---

## Track A - Procedural (default, zero third-party files)

The game ships fully playable with **no external asset downloads**. Models, textures, animation
clips, and sound are generated at load time in `src/procgen/` and `src/engine/AudioBus.ts`.

| Asset | How it's made | License |
|---|---|---|
| Zombie ("the Blighted") body + skeleton | `procgen/ZombieFactory.ts` - skinned humanoid, procedural bone-curve walk/lurch/attack/death clips | Original, MIT with this repo |
| Zombie skin / clothing PBR maps | `procgen/textures/` - canvas-generated albedo + FBM normal + roughness + AO | Original |
| Weapons (pistol, SMG, shotgun, trench knife) | `procgen/WeaponFactory.ts` - part-based viewmodel geometry, metal/polymer material split | Original |
| Environment trim-sheet materials (concrete, painted steel, rust, tile, plank) | `procgen/textures/` - canvas PBR, 1-2K, tiling, matched normal/roughness/AO | Original |
| Props (crates, barrels, pipe runs, lockers, lamps, barricade) | `procgen/PropFactory.ts` | Original |
| Environment lighting | Procedural gradient environment baked via `PMREMGenerator`; optional CC0 HDRI upgrade | Original |
| SFX (gunshots, impacts, groans, UI) | WebAudio synthesis in `AudioBus.ts` - no sampled/ripped audio | Original |

## Track B - Optional CC0 upgrades (hot-swappable, none committed yet)

`src/content/assets.manifest.ts` maps logical asset names to optional external files. Drop a file
into `public/assets/` and the loader prefers it; if absent it falls back to Track A. **Nothing here
is required to run the game.**

| File | Source | Author | License | Added |
|---|---|---|---|---|
| _(none yet)_ | | | | |

### Vetted sources we will draw from, if we draw at all

| Library | License | Notes |
|---|---|---|
| [Poly Haven](https://polyhaven.com) | **CC0** | HDRIs + PBR texture sets. No attribution required. Best quality-per-byte available. |
| [ambientCG](https://ambientcg.com) | **CC0** | Concrete, metal, rust, tile PBR sets. |
| [Quaternius](https://quaternius.com) | **CC0** | Rigged characters and weapons, game-ready poly counts. |
| [Kenney.nl](https://kenney.nl) | **CC0** | Props, UI, audio. |
| [Sketchfab](https://sketchfab.com) | mixed | **CC0 filter only**, verified per model, recorded per file. |

### Explicitly rejected

- Anything extracted, ripped, or converted from a shipped commercial game.
- Anything CC-BY-NC / CC-BY-ND / "free for personal use" / "credit required, no commercial".
- Asset packs whose license text can't be located.
- Fonts and logos from commercial games; we use a system font stack or an OFL font.

---

## Naming: original replacements for trademarked terms

| Genre term (avoid as branding) | What we call it |
|---|---|
| Zombies (as a mode wordmark) | **Rotwave Protocol** |
| Der Riese / named CoD maps | **Blackpine Substation** |
| Mystery Box | *(cut from v1)* |
| Pack-a-Punch | **Retool Bench** |
| Perk-a-Cola / Juggernog | *(cut from v1)* |
| Wall buy | **Requisition Panel** |
| Zombies (the enemies) | **the Blighted** |
