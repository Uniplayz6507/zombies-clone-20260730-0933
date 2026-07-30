import * as THREE from 'three';
import {
  canvasTexture,
  dataTexture,
  fbmField,
  grayTexture,
  hash,
  heightFromCanvas,
  fillRGB,
  grime,
  newCanvas,
  normalTexture,
  streaks,
} from './procTex';

/**
 * The entire surface-shading library, generated in code.
 *
 * Each entry is a full PBR set: albedo (sRGB) + tangent-space normal + linear
 * roughness, and an emissive map where the surface glows. There are no image
 * files anywhere in this project.
 *
 * Resolution policy: 512 for hero surfaces the player presses their face
 * against (asphalt, brick, facades, skin), 256 for everything else. A 4K PBR set
 * is ~50MB decompressed *per material*; 28 materials at 256-512 fits in a few MB
 * of VRAM and never causes an upload hitch.
 */

const HERO = 512;
const STD = 256;

export interface MaterialLib {
  // Ground
  asphalt: THREE.MeshStandardMaterial;
  asphaltWet: THREE.MeshStandardMaterial;
  sidewalk: THREE.MeshStandardMaterial;
  garageFloor: THREE.MeshStandardMaterial;
  // Walls / structure
  brick: THREE.MeshStandardMaterial;
  brickDark: THREE.MeshStandardMaterial;
  stucco: THREE.MeshStandardMaterial;
  facade: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  garageCeiling: THREE.MeshStandardMaterial;
  rubble: THREE.MeshStandardMaterial;
  // Metal / props
  steelPainted: THREE.MeshStandardMaterial;
  steelRust: THREE.MeshStandardMaterial;
  shutter: THREE.MeshStandardMaterial;
  chainlink: THREE.MeshStandardMaterial;
  galvanised: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  plywood: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  fabricSack: THREE.MeshStandardMaterial;
  cardboard: THREE.MeshStandardMaterial;
  trashBag: THREE.MeshStandardMaterial;
  glassDark: THREE.MeshStandardMaterial;
  // Vehicles
  carPaint: THREE.MeshStandardMaterial[];
  carGlass: THREE.MeshStandardMaterial;
  carTrim: THREE.MeshStandardMaterial;
  // Weapons
  gunmetal: THREE.MeshStandardMaterial;
  gunPolymer: THREE.MeshStandardMaterial;
  gunWood: THREE.MeshStandardMaterial;
  gunSteelBright: THREE.MeshStandardMaterial;
  // Characters
  skin: THREE.MeshStandardMaterial[];
  cloth: THREE.MeshStandardMaterial[];
  gore: THREE.MeshStandardMaterial;
  // Lights / emissive
  lampGlass: THREE.MeshStandardMaterial;
  emissiveAmber: THREE.MeshStandardMaterial;
  emissiveRed: THREE.MeshStandardMaterial;
  emissiveCold: THREE.MeshStandardMaterial;
  emissiveToxic: THREE.MeshStandardMaterial;
}

type Step = (label: string, frac: number) => Promise<void>;

/** Yield to the browser so the loading bar repaints between groups. */
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------------------
// Ground surfaces
// ---------------------------------------------------------------------------

function makeAsphalt(wet: boolean): THREE.MeshStandardMaterial {
  const S = HERO;
  const grit = fbmField(S, { freq: 96, octaves: 4, seed: 11 });
  const coarse = fbmField(S, { freq: 12, octaves: 3, seed: 19 });
  const crack = fbmField(S, { freq: 6, octaves: 4, seed: 27, ridged: true });
  const patch = fbmField(S, { freq: 3, octaves: 2, seed: 41 });

  const height = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    // Crack mask: only the very top of the ridged noise becomes a fissure.
    const c = clamp01((crack[i] - 0.84) / 0.16);
    height[i] = clamp01(grit[i] * 0.62 + coarse[i] * 0.38 - c * 0.85);
  }

  const map = dataTexture(
    S,
    (i, _x, _y, px) => {
      const c = clamp01((crack[i] - 0.84) / 0.16);
      // Base tarmac, with lighter aggregate showing through where grit is high.
      let v = 0.1 + grit[i] * 0.075 + coarse[i] * 0.05;
      if (grit[i] > 0.72) v += (grit[i] - 0.72) * 0.55; // exposed stones
      v *= 1 - c * 0.55; // cracks are darker
      v *= 0.86 + patch[i] * 0.28; // repaired patches / tone drift
      const r = clamp01(v * 1.02);
      const g = clamp01(v * 1.0);
      const b = clamp01(v * 0.99);
      px[0] = Math.round(r * 255);
      px[1] = Math.round(g * 255);
      px[2] = Math.round(b * 255);
    },
    true,
  );

  const rough = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const c = clamp01((crack[i] - 0.84) / 0.16);
    let r = 0.86 - grit[i] * 0.1 + c * 0.1;
    if (wet) {
      // Standing water pools in the low-frequency depressions and goes glossy.
      const pool = clamp01((0.42 - patch[i]) / 0.42);
      r = r * (1 - pool) + 0.14 * pool;
    }
    rough[i] = clamp01(r);
  }

  return new THREE.MeshStandardMaterial({
    map,
    normalMap: normalTexture(S, height, 2.4),
    roughnessMap: grayTexture(S, rough),
    metalness: 0,
    roughness: 1,
    envMapIntensity: wet ? 1.15 : 0.5,
    normalScale: new THREE.Vector2(1, 1),
  });
}

