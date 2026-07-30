import { collider, type Collider } from '../game/physics/aabb';
import type { WpEdge, WpNode } from '../game/nav/WaypointGraph';
import type { WeaponId } from '../types';

/**
 * BLACKPINE DISTRICT - the whole map, as data.
 *
 * Three connected areas, in the order the player unlocks them:
 *   1. KESSLER STREET   - open street, sodium lamps, dead cars, boarded storefronts
 *   2. MARROW ALLEY     - service lane behind a roller shutter (750 pts)
 *   3. FERRUS PARKING   - low-ceilinged concrete structure (1250 pts)
 *
 * Everything the renderer builds and everything the simulation collides against
 * is derived from this file, so a visual wall and its collider can never drift
 * apart. Units are metres. +X east, +Z south, +Y up.
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
  | 'rubble';

/** Flat horizontal surface. Walkable, and a collider so kerbs are stepped onto. */
export interface SlabDef {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
  mat: MatKey;
  /** World metres per texture tile. */
  tile: number;
  zone: Zone;
}

/** Solid box: walls, building shells, ceilings, rubble. */
export interface BlockDef {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
  mat: MatKey;
  tile: number;
  /** Optional second material band above `upperFrom` (ground floor vs facade). */
  upperMat?: MatKey;
  upperFrom?: number;
  tileUpper?: number;
  /** false = visual only, contributes no collider (e.g. the garage ceiling). */
  solid?: boolean;
  tag?: string;
  zone: Zone;
}

