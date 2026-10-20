import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { addCircularTangents, addLinearTangents } from './materials.js';

// ---------------------------------------------------------------------------------------------
// Orologi della Collezione Delta: i modelli GLB ricostruiti in Blender sulle quote dei disegni
// tecnici del produttore (Modelli/3D, vedi ASSETS.md §8).
// Sistema del file: millimetri (nodo radice scalato a 0,001), Y in alto, quadrante verso +Y,
// corona verso +X (ore 3), ore 12 verso -Z, bracciale chiuso ad anello sotto la cassa.
// Qui i materiali vengono adattati al tempo reale: vetro zaffiro leggero (niente trasmissione, che
// raddoppierebbe il rendering), direzione della satinatura per l'anisotropia, Super-LumiNova che si
// accende di notte, lancette separate per segnare l'ora vera.
// ---------------------------------------------------------------------------------------------

const loader = new GLTFLoader();
const templates = new Map();

// il modello è alle 10:09:36: angoli delle lancette in gradi, in senso orario dalle 12
const MODEL_TIME = { hour: 304.8, minute: 57.6, second: 216 };

/** Vetro zaffiro antiriflesso: quasi invisibile di fronte, riflesso blu tenue di taglio. */
export function watchGlassMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xdfe8ff,
    metalness: 0,
    roughness: 0.03,
    envMapIntensity: 1.4,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
  {
    float facing = clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0);
    gl_FragColor.a = clamp(0.035 + pow(1.0 - facing, 3.5) * 0.5, 0.0, 0.6);
  }`,
    );
  };
  mat.customProgramCacheKey = () => 'watch-glass';
  return mat;
}

function prepareTemplate(scene) {
  const glass = watchGlassMaterial();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m.transmission > 0) {
      o.material = glass;
      o.renderOrder = 4;
      return;
    }
    // anisotropia senza tangenti né UV: la direzione della satinatura la diamo noi
    if (m.anisotropy > 0 && !o.geometry.attributes.tangent) {
      if (/12-6/.test(m.name)) addLinearTangents(o.geometry, new THREE.Vector3(0, 0, 1));
      else addCircularTangents(o.geometry);
    }
    if (/luminova/i.test(m.name)) {
      m.emissive = new THREE.Color(0x7ff6ff);
      m.emissiveIntensity = 0;
    }
    // filtro anisotropico: quadranti e normali restano nitidi anche quando l'orologio ruota di taglio
    for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'clearcoatNormalMap']) {
      if (m[key]) m[key].anisotropy = 8;
    }
  });
  return scene;
}

// Separa l'unica mesh dei riporti luminescenti delle lancette in tre parti (una per lancetta)
function splitLume(geo) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const count = idx ? idx.count : pos.count;
  const lists = { hour: [], minute: [], second: [] };
  for (let t = 0; t < count; t += 3) {
    const a = idx ? idx.getX(t) : t;
    const b = idx ? idx.getX(t + 1) : t + 1;
    const c = idx ? idx.getX(t + 2) : t + 2;
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    const ang = ((Math.atan2(cx, -cz) * 180) / Math.PI + 360) % 360;
    let best = 'hour';
    let bd = Infinity;
    for (const [k, h] of Object.entries(MODEL_TIME)) {
      const d = Math.abs((((ang - h) % 360) + 540) % 360 - 180);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    lists[best].push(a, b, c);
  }
  const out = {};
  for (const [k, list] of Object.entries(lists)) {
    const g = geo.clone();
    g.setIndex(list);
    out[k] = g;
  }
  return out;
}

/** Carica (una sola volta) e prepara un modello. */
export function loadWatch(id, url) {
  if (!templates.has(id)) {
    templates.set(
      id,
      new Promise((resolve, reject) => {
        loader.load(url, (gltf) => resolve(prepareTemplate(gltf.scene)), undefined, reject);
      }),
    );
  }
  return templates.get(id);
}

export class WatchModel {
  constructor(scene, id) {
    this.id = id;
    this.object = scene; // contenitore (la scena del GLB)
    this.node = scene.children[0]; // nodo dell'orologio (scala mm → unità)
    this.meshes = {};
    const lume = new Set();
    this.node.traverse((o) => {
      if (o.name) this.meshes[o.name.replace(`${id}_`, '')] = o;
      if (o.isMesh && /luminova/i.test(o.material.name)) lume.add(o.material);
    });
    this.lume = [...lume];
    // lancette: ognuna su un perno al centro del quadrante, con il suo riporto luminescente
    this.hands = {};
    const lumeMesh = this.meshes.lancette_luminova;
    const parts = lumeMesh?.isMesh ? splitLume(lumeMesh.geometry) : null;
    for (const [key, name] of [['hour', 'lancetta_ore'], ['minute', 'lancetta_minuti'], ['second', 'lancetta_secondi']]) {
      const hand = this.meshes[name];
      if (!hand) continue;
      const pivot = new THREE.Group();
      pivot.name = `perno_${key}`;
      this.node.add(pivot);
      pivot.add(hand);
      if (parts) pivot.add(new THREE.Mesh(parts[key], lumeMesh.material));
      this.hands[key] = pivot;
    }
    if (lumeMesh && parts) lumeMesh.visible = false;
    this.lastSecondStep = -1;
  }

  /** Unità di scena per millimetro (il file è in mm). */
  setScale(unitsPerMm) {
    this.node.scale.setScalar(unitsPerMm);
    return this;
  }

  /** In piedi: quadrante verso +Z, ore 12 in alto, bracciale che scende e risale dietro la cassa. */
  upright() {
    this.object.rotation.set(Math.PI / 2, 0, 0);
    return this;
  }

  setBracelet(on) {
    for (const [name, o] of Object.entries(this.meshes)) if (/bracciale|chiusura/.test(name)) o.visible = on;
    return this;
  }

  /**
   * Materiali propri di questa istanza (di norma sono condivisi con le altre copie dello stesso
   * modello), per esempio per darle una luce d'ambiente diversa da quella della scena.
   */
  ownMaterials(opts = {}) {
    this.lume = ownMaterialsOf(this.object, opts).filter((m) => /luminova/i.test(m.name));
    return this;
  }

  /** Ora vera; i secondi avanzano a scatti di 1/8 di secondo (28.800 alternanze/ora). */
  setTime(date = new Date()) {
    const s = date.getSeconds() + Math.floor(date.getMilliseconds() / 125) / 8;
    const m = date.getMinutes() + s / 60;
    const h = (date.getHours() % 12) + m / 60;
    const set = (key, deg) => {
      if (this.hands[key]) this.hands[key].rotation.y = -((deg - MODEL_TIME[key]) * Math.PI) / 180;
    };
    set('hour', (h / 12) * 360);
    set('minute', (m / 60) * 360);
    set('second', (s / 60) * 360);
  }

  /** Notte: la Super-LumiNova si accende (0 = giorno, 1 = buio). */
  setNight(f) {
    this.lume.forEach((m) => (m.emissiveIntensity = f * 2.6));
  }

  meshList(...names) {
    return names.map((n) => this.meshes[n]).filter(Boolean);
  }
}

/**
 * Sostituisce i materiali di un modello con copie proprie (le geometrie restano condivise) e le
 * restituisce. envMap/envIntensity: luce d'ambiente diversa da quella della scena.
 */
export function ownMaterialsOf(root, { envMap = null, envIntensity = 1 } = {}) {
  const copies = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    let m = copies.get(o.material);
    if (!m) {
      m = o.material.clone();
      // clone() non copia le modifiche allo shader (vetro)
      m.onBeforeCompile = o.material.onBeforeCompile;
      m.customProgramCacheKey = o.material.customProgramCacheKey;
      if (envMap) m.envMap = envMap;
      m.envMapIntensity *= envIntensity;
      copies.set(o.material, m);
    }
    o.material = m;
  });
  return [...copies.values()];
}

/** Crea un'istanza (geometrie e materiali condivisi con le altre istanze dello stesso modello). */
export async function createWatch(id, url) {
  const tpl = await loadWatch(id, url);
  return new WatchModel(tpl.clone(true), id);
}

// Ingombro del modello completo in piedi (mm): largo 43 (corona compresa), alto 68,8 da un capo
// all'altro del bracciale, profondo 57,4 (vetro a +5,7 dal centro della cassa, anello del bracciale
// fino a -51,7 dietro).
export const WATCH_SIZE = { width: 43, height: 68.8, front: 5.7, back: 51.7 };

/**
 * Un monolite: l'orologio completo, gigante, in piedi (quadrante verso +Z, ore 12 in alto, il
 * bracciale chiuso ad anello dietro la cassa). Materiali propri con la luce d'ambiente dello studio
 * fotografico, così l'acciaio è quello delle foto in qualunque mondo. Il gruppo ha l'origine al
 * centro della cassa: si posiziona e si ruota come un blocco unico.
 */
export async function createMonolith(id, url, { scale = 1, envMap = null, envIntensity = 0.6 } = {}) {
  const watch = (await createWatch(id, url)).ownMaterials({ envMap, envIntensity }).setScale(scale).upright();
  watch.object.position.z = -5 * scale; // il modello ha l'origine sul fondello
  const group = new THREE.Group();
  group.add(watch.object);
  return { group, watch };
}

// ---------------------------------------------------------------------------------------------
// Rotore (massa oscillante SW200, oro rosa IP satinato circolare, incisioni "TWENTY - SIX 26
// JEWELS SWISS MADE", pittogramma e MONICHS): Modelli/3D/rotore.glb, vedi ASSETS.md §8b.
// Sistema del file: mm (nodo radice scalato a 0,001), Y verso il fondello (faccia incisa), perno al
// centro del cuscinetto, razza centrale verso +Z. Le tangenti circolari attorno a Y (aggiunte al
// caricamento) danno la satinatura concentrica delle foto.
// ---------------------------------------------------------------------------------------------

export const ROTOR_RADIUS = 12.1; // mm, bordo esterno della fascia

/**
 * Un rotore con materiali propri. `object` gira attorno al suo asse Y; scale = unità per mm.
 * Restituisce anche i materiali (per l'emissione o l'evidenziazione della tappa).
 */
export async function createRotor(url, { scale = 1, envMap = null, envIntensity = 1 } = {}) {
  const tpl = await loadWatch('rotore', url);
  const object = tpl.clone(true);
  object.children[0].scale.setScalar(scale);
  const materials = ownMaterialsOf(object, { envMap, envIntensity });
  return { object, materials };
}

// ---------------------------------------------------------------------------------------------
// Sunset: lo stesso quadrante, un'altra fetta della stessa agata. Non si inventa la pietra: si usa
// quella vera della texture del modello, ripulita dalle scritte, e la si guarda da un altro "taglio"
// (ruotata, specchiata, ingrandita, appena deformata). Stampe e minuteria restano al loro posto.
// ---------------------------------------------------------------------------------------------

// Pietra nella texture del quadrante Sunset (2048 px), misurata sull'immagine: centro e raggio in UV.
const SUNSET_STONE = { u: 0.493, v: 0.501, r: 0.44 };
const STONE_VISIBLE = 0.425; // oltre comincia il bordo verso la minuteria
// riquadri delle scritte MONICHS e SUNSET AUTOMATIC (u0, v0, u1, v1), con margine per l'alone
const SUNSET_PRINTS = [
  [0.395, 0.305, 0.6, 0.38],
  [0.395, 0.68, 0.6, 0.795],
];
// dove passano le bande aranciate, rispetto al centro della pietra (UV, y verso il basso)
const STONE_BANDS = [-0.02, 0.18];
let cleanStone = null;

/**
 * La pietra senza scritte: si ritaglia il disco, si segnano come buchi le stampe bianche (con il loro
 * alone) e tutto quello che sta fuori dalla pietra, e si riempiono con la pietra intorno (push-pull).
 */
function cleanStoneTexture(map) {
  if (cleanStone) return cleanStone;
  const N = 1024;
  const { u, v, r } = SUNSET_STONE;
  const img = map.image;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, (u - r) * img.width, (v - r) * img.height, 2 * r * img.width, 2 * r * img.height, 0, 0, N, N);
  const image = ctx.getImageData(0, 0, N, N);
  const px = image.data;
  let known = new Uint8Array(N * N);
  const inner = (0.5 * (STONE_VISIBLE - 0.004)) / r;
  for (let y = 0; y < N; y++) {
    const dv = v - r + ((y + 0.5) / N) * 2 * r;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const du = u - r + ((x + 0.5) / N) * 2 * r;
      const inside = Math.hypot((x + 0.5) / N - 0.5, (y + 0.5) / N - 0.5) < inner;
      const print = SUNSET_PRINTS.some(([u0, v0, u1, v1]) => du > u0 && du < u1 && dv > v0 && dv < v1);
      known[i] = inside && !print && Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) < 80 ? 1 : 0;
    }
  }
  // l'alone delle scritte: i buchi si allargano di qualche pixel
  for (let pass = 0; pass < 4; pass++) {
    const next = known.slice();
    for (let y = 1; y < N - 1; y++) {
      for (let x = 1; x < N - 1; x++) {
        const i = y * N + x;
        if (known[i] && !(known[i - 1] && known[i + 1] && known[i - N] && known[i + N])) next[i] = 0;
      }
    }
    known = next;
  }
  // piramide: medie pesate (colore premoltiplicato, copertura 0..1)
  const levels = [];
  let n = N;
  let c = new Float32Array(N * N * 3);
  let w = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    if (!known[i]) continue;
    w[i] = 1;
    c[i * 3] = px[i * 4];
    c[i * 3 + 1] = px[i * 4 + 1];
    c[i * 3 + 2] = px[i * 4 + 2];
  }
  levels.push({ n, c, w });
  while (n > 1) {
    const m = n >> 1;
    const c2 = new Float32Array(m * m * 3);
    const w2 = new Float32Array(m * m);
    for (let y = 0; y < m; y++) {
      for (let x = 0; x < m; x++) {
        const o = y * m + x;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const s = (y * 2 + dy) * n + (x * 2 + dx);
          w2[o] += w[s] * 0.25;
          c2[o * 3] += c[s * 3] * 0.25;
          c2[o * 3 + 1] += c[s * 3 + 1] * 0.25;
          c2[o * 3 + 2] += c[s * 3 + 2] * 0.25;
        }
      }
    }
    n = m;
    c = c2;
    w = w2;
    levels.push({ n, c, w });
  }
  // discesa: dove manca copertura si usa il livello più grossolano, interpolato
  const top = levels[levels.length - 1];
  let fill = new Float32Array(3);
  for (let k = 0; k < 3; k++) fill[k] = top.w[0] > 0 ? top.c[k] / top.w[0] : 0;
  for (let l = levels.length - 2; l >= 0; l--) {
    const { n: ln, c: lc, w: lw } = levels[l];
    const cn = ln >> 1;
    const out = new Float32Array(ln * ln * 3);
    for (let y = 0; y < ln; y++) {
      const fy = Math.min(Math.max((y + 0.5) / 2 - 0.5, 0), cn - 1);
      const y0 = Math.floor(fy);
      const y1 = Math.min(y0 + 1, cn - 1);
      const ty = fy - y0;
      for (let x = 0; x < ln; x++) {
        const fx = Math.min(Math.max((x + 0.5) / 2 - 0.5, 0), cn - 1);
        const x0 = Math.floor(fx);
        const x1 = Math.min(x0 + 1, cn - 1);
        const tx = fx - x0;
        const o = y * ln + x;
        const cov = Math.min(1, lw[o]);
        for (let k = 0; k < 3; k++) {
          const a = fill[(y0 * cn + x0) * 3 + k] * (1 - tx) + fill[(y0 * cn + x1) * 3 + k] * tx;
          const b = fill[(y1 * cn + x0) * 3 + k] * (1 - tx) + fill[(y1 * cn + x1) * 3 + k] * tx;
          const up = a * (1 - ty) + b * ty;
          out[o * 3 + k] = lw[o] > 0 ? lc[o * 3 + k] / lw[o] * cov + up * (1 - cov) : up;
        }
      }
    }
    fill = out;
  }
  for (let i = 0; i < N * N; i++) {
    px[i * 4] = fill[i * 3];
    px[i * 4 + 1] = fill[i * 3 + 1];
    px[i * 4 + 2] = fill[i * 3 + 2];
    px[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  cleanStone = new THREE.CanvasTexture(canvas);
  cleanStone.colorSpace = THREE.SRGBColorSpace;
  cleanStone.flipY = false;
  cleanStone.anisotropy = 4;
  return cleanStone;
}

const AGATE_DIAL_GLSL = /* glsl */ `
uniform sampler2D uStone;
uniform vec2 uCutRot; uniform vec2 uCutOffset; uniform float uCutZoom; uniform float uCutMirror; uniform float uCutWarp;
uniform vec3 uCutTone;
float vHash(vec2 p) { return fract(sin(dot(p, vec2(41.37, 289.11))) * 45758.5453); }
float vNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(vHash(i), vHash(i + vec2(1.0, 0.0)), f.x), mix(vHash(i + vec2(0.0, 1.0)), vHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float vFbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * vNoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return v; }
// p: dal centro del quadrante, in UV. Restituisce dove leggere la pietra pulita.
vec2 vCut(vec2 p) {
  vec2 q = vec2(p.x * uCutMirror, p.y);
  q = mat2(uCutRot.x, uCutRot.y, -uCutRot.y, uCutRot.x) * q * uCutZoom + uCutOffset;
  q += (vec2(vFbm(p * 6.0 + uCutWarp), vFbm(p * 6.0 + uCutWarp + 17.3)) - 0.5) * 0.05;
  q *= min(1.0, ${(STONE_VISIBLE - 0.005).toFixed(3)} / max(length(q), 1e-4));
  return 0.5 + q / ${(2 * SUNSET_STONE.r).toFixed(3)};
}`;

// un taglio diverso per ogni seme: rotazione, specchio, ingrandimento, spostamento, tono
function cutFor(seed) {
  let s = Math.floor(seed * 9973) >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ang = rnd() * Math.PI * 2;
  const zoom = 0.5 + rnd() * 0.3;
  // il taglio va verso le bande aranciate della metà bassa (il tratto più riconoscibile della pietra),
  // poi la rotazione le porta ogni volta in un punto diverso del quadrante
  const oa = Math.atan2(STONE_BANDS[1], STONE_BANDS[0]) + (rnd() - 0.5) * 1.4;
  const od = (1 - zoom) * STONE_VISIBLE * (0.6 + rnd() * 0.35);
  const mirror = rnd() < 0.5 ? -1 : 1;
  const warp = rnd() * 100;
  // carnelian più rossa o più aranciata, più chiara o più scura: entro la gamma della pietra reale
  const warm = rnd();
  const lum = 0.93 + rnd() * 0.12;
  return { ang, zoom, offset: [Math.cos(oa) * od, Math.sin(oa) * od], mirror, warp, tone: [lum, lum * (0.92 + warm * 0.2), lum * (0.95 + warm * 0.1)] };
}

/** Imposta il "taglio" di un quadrante agata (cambia a ogni visita). */
export function setAgateCut(mat, seed) {
  const u = mat.userData.agateDial;
  const c = cutFor(seed);
  u.uCutRot.value.set(Math.cos(c.ang), Math.sin(c.ang));
  u.uCutZoom.value = c.zoom;
  u.uCutOffset.value.set(c.offset[0], c.offset[1]);
  u.uCutMirror.value = c.mirror;
  u.uCutWarp.value = c.warp;
  u.uCutTone.value.set(...c.tone);
}

export function agateDialMaterial(base, seed) {
  const mat = base.clone();
  mat.normalScale = base.normalScale.clone().multiplyScalar(0.35);
  const uniforms = {
    uStone: { value: cleanStoneTexture(base.map) },
    uCutRot: { value: new THREE.Vector2(1, 0) },
    uCutOffset: { value: new THREE.Vector2() },
    uCutZoom: { value: 1 },
    uCutMirror: { value: 1 },
    uCutWarp: { value: 0 },
    uCutTone: { value: new THREE.Vector3(1, 1, 1) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${AGATE_DIAL_GLSL}`).replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
  vec4 dialTexel = texture2D(map, vMapUv);
  vec2 dialP = vMapUv - vec2(${SUNSET_STONE.u.toFixed(3)}, ${SUNSET_STONE.v.toFixed(3)});
  float dialDisc = 1.0 - smoothstep(${(STONE_VISIBLE - 0.01).toFixed(3)}, ${STONE_VISIBLE.toFixed(3)}, length(dialP));
  float dialPrint = smoothstep(0.12, 0.45, min(dialTexel.r, min(dialTexel.g, dialTexel.b)));
  vec3 dialStone = texture2D(uStone, vCut(dialP)).rgb * uCutTone;
  dialTexel.rgb = mix(dialTexel.rgb, dialStone, dialDisc * (1.0 - dialPrint));
  diffuseColor *= dialTexel;
#endif`,
    );
  };
  mat.customProgramCacheKey = () => 'agate-dial';
  mat.userData.agateDial = uniforms;
  setAgateCut(mat, seed);
  return mat;
}