function makeSidewalk(): THREE.MeshStandardMaterial {
  const S = HERO;
  // Canvas pass gives us crisp expansion joints; noise adds the concrete itself.
  const c = newCanvas(S);
  fillRGB(c, '#8b8880');
  const { ctx } = c;
  const slabs = 2; // texture covers 4m, slabs are 2m
  ctx.strokeStyle = '#4a4843';
  ctx.lineWidth = 5;
  for (let i = 0; i <= slabs; i++) {
    const p = (i / slabs) * S;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, S);
    ctx.moveTo(0, p);
    ctx.lineTo(S, p);
    ctx.stroke();
  }
  // Hairline cracks radiating from joints
  ctx.strokeStyle = 'rgba(56,54,50,0.75)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 16; i++) {
    let x = hash(i, 3, 7) * S;
    let y = hash(i, 4, 11) * S;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (hash(i, s + 5, 13) - 0.5) * 46;
      y += (hash(i, s + 6, 17) - 0.5) * 46;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  grime(c, { count: 90, radius: 44, alpha: 0.17 });
  grime(c, { count: 40, radius: 22, alpha: 0.13, color: '120,118,110', seedOffset: 3 });

  const joints = heightFromCanvas(c);
  const fine = fbmField(S, { freq: 64, octaves: 3, seed: 55 });
  const height = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) height[i] = clamp01(joints[i] * 0.75 + fine[i] * 0.25);

  const rough = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) rough[i] = clamp01(0.78 + fine[i] * 0.16);

  const map = new THREE.CanvasTexture(c.canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.anisotropy = 4;
  map.needsUpdate = true;

  return new THREE.MeshStandardMaterial({
    map,
    normalMap: normalTexture(S, height, 1.6),
    roughnessMap: grayTexture(S, rough),
    metalness: 0,
    roughness: 1,
    envMapIntensity: 0.5,
  });
}

function makeGarageFloor(): THREE.MeshStandardMaterial {
  const S = HERO;
  const c = newCanvas(S);
  fillRGB(c, '#7d7a73');
  const { ctx } = c;
  // Sawn control joints
  ctx.strokeStyle = 'rgba(58,56,52,0.9)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(S / 2, 0);
  ctx.lineTo(S / 2, S);
  ctx.moveTo(0, S / 2);
  ctx.lineTo(S, S / 2);
  ctx.stroke();
  // Tyre scuffs
  ctx.strokeStyle = 'rgba(28,26,24,0.35)';
  ctx.lineWidth = 22;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    const y = hash(i, 9, 19) * S;
    ctx.moveTo(-20, y);
    ctx.bezierCurveTo(S * 0.3, y + (hash(i, 10, 23) - 0.5) * 160, S * 0.7, y + (hash(i, 11, 29) - 0.5) * 160, S + 20, y);
    ctx.stroke();
  }
  // Oil stains
  grime(c, { count: 26, radius: 62, alpha: 0.4, color: '18,16,14', seedOffset: 7 });
  grime(c, { count: 70, radius: 30, alpha: 0.14 });

  const fine = fbmField(S, { freq: 80, octaves: 3, seed: 71 });
  const h = heightFromCanvas(c);
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    height[i] = clamp01(h[i] * 0.7 + fine[i] * 0.3);
    // Oil is glossy, bare concrete is matte.
    rough[i] = clamp01(0.5 + h[i] * 0.42);
  }

  const map = new THREE.CanvasTexture(c.canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.anisotropy = 4;
  map.needsUpdate = true;

  return new THREE.MeshStandardMaterial({
    map,
    normalMap: normalTexture(S, height, 1.4),
    roughnessMap: grayTexture(S, rough),
    metalness: 0,
    roughness: 1,
    envMapIntensity: 0.65,
  });
}

// ---------------------------------------------------------------------------
// Masonry
// ---------------------------------------------------------------------------

