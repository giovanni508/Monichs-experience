import * as THREE from 'three';
import { Mat, patchCustom } from './materials.js';
import { textPlane } from './effects.js';
import { pictogramMesh } from '../worlds/movement/parts.js';

// ---------------------------------------------------------------------------------------------
// Quadranti procedurali della Collezione Delta (piano XY, rivolti verso +Z).
//  - celeste: lacca blu sopra un motivo a triangoli (il "delta")
//  - sunset: agata con bande generate da un seme (ogni seme = un quadrante diverso)
//  - virentia: lacca verde sopra un'incisione a foglie/piume
// Indici applicati con inserti luminescenti, lancette sull'ora reale; i secondi avanzano a scatti
// di 1/8 di secondo, come in un calibro a 28.800 alternanze/ora.
// ---------------------------------------------------------------------------------------------

const PATTERN_COMMON = /* glsl */ `
float dHash(vec2 p) { return fract(sin(dot(p, vec2(41.37, 289.11))) * 45758.5453); }
vec2 dHash2(vec2 p) { return vec2(dHash(p), dHash(p + 19.19)); }
float dNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(dHash(i), dHash(i + vec2(1.0, 0.0)), f.x), mix(dHash(i + vec2(0.0, 1.0)), dHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float dFbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * dNoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return v; }
float triH(vec2 p) {
  vec2 s = vec2(p.x - p.y * 0.57735, p.y * 1.1547);
  vec2 f = fract(s);
  float up = step(1.0, f.x + f.y);
  vec3 b = up < 0.5 ? vec3(1.0 - f.x - f.y, f.x, f.y) : vec3(f.x + f.y - 1.0, 1.0 - f.y, 1.0 - f.x);
  float m = min(b.x, min(b.y, b.z));
  return smoothstep(0.0, 0.08, m) * 0.55 + m * 0.8;
}`;

const PATTERNS = {
  celeste: {
    rough: /* glsl */ `
  vec2 dSlope = vec2(0.0);
  {
    vec2 p = vObjPos.xy / uTri;
    float e = 0.012;
    float h0 = triH(p);
    dSlope = vec2(triH(p + vec2(e, 0.0)) - h0, triH(p + vec2(0.0, e)) - h0) / e * 0.11;
    float groove = smoothstep(0.0, 0.07, h0);
    diffuseColor.rgb *= 0.62 + 0.38 * groove;
  }`,
  },
  virentia: {
    rough: /* glsl */ `
  vec2 dSlope = vec2(0.0);
  {
    vec2 p = vObjPos.xy / uLeaf;
    vec2 g = floor(p); vec2 f = fract(p);
    float md = 8.0; vec2 mr = vec2(0.0); vec2 mg = vec2(0.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 r = o + dHash2(g + o) - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g + o; }
    }
    float ang = dHash(mg) * 6.2831;
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 perp = vec2(-dir.y, dir.x);
    float along = dot(mr, dir);
    float across = dot(mr, perp) + along * along * 0.9;
    float freq = 34.0;
    float gr = sin(across * freq);
    float fade = 1.0 - smoothstep(0.2, 0.85, sqrt(md));
    dSlope = (vec2(perp.x, perp.y) * cos(across * freq) * 0.22) * (0.35 + 0.65 * fade);
    diffuseColor.rgb *= 0.78 + 0.22 * (0.5 + 0.5 * gr) * fade + 0.1 * dHash(mg);
  }`,
  },
  sunset: {
    rough: /* glsl */ `
  vec2 dSlope = vec2(0.0);
  {
    vec2 p = vObjPos.xy / uAgScale;
    vec2 q = p * 0.45 + uSeed * 13.7;
    vec2 w = vec2(dFbm(q + vec2(1.7, 9.2)), dFbm(q + vec2(8.3, 2.8)));
    // bande ampie e morbide, come strati di calcedonio tagliati di sbieco
    vec2 c = p + (w - 0.5) * 1.5 + vec2(sin(uSeed * 3.1), cos(uSeed * 2.3)) * 1.6;
    float d = length(c * vec2(1.0, 0.55 + 0.9 * fract(uSeed * 7.3)));
    float bands = d * 2.4 + dFbm(q * 1.3) * 0.9;
    float b = fract(bands);
    float idx = floor(bands);
    float r = dHash(vec2(idx, uSeed));
    vec3 col = mix(uAgA, uAgB, smoothstep(0.1, 0.9, r));
    col = mix(col, uAgC, smoothstep(0.86, 0.98, b) * step(0.45, dHash(vec2(idx + 3.0, uSeed))) * 0.7);
    float fine = 0.5 + 0.5 * sin(bands * 6.2831 * 4.0);
    col *= 0.92 + 0.08 * fine;
    diffuseColor.rgb = col;
    dSlope = vec2(0.0);
  }`,
  },
};

