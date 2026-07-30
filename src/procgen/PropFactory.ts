import * as THREE from 'three';
import type { PropDef } from '../content/level.city';
import type { MaterialLib } from './textures/materials';
import { graffiti as graffitiTex, neonSign, type SpriteLib } from './textures/sprites';
import { box, bevelBox, capsule, cyl, GeoCollector, plane, sphere, taper, torus, tube } from './geo';
import { Rng } from '../util/rng';

/**
 * Every physical object in the city, built from code.
 *
 * Builders emit *world-space* geometry into a `GeoCollector` keyed by material,
 * so the whole set merges down to a handful of draw calls. Only fixtures that
 * animate (neon, flickering fluorescents, the shutters) are kept as individual
 * meshes.
 *
 * Detailing philosophy: silhouette first, then chamfers and panel gaps, then
 * material contrast. A sedan with correct proportions, bevelled edges and a
 * clean metal/glass/rubber split reads as a real car at gameplay distance far
 * better than a high-poly one with flat shading would.
 */

export interface PropContext {
  col: GeoCollector;
  lib: MaterialLib;
  sprites: SpriteLib;
  /** Emissive meshes that pulse or fail. */
  flickers: { mesh: THREE.Mesh; base: number; amount: number }[];
  rng: Rng;
}

/**
 * Small solid-colour materials that don't warrant a full generated PBR set.
 * Roughness/metalness are still set deliberately - a traffic cone and a chrome
 * bollard must not respond to light the same way.
 */
export function propMaterials(): Record<string, THREE.MeshStandardMaterial> {
  const m = (color: number, roughness: number, metalness: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: metalness > 0.5 ? 1.2 : 0.5, ...extra });
  return {
    plasticOrange: m(0xd4581f, 0.62, 0.02),
    plasticWhite: m(0xd8d4c8, 0.55, 0.02),
    paintYellow: m(0xc8a52c, 0.58, 0.15),
    paintRed: m(0x8e211c, 0.52, 0.2),
    paintGreen: m(0x2f4a35, 0.6, 0.15),
    chrome: m(0x9aa0a6, 0.22, 0.95),
    tarp: m(0x3d4a3a, 0.78, 0.03),
    foliage: m(0x2a3a22, 0.86, 0),
    soil: m(0x241d16, 0.95, 0),
    signWhite: m(0xbfbdb4, 0.6, 0.1),
  };
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Rotate a locally-built part into place and hand it to the collector. */
function emit(ctx: PropContext, mat: string, geo: THREE.BufferGeometry, p: PropDef, tile = 1): void {
  const s = p.scale ?? 1;
  if (s !== 1) geo.scale(s, s, s);
  if (p.rotY) geo.rotateY(p.rotY);
  geo.translate(p.x, p.y ?? 0, p.z);
  ctx.col.add(mat, geo, tile);
}

function emitMany(ctx: PropContext, mat: string, geos: THREE.BufferGeometry[], p: PropDef, tile = 1): void {
  for (const g of geos) emit(ctx, mat, g, p, tile);
}

/** A mesh that has to stay addressable (animated emissive, unique texture). */
function emitMesh(ctx: PropContext, geo: THREE.BufferGeometry, mat: THREE.Material, p: PropDef): THREE.Mesh {
  const s = p.scale ?? 1;
  if (s !== 1) geo.scale(s, s, s);
  if (p.rotY) geo.rotateY(p.rotY);
  geo.translate(p.x, p.y ?? 0, p.z);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  ctx.col.addDynamic(mesh);
  return mesh;
}

// --------------------------------------------------------------------------
// Vehicles
// --------------------------------------------------------------------------

