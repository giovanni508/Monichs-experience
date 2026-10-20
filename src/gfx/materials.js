import * as THREE from 'three';

// ---------------------------------------------------------------------------------------------
// Sistema di "patch" per i materiali standard/physical: finiture orologiere procedurali
// (Côtes de Genève, perlage, Côtes circolari) e bagliore di evidenziazione degli hotspot.
// Le finiture sono calcolate nello spazio oggetto, sulle facce orizzontali (normale ±Y).
// ---------------------------------------------------------------------------------------------

function patchState(material) {
  if (material.userData._patch) return material.userData._patch;
  const st = {
    uniforms: {},
    vertDecl: new Set(),
    vertMain: new Set(),
    fragDecl: [],
    fragRough: [],
    fragNormal: [],
    fragEmissive: [],
    keys: [],
  };
  material.userData._patch = st;
  // una modifica allo shader che il materiale ha già (vetro, quadranti, vento) resta: la patch si
  // aggiunge dopo, invece di sostituirla
  const prev = material.onBeforeCompile;
  const chained = prev !== THREE.Material.prototype.onBeforeCompile;
  // chiave della cache dei programmi: quella propria del materiale, o il testo della modifica precedente
  const ownKey = material.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? material.customProgramCacheKey : null;
  const prevText = chained ? prev.toString() : '';
  material.onBeforeCompile = (shader, renderer) => {
    if (chained) prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, st.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${[...st.vertDecl].join('\n')}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${[...st.vertMain].join('\n')}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${st.fragDecl.join('\n')}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${st.fragRough.join('\n')}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${st.fragNormal.join('\n')}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${st.fragEmissive.join('\n')}`);
  };
  material.customProgramCacheKey = () => (chained ? `${ownKey ? ownKey.call(material) : prevText}|` : '') + st.keys.join('|');
  return st;
}

const OBJ_VARYINGS_V = `
varying vec3 vObjPos;
varying vec3 vObjNormal;
varying vec3 vTX;
varying vec3 vTY;
varying vec3 vTZ;`;
const OBJ_VARYINGS_MAIN = `
vObjPos = position;
vObjNormal = normal;
#ifdef USE_INSTANCING
  vTX = normalize(normalMatrix * (mat3(instanceMatrix) * vec3(1.0, 0.0, 0.0)));
  vTY = normalize(normalMatrix * (mat3(instanceMatrix) * vec3(0.0, 1.0, 0.0)));
  vTZ = normalize(normalMatrix * (mat3(instanceMatrix) * vec3(0.0, 0.0, 1.0)));
#else
  vTX = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));
  vTY = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));
  vTZ = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
#endif`;
const OBJ_VARYINGS_F = `
varying vec3 vObjPos;
varying vec3 vObjNormal;
varying vec3 vTX;
varying vec3 vTY;
varying vec3 vTZ;
float patHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`;

function useObjSpace(st) {
  if (!st.vertDecl.has(OBJ_VARYINGS_V)) {
    st.vertDecl.add(OBJ_VARYINGS_V);
    st.vertMain.add(OBJ_VARYINGS_MAIN);
    st.fragDecl.push(OBJ_VARYINGS_F);
  }
}

/**
 * Patch generica (usata dai quadranti): inietta codice nei punti standard dello shader.
 * In `fragRough` sono disponibili vObjPos, vObjNormal, vTX/vTY/vTZ, patHash(); si può
 * modificare diffuseColor/roughnessFactor e dichiarare variabili usate in fragNormal/fragEmissive.
 */
export function patchCustom(material, { key, uniforms = {}, fragDecl = '', fragRough = '', fragNormal = '', fragEmissive = '' }) {
  const st = patchState(material);
  useObjSpace(st);
  Object.assign(st.uniforms, uniforms);
  if (fragDecl) st.fragDecl.push(fragDecl);
  if (fragRough) st.fragRough.push(fragRough);
  if (fragNormal) st.fragNormal.push(fragNormal);
  if (fragEmissive) st.fragEmissive.push(fragEmissive);
  st.keys.push(key);
  return st.uniforms;
}

/**
 * Côtes de Genève rettilinee: bande parallele all'asse Z dell'oggetto, larghe `width`.
 * Ogni banda riflette la luce come un'onda morbida; finissime striature ad arco.
 */
