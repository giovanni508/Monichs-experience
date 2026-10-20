import * as THREE from 'three';
import { Pass } from 'postprocessing';

// ---------------------------------------------------------------------------------------------
// Riflessi in tempo reale con ray tracing nello spazio dello schermo (SSR).
// Per ogni pixel lucido si calcola il raggio riflesso e lo si fa avanzare nel buffer di profondità
// finché non incontra una superficie: lì si legge il colore della scena. Così il pavimento lucido
// riflette davvero orologi, pareti e ingranaggi che si vedono sullo schermo; dove il raggio esce
// dall'immagine resta il riflesso dell'ambiente già calcolato dai materiali.
//
// 1. G-buffer: la scena ridisegnata con un materiale unico (normale in spazio vista, ruvidità,
//    riflettività per oggetto). Oggetti trasparenti, particelle e sprite non partecipano.
// 2. Tracciamento (a mezza risoluzione nei livelli "high", piena in "ultra").
// 3. Composizione: riflesso sfocato secondo la ruvidità (mipmap), pesato con Fresnel.
// ---------------------------------------------------------------------------------------------

const MAX_STEPS = 96;
const _clear = new THREE.Color();
const _hidden = [];
const smooth = (x, a, b) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * Quanto riflette un materiale (0..1), quanto è ruvido e se è un metallo.
 * Si può forzare con material.userData.ssr (0..1) ed eventualmente userData.ssrRough.
 */
export function reflectParams(m) {
  if (!m || !m.isMeshStandardMaterial) return { reflect: 0, rough: 1, metal: false };
  let rough = m.roughness;
  if (m.isMeshPhysicalMaterial && m.clearcoat > 0.3) rough = Math.min(rough, m.clearcoatRoughness);
  rough = m.userData.ssrRough ?? rough;
  const metal = m.metalness > 0.5;
  const reflect = m.userData.ssr ?? (1 - smooth(rough, 0.08, 0.5)) * (metal ? 0.9 : 0.55);
  return { reflect, rough, metal };
}

const OCT_GLSL = /* glsl */ `
vec2 ssrOctWrap(vec2 v) { return (1.0 - abs(v.yx)) * vec2(v.x >= 0.0 ? 1.0 : -1.0, v.y >= 0.0 ? 1.0 : -1.0); }
vec2 ssrOct(vec3 n) {
  n /= (abs(n.x) + abs(n.y) + abs(n.z));
  n.xy = n.z >= 0.0 ? n.xy : ssrOctWrap(n.xy);
  return n.xy * 0.5 + 0.5;
}
vec3 ssrUnoct(vec2 e) {
  e = e * 2.0 - 1.0;
  vec3 n = vec3(e.xy, 1.0 - abs(e.x) - abs(e.y));
  float t = clamp(-n.z, 0.0, 1.0);
  n.x += n.x >= 0.0 ? -t : t;
  n.y += n.y >= 0.0 ? -t : t;
  return normalize(n);
}`;

function gbufferMaterial() {
  const lib = THREE.ShaderLib.normal;
  const uniforms = THREE.UniformsUtils.merge([lib.uniforms, { uRough: { value: 1 }, uReflect: { value: 0 } }]);
  const frag = lib.fragmentShader
    .replace('uniform float opacity;', `uniform float opacity;\nuniform float uRough;\nuniform float uReflect;\n${OCT_GLSL}`)
    .replace('gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );', 'gl_FragColor = vec4( ssrOct( normalize( normal ) ), uRough, uReflect );')
    .replace('gl_FragColor.a = 1.0;', '');
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: lib.vertexShader, fragmentShader: frag, side: THREE.DoubleSide });
  // valori del singolo oggetto (il materiale è condiviso da tutta la scena)
  mat.onBeforeRender = (renderer, scene, camera, geometry, object, group) => {
    let m = object.material;
    if (Array.isArray(m)) m = m[group?.materialIndex ?? 0];
    const p = reflectParams(m);
    uniforms.uRough.value = p.rough;
    // alfa: metallo in 0,5..1, dielettrico in 0..0,5
    uniforms.uReflect.value = p.reflect <= 0 ? 0 : p.metal ? 0.5 + 0.5 * p.reflect : 0.49 * p.reflect;
    mat.uniformsNeedUpdate = true;
  };
  return mat;
}

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const COMMON_GLSL = /* glsl */ `
#include <packing>
uniform sampler2D tGBuffer;
uniform sampler2D tDepth;
uniform mat4 uProj;
uniform mat4 uProjInv;
uniform float uNear;
uniform float uFar;
${OCT_GLSL}
vec3 ssrViewPos(vec2 uv, float depth) {
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}
float ssrViewZ(vec2 uv) { return perspectiveDepthToViewZ(texture2D(tDepth, uv).r, uNear, uFar); }
`;

