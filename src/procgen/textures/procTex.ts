import * as THREE from 'three';

/**
 * Procedural texture toolkit.
 *
 * Two output paths:
 *  - `DataTexture` from a Float32 field: fast, no canvas overhead, used for
 *    organic/noise-driven maps (asphalt grit, rust, skin, plaster).
 *  - `CanvasTexture`: used when we need real 2D drawing - brick courses, painted
 *    lane markings, window frames, signage text, warning chevrons.
 *
 * Everything is *tileable*: the noise wraps on an integer lattice so materials
 * repeat across large surfaces without visible seams.
 */

// --------------------------------------------------------------------------
// Noise
// --------------------------------------------------------------------------

function hash2i(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Tileable value noise. `freq` must be an integer for the wrap to be seamless. */
function vnoise(x: number, y: number, freq: number, seed: number): number {
  const fx = x * freq;
  const fy = y * freq;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  // Quintic-ish smoothing; cheaper smoothstep is plenty at texture resolution.
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const w = (a: number) => ((a % freq) + freq) % freq;
  const wx0 = w(x0);
  const wy0 = w(y0);
  const wx1 = w(x0 + 1);
  const wy1 = w(y0 + 1);
  const a = hash2i(wx0, wy0, seed);
  const b = hash2i(wx1, wy0, seed);
  const c = hash2i(wx0, wy1, seed);
  const d = hash2i(wx1, wy1, seed);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

export interface FbmOpts {
  freq?: number;
  octaves?: number;
  seed?: number;
  gain?: number;
  /** Ridged noise reads as cracks / veins rather than clouds. */
  ridged?: boolean;
  /** Anisotropic stretch, e.g. 6 for wood grain or brushed metal. */
  stretchX?: number;
  stretchY?: number;
}

export function fbm(x: number, y: number, o: FbmOpts = {}): number {
  const octaves = o.octaves ?? 4;
  const gain = o.gain ?? 0.5;
  const sx = o.stretchX ?? 1;
  const sy = o.stretchY ?? 1;
  let f = Math.max(1, Math.round(o.freq ?? 8));
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const fx = Math.max(1, Math.round(f / sx));
    const fy = Math.max(1, Math.round(f / sy));
    // Separable stretch: sample an axis-scaled lattice, still integer => tiles.
    let n = vnoise(x, y, Math.max(fx, fy), (o.seed ?? 1) + i * 977);
    if (fx !== fy) {
      n = 0.5 * n + 0.5 * vnoise(x * (fx / Math.max(fx, fy)), y * (fy / Math.max(fx, fy)), Math.max(fx, fy), (o.seed ?? 1) + i * 977);
    }
    if (o.ridged) n = 1 - Math.abs(n * 2 - 1);
    sum += amp * n;
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/** Rasterise an FBM into a reusable Float32 field in [0,1]. */
export function fbmField(size: number, o: FbmOpts = {}): Float32Array {
  const out = new Float32Array(size * size);
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      out[y * size + x] = fbm(x * inv, y * inv, o);
    }
  }
  return out;
}

/** Combine two fields with a callback, in place on `a`. */
export function combine(a: Float32Array, b: Float32Array, fn: (a: number, b: number) => number): Float32Array {
  for (let i = 0; i < a.length; i++) a[i] = fn(a[i], b[i]);
  return a;
}

// --------------------------------------------------------------------------
// Texture construction
// --------------------------------------------------------------------------

function finishTexture(t: THREE.Texture, srgb: boolean, repeat: number): THREE.Texture {
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.magFilter = THREE.LinearFilter;
  // DataTexture defaults to NearestFilter with no mips - that means shimmering
  // aliasing on every floor and wall. Always fix it.
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export type ColorWriter = (i: number, x: number, y: number, rgba: Uint8Array) => void;

/** Build an RGBA DataTexture pixel by pixel. */
export function dataTexture(size: number, write: ColorWriter, srgb = false, repeat = 1): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const px = new Uint8Array(4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      px[0] = 0;
      px[1] = 0;
      px[2] = 0;
      px[3] = 255;
      write(i, x, y, px);
      const o = i * 4;
      data[o] = px[0];
      data[o + 1] = px[1];
      data[o + 2] = px[2];
      data[o + 3] = px[3];
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  finishTexture(t, srgb, repeat);
  return t;
}

/** Single-channel field -> grayscale texture (roughness, metalness, masks). */
export function grayTexture(size: number, field: Float32Array, repeat = 1): THREE.DataTexture {
  return dataTexture(
    size,
    (i, _x, _y, px) => {
      const v = Math.round(Math.min(1, Math.max(0, field[i])) * 255);
      px[0] = v;
      px[1] = v;
      px[2] = v;
    },
    false,
    repeat,
  );
}

/**
 * Sobel a height field into a tangent-space normal map.
 * This is what makes a flat 2-triangle wall read as brick under a moving light,
 * and it is the single highest value-per-byte realism trick available to us.
 */
export function normalTexture(size: number, height: Float32Array, strength = 2.2, repeat = 1): THREE.DataTexture {
  const at = (x: number, y: number) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  return dataTexture(
    size,
    (_i, x, y, px) => {
      // 3x3 Sobel for smoother gradients than a simple central difference.
      const tl = at(x - 1, y - 1);
      const t = at(x, y - 1);
      const tr = at(x + 1, y - 1);
      const l = at(x - 1, y);
      const r = at(x + 1, y);
      const bl = at(x - 1, y + 1);
      const b = at(x, y + 1);
      const br = at(x + 1, y + 1);
      const dx = tl + 2 * l + bl - (tr + 2 * r + br);
      const dy = tl + 2 * t + tr - (bl + 2 * b + br);
      let nx = dx * strength;
      let ny = dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      px[0] = Math.round((nx * 0.5 + 0.5) * 255);
      px[1] = Math.round((ny * 0.5 + 0.5) * 255);
      px[2] = Math.round((nz / len * 0.5 + 0.5) * 255);
    },
    false,
    repeat,
  );
}

// --------------------------------------------------------------------------
// Canvas path
// --------------------------------------------------------------------------

export interface Canvas2D {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  size: number;
}

export function newCanvas(size: number): Canvas2D {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable - cannot generate textures');
  return { canvas, ctx, size };
}

export function canvasTexture(
  size: number,
  draw: (c: Canvas2D) => void,
  srgb = true,
  repeat = 1,
): THREE.CanvasTexture {
  const c = newCanvas(size);
  draw(c);
  const t = new THREE.CanvasTexture(c.canvas);
  finishTexture(t, srgb, repeat);
  return t;
}

/** Read a canvas' luminance back out as a height field, for normal baking. */
export function heightFromCanvas(c: Canvas2D): Float32Array {
  const { data } = c.ctx.getImageData(0, 0, c.size, c.size);
  const out = new Float32Array(c.size * c.size);
  for (let i = 0; i < out.length; i++) {
    const o = i * 4;
    out[i] = (data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114) / 255;
  }
  return out;
}

/** Sprinkle grime/speckle over whatever is already on the canvas. */
export function grime(c: Canvas2D, opts: { count: number; radius: number; alpha: number; color?: string; seedOffset?: number }): void {
  const { ctx, size } = c;
  const so = opts.seedOffset ?? 0;
  ctx.save();
  for (let i = 0; i < opts.count; i++) {
    const x = hash2i(i, 7 + so, 31) * size;
    const y = hash2i(i, 19 + so, 57) * size;
    const r = opts.radius * (0.3 + hash2i(i, 3 + so, 91) * 0.7);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const col = opts.color ?? '0,0,0';
    g.addColorStop(0, `rgba(${col},${opts.alpha})`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}

/** Vertical dirt streaks - instantly reads as "weathered exterior". */
export function streaks(c: Canvas2D, count: number, alpha: number, color = '20,18,15', seed = 5): void {
  const { ctx, size } = c;
  for (let i = 0; i < count; i++) {
    const x = hash2i(i, seed, 13) * size;
    const w = 2 + hash2i(i, seed + 1, 17) * 14;
    const y0 = hash2i(i, seed + 2, 23) * size * 0.6;
    const h = size * (0.25 + hash2i(i, seed + 3, 29) * 0.7);
    const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
    g.addColorStop(0, `rgba(${color},${alpha})`);
    g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y0, w, h);
  }
}

export function fillRGB(c: Canvas2D, css: string): void {
  c.ctx.fillStyle = css;
  c.ctx.fillRect(0, 0, c.size, c.size);
}

/** Deterministic hash exposed for callers that want matching jitter. */
export const hash = hash2i;