export function patchCotes(material, { width = 1.2, strength = 0.5, angle = 0 } = {}) {
  const st = patchState(material);
  useObjSpace(st);
  st.uniforms.uCotesW = { value: width };
  st.uniforms.uCotesK = { value: strength };
  st.uniforms.uCotesA = { value: angle };
  st.fragDecl.push('uniform float uCotesW; uniform float uCotesK; uniform float uCotesA;');
  st.fragRough.push(`
  vec2 patSlope = vec2(0.0);
  // solo le facce superiori: i sottoponti non sono decorati
  float patMask = smoothstep(0.9, 0.98, vObjNormal.y);
  roughnessFactor = mix(roughnessFactor * (vObjNormal.y < -0.5 ? 1.25 : 0.35), roughnessFactor, patMask); // smussi lucidati
  {
    float ca = cos(uCotesA), sa = sin(uCotesA);
    vec2 q = mat2(ca, -sa, sa, ca) * vObjPos.xz;
    float x = q.x / uCotesW;
    float band = floor(x);
    float u = fract(x) - 0.5;
    float z = q.y / uCotesW;
    float arc = z * 2.2 - u * u * 3.2 + band * 0.37;
    float fine = sin(arc * 6.2831 * 7.0);
    vec2 s = vec2(sin(u * 3.14159) * 0.62, 0.0) + vec2(0.0, fine * 0.05) + vec2(fine * 0.025, 0.0);
    s = mat2(ca, sa, -sa, ca) * s;
    patSlope += s * uCotesK * patMask;
    roughnessFactor = mix(roughnessFactor, roughnessFactor * (0.72 + 0.2 * abs(u) + 0.08 * fine), patMask);
  }`);
  st.fragNormal.push('normal = normalize(normal + vTX * patSlope.x + vTZ * patSlope.y);');
  st.keys.push('cotes');
  return st.uniforms;
}

/** Côtes de Genève circolari (anelli concentrici attorno all'origine dell'oggetto), come sul rotore. */
export function patchCotesCircular(material, { width = 1.0, strength = 0.5 } = {}) {
  const st = patchState(material);
  useObjSpace(st);
  st.uniforms.uCCW = { value: width };
  st.uniforms.uCCK = { value: strength };
  st.fragDecl.push('uniform float uCCW; uniform float uCCK;');
  st.fragRough.push(`
  vec2 patSlope = vec2(0.0);
  float patMask = smoothstep(0.55, 0.85, abs(vObjNormal.y));
  {
    float r = length(vObjPos.xz) + 1e-4;
    vec2 dir = vObjPos.xz / r;
    vec2 tang = vec2(-dir.y, dir.x);
    float x = r / uCCW;
    float u = fract(x) - 0.5;
    float ang = atan(vObjPos.z, vObjPos.x);
    float fine = sin((ang * r * 0.9 - u * u * 2.5) * 6.2831 * 1.4);
    vec2 s = dir * sin(u * 3.14159) * 0.6 + tang * fine * 0.03;
    patSlope += s * uCCK * patMask;
    roughnessFactor = mix(roughnessFactor, roughnessFactor * (0.75 + 0.25 * abs(u)), patMask);
  }`);
  st.fragNormal.push('normal = normalize(normal + vTX * patSlope.x + vTZ * patSlope.y);');
  st.keys.push('cotesC');
  return st.uniforms;
}

/** Perlage: cerchi sovrapposti a griglia, ciascuno con finissime righe concentriche. */
export function patchPerlage(material, { spacing = 1.0, strength = 0.45 } = {}) {
  const st = patchState(material);
  useObjSpace(st);
  st.uniforms.uPerS = { value: spacing };
  st.uniforms.uPerK = { value: strength };
  st.fragDecl.push('uniform float uPerS; uniform float uPerK;');
  st.fragRough.push(`
  vec2 patSlope = vec2(0.0);
  float patMask = smoothstep(0.55, 0.85, abs(vObjNormal.y));
  {
    vec2 p = vObjPos.xz / uPerS;
    vec2 cell = floor(p);
    float best = -1.0;
    vec2 bestD = vec2(0.0);
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 c = cell + vec2(float(i), float(j));
        vec2 center = c + 0.5 + (vec2(patHash(c), patHash(c + 7.1)) - 0.5) * 0.12;
        vec2 d = p - center;
        float order = c.y * 1000.0 + c.x;
        if (length(d) < 0.78 && order > best) { best = order; bestD = d; }
      }
    }
    float r = length(bestD) + 1e-4;
    vec2 dir = bestD / r;
    float rings = sin(r * 6.2831 * 9.0);
    vec2 s = dir * rings * 0.09 + vec2(-dir.y, dir.x) * 0.12 * (r / 0.78);
    patSlope += s * uPerK * patMask;
    roughnessFactor = mix(roughnessFactor, roughnessFactor * (0.8 + 0.25 * r), patMask);
  }`);
  st.fragNormal.push('normal = normalize(normal + vTX * patSlope.x + vTZ * patSlope.y);');
  st.keys.push('perlage');
  return st.uniforms;
}

