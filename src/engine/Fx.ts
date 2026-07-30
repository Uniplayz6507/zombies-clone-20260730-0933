import * as THREE from 'three';
import type { SpriteLib } from '../procgen/textures/sprites';
import { Rng } from '../util/rng';

/**
 * All transient visual effects, pooled and instanced.
 *
 * Everything is allocated at load and recycled forever - not one object is
 * created while a wave is running. The whole system costs six draw calls:
 *
 *   1. tracers        InstancedMesh, additive ribbons
 *   2. bullet holes   InstancedMesh, alpha decals
 *   3. blood decals   InstancedMesh, alpha decals
 *   4. sparks         Points, additive
 *   5. blood mist     Points, additive
 *   6. spent casings  InstancedMesh
 *
 * The Points systems fade by darkening their vertex colour. Under additive
 * blending black is invisible, so that doubles as an alpha fade without needing a
 * custom shader or a per-particle opacity attribute.
 */

const TRACERS = 40;
const HOLES = 64;
const SPLATS = 48;
const SPARKS = 220;
const MIST = 180;
const CASINGS = 20;

interface Tracer {
  life: number;
  maxLife: number;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

interface Decal {
  life: number;
  maxLife: number;
  matrix: THREE.Matrix4;
}

interface Particle {
  life: number;
  maxLife: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  drag: number;
  r: number;
  g: number;
  b: number;
}

interface Casing {
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  spin: number;
}

interface PointSystem {
  points: THREE.Points;
  positions: Float32Array;
  colors: Float32Array;
  pool: Particle[];
}

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3(0, 0, 1);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0).setPosition(0, -1000, 0);

