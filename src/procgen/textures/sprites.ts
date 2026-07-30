import * as THREE from 'three';
import { hash, newCanvas } from './procTex';

/**
 * Small non-tiling textures: impact decals, particle sprites, signage.
 *
 * Kept separate from `materials.ts` because these are consumed by the FX and
 * prop systems rather than by surface shading.
 */

function rgbaCanvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Chipped concrete impact crater with a dark core. */
function bulletHole(): THREE.CanvasTexture {
  return rgbaCanvasTexture(128, 128, (ctx, w) => {
    const c = w / 2;
    ctx.clearRect(0, 0, w, w);
    // Dust halo
    const halo = ctx.createRadialGradient(c, c, 4, c, c, c);
    halo.addColorStop(0, 'rgba(180,175,165,0.55)');
    halo.addColorStop(0.45, 'rgba(120,115,108,0.22)');
    halo.addColorStop(1, 'rgba(120,115,108,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, w);
    // Radial chips so it doesn't read as a perfect circle
    ctx.fillStyle = 'rgba(30,28,26,0.75)';
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + hash(i, 1, 3) * 0.6;
      const r = 14 + hash(i, 2, 5) * 22;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(c + Math.cos(a - 0.14) * r, c + Math.sin(a - 0.14) * r);
      ctx.lineTo(c + Math.cos(a + 0.14) * r, c + Math.sin(a + 0.14) * r);
      ctx.closePath();
      ctx.fill();
    }
    // Core
    const core = ctx.createRadialGradient(c, c, 0, c, c, 13);
    core.addColorStop(0, 'rgba(6,6,7,0.98)');
    core.addColorStop(0.7, 'rgba(14,13,12,0.9)');
    core.addColorStop(1, 'rgba(20,19,18,0)');
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, w, w);
  });
}