function makeBrick(dark: boolean): THREE.MeshStandardMaterial {
  const S = HERO;
  const c = newCanvas(S);
  const { ctx } = c;
  // Mortar bed first, bricks laid on top.
  fillRGB(c, dark ? '#4b4741' : '#6d675e');
  const cols = 8; // texture covers 2m
  const rows = 24;
  const bw = S / cols;
  const bh = S / rows;
  const mortar = 3;
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 0 ? 0 : bw * 0.5;
    for (let k = -1; k <= cols; k++) {
      const x = k * bw + offset;
      const y = r * bh;
      const t = hash(k + 40, r, dark ? 91 : 17);
      const t2 = hash(k + 80, r, dark ? 93 : 19);
      let rr: number, gg: number, bb: number;
      if (dark) {
        rr = 58 + t * 26;
        gg = 50 + t * 20;
        bb = 46 + t * 18;
      } else {
        rr = 118 + t * 52;
        gg = 58 + t * 30;
        bb = 46 + t * 24;
      }
      if (t2 > 0.9) {
        // The odd sooted / replaced brick breaks up the pattern.
        rr *= 0.55;
        gg *= 0.55;
        bb *= 0.58;
      }
      ctx.fillStyle = `rgb(${rr | 0},${gg | 0},${bb | 0})`;
      ctx.fillRect(x + mortar * 0.5, y + mortar * 0.5, bw - mortar, bh - mortar);
      // Per-brick lighting variation, faked with a soft top highlight.
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x + mortar * 0.5, y + mortar * 0.5, bw - mortar, 2);
    }
  }
  streaks(c, 22, 0.24, dark ? '10,9,8' : '28,22,18', 9);
  grime(c, { count: 80, radius: 50, alpha: 0.16, seedOffset: 11 });
  // Efflorescence / salt bloom near the base
  grime(c, { count: 24, radius: 40, alpha: 0.1, color: '220,218,210', seedOffset: 13 });

  const h = heightFromCanvas(c);
  const grit = fbmField(S, { freq: 128, octaves: 2, seed: 33 });
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    // Bricks proud of the mortar: recover the mortar grid from luminance.
    height[i] = clamp01(h[i] * 0.55 + grit[i] * 0.45);
    rough[i] = clamp01(0.82 + grit[i] * 0.14);
  }

  const map = new THREE.CanvasTexture(c.canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.anisotropy = 4;
  map.needsUpdate = true;

  return new THREE.MeshStandardMaterial({
    map,
    normalMap: normalTexture(S, height, 3.2),
    roughnessMap: grayTexture(S, rough),
    metalness: 0,
    roughness: 1,
    envMapIntensity: 0.4,
  });
}

function makeStucco(): THREE.MeshStandardMaterial {
  const S = STD;
  const mottle = fbmField(S, { freq: 40, octaves: 4, seed: 61 });
  const patchy = fbmField(S, { freq: 5, octaves: 3, seed: 67 });
  const loss = fbmField(S, { freq: 9, octaves: 3, seed: 73 });
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const flake = clamp01((loss[i] - 0.62) / 0.38);
    height[i] = clamp01(mottle[i] * 0.7 - flake * 0.5 + 0.2);
    rough[i] = clamp01(0.72 + mottle[i] * 0.2 + flake * 0.08);
  }
  const map = dataTexture(
    S,
    (i, _x, _y, px) => {
      const flake = clamp01((loss[i] - 0.62) / 0.38);
      // Painted render, flaking off to reveal brown brick underneath.
      const base = 0.5 + mottle[i] * 0.14 + patchy[i] * 0.12;
      const r = base * (1 - flake) + 0.31 * flake;
      const g = base * 0.97 * (1 - flake) + 0.18 * flake;
      const b = base * 0.9 * (1 - flake) + 0.14 * flake;
      px[0] = Math.round(clamp01(r) * 255);
      px[1] = Math.round(clamp01(g) * 255);
      px[2] = Math.round(clamp01(b) * 255);
    },
    true,
  );
  return new THREE.MeshStandardMaterial({
    map,
    normalMap: normalTexture(S, height, 2.0),
    roughnessMap: grayTexture(S, rough),
    metalness: 0,
    roughness: 1,
    envMapIntensity: 0.35,
  });
}

/**
 * Upper-storey facade: a 4x4 grid of window bays with varied states (dark,
 * warm-lit, boarded, broken). One 1024px tile covers 8m so a whole city block is
 * a handful of draw calls with no obvious repetition at eye level.
 */
