import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Geometry toolkit.
 *
 * Everything here builds geometry directly in *world* space and then hands it to
 * a `GeoCollector` keyed by material. At the end of construction each material's
 * chunks are merged into a single BufferGeometry, so the whole city - walls,
 * pavements, cars, pipes, crates, railings - collapses to roughly one draw call
 * per material instead of one per object.
 *
 * That single decision is worth more than every other optimisation in this file:
 * on a weak CPU, ANGLE costs ~30-60us per draw call, so 800 objects would burn
 * the entire frame budget before the GPU did any work.
 */

/**
 * Box-projected UVs.
 *
 * Primitive UVs are per-face 0..1, which makes a 20m wall show one absurdly
 * stretched texture tile. Projecting from world position along the dominant
 * normal axis gives consistent real-world texel density everywhere and tiles
 * seamlessly across merged geometry.
 */
export function boxUV(geo: THREE.BufferGeometry, tile: number): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  if (!pos || !nrm) return geo;
  const uv = new Float32Array(pos.count * 2);
  const inv = 1 / tile;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    const nz = Math.abs(nrm.getZ(i));
    let u: number;
    let v: number;
    if (ny >= nx && ny >= nz) {
      // Floor / ceiling: project down.
      u = x * inv;
      v = z * inv;
    } else if (nx >= nz) {
      // Wall facing X.
      u = z * inv;
      v = y * inv;
    } else {
      // Wall facing Z.
      u = x * inv;
      v = y * inv;
    }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Strip anything that would break a merge (colours, tangents, uv2...). */
function normaliseAttributes(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(geo.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
  }
  if (!geo.getAttribute('uv')) {
    const pos = geo.getAttribute('position');
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  }
  return geo;
}

// ---------------------------------------------------------------------------
// World-space primitives
// ---------------------------------------------------------------------------

export interface Xform {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
}

function place(geo: THREE.BufferGeometry, t: Xform): THREE.BufferGeometry {
  if (t.rx) geo.rotateX(t.rx);
  if (t.ry) geo.rotateY(t.ry);
  if (t.rz) geo.rotateZ(t.rz);
  geo.translate(t.x ?? 0, t.y ?? 0, t.z ?? 0);
  return geo;
}

/** Axis-aligned box by extents. The workhorse for architecture. */
export function boxFrom(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/** Box by size, centred on (x, y, z), optionally rotated. */
export function box(w: number, h: number, d: number, t: Xform = {}): THREE.BufferGeometry {
  return place(new THREE.BoxGeometry(w, h, d), t);
}

/** Bevelled box. Chamfered edges catch specular highlights, which is most of
 *  what separates a "3D box" from a manufactured object. */
export function bevelBox(w: number, h: number, d: number, bevel: number, t: Xform = {}): THREE.BufferGeometry {
  const b = Math.min(bevel, w / 3, h / 3, d / 3);
  const parts: THREE.BufferGeometry[] = [
    new THREE.BoxGeometry(w, h - b * 2, d),
    new THREE.BoxGeometry(w - b * 2, b, d - b * 2).translate(0, (h - b) / 2 + b / 2 - b / 2, 0),
    new THREE.BoxGeometry(w - b * 2, b, d - b * 2).translate(0, -((h - b) / 2 + b / 2 - b / 2), 0),
  ];
  parts[1].translate(0, (h - b * 2) / 2 + b / 2, 0);
  parts[2].translate(0, -((h - b * 2) / 2 + b / 2), 0);
  const merged = mergeGeometries(parts.map(normaliseAttributes), false) ?? parts[0];
  parts.forEach((p) => p.dispose());
  return place(merged, t);
}

export function cyl(rTop: number, rBottom: number, h: number, seg = 12, t: Xform = {}): THREE.BufferGeometry {
  return place(new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, false), t);
}

export function tube(r: number, h: number, seg = 10, t: Xform = {}): THREE.BufferGeometry {
  return cyl(r, r, h, seg, t);
}

export function sphere(r: number, wSeg = 12, hSeg = 8, t: Xform = {}): THREE.BufferGeometry {
  return place(new THREE.SphereGeometry(r, wSeg, hSeg), t);
}

export function capsule(r: number, len: number, capSeg = 4, radSeg = 10, t: Xform = {}): THREE.BufferGeometry {
  return place(new THREE.CapsuleGeometry(r, len, capSeg, radSeg), t);
}

export function torus(r: number, tubeR: number, radSeg = 8, tubSeg = 14, arc = Math.PI * 2, t: Xform = {}): THREE.BufferGeometry {
  return place(new THREE.TorusGeometry(r, tubeR, radSeg, tubSeg, arc), t);
}

/** Flat quad facing +Z before rotation. Used for decals, signs and posters. */
export function plane(w: number, h: number, t: Xform = {}): THREE.BufferGeometry {
  return place(new THREE.PlaneGeometry(w, h), t);
}

/** Tapered box - one box scaled per-vertex along Y. Good for stocks and legs. */
export function taper(w: number, h: number, d: number, topScale: number, t: Xform = {}): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d, 1, 2, 1);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = (y + h / 2) / h; // 0 at bottom, 1 at top
    const s = 1 + (topScale - 1) * k;
    pos.setX(i, pos.getX(i) * s);
    pos.setZ(i, pos.getZ(i) * s);
  }
  g.computeVertexNormals();
  return place(g, t);
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

/**
 * Accumulates world-space geometry per material key, plus any objects that must
 * stay individually addressable because they animate.
 */
export class GeoCollector {
  private readonly chunks = new Map<string, THREE.BufferGeometry[]>();
  readonly dynamic: THREE.Object3D[] = [];

  /** `tile` is world metres per texture repeat for this surface. */
  add(mat: string, geo: THREE.BufferGeometry, tile = 1): void {
    boxUV(geo, tile);
    normaliseAttributes(geo);
    let list = this.chunks.get(mat);
    if (!list) {
      list = [];
      this.chunks.set(mat, list);
    }
    list.push(geo);
  }

  addMany(mat: string, geos: THREE.BufferGeometry[], tile = 1): void {
    for (const g of geos) this.add(mat, g, tile);
  }

  addDynamic(obj: THREE.Object3D): void {
    this.dynamic.push(obj);
  }

  get materialKeys(): string[] {
    return [...this.chunks.keys()];
  }

  /** Merge one material's chunks. Returns null when nothing was collected. */
  merge(mat: string): THREE.BufferGeometry | null {
    const list = this.chunks.get(mat);
    if (!list || list.length === 0) return null;
    if (list.length === 1) return list[0];
    const merged = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    return merged;
  }

  clear(): void {
    this.chunks.clear();
    this.dynamic.length = 0;
  }
}

/** Recursively dispose every geometry and material under a node. */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) (mat as THREE.Material).dispose();
  });
}

export { mergeGeometries };