function buildCar(ctx: PropContext, p: PropDef): void {
  const paint = `carPaint${(p.variant ?? 0) % 6}`;
  // Body: two bevelled masses, cabin set back from the bonnet.
  emitMany(ctx, paint, [
    bevelBox(4.42, 0.66, 1.9, 0.09, { y: 0.74 }),
    box(4.5, 0.22, 1.78, { y: 0.44 }),
    taper(2.46, 0.6, 1.72, 0.88, { x: -0.16, y: 1.32 }),
    box(1.3, 0.16, 1.76, { x: 1.56, y: 1.05 }),
    box(1.02, 0.16, 1.76, { x: -1.74, y: 1.07 }),
    bevelBox(2.06, 0.1, 1.5, 0.04, { x: -0.16, y: 1.63 }),
    // Wing mirrors + door handles: tiny, but they break the silhouette.
    box(0.18, 0.1, 0.28, { x: 0.86, y: 1.34, z: 1.0 }),
    box(0.18, 0.1, 0.28, { x: 0.86, y: 1.34, z: -1.0 }),
    box(0.22, 0.05, 0.06, { x: -0.1, y: 1.02, z: 0.96 }),
    box(0.22, 0.05, 0.06, { x: -0.1, y: 1.02, z: -0.96 }),
  ], p, 2);

  // Glass. Raked screens, not vertical slabs.
  emitMany(ctx, 'carGlass', [
    box(0.06, 0.66, 1.6, { x: 1.06, y: 1.34, rz: 0.58 }),
    box(0.06, 0.62, 1.58, { x: -1.36, y: 1.36, rz: -0.66 }),
    box(2.24, 0.5, 0.05, { x: -0.16, y: 1.38, z: 0.86 }),
    box(2.24, 0.5, 0.05, { x: -0.16, y: 1.38, z: -0.86 }),
  ], p);

  // Bumpers, sills, grille.
  emitMany(ctx, 'carTrim', [
    box(0.22, 0.32, 1.92, { x: 2.26, y: 0.66 }),
    box(0.22, 0.32, 1.92, { x: -2.26, y: 0.68 }),
    box(0.1, 0.26, 1.3, { x: 2.24, y: 0.98 }),
    box(4.3, 0.1, 0.08, { y: 0.4, z: 0.96 }),
    box(4.3, 0.1, 0.08, { y: 0.4, z: -0.96 }),
  ], p);

  // Wheels: tyre + rim, four corners.
  const wheels: THREE.BufferGeometry[] = [];
  const rims: THREE.BufferGeometry[] = [];
  for (const wx of [1.44, -1.44]) {
    for (const wz of [0.9, -0.9]) {
      wheels.push(tube(0.35, 0.26, 14, { x: wx, y: 0.35, z: wz, rx: Math.PI / 2 }));
      rims.push(tube(0.19, 0.28, 10, { x: wx, y: 0.35, z: wz, rx: Math.PI / 2 }));
    }
  }
  emitMany(ctx, 'rubber', wheels, p);
  emitMany(ctx, 'chrome', rims, p);

  // Lamps. Dead headlights (dark glass), still-glowing tail lenses.
  emitMany(ctx, 'glassDark', [
    box(0.09, 0.24, 0.52, { x: 2.3, y: 0.9, z: 0.6 }),
    box(0.09, 0.24, 0.52, { x: 2.3, y: 0.9, z: -0.6 }),
  ], p);
  emitMany(ctx, 'paintRed', [
    box(0.08, 0.2, 0.44, { x: -2.3, y: 0.94, z: 0.62 }),
    box(0.08, 0.2, 0.44, { x: -2.3, y: 0.94, z: -0.62 }),
  ], p);
}