function makeFacade(): THREE.MeshStandardMaterial {
  const S = 1024;
  const c = newCanvas(S);
  const { ctx } = c;
  fillRGB(c, '#3b3833');
  // Pilasters + string courses to break up the flat plane
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 4; i++) ctx.fillRect((i * S) / 4, 0, 6, S);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  for (let i = 0; i < 4; i++) ctx.fillRect(0, (i * S) / 4 + S / 4 - 10, S, 10);

  const emis = newCanvas(S);
  emis.ctx.fillStyle = '#000';
  emis.ctx.fillRect(0, 0, S, S);

  const cell = S / 4;
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const x = gx * cell + cell * 0.18;
      const y = gy * cell + cell * 0.14;
      const w = cell * 0.64;
      const h = cell * 0.6;
      const roll = hash(gx, gy, 137);
      const state = roll < 0.42 ? 'dark' : roll < 0.66 ? 'lit' : roll < 0.85 ? 'boarded' : 'broken';

      // Reveal / surround
      ctx.fillStyle = '#2b2823';
      ctx.fillRect(x - 8, y - 8, w + 16, h + 16);
      ctx.fillStyle = '#5b564e';
      ctx.fillRect(x - 8, y + h + 6, w + 16, 8); // sill

      if (state === 'boarded') {
        ctx.fillStyle = '#5c4a34';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        for (let p = 0; p < 4; p++) ctx.fillRect(x, y + (p * h) / 4 + 2, w, 3);
        ctx.strokeStyle = 'rgba(30,26,22,0.9)';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y + h);
        ctx.moveTo(x + w, y);
        ctx.lineTo(x, y + h);
        ctx.stroke();
      } else {
        const glass = ctx.createLinearGradient(x, y, x, y + h);
        if (state === 'lit') {
          glass.addColorStop(0, '#c99a52');
          glass.addColorStop(1, '#6b4a22');
        } else if (state === 'broken') {
          glass.addColorStop(0, '#0b0c0e');
          glass.addColorStop(1, '#141618');
        } else {
          glass.addColorStop(0, '#1a2029');
          glass.addColorStop(1, '#0d1116');
        }
        ctx.fillStyle = glass;
        ctx.fillRect(x, y, w, h);

        if (state === 'lit') {
          const g = emis.ctx.createLinearGradient(x, y, x, y + h);
          g.addColorStop(0, '#ffbe6b');
          g.addColorStop(1, '#8a5320');
          emis.ctx.fillStyle = g;
          emis.ctx.fillRect(x, y, w, h);
        }
        if (state === 'broken') {
          ctx.strokeStyle = 'rgba(190,190,190,0.35)';
          ctx.lineWidth = 2;
          for (let s = 0; s < 7; s++) {
            ctx.beginPath();
            ctx.moveTo(x + hash(s, gx + gy, 7) * w, y);
            ctx.lineTo(x + hash(s, gx + gy, 11) * w, y + h);
            ctx.stroke();
          }
        }
        // Mullions
        ctx.fillStyle = '#26231f';
        ctx.fillRect(x + w / 2 - 3, y, 6, h);
        ctx.fillRect(x, y + h / 2 - 3, w, 6);
        if (state === 'lit') {
          emis.ctx.fillStyle = '#000';
          emis.ctx.fillRect(x + w / 2 - 3, y, 6, h);
          emis.ctx.fillRect(x, y + h / 2 - 3, w, 6);
        }
      }
    }
  }
  streaks(c, 30, 0.3, '14,12,10', 21);
  grime(c, { count: 110, radius: 60, alpha: 0.15, seedOffset: 23 });

  const h = heightFromCanvas(c);
  const grit = fbmField(256, { freq: 64, octaves: 2, seed: 87 });
  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const g = grit[((y >> 2) % 256) * 256 + ((x >> 2) % 256)];
      height[y * S + x] = clamp01(h[y * S + x] * 0.72 + g * 0.28);
    }
  }

  const map = new THREE.CanvasTexture(c.canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.anisotropy = 4;
  map.needsUpdate = true;

  const emissiveMap = new THREE.CanvasTexture(emis.canvas);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
  emissiveMap.minFilter = THREE.LinearMipmapLinearFilter;
  emissiveMap.needsUpdate = true;

  return new THREE.MeshStandardMaterial({
    map,
    emissiveMap,
    emissive: new THREE.Color(0xffb066),
    emissiveIntensity: 1.5,
    normalMap: normalTexture(S, height, 2.0),
    metalness: 0,
    roughness: 0.78,
    envMapIntensity: 0.4,
  });
}

function makeConcrete(tint: number, roughBase: number, seed: number): THREE.MeshStandardMaterial {
  const S = STD;
  const mottle = fbmField(S, { freq: 32, octaves: 4, seed });
  const stain = fbmField(S, { freq: 6, octaves: 3, seed: seed + 5 });
  const pit = fbmField(S, { freq: 90, octaves: 2, seed: seed + 9 });
  const base = new THREE.Color(tint);
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const pits = clamp01((pit[i] - 0.78) / 0.22);
    height[i] = clamp01(mottle[i] * 0.75 - pits * 0.6 + 0.2);
    rough[i] = clamp01(roughBase + mottle[i] * 0.16 - pits * 0.1);
  }
  const map = dataTexture(
    S,
    (i, _x, _y, px) => {
      const shade = 0.78 + mottle[i] * 0.3 - clamp01(0.4 - stain[i]) * 0.5;
      px[0] = Math.round(clamp01(base.r * shade) * 255);
      px[1] = Math.round(clamp01(base.g * shade) * 255);
      px[2] = Math.round(clamp01(base.b * shade) * 255);
    },
    true,
  );
  return new THREE.MeshStandardMaterial({
    map,
    normalMap: normalTexture(S, height, 1.8),
    roughnessMap: grayTexture(S, rough),
    metalness: 0,
    roughness: 1,
    envMapIntensity: 0.4,
  });
}