/** Irregular blood splatter with satellite droplets. */
function bloodSplat(): THREE.CanvasTexture {
  return rgbaCanvasTexture(256, 256, (ctx, w) => {
    const c = w / 2;
    ctx.clearRect(0, 0, w, w);
    ctx.fillStyle = 'rgba(74,10,10,0.86)';
    // Lumpy core built from overlapping blobs
    for (let i = 0; i < 14; i++) {
      const a = hash(i, 5, 11) * Math.PI * 2;
      const d = hash(i, 6, 13) * 34;
      const r = 16 + hash(i, 7, 17) * 26;
      ctx.beginPath();
      ctx.ellipse(c + Math.cos(a) * d, c + Math.sin(a) * d, r, r * (0.6 + hash(i, 8, 19) * 0.6), a, 0, Math.PI * 2);
      ctx.fill();
    }
    // Droplets
    for (let i = 0; i < 42; i++) {
      const a = hash(i, 9, 23) * Math.PI * 2;
      const d = 42 + hash(i, 10, 29) * 78;
      const r = 1.4 + hash(i, 11, 31) * 5;
      ctx.globalAlpha = 0.35 + hash(i, 12, 37) * 0.5;
      ctx.beginPath();
      ctx.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Darker centre for depth
    const g = ctx.createRadialGradient(c, c, 0, c, c, 46);
    g.addColorStop(0, 'rgba(40,3,3,0.7)');
    g.addColorStop(1, 'rgba(40,3,3,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

/**
 * Soft radial darkening used as a fake contact shadow under every zombie.
 * Real shadow-mapped contact shadows for 16 characters would cost another full
 * shadow pass; this costs one alpha-blended quad and reads better up close.
 */
function blobShadow(): THREE.CanvasTexture {
  return rgbaCanvasTexture(128, 128, (ctx, w) => {
    const c = w / 2;
    ctx.clearRect(0, 0, w, w);
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(0,0,0,0.72)');
    g.addColorStop(0.42, 'rgba(0,0,0,0.42)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  }, false);
}

/** Additive muzzle flash: hot core, ragged petals, faint smoke ring. */
function muzzleFlash(): THREE.CanvasTexture {
  return rgbaCanvasTexture(256, 256, (ctx, w) => {
    const c = w / 2;
    ctx.clearRect(0, 0, w, w);
    ctx.globalCompositeOperation = 'lighter';
    // Petals
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3;
      const len = 62 + hash(i, 13, 41) * 56;
      const wid = 12 + hash(i, 14, 43) * 16;
      const g = ctx.createLinearGradient(c, c, c + Math.cos(a) * len, c + Math.sin(a) * len);
      g.addColorStop(0, 'rgba(255,246,214,0.95)');
      g.addColorStop(0.4, 'rgba(255,182,84,0.5)');
      g.addColorStop(1, 'rgba(255,120,30,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a + 1.57) * wid, c + Math.sin(a + 1.57) * wid);
      ctx.lineTo(c + Math.cos(a) * len, c + Math.sin(a) * len);
      ctx.lineTo(c + Math.cos(a - 1.57) * wid, c + Math.sin(a - 1.57) * wid);
      ctx.closePath();
      ctx.fill();
    }
    // Hot core
    const core = ctx.createRadialGradient(c, c, 0, c, c, 40);
    core.addColorStop(0, 'rgba(255,255,250,1)');
    core.addColorStop(0.35, 'rgba(255,214,140,0.8)');
    core.addColorStop(1, 'rgba(255,150,50,0)');
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, w, w);
  });
}

/** Generic soft additive dot: sparks, embers, dust motes. */
function softDot(inner: string, outer: string): THREE.CanvasTexture {
  return rgbaCanvasTexture(64, 64, (ctx, w) => {
    const c = w / 2;
    ctx.clearRect(0, 0, w, w);
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, inner);
    g.addColorStop(0.35, outer);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

/** Neon shop sign. Doubles as its own emissive map. */
export function neonSign(text: string, color: string, sub?: string): THREE.CanvasTexture {
  return rgbaCanvasTexture(512, 160, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const y = sub ? h * 0.42 : h * 0.5;
    // Glow, drawn as several progressively tighter passes.
    for (const [blur, alpha] of [
      [34, 0.28],
      [18, 0.4],
      [7, 0.7],
      [0, 1],
    ] as const) {
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = blur;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = blur === 0 ? '#fffdf6' : color;
      ctx.font = `700 ${Math.round(h * 0.46)}px Impact, "Arial Black", sans-serif`;
      ctx.fillText(text, w / 2, y);
      ctx.restore();
    }
    if (sub) {
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = color;
      ctx.font = `600 ${Math.round(h * 0.15)}px ui-monospace, monospace`;
      ctx.letterSpacing = '6px';
      ctx.fillText(sub, w / 2, h * 0.78);
      ctx.restore();
    }
  });
}

/**
 * Wall-mounted Requisition Panel face: stencilled label, price, and a rough
 * silhouette of the hardware on offer.
 */
export function stationPanel(label: string, sub: string, price: number, accent: string, silhouette: 'smg' | 'shotgun' | 'ammo' | 'wrench'): THREE.CanvasTexture {
  return rgbaCanvasTexture(512, 512, (ctx, w, h) => {
    // Backing plate
    ctx.fillStyle = '#191c1f';
    ctx.fillRect(0, 0, w, h);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255,255,255,0.07)');
    grad.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Hazard border
    ctx.strokeStyle = accent;
    ctx.lineWidth = 8;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 26;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.globalAlpha = 1;

    // Silhouette
    ctx.save();
    ctx.translate(w / 2, h * 0.4);
    ctx.fillStyle = 'rgba(235,232,224,0.9)';
    if (silhouette === 'smg') {
      ctx.fillRect(-120, -14, 210, 28);
      ctx.fillRect(-134, -8, 26, 16);
      ctx.fillRect(-40, 14, 34, 74);
      ctx.fillRect(40, 14, 26, 58);
      ctx.fillRect(90, -8, 62, 12);
    } else if (silhouette === 'shotgun') {
      ctx.fillRect(-150, -12, 300, 22);
      ctx.fillRect(-150, 10, 120, 16);
      ctx.fillRect(20, 10, 60, 26);
      ctx.fillRect(120, 10, 76, 52);
    } else if (silhouette === 'ammo') {
      ctx.fillRect(-110, -60, 220, 130);
      ctx.fillStyle = '#191c1f';
      ctx.fillRect(-92, -42, 184, 26);
      ctx.fillStyle = 'rgba(235,232,224,0.9)';
      for (let i = 0; i < 5; i++) ctx.fillRect(-96 + i * 40, 0, 22, 56);
    } else {
      ctx.fillRect(-16, -70, 32, 150);
      ctx.beginPath();
      ctx.arc(0, -74, 40, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#191c1f';
      ctx.beginPath();
      ctx.arc(0, -80, 20, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Text block
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f2efe7';
    ctx.font = '700 46px Impact, "Arial Black", sans-serif';
    ctx.fillText(label.toUpperCase(), w / 2, h * 0.72);
    ctx.fillStyle = 'rgba(200,198,190,0.72)';
    ctx.font = '500 20px ui-monospace, monospace';
    ctx.fillText(sub.toUpperCase(), w / 2, h * 0.79);
    ctx.fillStyle = accent;
    ctx.font = '700 58px Impact, "Arial Black", sans-serif';
    ctx.fillText(`${price}`, w / 2, h * 0.92);

    // Wear
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#000';
    for (let i = 0; i < 60; i++) {
      const x = hash(i, 21, 47) * w;
      const y = hash(i, 22, 53) * h;
      ctx.fillRect(x, y, 2 + hash(i, 23, 59) * 26, 1 + hash(i, 24, 61) * 3);
    }
    ctx.globalAlpha = 1;
  });
}

/** Emissive-only version of a panel so the frame glows through bloom. */
export function panelGlow(accent: string): THREE.CanvasTexture {
  return rgbaCanvasTexture(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 10;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 22;
    ctx.strokeRect(10, 10, w - 20, h - 20);
  });
}

/** Stencilled hazard chevrons for the shutters. */
export function chevrons(): THREE.CanvasTexture {
  return rgbaCanvasTexture(512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#c8a52c';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#16181a';
    const step = 64;
    for (let x = -h; x < w + h; x += step * 2) {
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + step, h);
      ctx.lineTo(x + step + h, 0);
      ctx.lineTo(x + h, 0);
      ctx.closePath();
      ctx.fill();
    }
    // Scuffing
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#000';
    for (let i = 0; i < 90; i++) {
      ctx.fillRect(hash(i, 31, 67) * w, hash(i, 32, 71) * h, 1 + hash(i, 33, 73) * 22, 1 + hash(i, 34, 79) * 2);
    }
  });
}

/** Graffiti tag - cheap way to make a bare wall look inhabited. */
export function graffiti(text: string, color: string): THREE.CanvasTexture {
  return rgbaCanvasTexture(512, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-0.09);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.font = '700 104px Impact, "Arial Black", sans-serif';
    ctx.strokeStyle = 'rgba(10,10,10,0.85)';
    ctx.lineWidth = 14;
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
    // Drips
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    for (let i = 0; i < 10; i++) {
      const x = 90 + hash(i, 41, 83) * (w - 180);
      ctx.fillRect(x, h * 0.6, 3 + hash(i, 42, 89) * 3, 10 + hash(i, 43, 97) * 46);
    }
  });
}

export interface SpriteLib {
  bulletHole: THREE.Texture;
  bloodSplat: THREE.Texture;
  blobShadow: THREE.Texture;
  muzzleFlash: THREE.Texture;
  spark: THREE.Texture;
  dust: THREE.Texture;
  bloodMist: THREE.Texture;
  chevrons: THREE.Texture;
}

export function buildSprites(): SpriteLib {
  return {
    bulletHole: bulletHole(),
    bloodSplat: bloodSplat(),
    blobShadow: blobShadow(),
    muzzleFlash: muzzleFlash(),
    spark: softDot('rgba(255,244,214,1)', 'rgba(255,168,64,0.7)'),
    dust: softDot('rgba(196,188,172,0.5)', 'rgba(150,144,132,0.18)'),
    bloodMist: softDot('rgba(150,20,18,0.85)', 'rgba(80,8,8,0.35)'),
    chevrons: chevrons(),
  };
}