export function dialMaterial(style, { seed = 1, radius = 40, color } = {}) {
  const base = {
    celeste: 0x1f4fd2,
    virentia: 0x3c8f37,
    sunset: 0xc0391b,
  }[style];
  const mat = new THREE.MeshPhysicalMaterial({
    color: color ?? base,
    roughness: style === 'sunset' ? 0.18 : 0.42,
    metalness: style === 'sunset' ? 0.0 : 0.15,
    clearcoat: 1,
    clearcoatRoughness: style === 'sunset' ? 0.02 : 0.04,
    sheen: style === 'sunset' ? 0.25 : 0,
    sheenColor: new THREE.Color(0xffc8a0),
  });
  const uniforms = {
    uTri: { value: radius * 0.06 },
    uLeaf: { value: radius * 0.085 },
    uAgScale: { value: radius * 0.42 },
    uSeed: { value: seed },
    uAgA: { value: new THREE.Color(0x9c1c0c) },
    uAgB: { value: new THREE.Color(0xd94a1a) },
    uAgC: { value: new THREE.Color(0xf6c8a0) },
  };
  patchCustom(mat, {
    key: `dial-${style}`,
    uniforms,
    fragDecl: `uniform float uTri; uniform float uLeaf; uniform float uAgScale; uniform float uSeed; uniform vec3 uAgA; uniform vec3 uAgB; uniform vec3 uAgC;\n${PATTERN_COMMON}`,
    fragRough: PATTERNS[style].rough,
    fragNormal: 'normal = normalize(normal + vTX * dSlope.x + vTY * dSlope.y);',
  });
  mat.userData.dialUniforms = uniforms;
  return mat;
}

// ---------------------------------------------------------------------------------------------

function trapezoid(len, wOuter, wInner) {
  // lungo X (dall'interno all'esterno), centrato sullo 0 in Y
  return new THREE.Shape([
    new THREE.Vector2(0, -wInner / 2),
    new THREE.Vector2(len, -wOuter / 2),
    new THREE.Vector2(len, wOuter / 2),
    new THREE.Vector2(0, wInner / 2),
  ]);
}

function handShape(len, width, tail = 0) {
  // spada/bastone con punta sfaccettata
  return new THREE.Shape([
    new THREE.Vector2(-width * 0.35, -tail),
    new THREE.Vector2(width * 0.35, -tail),
    new THREE.Vector2(width * 0.5, len * 0.1),
    new THREE.Vector2(width * 0.5, len * 0.86),
    new THREE.Vector2(0, len),
    new THREE.Vector2(-width * 0.5, len * 0.86),
    new THREE.Vector2(-width * 0.5, len * 0.1),
  ]);
}

/**
 * Quadrante completo.
 * @returns {{ group, update(dt), setNight(f), discMat, lumeMat }}
 */
