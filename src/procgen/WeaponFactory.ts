import * as THREE from 'three';
import type { WeaponId } from '../types';
import type { MaterialLib } from './textures/materials';
import { bevelBox, box, cyl, GeoCollector, sphere, taper, torus, tube } from './geo';

/**
 * First-person weapon viewmodels, built from code.
 *
 * Viewmodel space: the weapon points down -Z (camera forward), +Y is up, +X is
 * right, and the origin sits at the shooting hand. Everything is authored at real
 * scale in metres, so a pistol slide really is 19cm - that is what makes the
 * field of view and the recoil travel feel right instead of toy-like.
 *
 * Detail strategy is the same as the props: correct silhouette, chamfered edges,
 * and a hard material split between machined steel, moulded polymer and timber.
 * Under ACES tone mapping with an environment map, that reads as manufactured
 * hardware. Polygon count is irrelevant here by comparison.
 */

export interface WeaponModel {
  group: THREE.Group;
  /** Reciprocating part: pistol slide, SMG charging handle, shotgun fore-end. */
  action: THREE.Group | null;
  /** How far the action travels rearward, metres. */
  actionTravel: number;
  /** Detachable magazine, for the reload animation. */
  magazine: THREE.Group | null;
  /** Empty at the muzzle: flash, smoke and tracer origin. */
  muzzle: THREE.Object3D;
  /** Empty at the ejection port: spent cases. */
  ejectPort: THREE.Object3D;
  /** Where the model sits at rest, before sway and recoil. */
  restPosition: THREE.Vector3;
  restRotation: THREE.Euler;
  /** Where the model sits when aiming down sights (sight aligned to centre). */
  adsPosition: THREE.Vector3;
  adsRotation: THREE.Euler;
}

/** Build one merged mesh per material from a collector, parented to `parent`. */
function flush(col: GeoCollector, parent: THREE.Object3D, matOf: Record<string, THREE.Material>): void {
  for (const key of col.materialKeys) {
    const geo = col.merge(key);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, matOf[key]);
    // Viewmodels are drawn in a separate overlay pass with their own light, so
    // they neither cast nor receive world shadows. Trying to shadow a viewmodel
    // with a scene-scale shadow map only ever produces acne.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    parent.add(mesh);
  }
  col.clear();
}

function anchor(name: string, x: number, y: number, z: number): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  return o;
}

// ---------------------------------------------------------------------------
// Sidewinder M1 - service pistol
// ---------------------------------------------------------------------------

