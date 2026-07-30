import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { QualityPreset } from '../types';

/**
 * Owns the WebGL context, the post chain, and everything resolution related.
 *
 * The most important lines in this file are the tone mapping and colour space
 * setup. Realism in Three.js is roughly 70% "filmic tone mapping with physically
 * scaled lights in the correct colour space" and 30% asset quality. Get that
 * wrong and no amount of texture work saves the image.
 *
 * Post chain: RenderPass -> Bloom -> Grade -> SMAA -> OutputPass.
 *
 * Note on tone mapping and the composer: Three disables per-material tone mapping
 * whenever it renders into a render target, so RenderPass produces linear HDR.
 * Bloom therefore thresholds genuine HDR values (which is why emissives bloom and
 * lit walls do not), and OutputPass applies ACES + sRGB exactly once at the end.
 * Any other arrangement double-tone-maps the frame.
 */

export interface QualityProfile {
  renderScale: number;
  shadowMapSize: number;
  shadows: boolean;
  bloom: boolean;
  smaa: boolean;
  anisotropy: number;
  /** Zombies animated at full rate before distance frameskip kicks in. */
  animBudget: number;
}

export const PROFILES: Record<QualityPreset, QualityProfile> = {
  low: { renderScale: 0.72, shadowMapSize: 1024, shadows: true, bloom: false, smaa: false, anisotropy: 1, animBudget: 6 },
  medium: { renderScale: 0.9, shadowMapSize: 2048, shadows: true, bloom: true, smaa: true, anisotropy: 4, animBudget: 10 },
  high: { renderScale: 1, shadowMapSize: 2048, shadows: true, bloom: true, smaa: true, anisotropy: 8, animBudget: 16 },
};

/**
 * Final grade: chromatic aberration, vignette, desaturation, film grain and the
 * damage tint. One full-screen pass doing five things, because each additional
 * pass at 1080p costs 0.4-1.2ms on integrated graphics.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.035 },
    uDesat: { value: 0.12 },
    uAberration: { value: 0.0022 },
    /** 0-1, spikes when the player is hit. */
    uDamage: { value: 0 },
    /** 0-1, rises as health drops. */
    uCritical: { value: 0 },
  },
  vertexShader: [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}',
  ].join('\n'),
  fragmentShader: [
    'uniform sampler2D tDiffuse;',
    'uniform float uTime;',
    'uniform float uVignette;',
    'uniform float uGrain;',
    'uniform float uDesat;',
    'uniform float uAberration;',
    'uniform float uDamage;',
    'uniform float uCritical;',
    'varying vec2 vUv;',
    '',
    'void main() {',
    '  vec2 c = vUv - 0.5;',
    '  float r2 = dot(c, c);',
    '',
    '  // Lateral chromatic aberration, scaled by radius so the centre stays clean.',
    '  float ab = uAberration * r2 * 8.0;',
    '  vec3 col;',
    '  col.r = texture2D(tDiffuse, vUv + c * ab).r;',
    '  col.g = texture2D(tDiffuse, vUv).g;',
    '  col.b = texture2D(tDiffuse, vUv - c * ab).b;',
    '',
    '  col *= 1.0 - uVignette * r2 * 1.7;',
    '',
    '  // Damage: blood pushes in from the edges of the frame.',
    '  float edge = clamp((uDamage + uCritical * 0.55) * r2 * 3.4, 0.0, 1.0);',
    '  col = mix(col, vec3(col.r * 1.5 + 0.02, col.g * 0.22, col.b * 0.22), edge);',
    '',
    '  // Low health also drains colour from the whole image.',
    '  float lum = dot(col, vec3(0.299, 0.587, 0.114));',
    '  col = mix(col, vec3(lum), clamp(uDesat + uCritical * 0.35, 0.0, 1.0));',
    '',
    '  // Animated grain.',
    '  float n = fract(sin(dot(vUv + fract(uTime), vec2(12.9898, 78.233))) * 43758.5453);',
    '  col += (n - 0.5) * uGrain;',
    '',
    '  gl_FragColor = vec4(col, 1.0);',
    '}',
  ].join('\n'),
};

/**
 * Procedural environment map.
 *
 * Real-time global illumination is not achievable in WebGL at 60fps, so this is
 * how the scene gets believable ambient response: a small gradient sky plus a few
 * emissive panels, convolved by PMREMGenerator into a proper irradiance and
 * specular cube that every PBR material samples. Cost: one bake at load, then
 * nothing at all.
 */
function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const envScene = new THREE.Scene();
  const trash: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = [];

  // Night sky gradient: cold zenith, sodium-polluted horizon.
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#0a1220');
  g.addColorStop(0.42, '#16202e');
  g.addColorStop(0.62, '#2c2a26');
  g.addColorStop(0.78, '#4a3520');
  g.addColorStop(1, '#0d0b09');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 128);
  const skyTex = new THREE.CanvasTexture(canvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  trash.push(skyTex);

  const skyGeo = new THREE.SphereGeometry(50, 24, 16);
  const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide });
  trash.push(skyGeo, skyMat);
  envScene.add(new THREE.Mesh(skyGeo, skyMat));

  // Emissive panels standing in for streetlights and lit windows. These are what
  // give wet asphalt and gunmetal something specific to reflect.
  const lamp = (color: number, intensity: number, x: number, y: number, z: number, w: number, h: number) => {
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensity),
      side: THREE.DoubleSide,
    });
    trash.push(geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    envScene.add(m);
  };
  lamp(0xffab4d, 9, 6, 5, -8, 5, 2);
  lamp(0xffab4d, 7, -8, 5, 7, 5, 2);
  lamp(0xcfe6ff, 4, 0, 9, 0, 14, 14);
  lamp(0xff4a6a, 3, -10, 3, -9, 3, 1.5);
  lamp(0x49c9d6, 3, 9, 3, 8, 3, 1.5);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromScene(envScene, 0.035);
  pmrem.dispose();

  for (const t of trash) t.dispose();
  return rt.texture;
}

