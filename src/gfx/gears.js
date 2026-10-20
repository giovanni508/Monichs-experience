import * as THREE from 'three';
import { addCircularTangents } from './materials.js';

// ---------------------------------------------------------------------------------------------
// Geometrie orologiere procedurali. Le forme sono disegnate nel piano XY e poi ruotate nel
// piano XZ (asse di rotazione = Y). Convenzione angolare: angolo polare φ = atan2(-z, x);
// rotation.y = θ somma θ a φ.
// Denti di ruota: fianchi radiali e punta ogivale (profilo tipico dell'orologeria);
// ali dei pignoni: fianchi radiali e testa arrotondata.
// ---------------------------------------------------------------------------------------------

const TAU = Math.PI * 2;

function polar(r, a, mirror = false) {
  return new THREE.Vector2(Math.cos(a) * r, (mirror ? -1 : 1) * Math.sin(a) * r);
}

export function arcPoints(r, a0, a1, n, mirror = false) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(polar(r, a0 + ((a1 - a0) * i) / n, mirror));
  return pts;
}

// Arrotonda solo gli angoli indicati di un poligono chiuso (curve di Bézier quadratiche)
function roundCorners(points, cornerIdx, radius, seg = 4) {
  const out = [];
  const set = new Set(cornerIdx);
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    if (!set.has(i)) {
      out.push(p);
      continue;
    }
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const d1 = new THREE.Vector2().subVectors(prev, p);
    const d2 = new THREE.Vector2().subVectors(next, p);
    const r = Math.min(radius, d1.length() * 0.45, d2.length() * 0.45);
    const a = p.clone().add(d1.normalize().multiplyScalar(r));
    const b = p.clone().add(d2.normalize().multiplyScalar(r));
    for (let s = 0; s <= seg; s++) {
      const t = s / seg;
      const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * p.x + t * t * b.x;
      const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * p.y + t * t * b.y;
      out.push(new THREE.Vector2(x, y));
    }
  }
  return out;
}

/** Contorno dentato di ruota o pignone. */
function toothOutline({ teeth, module, addendum, dedendum, thickness, tipSamples = 5, rootSamples = 3, round = false }) {
  const rp = (module * teeth) / 2;
  const ra = rp + addendum * module;
  const rf = rp - dedendum * module;
  const pitch = TAU / teeth;
  const hw = (thickness * pitch) / 2;
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const c = i * pitch;
    // fianco sinistro radiale (da fondo a primitiva)
    pts.push(polar(rf, c - hw));
    // testa ogivale (o arrotondata per i pignoni)
    for (let s = 0; s <= tipSamples; s++) {
      const u = s / tipSamples; // 0 → primitiva sinistra, 1 → punta
      const a = c - hw * Math.cos((u * Math.PI) / 2);
      const k = round ? Math.sin((u * Math.PI) / 2) : Math.pow(Math.sin((u * Math.PI) / 2), 0.8);
      pts.push(polar(rp + (ra - rp) * k, a));
    }
    for (let s = tipSamples - 1; s >= 0; s--) {
      const u = s / tipSamples;
      const a = c + hw * Math.cos((u * Math.PI) / 2);
      const k = round ? Math.sin((u * Math.PI) / 2) : Math.pow(Math.sin((u * Math.PI) / 2), 0.8);
      pts.push(polar(rp + (ra - rp) * k, a));
    }
    pts.push(polar(rf, c + hw));
    // fondo tra i denti (leggermente arrotondato)
    for (let s = 1; s < rootSamples; s++) {
      const u = s / rootSamples;
      const a = c + hw + (pitch - 2 * hw) * u;
      pts.push(polar(rf - Math.sin(u * Math.PI) * module * 0.12, a));
    }
  }
  return { pts, rp, ra, rf };
}

/** Finestre tra le razze (crociera) come fori del profilo. */
function spokeHoles({ count, rOuter, rInner, spokeWidth, fillet, curve = 0, phase = 0, mirror = false }) {
  const holes = [];
  if (count <= 0 || rOuter - rInner < spokeWidth * 0.8) return holes;
  for (let k = 0; k < count; k++) {
    const a0 = phase + (k / count) * TAU;
    const a1 = phase + ((k + 1) / count) * TAU;
    const ho = Math.asin(Math.min(0.95, spokeWidth / 2 / rOuter));
    const hi = Math.asin(Math.min(0.95, spokeWidth / 2 / rInner));
    const cOff = curve; // razze curve: sfasamento tra raggio interno ed esterno
    const outer = arcPoints(rOuter, a0 + ho + cOff, a1 - ho + cOff, 18, mirror);
    const inner = arcPoints(rInner, a1 - hi, a0 + hi, 8, mirror);
    const poly = [...outer, ...inner];
    const corners = [0, outer.length - 1, outer.length, poly.length - 1];
    const rounded = roundCorners(poly, corners, fillet, 4);
    holes.push(new THREE.Path(rounded));
  }
  return holes;
}

