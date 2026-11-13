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

// Livelli di qualità (la qualità adattiva è in updateQuality / tryUpgrade).
// pixelRatio: risoluzione rispetto ai pixel CSS; maxPixels: tetto dei pixel disegnati, in milioni (uno
// schermo Retina o un televisore 4K non moltiplicano il lavoro: 2,1 milioni = Full HD)
// ao: occlusione ambientale (0 spenta, 1 a mezza risoluzione, 2 piena)
// ssr: riflessi con ray tracing nello spazio dello schermo (0 spenti, 1 a mezza risoluzione, 2 piena);
// ssrSteps: passi massimi di ogni raggio
// shadow: lato della mappa d'ombra del sole. Antialiasing: SMAA (l'MSAA non va d'accordo con l'AO).
// Bloom e SMAA sono uguali a tutti i livelli: cambiarli ricompila i loro shader, cioè uno scatto.
const LEVELS = [
  { name: 'low', pixelRatio: 0.75, maxPixels: 1.2, ao: 0, ssr: 0, ssrSteps: 0, shadow: 1024, dof: false },
  { name: 'medium', pixelRatio: 1.0, maxPixels: 2.1, ao: 1, ssr: 1, ssrSteps: 40, shadow: 2048, dof: false },
  { name: 'high', pixelRatio: 1.0, maxPixels: 2.1, ao: 1, ssr: 2, ssrSteps: 80, shadow: 2048, dof: true },
  { name: 'ultra', pixelRatio: 1.5, maxPixels: 4.7, ao: 2, ssr: 2, ssrSteps: 96, shadow: 4096, dof: true },
];
const BLOOM_LEVELS = 7;
const SMAA_PRESET = SMAAPreset.HIGH;

// Qualità adattiva: un fotogramma è "in ritardo" se arriva dopo più di 22 ms (ha perso almeno un giro
// dello schermo a 60 Hz). Si scende se in ritardo è più di un fotogramma su quattro negli ultimi ~1,5 s
// (gli scatti isolati, come la raccolta della memoria, non bastano); si sale solo se nel mondo appena
// lasciato quasi nessun fotogramma era in ritardo, dopo almeno 8 s di gioco.
const LATE_FRAME = 0.022;
const DOWN_LATE_SHARE = 0.25;
const UP_LATE_SHARE = 0.02;
const UP_MIN_SECONDS = 8;

