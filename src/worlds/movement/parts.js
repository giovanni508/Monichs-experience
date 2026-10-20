import * as THREE from 'three';
import { Mat, patchCotes, patchCotesCircular, patchPerlage, patchDissolve, addCircularTangents } from '../../gfx/materials.js';
import {
  wheelShape,
  pinionShape,
  escapeWheelShape,
  palletForkShape,
  extrudeXZ,
  jewelGeometry,
  screwGeometry,
  screwSlotGeometry,
  crownGeometry,
  SpiralRibbon,
  balanceWheel,
  arcPoints,
} from '../../gfx/gears.js';
import { PICTOGRAM_POLYGONS } from '../../ui/UI.js';

const TAU = Math.PI * 2;

// Punto del mondo (x, z) → coordinate del profilo (x, -z), perché extrudeXZ mappa y → -z
export const S = (x, z) => new THREE.Vector2(x, -z);

/** Inviluppo convesso arrotondato (somma di Minkowski con un cerchio): forma dei ponti. */
export function roundedHull(points, margin, arcSeg = 10) {
  const pts = points.map((p) => p.clone()).sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  let hull;
  if (pts.length === 1) hull = pts;
  else {
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    upper.pop();
    lower.pop();
    hull = lower.concat(upper); // antiorario
  }
  const out = [];
  const n = hull.length;
  if (n === 1) {
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU;
      out.push(new THREE.Vector2(hull[0].x + Math.cos(a) * margin, hull[0].y + Math.sin(a) * margin));
    }
    return new THREE.Shape(out);
  }
  for (let i = 0; i < n; i++) {
    const prev = hull[(i - 1 + n) % n];
    const cur = hull[i];
    const next = hull[(i + 1) % n];
    const e1 = new THREE.Vector2().subVectors(cur, prev).normalize();
    const e2 = new THREE.Vector2().subVectors(next, cur).normalize();
    // normali esterne (percorso antiorario → esterno a destra)
    const a1 = Math.atan2(-e1.x, e1.y);
    let a2 = Math.atan2(-e2.x, e2.y);
    while (a2 < a1) a2 += TAU;
    const steps = Math.max(2, Math.ceil(((a2 - a1) / TAU) * arcSeg * 4));
    for (let s = 0; s <= steps; s++) {
      const a = a1 + ((a2 - a1) * s) / steps;
      out.push(new THREE.Vector2(cur.x + Math.cos(a) * margin, cur.y + Math.sin(a) * margin));
    }
  }
  return new THREE.Shape(out);
}

// ------------------------------------------------------------------------------- piastra e ponti

export function buildPlate({ center, radius, y }) {
  const mat = Mat.plate({ color: 0x9a9da3, roughness: 0.5 });
  patchPerlage(mat, { spacing: 2.2, strength: 0.32 });
  const geo = new THREE.CylinderGeometry(radius, radius * 1.01, 3, 160, 1);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(center.x, y - 1.5, center.y);
  return m;
}

export function bridgeMaterial() {
  const mat = Mat.rhodium({ color: 0xb2b6bc, roughness: 0.34 });
  patchCotes(mat, { width: 2.4, strength: 0.2, angle: 0.35 });
  return mat;
}

export function buildBridge({ points, margin, y, thickness = 2.4, material }) {
  const shape = roundedHull(points.map(([x, z]) => S(x, z)), margin);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.45,
    bevelSize: 0.45,
    bevelSegments: 1,
    curveSegments: 4,
  });
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, material);
  m.position.y = y;
  return m;
}

// ------------------------------------------------------------------------------- viti e rubini