function buildVan(ctx: PropContext, p: PropDef): void {
  const paint = `carPaint${(p.variant ?? 1) % 6}`;
  emitMany(ctx, paint, [
    bevelBox(2.2, 1.5, 5.2, 0.1, { y: 1.28 }),
    taper(2.16, 0.62, 1.5, 0.9, { y: 1.28, z: 2.0 }),
    box(2.24, 0.24, 5.3, { y: 0.5 }),
    bevelBox(2.0, 0.1, 4.2, 0.04, { y: 2.06, z: -0.3 }),
    // Rear door seam and hinges.
    box(0.06, 1.3, 0.06, { x: 0.9, y: 1.3, z: -2.62 }),
    box(0.06, 1.3, 0.06, { x: -0.9, y: 1.3, z: -2.62 }),
  ], p, 2);
  emitMany(ctx, 'carGlass', [
    box(1.9, 0.66, 0.06, { y: 1.62, z: 2.5, rx: 0.36 }),
    box(0.05, 0.6, 1.0, { x: 1.06, y: 1.62, z: 1.7 }),
    box(0.05, 0.6, 1.0, { x: -1.06, y: 1.62, z: 1.7 }),
  ], p);
  emitMany(ctx, 'carTrim', [
    box(2.2, 0.3, 0.22, { y: 0.72, z: 2.66 }),
    box(2.2, 0.3, 0.22, { y: 0.74, z: -2.66 }),
    box(2.1, 0.06, 4.4, { y: 2.14, z: -0.3 }),
  ], p);
  const wheels: THREE.BufferGeometry[] = [];
  const rims: THREE.BufferGeometry[] = [];
  for (const wz of [1.7, -1.7]) {
    for (const wx of [1.05, -1.05]) {
      wheels.push(tube(0.4, 0.28, 14, { x: wx, y: 0.4, z: wz, rx: Math.PI / 2 }));
      rims.push(tube(0.2, 0.3, 10, { x: wx, y: 0.4, z: wz, rx: Math.PI / 2 }));
    }
  }
  emitMany(ctx, 'rubber', wheels, p);
  emitMany(ctx, 'chrome', rims, p);
}

// --------------------------------------------------------------------------
// Lighting fixtures
// --------------------------------------------------------------------------

function buildStreetlight(ctx: PropContext, p: PropDef): void {
  emitMany(ctx, 'steelPainted', [
    tube(0.16, 0.32, 10, { y: 0.16 }),
    cyl(0.075, 0.11, 5.0, 10, { y: 2.6 }),
    // Arm reaches out over the carriageway. rotY orients which kerb it is on.
    tube(0.065, 1.5, 8, { y: 4.88, z: 0.72, rx: Math.PI / 2 }),
    tube(0.05, 0.6, 6, { y: 4.6, z: 0.32, rx: Math.PI / 4 }),
  ], p);
  emitMany(ctx, 'galvanised', [bevelBox(0.5, 0.17, 0.92, 0.04, { y: 4.78, z: 1.36 })], p);
  // Lens: kept dynamic so a failing lamp can flicker independently.
  const lens = emitMesh(ctx, box(0.42, 0.07, 0.8, { y: 4.66, z: 1.36 }), ctx.lib.lampGlass.clone(), p);
  ctx.flickers.push({ mesh: lens, base: 7, amount: 0 });
}

function buildTrafficLight(ctx: PropContext, p: PropDef): void {
  emitMany(ctx, 'steelPainted', [
    tube(0.15, 0.3, 10, { y: 0.15 }),
    cyl(0.07, 0.1, 4.0, 10, { y: 2.0 }),
    bevelBox(0.36, 0.98, 0.3, 0.04, { y: 3.5, z: 0.22 }),
    // Visors over each lens.
    box(0.34, 0.05, 0.16, { y: 3.84, z: 0.4 }),
    box(0.34, 0.05, 0.16, { y: 3.5, z: 0.4 }),
    box(0.34, 0.05, 0.16, { y: 3.16, z: 0.4 }),
  ], p);
  // Only the red aspect is still alive - the grid is failing.
  emitMesh(ctx, cyl(0.1, 0.1, 0.05, 12, { y: 3.78, z: 0.38, rx: Math.PI / 2 }), ctx.lib.emissiveRed, p);
  emitMany(ctx, 'glassDark', [
    cyl(0.1, 0.1, 0.05, 12, { y: 3.44, z: 0.38, rx: Math.PI / 2 }),
    cyl(0.1, 0.1, 0.05, 12, { y: 3.1, z: 0.38, rx: Math.PI / 2 }),
  ], p);
}