/**
 * Dissolvenza a rumore con bordo luminoso (per "attraversare" un oggetto, es. la corona).
 * uniforms.uDissolve: 0 = intero, 1 = sparito.
 */
export function patchDissolve(material, { scale = 0.35, edge = 0xffc890 } = {}) {
  const st = patchState(material);
  useObjSpace(st);
  st.uniforms.uDissolve = { value: 0 };
  st.uniforms.uDisScale = { value: scale };
  st.uniforms.uDisEdge = { value: new THREE.Color(edge) };
  st.fragDecl.push(`
uniform float uDissolve; uniform float uDisScale; uniform vec3 uDisEdge;
float disNoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float n000 = patHash(i.xy + i.z * 17.0), n100 = patHash(i.xy + vec2(1.0, 0.0) + i.z * 17.0);
  float n010 = patHash(i.xy + vec2(0.0, 1.0) + i.z * 17.0), n110 = patHash(i.xy + vec2(1.0, 1.0) + i.z * 17.0);
  float n001 = patHash(i.xy + (i.z + 1.0) * 17.0), n101 = patHash(i.xy + vec2(1.0, 0.0) + (i.z + 1.0) * 17.0);
  float n011 = patHash(i.xy + vec2(0.0, 1.0) + (i.z + 1.0) * 17.0), n111 = patHash(i.xy + vec2(1.0, 1.0) + (i.z + 1.0) * 17.0);
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}`);
  st.fragRough.push(`
  float disN = 0.65 * disNoise(vObjPos * uDisScale) + 0.35 * disNoise(vObjPos * uDisScale * 3.1);
  if (uDissolve > 0.001 && disN < uDissolve * 1.08) discard;
  float disEdge = uDissolve > 0.001 ? 1.0 - smoothstep(0.0, 0.07, disN - uDissolve * 1.08) : 0.0;`);
  st.fragEmissive.push('totalEmissiveRadiance += uDisEdge * disEdge * 3.2;');
  st.keys.push('dissolve');
  return st.uniforms;
}

/**
 * Bagliore di evidenziazione (rim light + emissione), comandato da uniforms.uHL (0..1).
 * Restituisce gli uniform da animare.
 */
export function patchHighlight(material, color = 0xffd8b4) {
  const st = patchState(material);
  if (st.uniforms.uHL) return st.uniforms;
  st.uniforms.uHL = { value: 0 };
  st.uniforms.uHLColor = { value: new THREE.Color(color) };
  st.fragDecl.push('uniform float uHL; uniform vec3 uHLColor;');
  st.fragEmissive.push(`
  {
    float rim = 1.0 - abs(dot(normalize(vViewPosition), normal));
    totalEmissiveRadiance += uHLColor * uHL * (0.035 + 0.75 * pow(rim, 2.6));
  }`);
  st.keys.push('hl');
  return st.uniforms;
}

// ---------------------------------------------------------------------------------------------
// Tangenti per l'anisotropia (spazzolatura): circolare attorno all'asse Y o lineare.
// ---------------------------------------------------------------------------------------------

export function addCircularTangents(geometry) {
  const pos = geometry.attributes.position;
  const t = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const l = Math.hypot(x, z);
    // sull'asse la direzione circolare non è definita: tangente di riserva (evita NaN nello shader)
    t[i * 4] = l > 1e-5 ? -z / l : 1;
    t[i * 4 + 1] = 0;
    t[i * 4 + 2] = l > 1e-5 ? x / l : 0;
    t[i * 4 + 3] = 1;
  }
  geometry.setAttribute('tangent', new THREE.BufferAttribute(t, 4));
  return geometry;
}

export function addLinearTangents(geometry, dir = new THREE.Vector3(1, 0, 0)) {
  const pos = geometry.attributes.position;
  const nrm = geometry.attributes.normal;
  const t = new Float32Array(pos.count * 4);
  const n = new THREE.Vector3();
  const tan = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(nrm, i);
    // proietta la direzione di spazzolatura sul piano della faccia
    tan.copy(dir).addScaledVector(n, -dir.dot(n));
    if (tan.lengthSq() < 1e-6) tan.set(0, 1, 0).addScaledVector(n, -n.y);
    tan.normalize();
    t[i * 4] = tan.x;
    t[i * 4 + 1] = tan.y;
    t[i * 4 + 2] = tan.z;
    t[i * 4 + 3] = 1;
  }
  geometry.setAttribute('tangent', new THREE.BufferAttribute(t, 4));
  return geometry;
}