// ---------------------------------------------------------------------------
// Metals, timber, misc
// ---------------------------------------------------------------------------

function makeMetal(opts: {
  color: number;
  metalness: number;
  roughBase: number;
  rust: number;
  scratches: number;
  seed: number;
  brushed?: boolean;
}): THREE.MeshStandardMaterial {
  const S = STD;
  const rustField = fbmField(S, { freq: 8, octaves: 4, seed: opts.seed });
  const fine = fbmField(S, { freq: opts.brushed ? 128 : 64, octaves: 2, seed: opts.seed + 3, stretchX: opts.brushed ? 8 : 1 });
  const base = new THREE.Color(opts.color);
  const rustCol = new THREE.Color(0x6a3417);

  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const metal = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const r = clamp01((rustField[i] - (1 - opts.rust)) / Math.max(0.001, opts.rust));
    height[i] = clamp01(0.5 + fine[i] * 0.4 + r * 0.35);
    rough[i] = clamp01(opts.roughBase + fine[i] * 0.14 + r * 0.42);
    // Rust is a dielectric: dropping metalness there is what makes it read as
    // corrosion rather than as painted-on colour.
    metal[i] = clamp01(opts.metalness * (1 - r * 0.9));
  }

  const map = dataTexture(
    S,
    (i, _x, _y, px) => {
      const r = clamp01((rustField[i] - (1 - opts.rust)) / Math.max(0.001, opts.rust));
      const scratch = clamp01((fine[i] - 0.8) / 0.2) * opts.scratches;
      const shade = 0.85 + fine[i] * 0.3;
      const cr = base.r * shade * (1 - r) + rustCol.r * (0.7 + rustField[i] * 0.5) * r;
      const cg = base.g * shade * (1 - r) + rustCol.g * (0.7 + rustField[i] * 0.5) * r;
      const cb = base.b * shade * (1 - r) + rustCol.b * (0.7 + rustField[i] * 0.5) * r;
      px[0] = Math.round(clamp01(cr + scratch * 0.4) * 255);
      px[1] = Math.round(clamp01(cg + scratch * 0.4) * 255);
      px[2] = Math.round(clamp01(cb + scratch * 0.4) * 255);
    },
    true,
  );

  return new THREE.MeshStandardMaterial({
    map,
    normalMap: normalTexture(S, height, opts.brushed ? 1.0 : 1.6),
    roughnessMap: grayTexture(S, rough),
    metalnessMap: grayTexture(S, metal),
    metalness: 1,
    roughness: 1,
    envMapIntensity: 1.1,
  });
}

function makeShutter(): THREE.MeshStandardMaterial {
  const S = STD;
  const c = newCanvas(S);
  fillRGB(c, '#5a6066');
  const { ctx } = c;
  // Horizontal roller slats
  const slats = 14;
  for (let i = 0; i < slats; i++) {
    const y = (i / slats) * S;
    const h = S / slats;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#20252a');
    g.addColorStop(0.18, '#767d84');
    g.addColorStop(0.6, '#4d545a');
    g.addColorStop(1, '#2b3035');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, S, h - 1);
  }
  streaks(c, 16, 0.32, '78,40,16', 31); // rust runs
  grime(c, { count: 60, radius: 34, alpha: 0.2, seedOffset: 29 });
  grime(c, { count: 18, radius: 28, alpha: 0.3, color: '110,58,24', seedOffset: 31 });

  const h = heightFromCanvas(c);
  const rough = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) rough[i] = clamp01(0.42 + (1 - h[i]) * 0.4);

  const map = new THREE.CanvasTexture(c.canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.anisotropy = 4;
  map.needsUpdate = true;

  return new THREE.MeshStandardMaterial({
    map,
    normalMap: normalTexture(S, h, 3.4),
    roughnessMap: grayTexture(S, rough),
    metalness: 0.75,
    roughness: 1,
    envMapIntensity: 1,
  });
}

