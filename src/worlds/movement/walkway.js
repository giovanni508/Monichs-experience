import * as THREE from 'three';
import { Mat, patchCotesCircular, patchPerlage } from '../../gfx/materials.js';

// Passerelle "da orologiaio" sospese nel calibro: pavimento in vetro zaffiro (si vedono le ruote
// sotto i piedi), longheroni in acciaio lucidato, corrimano in oro rosa, filetti di luce sui bordi
// che si accendono lungo il percorso.

const TAU = Math.PI * 2;

// Vetro zaffiro: quasi invisibile guardando in basso, riflette un poco di taglio (Fresnel).
// Riflessi contenuti: a fil di pavimento non deve diventare un piano lattiginoso.
export function sapphireMaterial({ tint = 0xe6eef8, base = 0.05, fres = 0.4 } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: tint,
    metalness: 0,
    roughness: 0.12,
    envMapIntensity: 0.9,
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
    float f = pow(1.0 - facing, 4.0);
    gl_FragColor.a = clamp(${base.toFixed(3)} + f * ${fres.toFixed(3)}, 0.0, 0.6);
  }`,
    );
  };
  mat.customProgramCacheKey = () => `sapphire${base}-${fres}`;
  return mat;
}

const stripVert = /* glsl */ `
attribute float aS;
varying float vS;
varying float vAcross;
#include <fog_pars_vertex>
void main() {
  vS = aS;
  vAcross = uv.y;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const stripFrag = /* glsl */ `
uniform float uReveal;
uniform float uTime;
uniform vec3 uColor;
uniform float uIntensity;
varying float vS;
varying float vAcross;
#include <fog_pars_fragment>
void main() {
  float on = 1.0 - smoothstep(uReveal - 2.5, uReveal, vS);
  float head = exp(-abs(vS - uReveal) * 0.45) * (1.0 - step(uReveal + 0.6, vS));
  float across = sin(clamp(vAcross, 0.0, 1.0) * 3.14159);
  float flow = 0.82 + 0.18 * sin(vS * 0.55 - uTime * 1.6);
  vec3 c = uColor * uIntensity * across * (on * flow + head * 1.8);
  gl_FragColor = vec4(c, 1.0);
  #include <fog_fragment>
}`;

export function stripMaterial(color = 0xffd9b4, intensity = 1.4) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uReveal: { value: 1e6 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uIntensity: { value: intensity } },
    ]),
    vertexShader: stripVert,
    fragmentShader: stripFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
}

// ------------------------------------------------------------------ geometria lungo una polilinea

// Bordi sinistro/destro con giunti a mitra; s = distanza percorsa (nel piano)
function edges(points) {
  const n = points.length;
  const out = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    if (i > 0) s += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    let dinx = i > 0 ? p.x - a.x : b.x - p.x;
    let dinz = i > 0 ? p.z - a.z : b.z - p.z;
    let doutx = i < n - 1 ? b.x - p.x : dinx;
    let doutz = i < n - 1 ? b.z - p.z : dinz;
    let l = Math.hypot(dinx, dinz) || 1;
    dinx /= l;
    dinz /= l;
    l = Math.hypot(doutx, doutz) || 1;
    doutx /= l;
    doutz /= l;
    let tx = dinx + doutx;
    let tz = dinz + doutz;
    l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    // sinistra di una direzione (dx, dz) è (dz, -dx)
    const cosHalf = Math.max(0.4, tx * dinx + tz * dinz);
    const lx = tz / cosHalf;
    const lz = -tx / cosHalf;
    out.push({ p, s, lx, lz, tx, tz });
  }
  return out;
}