// ---------------------------------------------------------------------------------------------
// Preset di materiali (colori metallici = riflettanza F0 in sRGB)
// ---------------------------------------------------------------------------------------------

export const Mat = {
  steelSatin: (o = {}) =>
    new THREE.MeshPhysicalMaterial({ color: 0xc8cbd0, metalness: 1, roughness: 0.3, anisotropy: 0.7, ...o }),
  steelBrushed: (o = {}) =>
    new THREE.MeshStandardMaterial({ color: 0xc4c7cc, metalness: 1, roughness: 0.36, ...o }),
  steelPolished: (o = {}) =>
    new THREE.MeshStandardMaterial({ color: 0xdfe1e4, metalness: 1, roughness: 0.06, ...o }),
  rhodium: (o = {}) =>
    new THREE.MeshStandardMaterial({ color: 0xa4a8ae, metalness: 1, roughness: 0.42, ...o }),
  plate: (o = {}) =>
    new THREE.MeshStandardMaterial({ color: 0x8d9097, metalness: 1, roughness: 0.48, ...o }),
  roseGold: (o = {}) =>
    new THREE.MeshStandardMaterial({ color: 0xe9ab8f, metalness: 1, roughness: 0.3, ...o }),
  roseGoldPolished: (o = {}) =>
    new THREE.MeshStandardMaterial({ color: 0xf0b9a0, metalness: 1, roughness: 0.1, ...o }),
  glucydur: (o = {}) =>
    new THREE.MeshStandardMaterial({ color: 0xe9c486, metalness: 1, roughness: 0.22, ...o }),
  brass: (o = {}) =>
    new THREE.MeshStandardMaterial({ color: 0xd9b56e, metalness: 1, roughness: 0.3, ...o }),
  bluedSteel: (o = {}) =>
    new THREE.MeshStandardMaterial({ color: 0x2a4fae, metalness: 1, roughness: 0.18, ...o }),
  darkSteel: (o = {}) =>
    new THREE.MeshStandardMaterial({ color: 0x3a3c42, metalness: 1, roughness: 0.32, ...o }),
  ruby: (o = {}) =>
    new THREE.MeshPhysicalMaterial({
      color: 0xc0122f,
      metalness: 0,
      roughness: 0.06,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      ior: 1.76,
      specularIntensity: 1,
      emissive: 0x5a0614,
      emissiveIntensity: 0.9,
      ...o,
    }),
  lacquer: (color, o = {}) =>
    new THREE.MeshPhysicalMaterial({ color, metalness: 0, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.035, ...o }),
};

// Rende uniche (clonandole) le istanze di materiale di un oggetto: serve perché l'evidenziazione
// di un hotspot non accenda anche altri oggetti che condividono lo stesso materiale.
export function uniqueMaterials(root) {
  const map = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map((m) => {
      if (!map.has(m)) {
        const c = m.clone();
        if (m.userData._patch) {
          // ricrea le patch sul clone condividendo gli stessi uniform di finitura
          c.userData = {};
          const src = m.userData._patch;
          const st = patchState(c);
          Object.assign(st.uniforms, Object.fromEntries(Object.entries(src.uniforms).filter(([k]) => !k.startsWith('uHL'))));
          src.vertDecl.forEach((v) => st.vertDecl.add(v));
          src.vertMain.forEach((v) => st.vertMain.add(v));
          st.fragDecl.push(...src.fragDecl.filter((d) => !d.includes('uHL')));
          st.fragRough.push(...src.fragRough);
          st.fragNormal.push(...src.fragNormal);
          st.keys.push(...src.keys.filter((k) => k !== 'hl'));
        }
        map.set(m, c);
      }
      return map.get(m);
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
  return root;
}

// Raccoglie i materiali (unici) di uno o più oggetti e vi applica la patch di evidenziazione.
export function highlightTargets(objects, color) {
  const mats = new Set();
  const list = Array.isArray(objects) ? objects : [objects];
  list.forEach((obj) =>
    obj.traverse((o) => {
      if (!o.isMesh) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
    }),
  );
  return [...mats].map((m) => patchHighlight(m, color));
}