const TRACE_FRAG = /* glsl */ `
${COMMON_GLSL}
uniform sampler2D tColor;
uniform vec2 uSize;        // risoluzione del G-buffer (pixel)
uniform float uMaxDistance;
uniform float uThickness;
uniform int uSteps;
varying vec2 vUv;

float ssrNoise(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  vec4 g = texture2D(tGBuffer, vUv);
  float depth = texture2D(tDepth, vUv).r;
  if (g.a < 0.003 || depth >= 1.0) { gl_FragColor = vec4(0.0); return; }
  vec3 P = ssrViewPos(vUv, depth);
  vec3 N = ssrUnoct(g.xy);
  vec3 R = normalize(reflect(normalize(P), N));
  // i raggi che tornano verso la camera raramente trovano qualcosa sullo schermo
  float facing = 1.0 - smoothstep(0.15, 0.7, R.z);
  if (facing <= 0.0) { gl_FragColor = vec4(0.0); return; }

  vec3 o = P + N * (0.02 + 0.004 * -P.z);
  float len = uMaxDistance;
  if (o.z + R.z * len > -uNear) len = (-uNear - o.z) / R.z * 0.98;
  vec3 e = o + R * len;
  vec4 h0 = uProj * vec4(o, 1.0);
  vec4 h1 = uProj * vec4(e, 1.0);
  float k0 = 1.0 / h0.w;
  float k1 = 1.0 / h1.w;
  vec2 s0 = h0.xy * k0 * 0.5 + 0.5;
  vec2 s1 = h1.xy * k1 * 0.5 + 0.5;
  float q0 = o.z * k0;
  float q1 = e.z * k1;
  vec2 dPix = (s1 - s0) * uSize;
  float n = clamp(max(abs(dPix.x), abs(dPix.y)) / 3.0, 4.0, float(uSteps));
  float jitter = ssrNoise(gl_FragCoord.xy);

  float tPrev = 0.0;
  float tHit = -1.0;
  float zPrev = o.z;
  for (int i = 0; i < ${MAX_STEPS}; i++) {
    if (float(i) >= n) break;
    float t = (float(i) + jitter) / n;
    vec2 uv = mix(s0, s1, t);
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) break;
    float rayZ = mix(q0, q1, t) / mix(k0, k1, t);
    float sceneZ = ssrViewZ(uv);
    float dz = sceneZ - rayZ; // > 0: il raggio è passato dietro la superficie
    // spessore: quello presunto degli oggetti, ma mai meno del tratto percorso in profondità in un
    // passo (di taglio un passo lungo attraversa una parete intera: va contato come contatto)
    float thick = max(uThickness + 0.025 * -rayZ, abs(rayZ - zPrev) * 1.5);
    if (dz > 0.0 && dz < thick && t * max(abs(dPix.x), abs(dPix.y)) > 2.0) { tHit = t; break; }
    tPrev = t;
    zPrev = rayZ;
  }
  if (tHit < 0.0) { gl_FragColor = vec4(0.0); return; }
  // raffinamento binario del punto di contatto
  float a = tPrev;
  float b = tHit;
  for (int j = 0; j < 6; j++) {
    float m = 0.5 * (a + b);
    vec2 uv = mix(s0, s1, m);
    float rayZ = mix(q0, q1, m) / mix(k0, k1, m);
    if (ssrViewZ(uv) - rayZ > 0.0) b = m; else a = m;
  }
  vec2 hitUv = mix(s0, s1, b);
  // una superficie colpita "di schiena" è un falso contatto
  vec3 Nh = ssrUnoct(texture2D(tGBuffer, hitUv).xy);
  if (dot(Nh, R) > 0.3) { gl_FragColor = vec4(0.0); return; }
  vec3 col = min(texture2D(tColor, hitUv).rgb, vec3(5.0)); // niente scintille dai riflessi dei riflessi
  vec2 edge = smoothstep(vec2(0.0), vec2(0.08), hitUv) * smoothstep(vec2(0.0), vec2(0.08), 1.0 - hitUv);
  float conf = edge.x * edge.y * (1.0 - smoothstep(0.6, 1.0, b)) * facing;
  gl_FragColor = vec4(col * conf, conf); // premoltiplicato: le mipmap sfocano colore e copertura insieme
}`;

