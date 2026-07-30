import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { box, capsule, sphere, torus } from './geo';
import { clamp01, damp, lerp } from '../util/vec';

/**
 * THE BLIGHTED - procedurally modelled, rigged and animated.
 *
 * Why build a skinned character in code instead of loading a GLTF:
 *  - zero third-party licensing risk, no dead CDN links, ~0 KB of repo weight
 *  - total control over proportions, weighting and animation curves
 *  - one shared geometry and one shared weight solve, reused by every instance
 *
 * The result is a genuine `THREE.SkinnedMesh` on a 21-bone `THREE.Skeleton`,
 * smoothly weighted, animated by writing bone quaternions each frame. Not boxes
 * bolted together - real skinning, with shoulders and knees that deform.
 *
 * Cost profile (deliberate, see ARCHITECTURE.md section 4):
 *   ~5,200 triangles, 2 draw calls (flesh + clothing), 21 bones.
 *   Thirty 60k-tri skinned meshes is not survivable in WebGL at 60fps. A mid-poly
 *   body carrying a 512px normal-mapped skin texture is indistinguishable at
 *   gameplay range and roughly ten times cheaper.
 */

/** Height of the model as authored. The renderer scales to each zombie's height. */
export const MODEL_HEIGHT = 1.75;

// ---------------------------------------------------------------------------
// Skeleton definition
// ---------------------------------------------------------------------------

interface BoneSpec {
  name: string;
  parent: number;
  x: number;
  y: number;
  z: number;
}

/**
 * Bind pose is a relaxed A-stance with the arms hanging down, NOT a T-pose.
 * That matters: every animation rotation is then a small deviation from a natural
 * resting posture, which keeps shoulder deformation clean without corrective
 * blend shapes.
 */
const BONES: BoneSpec[] = [
  { name: 'root', parent: -1, x: 0, y: 0, z: 0 },
  { name: 'hips', parent: 0, x: 0, y: 0.96, z: 0 },
  { name: 'spine', parent: 1, x: 0, y: 0.17, z: 0 },
  { name: 'chest', parent: 2, x: 0, y: 0.19, z: 0 },
  { name: 'neck', parent: 3, x: 0, y: 0.15, z: 0 },
  { name: 'head', parent: 4, x: 0, y: 0.13, z: 0 },
  { name: 'jaw', parent: 5, x: 0, y: -0.03, z: 0.04 },
  { name: 'shoulderL', parent: 3, x: 0.1, y: 0.11, z: 0 },
  { name: 'armUpperL', parent: 7, x: 0.09, y: 0.01, z: 0 },
  { name: 'armLowerL', parent: 8, x: 0, y: -0.29, z: 0.015 },
  { name: 'handL', parent: 9, x: 0, y: -0.25, z: 0.03 },
  { name: 'shoulderR', parent: 3, x: -0.1, y: 0.11, z: 0 },
  { name: 'armUpperR', parent: 11, x: -0.09, y: 0.01, z: 0 },
  { name: 'armLowerR', parent: 12, x: 0, y: -0.29, z: 0.015 },
  { name: 'handR', parent: 13, x: 0, y: -0.25, z: 0.03 },
  { name: 'thighL', parent: 1, x: 0.105, y: -0.04, z: 0 },
  { name: 'shinL', parent: 15, x: 0, y: -0.44, z: 0 },
  { name: 'footL', parent: 16, x: 0, y: -0.42, z: 0.04 },
  { name: 'thighR', parent: 1, x: -0.105, y: -0.04, z: 0 },
  { name: 'shinR', parent: 18, x: 0, y: -0.44, z: 0 },
  { name: 'footR', parent: 19, x: 0, y: -0.42, z: 0.04 },
];

export const B = BONES.reduce<Record<string, number>>((acc, b, i) => {
  acc[b.name] = i;
  return acc;
}, {});

/** World-space bind position of every bone, used for skin weighting. */
function bindPositions(): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  for (const b of BONES) {
    if (b.parent < 0) out.push({ x: b.x, y: b.y, z: b.z });
    else {
      const p = out[b.parent];
      out.push({ x: p.x + b.x, y: p.y + b.y, z: p.z + b.z });
    }
  }
  return out;
}