function buildFluoro(ctx: PropContext, p: PropDef): void {
  emitMany(ctx, 'galvanised', [
    box(1.5, 0.1, 0.28, { y: 0.05 }),
    box(1.5, 0.06, 0.06, { y: 0.1, z: 0.14 }),
    box(1.5, 0.06, 0.06, { y: 0.1, z: -0.14 }),
    tube(0.012, 0.16, 5, { x: 0.6, y: 0.16 }),
    tube(0.012, 0.16, 5, { x: -0.6, y: 0.16 }),
  ], p);
  const cold = (p.variant ?? 0) === 0;
  const tubeMesh = emitMesh(
    ctx,
    cyl(0.045, 0.045, 1.36, 10, { y: -0.02, rz: Math.PI / 2 }),
    cold ? ctx.lib.emissiveCold.clone() : ctx.lib.emissiveAmber.clone(),
    p,
  );
  ctx.flickers.push({ mesh: tubeMesh, base: cold ? 4.5 : 4, amount: (p.variant ?? 0) === 1 ? 0.8 : 0.15 });
}

function buildNeon(ctx: PropContext, p: PropDef): void {
  const color = p.color ?? '#ff4a6a';
  const tex = neonSign(p.text ?? 'OPEN', color, 'BLACKPINE');
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    emissiveMap: tex,
    emissive: new THREE.Color(color),
    emissiveIntensity: 4.2,
    transparent: true,
    alphaTest: 0.06,
    roughness: 0.5,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  emitMany(ctx, 'steelRust', [box(2.5, 0.9, 0.09, { z: -0.06 })], p);
  emitMesh(ctx, plane(2.4, 0.75, {}), mat, p);
}

// --------------------------------------------------------------------------
// Street furniture & containers
// --------------------------------------------------------------------------

function buildDumpster(ctx: PropContext, p: PropDef): void {
  emitMany(ctx, 'steelPainted', [
    taper(2.06, 1.1, 1.28, 1.09, { y: 0.66 }),
    box(2.1, 0.09, 1.34, { y: 1.24, z: -0.06 }),
    // Lid, tipped half open. Instantly reads as "rummaged through".
    box(2.06, 0.07, 1.3, { y: 1.5, z: 0.62, rx: -0.55 }),
    box(0.09, 0.34, 0.09, { x: 0.98, y: 1.02, z: 0.66 }),
    box(0.09, 0.34, 0.09, { x: -0.98, y: 1.02, z: 0.66 }),
    // Corrugation ribs.
    box(2.12, 0.05, 0.05, { y: 0.9, z: 0.65 }),
    box(2.12, 0.05, 0.05, { y: 0.55, z: 0.65 }),
    box(2.12, 0.05, 0.05, { y: 0.9, z: -0.65 }),
  ], p, 1.5);
  const wheels: THREE.BufferGeometry[] = [];
  for (const wx of [0.82, -0.82]) for (const wz of [0.48, -0.48]) wheels.push(tube(0.11, 0.07, 8, { x: wx, y: 0.11, z: wz, rx: Math.PI / 2 }));
  emitMany(ctx, 'rubber', wheels, p);
}

function buildCrate(ctx: PropContext, p: PropDef): void {
  const parts: THREE.BufferGeometry[] = [bevelBox(0.84, 0.84, 0.84, 0.04, { y: 0.42 })];
  // Batten frame around the edges - the difference between a crate and a cube.
  for (const y of [0.06, 0.78]) {
    parts.push(box(0.9, 0.07, 0.07, { y, z: 0.44 }), box(0.9, 0.07, 0.07, { y, z: -0.44 }));
    parts.push(box(0.07, 0.07, 0.9, { x: 0.44, y }), box(0.07, 0.07, 0.9, { x: -0.44, y }));
  }
  for (const x of [0.41, -0.41]) parts.push(box(0.07, 0.84, 0.07, { x, y: 0.42, z: 0.44 }), box(0.07, 0.84, 0.07, { x, y: 0.42, z: -0.44 }));
  emitMany(ctx, 'wood', parts, p, 0.8);
}