export interface DoorDef {
  id: string;
  label: string;
  cost: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
  /** Anchor for the interaction prompt / purchase panel. */
  px: number;
  py: number;
  pz: number;
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
  /** Panel front face is +Z at rotY = 0. */
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
  kind: 'window' | 'grate' | 'rubble' | 'stairwell' | 'vent';
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
  /** 0-1: how badly the fixture is failing. */
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
  | 'grate'
  | 'bollard'
  | 'graffiti';

export interface PropDef {
  type: PropType;
  x: number;
  z: number;
  y?: number;
  rotY?: number;
  scale?: number;
  variant?: number;
  /** Local footprint + height. Omit for non-blocking dressing. */
  collide?: { w: number; d: number; h: number };
  text?: string;
  color?: string;
  zone: Zone;
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

export const BOUNDS = { x0: -23, x1: 32, z0: -15, z1: 32 };

export const SLABS: SlabDef[] = [
  // Kessler Street: carriageway, wet gutters, raised pavements.
  { x0: -20, x1: 8, z0: -9, z1: 9, y: 0, mat: 'asphalt', tile: 4, zone: 'street' },
  { x0: -20, x1: 8, z0: -9.7, z1: -9, y: 0, mat: 'asphaltWet', tile: 3, zone: 'street' },
  { x0: -20, x1: 8, z0: 9, z1: 9.7, y: 0, mat: 'asphaltWet', tile: 3, zone: 'street' },
  { x0: -20, x1: 8, z0: -12, z1: -9, y: 0.16, mat: 'sidewalk', tile: 4, zone: 'street' },
  { x0: -20, x1: 8, z0: 9, z1: 12, y: 0.16, mat: 'sidewalk', tile: 4, zone: 'street' },
  { x0: 8, x1: 9, z0: -2.5, z1: 2.5, y: 0, mat: 'asphalt', tile: 4, zone: 'street' },

  // Marrow Alley - permanently damp, never sees the sun.
  { x0: 9, x1: 22, z0: -12, z1: 12, y: 0, mat: 'asphaltWet', tile: 3.5, zone: 'alley' },
  { x0: 15.5, x1: 20.5, z0: 12, z1: 13, y: 0, mat: 'asphaltWet', tile: 3.5, zone: 'alley' },

  // Ferrus parking structure.
  { x0: 9, x1: 30, z0: 13, z1: 30, y: 0, mat: 'garageFloor', tile: 4, zone: 'garage' },
];

export const BLOCKS: BlockDef[] = [
  // Kessler Street shell -----------------------------------------------------
  { x0: -23, x1: -20, z0: -15, z1: 14, y0: 0, y1: 9, mat: 'rubble', tile: 4, tag: 'rubble', zone: 'street' },
  { x0: -23, x1: 9, z0: -15, z1: -12, y0: 0, y1: 18, mat: 'brick', tile: 2, upperMat: 'facade', upperFrom: 4.4, tileUpper: 8, tag: 'facade-n', zone: 'street' },
  { x0: -23, x1: 9, z0: 12, z1: 15, y0: 0, y1: 17, mat: 'brickDark', tile: 2, upperMat: 'facade', upperFrom: 4.4, tileUpper: 8, tag: 'facade-s', zone: 'street' },
  { x0: 8, x1: 9, z0: -12, z1: -2.5, y0: 0, y1: 16, mat: 'brickDark', tile: 2, upperMat: 'facade', upperFrom: 4.4, tileUpper: 8, tag: 'facade-e', zone: 'street' },
  { x0: 8, x1: 9, z0: 2.5, z1: 12, y0: 0, y1: 16, mat: 'brickDark', tile: 2, upperMat: 'facade', upperFrom: 4.4, tileUpper: 8, tag: 'facade-e', zone: 'street' },
  // Lintel above the shutter opening.
  { x0: 8, x1: 9, z0: -2.5, z1: 2.5, y0: 4.2, y1: 16, mat: 'brickDark', tile: 2, upperMat: 'facade', upperFrom: 5.4, tileUpper: 8, tag: 'lintel', zone: 'street' },

  // Marrow Alley shell ------------------------------------------------------
  { x0: 9, x1: 23, z0: -15, z1: -12, y0: 0, y1: 15, mat: 'brick', tile: 2, upperMat: 'facade', upperFrom: 4.4, tileUpper: 8, tag: 'facade', zone: 'alley' },
  { x0: 22, x1: 23, z0: -15, z1: 13, y0: 0, y1: 15, mat: 'brickDark', tile: 2, upperMat: 'facade', upperFrom: 4.4, tileUpper: 8, tag: 'facade', zone: 'alley' },
  { x0: 9, x1: 15.5, z0: 12, z1: 15, y0: 0, y1: 14, mat: 'brick', tile: 2, upperMat: 'facade', upperFrom: 4.4, tileUpper: 8, tag: 'facade', zone: 'alley' },
  { x0: 20.5, x1: 23, z0: 12, z1: 15, y0: 0, y1: 14, mat: 'brick', tile: 2, upperMat: 'facade', upperFrom: 4.4, tileUpper: 8, tag: 'facade', zone: 'alley' },
  { x0: 15.5, x1: 20.5, z0: 12, z1: 13, y0: 4.2, y1: 14, mat: 'concrete', tile: 3, tag: 'lintel', zone: 'alley' },

  // Ferrus parking structure -----------------------------------------------
  { x0: 22, x1: 32, z0: 12, z1: 13, y0: 0, y1: 5, mat: 'concrete', tile: 3, tag: 'garage-wall', zone: 'garage' },
  { x0: 8, x1: 9, z0: 13, z1: 32, y0: 0, y1: 5, mat: 'concrete', tile: 3, tag: 'garage-wall', zone: 'garage' },
  { x0: 30, x1: 32, z0: 12, z1: 32, y0: 0, y1: 5, mat: 'concrete', tile: 3, tag: 'garage-wall', zone: 'garage' },
  { x0: 8, x1: 32, z0: 30, z1: 32, y0: 0, y1: 5, mat: 'concrete', tile: 3, tag: 'garage-wall', zone: 'garage' },
  // Ceiling: visual only. Nothing can jump high enough for it to matter, and
  // keeping it out of the collider set saves pointless candidate tests.
  { x0: 8, x1: 31, z0: 12, z1: 31, y0: 4.2, y1: 5, mat: 'garageCeiling', tile: 4, solid: false, tag: 'ceiling', zone: 'garage' },
  // Interior spine wall: splits the garage into two bays and creates the best
  // chokepoint on the map.
  { x0: 20.6, x1: 21.4, z0: 17, z1: 26, y0: 0, y1: 4.2, mat: 'concrete', tile: 3, tag: 'spine', zone: 'garage' },
];

// ---------------------------------------------------------------------------
// Interactables
// ---------------------------------------------------------------------------

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
    px: 7.3,
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
    pz: 11.3,
    facing: 'z',
    opensZone: 'garage',
  },
];

export const STATIONS: StationDef[] = [
  { id: 'req_smg', label: 'Hornet SR-9', sub: 'Submachine gun', cost: 1200, kind: 'weapon', weapon: 'hornet', x: -6, y: 1.5, z: -11.86, rotY: 0, accent: '#ffab4d', silhouette: 'smg', zone: 'street' },
  { id: 'req_ammo', label: 'Ammo Cache', sub: 'Refill all reserves', cost: 600, kind: 'ammo', x: 2, y: 1.5, z: 11.86, rotY: Math.PI, accent: '#9dd649', silhouette: 'ammo', zone: 'street' },
  { id: 'req_shotgun', label: 'Breaker 12', sub: 'Pump shotgun', cost: 1600, kind: 'weapon', weapon: 'breaker', x: 21.86, y: 1.5, z: 3, rotY: -Math.PI / 2, accent: '#ffab4d', silhouette: 'shotgun', zone: 'alley' },
  { id: 'req_retool', label: 'Retool Bench', sub: 'Upgrade held weapon', cost: 3000, kind: 'upgrade', x: 9.14, y: 1.5, z: 20, rotY: Math.PI / 2, accent: '#7fb2d9', silhouette: 'wrench', zone: 'garage' },
];

