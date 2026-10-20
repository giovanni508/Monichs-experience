import * as THREE from 'three';
import { patchCustom } from './materials.js';

// ---------------------------------------------------------------------------------------------
// Agata procedurale 3D: bande concentriche deformate dal rumore (strati di silice depositati nel
// tempo), mescolate con la texture reale delle bande (macro del quadrante Sunset). Un seme diverso
// produce venature diverse: ogni visita genera un'agata che non esisteva prima.
// La traslucenza è simulata: la pietra si accende quando si guarda verso la luce che la attraversa.
// ---------------------------------------------------------------------------------------------

const AGATE_GLSL = /* glsl */ `
uniform float uAgSeed;
uniform float uAgScale;
uniform vec3 uAgC0;
uniform vec3 uAgC1;
uniform vec3 uAgC2;
uniform vec3 uAgC3;
uniform vec3 uAgC4;
uniform vec3 uAgC5;
uniform sampler2D uAgTex;
uniform float uAgTexMix;
uniform float uAgGlow;
uniform vec3 uAgLightDir;
uniform float uAgDark;
float agH(float n) { return fract(sin(n * 127.1 + 31.7) * 43758.5453); }
float agN3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float n = i.x + i.y * 57.0 + i.z * 113.0;
  return mix(mix(mix(agH(n), agH(n + 1.0), f.x), mix(agH(n + 57.0), agH(n + 58.0), f.x), f.y),
             mix(mix(agH(n + 113.0), agH(n + 114.0), f.x), mix(agH(n + 170.0), agH(n + 171.0), f.x), f.y), f.z);
}
float agF3(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { v += a * agN3(p); p = p * 2.07 + 3.1; a *= 0.5; } return v; }
`;

const AGATE_ROUGH = /* glsl */ `
  float agBand = 0.0;
  vec3 agCol = vec3(0.0);
  {
    vec3 p = vObjPos * uAgScale;
    vec3 q = p * 0.9 + uAgSeed * 7.31;
    vec3 w = vec3(agF3(q), agF3(q + 5.2), agF3(q + 9.7));
    vec3 c = p + (w - 0.5) * 4.6 + vec3(sin(uAgSeed * 2.1), cos(uAgSeed * 1.7), sin(uAgSeed * 3.3)) * 1.5;
    float d = length(c * vec3(1.0, 1.45, 1.0));
    float bands = d * 3.4 + agF3(q * 2.3) * 2.6 + agF3(q * 6.1) * 0.35;
    float idx = floor(bands);
    float b = fract(bands);
    agBand = b;
    float r = agH(idx + floor(uAgSeed * 10.0));
    float r2 = agH(idx * 1.37 + 11.0 + floor(uAgSeed * 3.0));
    vec3 col = mix(uAgC0, uAgC1, smoothstep(0.12, 0.9, r));
    col = mix(col, uAgC4, step(0.78, r2) * 0.55);            // bande ambra / oro
    col = mix(col, uAgC5, step(0.9, agH(idx + 23.0)) * 0.3); // qualche banda rosa-violetto
    float line = step(0.55, agH(idx + 7.0));                   // solo alcune bande hanno il filo chiaro
    col = mix(col, uAgC2, smoothstep(0.9, 0.985, b) * line * 0.8);
    col = mix(col, uAgC3, smoothstep(0.06, 0.0, b) * 0.3);
    col *= 0.9 + 0.1 * sin(bands * 18.85);                    // sottostrati sottilissimi
    // dettaglio reale: la texture delle bande del quadrante Sunset
    vec2 tuv = vec2(vObjPos.x + vObjPos.z * 0.7, vObjPos.y * 2.2) * uAgScale * 0.22 + vec2(bands * 0.04, 0.0);
    vec3 tex = texture2D(uAgTex, tuv).rgb;
    col = mix(col, col * 0.55 + tex * 0.75, uAgTexMix);
    agCol = col * (1.0 - uAgDark);
    diffuseColor.rgb = agCol;
  }`;

const AGATE_EMISSIVE = /* glsl */ `
  {
    vec3 V = normalize(vViewPosition);
    vec3 L = normalize((viewMatrix * vec4(uAgLightDir, 0.0)).xyz);
    float back = pow(max(0.0, dot(-V, L) * 0.5 + 0.5), 3.0);
    float thin = 0.35 + 0.65 * smoothstep(0.6, 1.0, agBand);
    totalEmissiveRadiance += agCol * uAgGlow * (0.18 + 1.6 * back) * thin;
  }`;

export const SUNSET_PALETTE = {
  c0: 0x8d1a0d, // corniola profonda
  c1: 0xe0561e, // arancio
  c2: 0xf7d2b0, // linee chiare di calcedonio
  c3: 0x2a0905, // giunzioni scure
  c4: 0xf0a24c, // ambra / oro
  c5: 0xb05878, // rosa-violetto del crepuscolo
};

export function agateMaterial({ seed = 1, texture = null, scale = 0.05, glow = 0.35, dark = 0, roughness = 0.22, clearcoat = 0.8, lightDir = new THREE.Vector3(0, 0.35, -1), palette = SUNSET_PALETTE, side = THREE.FrontSide } = {}) {
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness, metalness: 0, clearcoat, clearcoatRoughness: 0.06, side });
  const uniforms = {
    uAgSeed: { value: seed },
    uAgScale: { value: scale },
    uAgC0: { value: new THREE.Color(palette.c0) },
    uAgC1: { value: new THREE.Color(palette.c1) },
    uAgC2: { value: new THREE.Color(palette.c2) },
    uAgC3: { value: new THREE.Color(palette.c3) },
    uAgC4: { value: new THREE.Color(palette.c4 ?? palette.c1) },
    uAgC5: { value: new THREE.Color(palette.c5 ?? palette.c0) },
    uAgTex: { value: texture },
    uAgTexMix: { value: texture ? 0.4 : 0 },
    uAgGlow: { value: glow },
    uAgLightDir: { value: lightDir.clone().normalize() },
    uAgDark: { value: dark },
  };
  patchCustom(mat, { key: 'agate', uniforms, fragDecl: AGATE_GLSL, fragRough: AGATE_ROUGH, fragEmissive: AGATE_EMISSIVE });
  mat.userData.agate = uniforms;
  return mat;
}
