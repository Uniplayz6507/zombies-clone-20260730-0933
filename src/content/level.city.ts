import { collider, type Collider } from '../game/physics/aabb';
import type { WpEdge, WpNode } from '../game/nav/WaypointGraph';
import type { WeaponId } from '../types';

/**
 * BLACKPINE DISTRICT - the whole map, as data.
 *
 * Three connected areas, in the order the player unlocks them:
 *   1. KESSLER STREET      - open street, sodium lamps, dead cars, storefronts
 *   2. MARROW ALLEY        - service lane behind a roller shutter (750 pts)
 *   3. FERRUS PARKING      - low-ceilinged concrete structure (1250 pts)
 *
 * Everything the renderer builds and everything the simulation collides against
 * comes from this file, so the visual wall and its collider can never drift
 * apart. Units are metres. +X is east, +Z is south, Y is up.
 *
 * Original layout and naming. No commercial map is referenced or reproduced.
 */

export type Zone = 'street' | 'alley' | 'garage';

export type MatKey =
  | 'asphalt'
  | 'asphaltWet'
  | 'sidewalk'
  | 'garageFloor'
  | 'brick'
  | 'brickDark'
  | 'stucco'
  | 'facade'
  | 'concrete'
  | 'garageCeiling'
  | 'rubble'
  | 'steelPainted'
  | 'steelRust';

/** A flat horizontal surface. Walkable; also a collider so we can step onto kerbs. */
export interface SlabDef {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Top surface height. */
  y: number;
  mat: MatKey;
  /** World-space metres per texture tile. */
  tile: number;
  zone: Zone;
}

/** A solid box: walls, buildings, ceilings, rubble. */
export interface BlockDef {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
  mat: MatKey;
  tile: number;
  /** Facade band applied above this height instead of the base material. */
  upperMat?: MatKey;
  upperFrom?: number;
  solid?: boolean;
  tag?: string;
}

export interface DoorDef {
  id: string;
  label: string
  cost: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
  /** Where the interaction prompt is anchored. */
  px: number;
  py: number;
  pz: number;
  /** Which way the shutter faces, for the panel + chevrons. */
  facing: 'x' | 'z';
  opensZone: Zone;
}

export interface StationDef {
  id: string;
  label: string;
  sub: string;
  cost: number;
  kind: 'weapon' | 'ammo' | 'upgrade';
  weapon?: WeaponId;
  x: number;
  y: number;
  z: number;
  /** Rotation about Y. The panel's front face is +Z at rotY = 0. */
  rotY: number;
  accent: string;
  silhouette: 'smg' | 'shotgun' | 'ammo' | 'wrench';
  zone: Zone;
}

export interface SpawnDef {
  id: string;
  zone: Zone;
  x: number;
  z: number;
  /** Cosmetic: which kind of breach the Blighted crawl out of. */
  kind: 'window' | 'grate' | 'rubble' | 'stairwell' | 'vent';
  /** Which way they face on emerging. */
  yaw: number;
}

export interface LampDef {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
  distance: number;
  kind: 'sodium' | 'fluoro' | 'emergency';
  /** Flickering fixtures sell "failing infrastructure" for free. */
  flicker?: number;
  zone: Zone;
}

export type PropType =
  | 'streetlight'
  | 'trafficlight'
  | 'car'
  | 'van'
  | 'dumpster'
  | 'crate'
  | 'pallet'
  | 'barrel'
  | 'cone'
  | 'hydrant'
  | 'bench'
  | 'newsbox'
  | 'sandbags'
  | 'pillar'
  | 'fence'
  | 'acunit'
  | 'fireescape'
  | 'awning'
  | 'planter'
  | 'tirestack'
  | 'pipes'
  | 'fluoro'
  | 'neon'
  | 'trashpile'
  | 'cart'
  | 'barricade'
  | 'gratefloor'
  | 'bollard';