export const SPAWNS: SpawnDef[] = [
  { id: 'sp_a1', zone: 'street', x: -18.8, z: -6, kind: 'rubble', yaw: Math.PI / 2 },
  { id: 'sp_a2', zone: 'street', x: -18.8, z: 6.5, kind: 'rubble', yaw: Math.PI / 2 },
  { id: 'sp_a3', zone: 'street', x: -3, z: -11.3, kind: 'window', yaw: Math.PI },
  { id: 'sp_a4', zone: 'street', x: 5, z: 11.3, kind: 'window', yaw: 0 },
  { id: 'sp_a5', zone: 'street', x: -11.5, z: 0, kind: 'grate', yaw: 0 },
  { id: 'sp_b1', zone: 'alley', x: 10.6, z: -11.3, kind: 'window', yaw: Math.PI },
  { id: 'sp_b2', zone: 'alley', x: 21.4, z: -9, kind: 'vent', yaw: -Math.PI / 2 },
  { id: 'sp_b3', zone: 'alley', x: 13.5, z: 10.6, kind: 'grate', yaw: 0 },
  { id: 'sp_c1', zone: 'garage', x: 10.2, z: 28.5, kind: 'stairwell', yaw: Math.PI / 2 },
  { id: 'sp_c2', zone: 'garage', x: 29.2, z: 14.5, kind: 'vent', yaw: -Math.PI / 2 },
  { id: 'sp_c3', zone: 'garage', x: 24, z: 29.2, kind: 'stairwell', yaw: -Math.PI / 2 },
];

/**
 * Lamp definitions.
 *
 * These are NOT all real lights at once. The engine keeps a fixed pool of five
 * PointLights and repositions them to the nearest definitions as the player
 * moves. Toggling light visibility would change the light count and force a
 * shader recompile mid-match (a guaranteed stutter); repositioning a fixed pool
 * costs nothing. Every fixture also carries emissive geometry, so lamps outside
 * the pool still read as lit thanks to bloom.
 */
export const LAMPS: LampDef[] = [
  { x: -16, y: 5.0, z: -8.2, color: 0xffab4d, intensity: 34, distance: 17, kind: 'sodium', zone: 'street' },
  { x: -8, y: 5.0, z: -8.2, color: 0xffab4d, intensity: 34, distance: 17, kind: 'sodium', flicker: 0.25, zone: 'street' },
  { x: 0, y: 5.0, z: -8.2, color: 0xffab4d, intensity: 34, distance: 17, kind: 'sodium', zone: 'street' },
  { x: -12, y: 5.0, z: 8.2, color: 0xffab4d, intensity: 34, distance: 17, kind: 'sodium', zone: 'street' },
  { x: -4, y: 5.0, z: 8.2, color: 0xff9a3d, intensity: 30, distance: 16, kind: 'sodium', flicker: 0.6, zone: 'street' },
  { x: 4, y: 5.0, z: 8.2, color: 0xffab4d, intensity: 34, distance: 17, kind: 'sodium', zone: 'street' },
  { x: -6, y: 3.5, z: -11.3, color: 0xff4a6a, intensity: 9, distance: 8, kind: 'sodium', zone: 'street' },
  { x: 3, y: 3.5, z: 11.3, color: 0x49c9d6, intensity: 9, distance: 8, kind: 'sodium', zone: 'street' },
  { x: -14, y: 4.4, z: -11.3, color: 0xffb347, intensity: 10, distance: 9, kind: 'sodium', flicker: 0.4, zone: 'street' },
  { x: 12, y: 4.1, z: -6, color: 0xffe0b0, intensity: 20, distance: 11, kind: 'fluoro', flicker: 0.7, zone: 'alley' },
  { x: 20, y: 4.1, z: 4, color: 0xff2f22, intensity: 14, distance: 10, kind: 'emergency', flicker: 0.15, zone: 'alley' },
  { x: 14, y: 4.05, z: 17, color: 0xcfe6ff, intensity: 22, distance: 13, kind: 'fluoro', zone: 'garage' },
  { x: 26, y: 4.05, z: 17, color: 0xcfe6ff, intensity: 22, distance: 13, kind: 'fluoro', flicker: 0.8, zone: 'garage' },
  { x: 14, y: 4.05, z: 26, color: 0xcfe6ff, intensity: 22, distance: 13, kind: 'fluoro', zone: 'garage' },
  { x: 26, y: 4.05, z: 26, color: 0xcfe6ff, intensity: 22, distance: 13, kind: 'fluoro', zone: 'garage' },
  { x: 18, y: 4.05, z: 22, color: 0xffd9a0, intensity: 16, distance: 11, kind: 'fluoro', flicker: 0.5, zone: 'garage' },
];