const BIND = bindPositions();

interface WeightSeg {
  a: { x: number; y: number; z: number };
  b: { x: number; y: number; z: number };
  bone: number;
}

/**
 * Weighting segments: each bone pairs with its primary child so a limb weights
 * along its actual length rather than radially from a joint. Leaves get a short
 * stub in the direction they naturally extend.
 */
function weightSegments(): WeightSeg[] {
  const childOf: Record<number, number> = {
    [B.hips]: B.spine,
    [B.spine]: B.chest,
    [B.chest]: B.neck,
    [B.neck]: B.head,
    [B.shoulderL]: B.armUpperL,
    [B.armUpperL]: B.armLowerL,
    [B.armLowerL]: B.handL,
    [B.shoulderR]: B.armUpperR,
    [B.armUpperR]: B.armLowerR,
    [B.armLowerR]: B.handR,
    [B.thighL]: B.shinL,
    [B.shinL]: B.footL,
    [B.thighR]: B.shinR,
    [B.shinR]: B.footR,
  };
  const stubs: Record<number, { x: number; y: number; z: number }> = {
    [B.head]: { x: 0, y: 0.12, z: 0.01 },
    [B.jaw]: { x: 0, y: -0.02, z: 0.08 },
    [B.handL]: { x: 0, y: -0.11, z: 0.03 },
    [B.handR]: { x: 0, y: -0.11, z: 0.03 },
    [B.footL]: { x: 0, y: 0, z: 0.16 },
    [B.footR]: { x: 0, y: 0, z: 0.16 },
  };
  const segs: WeightSeg[] = [];
  // Bone 0 (root) is deliberately excluded: it sits at the origin between the
  // feet, so including it would bind ankle vertices to the root.
  for (let i = 1; i < BONES.length; i++) {
    const a = BIND[i];
    const childIdx = childOf[i];
    const stub = stubs[i];
    const b =
      childIdx !== undefined
        ? BIND[childIdx]
        : { x: a.x + (stub?.x ?? 0), y: a.y + (stub?.y ?? 0.06), z: a.z + (stub?.z ?? 0) };
    segs.push({ a, b, bone: i });
  }
  return segs;
}

// ---------------------------------------------------------------------------
// Body geometry, authored directly in bind space
// ---------------------------------------------------------------------------

/** Squash non-uniformly. Human torsos are elliptical in section, not circular. */
function squash(g: THREE.BufferGeometry, sx: number, sy: number, sz: number): THREE.BufferGeometry {
  g.scale(sx, sy, sz);
  g.computeVertexNormals();
  return g;
}