export function buildScrews(positions, { radius = 1.3, head = 0.7 } = {}) {
  const headMat = Mat.steelPolished({ color: 0xe7e9ec, roughness: 0.05 });
  const slotMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, metalness: 0.6, roughness: 0.6 });
  const g = new THREE.Group();
  const heads = new THREE.InstancedMesh(screwGeometry(radius, head), headMat, positions.length);
  const slots = new THREE.InstancedMesh(screwSlotGeometry(radius, head), slotMat, positions.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  positions.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot ?? Math.random() * Math.PI);
    m.compose(v.set(p.x, p.y, p.z), q, new THREE.Vector3(1, 1, 1));
    heads.setMatrixAt(i, m);
    m.compose(v.set(p.x, p.y + head * 0.82, p.z), q, new THREE.Vector3(1, 1, 1));
    slots.setMatrixAt(i, m);
  });
  g.add(heads, slots);
  g.userData.headMat = headMat;
  return g;
}

/** Rubini con bagliore per istanza (attributo aGlow), incastonati in un castone lucido. */
export function buildJewels(list) {
  const mat = Mat.ruby({ color: 0x9e0a22, emissive: 0x2a0208, emissiveIntensity: 1, roughness: 0.04, clearcoatRoughness: 0.02 });
  const glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(list.length), 1);
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.08, 0.16) * vGlow * vGlow * 2.2;');
  };
  mat.customProgramCacheKey = () => 'jewelglow';
  const geo = jewelGeometry(0.62, 0.34);
  geo.setAttribute('aGlow', glowAttr);
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  // castone (anello lucido attorno alla pietra)
  const chatonGeo = new THREE.TorusGeometry(0.72, 0.13, 10, 40);
  chatonGeo.rotateX(Math.PI / 2);
  const chatons = new THREE.InstancedMesh(chatonGeo, Mat.steelPolished({ color: 0xe6e1d6, roughness: 0.06 }), list.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  list.forEach((j, i) => {
    q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), j.flip ? Math.PI : 0);
    const sc = new THREE.Vector3(j.s ?? 1, j.s ?? 1, j.s ?? 1);
    m.compose(new THREE.Vector3(j.x, j.y, j.z), q, sc);
    mesh.setMatrixAt(i, m);
    chatons.setMatrixAt(i, m);
    glowAttr.setX(i, 0.15);
  });
  mesh.add(chatons);
  mesh.userData.glow = glowAttr;
  mesh.userData.material = mat;
  return mesh;
}

// ------------------------------------------------------------------------------- esterno: cassa, corona, asta

export function buildCase({ center, rInner, rOuter, yMin, yMax, gapAngle, gapWidthAngle }) {
  const mat = Mat.steelBrushed({ color: 0xbfc3c8, roughness: 0.32, side: THREE.DoubleSide });
  const g = new THREE.Group();
  const prof = [
    new THREE.Vector2(rInner, yMin),
    new THREE.Vector2(rOuter, yMin),
    new THREE.Vector2(rOuter, yMax),
    new THREE.Vector2(rInner, yMax),
    new THREE.Vector2(rInner, yMin),
  ];
  // LatheGeometry: phi parte dall'asse +Z e ruota verso +X
  const start = gapAngle + gapWidthAngle / 2;
  const geo = new THREE.LatheGeometry(prof, 180, start, TAU - gapWidthAngle);
  const wall = new THREE.Mesh(geo, mat);
  wall.position.set(center.x, 0, center.y);
  g.add(wall);
  g.userData.material = mat;
  return g;
}

export function buildCrown({ radius = 9, length = 8, z, y }) {
  const mat = Mat.steelSatin({ color: 0xd2d5da, roughness: 0.22, anisotropy: 0.6, side: THREE.DoubleSide });
  const dissolve = patchDissolve(mat, { scale: 0.42, edge: 0xffcf9e });
  const g = new THREE.Group();
  const geo = crownGeometry({ radius, length, flutes: 26, depth: 0.85 });
  addCircularTangentsZ(geo);
  const crown = new THREE.Mesh(geo, mat);
  g.add(crown);
  // faccia: satinata a cerchi concentrici + pittogramma lucido in rilievo (come sulla corona reale)
  const faceMat = Mat.steelSatin({ color: 0xd9dce0, roughness: 0.3, anisotropy: 0.85, side: THREE.DoubleSide });
  const faceDissolve = patchDissolve(faceMat, { scale: 0.42, edge: 0xffcf9e });
  const faceGeo = new THREE.CircleGeometry(radius * 0.86, 96);
  addCircularTangentsZ(faceGeo);
  const face = new THREE.Mesh(faceGeo, faceMat);
  face.position.z = radius * 0.08 + 0.02;
  g.add(face);
  const picMat = Mat.steelPolished({ color: 0xeceef1, roughness: 0.04, side: THREE.DoubleSide });
  const picDissolve = patchDissolve(picMat, { scale: 0.42, edge: 0xffcf9e });
  const picto = pictogramMesh(radius * 0.6, picMat, 0.35);
  picto.position.z = radius * 0.08 + 0.03;
  g.add(picto);
  g.position.set(0, y, z);
  g.userData.uniforms = [dissolve, faceDissolve, picDissolve];
  g.userData.materials = [mat, faceMat, picMat];
  return g;
}