function buildPallet(ctx: PropContext, p: PropDef): void {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) parts.push(box(1.2, 0.035, 0.14, { y: 0.02, z: -0.4 + i * 0.4 }));
  for (let i = 0; i < 3; i++) parts.push(box(0.12, 0.09, 0.9, { x: -0.5 + i * 0.5, y: 0.08 }));
  for (let i = 0; i < 6; i++) parts.push(box(1.2, 0.035, 0.1, { x: 0, y: 0.14, z: -0.4 + i * 0.16 }));
  emitMany(ctx, 'plywood', parts, p, 0.9);
}

function buildBarrel(ctx: PropContext, p: PropDef): void {
  emitMany(ctx, 'steelRust', [
    cyl(0.28, 0.28, 0.86, 16, { y: 0.44 }),
    cyl(0.3, 0.3, 0.06, 16, { y: 0.28 }),
    cyl(0.3, 0.3, 0.06, 16, { y: 0.6 }),
    cyl(0.26, 0.26, 0.04, 16, { y: 0.88 }),
  ], p, 1.2);
}

function buildCone(ctx: PropContext, p: PropDef): void {
  emitMany(ctx, 'plasticOrange', [cyl(0.035, 0.16, 0.56, 10, { y: 0.28 }), box(0.4, 0.03, 0.4, { y: 0.015 })], p);
  emitMany(ctx, 'plasticWhite', [cyl(0.09, 0.11, 0.09, 10, { y: 0.32 })], p);
}

function buildHydrant(ctx: PropContext, p: PropDef): void {
  emitMany(ctx, 'paintRed', [
    cyl(0.11, 0.14, 0.62, 12, { y: 0.31 }),
    sphere(0.12, 12, 8, { y: 0.66 }),
    cyl(0.05, 0.05, 0.14, 8, { y: 0.42, z: 0.14, rx: Math.PI / 2 }),
    cyl(0.05, 0.05, 0.14, 8, { y: 0.42, x: 0.14, rz: Math.PI / 2 }),
    box(0.09, 0.07, 0.09, { y: 0.76 }),
  ], p);
  emitMany(ctx, 'chrome', [cyl(0.18, 0.2, 0.06, 12, { y: 0.03 })], p);
}

function buildBench(ctx: PropContext, p: PropDef): void {
  const iron: THREE.BufferGeometry[] = [];
  for (const x of [0.82, -0.82]) {
    iron.push(box(0.07, 0.44, 0.6, { x, y: 0.22 }));
    iron.push(box(0.07, 0.5, 0.08, { x, y: 0.68, z: -0.24 }));
    iron.push(box(0.11, 0.05, 0.66, { x, y: 0.02 }));
  }
  emitMany(ctx, 'steelPainted', iron, p);
  const slats: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) slats.push(box(1.82, 0.05, 0.11, { y: 0.45, z: -0.22 + i * 0.15 }));
  for (let i = 0; i < 3; i++) slats.push(box(1.82, 0.11, 0.05, { y: 0.62 + i * 0.16, z: -0.27 }));
  emitMany(ctx, 'wood', slats, p, 0.9);
}

function buildNewsbox(ctx: PropContext, p: PropDef): void {
  emitMany(ctx, 'steelPainted', [
    bevelBox(0.64, 0.86, 0.46, 0.03, { y: 0.72 }),
    box(0.09, 0.3, 0.09, { x: 0.24, y: 0.15 }),
    box(0.09, 0.3, 0.09, { x: -0.24, y: 0.15 }),
    box(0.66, 0.1, 0.48, { y: 1.18, rx: -0.12 }),
  ], p);
  emitMany(ctx, 'glassDark', [box(0.5, 0.44, 0.03, { y: 0.86, z: 0.24 })], p);
}

function buildSandbags(ctx: PropContext, p: PropDef): void {
  const bags: THREE.BufferGeometry[] = [];
  const r = ctx.rng;
  for (let row = 0; row < 2; row++) {
    const n = row === 0 ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const g = sphere(0.2, 8, 6, {
        x: -0.48 + i * 0.32 + (row === 1 ? 0.16 : 0),
        y: 0.16 + row * 0.26,
        z: r.jitter(0.05),
        ry: r.jitter(0.4),
      });
      // Squash into a sagging sack rather than a ball.
      g.scale(1.5, 0.68, 1);
      bags.push(g);
    }
  }
  emitMany(ctx, 'fabricSack', bags, p, 0.7);
}