export function wheelShape({
  teeth,
  module,
  addendum = 1.3,
  dedendum = 1.65,
  thickness = 0.46,
  rimWidth = null,
  spokes = 5,
  spokeWidth = null,
  hubRadius = null,
  curve = 0,
}) {
  const { pts, rp, rf } = toothOutline({ teeth, module, addendum, dedendum, thickness });
  const shape = new THREE.Shape(pts);
  const rim = rimWidth ?? Math.max(module * 2.2, rp * 0.09);
  const hub = hubRadius ?? Math.max(module * 3, rp * 0.16);
  const sw = spokeWidth ?? Math.max(module * 1.6, rp * 0.085);
  shape.holes.push(...spokeHoles({ count: spokes, rOuter: rf - rim, rInner: hub, spokeWidth: sw, fillet: sw * 0.6, curve }));
  return { shape, rp, rf };
}

export function pinionShape({ leaves, module, addendum = 0.85, dedendum = 1.35, thickness = 0.4 }) {
  const { pts, rp } = toothOutline({ teeth: leaves, module, addendum, dedendum, thickness, tipSamples: 5, rootSamples: 4, round: true });
  return { shape: new THREE.Shape(pts), rp };
}

/** Ruota di scappamento ad ancora svizzera: 15 denti "a clava" con piano d'impulso. */
export function escapeWheelShape({ teeth = 15, radius = 5, spokes = 4, mirror = true }) {
  const R = radius;
  const rr = R * 0.7;
  const pitch = TAU / teeth;
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const c = i * pitch;
    // dal dente i verso angoli decrescenti
    pts.push(polar(R, c, mirror)); // spigolo di riposo
    pts.push(polar(R * 0.985, c - pitch * 0.12, mirror));
    pts.push(polar(R * 0.955, c - pitch * 0.2, mirror)); // fine del piano d'impulso (clava)
    // dorso concavo che scende verso il fondo
    for (let s = 1; s <= 5; s++) {
      const u = s / 5;
      const r = R * 0.955 + (rr - R * 0.955) * u;
      const a = c - pitch * 0.2 - pitch * 0.42 * Math.pow(u, 0.7);
      pts.push(polar(r, a, mirror));
    }
    pts.push(polar(rr, c - pitch * 0.82, mirror));
    // faccia di riposo del dente precedente, quasi radiale
    pts.push(polar(rr * 1.02, c - pitch * 0.97, mirror));
  }
  const shape = new THREE.Shape(pts);
  const rim = R * 0.11;
  shape.holes.push(...spokeHoles({ count: spokes, rOuter: rr - rim, rInner: R * 0.17, spokeWidth: R * 0.075, fillet: R * 0.05, curve: 0.25, mirror }));
  return { shape, radius: R, root: rr };
}

/**
 * Ancora (lever) in coordinate locali: perno in (0,0), ruota di scappamento verso -X
 * a distanza `escDist`, forchetta verso +X fino a `forkLen`.
 */
export function palletForkShape({ escRadius, escDist, forkLen }) {
  const s = new THREE.Shape();
  const w = escRadius * 0.11;
  const stoneX = escRadius * 0.866 - escDist; // ≈ -0.29 R
  const stoneY = escRadius * 0.5;
  // braccia delle palette (a "V") + corpo + forchetta con corna
  const pts = [
    [stoneX - w * 0.6, stoneY + w * 1.4],
    [-w * 0.8, w * 2.4],
    [forkLen * 0.55, w * 1.0],
    [forkLen - w * 1.6, w * 1.6],
    [forkLen + w * 0.6, w * 2.6], // corno superiore
    [forkLen + w * 0.9, w * 1.9],
    [forkLen - w * 0.2, w * 0.75], // tacca
    [forkLen - w * 0.2, -w * 0.75],
    [forkLen + w * 0.9, -w * 1.9],
    [forkLen + w * 0.6, -w * 2.6], // corno inferiore
    [forkLen - w * 1.6, -w * 1.6],
    [forkLen * 0.55, -w * 1.0],
    [-w * 0.8, -w * 2.4],
    [stoneX - w * 0.6, -stoneY - w * 1.4],
    [stoneX + w * 1.2, -stoneY - w * 0.4],
    [-w * 0.2, -w * 0.9],
    [-w * 0.2, w * 0.9],
    [stoneX + w * 1.2, stoneY + w * 0.4],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  s.setFromPoints(pts);
  return { shape: s, stones: [new THREE.Vector2(stoneX, stoneY), new THREE.Vector2(stoneX, -stoneY)], w };
}

/** Estrude un profilo e lo porta nel piano XZ (spessore verso +Y), con tangenti circolari. */
export function extrudeXZ(shape, depth, { bevel = 0.05, bevelSegments = 2, circular = true } = {}) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments,
    curveSegments: 6,
    steps: 1,
  });
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  if (circular) addCircularTangents(geo);
  return geo;
}