function buildPistol(matOf: Record<string, THREE.Material>): WeaponModel {
  const group = new THREE.Group();
  group.name = 'Sidewinder M1';
  const col = new GeoCollector();

  // Frame, dust cover, trigger guard, beavertail.
  col.add('polymer', bevelBox(0.052, 0.098, 0.185, 0.006, { y: 0.0, z: -0.015 }));
  col.add('polymer', box(0.046, 0.05, 0.085, { y: -0.02, z: -0.095 }));
  col.add('polymer', torus(0.028, 0.008, 6, 12, Math.PI * 1.35, { y: -0.052, z: 0.008, rx: Math.PI / 2, rz: 0.5 }));
  col.add('polymer', box(0.05, 0.03, 0.05, { y: 0.03, z: 0.075 }));
  // Grip: raked back, textured by the polymer normal map.
  col.add('polymer', taper(0.048, 0.135, 0.072, 0.9, { y: -0.105, z: 0.035, rx: 0.2 }));
  col.add('polymer', box(0.052, 0.02, 0.078, { y: -0.172, z: 0.048, rx: 0.2 }));

  // Steel: barrel, guide rod, trigger, hammer, controls.
  col.add('steel', tube(0.0105, 0.05, 12, { y: 0.062, z: -0.15, rx: Math.PI / 2 }));
  col.add('steel', box(0.012, 0.028, 0.03, { y: -0.038, z: 0.0, rx: -0.2 }));
  col.add('steel', box(0.014, 0.03, 0.014, { y: 0.052, z: 0.088, rx: 0.35 }));
  col.add('steel', box(0.062, 0.012, 0.03, { x: -0.004, y: 0.035, z: 0.052 }));

  flush(col, group, matOf);

  // --- Slide: the reciprocating action -----------------------------------
  const action = new THREE.Group();
  action.name = 'slide';
  col.add('gunmetal', bevelBox(0.055, 0.058, 0.212, 0.005, { y: 0.068, z: -0.028 }));
  // Serrations at the rear for a purchase point.
  for (let i = 0; i < 7; i++) col.add('gunmetal', box(0.057, 0.05, 0.004, { y: 0.068, z: 0.045 + i * 0.008 }));
  // Ejection port cut, faked as a recessed dark box.
  col.add('steel', box(0.058, 0.024, 0.048, { x: 0.004, y: 0.082, z: -0.012 }));
  // Sights.
  col.add('gunmetal', box(0.008, 0.014, 0.01, { y: 0.104, z: -0.126 }));
  col.add('gunmetal', box(0.03, 0.014, 0.012, { y: 0.104, z: 0.062 }));
  flush(col, action, matOf);
  // Tritium dots. Tiny, emissive, and they make the sight picture readable in a
  // dark alley without a flashlight system.
  const dotGeo = sphere(0.0028, 6, 4);
  const frontDot = new THREE.Mesh(dotGeo, matOf.dot);
  frontDot.position.set(0, 0.111, -0.126);
  frontDot.frustumCulled = false;
  action.add(frontDot);
  for (const dx of [0.011, -0.011]) {
    const d = new THREE.Mesh(dotGeo.clone(), matOf.dot);
    d.position.set(dx, 0.111, 0.062);
    d.frustumCulled = false;
    action.add(d);
  }
  group.add(action);

  // --- Magazine ----------------------------------------------------------
  const magazine = new THREE.Group();
  magazine.name = 'magazine';
  col.add('gunmetal', box(0.038, 0.105, 0.052, { y: -0.115, z: 0.03, rx: 0.2 }));
  col.add('steel', box(0.042, 0.012, 0.058, { y: -0.172, z: 0.042, rx: 0.2 }));
  flush(col, magazine, matOf);
  group.add(magazine);

  const muzzle = anchor('muzzle', 0, 0.062, -0.176);
  const ejectPort = anchor('eject', 0.032, 0.086, -0.012);
  group.add(muzzle, ejectPort);

  return {
    group,
    action,
    actionTravel: 0.032,
    magazine,
    muzzle,
    ejectPort,
    restPosition: new THREE.Vector3(0.14, -0.13, -0.3),
    restRotation: new THREE.Euler(0.02, -0.14, 0.04),
    // ADS: bring the sight line onto the screen centre and closer to the eye.
    adsPosition: new THREE.Vector3(0, -0.095, -0.21),
    adsRotation: new THREE.Euler(0, 0, 0),
  };
}

// ---------------------------------------------------------------------------
// Hornet SR-9 - submachine gun
// ---------------------------------------------------------------------------