// Sul Mac (scheda video integrata, anche nei MacBook Pro) la qualità automatica non va oltre "high"
const IS_MAC = typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent);

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
  constructor(canvas, { quality = 'auto', maxAuto = null, preserve = false } = {}) {
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
    // in automatico si parte da "medium": primo impatto fluido anche su GPU integrate; la qualità sale
    // poi da sola, a schermo nero tra un mondo e l'altro, se c'è margine (mai oltre maxAutoLevel)
    const startLevel = quality === 'auto' ? 1 : Math.max(0, LEVELS.findIndex((l) => l.name === quality));
    this.levelIndex = startLevel;
    const maxAutoIndex = LEVELS.findIndex((l) => l.name === (maxAuto || (IS_MAC ? 'high' : 'ultra')));
    this.maxAutoLevel = maxAutoIndex < 0 ? LEVELS.length - 1 : maxAutoIndex;
    this.qualityLog = []; // cambi di livello della qualità automatica (per la verifica: monichs.renderer.qualityLog)

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
      levels: BLOOM_LEVELS,
    });
    this.grade = new GradeEffect();
    this.tone = new ToneMappingEffect({ mode: DEFAULT_POST.toneMapping });
    this.vignette = new VignetteEffect({ offset: DEFAULT_POST.vignetteOffset, darkness: DEFAULT_POST.vignette });
    this.noise = new NoiseEffect({ premultiply: false, blendFunction: BlendFunction.OVERLAY });
    this.noise.blendMode.opacity.value = DEFAULT_POST.grain;
    // antialiasing sull'immagine già tonemappata, prima di vignettatura e grana
    this.smaa = new SMAAEffect({ preset: SMAA_PRESET, edgeDetectionMode: EdgeDetectionMode.COLOR });
    this.effectPass = new EffectPass(this.camera, this.bloom, this.grade, this.tone);
    this.finalPass = new EffectPass(this.camera, this.smaa, this.vignette, this.noise);
    this.sanitizePass = new EffectPass(this.camera, new SanitizeEffect());
    // profondità di campo prima del bloom: le luci sfocate diventano dischi morbidi (bokeh)
    this.dof = new DepthOfFieldEffect(this.camera, { focusDistance: 30, focusRange: 40, bokehScale: DEFAULT_DOF.scale, resolutionScale: 0.5 });
    this.dofPass = new EffectPass(this.camera, this.dof);
    this.dofParams = { ...DEFAULT_DOF };
    this.dofEnabledByWorld = true;
    this.focus = 30;
    this.focusOverride = null; // distanza di fuoco fissata da fuori, come nelle riprese del trailer (null = autofocus)
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
    this.levelBlocked = []; // livelli abbandonati perché lenti: non si riprovano più (niente altalena)
    this.worldStats = { time: 0, frames: 0, late: 0 }; // fotogrammi del mondo in corso, per tryUpgrade
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
    // risoluzione del livello, ma entro il suo tetto di pixel (su un televisore 4K o su un Retina il
    // "medium" disegna comunque circa un Full HD, poi il browser lo ingrandisce)
    const budget = Math.sqrt((this.level.maxPixels * 1e6) / (w * h));
    const pr = Math.max(0.5, Math.min(this.level.pixelRatio, this.maxPixelRatio, budget));
    this.pixelRatio = pr;
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

  // Qualità adattiva, durante il gioco: si scende di un livello se troppi fotogrammi arrivano in
  // ritardo (vedi LATE_FRAME). Il livello abbandonato non si riprova più: ogni cambio costa uno scatto,
  // e l'altalena tra due livelli era proprio uno scatto ogni minuto. Salire si sale solo in tryUpgrade.
  updateQuality(dt) {
    if (!this.autoQuality) return;
    this.qualityCooldown -= dt;
    if (this.qualityCooldown > 0) return;
    const late = dt > LATE_FRAME;
    const ws = this.worldStats;
    ws.time += dt;
    ws.frames++;
    if (late) ws.late++;
    this.frameTimes.push(late ? 1 : 0);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (this.frameTimes.length < 90 || this.levelIndex === 0) return;
    const share = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    if (share > DOWN_LATE_SHARE) {
      this.levelBlocked[this.levelIndex] = true;
      this.qualityLog.push(`${LEVELS[this.levelIndex].name} → ${LEVELS[this.levelIndex - 1].name} (${Math.round(share * 100)}% in ritardo)`);
      this.setLevel(this.levelIndex - 1);
      this.resetQualityWindow(2);
    }
  }

  // Si riparte da capo con le misure (ingresso in un mondo, cambio di livello, scheda tornata visibile):
  // i primi fotogrammi dopo un cambio sono spesso lenti e non dicono nulla
  resetQualityWindow(cooldown = 1.5) {
    this.frameTimes.length = 0;
    this.worldStats = { time: 0, frames: 0, late: 0 };
    this.qualityCooldown = cooldown;
  }

  // A schermo nero, tra un mondo e l'altro (Director.setWorld): se nel mondo appena lasciato quasi
  // nessun fotogramma era in ritardo si prova il livello sopra. Se poi non regge, updateQuality torna
  // giù e quel livello resta escluso: al massimo un tentativo per livello.
  tryUpgrade() {
    if (!this.autoQuality) return false;
    const ws = this.worldStats;
    const next = this.levelIndex + 1;
    const ok = ws.time >= UP_MIN_SECONDS && ws.late / Math.max(1, ws.frames) < UP_LATE_SHARE;
    if (!ok || next > this.maxAutoLevel || this.levelBlocked[next]) return false;
    this.qualityLog.push(`${LEVELS[this.levelIndex].name} → ${LEVELS[next].name} (${Math.round((ws.late / ws.frames) * 100)}% in ritardo in ${ws.time.toFixed(0)} s)`);
    this.setLevel(next);
    return true;
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
      // il fuoco si può fissare da fuori (le riprese del trailer, scripts/trailer/browser.mjs)
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

  // Precompila gli shader dei materiali di una scena, al caricamento, in parallelo (non blocca il
  // menu). Si compila per il buffer del composer, dove la scena viene davvero disegnata (colori
  // lineari): compilati per lo schermo sarebbero altri shader, e in gioco si ricompilerebbe tutto.
  async precompile(scene) {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    let job = null;
    try {
      r.setRenderTarget(this.composer.inputBuffer);
      // compileAsync prepara i programmi subito (qui, con il buffer giusto) e poi attende che siano pronti
      if (r.compileAsync) job = r.compileAsync(scene, this.camera);
      else r.compile(scene, this.camera);
    } catch (e) {
      // la compilazione anticipata è un'ottimizzazione: in caso di errore si compila al primo frame
    } finally {
      r.setRenderTarget(prev);
    }
    try {
      await job;
    } catch (e) {
      // come sopra
    }
  }

  // Un fotogramma di prova fuori schermo, con tutti gli effetti accesi e ogni oggetto disegnato (anche
  // quelli nascosti o fuori dall'inquadratura): compila gli shader che la precompilazione non raggiunge
  // (ombre, G-buffer dei riflessi, occlusione, profondità di campo, oggetti che compaiono più tardi).
  // Si chiama a schermo nero (Director.setWorld): in gioco nessuno shader si compila al volo, cioè
  // nessuno scatto. Le luci restano come sono, perché cambiarle cambierebbe gli shader stessi.
  warm(scene) {
    const key = `${this.levelIndex}`;
    if (scene.userData.warmKey === key) return;
    scene.userData.warmKey = key;
    const shown = [];
    const unculled = [];
    const dimmed = [];
    const litBefore = new Set();
    scene.traverseVisible((o) => o.isLight && litBefore.add(o));
    scene.traverse((o) => {
      if (o.isLight) return;
      if (!o.visible) {
        o.visible = true;
        shown.push(o);
      }
      if (o.frustumCulled) {
        o.frustumCulled = false;
        unculled.push(o);
      }
    });
    // una luce dentro un gruppo appena mostrato resta spenta com'era
    scene.traverse((o) => {
      if (o.isLight && o.visible && !litBefore.has(o)) {
        o.visible = false;
        dimmed.push(o);
      }
    });
    const saved = {
      ao: this.aoPass.enabled,
      ssr: this.ssrPass.enabled,
      ssrIntensity: this.ssrPass.intensity,
      dof: this.dofPass.enabled,
      probe: this.ssrPass.focusProbe,
    };
    this.aoPass.enabled = true;
    this.ssrPass.enabled = true;
    if (this.ssrPass.intensity <= 0) this.ssrPass.intensity = 1;
    this.dofPass.enabled = true;
    this.ssrPass.focusProbe = false;
    this.finalPass.renderToScreen = false; // niente sullo schermo
    try {
      this.render(scene, 1 / 60);
    } catch (e) {
      // anche questa è solo un'ottimizzazione
    } finally {
      this.finalPass.renderToScreen = true;
      this.aoPass.enabled = saved.ao;
      this.ssrPass.enabled = saved.ssr;
      this.ssrPass.intensity = saved.ssrIntensity;
      this.dofPass.enabled = saved.dof;
      this.ssrPass.focusProbe = saved.probe;
      for (const o of shown) o.visible = false;
      for (const o of unculled) o.frustumCulled = true;
      for (const o of dimmed) o.visible = true;
    }
  }
}