// ---------------------------------------------------------------------------
// Props
//
// Parking lanes are deliberately cut at |z| = 7.9 (hard against the kerb) while
// navigation lanes stay inside |z| <= 6, so no waypoint node ever sits inside a
// prop collider. That is the one hard requirement for flow-field navigation to
// never trap a zombie.
// ---------------------------------------------------------------------------

export const PROPS: PropDef[] = [
  // --- Kessler Street: lighting & street furniture -------------------------
  { type: 'streetlight', x: -16, z: -9.5, y: 0.16, rotY: 0, collide: { w: 0.34, d: 0.34, h: 5 }, zone: 'street' },
  { type: 'streetlight', x: -8, z: -9.5, y: 0.16, rotY: 0, collide: { w: 0.34, d: 0.34, h: 5 }, zone: 'street' },
  { type: 'streetlight', x: 0, z: -9.5, y: 0.16, rotY: 0, collide: { w: 0.34, d: 0.34, h: 5 }, zone: 'street' },
  { type: 'streetlight', x: -12, z: 9.5, y: 0.16, rotY: Math.PI, collide: { w: 0.34, d: 0.34, h: 5 }, zone: 'street' },
  { type: 'streetlight', x: -4, z: 9.5, y: 0.16, rotY: Math.PI, collide: { w: 0.34, d: 0.34, h: 5 }, zone: 'street' },
  { type: 'streetlight', x: 4, z: 9.5, y: 0.16, rotY: Math.PI, collide: { w: 0.34, d: 0.34, h: 5 }, zone: 'street' },
  { type: 'trafficlight', x: 6.8, z: -9.4, y: 0.16, rotY: 0, collide: { w: 0.3, d: 0.3, h: 4 }, zone: 'street' },
  { type: 'hydrant', x: -14.4, z: 9.6, y: 0.16, rotY: 0, collide: { w: 0.4, d: 0.4, h: 0.9 }, zone: 'street' },
  { type: 'bench', x: -10, z: 10.6, y: 0.16, rotY: Math.PI, collide: { w: 1.9, d: 0.7, h: 0.9 }, zone: 'street' },
  { type: 'bench', x: -2, z: -10.7, y: 0.16, rotY: 0, collide: { w: 1.9, d: 0.7, h: 0.9 }, zone: 'street' },
  { type: 'newsbox', x: 2.6, z: -10.5, y: 0.16, rotY: Math.PI, collide: { w: 0.7, d: 0.5, h: 1.3 }, zone: 'street' },
  { type: 'planter', x: -8.6, z: 10.5, y: 0.16, rotY: 0, collide: { w: 1.2, d: 1.2, h: 0.8 }, zone: 'street' },
  { type: 'planter', x: 0.4, z: 10.5, y: 0.16, rotY: 0, collide: { w: 1.2, d: 1.2, h: 0.8 }, zone: 'street' },
  { type: 'bollard', x: -18, z: -9.3, y: 0.16, zone: 'street' },
  { type: 'bollard', x: -15, z: -9.3, y: 0.16, zone: 'street' },
  { type: 'bollard', x: -6, z: 9.3, y: 0.16, zone: 'street' },
  { type: 'bollard', x: -3, z: 9.3, y: 0.16, zone: 'street' },
  { type: 'grate', x: -11.5, z: 0, zone: 'street' },

  // --- Kessler Street: abandoned vehicles ---------------------------------
  { type: 'car', x: -13, z: -7.9, rotY: 0.02, variant: 0, collide: { w: 4.6, d: 2, h: 1.5 }, zone: 'street' },
  { type: 'car', x: -6.2, z: -7.9, rotY: -0.03, variant: 3, collide: { w: 4.6, d: 2, h: 1.5 }, zone: 'street' },
  { type: 'car', x: -9, z: 7.9, rotY: Math.PI, variant: 1, collide: { w: 4.6, d: 2, h: 1.5 }, zone: 'street' },
  { type: 'car', x: 0.6, z: 7.9, rotY: Math.PI + 0.04, variant: 2, collide: { w: 4.6, d: 2, h: 1.5 }, zone: 'street' },
  // The wreck in the middle of the road. Deliberate obstacle to loop around.
  { type: 'car', x: 2.2, z: -3.2, rotY: 1.18, variant: 4, collide: { w: 4.6, d: 2, h: 1.5 }, zone: 'street' },
  { type: 'van', x: -17.2, z: -10.7, y: 0.16, rotY: Math.PI / 2, variant: 0, collide: { w: 2.3, d: 5.4, h: 2.4 }, zone: 'street' },

  // --- Kessler Street: shopfront dressing --------------------------------
  { type: 'awning', x: -6, z: -11.7, y: 3.1, rotY: 0, zone: 'street' },
  { type: 'awning', x: 3, z: 11.7, y: 3.1, rotY: Math.PI, zone: 'street' },
  { type: 'neon', x: -6, z: -11.82, y: 3.6, rotY: 0, text: 'PAWN', color: '#ff4a6a', zone: 'street' },
  { type: 'neon', x: 3, z: 11.82, y: 3.6, rotY: Math.PI, text: 'LAUNDRY', color: '#49c9d6', zone: 'street' },
  { type: 'neon', x: -14, z: -11.82, y: 4.4, rotY: 0, text: 'HOTEL VERAN', color: '#ffb347', zone: 'street' },
  { type: 'graffiti', x: -16.5, z: 11.86, y: 2, rotY: Math.PI, text: 'NO ONE CAME', color: '#c8d64a', zone: 'street' },
  { type: 'graffiti', x: 5.5, z: -11.86, y: 2.1, rotY: 0, text: 'ROTWAVE', color: '#e05a3a', zone: 'street' },
  { type: 'fireescape', x: -11, z: -11.8, y: 4.6, rotY: 0, zone: 'street' },
  { type: 'acunit', x: -18, z: -11.8, y: 5.6, rotY: 0, zone: 'street' },
  { type: 'acunit', x: 1.5, z: -11.8, y: 6.6, rotY: 0, zone: 'street' },
  { type: 'acunit', x: -7, z: 11.8, y: 5.9, rotY: Math.PI, zone: 'street' },

  // --- Kessler Street: debris & barricading -----------------------------
  { type: 'sandbags', x: 7.2, z: -1.9, rotY: 0, collide: { w: 1.3, d: 0.8, h: 0.7 }, zone: 'street' },
  { type: 'sandbags', x: 7.2, z: 1.9, rotY: 0, collide: { w: 1.3, d: 0.8, h: 0.7 }, zone: 'street' },
  { type: 'barrel', x: 6.9, z: -6.4, collide: { w: 0.62, d: 0.62, h: 0.9 }, zone: 'street' },
  { type: 'barrel', x: 6.3, z: -7.1, collide: { w: 0.62, d: 0.62, h: 0.9 }, zone: 'street' },
  { type: 'crate', x: 7.3, z: 6.1, rotY: 0.3, collide: { w: 0.9, d: 0.9, h: 0.9 }, zone: 'street' },
  { type: 'crate', x: 7.3, z: 6.1, y: 0.9, rotY: 0.8, scale: 0.85, zone: 'street' },
  { type: 'crate', x: 7.4, z: 7.2, rotY: -0.2, collide: { w: 0.9, d: 0.9, h: 0.9 }, zone: 'street' },
  { type: 'cone', x: -3, z: -2, zone: 'street' },
  { type: 'cone', x: -2.4, z: -1.1, zone: 'street' },
  { type: 'cone', x: 3.4, z: 2.4, zone: 'street' },
  { type: 'cone', x: -16.5, z: 1.5, zone: 'street' },
  { type: 'trashpile', x: -19.2, z: -8, variant: 0, zone: 'street' },
  { type: 'trashpile', x: 7.6, z: 9.2, y: 0.16, variant: 1, zone: 'street' },
  { type: 'trashpile', x: -12, z: -11, y: 0.16, variant: 2, zone: 'street' },
  { type: 'cart', x: -1.2, z: 5.4, rotY: 0.6, collide: { w: 0.7, d: 1, h: 1 }, zone: 'street' },
  { type: 'dumpster', x: -18.2, z: 10.7, y: 0.16, rotY: Math.PI / 2, collide: { w: 1.4, d: 2.2, h: 1.3 }, zone: 'street' },
  { type: 'pallet', x: -19, z: 8.4, rotY: 0.4, zone: 'street' },

  // --- Marrow Alley -------------------------------------------------------
  { type: 'dumpster', x: 10.5, z: -8, rotY: Math.PI / 2, collide: { w: 1.4, d: 2.2, h: 1.3 }, zone: 'alley' },
  { type: 'dumpster', x: 20.9, z: -2, rotY: -Math.PI / 2, collide: { w: 1.4, d: 2.2, h: 1.3 }, zone: 'alley' },
  { type: 'dumpster', x: 10.6, z: 6, rotY: Math.PI / 2, collide: { w: 1.4, d: 2.2, h: 1.3 }, zone: 'alley' },
  { type: 'barrel', x: 14.6, z: -4.2, collide: { w: 0.62, d: 0.62, h: 0.9 }, zone: 'alley' },
  { type: 'barrel', x: 15.2, z: -3.4, collide: { w: 0.62, d: 0.62, h: 0.9 }, zone: 'alley' },
  { type: 'barrel', x: 20.4, z: 7.6, collide: { w: 0.62, d: 0.62, h: 0.9 }, zone: 'alley' },
  { type: 'crate', x: 10.4, z: -3.4, rotY: 0.2, collide: { w: 0.9, d: 0.9, h: 0.9 }, zone: 'alley' },
  { type: 'crate', x: 10.4, z: -3.4, y: 0.9, rotY: 0.9, scale: 0.9, zone: 'alley' },
  { type: 'crate', x: 21.2, z: 9.4, rotY: -0.4, collide: { w: 0.9, d: 0.9, h: 0.9 }, zone: 'alley' },
  { type: 'pallet', x: 12.2, z: -11.2, rotY: 0.15, zone: 'alley' },
  { type: 'pallet', x: 19.4, z: -11.4, rotY: -0.5, zone: 'alley' },
  { type: 'tirestack', x: 13.2, z: 11.2, collide: { w: 0.9, d: 0.9, h: 1 }, zone: 'alley' },
  { type: 'fence', x: 16.6, z: -11.6, rotY: 0, zone: 'alley' },
  { type: 'fireescape', x: 11.2, z: -11.8, y: 4.4, rotY: 0, zone: 'alley' },
  { type: 'fireescape', x: 21.8, z: 6.4, y: 4.4, rotY: -Math.PI / 2, zone: 'alley' },
  { type: 'acunit', x: 21.8, z: -6, y: 4.9, rotY: -Math.PI / 2, zone: 'alley' },
  { type: 'pipes', x: 21.7, z: 0, y: 0, rotY: -Math.PI / 2, zone: 'alley' },
  { type: 'pipes', x: 9.3, z: -6, y: 0, rotY: Math.PI / 2, zone: 'alley' },
  { type: 'fluoro', x: 12, z: -6, y: 4.1, rotY: 0, zone: 'alley' },
  { type: 'fluoro', x: 20, z: 4, y: 4.1, rotY: 0, variant: 1, zone: 'alley' },
  { type: 'trashpile', x: 10.6, z: 10.4, variant: 1, zone: 'alley' },
  { type: 'trashpile', x: 21, z: -11, variant: 0, zone: 'alley' },
  { type: 'trashpile', x: 15.6, z: 1.2, variant: 2, zone: 'alley' },
  { type: 'cart', x: 17.4, z: 2.6, rotY: -1.1, collide: { w: 0.7, d: 1, h: 1 }, zone: 'alley' },
  { type: 'graffiti', x: 22.84, z: -3, y: 2.1, rotY: -Math.PI / 2, text: 'BLIGHT', color: '#8a5ad6', zone: 'alley' },
  { type: 'barricade', x: 16.2, z: 11.5, rotY: 0, zone: 'alley' },
  { type: 'barricade', x: 19.8, z: 11.5, rotY: 0, zone: 'alley' },

  // --- Ferrus parking structure: pillars ---------------------------------
  { type: 'pillar', x: 13.5, z: 16, collide: { w: 0.8, d: 0.8, h: 4.2 }, zone: 'garage' },
  { type: 'pillar', x: 13.5, z: 20, collide: { w: 0.8, d: 0.8, h: 4.2 }, zone: 'garage' },
  { type: 'pillar', x: 13.5, z: 24, collide: { w: 0.8, d: 0.8, h: 4.2 }, zone: 'garage' },
  { type: 'pillar', x: 13.5, z: 28, collide: { w: 0.8, d: 0.8, h: 4.2 }, zone: 'garage' },
  { type: 'pillar', x: 17.5, z: 16, collide: { w: 0.8, d: 0.8, h: 4.2 }, zone: 'garage' },
  { type: 'pillar', x: 17.5, z: 20, collide: { w: 0.8, d: 0.8, h: 4.2 }, zone: 'garage' },
  { type: 'pillar', x: 17.5, z: 24, collide: { w: 0.8, d: 0.8, h: 4.2 }, zone: 'garage' },
  { type: 'pillar', x: 17.5, z: 28, collide: { w: 0.8, d: 0.8, h: 4.2 }, zone: 'garage' },
  { type: 'pillar', x: 24.5, z: 16, collide: { w: 0.8, d: 0.8, h: 4.2 }, zone: 'garage' },
  { type: 'pillar', x: 24.5, z: 20, collide: { w: 0.8, d: 0.8, h: 4.2 }, zone: 'garage' },
  { type: 'pillar', x: 24.5, z: 24, collide: { w: 0.8, d: 0.8, h: 4.2 }, zone: 'garage' },
  { type: 'pillar', x: 24.5, z: 28, collide: { w: 0.8, d: 0.8, h: 4.2 }, zone: 'garage' },
  { type: 'pillar', x: 28.5, z: 16, collide: { w: 0.8, d: 0.8, h: 4.2 }, zone: 'garage' },
  { type: 'pillar', x: 28.5, z: 24, collide: { w: 0.8, d: 0.8, h: 4.2 }, zone: 'garage' },

  // --- Ferrus parking structure: contents --------------------------------
  { type: 'car', x: 11.6, z: 15.6, rotY: 0, variant: 5, collide: { w: 4.6, d: 2, h: 1.5 }, zone: 'garage' },
  { type: 'car', x: 15.4, z: 15.6, rotY: 0.03, variant: 2, collide: { w: 4.6, d: 2, h: 1.5 }, zone: 'garage' },
  { type: 'car', x: 27, z: 15.6, rotY: 0, variant: 0, collide: { w: 4.6, d: 2, h: 1.5 }, zone: 'garage' },
  { type: 'car', x: 23, z: 28.4, rotY: Math.PI, variant: 4, collide: { w: 4.6, d: 2, h: 1.5 }, zone: 'garage' },
  { type: 'van', x: 28.2, z: 20, rotY: 0, variant: 1, collide: { w: 2.3, d: 5.4, h: 2.4 }, zone: 'garage' },
  { type: 'cone', x: 19.2, z: 18.6, zone: 'garage' },
  { type: 'cone', x: 19.7, z: 19.4, zone: 'garage' },
  { type: 'cone', x: 15.6, z: 22.2, zone: 'garage' },
  { type: 'barrel', x: 22.6, z: 27.6, collide: { w: 0.62, d: 0.62, h: 0.9 }, zone: 'garage' },
  { type: 'barrel', x: 19.4, z: 24.6, collide: { w: 0.62, d: 0.62, h: 0.9 }, zone: 'garage' },
  { type: 'crate', x: 10.2, z: 17.4, rotY: 0.1, collide: { w: 0.9, d: 0.9, h: 0.9 }, zone: 'garage' },
  { type: 'crate', x: 10.2, z: 17.4, y: 0.9, rotY: 0.7, scale: 0.9, zone: 'garage' },
  { type: 'crate', x: 29.4, z: 27.6, rotY: -0.3, collide: { w: 0.9, d: 0.9, h: 0.9 }, zone: 'garage' },
  { type: 'tirestack', x: 11.2, z: 21.4, collide: { w: 0.9, d: 0.9, h: 1 }, zone: 'garage' },
  { type: 'tirestack', x: 22.4, z: 14.4, collide: { w: 0.9, d: 0.9, h: 1 }, zone: 'garage' },
  { type: 'pallet', x: 12.4, z: 26.6, rotY: 0.5, zone: 'garage' },
  { type: 'pipes', x: 18, z: 13.6, y: 3.5, rotY: Math.PI / 2, zone: 'garage' },
  { type: 'pipes', x: 18, z: 29.4, y: 3.5, rotY: Math.PI / 2, zone: 'garage' },
  { type: 'fluoro', x: 14, z: 17, y: 4.05, rotY: 0, zone: 'garage' },
  { type: 'fluoro', x: 26, z: 17, y: 4.05, rotY: 0, variant: 1, zone: 'garage' },
  { type: 'fluoro', x: 14, z: 26, y: 4.05, rotY: 0, zone: 'garage' },
  { type: 'fluoro', x: 26, z: 26, y: 4.05, rotY: 0, zone: 'garage' },
  { type: 'fluoro', x: 18, z: 22, y: 4.05, rotY: Math.PI / 2, variant: 1, zone: 'garage' },
  { type: 'trashpile', x: 9.7, z: 29.2, variant: 0, zone: 'garage' },
  { type: 'cart', x: 20.2, z: 28.6, rotY: 2.1, collide: { w: 0.7, d: 1, h: 1 }, zone: 'garage' },
  { type: 'graffiti', x: 21.44, z: 21, y: 2, rotY: Math.PI / 2, text: 'LEVEL 2 FULL', color: '#d6a44a', zone: 'garage' },
];

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export const WAYPOINTS: WpNode[] = [
  { id: 'a1', x: -18, z: -5.5, zone: 'street' },
  { id: 'a2', x: -18, z: 5.5, zone: 'street' },
  { id: 'a3', x: -11, z: 0, zone: 'street' },
  { id: 'a4', x: -4, z: -5, zone: 'street' },
  { id: 'a5', x: -4, z: 5, zone: 'street' },
  { id: 'a6', x: 0, z: 0, zone: 'street' },
  { id: 'a7', x: 6, z: 0, zone: 'street' },
  { id: 'a8', x: 5.5, z: -5, zone: 'street' },
  { id: 'a9', x: 5.5, z: 5, zone: 'street' },
  { id: 'a10', x: -11, z: -5.5, zone: 'street' },
  { id: 'a11', x: -11, z: 5.5, zone: 'street' },
  { id: 'ga', x: 8.5, z: 0, zone: 'street' },
  { id: 'b1', x: 11, z: 0, zone: 'alley' },
  { id: 'b2', x: 13, z: -8, zone: 'alley' },
  { id: 'b3', x: 13, z: 8, zone: 'alley' },
  { id: 'b4', x: 18.5, z: -9, zone: 'alley' },
  { id: 'b5', x: 19, z: 0, zone: 'alley' },
  { id: 'b6', x: 18, z: 8, zone: 'alley' },
  { id: 'b7', x: 18, z: 10.6, zone: 'alley' },
  { id: 'gb', x: 18, z: 12.5, zone: 'alley' },
  { id: 'c1', x: 18, z: 15, zone: 'garage' },
  { id: 'c2', x: 11.5, z: 17.5, zone: 'garage' },
  { id: 'c3', x: 10.8, z: 26.5, zone: 'garage' },
  { id: 'c4', x: 19.4, z: 22, zone: 'garage' },
  { id: 'c5', x: 26.5, z: 16, zone: 'garage' },
  { id: 'c6', x: 26.5, z: 27, zone: 'garage' },
  { id: 'c7', x: 18.6, z: 27.5, zone: 'garage' },
  { id: 'c8', x: 26.5, z: 22, zone: 'garage' },
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
  { a: 'a10', b: 'a4' },
  { a: 'a11', b: 'a5' },
  { a: 'a4', b: 'a8' },
  { a: 'a5', b: 'a9' },
  { a: 'a6', b: 'a7' },
  { a: 'a7', b: 'a8' },
  { a: 'a7', b: 'a9' },
  // Street -> alley, gated by the first shutter.
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
  // Alley -> garage, gated by the roll-door.
  { a: 'b7', b: 'gb', doorId: 'shutter_garage' },
  { a: 'gb', b: 'c1', doorId: 'shutter_garage' },
  { a: 'c1', b: 'c2' },
  { a: 'c1', b: 'c4' },
  { a: 'c1', b: 'c5' },
  { a: 'c2', b: 'c3' },
  { a: 'c2', b: 'c4' },
  { a: 'c3', b: 'c7' },
  { a: 'c4', b: 'c7' },
  { a: 'c4', b: 'c3' },
  { a: 'c5', b: 'c8' },
  { a: 'c8', b: 'c6' },
  { a: 'c6', b: 'c7' },
];