function makeChainlink(): THREE.MeshStandardMaterial {
  const S = STD;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = '#b9bec4';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  const step = S / 6;
  for (let i = -6; i <= 12; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step + S, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i * step, S);
    ctx.lineTo(i * step + S, 0);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return new THREE.MeshStandardMaterial({
    map: tex,
    alphaMap: tex,
    transparent: true,
    // alphaTest rather than blending: no sort order problems, writes depth,
    // and zombies behind the fence still occlude correctly.
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    metalness: 0.85,
    roughness: 0.5,
    envMapIntensity: 1.2,
  });
}

function makeWood(color: number, seed: number, plankLines: boolean): THREE.MeshStandardMaterial {
  const S = STD;
  const grain = fbmField(S, { freq: 48, octaves: 4, seed, stretchX: 10 });
  const rings = fbmField(S, { freq: 12, octaves: 3, seed: seed + 7, stretchX: 14, ridged: true });
  const base = new THREE.Color(color);
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      // Plank divisions every 1/4 of the tile.
      const seam = plankLines && (y % (S / 4) < 3 || y % (S / 4) > S / 4 - 3) ? 1 : 0;
      height[i] = clamp01(grain[i] * 0.55 + rings[i] * 0.45 - seam * 0.8);
      rough[i] = clamp01(0.62 + grain[i] * 0.24 + seam * 0.14);
    }
  }
  const map = dataTexture(
    S,
    (i, _x, y, px) => {
      const seam = plankLines && (y % (S / 4) < 3 || y % (S / 4) > S / 4 - 3) ? 1 : 0;
      const shade = (0.62 + grain[i] * 0.5 + rings[i] * 0.24) * (1 - seam * 0.55);
      px[0] = Math.round(clamp01(base.r * shade) * 255);
      px[1] = Math.round(clamp01(base.g * shade) * 255);
      px[2] = Math.round(clamp01(base.b * shade) * 255);
    },
    true,
  );
  return new THREE.MeshStandardMaterial({
    map,
    normalMap: normalTexture(S, height, 1.8),
    roughnessMap: grayTexture(S, rough),
    metalness: 0,
    roughness: 1,
    envMapIntensity: 0.35,
  });
}

function makeCloth(color: number, seed: number, dirt: number): THREE.MeshStandardMaterial {
  const S = STD;
  const soil = fbmField(S, { freq: 10, octaves: 4, seed });
  const fuzz = fbmField(S, { freq: 96, octaves: 2, seed: seed + 4 });
  const base = new THREE.Color(color);
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      // Plain weave: two out-of-phase square waves.
      const weave = (Math.sin((x / S) * Math.PI * 2 * 64) * 0.5 + 0.5) * 0.5 + (Math.sin((y / S) * Math.PI * 2 * 64) * 0.5 + 0.5) * 0.5;
      height[i] = clamp01(weave * 0.55 + fuzz[i] * 0.45);
      rough[i] = clamp01(0.82 + fuzz[i] * 0.14);
    }
  }
  const map = dataTexture(
    S,
    (i, _x, _y, px) => {
      const grimeAmt = clamp01((soil[i] - 0.45) / 0.55) * dirt;
      const shade = 0.8 + fuzz[i] * 0.3;
      px[0] = Math.round(clamp01(base.r * shade * (1 - grimeAmt) + 0.09 * grimeAmt) * 255);
      px[1] = Math.round(clamp01(base.g * shade * (1 - grimeAmt) + 0.08 * grimeAmt) * 255);
      px[2] = Math.round(clamp01(base.b * shade * (1 - grimeAmt) + 0.07 * grimeAmt) * 255);
    },
    true,
  );
  return new THREE.MeshStandardMaterial({
    map,
    normalMap: normalTexture(S, height, 1.3),
    roughnessMap: grayTexture(S, rough),
    metalness: 0,
    roughness: 1,
    envMapIntensity: 0.22,
  });
}

/**
 * Blighted skin. This is the most important material in the game - it is what
 * the player sees two feet from their face - so it gets the hero resolution and
 * a full set of features: mottling, subdermal veining, bruise blotches and a
 * scattering of open wounds that are both darker and *glossier* than dry skin.
 */