// ---------------------------------------------------------------------------------------------
// Parti complete
// ---------------------------------------------------------------------------------------------

/**
 * Asse completo: ruota + pignone + albero (+ rubini ai perni).
 * Restituisce un Group che ruota attorno a Y; info utili per l'ingranamento.
 */
export function buildArbor({
  wheel, // { teeth, module, thickness, y, spokes, curve }
  pinion, // { leaves, module, height, y }
  arbor, // { yMin, yMax, radius }
  materials,
}) {
  const g = new THREE.Group();
  const info = {};
  if (wheel) {
    const ws = wheelShape(wheel);
    const geo = extrudeXZ(ws.shape, wheel.thickness ?? 0.5, { bevel: wheel.bevel ?? 0.06 });
    const m = new THREE.Mesh(geo, materials.wheel);
    m.position.y = wheel.y;
    g.add(m);
    info.wheel = { rp: ws.rp, teeth: wheel.teeth, mesh: m };
    // mozzo lucido
    const hubR = Math.max(wheel.module * 3, ws.rp * 0.16) * 0.92;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, (wheel.thickness ?? 0.5) + 0.3, 32), materials.polished);
    hub.position.y = wheel.y + (wheel.thickness ?? 0.5) / 2;
    g.add(hub);
  }
  if (pinion) {
    const ps = pinionShape(pinion);
    const geo = extrudeXZ(ps.shape, pinion.height, { bevel: 0.03, bevelSegments: 1 });
    const m = new THREE.Mesh(geo, materials.pinion || materials.polished);
    m.position.y = pinion.y;
    g.add(m);
    info.pinion = { rp: ps.rp, leaves: pinion.leaves, mesh: m };
  }
  if (arbor) {
    const h = arbor.yMax - arbor.yMin;
    const geo = new THREE.CylinderGeometry(arbor.radius, arbor.radius, h, 20);
    const m = new THREE.Mesh(geo, materials.polished);
    m.position.y = (arbor.yMin + arbor.yMax) / 2;
    g.add(m);
    // perni coniche alle estremità
    for (const [y, dir] of [[arbor.yMin, -1], [arbor.yMax, 1]]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(arbor.radius, arbor.radius * 2.2, 16), materials.polished);
      cone.position.y = y + dir * arbor.radius * 1.1;
      if (dir < 0) cone.rotation.x = Math.PI;
      g.add(cone);
    }
  }
  return { group: g, info };
}

/** Rubino di perno: disco bombato con foro (come una pietra forata con "olivage"). */
export function jewelGeometry(radius = 0.9, height = 0.35) {
  const pts = [];
  const hole = radius * 0.22;
  pts.push(new THREE.Vector2(hole, -height / 2));
  pts.push(new THREE.Vector2(radius * 0.92, -height / 2));
  pts.push(new THREE.Vector2(radius, -height * 0.2));
  pts.push(new THREE.Vector2(radius * 0.98, height * 0.15));
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const r = radius * 0.98 * (1 - t) + hole * 1.6 * t;
    const y = height * 0.15 + Math.sin(t * Math.PI * 0.5) * height * 0.42;
    pts.push(new THREE.Vector2(r, y));
  }
  pts.push(new THREE.Vector2(hole * 1.2, height * 0.5));
  pts.push(new THREE.Vector2(hole, height * 0.3));
  pts.push(new THREE.Vector2(hole, -height / 2));
  return new THREE.LatheGeometry(pts, 28);
}

/** Vite con testa a calotta lucidata e taglio. */
export function screwGeometry(radius = 1, headHeight = 0.5) {
  const pts = [];
  const seg = 10;
  pts.push(new THREE.Vector2(0.0001, -headHeight * 0.2));
  pts.push(new THREE.Vector2(radius, -headHeight * 0.2));
  pts.push(new THREE.Vector2(radius, headHeight * 0.25));
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * radius * 0.98, headHeight * 0.25 + Math.sin(a) * headHeight * 0.75));
  }
  const geo = new THREE.LatheGeometry(pts, 32);
  return geo;
}