const COMPOSITE_FRAG = /* glsl */ `
${COMMON_GLSL}
uniform sampler2D inputBuffer;
uniform sampler2D tTrace;
uniform float uIntensity;
uniform float uMaxLod;
uniform vec2 uTexel;  // dimensione di un pixel del G-buffer (uv)
varying vec2 vUv;

// disco di Poisson per la sfocatura bilaterale del riflesso
const vec2 SSR_DISK[8] = vec2[8](
  vec2(-0.613, 0.617), vec2(0.170, -0.040), vec2(-0.299, -0.792), vec2(0.645, 0.493),
  vec2(-0.651, -0.155), vec2(0.421, -0.668), vec2(-0.017, 0.958), vec2(0.917, -0.111)
);

void main() {
  vec4 color = texture2D(inputBuffer, vUv);
  vec4 g = texture2D(tGBuffer, vUv);
  if (g.a < 0.003) { gl_FragColor = color; return; }
  float metal = step(0.5, g.a);
  float strength = metal > 0.5 ? (g.a - 0.5) * 2.0 : g.a / 0.49;
  float rough = g.b;
  vec3 N = ssrUnoct(g.xy);
  vec3 P = ssrViewPos(vUv, texture2D(tDepth, vUv).r);
  float NdV = clamp(dot(N, -normalize(P)), 0.0, 1.0);
  float fres = pow(1.0 - NdV, 5.0);
  float F = metal > 0.5 ? mix(0.7, 1.0, fres) : mix(0.04, 1.0, fres);
  // sfocatura secondo la ruvidità (mipmap + disco bilaterale: non sconfina tra oggetti a
  // profondità diverse), con un minimo che leva il retino del tracciamento
  float lod = clamp(0.5 + rough * 7.0, 0.0, uMaxLod);
  float radius = 1.5 + rough * 18.0;
  float zc = P.z;
  vec4 tr = textureLod(tTrace, vUv, lod);
  float wsum = 1.0;
  for (int i = 0; i < 8; i++) {
    vec2 uv2 = vUv + SSR_DISK[i] * radius * uTexel;
    float wz = exp(-abs(ssrViewZ(uv2) - zc) / (0.02 * -zc + 0.05));
    tr += textureLod(tTrace, uv2, lod) * wz;
    wsum += wz;
  }
  tr /= wsum;
  if (tr.a < 0.002) { gl_FragColor = color; return; }
  vec3 refl = tr.rgb / tr.a;
  float w = clamp(tr.a * strength * F * uIntensity, 0.0, 0.95);
  gl_FragColor = vec4(mix(color.rgb, refl, w), color.a);
}`;

// Sonda di messa a fuoco: distanza (lungo la vista) della superficie al centro dello schermo, letta
// in modo asincrono dalla CPU per l'autofocus della profondità di campo. 16 bit in due byte (0..1000).
const FOCUS_FRAG = /* glsl */ `
${COMMON_GLSL}
void main() {
  float d = texture2D(tDepth, vec2(0.5)).r;
  float dist = d >= 1.0 ? 1000.0 : -perspectiveDepthToViewZ(d, uNear, uFar);
  float v = clamp(dist / 1000.0, 0.0, 1.0) * 65535.0;
  float hi = floor(v / 256.0);
  gl_FragColor = vec4(hi / 255.0, (v - hi * 256.0) / 255.0, 0.0, 1.0);
}`;