function addCircularTangentsZ(geo) {
  const pos = geo.attributes.position;
  const t = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const l = Math.hypot(x, y);
    t[i * 4] = l > 1e-5 ? -y / l : 1;
    t[i * 4 + 1] = l > 1e-5 ? x / l : 0;
    t[i * 4 + 2] = 0;
    t[i * 4 + 3] = 1;
  }
  geo.setAttribute('tangent', new THREE.BufferAttribute(t, 4));
}

/** Pittogramma Monichs estruso (piano XY, spessore verso +Z), centrato, largo `size`. */
export function pictogramMesh(size, material, depth = 0.25) {
  const shapes = PICTOGRAM_POLYGONS.map((poly) => {
    const nums = poly.split(/\s+/).map(Number);
    const pts = [];
    for (let i = 0; i < nums.length - 2; i += 2) pts.push(new THREE.Vector2(nums[i], nums[i + 1]));
    return pts;
  });
  // bounding box del pittogramma (coordinate SVG): x 309.7–768.1, y 368.9–713.2
  const cx = 538.9;
  const cy = 541;
  const k = size / 460;
  const out = shapes.map((pts) => new THREE.Shape(pts.map((p) => new THREE.Vector2((p.x - cx) * k, -(p.y - cy) * k))));
  const geo = new THREE.ExtrudeGeometry(out, { depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: depth * 0.3, bevelSegments: 1 });
  return new THREE.Mesh(geo, material);
}

// ------------------------------------------------------------------------------- bariletto e carica

export function ratchetShape({ teeth = 48, rOuter, rRoot }) {
  const pts = [];
  const pitch = TAU / teeth;
  for (let i = 0; i < teeth; i++) {
    const c = i * pitch;
    pts.push(new THREE.Vector2(Math.cos(c) * rRoot, Math.sin(c) * rRoot));
    pts.push(new THREE.Vector2(Math.cos(c + pitch * 0.12) * rOuter, Math.sin(c + pitch * 0.12) * rOuter));
    pts.push(new THREE.Vector2(Math.cos(c + pitch * 0.32) * (rOuter - (rOuter - rRoot) * 0.15), Math.sin(c + pitch * 0.32) * (rOuter - (rOuter - rRoot) * 0.15)));
  }
  return new THREE.Shape(pts);
}