export function screwSlotGeometry(radius = 1, headHeight = 0.5) {
  return new THREE.BoxGeometry(radius * 2.05, headHeight * 0.55, radius * 0.22);
}

/** Corona godronata (asse lungo Z, faccia verso +Z). */
export function crownGeometry({ radius = 8, length = 6, flutes = 40, depth = 0.45 }) {
  const shape = new THREE.Shape();
  const pts = [];
  const n = flutes * 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const f = 0.5 + 0.5 * Math.cos(a * flutes); // 1 = costa piena, 0 = fondo della scanalatura
    const r = radius - depth * Math.pow(1 - f, 1.6);
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  shape.setFromPoints(pts);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: length,
    bevelEnabled: true,
    bevelThickness: radius * 0.08,
    bevelSize: radius * 0.06,
    bevelSegments: 4,
    curveSegments: 1,
  });
  geo.translate(0, 0, -length);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Nastro a spirale (molla del bariletto o spirale del bilanciere) come striscia verticale.
 * update(params) ricalcola i vertici: r(u) e angolo(u) definiti dal chiamante.
 */
export class SpiralRibbon {
  constructor({ samples = 600, height = 1, material }) {
    this.samples = samples;
    this.height = height;
    const n = samples + 1;
    this.positions = new Float32Array(n * 2 * 3);
    this.normals = new Float32Array(n * 2 * 3);
    const uvs = new Float32Array(n * 2 * 2);
    const idx = [];
    for (let i = 0; i < n; i++) {
      uvs[i * 4] = i / samples;
      uvs[i * 4 + 1] = 0;
      uvs[i * 4 + 2] = i / samples;
      uvs[i * 4 + 3] = 1;
      if (i < samples) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    this.geometry = geo;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
  }

  // fn(u) → { r, a } con u ∈ [0,1] dall'interno all'esterno
  update(fn) {
    const P = this.positions;
    const N = this.normals;
    const h = this.height;
    let minR = Infinity;
    let maxR = 0;
    for (let i = 0; i <= this.samples; i++) {
      const u = i / this.samples;
      const { r, a } = fn(u);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
      const x = Math.cos(a) * r;
      const z = -Math.sin(a) * r;
      const o = i * 6;
      P[o] = x;
      P[o + 1] = 0;
      P[o + 2] = z;
      P[o + 3] = x;
      P[o + 4] = h;
      P[o + 5] = z;
      const nx = Math.cos(a);
      const nz = -Math.sin(a);
      N[o] = nx;
      N[o + 1] = 0;
      N[o + 2] = nz;
      N[o + 3] = nx;
      N[o + 4] = 0;
      N[o + 5] = nz;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, h / 2, 0), maxR + h);
  }
}

/** Bilanciere: corona (anello), due bracci, asse; restituisce il gruppo rotante. */
export function balanceWheel({ radius = 12, rimWidth = 1.1, rimHeight = 1.2, materials }) {
  const g = new THREE.Group();
  const rimShape = new THREE.Shape();
  rimShape.absarc(0, 0, radius, 0, TAU, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, radius - rimWidth, 0, TAU, true);
  rimShape.holes.push(hole);
  const rimGeo = new THREE.ExtrudeGeometry(rimShape, { depth: rimHeight, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 3, curveSegments: 96 });
  rimGeo.rotateX(-Math.PI / 2);
  rimGeo.computeVertexNormals();
  addCircularTangents(rimGeo);
  const rim = new THREE.Mesh(rimGeo, materials.rim);
  g.add(rim);
  // bracci
  const armShape = new THREE.Shape();
  const w = rimWidth * 0.75;
  const L = radius - rimWidth * 0.5;
  armShape.moveTo(-L, -w / 2);
  armShape.lineTo(L, -w / 2);
  armShape.lineTo(L, w / 2);
  armShape.lineTo(-L, w / 2);
  armShape.closePath();
  const armGeo = new THREE.ExtrudeGeometry(armShape, { depth: rimHeight * 0.55, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.07, bevelSegments: 2 });
  armGeo.rotateX(-Math.PI / 2);
  armGeo.computeVertexNormals();
  addCircularTangents(armGeo);
  const arm = new THREE.Mesh(armGeo, materials.rim);
  arm.position.y = rimHeight * 0.2;
  g.add(arm);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(rimWidth * 1.1, rimWidth * 1.1, rimHeight * 0.9, 32), materials.rim);
  hub.position.y = rimHeight * 0.45;
  g.add(hub);
  return g;
}

export const GEAR_TAU = TAU;