function buildFlesh(): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];

  // Torso: three stacked elliptical masses, narrowing at the waist.
  parts.push(squash(capsule(0.155, 0.15, 4, 12, { y: 1.0 }), 1.24, 1, 0.84));
  parts.push(squash(capsule(0.148, 0.13, 4, 12, { y: 1.15 }), 1.18, 1, 0.78));
  parts.push(squash(capsule(0.175, 0.2, 4, 14, { y: 1.31, z: 0.005 }), 1.34, 1, 0.72));
  // Clavicles.
  parts.push(capsule(0.038, 0.11, 3, 8, { x: 0.1, y: 1.41, z: 0.035, rz: Math.PI / 2 - 0.35 }));
  parts.push(capsule(0.038, 0.11, 3, 8, { x: -0.1, y: 1.41, z: 0.035, rz: -(Math.PI / 2 - 0.35) }));
  // Deltoid caps. Without these the shoulder collapses when the arm rotates.
  parts.push(sphere(0.072, 10, 8, { x: 0.19, y: 1.415, z: 0 }));
  parts.push(sphere(0.072, 10, 8, { x: -0.19, y: 1.415, z: 0 }));

  // Neck and skull.
  parts.push(capsule(0.052, 0.08, 3, 10, { y: 1.465, z: 0.004 }));
  parts.push(squash(sphere(0.105, 14, 10, { y: 1.6, z: 0.008 }), 0.9, 1.14, 1.0));
  parts.push(squash(sphere(0.086, 12, 8, { y: 1.625, z: -0.032 }), 1.0, 0.98, 1.0));
  // Brow, cheekbones, nose bridge, slack jaw. Cheap, and it is the difference
  // between a head and a ball.
  parts.push(box(0.155, 0.028, 0.05, { y: 1.618, z: 0.086 }));
  parts.push(box(0.135, 0.05, 0.04, { y: 1.575, z: 0.088 }));
  parts.push(box(0.032, 0.055, 0.05, { y: 1.585, z: 0.104 }));
  parts.push(box(0.125, 0.055, 0.11, { y: 1.542, z: 0.055 }));
  // Sunken eye sockets.
  parts.push(sphere(0.026, 8, 6, { x: 0.038, y: 1.596, z: 0.086 }));
  parts.push(sphere(0.026, 8, 6, { x: -0.038, y: 1.596, z: 0.086 }));

  // Arms.
  for (const s of [1, -1]) {
    const x = 0.19 * s;
    parts.push(capsule(0.054, 0.23, 4, 10, { x, y: 1.275, z: 0.008 }));
    parts.push(sphere(0.05, 8, 6, { x, y: 1.13, z: 0.014 }));
    parts.push(capsule(0.045, 0.2, 4, 10, { x, y: 1.005, z: 0.026 }));
    // Palm plus three splayed finger stubs. They read as claws in motion.
    parts.push(box(0.072, 0.11, 0.045, { x, y: 0.825, z: 0.05 }));
    for (let f = 0; f < 3; f++) {
      parts.push(capsule(0.014, 0.06, 2, 6, { x: x + (f - 1) * 0.024 * s, y: 0.745, z: 0.062 + f * 0.004, rx: -0.5 }));
    }
  }

  // Legs.
  for (const s of [1, -1]) {
    const x = 0.105 * s;
    parts.push(capsule(0.083, 0.34, 4, 12, { x, y: 0.69, z: 0 }));
    parts.push(sphere(0.075, 10, 8, { x, y: 0.46, z: 0.005 }));
    parts.push(capsule(0.066, 0.32, 4, 10, { x, y: 0.26, z: 0.012 }));
    parts.push(sphere(0.055, 8, 6, { x, y: 0.06, z: 0.02 }));
    parts.push(box(0.095, 0.065, 0.235, { x, y: 0.035, z: 0.09 }));
  }

  return parts;
}

