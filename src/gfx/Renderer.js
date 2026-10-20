import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  VignetteEffect,
  NoiseEffect,
  ToneMappingEffect,
  ToneMappingMode,
  BlendFunction,
  Effect,
  SMAAEffect,
  SMAAPreset,
  EdgeDetectionMode,
  DepthOfFieldEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { SSRPass } from './ssr.js';

// Correzione colore leggera, applicata prima del tone mapping: esposizione, saturazione, tinta.
const gradeFrag = /* glsl */ `
uniform float exposure;
uniform float saturation;
uniform vec3 tint;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb * exposure * tint;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  outputColor = vec4(max(c, 0.0), inputColor.a);
}`;

class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', gradeFrag, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map([
        ['exposure', new THREE.Uniform(1)],
        ['saturation', new THREE.Uniform(1)],
        ['tint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
      ]),
    });
  }
}

// Rete di sicurezza: un pixel NaN/Inf, diffuso dal bloom, annerirebbe l'intero schermo.
class SanitizeEffect extends Effect {
  constructor() {
    super(
      'SanitizeEffect',
      /* glsl */ `
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  bvec3 bad = bvec3(isnan(c.r) || isinf(c.r), isnan(c.g) || isinf(c.g), isnan(c.b) || isinf(c.b));
  if (any(bad)) c = vec3(0.0);
  outputColor = vec4(min(c, vec3(64.0)), inputColor.a);
}`,
      { blendFunction: BlendFunction.SRC },
    );
  }
}

// Livelli di qualità: il QualityManager scende/sale in base al tempo di frame medio.
// ao: occlusione ambientale (0 spenta, 1 a mezza risoluzione, 2 piena)
// ssr: riflessi con ray tracing nello spazio dello schermo (0 spenti, 1 a mezza risoluzione, 2 piena);
// ssrSteps: passi massimi di ogni raggio
// shadow: lato della mappa d'ombra del sole. Antialiasing: SMAA (l'MSAA non va d'accordo con l'AO).
const LEVELS = [
  { name: 'low', pixelRatio: 0.75, bloomLevels: 5, ao: 0, ssr: 0, ssrSteps: 0, shadow: 1024, dof: false, smaa: SMAAPreset.LOW },
  { name: 'medium', pixelRatio: 1.0, bloomLevels: 6, ao: 1, ssr: 1, ssrSteps: 40, shadow: 2048, dof: false, smaa: SMAAPreset.MEDIUM },
  { name: 'high', pixelRatio: 1.0, bloomLevels: 7, ao: 1, ssr: 2, ssrSteps: 80, shadow: 2048, dof: true, smaa: SMAAPreset.HIGH },
  { name: 'ultra', pixelRatio: 1.5, bloomLevels: 8, ao: 2, ssr: 2, ssrSteps: 96, shadow: 4096, dof: true, smaa: SMAAPreset.ULTRA },
];

// Occlusione ambientale e riflessi: valori di base, ogni mondo li adatta alla sua scala (world.post)
const DEFAULT_AO = { radius: 2.5, falloff: 1.0, intensity: 2.2, color: 0x000000 };
const DEFAULT_SSR = { intensity: 1, maxDistance: 120, thickness: 0.6 };
// Profondità di campo da macro (si è piccoli dentro un orologio): fuoco automatico su ciò che si
// guarda; range = frazione della distanza di fuoco entro cui lo sfocato arriva al massimo
const DEFAULT_DOF = { scale: 2, range: 1.6 };

const DEFAULT_POST = {
  bloom: 0.75,
  bloomThreshold: 0.82,
  bloomSmoothing: 0.25,
  bloomRadius: 0.72,
  exposure: 1.0,
  saturation: 1.0,
  tint: [1, 1, 1],
  vignette: 0.6,
  vignetteOffset: 0.3,
  grain: 0.085,
  // Khronos PBR Neutral: mantiene fedeli i colori reali dei quadranti (foto e materiali)
  toneMapping: ToneMappingMode.NEUTRAL,
};