export function buildDial({
  radius = 40,
  style = 'celeste',
  seed = 1,
  name = 'CELESTE',
  accent = 'steel', // 'steel' | 'rose'
  lumeColor = 0x6ff4ff,
  flangeColor,
  hands = true,
  timeOffset = 0,
} = {}) {
  const R = radius;
  const g = new THREE.Group();
  const discMat = dialMaterial(style, { seed, radius: R });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 160), discMat);
  g.add(disc);

  // rehaut inclinato con minuteria
  const flangeMat = new THREE.MeshPhysicalMaterial({
    color: flangeColor ?? { celeste: 0x1d47c4, virentia: 0x2e6e2c, sunset: 0xd2461c }[style],
    roughness: 0.35,
    clearcoat: 0.8,
    clearcoatRoughness: 0.08,
    side: THREE.DoubleSide,
  });
  const flangeGeo = new THREE.CylinderGeometry(R * 1.1, R, R * 0.07, 160, 1, true);
  flangeGeo.rotateX(Math.PI / 2);
  const flange = new THREE.Mesh(flangeGeo, flangeMat);
  flange.position.z = R * 0.035;
  g.add(flange);
  const ticks = [];
  for (let i = 0; i < 60; i++) {
    if (i % 5 === 0) continue;
    const a = (i / 60) * Math.PI * 2;
    const r0 = R * 1.03;
    const r1 = R * 1.075;
    ticks.push(Math.sin(a) * r0, Math.cos(a) * r0, R * 0.033, Math.sin(a) * r1, Math.cos(a) * r1, R * 0.052);
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
  g.add(new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0xf2f0ea })));

  // materiali di indici e lancette
  const metal = accent === 'rose' ? Mat.roseGoldPolished({ color: 0xf2b39a, roughness: 0.08 }) : Mat.steelPolished({ color: 0xeef0f3, roughness: 0.05 });
  const lumeMat = new THREE.MeshStandardMaterial({ color: 0xf1f3ee, roughness: 0.55, metalness: 0, emissive: new THREE.Color(lumeColor), emissiveIntensity: 0 });

  // indici applicati (12): trapezi sfaccettati con inserto luminescente
  const idxLen = R * 0.2;
  const idxGeo = new THREE.ExtrudeGeometry(trapezoid(idxLen, R * 0.075, R * 0.06), { depth: R * 0.03, bevelEnabled: true, bevelThickness: R * 0.012, bevelSize: R * 0.012, bevelSegments: 1 });
  const lumeGeo = new THREE.ExtrudeGeometry(trapezoid(idxLen * 0.82, R * 0.045, R * 0.035), { depth: R * 0.012, bevelEnabled: false });
  const idxMesh = new THREE.InstancedMesh(idxGeo, metal, 12);
  const lumeMesh = new THREE.InstancedMesh(lumeGeo, lumeMat, 12);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const rot = new THREE.Matrix4().makeRotationZ(Math.PI / 2 - a);
    m4.makeTranslation(R * 0.68, 0, R * 0.004).premultiply(rot);
    idxMesh.setMatrixAt(i, m4);
    const ml = new THREE.Matrix4().makeTranslation(R * 0.68 + idxLen * 0.09, 0, R * 0.047).premultiply(rot);
    lumeMesh.setMatrixAt(i, ml);
  }
  g.add(idxMesh, lumeMesh);

  // pittogramma e scritte (come sul quadrante reale)
  const logoMat = accent === 'rose' ? metal : Mat.steelPolished({ color: 0xf4f5f7, roughness: 0.06 });
  const logo = pictogramMesh(R * 0.15, logoMat, R * 0.012);
  logo.position.set(0, R * 0.42, R * 0.004);
  g.add(logo);
  const brand = textPlane([{ text: 'MONICHS', font: '500 120px Montserrat', letterSpacing: 18, color: '#f4f2ee' }], { width: 1024, height: 200, size: R * 0.42 });
  brand.position.set(0, R * 0.27, R * 0.006);
  g.add(brand);
  const model = textPlane(
    [
      { text: name, font: '600 118px Montserrat', letterSpacing: 10, color: '#f4f2ee', y: 70 },
      { text: 'AUTOMATIC', font: '600 62px Montserrat', letterSpacing: 6, color: '#f4f2ee', y: 160 },
    ],
    { width: 1024, height: 220, size: R * 0.42 },
  );
  model.position.set(0, -R * 0.38, R * 0.006);
  g.add(model);
  const swiss = textPlane([{ text: 'SWISS            MADE', font: '500 54px Montserrat', letterSpacing: 8, color: '#eceae4' }], { width: 1024, height: 120, size: R * 0.5 });
  swiss.position.set(0, -R * 0.93, R * 0.03);
  g.add(swiss);

  // lancette
  const handGroup = new THREE.Group();
  let hourH;
  let minH;
  let secH;
  if (hands) {
    const mk = (len, width, z, tail = 0) => {
      const h = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ExtrudeGeometry(handShape(len, width, tail), { depth: R * 0.012, bevelEnabled: true, bevelThickness: R * 0.006, bevelSize: R * 0.005, bevelSegments: 1 }), metal);
      h.add(body);
      const ins = new THREE.Mesh(new THREE.ExtrudeGeometry(handShape(len * 0.62, width * 0.52), { depth: R * 0.004, bevelEnabled: false }), lumeMat);
      ins.position.set(0, len * 0.3, R * 0.02);
      h.add(ins);
      h.position.z = z;
      handGroup.add(h);
      return h;
    };
    hourH = mk(R * 0.52, R * 0.085, R * 0.06);
    minH = mk(R * 0.84, R * 0.065, R * 0.085);
    // secondi: ago sottile con triangolo luminoso e contrappeso
    secH = new THREE.Group();
    const needle = new THREE.Mesh(new THREE.BoxGeometry(R * 0.012, R * 1.1, R * 0.008), metal);
    needle.position.y = R * 0.35;
    secH.add(needle);
    const triShape = new THREE.Shape([new THREE.Vector2(-R * 0.035, 0), new THREE.Vector2(R * 0.035, 0), new THREE.Vector2(0, R * 0.08)]);
    const tri = new THREE.Mesh(new THREE.ExtrudeGeometry(triShape, { depth: R * 0.008, bevelEnabled: false }), lumeMat);
    tri.position.set(0, R * 0.7, R * 0.002);
    secH.add(tri);
    secH.position.z = R * 0.11;
    handGroup.add(secH);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.035, R * 0.035, R * 0.05, 32), metal);
    cap.rotation.x = Math.PI / 2;
    cap.position.z = R * 0.11;
    handGroup.add(cap);
  }
  g.add(handGroup);

  let night = 0;
  const api = {
    group: g,
    discMat,
    lumeMat,
    metal,
    timeOffset,
    update() {
      if (!hands) return;
      const d = new Date(Date.now() + api.timeOffset * 1000);
      const s = d.getSeconds() + Math.floor((d.getMilliseconds() / 1000) * 8) / 8; // 8 scatti al secondo
      const m = d.getMinutes() + s / 60;
      const h = (d.getHours() % 12) + m / 60;
      secH.rotation.z = -(s / 60) * Math.PI * 2;
      minH.rotation.z = -(m / 60) * Math.PI * 2;
      hourH.rotation.z = -(h / 12) * Math.PI * 2;
    },
    setNight(f) {
      night = f;
      lumeMat.emissiveIntensity = f * 2.6;
      lumeMat.color.setScalar(1 - f * 0.55);
    },
    get night() {
      return night;
    },
  };
  api.update();
  return api;
}