function buildSmg(matOf: Record<string, THREE.Material>): WeaponModel {
  const group = new THREE.Group();
  group.name = 'Hornet SR-9';
  const col = new GeoCollector();

  // Upper receiver + top rail.
  col.add('gunmetal', bevelBox(0.058, 0.082, 0.30, 0.006, { y: 0.022, z: -0.055 }));
  col.add('gunmetal', box(0.024, 0.012, 0.30, { y: 0.07, z: -0.055 }));
  for (let i = 0; i < 14; i++) col.add('gunmetal', box(0.03, 0.008, 0.006, { y: 0.076, z: -0.19 + i * 0.021 }));

  // Polymer handguard with M-LOK style slots and a hand stop.
  col.add('polymer', bevelBox(0.052, 0.052, 0.155, 0.005, { y: 0.005, z: -0.205 }));
  for (let i = 0; i < 4; i++) col.add('gunmetal', box(0.054, 0.014, 0.024, { y: 0.005, z: -0.26 + i * 0.035 }));
  col.add('polymer', box(0.03, 0.032, 0.028, { y: -0.03, z: -0.235, rx: -0.5 }));

  // Barrel, shroud and flash hider.
  col.add('steel', tube(0.0155, 0.13, 12, { y: 0.022, z: -0.30, rx: Math.PI / 2 }));
  col.add('gunmetal', tube(0.0095, 0.05, 10, { y: 0.022, z: -0.372, rx: Math.PI / 2 }));
  col.add('gunmetal', tube(0.0145, 0.035, 8, { y: 0.022, z: -0.392, rx: Math.PI / 2 }));

  // Pistol grip, trigger group, magazine well.
  col.add('polymer', taper(0.046, 0.132, 0.062, 0.88, { y: -0.088, z: 0.028, rx: 0.24 }));
  col.add('polymer', torus(0.026, 0.008, 6, 12, Math.PI * 1.3, { y: -0.038, z: -0.005, rx: Math.PI / 2, rz: 0.5 }));
  col.add('steel', box(0.012, 0.026, 0.028, { y: -0.03, z: -0.012, rx: -0.2 }));
  col.add('polymer', box(0.05, 0.06, 0.075, { y: -0.045, z: -0.055 }));

  // Folding stock.
  col.add('gunmetal', box(0.026, 0.05, 0.13, { y: 0.03, z: 0.135 }));
  col.add('polymer', box(0.038, 0.085, 0.03, { y: 0.024, z: 0.212 }));

  // Optic: tube sight on the rail.
  col.add('gunmetal', bevelBox(0.042, 0.036, 0.088, 0.004, { y: 0.098, z: -0.03 }));
  col.add('gunmetal', box(0.03, 0.026, 0.014, { y: 0.078, z: -0.03 }));
  col.add('steel', tube(0.016, 0.006, 10, { y: 0.098, z: -0.075, rx: Math.PI / 2 }));

  flush(col, group, matOf);

  // Reticle: a single emissive dot floating at the front lens.
  const reticle = new THREE.Mesh(sphere(0.0035, 6, 4), matOf.dot);
  reticle.position.set(0, 0.098, -0.072);
  reticle.frustumCulled = false;
  group.add(reticle);

  // --- Charging handle ---------------------------------------------------
  const action = new THREE.Group();
  action.name = 'chargingHandle';
  col.add('gunmetal', box(0.02, 0.018, 0.055, { x: 0.038, y: 0.052, z: -0.03 }));
  col.add('gunmetal', box(0.014, 0.03, 0.02, { x: 0.045, y: 0.052, z: -0.012 }));
  flush(col, action, matOf);
  group.add(action);

  // --- Magazine: curved, because 9mm cases stack in an arc ---------------
  const magazine = new THREE.Group();
  magazine.name = 'magazine';
  col.add('polymer', box(0.036, 0.11, 0.056, { y: -0.115, z: -0.048, rx: 0.1 }));
  col.add('polymer', box(0.036, 0.075, 0.054, { y: -0.208, z: -0.03, rx: 0.28 }));
  col.add('steel', box(0.04, 0.012, 0.058, { y: -0.248, z: -0.018, rx: 0.28 }));
  flush(col, magazine, matOf);
  group.add(magazine);

  const muzzle = anchor('muzzle', 0, 0.022, -0.412);
  const ejectPort = anchor('eject', 0.032, 0.03, -0.02);
  group.add(muzzle, ejectPort);

  return {
    group,
    action,
    actionTravel: 0.028,
    magazine,
    muzzle,
    ejectPort,
    restPosition: new THREE.Vector3(0.13, -0.145, -0.24),
    restRotation: new THREE.Euler(0.015, -0.12, 0.03),
    adsPosition: new THREE.Vector3(0, -0.098, -0.16),
    adsRotation: new THREE.Euler(0, 0, 0),
  };
}

// ---------------------------------------------------------------------------
// Breaker 12 - pump shotgun
// ---------------------------------------------------------------------------

function buildShotgun(matOf: Record<string, THREE.Material>): WeaponModel {
  const group = new THREE.Group();
  group.name = 'Breaker 12';
  const col = new GeoCollector();

  // Receiver, loading port, ejection port, safety.
  col.add('gunmetal', bevelBox(0.058, 0.088, 0.215, 0.007, { y: 0.012, z: -0.03 }));
  col.add('steel', box(0.06, 0.03, 0.075, { y: -0.02, z: -0.02 }));
  col.add('steel', box(0.06, 0.026, 0.06, { x: 0.004, y: 0.03, z: -0.01 }));
  col.add('gunmetal', box(0.02, 0.012, 0.012, { y: 0.05, z: 0.06 }));

  // Barrel and tube magazine, joined by two barrel bands.
  col.add('steel', tube(0.0175, 0.5, 14, { y: 0.036, z: -0.37, rx: Math.PI / 2 }));
  col.add('steel', tube(0.0135, 0.4, 12, { y: -0.006, z: -0.325, rx: Math.PI / 2 }));
  col.add('gunmetal', box(0.036, 0.062, 0.018, { y: 0.015, z: -0.5 }));
  col.add('gunmetal', box(0.036, 0.062, 0.018, { y: 0.015, z: -0.16 }));

  // Timber wrist and stock, cut with a proper comb and drop.
  col.add('wood', taper(0.05, 0.29, 0.088, 1.12, { y: -0.035, z: 0.185, rx: 1.44 }));
  col.add('wood', box(0.048, 0.05, 0.09, { y: -0.026, z: 0.075, rx: 0.3 }));
  col.add('gunmetal', box(0.05, 0.016, 0.09, { y: -0.078, z: 0.32, rx: 1.44 }));

  // Trigger group.
  col.add('gunmetal', torus(0.027, 0.008, 6, 12, Math.PI * 1.3, { y: -0.042, z: -0.005, rx: Math.PI / 2, rz: 0.5 }));
  col.add('steel', box(0.012, 0.027, 0.028, { y: -0.034, z: -0.012, rx: -0.2 }));

  flush(col, group, matOf);

  // Brass bead front sight.
  const bead = new THREE.Mesh(sphere(0.005, 8, 6), matOf.dot);
  bead.position.set(0, 0.058, -0.6);
  bead.frustumCulled = false;
  group.add(bead);

  // --- Pump fore-end -----------------------------------------------------
  const action = new THREE.Group();
  action.name = 'pump';
  col.add('wood', tube(0.029, 0.135, 12, { y: -0.006, z: -0.245, rx: Math.PI / 2 }));
  // Finger grooves.
  for (let i = 0; i < 5; i++) col.add('wood', tube(0.032, 0.008, 12, { y: -0.006, z: -0.3 + i * 0.026, rx: Math.PI / 2 }));
  col.add('gunmetal', box(0.03, 0.03, 0.02, { y: 0.018, z: -0.18 }));
  flush(col, action, matOf);
  group.add(action);

  const muzzle = anchor('muzzle', 0, 0.036, -0.622);
  const ejectPort = anchor('eject', 0.034, 0.03, -0.01);
  group.add(muzzle, ejectPort);

  return {
    group,
    action,
    // A pump has a long, deliberate stroke - that is the whole risk profile of
    // this weapon, so the animation must sell it.
    actionTravel: 0.085,
    magazine: null,
    muzzle,
    ejectPort,
    restPosition: new THREE.Vector3(0.15, -0.16, -0.2),
    restRotation: new THREE.Euler(0.02, -0.16, 0.035),
    adsPosition: new THREE.Vector3(0, -0.105, -0.14),
    adsRotation: new THREE.Euler(0, 0, 0),
  };
}