function buildPillar(ctx: PropContext, p: PropDef): void {
  emitMany(ctx, 'concrete', [bevelBox(0.78, 4.2, 0.78, 0.05, { y: 2.1 }), box(0.94, 0.14, 0.94, { y: 0.07 })], p, 2);
  // Hazard band at bumper height - a real car park detail, and it helps the
  // player read distance in a low-contrast concrete space.
  emitMany(ctx, 'paintYellow', [box(0.8, 0.34, 0.8, { y: 1.05 })], p);
}

function buildFence(ctx: PropContext, p: PropDef): void {
  emitMany(ctx, 'galvanised', [
    tube(0.045, 2.1, 8, { x: -1.5, y: 1.05 }),
    tube(0.045, 2.1, 8, { x: 1.5, y: 1.05 }),
    tube(0.03, 3.0, 6, { y: 2.05, rz: Math.PI / 2 }),
    tube(0.03, 3.0, 6, { y: 0.1, rz: Math.PI / 2 }),
  ], p);
  emitMany(ctx, 'chainlink', [plane(3.0, 1.95, { y: 1.05 })], p, 0.5);
}

function buildAcUnit(ctx: PropContext, p: PropDef): void {
  emitMany(ctx, 'galvanised', [
    bevelBox(0.9, 0.72, 0.6, 0.03, { z: -0.3 }),
    box(0.98, 0.06, 0.62, { y: 0.39, z: -0.3 }),
    // Wall brackets.
    box(0.08, 0.1, 0.62, { x: 0.4, y: -0.4, z: -0.3 }),
    box(0.08, 0.1, 0.62, { x: -0.4, y: -0.4, z: -0.3 }),
  ], p);
  emitMany(ctx, 'chainlink', [plane(0.66, 0.56, { z: 0.01 })], p, 0.28);
  emitMany(ctx, 'steelRust', [cyl(0.2, 0.2, 0.05, 12, { z: -0.08, rx: Math.PI / 2 })], p);
}

function buildFireEscape(ctx: PropContext, p: PropDef): void {
  const parts: THREE.BufferGeometry[] = [
    box(2.4, 0.07, 1.1, { z: -0.55 }),
    box(2.4, 0.09, 0.09, { y: 1.05, z: -0.05 }),
    box(2.4, 0.09, 0.09, { y: 0.55, z: -0.05 }),
  ];
  for (const x of [1.15, -1.15, 0]) parts.push(tube(0.035, 1.1, 6, { x, y: 0.55, z: -0.05 }));
  for (const x of [1.15, -1.15]) parts.push(tube(0.035, 1.1, 6, { x, y: 0.55, z: -1.05 }));
  // Ladder down to the street.
  for (const x of [0.28, -0.28]) parts.push(tube(0.035, 2.6, 6, { x: x + 0.9, y: -1.3, z: -0.9 }));
  for (let i = 0; i < 8; i++) parts.push(tube(0.024, 0.56, 5, { x: 0.9, y: -0.2 - i * 0.32, z: -0.9, rz: Math.PI / 2 }));
  emitMany(ctx, 'steelRust', parts, p, 1.4);
}

function buildAwning(ctx: PropContext, p: PropDef): void {
  emitMany(ctx, 'tarp', [box(2.8, 0.06, 1.25, { y: 0.2, z: 0.55, rx: 0.24 }), box(2.8, 0.3, 0.05, { y: 0.02, z: 1.14 })], p);
  emitMany(ctx, 'steelRust', [
    tube(0.035, 1.3, 6, { x: 1.34, y: 0.1, z: 0.55, rx: Math.PI / 2 - 0.24 }),
    tube(0.035, 1.3, 6, { x: -1.34, y: 0.1, z: 0.55, rx: Math.PI / 2 - 0.24 }),
    box(2.9, 0.08, 0.08, { y: 0.05, z: 0.02 }),
  ], p);
}