function makePointSystem(texture: THREE.Texture, count: number, size: number, gravity: number, drag: number, life: number): PointSystem {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) positions[i * 3 + 1] = -1000;
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mat = new THREE.PointsMaterial({
    map: texture,
    size,
    sizeAttenuation: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  const pool: Particle[] = [];
  for (let i = 0; i < count; i++) {
    pool.push({ life: 0, maxLife: life, x: 0, y: -1000, z: 0, vx: 0, vy: 0, vz: 0, gravity, drag, r: 1, g: 1, b: 1 });
  }
  return { points, positions, colors, pool };
}

export class Fx {
  private readonly root = new THREE.Group();
  private readonly rng = new Rng(0xfeed);

  private readonly tracers: Tracer[] = [];
  private readonly tracerMesh: THREE.InstancedMesh;

  private readonly holes: Decal[] = [];
  private readonly holeMesh: THREE.InstancedMesh;
  private holeCursor = 0;

  private readonly splats: Decal[] = [];
  private readonly splatMesh: THREE.InstancedMesh;
  private splatCursor = 0;

  private readonly sparks: PointSystem;
  private readonly mist: PointSystem;

  private readonly casings: Casing[] = [];
  private readonly casingMesh: THREE.InstancedMesh;
  private casingCursor = 0;

  constructor(scene: THREE.Object3D, sprites: SpriteLib) {
    this.root.name = 'fx';
    scene.add(this.root);

    // --- Tracers ----------------------------------------------------------
    const tracerGeo = new THREE.PlaneGeometry(1, 1);
    const tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffd9a0,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.tracerMesh = new THREE.InstancedMesh(tracerGeo, tracerMat, TRACERS);
    this.tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracerMesh.frustumCulled = false;
    this.root.add(this.tracerMesh);
    for (let i = 0; i < TRACERS; i++) {
      this.tracers.push({ life: 0, maxLife: 0.055, x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0 });
      this.tracerMesh.setMatrixAt(i, HIDDEN);
    }

    // --- Bullet holes -----------------------------------------------------
    const holeMat = new THREE.MeshBasicMaterial({
      map: sprites.bulletHole,
      transparent: true,
      depthWrite: false,
      // Bias decals toward the camera so they never z-fight the wall behind.
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    this.holeMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), holeMat, HOLES);
    this.holeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.holeMesh.frustumCulled = false;
    this.holeMesh.renderOrder = 2;
    this.root.add(this.holeMesh);
    for (let i = 0; i < HOLES; i++) {
      this.holes.push({ life: 0, maxLife: 26, matrix: new THREE.Matrix4() });
      this.holeMesh.setMatrixAt(i, HIDDEN);
    }

    // --- Blood decals -----------------------------------------------------
    const splatMat = new THREE.MeshBasicMaterial({
      map: sprites.bloodSplat,
      transparent: true,
      depthWrite: false,
      color: 0x8c1512,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    this.splatMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), splatMat, SPLATS);
    this.splatMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.splatMesh.frustumCulled = false;
    this.splatMesh.renderOrder = 2;
    this.root.add(this.splatMesh);
    for (let i = 0; i < SPLATS; i++) {
      this.splats.push({ life: 0, maxLife: 34, matrix: new THREE.Matrix4() });
      this.splatMesh.setMatrixAt(i, HIDDEN);
    }

    // --- Particles --------------------------------------------------------
    this.sparks = makePointSystem(sprites.spark, SPARKS, 0.055, 9, 2.2, 0.42);
    this.mist = makePointSystem(sprites.bloodMist, MIST, 0.15, 5, 3.6, 0.75);
    this.root.add(this.sparks.points, this.mist.points);

    // --- Spent casings ----------------------------------------------------
    const casingMat = new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 0.9, roughness: 0.35 });
    this.casingMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.005, 0.0055, 0.019, 6), casingMat, CASINGS);
    this.casingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.casingMesh.frustumCulled = false;
    this.root.add(this.casingMesh);
    for (let i = 0; i < CASINGS; i++) {
      this.casings.push({ life: 0, x: 0, y: -1000, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, spin: 0 });
      this.casingMesh.setMatrixAt(i, HIDDEN);
    }
  }

  // -----------------------------------------------------------------------
  // Spawners
  // -----------------------------------------------------------------------

  tracer(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    for (const t of this.tracers) {
      if (t.life > 0) continue;
      t.life = t.maxLife;
      t.x0 = x0;
      t.y0 = y0;
      t.z0 = z0;
      t.x1 = x1;
      t.y1 = y1;
      t.z1 = z1;
      return;
    }
  }

  /** Bullet hole plus a spray of sparks and grit off a hard surface. */
  impact(x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
    // Cycle decals rather than searching for a free one: the oldest is always the
    // right one to replace, and it is O(1).
    const d = this.holes[this.holeCursor];
    this.holeCursor = (this.holeCursor + 1) % HOLES;
    d.life = d.maxLife;
    _v.set(x + nx * 0.012, y + ny * 0.012, z + nz * 0.012);
    _dir.set(nx, ny, nz);
    if (_dir.lengthSq() < 1e-6) _dir.copy(_up);
    else _dir.normalize();
    _q.setFromUnitVectors(_fwd, _dir);
    const size = this.rng.float(0.1, 0.17);
    _s.set(size, size, size);
    d.matrix.compose(_v, _q, _s);

    for (let i = 0; i < 5; i++) this.emit(this.sparks, x, y, z, nx, ny, nz, 3.4, 1, 0.85, 0.45);
  }

  /** Blood mist off a body hit, plus a splat on the ground for heavy hits. */
  blood(x: number, y: number, z: number, dx: number, dy: number, dz: number, heavy: boolean): void {
    const count = heavy ? 12 : 6;
    for (let i = 0; i < count; i++) {
      // Spray continues along the bullet's direction, not back at the shooter.
      this.emit(this.mist, x, y, z, dx, dy + 0.35, dz, heavy ? 3.2 : 2.1, 0.85, 0.12, 0.1);
    }
    if (!heavy) return;
    const d = this.splats[this.splatCursor];
    this.splatCursor = (this.splatCursor + 1) % SPLATS;
    d.life = d.maxLife;
    _v.set(x + this.rng.jitter(0.3), 0.015, z + this.rng.jitter(0.3));
    _e.set(-Math.PI / 2, 0, this.rng.float(0, Math.PI * 2));
    _q.setFromEuler(_e);
    const size = this.rng.float(0.6, 1.1);
    _s.set(size, size, size);
    d.matrix.compose(_v, _q, _s);
  }

  /** Smoke and grit off the muzzle. */
  muzzleDebris(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    for (let i = 0; i < 3; i++) this.emit(this.sparks, x, y, z, dx, dy, dz, 2.4, 1, 0.72, 0.3);
  }

  ejectCasing(x: number, y: number, z: number, rightX: number, rightZ: number): void {
    const c = this.casings[this.casingCursor];
    this.casingCursor = (this.casingCursor + 1) % CASINGS;
    c.life = 3.2;
    c.x = x;
    c.y = y;
    c.z = z;
    c.vx = rightX * this.rng.float(1.6, 2.6) + this.rng.jitter(0.4);
    c.vy = this.rng.float(1.4, 2.4);
    c.vz = rightZ * this.rng.float(1.6, 2.6) + this.rng.jitter(0.4);
    c.rx = this.rng.float(0, 6.28);
    c.ry = this.rng.float(0, 6.28);
    c.spin = this.rng.float(9, 19);
  }

  private emit(
    sys: PointSystem,
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    speed: number,
    r: number,
    g: number,
    b: number,
  ): void {
    const pool = sys.pool;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (p.life > 0) continue;
      p.life = p.maxLife * this.rng.float(0.6, 1.2);
      p.x = x;
      p.y = y;
      p.z = z;
      const spread = 0.75;
      p.vx = (dx + this.rng.jitter(spread)) * speed * this.rng.float(0.4, 1.2);
      p.vy = (dy + this.rng.jitter(spread)) * speed * this.rng.float(0.4, 1.2);
      p.vz = (dz + this.rng.jitter(spread)) * speed * this.rng.float(0.4, 1.2);
      p.r = r;
      p.g = g;
      p.b = b;
      return;
    }
  }

  // -----------------------------------------------------------------------
  // Update
  // -----------------------------------------------------------------------

  update(dt: number): void {
    // --- Tracers: stretch a ribbon along the flight path -------------------
    let dirty = false;
    for (let i = 0; i < TRACERS; i++) {
      const t = this.tracers[i];
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) {
        this.tracerMesh.setMatrixAt(i, HIDDEN);
        dirty = true;
        continue;
      }
      const dx = t.x1 - t.x0;
      const dy = t.y1 - t.y0;
      const dz = t.z1 - t.z0;
      const len = Math.hypot(dx, dy, dz) || 0.001;
      _v.set((t.x0 + t.x1) / 2, (t.y0 + t.y1) / 2, (t.z0 + t.z1) / 2);
      // Orient the quad's +Y along the flight path.
      _dir.set(dx / len, dy / len, dz / len);
      _q.setFromUnitVectors(_up, _dir);
      const fade = t.life / t.maxLife;
      _s.set(0.035 * fade + 0.012, len, 1);
      _m.compose(_v, _q, _s);
      this.tracerMesh.setMatrixAt(i, _m);
      dirty = true;
    }
    if (dirty) this.tracerMesh.instanceMatrix.needsUpdate = true;

    // --- Decals: long-lived, only rewritten as they expire ----------------
    let holesDirty = false;
    for (let i = 0; i < HOLES; i++) {
      const d = this.holes[i];
      if (d.life <= 0) continue;
      d.life -= dt;
      this.holeMesh.setMatrixAt(i, d.life > 0 ? d.matrix : HIDDEN);
      holesDirty = true;
    }
    if (holesDirty) this.holeMesh.instanceMatrix.needsUpdate = true;

    let splatsDirty = false;
    for (let i = 0; i < SPLATS; i++) {
      const d = this.splats[i];
      if (d.life <= 0) continue;
      d.life -= dt;
      this.splatMesh.setMatrixAt(i, d.life > 0 ? d.matrix : HIDDEN);
      splatsDirty = true;
    }
    if (splatsDirty) this.splatMesh.instanceMatrix.needsUpdate = true;

    this.stepParticles(this.sparks, dt);
    this.stepParticles(this.mist, dt);

    // --- Casings ----------------------------------------------------------
    let casingsDirty = false;
    for (let i = 0; i < CASINGS; i++) {
      const c = this.casings[i];
      if (c.life <= 0) continue;
      c.life -= dt;
      if (c.life <= 0) {
        this.casingMesh.setMatrixAt(i, HIDDEN);
        casingsDirty = true;
        continue;
      }
      c.vy -= 15 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.z += c.vz * dt;
      c.rx += c.spin * dt;
      c.ry += c.spin * 0.6 * dt;
      // One bounce, then friction. The little skitter is a surprisingly large
      // part of how good shooting feels.
      if (c.y < 0.008) {
        c.y = 0.008;
        c.vy = Math.abs(c.vy) * 0.32;
        c.vx *= 0.55;
        c.vz *= 0.55;
        c.spin *= 0.5;
      }
      _v.set(c.x, c.y, c.z);
      _e.set(c.rx, c.ry, 0.4);
      _q.setFromEuler(_e);
      _s.set(1, 1, 1);
      _m.compose(_v, _q, _s);
      this.casingMesh.setMatrixAt(i, _m);
      casingsDirty = true;
    }
    if (casingsDirty) this.casingMesh.instanceMatrix.needsUpdate = true;
  }

  private stepParticles(sys: PointSystem, dt: number): void {
    let dirty = false;
    const { pool, positions, colors } = sys;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      const o = i * 3;
      if (p.life <= 0) {
        positions[o + 1] = -1000;
        colors[o] = 0;
        colors[o + 1] = 0;
        colors[o + 2] = 0;
        dirty = true;
        continue;
      }
      const dragK = 1 - Math.min(0.95, p.drag * dt);
      p.vx *= dragK;
      p.vz *= dragK;
      p.vy = p.vy * dragK - p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.01) {
        p.y = 0.01;
        p.vy = 0;
        p.vx *= 0.5;
        p.vz *= 0.5;
      }
      positions[o] = p.x;
      positions[o + 1] = p.y;
      positions[o + 2] = p.z;
      // Additive blending means darkening IS fading. No alpha attribute needed.
      const fade = p.life / p.maxLife;
      colors[o] = p.r * fade;
      colors[o + 1] = p.g * fade;
      colors[o + 2] = p.b * fade;
      dirty = true;
    }
    if (dirty) {
      (sys.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (sys.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  clear(): void {
    for (const t of this.tracers) t.life = 0;
    for (const d of this.holes) d.life = 0;
    for (const d of this.splats) d.life = 0;
    for (const c of this.casings) c.life = 0;
    for (const sys of [this.sparks, this.mist]) {
      for (let i = 0; i < sys.pool.length; i++) {
        sys.pool[i].life = 0;
        sys.positions[i * 3 + 1] = -1000;
        sys.colors[i * 3] = 0;
        sys.colors[i * 3 + 1] = 0;
        sys.colors[i * 3 + 2] = 0;
      }
      (sys.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (sys.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }
    for (let i = 0; i < TRACERS; i++) this.tracerMesh.setMatrixAt(i, HIDDEN);
    for (let i = 0; i < HOLES; i++) this.holeMesh.setMatrixAt(i, HIDDEN);
    for (let i = 0; i < SPLATS; i++) this.splatMesh.setMatrixAt(i, HIDDEN);
    for (let i = 0; i < CASINGS; i++) this.casingMesh.setMatrixAt(i, HIDDEN);
    this.tracerMesh.instanceMatrix.needsUpdate = true;
    this.holeMesh.instanceMatrix.needsUpdate = true;
    this.splatMesh.instanceMatrix.needsUpdate = true;
    this.casingMesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.tracerMesh, this.holeMesh, this.splatMesh, this.casingMesh]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    for (const sys of [this.sparks, this.mist]) {
      sys.points.geometry.dispose();
      (sys.points.material as THREE.Material).dispose();
    }
    this.root.removeFromParent();
  }
}
