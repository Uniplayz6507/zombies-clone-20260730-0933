import * as THREE from 'three';
import {
  BLOCKS,
  DOORS,
  PROPS,
  SLABS,
  SPAWNS,
  STATIONS,
  type BlockDef,
  type Zone,
} from '../content/level.city';
import type { MaterialLib } from './textures/materials';
import { panelGlow, stationPanel, type SpriteLib } from './textures/sprites';
import { bevelBox, box, boxFrom, cyl, disposeTree, GeoCollector, plane, tube } from './geo';
import { buildProp, propMaterials, type PropContext } from './PropFactory';
import { Rng } from '../util/rng';

/**
 * Assembles BLACKPINE DISTRICT.
 *
 * Two structural decisions drive this file:
 *
 * 1. **Per-zone collection.** Geometry is accumulated into one collector per
 *    zone. That lets the engine hide an entire area with a single `.visible`
 *    flag when its shutter is shut - trivial portal culling for a three-area map,
 *    and it roughly halves the worst-case scene.
 *
 * 2. **Per-material merging inside each zone.** Everything static in a zone ends
 *    up as one mesh per material. The full city - walls, kerbs, road markings,
 *    100 props, shutters, panels - lands at roughly 60 draw calls instead of the
 *    800+ a naive object-per-prop scene graph would produce.
 */

const ZONES: Zone[] = ['street', 'alley', 'garage'];

export interface FlickerTarget {
  mesh: THREE.Mesh;
  base: number;
  amount: number;
}

export interface ShutterHandle {
  id: string;
  group: THREE.Group;
  /** How far it has to travel to disappear into the lintel. */
  travel: number;
  /** 0 = shut, 1 = fully open. Animated by the engine. */
  openness: number;
}

export interface CityBuild {
  root: THREE.Group;
  zoneGroups: Record<Zone, THREE.Group>;
  shutters: ShutterHandle[];
  /** Emissive frames on the Requisition Panels, pulsed when affordable. */
  panelGlows: Map<string, THREE.Mesh>;
  flickers: FlickerTarget[];
  /** Everything shadow-relevant, for the one-off static shadow bake. */
  stats: { meshes: number; triangles: number };
  dispose(): void;
}