// Striscia (quad) tra due linee parallele: across ∈ [a0, a1] (0 = asse, + = sinistra), alla quota dy
function ribbon(E, a0, a1, dy, { flipNormal = false, withS = false, wScale = true } = {}) {
  const pos = [];
  const uv = [];
  const sAttr = [];
  const idx = [];
  E.forEach((e, i) => {
    const w = wScale ? e.p.w : 1;
    for (const [k, a] of [[0, a0], [1, a1]]) {
      const off = typeof a === 'function' ? a(e) : a * w;
      pos.push(e.p.x + e.lx * off, e.p.y + dy, e.p.z + e.lz * off);
      uv.push(e.s, k);
      sAttr.push(e.s);
    }
    if (i < E.length - 1) {
      const q = i * 2;
      if (flipNormal) idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
      else idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (withS) geo.setAttribute('aS', new THREE.Float32BufferAttribute(sAttr, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Profilo chiuso estruso lungo un bordo: profile = [[across, up], ...] relativo al bordo
function sweepProfile(E, side, profile, offsetFromEdge) {
  const pos = [];
  const idx = [];
  const np = profile.length;
  E.forEach((e) => {
    const base = side * (e.p.w - offsetFromEdge);
    for (const [ac, up] of profile) {
      const off = base - side * ac;
      pos.push(e.p.x + e.lx * off, e.p.y + up, e.p.z + e.lz * off);
    }
  });
  for (let i = 0; i < E.length - 1; i++) {
    for (let j = 0; j < np; j++) {
      const a = i * np + j;
      const b = i * np + ((j + 1) % np);
      const c = (i + 1) * np + j;
      const d = (i + 1) * np + ((j + 1) % np);
      if (side > 0) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

function inGaps(s, gaps) {
  return gaps.some(([a, b]) => s > a && s < b);
}

// Spezza un bordo in tratti continui fuori dai varchi
function runs(E, gaps) {
  const out = [];
  let cur = [];
  E.forEach((e) => {
    if (inGaps(e.s, gaps)) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    } else cur.push(e);
  });
  if (cur.length > 1) out.push(cur);
  return out;
}

const materialsCache = {};
export function walkwayMaterials() {
  if (materialsCache.glass) return materialsCache;
  materialsCache.glass = sapphireMaterial();
  // DoubleSide: profili estrusi e toroidi non dipendono dal verso dei triangoli
  materialsCache.beam = Mat.steelPolished({ color: 0xd5d8dd, roughness: 0.14, side: THREE.DoubleSide });
  materialsCache.rib = Mat.rhodium({ color: 0x9ea2a9, roughness: 0.36 });
  materialsCache.post = Mat.steelPolished({ color: 0xdfe1e4, roughness: 0.08 });
  materialsCache.rail = Mat.roseGoldPolished({ color: 0xefb79d, roughness: 0.16, side: THREE.DoubleSide });
  return materialsCache;
}

/**
 * Passerella lungo points [{x, y (pavimento), z, w (semilarghezza)}].
 * gaps: { left: [[s0, s1]], right: [...] } tratti senza corrimano (innesti); caps: ringhiera alle estremità.
 */
export function buildWalkway(points, { gaps = {}, capStart = false, capEnd = false, strip } = {}) {
  const M = walkwayMaterials();
  const E = edges(points);
  const g = new THREE.Group();
  const length = E[E.length - 1].s;

  // pavimento in zaffiro
  const glass = new THREE.Mesh(ribbon(E, -1, 1, 0, { flipNormal: true }), M.glass);
  glass.renderOrder = 2;
  g.add(glass);

  // longheroni lucidi (profilo rettangolare, facce piane) sui due bordi
  const beamProfile = [[0, 0.07], [0.3, 0.07], [0.3, -0.38], [0, -0.38]];
  for (const side of [1, -1]) {
    const geo = sweepProfile(E, side, beamProfile, 0).toNonIndexed();
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, M.beam));
  }

  // traversine sottili sotto il vetro, ogni ~4 unità
  const ribs = [];
  for (let s = 2; s < length - 0.5; s += 4) ribs.push(s);
  const ribGeo = new THREE.BoxGeometry(1, 0.06, 0.1);
  const ribMesh = new THREE.InstancedMesh(ribGeo, M.rib, Math.max(1, ribs.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sAt = (s) => {
    // interpolazione lungo il percorso
    for (let i = 0; i < E.length - 1; i++) {
      if (s <= E[i + 1].s) {
        const k = (s - E[i].s) / Math.max(1e-6, E[i + 1].s - E[i].s);
        const a = E[i];
        const b = E[i + 1];
        return {
          x: a.p.x + (b.p.x - a.p.x) * k,
          y: a.p.y + (b.p.y - a.p.y) * k,
          z: a.p.z + (b.p.z - a.p.z) * k,
          w: a.p.w + (b.p.w - a.p.w) * k,
          dx: b.p.x - a.p.x,
          dz: b.p.z - a.p.z,
        };
      }
    }
    const e = E[E.length - 1];
    return { x: e.p.x, y: e.p.y, z: e.p.z, w: e.p.w, dx: e.tx, dz: e.tz };
  };
  ribs.forEach((s, i) => {
    const r = sAt(s);
    // l'asse X del listello va lungo la "sinistra" del percorso, (dz, -dx)
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(r.dx, r.dz));
    m.compose(new THREE.Vector3(r.x, r.y - 0.16, r.z), q, new THREE.Vector3(r.w * 2 - 0.5, 1, 1));
    ribMesh.setMatrixAt(i, m);
  });
  g.add(ribMesh);

  // montanti e corrimano
  const postH = 1.05;
  const inset = 0.15;
  const posts = [];
  const railGeos = [];
  for (const [side, key] of [[1, 'left'], [-1, 'right']]) {
    const sideGaps = gaps[key] || [];
    const step = 2.6;
    for (let s = 0.4; s <= length - 0.3; s += step) {
      if (inGaps(s, sideGaps)) continue;
      const r = sAt(s);
      const l = Math.hypot(r.dx, r.dz) || 1;
      const lx = r.dz / l;
      const lz = -r.dx / l;
      posts.push(new THREE.Vector3(r.x + lx * side * (r.w - inset), r.y + postH / 2 + 0.06, r.z + lz * side * (r.w - inset)));
    }
    for (const run of runs(E, sideGaps)) {
      const circle = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        circle.push([Math.cos(a) * 0.065, Math.sin(a) * 0.065 + postH + 0.06]);
      }
      railGeos.push(sweepProfile(run, side, circle, inset));
    }
  }
  const capRail = (e, which, target = null) => {
    // ringhiera trasversale a un'estremità
    const pts = [];
    for (let k = -1; k <= 1; k += 0.25) pts.push({ p: { x: e.p.x + e.lx * e.p.w * k * 0.93, y: e.p.y, z: e.p.z + e.lz * e.p.w * k * 0.93, w: 0 }, lx: e.tx * which, lz: e.tz * which, s: 0 });
    const circle = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      circle.push([Math.cos(a) * 0.065, Math.sin(a) * 0.065 + postH + 0.06]);
    }
    const geo = sweepProfile(pts, 1, circle, 0);
    if (!target) {
      railGeos.push(geo);
      posts.push(new THREE.Vector3(e.p.x, e.p.y + postH / 2 + 0.06, e.p.z));
      return;
    }
    // ringhiera separata (si può togliere: es. quando la passerella prosegue)
    geo.computeVertexNormals();
    target.add(new THREE.Mesh(geo, M.rail));
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, postH, 10), M.post);
    post.position.set(e.p.x, e.p.y + postH / 2 + 0.06, e.p.z);
    target.add(post);
  };
  let endCap = null;
  if (capStart) capRail(E[0], 1);
  if (capEnd === 'separate') {
    endCap = new THREE.Group();
    capRail(E[E.length - 1], -1, endCap);
    g.add(endCap);
  } else if (capEnd) capRail(E[E.length - 1], -1);
  const postGeo = new THREE.CylinderGeometry(0.05, 0.05, postH, 10);
  const postMesh = new THREE.InstancedMesh(postGeo, M.post, Math.max(1, posts.length));
  posts.forEach((p, i) => {
    m.makeTranslation(p.x, p.y, p.z);
    postMesh.setMatrixAt(i, m);
  });
  g.add(postMesh);
  railGeos.forEach((geo) => {
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, M.rail));
  });

  // filetti di luce sul vetro, lungo i bordi interni dei longheroni
  const stripMat = strip || stripMaterial();
  for (const side of [1, -1]) {
    const geo = ribbon(E, (e) => side * (e.p.w - 0.32), (e) => side * (e.p.w - 0.46), 0.012, { withS: true, wScale: false, flipNormal: side < 0 });
    const mesh = new THREE.Mesh(geo, stripMat);
    mesh.renderOrder = 3;
    g.add(mesh);
  }

  g.userData = { length, stripMat, edges: E, endCap };
  return g;
}

// ------------------------------------------------------------------ piattaforma sopra il bilanciere

/**
 * Disco in zaffiro (si vede il bilanciere sotto i piedi) dentro un anello d'acciaio con Côtes
 * circolari, ringhiera in oro rosa sul bordo, un foro per l'ascensore.
 */
export function buildHubPlatform({ x, z, y, rOuter = 20, rGlass = 15.6, hole }) {
  const M = walkwayMaterials();
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const hx = hole.x - x;
  const hz = hole.z - z;
  // forme nel piano XZ locale (Shape usa x, y → mondo x, -z dopo la rotazione)
  const holePath = () => {
    const p = new THREE.Path();
    p.absarc(hx, -hz, hole.r, 0, TAU, true);
    return p;
  };
  // vetro (ampio: riflessi ancora più contenuti, si deve vedere il bilanciere sotto)
  const glassShape = new THREE.Shape();
  glassShape.absarc(0, 0, rGlass, 0, TAU, false);
  glassShape.holes.push(holePath());
  const glassGeo = new THREE.ShapeGeometry(glassShape, 96);
  glassGeo.rotateX(-Math.PI / 2);
  const glass = new THREE.Mesh(glassGeo, sapphireMaterial({ base: 0.04, fres: 0.22 }));
  glass.renderOrder = 2;
  g.add(glass);
  // anello d'acciaio con Côtes circolari
  const ringShape = new THREE.Shape();
  ringShape.absarc(0, 0, rOuter, 0, TAU, false);
  const inner = new THREE.Path();
  inner.absarc(0, 0, rGlass, 0, TAU, true);
  ringShape.holes.push(inner, holePath());
  const ringGeo = new THREE.ExtrudeGeometry(ringShape, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2, curveSegments: 96 });
  ringGeo.rotateX(-Math.PI / 2);
  ringGeo.translate(0, -0.62, 0);
  ringGeo.computeVertexNormals();
  const ringMat = Mat.rhodium({ color: 0xb4b8be, roughness: 0.32 });
  patchCotesCircular(ringMat, { width: 1.3, strength: 0.16 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  g.add(ring);
  // bordo lucido del vetro e del foro
  const lip = new THREE.Mesh(new THREE.TorusGeometry(rGlass, 0.12, 10, 160), M.beam);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 0.02;
  g.add(lip);
  const holeLip = new THREE.Mesh(new THREE.TorusGeometry(hole.r, 0.1, 10, 64), M.beam);
  holeLip.rotation.x = Math.PI / 2;
  holeLip.position.set(hx, 0.02, hz);
  g.add(holeLip);
  // ringhiera sul bordo esterno
  const railR = rOuter - 0.25;
  const n = Math.round((TAU * railR) / 2.6);
  const postGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.05, 10);
  const posts = new THREE.InstancedMesh(postGeo, M.post, n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    m.makeTranslation(Math.cos(a) * railR, 0.58, Math.sin(a) * railR);
    posts.setMatrixAt(i, m);
  }
  g.add(posts);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(railR, 0.065, 8, 220), M.rail);
  rail.rotation.x = Math.PI / 2;
  rail.position.y = 1.11;
  g.add(rail);
  g.userData = { ringMat };
  return g;
}

// ------------------------------------------------------------------ ascensore (un disco che sale)

export function buildLift({ r = 3 } = {}) {
  const g = new THREE.Group();
  const mat = Mat.plate({ color: 0xa9adb3, roughness: 0.42 });
  patchPerlage(mat, { spacing: 0.9, strength: 0.35 });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.98, 0.5, 72), mat);
  disc.position.y = -0.25;
  g.add(disc);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(r, 0.11, 10, 96), walkwayMaterials().beam);
  lip.rotation.x = Math.PI / 2;
  g.add(lip);
  // anello luminoso: invita a salire
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd6ae, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.RingGeometry(r - 0.55, r - 0.35, 96), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.015;
  glow.renderOrder = 3;
  g.add(glow);
  g.userData = { glowMat };
  return g;
}