export class Renderer {
  constructor(canvas, { quality = 'auto', preserve = false } = {}) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: preserve, // solo in debug, per catture di schermo
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 1);
    renderer.info.autoReset = false;
    // ombre del sole (vedi gfx/shadows.js): PCF con filtro morbido a disco di Vogel
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 3000);
    this.camera.rotation.order = 'YXZ';

    const maxDpr = Math.min(window.devicePixelRatio || 1, 2);
    this.maxPixelRatio = maxDpr;
    this.autoQuality = quality === 'auto';
    // in automatico si parte da "medium" (senza MSAA): primo impatto fluido anche su GPU integrate,
    // poi la qualità sale da sola in pochi secondi se c'è margine
    const startLevel = quality === 'auto' ? 1 : Math.max(0, LEVELS.findIndex((l) => l.name === quality));
    this.levelIndex = startLevel;

    const level = LEVELS[this.levelIndex];
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(new THREE.Scene(), this.camera);
    // occlusione ambientale con raggi nel buffer di profondità (N8AO); le trasparenze non occludono
    this.aoPass = new N8AOPostPass(new THREE.Scene(), this.camera, 1, 1);
    this.aoPass.autoDetectTransparency = false; // altrimenti ridisegna due volte ogni oggetto trasparente
    this.aoPass.configuration.gammaCorrection = false;
    this.aoPass.configuration.halfRes = level.ao === 1;
    this.aoPass.enabled = level.ao > 0;
    // riflessi con ray tracing nello spazio dello schermo
    this.ssrPass = new SSRPass(this.camera);
    this.ssrPass.halfRes = level.ssr !== 2;
    this.ssrPass.steps = level.ssrSteps;
    this.ssrPass.enabled = level.ssr > 0;
    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: DEFAULT_POST.bloomThreshold,
      luminanceSmoothing: DEFAULT_POST.bloomSmoothing,
      intensity: DEFAULT_POST.bloom,
      radius: DEFAULT_POST.bloomRadius,
      levels: level.bloomLevels,
    });
    this.grade = new GradeEffect();
    this.tone = new ToneMappingEffect({ mode: DEFAULT_POST.toneMapping });
    this.vignette = new VignetteEffect({ offset: DEFAULT_POST.vignetteOffset, darkness: DEFAULT_POST.vignette });
    this.noise = new NoiseEffect({ premultiply: false, blendFunction: BlendFunction.OVERLAY });
    this.noise.blendMode.opacity.value = DEFAULT_POST.grain;
    // antialiasing sull'immagine già tonemappata, prima di vignettatura e grana
    this.smaa = new SMAAEffect({ preset: level.smaa, edgeDetectionMode: EdgeDetectionMode.COLOR });
    this.effectPass = new EffectPass(this.camera, this.bloom, this.grade, this.tone);
    this.finalPass = new EffectPass(this.camera, this.smaa, this.vignette, this.noise);
    this.sanitizePass = new EffectPass(this.camera, new SanitizeEffect());
    // profondità di campo prima del bloom: le luci sfocate diventano dischi morbidi (bokeh)
    this.dof = new DepthOfFieldEffect(this.camera, { focusDistance: 30, focusRange: 40, bokehScale: DEFAULT_DOF.scale, resolutionScale: 0.5 });
    this.dofPass = new EffectPass(this.camera, this.dof);
    this.dofParams = { ...DEFAULT_DOF };
    this.dofEnabledByWorld = true;
    this.focus = 30;
    this.focusOverride = null; // distanza di fuoco fissata da un mondo (null = autofocus)
    this.focusRangeOverride = null;
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.aoPass);
    this.composer.addPass(this.ssrPass);
    this.composer.addPass(this.sanitizePass);
    this.composer.addPass(this.dofPass);
    this.composer.addPass(this.effectPass);
    this.composer.addPass(this.finalPass);
    this.ssrEnabledByWorld = true;
    this.dofPass.enabled = level.dof;
    this.ssrPass.focusProbe = level.dof;

    // Parametri di post correnti e obiettivo (interpolati per transizioni morbide tra mondi)
    this.post = { ...DEFAULT_POST, tint: [...DEFAULT_POST.tint] };
    this.postTarget = { ...DEFAULT_POST, tint: [...DEFAULT_POST.tint] };
    this.postOverride = null; // es. il passaggio giorno → notte di Celeste

    this.frameTimes = [];
    this.qualityCooldown = 3;
    this.width = 1;
    this.height = 1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get level() {
    return LEVELS[this.levelIndex];
  }

  resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.width = w;
    this.height = h;
    const pr = Math.min(this.level.pixelRatio, this.maxPixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setLevel(index) {
    index = THREE.MathUtils.clamp(index, 0, LEVELS.length - 1);
    if (index === this.levelIndex) return;
    this.levelIndex = index;
    this.applyLevel();
    this.resize();
  }

  applyLevel() {
    const level = this.level;
    this.bloom.mipmapBlurPass.levels = level.bloomLevels;
    this.smaa.applyPreset(level.smaa);
    this.aoPass.enabled = level.ao > 0;
    if (level.ao > 0 && this.aoPass.configuration.halfRes !== (level.ao === 1)) this.aoPass.configuration.halfRes = level.ao === 1;
    this.ssrPass.enabled = level.ssr > 0 && this.ssrEnabledByWorld;
    this.ssrPass.setHalfRes(level.ssr !== 2);
    this.ssrPass.steps = level.ssrSteps;
    this.updateDofEnabled();
  }

  // l'autofocus legge la profondità dal G-buffer dei riflessi: senza riflessi niente profondità di campo
  updateDofEnabled() {
    const on = this.level.dof && this.dofEnabledByWorld && this.ssrPass.enabled;
    this.dofPass.enabled = on;
    this.ssrPass.focusProbe = on;
  }

  // Abbassa la qualità se il frame medio supera ~18,5 ms (sotto i 54 fps); la rialza con margine
  // (sotto i 13,3 ms), fino a "ultra". Un livello appena abbandonato perché lento non si riprova
  // per un po': niente altalena tra due livelli.
  updateQuality(dt) {
    if (!this.autoQuality) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    this.qualityCooldown -= dt;
    this.qualityClock = (this.qualityClock || 0) + dt;
    if (this.qualityCooldown > 0 || this.frameTimes.length < 60) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.levelBlockedUntil ||= [];
    if (avg > 1 / 54 && this.levelIndex > 0) {
      this.levelBlockedUntil[this.levelIndex] = this.qualityClock + 45;
      this.setLevel(this.levelIndex - 1);
      this.qualityCooldown = 2.5;
      this.frameTimes.length = 0;
    } else if (avg < 1 / 75 && this.levelIndex < LEVELS.length - 1 && !(this.levelBlockedUntil[this.levelIndex + 1] > this.qualityClock)) {
      this.setLevel(this.levelIndex + 1);
      this.qualityCooldown = 6;
      this.frameTimes.length = 0;
    }
  }

  setPost(params = {}, immediate = false) {
    Object.assign(this.postTarget, DEFAULT_POST, params);
    this.postTarget.tint = [...(params.tint || DEFAULT_POST.tint)];
    if (this.tone.mode !== this.postTarget.toneMapping) this.tone.mode = this.postTarget.toneMapping;
    if (immediate) {
      Object.assign(this.post, this.postTarget);
      this.post.tint = [...this.postTarget.tint];
    }
    // occlusione e riflessi alla scala del mondo
    const ao = { ...DEFAULT_AO, ...(params.ao || {}) };
    const c = this.aoPass.configuration;
    c.aoRadius = ao.radius;
    c.distanceFalloff = ao.falloff;
    c.intensity = ao.intensity;
    c.color = new THREE.Color(ao.color);
    const ssr = params.ssr === false ? { ...DEFAULT_SSR, intensity: 0 } : { ...DEFAULT_SSR, ...(params.ssr || {}) };
    this.ssrPass.configure(ssr);
    this.ssrEnabledByWorld = ssr.intensity > 0;
    this.ssrPass.enabled = this.level.ssr > 0 && this.ssrEnabledByWorld;
    this.dofEnabledByWorld = params.dof !== false;
    this.dofParams = { ...DEFAULT_DOF, ...(params.dof || {}) };
    this.updateDofEnabled();
  }

  applyPost(dt) {
    const k = 1 - Math.exp(-dt * 2.5);
    const target = this.postOverride ? { ...this.postTarget, ...this.postOverride } : this.postTarget;
    for (const key of ['bloom', 'bloomThreshold', 'bloomSmoothing', 'bloomRadius', 'exposure', 'saturation', 'vignette', 'vignetteOffset', 'grain']) {
      this.post[key] += (target[key] - this.post[key]) * k;
    }
    const tt = target.tint || [1, 1, 1];
    for (let i = 0; i < 3; i++) this.post.tint[i] += (tt[i] - this.post.tint[i]) * k;

    const p = this.post;
    this.bloom.intensity = p.bloom;
    this.bloom.luminanceMaterial.threshold = p.bloomThreshold;
    this.bloom.luminanceMaterial.smoothing = p.bloomSmoothing;
    this.bloom.mipmapBlurPass.radius = p.bloomRadius;
    this.grade.uniforms.get('exposure').value = p.exposure;
    this.grade.uniforms.get('saturation').value = p.saturation;
    this.grade.uniforms.get('tint').value.set(p.tint[0], p.tint[1], p.tint[2]);
    this.vignette.darkness = p.vignette;
    this.vignette.offset = p.vignetteOffset;
    this.noise.blendMode.opacity.value = p.grain;
  }

  render(scene, dt) {
    this.renderPass.mainScene = scene;
    this.aoPass.scene = scene;
    this.ssrPass.worldScene = scene;
    // la scatola delle ombre segue la camera (scene.userData.shadow: vedi gfx/shadows.js)
    const shadow = scene.userData.shadow;
    if (shadow) {
      shadow.setSize(this.level.shadow);
      shadow.update(this.camera);
    }
    // autofocus: la distanza al centro dello schermo (sonda nel passo dei riflessi), inseguita con
    // dolcezza come una lente che mette a fuoco
    if (this.dofPass.enabled) {
      // un mondo può fissare il fuoco (il laboratorio, quando la camera torna grande)
      const target = this.focusOverride ?? Math.min(this.ssrPass.focusDistance, 400);
      this.focus += (target - this.focus) * (1 - Math.exp(-Math.min(dt, 0.1) * 3.5));
      const coc = this.dof.cocMaterial;
      coc.focusDistance = this.focus;
      // un minimo di profondità nitida: guardando il pavimento vicino il mondo resta leggibile
      coc.focusRange = this.focusRangeOverride ?? this.focus * this.dofParams.range + 5;
      this.dof.bokehScale = this.dofParams.scale;
    }
    this.applyPost(dt);
    this.renderer.info.reset();
    this.composer.render(dt);
  }

  // Precompila gli shader di una scena per evitare scatti al primo ingresso.
  async precompile(scene) {
    try {
      if (this.renderer.compileAsync) await this.renderer.compileAsync(scene, this.camera);
      else this.renderer.compile(scene, this.camera);
    } catch (e) {
      // la compilazione anticipata è un'ottimizzazione: in caso di errore si compila al primo frame
    }
  }
}