function buildClothing(): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  // Coverall shell, slightly proud of the flesh beneath.
  parts.push(squash(capsule(0.183, 0.3, 5, 14, { y: 1.19, z: 0.004 }), 1.3, 1, 0.8));
  // Torn hem, hanging unevenly.
  parts.push(squash(capsule(0.176, 0.05, 3, 14, { y: 0.98, z: 0.004, rx: 0.08 }), 1.3, 1, 0.82));
  parts.push(squash(torus(0.082, 0.022, 6, 14, Math.PI * 2, { y: 1.425, z: 0.006, rx: Math.PI / 2 }), 1.3, 1, 0.85));
  parts.push(squash(torus(0.163, 0.026, 6, 16, Math.PI * 2, { y: 1.0, rx: Math.PI / 2 }), 1.24, 1, 0.86));
  // Sleeves ending mid-forearm, so bare skin shows below.
  for (const s of [1, -1]) {
    const x = 0.19 * s;
    parts.push(capsule(0.068, 0.18, 4, 10, { x, y: 1.31, z: 0.008 }));
    parts.push(capsule(0.056, 0.07, 3, 8, { x, y: 1.135, z: 0.014 }));
  }
  // Trousers and boots.
  for (const s of [1, -1]) {
    const x = 0.105 * s;
    parts.push(capsule(0.098, 0.3, 4, 12, { x, y: 0.72, z: 0 }));
    parts.push(capsule(0.082, 0.14, 3, 10, { x, y: 0.4, z: 0.008 }));
    parts.push(box(0.108, 0.13, 0.245, { x, y: 0.07, z: 0.088 }));
    parts.push(box(0.116, 0.035, 0.26, { x, y: 0.017, z: 0.092 }));
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Skin weighting
// ---------------------------------------------------------------------------

function distanceToSegment(px: number, py: number, pz: number, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const apx = px - a.x;
  const apy = py - a.y;
  const apz = pz - a.z;
  const abLen2 = abx * abx + aby * aby + abz * abz;
  let t = abLen2 > 1e-9 ? (apx * abx + apy * aby + apz * abz) / abLen2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = apx - abx * t;
  const dy = apy - aby * t;
  const dz = apz - abz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Automatic smooth skinning.
 *
 * For every vertex find the two nearest bone *segments* and weight by inverse
 * cubed distance. Inverse-cube is the sweet spot: sharp enough that a thigh
 * vertex is not dragged by the opposite leg, soft enough that elbows and knees
 * bend without creasing.
 */
function applySkinWeights(geo: THREE.BufferGeometry): void {
  const segs = weightSegments();
  const pos = geo.getAttribute('position');
  const count = pos.count;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);

    let b0 = segs[0].bone;
    let d0 = Infinity;
    let b1 = segs[0].bone;
    let d1 = Infinity;

    for (let s = 0; s < segs.length; s++) {
      const d = distanceToSegment(px, py, pz, segs[s].a, segs[s].b);
      if (d < d0) {
        d1 = d0;
        b1 = b0;
        d0 = d;
        b0 = segs[s].bone;
      } else if (d < d1) {
        d1 = d;
        b1 = segs[s].bone;
      }
    }

    const w0 = 1 / (d0 * d0 * d0 + 1e-6);
    const w1 = 1 / (d1 * d1 * d1 + 1e-6);
    const sum = w0 + w1;
    const o = i * 4;
    skinIndex[o] = b0;
    skinIndex[o + 1] = b1;
    skinWeight[o] = w0 / sum;
    skinWeight[o + 1] = w1 / sum;
    // Influences 3 and 4 stay zero. Two is plenty for a limbed biped and halves
    // the vertex shader's bone-matrix work.
  }

  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
}