function buildPlanter(ctx: PropContext, p: PropDef): void {
  emitMany(ctx, 'concrete', [taper(1.1, 0.72, 1.1, 1.14, { y: 0.36 }), box(1.24, 0.08, 1.24, { y: 0.72 })], p, 1.5);
  emitMany(ctx, 'soil', [box(1.0, 0.08, 1.0, { y: 0.7 })], p);
  // Dead shrub. Nothing in Blackpine is thriving.
  const r = ctx.rng;
  const leaves: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const g = sphere(0.24, 8, 6, { x: r.jitter(0.24), y: 0.86 + r.float(0, 0.22), z: r.jitter(0.24) });
    g.scale(1, 0.72, 1);
    leaves.push(g);
  }
  emitMany(ctx, 'foliage', leaves, p);
  emitMany(ctx, 'wood', [tube(0.045, 0.5, 6, { y: 0.95 })], p, 0.5);
}

function buildTireStack(ctx: PropContext, p: PropDef): void {
  const r = ctx.rng;
  const tires: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    tires.push(torus(0.3, 0.11, 8, 16, Math.PI * 2, { x: r.jitter(0.05), y: 0.12 + i * 0.23, z: r.jitter(0.05), rx: Math.PI / 2, ry: r.jitter(0.5) }));
  }
  emitMany(ctx, 'rubber', tires, p);
}

function buildPipes(ctx: PropContext, p: PropDef): void {
  const parts: THREE.BufferGeometry[] = [];
  const runs = [
    { y: 3.4, r: 0.11 },
    { y: 3.1, r: 0.07 },
    { y: 2.85, r: 0.05 },
  ];
  for (const run of runs) {
    parts.push(cyl(run.r, run.r, 11, 10, { y: run.y, z: 0, rx: Math.PI / 2 }));
    // Couplings every couple of metres.
    for (let i = -4; i <= 4; i += 2) parts.push(cyl(run.r * 1.28, run.r * 1.28, 0.14, 10, { y: run.y, z: i, rx: Math.PI / 2 }));
  }
  for (let i = -4; i <= 4; i += 2) parts.push(box(0.06, 0.75, 0.1, { x: 0.16, y: 3.12, z: i }));
  emitMany(ctx, 'galvanised', parts, p, 1.2);
}

function buildTrashPile(ctx: PropContext, p: PropDef): void {
  const r = ctx.rng;
  const bags: THREE.BufferGeometry[] = [];
  const count = 4 + ((p.variant ?? 0) % 3) * 2;
  for (let i = 0; i < count; i++) {
    const g = sphere(0.26, 8, 6, { x: r.jitter(0.5), y: 0.2 + r.float(0, 0.28), z: r.jitter(0.5) });
    g.scale(1.1, 0.86, 1.05);
    bags.push(g);
  }
  emitMany(ctx, 'trashBag', bags, p);
  const boxes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    boxes.push(box(r.float(0.3, 0.5), r.float(0.2, 0.35), r.float(0.3, 0.5), { x: r.jitter(0.7), y: 0.16, z: r.jitter(0.7), ry: r.jitter(1) }));
  }
  emitMany(ctx, 'cardboard', boxes, p, 0.6);
}

function buildCart(ctx: PropContext, p: PropDef): void {
  emitMany(ctx, 'galvanised', [
    box(0.6, 0.04, 0.86, { y: 0.5, rx: 0.1 }),
    box(0.6, 0.04, 0.06, { y: 0.78, z: -0.42 }),
    tube(0.02, 0.5, 5, { x: 0.28, y: 0.28, z: 0.36 }),
    tube(0.02, 0.5, 5, { x: -0.28, y: 0.28, z: 0.36 }),
    tube(0.02, 0.5, 5, { x: 0.28, y: 0.28, z: -0.36 }),
    tube(0.02, 0.5, 5, { x: -0.28, y: 0.28, z: -0.36 }),
    tube(0.02, 0.6, 5, { y: 0.86, z: -0.42, rz: Math.PI / 2 }),
  ], p);
  emitMany(ctx, 'chainlink', [
    plane(0.6, 0.42, { y: 0.72, z: 0.42, rx: -0.2 }),
    plane(0.6, 0.42, { y: 0.72, z: -0.42 }),
    plane(0.84, 0.42, { x: 0.3, y: 0.72, ry: Math.PI / 2 }),
    plane(0.84, 0.42, { x: -0.3, y: 0.72, ry: Math.PI / 2 }),
  ], p, 0.3);
  const casters: THREE.BufferGeometry[] = [];
  for (const cx of [0.24, -0.24]) for (const cz of [0.34, -0.34]) casters.push(tube(0.05, 0.03, 8, { x: cx, y: 0.05, z: cz, rx: Math.PI / 2 }));
  emitMany(ctx, 'rubber', casters, p);
}