export interface PropDef {
  type: PropType;
  x: number;
  z: number;
  y?: number;
  rotY?: number;
  scale?: number;
  variant?: number;
  /** Footprint + height of the collider, if this prop blocks movement. */
  collide?: { w: number; d: number; h: number };
  /** Free-text payload: neon sign copy, etc. */
  text?: string;
  color?: string;
  zone: Zone;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export const BOUNDS = { x0: -23, x1: 32, z0: -15, z1: 32 };

export const SLABS: SlabDef[] = [
  // --- Kessler Street: carriageway, gutters, raised pavements ---------------
  { x0: -20, x1: 8, z0: -9, z1: 9, y: 0, mat: 'asphalt', tile: 4, zone: 'street' },
  { x0: -20, x1: 8, z0: -9.6, z1: -9, y: 0, mat: 'asphaltWet', tile: 3, zone: 'street' },
  { x0: -20, x1: 8, z0: 9, z1: 9.6, y: 0, mat: 'asphaltWet', tile: 3, zone: 'street' },
  { x0: -20, x1: 8, z0: -12, z1: -9, y: 0.16, mat: 'sidewalk', tile: 4, zone: 'street' },
  { x0: -20, x1: 8, z0: 9, z1: 12, y: 0.16, mat: 'sidewalk', tile: 4, zone: 'street' },
  // Shutter threshold
  { x0: 8, x1: 9, z0: -2.5, z1: 2.5, y: 0, mat: 'asphalt', tile: 4, zone: 'street' },

  // --- Marrow Alley --------------------------------------------------------
  { x0: 9, x1: 22, z0: -12, z1: 12, y: 0, mat: 'asphaltWet', tile: 3.5, zone: 'alley' },
  { x0: 15.5, x1: 20.5, z0: 12, z1: 13, y: 0, mat: 'asphaltWet', tile: 3.5, zone: 'alley' },

  // --- Ferrus parking structure -------------------------------------------
  { x0: 9, x1: 30, z0: 13, z1: 30, y: 0, mat: 'garageFloor', tile: 4, zone: 'garage' },
];

export const BLOCKS: BlockDef[] = [
  // --- Kessler Street shell ------------------------------------------------
  // West end: a collapsed building sealing the road.
  { x0: -23, x1: -20, z0: -15, z1: 14, y0: 0, y1: 9, mat: 'rubble', tile: 4, tag: 'rubble' },
  // North terrace: brick to first floor, glazed facade above.
  { x0: -23, x1: 9, z0: -15, z1: -12, y0: 0, y1: 18, mat: 'brick', tile: 2, upperMat: 'facade', upperFrom: 4.4, tile2: 8, tag: 'facade' } as BlockDef,
  // South terrace: darker brick, stucco band.
  { x0: -23, x1: 9, z0: 12, z1: 15, y0: 0, y1: 17, mat: 'brickDark', tile: 2, upperMat: 'facade', upperFrom: 4.4, tag: 'facade' },
  // East wall of the street, split around the roller shutter.
  { x0: 8, x1: 9, z0: -12, z1: -2.5, y0: 0, y1: 16, mat: 'brickDark', tile: 2, upperMat: 'facade', upperFrom: 4.4, tag: 'facade' },
  { x0: 8, x1: 9, z0: 2.5, z1: 12, y0: 0, y1: 16, mat: 'brickDark', tile: 2, upperMat: 'facade', upperFrom: 4.4, tag: 'facade' },
  // Lintel over the shutter opening.
  { x0: 8, x1: 9, z0: -2.5, z1: 2.5, y0: 4.2, y1: 16, mat: 'brickDark', tile: 2, upperMat: 'facade', upperFrom: 5.2, tag: 'lintel' },

  // --- Marrow Alley shell -------------------------------------------------
  { x0: 9, x1: 23, z0: -15, z1: -12, y0: 0, y1: 15, mat: 'brick', tile: 2, upperMat: 'facade', upperFrom: 4.4, tag: 'facade' },
  { x0: 22, x1: 23, z0: -15, z1: 13, y0: 0, y1: 15, mat: 'brickDark', tile: 2, upperMat: 'facade', upperFrom: 4.4, tag: 'facade' },
  { x0: 9, x1: 15.5, z0: 12, z1: 15, y0: 0, y1: 14, mat: 'brick', tile: 2, upperMat: 'facade', upperFrom: 4.4, tag: 'facade' },
  { x0: 20.5, x1: 23, z0: 12, z1: 15, y0: 0, y1: 14, mat: 'brick', tile: 2, upperMat: 'facade', upperFrom: 4.4, tag: 'facade' },
  { x0: 15.5, x1: 20.5, z0: 12, z1: 13, y0: 4.2, y1: 14, mat: 'concrete', tile: 3, tag: 'lintel' },

  // --- Ferrus parking structure ------------------------------------------
  { x0: 22, x1: 32, z0: 12, z1: 13, y0: 0, y1: 5, mat: 'concrete', tile: 3, tag: 'garage-wall' },
  { x0: 8, x1: 9, z0: 13, z1: 32, y0: 0, y1: 5, mat: 'concrete', tile: 3, tag: 'garage-wall' },
  { x0: 30, x1: 32, z0: 12, z1: 32, y0: 0, y1: 5, mat: 'concrete', tile: 3, tag: 'garage-wall' },
  { x0: 8, x1: 32, z0: 30, z1: 32, y0: 0, y1: 5, mat: 'concrete', tile: 3, tag: 'garage-wall' },
  // Ceiling slab. Not solid - nothing can jump high enough for it to matter,
  // and leaving it out of the collider set saves needless candidate tests.
  { x0: 8, x1: 31, z0: 12, z1: 31, y0: 4.2, y1: 5, mat: 'garageCeiling', tile: 4, solid: false, tag: 'ceiling' },
  // Interior spine wall giving the garage two bays and a proper chokepoint.
  { x0: 20.6, x1: 21.4, z0: 17, z1: 26, y0: 0, y1: 4.2, mat: 'concrete', tile: 3, tag: 'garage-spine' },
];

export const DOORS: DoorDef[] = [
  {
    id: 'shutter_alley',
    label: 'Service Shutter',
    cost: 750,
    x0: 8,
    x1: 9,
    z0: -2.5,
    z1: 2.5,
    y0: 0,
    y1: 4.2,
    px: 7.4,
    py: 1.5,
    pz: 0,
    facing: 'x',
    opensZone: 'alley',
  },
  {
    id: 'shutter_garage',
    label: 'Ferrus Roll-Door',
    cost: 1250,
    x0: 15.5,
    x1: 20.5,
    z0: 12,
    z1: 13,
    y0: 0,
    y1: 4.2,
    px: 18,
    py: 1.5,
    pz: 11.4,
    facing: 'z',
    opensZone: 'garage',
  },
];

export const STATIONS: StationDef[] = [
  {
    id: 'req_smg',
    label: 'Hornet SR-9',
    sub: 'Submachine gun',
    cost: 1200,
    kind: 'weapon',
    weapon: 'hornet',
    x: -6,
    y: 1.5,
    z: -11.88,
    rotY: 0,
    accent: '#ffab4d',
    silhouette: 'smg',
    zone: 'street',
  },
  {
    id: 'req_ammo',
    label: 'Ammo Cache',
    sub: 'Refill reserve',
    cost: 600,
    kind: 'ammo',
    x: 2,
    y: 1.5,
    z: 11.88,
    rotY: Math.PI,
    accent: '#9dd649',
    silhouette: 'ammo',
    zone: 'street',
  },
  {
    id: 'req_shotgun',
    label: 'Breaker 12',
    sub: 'Pump shotgun',
    cost: 1600,
    kind: 'weapon',
    weapon: 'breaker',
    x: 21.88,
    y: 1.5,
    z: 3,
    rotY: -Math.PI / 2,
    accent: '#ffab4d',
    silhouette: 'shotgun',
    zone: 'alley',
  },
  {
    id: 'req_retool',
    label: 'Retool Bench',
    sub: 'Upgrade held weapon',
    cost: 3000,
    kind: 'upgrade',
    x: 9.15,
    y: 1.5,
    z: 20,
    rotY: Math.PI / 2,
    accent: '#7fb2d9',
    silhouette: 'wrench',
    zone: 'garage',
  },
];

export const SPAWNS: SpawnDef[] = [
  // Kessler Street - active from wave 1.
  { id: 'sp_a1', zone: 'street', x: -18.6, z: -6, kind: 'rubble', yaw: Math.PI / 2 },
  { id: 'sp_a2', zone: 'street', x: -18.6, z: 6.5, kind: 'rubble', yaw: Math.PI / 2 },
  { id: 'sp_a3', zone: 'street', x: -4, z: -11.2, kind: 'window', yaw: Math.PI },
  { id: 'sp_a4', zone: 'street', x: 4.5, z: 11.2, kind: 'window', yaw: 0 },
  { id: 'sp_a5', zone: 'street', x: -11, z: 0, kind: 'grate', yaw: 0 },
  // Marrow Alley.
  { id: 'sp_b1', zone: 'alley', x: 10.8, z: -11.2, kind: 'window', yaw: Math.PI },
  { id: 'sp_b2', zone: 'alley', x: 21, z: -9, kind: 'vent', yaw: -Math.PI / 2 },
  { id: 'sp_b3', zone: 'alley', x: 13.5, z: 10.8, kind: 'grate', yaw: 0 },
  // Ferrus parking.
  { id: 'sp_c1', zone: 'garage', x: 10.5, z: 28, kind: 'stairwell', yaw: Math.PI / 2 },
  { id: 'sp_c2', zone: 'garage', x: 28.5, z: 15, kind: 'vent', yaw: -Math.PI / 2 },
  { id: 'sp_c3', zone: 'garage', x: 25, z: 28.5, kind: 'stairwell', yaw: -Math.PI / 2 },
];

/**
 * Lamp definitions. NOT all of these are real lights at once - the engine keeps
 * a fixed pool of 5 PointLights and repositions them to the nearest definitions
 * as the player moves. Toggling light *visibility* would change the light count
 * and force a shader recompile mid-match; repositioning a fixed pool does not.
 * Every fixture also has emissive geometry, so lamps outside the pool still read
 * as lit through bloom.
 */
export const LAMPS: LampDef[] = [
  { x: -16, y: 5.2, z: -8.4, color: 0xffa martian: 0 } as unknown as LampDef,
];

export const WAYPOINTS: WpNode[] = [
  { id: 'a1', x: -18, z: -6, zone: 'street' },
  { id: 'a2', x: -18, z: 6, zone: 'street' },
  { id: 'a3', x: -11, z: 0, zone: 'street' },
  { id: 'a4', x: -4, z: -6, zone: 'street' },
  { id: 'a5', x: -4, z: 6, zone: 'street' },
  { id: 'a6', x: 0, z: 0, zone: 'street' },
  { id: 'a7', x: 6, z: 0, zone: 'street' },
  { id: 'a8', x: 6, z: -7.5, zone: 'street' },
  { id: 'a9', x: 6, z: 7.5, zone: 'street' },
  { id: 'a10', x: -11, z: -7.5, zone: 'street' },
  { id: 'a11', x: -11, z: 7.5, zone: 'street' },
  { id: 'ga', x: 8.5, z: 0, zone: 'street' },
  { id: 'b1', x: 11, z: 0, zone: 'alley' },
  { id: 'b2', x: 13, z: -8, zone: 'alley' },
  { id: 'b3', x: 13, z: 8, zone: 'alley' },
  { id: 'b4', x: 18.5, z: -9, zone: 'alley' },
  { id: 'b5', x: 20.5, z: 0, zone: 'alley' },
  { id: 'b6', x: 18, z: 8, zone: 'alley' },
  { id: 'b7', x: 18, z: 10.6, zone: 'alley' },
  { id: 'gb', x: 18, z: 12.5, zone: 'alley' },
  { id: 'c1', x: 18, z: 15, zone: 'garage' },
  { id: 'c2', x: 12, z: 17, zone: 'garage' },
  { id: 'c3', x: 11, z: 27, zone: 'garage' },
  { id: 'c4', x: 18, z: 22, zone: 'garage' },
  { id: 'c5', x: 25.5, z: 16, zone: 'garage' },
  { id: 'c6', x: 26.5, z: 27, zone: 'garage' },
  { id: 'c7', x: 18, z: 28, zone: 'garage' },
  { id: 'c8', x: 25.5, z: 22, zone: 'garage' },
];

export const WAYPOINT_EDGES: WpEdge[] = [
  { a: 'a1', b: 'a2' },
  { a: 'a1', b: 'a10' },
  { a: 'a2', b: 'a11' },
  { a: 'a1', b: 'a3' },
  { a: 'a2', b: 'a3' },
  { a: 'a10', b: 'a3' },
  { a: 'a11', b: 'a3' },
  { a: 'a3', b: 'a4' },
  { a: 'a3', b: 'a5' },
  { a: 'a3', b: 'a6' },
  { a: 'a4', b: 'a6' },
  { a: 'a5', b: 'a6' },
  { a: 'a4', b: 'a8' },
  { a: 'a5', b: 'a9' },
  { a: 'a6', b: 'a7' },
  { a: 'a7', b: 'a8' },
  { a: 'a7', b: 'a9' },
  { a: 'a8', b: 'a9' },
  { a: 'a10', b: 'a4' },
  { a: 'a11', b: 'a5' },
  // Street <-> alley, gated by the first shutter.
  { a: 'a7', b: 'ga', doorId: 'shutter_alley' },
  { a: 'ga', b: 'b1', doorId: 'shutter_alley' },
  { a: 'b1', b: 'b2' },
  { a: 'b1', b: 'b3' },
  { a: 'b1', b: 'b5' },
  { a: 'b2', b: 'b3' },
  { a: 'b2', b: 'b4' },
  { a: 'b4', b: 'b5' },
  { a: 'b3', b: 'b6' },
  { a: 'b5', b: 'b6' },
  { a: 'b6', b: 'b7' },
  { a: 'b3', b: 'b7' },
  // Alley <-> garage, gated by the roll-door.
  { a: 'b7', b: 'gb', doorId: 'shutter_garage' },
  { a: 'gb', b: 'c1', doorId: 'shutter_garage' },
  { a: 'c1', b: 'c2' },
  { a: 'c1', b: 'c4' },
  { a: 'c1', b: 'c5' },
  { a: 'c2', b: 'c3' },
  { a: 'c2', b: 'c4' },
  { a: 'c3', b: 'c7' },
  { a: 'c4', b: 'c7' },
  { a: 'c5', b: 'c8' },
  { a: 'c8', b: 'c6' },
  { a: 'c6', b: 'c7' },
  { a: 'c4', b: 'c3' },
];

export const PLAYER_START = { x: -15, y: 0.16, z: 0, yaw: -Math.PI / 2 };

export const ZONE_OF_DOOR: Record<string, Zone> = {
  shutter_alley: 'alley',
  shutter_garage: 'garage',
};

// ---------------------------------------------------------------------------
// Collider derivation
// ---------------------------------------------------------------------------

/**
 * Build the static collider set from the same data the renderer consumes.
 * Called once at load; the result is fed to the SpatialHash.
 */
export function buildColliders(props: PropDef[]): Collider[] {
  const out: Collider[] = [];

  // Slabs are colliders so that kerbs are stepped onto rather than walked through.
  for (const s of SLABS) {
    if (s.y <= 0.001) continue; // street level is the implicit floor
    out.push(collider(s.x0, s.x1, 0, s.y, s.z0, s.z1, 'kerb'));
  }

  for (const b of BLOCKS) {
    if (b.solid === false) continue;
    out.push(collider(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, b.tag ?? 'wall'));
  }

  // Shutters exist as colliders only while shut. `doorId` makes that a single
  // Set membership test in the movement code.
  for (const d of DOORS) {
    out.push(collider(d.x0, d.x1, d.y0, d.y1, d.z0, d.z1, 'door', d.id));
  }

  for (const p of props) {
    if (!p.collide) continue;
    const rot = p.rotY ?? 0;
    // Props are placed on 90-degree increments, so swapping the footprint for
    // near-quarter-turn rotations keeps the AABB tight without needing OBBs.
    const quarter = Math.abs(Math.sin(rot)) > 0.7;
    const w = quarter ? p.collide.d : p.collide.w;
    const d = quarter ? p.collide.w : p.collide.d;
    const y0 = p.y ?? 0;
    out.push(collider(p.x - w / 2, p.x + w / 2, y0, y0 + p.collide.h, p.z - d / 2, p.z + d / 2, p.type));
  }

  return out;
}