export class SSRPass extends Pass {
  constructor(camera) {
    super('SSRPass');
    // (Pass ha già un setter "mainScene" senza getter: qui nomi propri)
    this.worldScene = null;
    this.viewCamera = camera;
    this.needsSwap = true;
    this.intensity = 1;
    this.maxDistance = 120;
    this.thickness = 0.6;
    this.steps = 40;
    this.halfRes = true;
    this.width = 1;
    this.height = 1;

    this.gTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    this.gTarget.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    this.traceTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      depthBuffer: false,
    });
    this.gMaterial = gbufferMaterial();

    const shared = {
      tGBuffer: { value: this.gTarget.texture },
      tDepth: { value: this.gTarget.depthTexture },
      uProj: { value: new THREE.Matrix4() },
      uProjInv: { value: new THREE.Matrix4() },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
    };
    this.shared = shared;
    this.traceMaterial = new THREE.ShaderMaterial({
      uniforms: {
        ...shared,
        tColor: { value: null },
        uSize: { value: new THREE.Vector2(1, 1) },
        uMaxDistance: { value: this.maxDistance },
        uThickness: { value: this.thickness },
        uSteps: { value: this.steps },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: TRACE_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.compositeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        ...shared,
        inputBuffer: { value: null },
        tTrace: { value: this.traceTarget.texture },
        uIntensity: { value: 1 },
        uMaxLod: { value: 6 },
        uTexel: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.focusMaterial = new THREE.ShaderMaterial({
      uniforms: { ...shared },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: FOCUS_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.focusTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.focusBuffer = new Uint8Array(4);
    this.focusPending = false;
    this.focusDistance = 30; // ultima distanza letta al centro dello schermo (unità di scena)
    this.focusProbe = false; // acceso dal renderer quando serve l'autofocus
    this.fullscreenMaterial = this.compositeMaterial;
  }

  /** Parametri del mondo: { intensity, maxDistance, thickness } */
  configure({ intensity = 1, maxDistance = 120, thickness = 0.6 } = {}) {
    this.intensity = intensity;
    this.maxDistance = maxDistance;
    this.thickness = thickness;
  }

  setSize(width, height) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.gTarget.setSize(this.width, this.height);
    const k = this.halfRes ? 0.5 : 1;
    const tw = Math.max(1, Math.floor(this.width * k));
    const th = Math.max(1, Math.floor(this.height * k));
    this.traceTarget.setSize(tw, th);
    this.compositeMaterial.uniforms.uMaxLod.value = Math.max(0, Math.floor(Math.log2(Math.min(tw, th))) - 3);
    this.compositeMaterial.uniforms.uTexel.value.set(1 / this.width, 1 / this.height);
  }

  setHalfRes(on) {
    if (this.halfRes === on) return;
    this.halfRes = on;
    this.setSize(this.width, this.height);
  }

  renderGBuffer(renderer, scene, camera) {
    // fuori: trasparenze (vetri, bagliori, scritte), particelle, sprite, linee e ciò che lo chiede
    // (userData.noSSR); un trasparente da trattare come superficie piena va segnato userData.ssrSolid
    scene.traverseVisible((o) => {
      const m = o.material;
      const transparent = m && !Array.isArray(m) && ((m.transparent && !m.userData.ssrSolid) || m.depthWrite === false || m.blending === THREE.AdditiveBlending);
      if (o.isPoints || o.isSprite || o.isLine || transparent || o.userData.noSSR) {
        o.visible = false;
        _hidden.push(o);
      }
    });
    const background = scene.background;
    const override = scene.overrideMaterial;
    const shadowAuto = renderer.shadowMap.autoUpdate;
    renderer.getClearColor(_clear);
    const clearAlpha = renderer.getClearAlpha();
    scene.background = null;
    scene.overrideMaterial = this.gMaterial;
    renderer.shadowMap.autoUpdate = false; // le ombre sono già state calcolate per questo fotogramma
    renderer.setRenderTarget(this.gTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    scene.background = background;
    scene.overrideMaterial = override;
    renderer.shadowMap.autoUpdate = shadowAuto;
    renderer.setClearColor(_clear, clearAlpha);
    for (const o of _hidden) o.visible = true;
    _hidden.length = 0;
  }

  render(renderer, inputBuffer, outputBuffer) {
    const scene = this.worldScene;
    const camera = this.viewCamera;
    const c = this.compositeMaterial.uniforms;
    c.inputBuffer.value = inputBuffer.texture;
    if (!scene || this.intensity <= 0) {
      // nessun riflesso: si copia l'immagine così com'è
      c.uIntensity.value = 0;
      this.fullscreenMaterial = this.compositeMaterial;
      renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
      renderer.render(this.scene, this.camera);
      return;
    }
    this.renderGBuffer(renderer, scene, camera);
    const s = this.shared;
    s.uProj.value.copy(camera.projectionMatrix);
    s.uProjInv.value.copy(camera.projectionMatrixInverse);
    s.uNear.value = camera.near;
    s.uFar.value = camera.far;

    if (this.focusProbe && !this.focusPending) this.probeFocus(renderer);

    const t = this.traceMaterial.uniforms;
    t.tColor.value = inputBuffer.texture;
    t.uSize.value.set(this.width, this.height);
    t.uMaxDistance.value = this.maxDistance;
    t.uThickness.value = this.thickness;
    t.uSteps.value = Math.min(this.steps, MAX_STEPS);
    this.fullscreenMaterial = this.traceMaterial;
    renderer.setRenderTarget(this.traceTarget);
    renderer.render(this.scene, this.camera);

    c.uIntensity.value = this.intensity;
    this.fullscreenMaterial = this.compositeMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  // legge la distanza al centro senza fermare la GPU (il valore arriva uno o due fotogrammi dopo)
  probeFocus(renderer) {
    this.fullscreenMaterial = this.focusMaterial;
    renderer.setRenderTarget(this.focusTarget);
    renderer.render(this.scene, this.camera);
    this.focusPending = true;
    renderer
      .readRenderTargetPixelsAsync(this.focusTarget, 0, 0, 1, 1, this.focusBuffer)
      .then(() => {
        const b = this.focusBuffer;
        this.focusDistance = ((b[0] * 256 + b[1]) / 65535) * 1000;
      })
      .catch(() => {})
      .finally(() => (this.focusPending = false));
  }

  dispose() {
    this.gTarget.dispose();
    this.traceTarget.dispose();
    this.gMaterial.dispose();
    this.traceMaterial.dispose();
    this.compositeMaterial.dispose();
    this.focusMaterial.dispose();
    this.focusTarget.dispose();
    super.dispose?.();
  }
}