export const PLAYER_START = { x: -15, y: 0, z: 0, yaw: -Math.PI / 2 };

// ---------------------------------------------------------------------------
// Collider derivation
// ---------------------------------------------------------------------------

/** Static collider set, derived from the exact data the renderer consumes. */
export function buildColliders(): Collider[] {
  const out: Collider[] = [];

  // Raised slabs become colliders so kerbs are stepped onto, not walked through.
  for (const s of SLABS) {
    if (s.y <= 0.001) continue;
    out.push(collider(s.x0, s.x1, 0, s.y, s.z0, s.z1, 'kerb'));
  }

  for (const b of BLOCKS) {
    if (b.solid === false) continue;
    out.push(collider(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, b.tag ?? 'wall'));
  }

  // Shutters exist as colliders only while shut - a single Set lookup in the
  // movement code, and the nav graph drops the matching edges at the same time.
  for (const d of DOORS) {
    out.push(collider(d.x0, d.x1, d.y0, d.y1, d.z0, d.z1, 'door', d.id));
  }

  for (const p of PROPS) {
    if (!p.collide) continue;
    const rot = p.rotY ?? 0;
    // Props sit on ~90-degree increments, so swapping the footprint on a
    // quarter turn keeps the AABB tight without needing oriented boxes.
    const quarter = Math.abs(Math.sin(rot)) > 0.7;
    const w = quarter ? p.collide.d : p.collide.w;
    const d = quarter ? p.collide.w : p.collide.d;
    const y0 = p.y ?? 0;
    out.push(collider(p.x - w / 2, p.x + w / 2, y0, y0 + p.collide.h, p.z - d / 2, p.z + d / 2, p.type));
  }

  return out;
}

/** Which zone contains this point? Drives spawn gating and room culling. */
export function zoneAt(x: number, z: number): Zone {
  if (z >= 13) return 'garage';
  if (x >= 9) return 'alley';
  return 'street';
}