export function buildBarrel({ x, z, ratchetR = 7.6, mats }) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  // corona dentata del tamburo (72 denti, modulo 0,5)
  const ws = wheelShape({ teeth: 72, module: 0.5, spokes: 0 });
  const hole = new THREE.Path();
  hole.absarc(0, 0, 15.5, 0, TAU, true);
  ws.shape.holes.push(hole);
  const teeth = new THREE.Mesh(extrudeXZ(ws.shape, 1.0, { bevel: 0.08 }), mats.barrel);
  teeth.position.y = -5;
  const drum = new THREE.Group();
  drum.add(teeth);
  // parete del tamburo
  const wallProf = [
    new THREE.Vector2(15.6, -5),
    new THREE.Vector2(17.05, -5),
    new THREE.Vector2(17.05, 4.6),
    new THREE.Vector2(16.85, 5.0),
    new THREE.Vector2(15.8, 5.0),
    new THREE.Vector2(15.6, 4.8),
    new THREE.Vector2(15.6, -5),
  ];
  const wallGeo = new THREE.LatheGeometry(wallProf, 128);
  addCircularTangents(wallGeo);
  drum.add(new THREE.Mesh(wallGeo, mats.barrel));
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(15.7, 15.7, 0.6, 96), mats.barrelFloor);
  floor.position.y = -4.7;
  drum.add(floor);
  g.add(drum);

  // albero del bariletto
  const arbor = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 13.5, 40), mats.steel);
  shaft.position.y = 0.75;
  arbor.add(shaft);
  // rocchetto (ruota di carica) sopra il bariletto
  const ratchet = new THREE.Mesh(extrudeXZ(ratchetShape({ teeth: 40, rOuter: ratchetR, rRoot: ratchetR - 0.75 }), 1.0, { bevel: 0.12 }), mats.ratchet);
  ratchet.position.y = 6.5;
  arbor.add(ratchet);
  const ratchetScrew = new THREE.Mesh(screwGeometry(2.4, 1.0), mats.screw);
  ratchetScrew.position.y = 7.6;
  arbor.add(ratchetScrew);
  g.add(arbor);

  // molla motrice (nastro a spirale)
  const spring = new SpiralRibbon({ samples: 900, height: 8.4, material: mats.spring });
  spring.mesh.position.y = -4.3;
  g.add(spring.mesh);

  // cricchetto (arresto) sul bordo del rocchetto
  const clickShape = new THREE.Shape([
    new THREE.Vector2(0, -0.8),
    new THREE.Vector2(4.2, -0.5),
    new THREE.Vector2(5.4, 0.2),
    new THREE.Vector2(4.2, 0.7),
    new THREE.Vector2(0, 0.9),
    new THREE.Vector2(-0.8, 0),
  ]);
  const click = new THREE.Mesh(extrudeXZ(clickShape, 0.9, { bevel: 0.1, circular: false }), mats.steel);
  const ca = (200 * Math.PI) / 180;
  click.position.set(Math.cos(ca) * (ratchetR + 4.2), 6.55, -Math.sin(ca) * (ratchetR + 4.2));
  click.rotation.y = ca + Math.PI * 0.62;
  g.add(click);

  return { group: g, drum, arbor, spring, ratchet };
}

// ------------------------------------------------------------------------------- rodaggio

export function buildTrainArbor({ wheel, pinion, arbor, mats }) {
  const g = new THREE.Group();
  if (wheel) {
    const ws = wheelShape(wheel);
    const m = new THREE.Mesh(extrudeXZ(ws.shape, wheel.thickness, { bevel: 0.07 }), mats.wheel);
    m.position.y = wheel.y;
    g.add(m);
    const hubR = Math.max(wheel.module * 3, ws.rp * 0.16) * 0.95;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR * 0.62, hubR * 0.62, wheel.thickness + 0.5, 32), mats.steel);
    hub.position.y = wheel.y + wheel.thickness / 2;
    g.add(hub);
  }
  if (pinion) {
    const ps = pinionShape(pinion);
    const m = new THREE.Mesh(extrudeXZ(ps.shape, pinion.height, { bevel: 0.04, bevelSegments: 1 }), mats.pinion);
    m.position.y = pinion.y;
    g.add(m);
  }
  const h = arbor.yMax - arbor.yMin;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(arbor.radius, arbor.radius, h, 18), mats.pinion);
  shaft.position.y = (arbor.yMin + arbor.yMax) / 2;
  g.add(shaft);
  return g;
}

// ------------------------------------------------------------------------------- scappamento