export class RendererHost {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly environment: THREE.Texture;

  private readonly renderPass: RenderPass;
  private bloomPass: UnrealBloomPass | null = null;
  private readonly gradePass: ShaderPass;
  private smaaPass: SMAAPass | null = null;
  private readonly outputPass: OutputPass;

  private profile: QualityProfile = PROFILES.medium;
  private cssWidth = 1;
  private cssHeight = 1;
  private dpr = 1;
  /** Multiplier applied on top of the preset by auto-degrade. */
  private dynamicScale = 1;
  private degradeStage = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // SMAA in the composer is cheaper than MSAA, and MSAA is wasted anyway once
      // the frame resolves into a render target.
      antialias: false,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });

    // --- The lines that matter most for image quality ---------------------
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;

    this.environment = buildEnvironment(this.renderer);
    this.scene.environment = this.environment;

    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 0,
      depthBuffer: true,
    });
    this.composer = new EffectComposer(this.renderer, target);

    this.renderPass = new RenderPass(scene, camera);
    this.gradePass = new ShaderPass(GradeShader);
    this.outputPass = new OutputPass();

    this.rebuildChain();
  }

  get gradeUniforms(): Record<string, { value: number }> {
    return this.gradePass.uniforms as unknown as Record<string, { value: number }>;
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
    this.renderPass.camera = camera;
  }

  private rebuildChain(): void {
    // Rebuild the pass *list*, not the passes. Toggling a stage must not
    // reallocate render targets.
    this.composer.passes.length = 0;
    this.composer.addPass(this.renderPass);

    if (this.profile.bloom) {
      if (!this.bloomPass) {
        // Threshold above 1.0 so only genuinely bright things bloom: muzzle
        // flashes, lamp lenses, neon, emissive panels. Never a lit wall.
        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(this.cssWidth, this.cssHeight), 0.62, 0.55, 1.05);
      }
      this.composer.addPass(this.bloomPass);
    }

    this.composer.addPass(this.gradePass);

    if (this.profile.smaa) {
      if (!this.smaaPass) this.smaaPass = new SMAAPass(this.cssWidth, this.cssHeight);
      this.composer.addPass(this.smaaPass);
    }

    this.composer.addPass(this.outputPass);
    this.outputPass.renderToScreen = true;
  }

  setQuality(preset: QualityPreset): void {
    this.profile = PROFILES[preset];
    this.dynamicScale = 1;
    this.degradeStage = 0;
    this.renderer.shadowMap.enabled = this.profile.shadows;
    this.rebuildChain();
    this.applySize();
  }

  get quality(): QualityProfile {
    return this.profile;
  }

  setSize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.cssWidth = Math.max(1, cssWidth);
    this.cssHeight = Math.max(1, cssHeight);
    // Cap DPR: a 3x display at native resolution is 9x the fill rate for no
    // perceptible gain in a dark, grainy, film-graded game.
    this.dpr = Math.min(dpr, 2);
    this.applySize();
  }

  private applySize(): void {
    const scale = this.profile.renderScale * this.dynamicScale;
    const w = Math.max(1, Math.floor(this.cssWidth * scale));
    const h = Math.max(1, Math.floor(this.cssHeight * scale));
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    // The canvas element keeps its CSS size; only the backbuffer shrinks.
    const canvas = this.renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    this.composer.setSize(w, h);
    this.bloomPass?.setSize(w, h);
    this.smaaPass?.setSize(w, h);
    this.camera.aspect = this.cssWidth / this.cssHeight;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Staged auto-degrade, in ascending order of visual cost:
   *   bloom -> render scale -> more render scale -> shadows off.
   * Returns a human-readable note the first time each stage trips.
   */
  degrade(): string | null {
    this.degradeStage++;
    switch (this.degradeStage) {
      case 1:
        if (this.profile.bloom) {
          this.profile = { ...this.profile, bloom: false };
          this.rebuildChain();
          return 'Bloom disabled to hold framerate';
        }
        return this.degrade();
      case 2:
        this.dynamicScale = 0.8;
        this.applySize();
        return 'Render resolution reduced to hold framerate';
      case 3:
        this.dynamicScale = 0.66;
        this.applySize();
        return 'Render resolution reduced further';
      case 4:
        this.renderer.shadowMap.enabled = false;
        return 'Shadows disabled to hold framerate';
      default:
        return null;
    }
  }

  render(time: number): void {
    this.gradeUniforms.uTime.value = time;
    this.renderer.info.reset();
    this.composer.render();
  }

  dispose(): void {
    this.bloomPass?.dispose();
    this.smaaPass?.dispose();
    this.gradePass.dispose();
    this.outputPass.dispose();
    this.composer.dispose();
    this.environment.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