function buildBarricade(ctx: PropContext, p: PropDef): void {
  emitMany(ctx, 'wood', [
    box(0.14, 1.2, 0.1, { x: -0.8, y: 0.6 }),
    box(0.14, 1.2, 0.1, { x: 0.8, y: 0.6 }),
    box(1.9, 0.16, 0.06, { y: 0.9, rz: 0.14 }),
    box(1.9, 0.16, 0.06, { y: 0.6, rz: -0.1 }),
    box(1.9, 0.16, 0.06, { y: 0.3, rz: 0.06 }),
  ], p, 0.8);
  emitMany(ctx, 'galvanised', [box(0.06, 0.06, 0.16, { x: -0.8, y: 0.9 }), box(0.06, 0.06, 0.16, { x: 0.8, y: 0.6 })], p);
}

function buildGrate(ctx: PropContext, p: PropDef): void {
  const parts: THREE.BufferGeometry[] = [
    box(1.0, 0.06, 0.7, { y: 0.02 }),
    box(1.06, 0.09, 0.76, { y: -0.02 }),
  ];
  for (let i = 0; i < 7; i++) parts.push(box(0.86, 0.05, 0.04, { y: 0.06, z: -0.26 + i * 0.088 }));
  emitMany(ctx, 'steelRust', parts, p, 0.8);
}

function buildBollard(ctx: PropContext, p: PropDef): void {
  emitMany(ctx, 'galvanised', [cyl(0.075, 0.09, 0.92, 10, { y: 0.46 }), sphere(0.08, 10, 6, { y: 0.92 })], p);
}

function buildGraffiti(ctx: PropContext, p: PropDef): void {
  const tex = graffitiTex(p.text ?? 'ROTWAVE', p.color ?? '#c8d64a');
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.08,
    roughness: 0.85,
    metalness: 0,
    // Prevents z-fighting with the wall it is sprayed onto.
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  emitMesh(ctx, plane(2.6, 1.3, {}), mat, p);
}

// --------------------------------------------------------------------------
// Dispatch
// --------------------------------------------------------------------------

const BUILDERS: Record<string, (ctx: PropContext, p: PropDef) => void> = {
  car: buildCar,
  van: buildVan,
  streetlight: buildStreetlight,
  trafficlight: buildTrafficLight,
  fluoro: buildFluoro,
  neon: buildNeon,
  dumpster: buildDumpster,
  crate: buildCrate,
  pallet: buildPallet,
  barrel: buildBarrel,
  cone: buildCone,
  hydrant: buildHydrant,
  bench: buildBench,
  newsbox: buildNewsbox,
  sandbags: buildSandbags,
  pillar: buildPillar,
  fence: buildFence,
  acunit: buildAcUnit,
  fireescape: buildFireEscape,
  awning: buildAwning,
  planter: buildPlanter,
  tirestack: buildTireStack,
  pipes: buildPipes,
  trashpile: buildTrashPile,
  cart: buildCart,
  barricade: buildBarricade,
  grate: buildGrate,
  bollard: buildBollard,
  graffiti: buildGraffiti,
};

export function buildProp(ctx: PropContext, p: PropDef): void {
  const fn = BUILDERS[p.type];
  if (!fn) {
    if (import.meta.env.DEV) console.warn(`[PropFactory] no builder for "${p.type}"`);
    return;
  }
  fn(ctx, p);
}