function makeSkin(tint: number, seed: number): THREE.MeshStandardMaterial {
  const S = HERO;
  const mottle = fbmField(S, { freq: 36, octaves: 5, seed });
  const pores = fbmField(S, { freq: 160, octaves: 2, seed: seed + 11 });
  const veins = fbmField(S, { freq: 18, octaves: 4, seed: seed + 23, ridged: true });
  const bruise = fbmField(S, { freq: 5, octaves: 3, seed: seed + 37 });

  // A handful of wound centres, evaluated analytically per pixel.
  const wounds: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < 7; i++) {
    wounds.push({
      x: hash(i, seed & 0xff, 3) * S,
      y: hash(i, (seed >> 3) & 0xff, 5) * S,
      r: 12 + hash(i, seed & 0x7f, 7) * 34,
    });
  }
  const woundAt = (x: number, y: number) => {
    let m = 0;
    for (const w of wounds) {
      const d = Math.hypot(x - w.x, y - w.y) / w.r;
      if (d < 1) m = Math.max(m, 1 - d * d);
    }
    return m;
  };

  const base = new THREE.Color(tint);
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const w = woundAt(x, y);
      const vein = clamp01((veins[i] - 0.7) / 0.3);
      height[i] = clamp01(mottle[i] * 0.5 + pores[i] * 0.28 + vein * 0.22 - w * 0.7);
      // Dry, taut skin is rough; exposed tissue is wet.
      rough[i] = clamp01(0.68 + pores[i] * 0.2 - w * 0.55);
    }
  }

  const map = dataTexture(
    S,
    (i, x, y, px) => {
      const w = woundAt(x, y);
      const vein = clamp01((veins[i] - 0.7) / 0.3);
      const br = clamp01((bruise[i] - 0.5) / 0.5);
      const shade = 0.74 + mottle[i] * 0.42 + pores[i] * 0.1;
      let r = base.r * shade;
      let g = base.g * shade;
      let b = base.b * shade;
      // Bruising pulls toward purple-grey
      r = r * (1 - br * 0.45) + 0.19 * br * 0.45;
      g = g * (1 - br * 0.55) + 0.13 * br * 0.55;
      b = b * (1 - br * 0.3) + 0.22 * br * 0.3;
      // Veins darken and cool
      r *= 1 - vein * 0.28;
      g *= 1 - vein * 0.18;
      b *= 1 - vein * 0.05;
      // Wounds: dark red core with a raw pink rim
      r = r * (1 - w) + (0.34 + (1 - w) * 0.3) * w;
      g = g * (1 - w) + 0.05 * w;
      b = b * (1 - w) + 0.05 * w;
      px[0] = Math.round(clamp01(r) * 255);
      px[1] = Math.round(clamp01(g) * 255);
      px[2] = Math.round(clamp01(b) * 255);
    },
    true,
  );

  return new THREE.MeshStandardMaterial({
    map,
    normalMap: normalTexture(S, height, 2.6),
    roughnessMap: grayTexture(S, rough),
    metalness: 0,
    roughness: 1,
    // A little sheen: no screen-space SSS in WebGL at 60fps, but a fresnel-ish
    // grazing highlight is most of what sells wet skin anyway.
    sheen: 0.35,
    sheenColor: new THREE.Color(0x6f4a44),
    sheenRoughness: 0.7,
    envMapIntensity: 0.55,
  }) as THREE.MeshStandardMaterial;
}