function stripExtras(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Asset
// ---------------------------------------------------------------------------

export interface ZombieInstance {
  /** Transform this. Never touch the mesh directly. */
  group: THREE.Group;
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  skeleton: THREE.Skeleton;
  /** Bind-pose Y of the hips, so the walk bob can offset from it. */
  hipsBindY: number;
}

export interface ZombieAsset {
  geometry: THREE.BufferGeometry;
  triangles: number;
  instance(skinMat: THREE.Material, clothMat: THREE.Material): ZombieInstance;
  dispose(): void;
}

export function createZombieAsset(): ZombieAsset {
  const flesh = buildFlesh().map(stripExtras);
  const cloth = buildClothing().map(stripExtras);

  const fleshMerged = mergeGeometries(flesh, false);
  const clothMerged = mergeGeometries(cloth, false);
  flesh.forEach((g) => g.dispose());
  cloth.forEach((g) => g.dispose());
  if (!fleshMerged || !clothMerged) throw new Error('ZombieFactory: geometry merge failed');

  // Two groups means two draw calls with two materials, but ONE mesh, one
  // skeleton update and one set of bone matrices. Merging per material first and
  // only then grouping is what keeps it at two instead of thirty.
  const geometry = mergeGeometries([fleshMerged, clothMerged], true);
  fleshMerged.dispose();
  clothMerged.dispose();
  if (!geometry) throw new Error('ZombieFactory: group merge failed');

  applySkinWeights(geometry);
  geometry.computeBoundingSphere();
  // The bounding sphere must cover the animated range, not just the bind pose,
  // or limbs get culled at the screen edge mid-lunge.
  if (geometry.boundingSphere) geometry.boundingSphere.radius *= 1.45;

  const idx = geometry.getIndex();
  const triangles = Math.round((idx ? idx.count : geometry.getAttribute('position').count) / 3);

  return {
    geometry,
    triangles,

    instance(skinMat, clothMat) {
      const bones: THREE.Bone[] = BONES.map((spec) => {
        const bone = new THREE.Bone();
        bone.name = spec.name;
        bone.position.set(spec.x, spec.y, spec.z);
        return bone;
      });
      BONES.forEach((spec, i) => {
        if (spec.parent >= 0) bones[spec.parent].add(bones[i]);
      });

      // Bind-pose world matrices must exist before Skeleton computes inverses.
      bones[0].updateMatrixWorld(true);
      const skeleton = new THREE.Skeleton(bones);

      const mesh = new THREE.SkinnedMesh(geometry, [skinMat, clothMat]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      mesh.add(bones[0]);
      mesh.bind(skeleton);
      // AttachedBindMode (the default) recomputes bindMatrixInverse from the
      // mesh's world matrix every frame, which is exactly what lets us move and
      // scale the parent group freely without double-transforming the skin.
      mesh.bindMode = THREE.AttachedBindMode;

      const group = new THREE.Group();
      group.add(mesh);

      return { group, mesh, bones, skeleton, hipsBindY: BONES[B.hips].y };
    },

    dispose() {
      geometry.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Procedural animation
// ---------------------------------------------------------------------------

export type PoseState = 'emerging' | 'chase' | 'windup' | 'strike' | 'stagger' | 'dead';

export interface PoseParams {
  state: PoseState;
  /** Walk-cycle phase, advanced by distance travelled. */
  phase: number;
  /** 0-1 asymmetry of the gait. */
  limp: number;
  /** Forward hunch, radians. */
  lean: number;
  /** Head roll, radians. */
  tilt: number;
  /** Seconds into the current state. */
  stateT: number;
  /** Seconds since death. */
  deathT: number;
  /** Which way the body falls. */
  fallBack: boolean;
  /** 0-1 how fast they are actually moving, scales animation amplitude. */
  intensity: number;
  dt: number;
}

const _e = new THREE.Euler();

function setRot(bone: THREE.Bone, x: number, y: number, z: number): void {
  _e.set(x, y, z, 'XYZ');
  bone.quaternion.setFromEuler(_e);
}

/**
 * Write a full pose into a bone hierarchy.
 *
 * Everything is authored as bone-space Euler curves. The signs follow from the
 * bind pose: arms and legs point down -Y, so a NEGATIVE X rotation swings them
 * forward (+Z); the spine points up +Y, so a POSITIVE X rotation hunches forward.
 */
export function poseZombie(inst: ZombieInstance, p: PoseParams): void {
  const b = inst.bones;
  const ph = p.phase;
  const amp = 0.35 + p.intensity * 0.65;
  const SIDES = ['L', 'R'] as const;

  // --- Death: nothing else matters -----------------------------------------
  if (p.state === 'dead') {
    const t = clamp01(p.deathT / 0.75);
    const ease = t * t * (3 - 2 * t);
    const dir = p.fallBack ? -1 : 1;
    // Pivot about the feet, the way a body actually drops.
    inst.group.rotation.x = dir * ease * 1.52;
    inst.group.rotation.z = Math.sin(p.deathT * 2.2) * 0.06 * (1 - ease);
    // Then sink through the floor. Opaque plus sinking beats an alpha fade: no
    // transparency sorting artefacts when bodies overlap.
    const sink = Math.max(0, p.deathT - 1.4) * 0.85;
    inst.group.position.y -= sink * p.dt * 8;

    const slack = ease;
    setRot(b[B.spine], lerp(p.lean, 0.1, slack), 0, 0);
    setRot(b[B.chest], 0.06, 0, 0);
    setRot(b[B.neck], lerp(-p.lean, 0.45 * dir, slack), 0, p.tilt * 1.6);
    setRot(b[B.head], 0, 0, p.tilt);
    setRot(b[B.jaw], -0.42, 0, 0);
    for (const s of SIDES) {
      const sign = s === 'L' ? 1 : -1;
      setRot(b[B[`armUpper${s}`]], lerp(-0.3, 0.35 * dir, slack), 0, 0.34 * sign * (1 + slack));
      setRot(b[B[`armLower${s}`]], lerp(-0.5, -0.12, slack), 0, 0);
      setRot(b[B[`hand${s}`]], -0.2, 0, 0);
      setRot(b[B[`thigh${s}`]], lerp(0, -0.25 * dir, slack), 0, 0.12 * sign);
      setRot(b[B[`shin${s}`]], lerp(0.1, 0.55, slack), 0, 0);
      setRot(b[B[`foot${s}`]], 0, 0, 0);
    }
    b[B.hips].position.y = inst.hipsBindY;
    return;
  }

  inst.group.rotation.x = 0;
  inst.group.rotation.z = 0;

  // --- Emerging: haul yourself out of the breach ---------------------------
  if (p.state === 'emerging') {
    const t = clamp01(p.stateT / 0.9);
    const ease = t * t * (3 - 2 * t);
    const crouch = 1 - ease;
    // Rise from below ground, hunched almost double, then straighten.
    inst.group.position.y = -crouch * 1.15;
    setRot(b[B.spine], p.lean + crouch * 0.85, 0, 0);
    setRot(b[B.chest], 0.1 + crouch * 0.3, 0, 0);
    setRot(b[B.neck], -p.lean - crouch * 0.7, 0, p.tilt);
    setRot(b[B.head], 0, Math.sin(p.stateT * 3) * 0.2, p.tilt);
    setRot(b[B.jaw], -0.3 - crouch * 0.2, 0, 0);
    for (const s of SIDES) {
      const sign = s === 'L' ? 1 : -1;
      // Clawing at the ground on the way up.
      setRot(b[B[`armUpper${s}`]], -0.4 - crouch * 1.5 + Math.sin(p.stateT * 6 + sign) * 0.3 * crouch, 0, 0.2 * sign);
      setRot(b[B[`armLower${s}`]], -0.7 - crouch * 0.5, 0, 0);
      setRot(b[B[`hand${s}`]], -0.5, 0, 0.2 * sign);
      setRot(b[B[`thigh${s}`]], crouch * 0.9, 0, 0.1 * sign);
      setRot(b[B[`shin${s}`]], crouch * 1.3 + 0.08, 0, 0);
      setRot(b[B[`foot${s}`]], -crouch * 0.4, 0, 0);
    }
    b[B.hips].position.y = inst.hipsBindY - crouch * 0.24;
    return;
  }

  inst.group.position.y = 0;

  // --- Attack: wind up, then commit ---------------------------------------
  if (p.state === 'windup' || p.state === 'strike') {
    const winding = p.state === 'windup';
    const t = clamp01(p.stateT / (winding ? 0.34 : 0.42));
    // Arms rise overhead on the wind-up, then hammer down on the strike.
    const raise = winding ? t : 1 - Math.min(1, t * 2.6);
    const lunge = winding ? -t * 0.14 : Math.sin(Math.min(1, t * 2.4) * Math.PI) * 0.3;

    setRot(b[B.spine], p.lean * 0.6 - raise * 0.22 + lunge, 0, 0);
    setRot(b[B.chest], 0.05 + lunge * 0.4, 0, 0);
    setRot(b[B.neck], -p.lean * 1.5 - 0.15, 0, p.tilt * 0.5);
    setRot(b[B.head], -0.1, 0, p.tilt * 0.5);
    // Mouth wide. This reads clearly even in peripheral vision, which is the
    // point: it is the animation that tells you to back off.
    setRot(b[B.jaw], -0.55 - raise * 0.2, 0, 0);

    for (const s of SIDES) {
      const sign = s === 'L' ? 1 : -1;
      setRot(b[B[`armUpper${s}`]], -0.4 - raise * 1.7 + sign * 0.12, 0, 0.3 * sign + raise * 0.15 * sign);
      setRot(b[B[`armLower${s}`]], -0.45 - raise * 0.5, 0, 0);
      setRot(b[B[`hand${s}`]], -0.6, 0, 0.28 * sign);
      setRot(b[B[`thigh${s}`]], -0.1 + lunge * 0.3, 0, 0.1 * sign);
      setRot(b[B[`shin${s}`]], 0.18, 0, 0);
      setRot(b[B[`foot${s}`]], -0.06, 0, 0);
    }
    b[B.hips].position.y = inst.hipsBindY - raise * 0.05;
    return;
  }

  // --- Stagger: knocked off rhythm ----------------------------------------
  if (p.state === 'stagger') {
    const t = clamp01(p.stateT / 0.34);
    const shock = (1 - t) * Math.sin(p.stateT * 34) * 0.5;
    setRot(b[B.spine], p.lean - 0.28 * (1 - t), 0, shock * 0.3);
    setRot(b[B.chest], -0.1 * (1 - t), shock * 0.4, 0);
    setRot(b[B.neck], -p.lean + 0.3 * (1 - t), 0, p.tilt + shock * 0.4);
    setRot(b[B.head], 0, shock * 0.5, p.tilt);
    setRot(b[B.jaw], -0.5, 0, 0);
    for (const s of SIDES) {
      const sign = s === 'L' ? 1 : -1;
      setRot(b[B[`armUpper${s}`]], -0.1 + shock * 0.6 * sign, 0, 0.5 * sign + shock * 0.3);
      setRot(b[B[`armLower${s}`]], -0.3, 0, 0);
      setRot(b[B[`hand${s}`]], -0.2, 0, 0);
      setRot(b[B[`thigh${s}`]], 0.16 * (1 - t) + shock * 0.2 * sign, 0, 0.14 * sign);
      setRot(b[B[`shin${s}`]], 0.22, 0, 0);
      setRot(b[B[`foot${s}`]], -0.08, 0, 0);
    }
    b[B.hips].position.y = inst.hipsBindY - 0.05 * (1 - t);
    return;
  }

  // --- Chase: the lurch ----------------------------------------------------
  const sway = Math.sin(ph);
  const bounce = Math.abs(Math.sin(ph));

  setRot(b[B.hips], 0, sway * 0.14 * amp, sway * 0.055 * amp);
  b[B.hips].position.y = inst.hipsBindY + bounce * 0.026 * amp;

  setRot(b[B.spine], p.lean + Math.sin(ph * 2) * 0.024, -sway * 0.06, 0);
  setRot(b[B.chest], 0.11, -sway * 0.13 * amp, sway * 0.03);
  // The head lolls and hunts independently of the body. This one detail does
  // more for "wrong" than any texture.
  setRot(b[B.neck], -p.lean * 1.35 - 0.06, Math.sin(ph * 0.47) * 0.16, p.tilt);
  setRot(b[B.head], Math.sin(ph * 0.61) * 0.07, Math.sin(ph * 0.31) * 0.13, p.tilt * 0.8 + Math.sin(ph * 0.5) * 0.06);
  setRot(b[B.jaw], -0.28 - Math.max(0, Math.sin(ph * 1.3)) * 0.14, 0, 0);

  for (const s of SIDES) {
    const sign = s === 'L' ? 1 : -1;
    // The right side carries the limp: reduced swing plus a dragged, stiff knee.
    const dragged = s === 'R' ? p.limp : 0;
    const legPh = ph + (s === 'R' ? Math.PI : 0);
    const swingScale = (1 - dragged * 0.62) * amp;

    const thigh = -Math.sin(legPh) * 0.6 * swingScale - 0.05 - dragged * 0.12;
    const knee = Math.max(0, Math.sin(legPh + 1.15)) * 0.95 * (1 - dragged * 0.7) + 0.09 + dragged * 0.3;
    setRot(b[B[`thigh${s}`]], thigh, 0, 0.09 * sign + dragged * 0.18 * sign);
    setRot(b[B[`shin${s}`]], knee, 0, 0);
    setRot(b[B[`foot${s}`]], -knee * 0.42 + 0.06 + dragged * 0.2, 0, 0);

    // Arms hang and swing out of phase with the legs, elbows half bent, hands
    // clawed. Not a soldier's arm swing - dead weight with momentum.
    const armPh = ph + (s === 'L' ? Math.PI : 0);
    setRot(b[B[`armUpper${s}`]], -0.34 + Math.sin(armPh + 0.4) * 0.26 * amp, 0, 0.19 * sign + Math.sin(armPh) * 0.05 * sign);
    setRot(b[B[`armLower${s}`]], -0.58 - Math.sin(armPh + 0.9) * 0.2 * amp, 0, 0);
    setRot(b[B[`hand${s}`]], -0.42, 0, 0.22 * sign);
    setRot(b[B[`shoulder${s}`]], 0, 0, sway * 0.05 * sign);
  }
}

export { damp };