export function buildCity(lib: MaterialLib, sprites: SpriteLib): CityBuild {
  const rng = new Rng(0x1ce0ffee);
  const extras = propMaterials();

  // Flat name -> material lookup so level data can reference materials by string.
  const matOf: Record<string, THREE.Material> = {
    asphalt: lib.asphalt,
    asphaltWet: lib.asphaltWet,
    sidewalk: lib.sidewalk,
    garageFloor: lib.garageFloor,
    brick: lib.brick,
    brickDark: lib.brickDark,
    stucco: lib.stucco,
    facade: lib.facade,
    concrete: lib.concrete,
    garageCeiling: lib.garageCeiling,
    rubble: lib.rubble,
    steelPainted: lib.steelPainted,
    steelRust: lib.steelRust,
    shutter: lib.shutter,
    chainlink: lib.chainlink,
    galvanised: lib.galvanised,
    wood: lib.wood,
    plywood: lib.plywood,
    rubber: lib.rubber,
    fabricSack: lib.fabricSack,
    cardboard: lib.cardboard,
    trashBag: lib.trashBag,
    glassDark: lib.glassDark,
    carGlass: lib.carGlass,
    carTrim: lib.carTrim,
    ...extras,
  };
  lib.carPaint.forEach((m, i) => {
    matOf[`carPaint${i}`] = m;
  });

  const collectors: Record<Zone, GeoCollector> = {
    street: new GeoCollector(),
    alley: new GeoCollector(),
    garage: new GeoCollector(),
  };

  const shutters: ShutterHandle[] = [];
  const panelGlows = new Map<string, THREE.Mesh>();
  const flickers: FlickerTarget[] = [];

  // -----------------------------------------------------------------------
  // Ground
  // -----------------------------------------------------------------------
  for (const s of SLABS) {
    const col = collectors[s.zone];
    // Slabs get real thickness so the kerb edge is a visible face, not a seam.
    col.add(s.mat, boxFrom(s.x0, s.x1, s.y - 0.35, s.y, s.z0, s.z1), s.tile);
  }

  // Road markings. Cheap, and they do more for "this is a street" than any
  // amount of extra geometry.
  {
    const col = collectors.street;
    for (let x = -19; x < 7.5; x += 3) {
      col.add('plasticWhite', boxFrom(x, x + 1.7, 0.001, 0.014, -0.09, 0.09), 1);
    }
    // Kerbside double lines and a hatched box junction near the shutter.
    col.add('paintYellow', boxFrom(-20, 8, 0.001, 0.012, -8.85, -8.72), 1);
    col.add('paintYellow', boxFrom(-20, 8, 0.001, 0.012, 8.72, 8.85), 1);
    // Faded pedestrian crossing.
    for (let i = 0; i < 7; i++) {
      col.add('plasticWhite', boxFrom(-12.4 + i * 0.62, -12.0 + i * 0.62, 0.001, 0.013, -8.6, 8.6), 1);
    }
  }

  // Parking bay markings in the garage.
  {
    const col = collectors.garage;
    for (let i = 0; i < 6; i++) {
      const z = 14 + i * 2.6;
      col.add('paintYellow', boxFrom(9.2, 12.2, 0.001, 0.013, z, z + 0.1), 1);
      col.add('paintYellow', boxFrom(26.6, 29.8, 0.001, 0.013, z, z + 0.1), 1);
    }
    // Directional arrows down the central aisle.
    for (let i = 0; i < 3; i++) {
      const z = 17 + i * 5;
      col.add('paintYellow', boxFrom(18.4, 18.7, 0.001, 0.013, z, z + 1.6), 1);
      col.add('paintYellow', boxFrom(18.1, 19.0, 0.001, 0.013, z + 1.6, z + 1.9), 1);
    }
  }

  // -----------------------------------------------------------------------
  // Structure
  // -----------------------------------------------------------------------
  const addBlock = (b: BlockDef) => {
    const col = collectors[b.zone];
    if (b.upperMat && b.upperFrom !== undefined && b.upperFrom > b.y0 && b.upperFrom < b.y1) {
      col.add(b.mat, boxFrom(b.x0, b.x1, b.y0, b.upperFrom, b.z0, b.z1), b.tile);
      col.add(b.upperMat, boxFrom(b.x0, b.x1, b.upperFrom, b.y1, b.z0, b.z1), b.tileUpper ?? b.tile);
      // String course: a 12cm proud band at the material change. Reads as a
      // real building rather than two stacked textures.
      col.add(
        'concrete',
        boxFrom(b.x0 - 0.09, b.x1 + 0.09, b.upperFrom - 0.06, b.upperFrom + 0.14, b.z0 - 0.09, b.z1 + 0.09),
        2,
      );
    } else {
      col.add(b.mat, boxFrom(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1), b.tile);
    }
  };
  BLOCKS.forEach(addBlock);

  // Rubble pile against the collapsed west end, so it isn't a flat grey wall.
  {
    const col = collectors.street;
    for (let i = 0; i < 26; i++) {
      const s = rng.float(0.35, 1.3);
      col.add(
        'rubble',
        box(s, s * rng.float(0.4, 0.9), s, {
          x: -19.6 + rng.float(0, 1.4),
          y: rng.float(0, 2.4),
          z: rng.float(-11, 12),
          ry: rng.float(0, 3),
          rx: rng.jitter(0.4),
        }),
        1.5,
      );
    }
    // Bent rebar poking out of the collapse.
    for (let i = 0; i < 10; i++) {
      col.add(
        'steelRust',
        tube(0.024, rng.float(0.7, 1.8), 5, {
          x: -19.9 + rng.float(0, 0.8),
          y: rng.float(0.6, 3.2),
          z: rng.float(-10, 11),
          rz: rng.jitter(1.1),
          rx: rng.jitter(0.8),
        }),
        1,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Spawn breaches - every spawn point gets a physical reason to exist
  // -----------------------------------------------------------------------
  for (const sp of SPAWNS) {
    const col = collectors[sp.zone];
    const cos = Math.cos(sp.yaw);
    const sin = Math.sin(sp.yaw);
    // Local offset helper: push a part out along the breach's facing.
    const at = (fwd: number, y: number, side = 0) => ({
      x: sp.x + sin * fwd + cos * side,
      y,
      z: sp.z + cos * fwd - sin * side,
    });

    if (sp.kind === 'window' || sp.kind === 'stairwell') {
      // Dark recess + splintered boards hanging off the frame.
      const rec = at(-0.18, 1.2);
      col.add('glassDark', box(1.5, 2.1, 0.12, { ...rec, ry: sp.yaw }), 1);
      col.add('concrete', box(1.9, 0.16, 0.34, { ...at(-0.1, 2.35), ry: sp.yaw }), 1.5);
      col.add('concrete', box(1.9, 0.14, 0.34, { ...at(-0.1, 0.1), ry: sp.yaw }), 1.5);
      for (let i = 0; i < 3; i++) {
        const b = at(0.02, 0.55 + i * 0.6, rng.jitter(0.2));
        col.add('plywood', box(1.7, 0.16, 0.05, { ...b, ry: sp.yaw, rz: rng.jitter(0.22) }), 0.8);
      }
    } else if (sp.kind === 'vent') {
      col.add('glassDark', box(1.3, 1.5, 0.1, { ...at(-0.12, 0.85), ry: sp.yaw }), 1);
      col.add('galvanised', box(1.5, 0.12, 0.2, { ...at(-0.06, 1.66), ry: sp.yaw }), 1);
      col.add('chainlink', plane(1.2, 1.4, { ...at(0.02, 0.85), ry: sp.yaw }), 0.35);
    } else if (sp.kind === 'grate') {
      col.add('glassDark', boxFrom(sp.x - 0.6, sp.x + 0.6, -0.6, 0.0, sp.z - 0.45, sp.z + 0.45), 1);
      col.add('steelRust', boxFrom(sp.x - 0.72, sp.x + 0.72, -0.05, 0.03, sp.z - 0.56, sp.z + 0.56), 0.8);
      // Prised-off cover, leaning nearby.
      col.add('steelRust', box(1.1, 0.06, 0.8, { x: sp.x + 0.95, y: 0.28, z: sp.z + 0.3, rz: 0.9, ry: 0.4 }), 0.8);
    } else {
      // Rubble breach: a gap punched through the collapse.
      for (let i = 0; i < 7; i++) {
        const s = rng.float(0.3, 0.8);
        col.add('rubble', box(s, s * 0.7, s, { x: sp.x + rng.jitter(1), y: rng.float(0, 0.9), z: sp.z + rng.jitter(1.2), ry: rng.float(0, 3) }), 1.5);
      }
      col.add('glassDark', box(0.4, 2.0, 2.2, { x: sp.x - 0.4, y: 1.0, z: sp.z }), 1);
    }
  }

  // -----------------------------------------------------------------------
  // Props
  // -----------------------------------------------------------------------
  const propCtx: PropContext = {
    col: collectors.street,
    lib,
    sprites,
    flickers,
    rng,
  };
  for (const p of PROPS) {
    propCtx.col = collectors[p.zone];
    buildProp(propCtx, p);
  }

  // -----------------------------------------------------------------------
  // Shutters (purchasable doors)
  // -----------------------------------------------------------------------
  for (const d of DOORS) {
    const group = new THREE.Group();
    const w = d.x1 - d.x0;
    const dd = d.z1 - d.z0;
    const h = d.y1 - d.y0;
    const cx = (d.x0 + d.x1) / 2;
    const cz = (d.z0 + d.z1) / 2;
    const spanX = d.facing === 'z';
    const spanW = spanX ? w : dd;
    const thick = spanX ? dd : w;

    const slatGeo: THREE.BufferGeometry[] = [];
    const slats = Math.max(8, Math.round(h / 0.26));
    for (let i = 0; i < slats; i++) {
      const y = d.y0 + (i + 0.5) * (h / slats);
      const g = spanX
        ? boxFrom(d.x0 + 0.04, d.x1 - 0.04, y - h / slats / 2 + 0.004, y + h / slats / 2 - 0.004, cz - thick * 0.3, cz + thick * 0.3)
        : boxFrom(cx - thick * 0.3, cx + thick * 0.3, y - h / slats / 2 + 0.004, y + h / slats / 2 - 0.004, d.z0 + 0.04, d.z1 - 0.04);
      slatGeo.push(g);
    }
    const shutterCol = new GeoCollector();
    shutterCol.addMany('shutter', slatGeo, 1.6);
    // Side guide rails and a hazard band along the bottom edge.
    if (spanX) {
      shutterCol.add('galvanised', boxFrom(d.x0 - 0.1, d.x0 + 0.06, d.y0, d.y1, cz - thick * 0.45, cz + thick * 0.45), 1);
      shutterCol.add('galvanised', boxFrom(d.x1 - 0.06, d.x1 + 0.1, d.y0, d.y1, cz - thick * 0.45, cz + thick * 0.45), 1);
      shutterCol.add('paintYellow', boxFrom(d.x0 + 0.04, d.x1 - 0.04, d.y0 + 0.02, d.y0 + 0.26, cz - thick * 0.34, cz + thick * 0.34), 1);
    } else {
      shutterCol.add('galvanised', boxFrom(cx - thick * 0.45, cx + thick * 0.45, d.y0, d.y1, d.z0 - 0.1, d.z0 + 0.06), 1);
      shutterCol.add('galvanised', boxFrom(cx - thick * 0.45, cx + thick * 0.45, d.y0, d.y1, d.z1 - 0.06, d.z1 + 0.1), 1);
      shutterCol.add('paintYellow', boxFrom(cx - thick * 0.34, cx + thick * 0.34, d.y0 + 0.02, d.y0 + 0.26, d.z0 + 0.04, d.z1 - 0.04), 1);
    }

    for (const key of shutterCol.materialKeys) {
      const geo = shutterCol.merge(key);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, matOf[key] ?? lib.shutter);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    // Price plate beside the shutter.
    const priceTex = stationPanel(d.label, 'Requires clearance', d.cost, '#ffab4d', 'wrench');
    const priceMat = new THREE.MeshStandardMaterial({ map: priceTex, roughness: 0.62, metalness: 0.2 });
    const plate = new THREE.Mesh(plane(0.66, 0.66), priceMat);
    plate.position.set(d.px, 1.55, d.pz);
    plate.rotation.y = d.facing === 'x' ? -Math.PI / 2 : Math.PI;
    // The plate belongs to the wall, not the moving shutter.
    collectors[SPAWNS.find((s) => s.zone)?.zone ?? 'street'].addDynamic(plate);

    shutters.push({ id: d.id, group, travel: h + 0.1, openness: 0 });
  }

  // -----------------------------------------------------------------------
  // Requisition Panels
  // -----------------------------------------------------------------------
  for (const st of STATIONS) {
    const col = collectors[st.zone];
    const g = new THREE.Group();
    g.position.set(st.x, 0, st.z);
    g.rotation.y = st.rotY;

    // Housing: a wall-bolted steel cabinet with a lipped surround.
    const housing = new GeoCollector();
    housing.add('steelPainted', bevelBox(1.16, 1.16, 0.22, 0.03, { y: st.y, z: -0.11 }), 1);
    housing.add('galvanised', box(1.3, 0.1, 0.3, { y: st.y + 0.63, z: -0.1 }), 1);
    housing.add('galvanised', box(1.3, 0.08, 0.3, { y: st.y - 0.63, z: -0.1 }), 1);
    housing.add('galvanised', box(0.1, 1.16, 0.28, { x: 0.63, y: st.y, z: -0.1 }), 1);
    housing.add('galvanised', box(0.1, 1.16, 0.28, { x: -0.63, y: st.y, z: -0.1 }), 1);
    // Conduit running up the wall to the panel.
    housing.add('galvanised', cyl(0.035, 0.035, st.y - 0.6, 8, { x: 0.45, y: (st.y - 0.6) / 2, z: -0.16 }), 1);
    for (const key of housing.materialKeys) {
      const geo = housing.merge(key);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, matOf[key] ?? lib.steelPainted);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }

    // Printed face.
    const faceTex = stationPanel(st.label, st.sub, st.cost, st.accent, st.silhouette);
    const face = new THREE.Mesh(
      plane(1.02, 1.02),
      new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.58, metalness: 0.15, envMapIntensity: 0.6 }),
    );
    face.position.set(0, st.y, 0.005);
    g.add(face);

    // Emissive frame. Pulsed by the engine when the player can afford it, which
    // is the whole readability trick: you learn what you can buy from across the
    // street without reading a single word.
    const glowTex = panelGlow(st.accent);
    const glow = new THREE.Mesh(
      plane(1.14, 1.14),
      new THREE.MeshStandardMaterial({
        map: glowTex,
        emissiveMap: glowTex,
        emissive: new THREE.Color(st.accent),
        emissiveIntensity: 2.2,
        transparent: true,
        alphaTest: 0.05,
        roughness: 0.5,
        metalness: 0,
      }),
    );
    glow.position.set(0, st.y, 0.02);
    g.add(glow);
    panelGlows.set(st.id, glow);

    col.addDynamic(g);
  }

  // -----------------------------------------------------------------------
  // Merge and assemble
  // -----------------------------------------------------------------------
  const root = new THREE.Group();
  root.name = 'BlackpineDistrict';
  const zoneGroups = {} as Record<Zone, THREE.Group>;
  let meshCount = 0;
  let triCount = 0;

  for (const zone of ZONES) {
    const group = new THREE.Group();
    group.name = `zone:${zone}`;
    const col = collectors[zone];

    for (const key of col.materialKeys) {
      const geo = col.merge(key);
      if (!geo) continue;
      const mat = matOf[key];
      if (!mat) {
        if (import.meta.env.DEV) console.warn(`[CityBuilder] unknown material "${key}"`);
        geo.dispose();
        continue;
      }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `${zone}:${key}`;
      // Floors only receive; everything vertical both casts and receives.
      const isGround = key === 'asphalt' || key === 'asphaltWet' || key === 'sidewalk' || key === 'garageFloor' || key === 'plasticWhite' || key === 'paintYellow';
      mesh.castShadow = !isGround;
      mesh.receiveShadow = true;
      // Merged geometry spans a whole zone, so per-object frustum culling can
      // only ever produce false negatives at the seams. Zone visibility is the
      // culling mechanism instead.
      mesh.frustumCulled = false;
      group.add(mesh);
      meshCount++;
      const idx = geo.getIndex();
      triCount += (idx ? idx.count : geo.getAttribute('position').count) / 3;
    }

    for (const obj of col.dynamic) {
      obj.castShadow = false;
      obj.receiveShadow = false;
      group.add(obj);
      meshCount++;
    }

    zoneGroups[zone] = group;
    root.add(group);
  }

  // Shutters live outside the zone groups: they are the boundary between two
  // areas, so hiding them with either one would look wrong.
  const shutterRoot = new THREE.Group();
  shutterRoot.name = 'shutters';
  for (const s of shutters) shutterRoot.add(s.group);
  root.add(shutterRoot);

  return {
    root,
    zoneGroups,
    shutters,
    panelGlows,
    flickers,
    stats: { meshes: meshCount, triangles: Math.round(triCount) },
    dispose() {
      disposeTree(root);
      for (const m of Object.values(extras)) m.dispose();
    },
  };
}