export function buildEscapement({ escRadius, escDist, forkLen, mats }) {
  const esc = escapeWheelShape({ teeth: 15, radius: escRadius, spokes: 4, mirror: true });
  const escWheel = new THREE.Mesh(extrudeXZ(esc.shape, 0.6, { bevel: 0.05 }), mats.escape);
  const escGroup = new THREE.Group();
  escWheel.position.y = 0.5;
  escGroup.add(escWheel);
  const escPin = pinionShape({ leaves: 6, module: 0.2, addendum: 0.85, dedendum: 1.35 });
  const pin = new THREE.Mesh(extrudeXZ(escPin.shape, 1.6, { bevel: 0.02, bevelSegments: 1 }), mats.escapeSteel);
  pin.position.y = -1.5;
  escGroup.add(pin);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 20, 16), mats.escapeSteel);
  shaft.position.y = 4;
  escGroup.add(shaft);

  const fork = palletForkShape({ escRadius, escDist, forkLen });
  const forkGroup = new THREE.Group();
  const lever = new THREE.Mesh(extrudeXZ(fork.shape, 0.42, { bevel: 0.06, circular: false }), mats.fork);
  lever.position.y = 0.62;
  forkGroup.add(lever);
  // palette in rubino (entrata e uscita)
  fork.stones.forEach((s, i) => {
    const stone = new THREE.Mesh(new THREE.BoxGeometry(fork.w * 1.9, 1.0, fork.w * 0.55), mats.ruby);
    // il profilo usa y = -z
    stone.position.set(s.x - fork.w * 0.2, 0.85, -s.y);
    stone.rotation.y = i === 0 ? -0.5 : 0.5;
    forkGroup.add(stone);
  });
  // dardo (guard pin)
  const dart = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 8), mats.escapeSteel);
  dart.position.set(forkLen - fork.w * 0.6, 1.2, 0);
  forkGroup.add(dart);
  const forkShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 20, 16), mats.escapeSteel);
  forkShaft.position.y = 4;
  forkGroup.add(forkShaft);
  return { escGroup, forkGroup, stones: fork.stones };
}

// ------------------------------------------------------------------------------- bilanciere

export function buildBalance({ radius, mats }) {
  const g = new THREE.Group();
  const wheel = balanceWheel({ radius, rimWidth: 1.15, rimHeight: 1.25, materials: { rim: mats.balance } });
  wheel.position.y = 2.5;
  g.add(wheel);
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 18.5, 16), mats.steel);
  staff.position.y = 3.6;
  g.add(staff);
  // doppio plateau con ellisse (piolo d'impulso in rubino)
  const roller = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.35, 32), mats.steel);
  roller.position.y = 0.7;
  g.add(roller);
  const safety = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.3, 32), mats.steel);
  safety.position.y = 1.15;
  g.add(safety);
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.85, 12), mats.ruby);
  // l'ellisse punta verso l'ancora (angolo locale -90°, cioè +Z locale)
  pin.position.set(0, 0.55, 0.92);
  g.add(pin);
  // collare della spirale
  const collet = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.8, 24), mats.steel);
  collet.position.y = 4.9;
  g.add(collet);
  return { group: g, wheel };
}

export function buildHairspring(mats) {
  const spiral = new SpiralRibbon({ samples: 1000, height: 0.5, material: mats.hairspring });
  spiral.mesh.position.y = 4.5;
  return spiral;
}

// ------------------------------------------------------------------------------- testo curvo
// (il rotore è il modello 3D: gfx/watchModel.js → createRotor)

export function curvedText(text, { radius, width = 6, start = 0.1, length = 1.2, font = '500 64px Montserrat', color = '#3a1f14', canvasW = 2048, canvasH = 128, opacity = 0.75 }) {
  const c = document.createElement('canvas');
  c.width = canvasW;
  c.height = canvasH;
  const g = c.getContext('2d');
  g.clearRect(0, 0, canvasW, canvasH);
  g.font = font;
  if ('letterSpacing' in g) g.letterSpacing = '18px';
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, canvasW / 2, canvasH / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const segs = 80;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const a = start + length * (1 - u); // testo leggibile da fuori verso dentro
    for (const [r, v] of [[radius - width / 2, 0], [radius + width / 2, 1]]) {
      pos.push(Math.cos(a) * r, 0, -Math.sin(a) * r);
      uv.push(u, v);
    }
    if (i < segs) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
  return new THREE.Mesh(geo, mat);
}