function emissive(color: number, intensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x0a0a0a,
    emissive: new THREE.Color(color),
    emissiveIntensity: intensity,
    roughness: 0.4,
    metalness: 0,
    toneMapped: true,
  });
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export async function buildMaterials(step: Step): Promise<MaterialLib> {
  await step('Mixing tarmac and concrete', 0.04);
  const asphalt = makeAsphalt(false);
  const asphaltWet = makeAsphalt(true);
  await breathe();
  const sidewalk = makeSidewalk();
  const garageFloor = makeGarageFloor();

  await step('Laying brickwork', 0.16);
  await breathe();
  const brick = makeBrick(false);
  const brickDark = makeBrick(true);

  await step('Glazing 4,000 windows', 0.3);
  await breathe();
  const facade = makeFacade();
  const stucco = makeStucco();
  const concrete = makeConcrete(0x8f8c85, 0.72, 101);
  const garageCeiling = makeConcrete(0x6e6b65, 0.8, 107);
  const rubble = makeConcrete(0x615c55, 0.86, 113);

  await step('Welding shutters and rusting steel', 0.46);
  await breathe();
  const steelPainted = makeMetal({ color: 0x37474a, metalness: 0.7, roughBase: 0.42, rust: 0.3, scratches: 0.6, seed: 201 });
  const steelRust = makeMetal({ color: 0x5a4030, metalness: 0.45, roughBase: 0.62, rust: 0.8, scratches: 0.3, seed: 207 });
  const galvanised = makeMetal({ color: 0x9aa2a8, metalness: 0.9, roughBase: 0.34, rust: 0.12, scratches: 0.8, seed: 211, brushed: true });
  const shutter = makeShutter();
  const chainlink = makeChainlink();

  await step('Sourcing timber and refuse', 0.58);
  await breathe();
  const wood = makeWood(0x8a6136, 301, true);
  const plywood = makeWood(0xa8834e, 307, false);
  const gunWood = makeWood(0x5a3a1e, 311, false);
  const cardboard = makeWood(0xa1855e, 317, false);
  const rubber = makeMetal({ color: 0x1b1c1e, metalness: 0.05, roughBase: 0.88, rust: 0.02, scratches: 0.2, seed: 401 });
  const fabricSack = makeCloth(0x8b7c5c, 501, 0.5);
  const trashBag = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.34, metalness: 0.02, envMapIntensity: 0.9 });

  await step('Spraying vehicles', 0.68);
  await breathe();
  const carColors = [0x7d2b26, 0xb08a2e, 0x9aa0a6, 0x25405e, 0x2c332f, 0xd6d2c8];
  const carDust = fbmField(STD, { freq: 14, octaves: 3, seed: 601 });
  const carRough = grayTexture(
    STD,
    (() => {
      const f = new Float32Array(STD * STD);
      for (let i = 0; i < f.length; i++) f[i] = clamp01(0.22 + carDust[i] * 0.55);
      return f;
    })(),
  );
  const carPaint = carColors.map(
    (c) =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(c),
        roughnessMap: carRough,
        roughness: 1,
        metalness: 0.55,
        envMapIntensity: 1.3,
      }),
  );
  const carGlass = new THREE.MeshStandardMaterial({
    color: 0x0b1014,
    roughness: 0.08,
    metalness: 0.1,
    transparent: true,
    opacity: 0.55,
    envMapIntensity: 2.2,
  });
  const carTrim = makeMetal({ color: 0x2a2c2f, metalness: 0.4, roughBase: 0.6, rust: 0.25, scratches: 0.4, seed: 607 });
  const glassDark = new THREE.MeshStandardMaterial({
    color: 0x080b0e,
    roughness: 0.06,
    metalness: 0.2,
    transparent: true,
    opacity: 0.4,
    envMapIntensity: 2.6,
  });

  await step('Machining hardware', 0.78);
  await breathe();
  const gunmetal = makeMetal({ color: 0x24272b, metalness: 0.96, roughBase: 0.3, rust: 0.05, scratches: 0.9, seed: 701, brushed: true });
  const gunSteelBright = makeMetal({ color: 0x5b6167, metalness: 0.98, roughBase: 0.16, rust: 0.03, scratches: 1, seed: 707, brushed: true });
  const gunPolymer = new THREE.MeshStandardMaterial({
    color: 0x171a1d,
    normalMap: normalTexture(STD, fbmField(STD, { freq: 140, octaves: 2, seed: 709 }), 0.9),
    roughness: 0.58,
    metalness: 0.02,
    envMapIntensity: 0.7,
  });

  await step('Growing skin on the Blighted', 0.9);
  await breathe();
  const skin = [makeSkin(0x6f7458, 811), makeSkin(0x7d7266, 821), makeSkin(0x5d6a5e, 831)];
  await breathe();
  const cloth = [makeCloth(0x3f4348, 901, 0.7), makeCloth(0x5a4632, 907, 0.8), makeCloth(0x2c3a4a, 911, 0.65)];
  const gore = new THREE.MeshStandardMaterial({ color: 0x3d0908, roughness: 0.26, metalness: 0, envMapIntensity: 0.8 });

  await step('Firing up the streetlights', 0.97);
  const lampGlass = new THREE.MeshStandardMaterial({
    color: 0x2a2317,
    emissive: new THREE.Color(0xffb257),
    emissiveIntensity: 7,
    roughness: 0.3,
    metalness: 0,
  });

  return {
    asphalt,
    asphaltWet,
    sidewalk,
    garageFloor,
    brick,
    brickDark,
    stucco,
    facade,
    concrete,
    garageCeiling,
    rubble,
    steelPainted,
    steelRust,
    shutter,
    chainlink,
    galvanised,
    wood,
    plywood,
    rubber,
    fabricSack,
    cardboard,
    trashBag,
    glassDark,
    carPaint,
    carGlass,
    carTrim,
    gunmetal,
    gunPolymer,
    gunWood,
    gunSteelBright,
    skin,
    cloth,
    gore,
    lampGlass,
    emissiveAmber: emissive(0xffa94d, 4),
    emissiveRed: emissive(0xff2f22, 5),
    emissiveCold: emissive(0xcfe6ff, 4.5),
    emissiveToxic: emissive(0x9dd649, 4),
  };
}

/** Free every GPU resource this library owns. Called on engine teardown. */
export function disposeMaterials(lib: MaterialLib): void {
  const seen = new Set<THREE.Texture | THREE.Material>();
  const killMat = (m: THREE.Material) => {
    if (seen.has(m)) return;
    seen.add(m);
    const anyM = m as unknown as Record<string, unknown>;
    for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap']) {
      const t = anyM[key] as THREE.Texture | undefined;
      if (t && !seen.has(t)) {
        seen.add(t);
        t.dispose();
      }
    }
    m.dispose();
  };
  for (const value of Object.values(lib)) {
    if (Array.isArray(value)) value.forEach((m) => killMat(m as THREE.Material));
    else killMat(value as THREE.Material);
  }
}