// ---------------------------------------------------------------------------
// Trench Fang - melee
// ---------------------------------------------------------------------------

function buildKnife(matOf: Record<string, THREE.Material>): WeaponModel {
  const group = new THREE.Group();
  group.name = 'Trench Fang';
  const col = new GeoCollector();

  // Blade: a tapered wedge with a false edge, pointing down -Z.
  col.add('steelBright', taper(0.03, 0.215, 0.0085, 0.22, { z: -0.115, rx: -Math.PI / 2 }));
  col.add('steelBright', taper(0.016, 0.06, 0.006, 0.1, { z: -0.245, rx: -Math.PI / 2 }));
  // Fuller groove down the flat.
  col.add('gunmetal', box(0.006, 0.004, 0.15, { y: 0.001, z: -0.11 }));

  // Cross guard and knuckle bow - the detail that makes it a *trench* knife.
  col.add('gunmetal', box(0.078, 0.016, 0.022, { z: -0.008 }));
  col.add('gunmetal', torus(0.052, 0.007, 6, 14, Math.PI * 1.15, { y: -0.036, z: 0.048, rx: Math.PI / 2, rz: 1.5 }));

  // Handle with grip rings.
  col.add('wood', cyl(0.019, 0.023, 0.115, 10, { z: 0.07, rx: Math.PI / 2 }));
  for (let i = 0; i < 4; i++) col.add('gunmetal', tube(0.0245, 0.006, 10, { z: 0.03 + i * 0.026, rx: Math.PI / 2 }));
  col.add('gunmetal', box(0.03, 0.03, 0.016, { z: 0.132 }));

  flush(col, group, matOf);

  const muzzle = anchor('tip', 0, 0, -0.275);
  const ejectPort = anchor('eject', 0, 0, 0);
  group.add(muzzle, ejectPort);

  return {
    group,
    action: null,
    actionTravel: 0,
    magazine: null,
    muzzle,
    ejectPort,
    // Held low and off to the side until the swing brings it across the screen.
    restPosition: new THREE.Vector3(0.24, -0.24, -0.16),
    restRotation: new THREE.Euler(-0.3, -0.7, 0.5),
    adsPosition: new THREE.Vector3(0.24, -0.24, -0.16),
    adsRotation: new THREE.Euler(-0.3, -0.7, 0.5),
  };
}

// ---------------------------------------------------------------------------

export type WeaponModels = Record<WeaponId, WeaponModel>;

export function createWeaponModels(lib: MaterialLib): WeaponModels {
  const matOf: Record<string, THREE.Material> = {
    gunmetal: lib.gunmetal,
    steel: lib.gunmetal,
    steelBright: lib.gunSteelBright,
    polymer: lib.gunPolymer,
    wood: lib.gunWood,
    dot: lib.emissiveToxic,
  };

  return {
    sidewinder: buildPistol(matOf),
    hornet: buildSmg(matOf),
    breaker: buildShotgun(matOf),
    fang: buildKnife(matOf),
  };
}
