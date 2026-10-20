import * as THREE from 'three';
import { World } from './World.js';
import { WalkArea } from '../core/WalkArea.js';
import { createEnvironment } from '../gfx/env.js';
import { Mat, patchCotes, patchCustom, highlightTargets } from '../gfx/materials.js';
import { DustField } from '../gfx/particles.js';
import { glowSprite, lightShaft, mulberry32 } from '../gfx/effects.js';
import { GradientSky } from '../gfx/sky.js';
import { SpiralRibbon } from '../gfx/gears.js';
import { buildBracelet } from '../gfx/bracelet.js';
import { curvedText, roundedHull, S } from './movement/parts.js';
import { GuideWisp } from './common/GuideWisp.js';
import { Portal } from './common/Portal.js';
import { createWatch, createMonolith, createRotor, ROTOR_RADIUS } from '../gfx/watchModel.js';
import { loadNature, scatter } from '../gfx/nature.js';
import { SunShadow, enableShadows } from '../gfx/shadows.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
// foglie che cadono: volume attorno al visitatore (lato, altezza)
const FALL = { w: 120, h: 46 };

// veli di nebbia: rumore che scorre piano, trasparente vicino agli occhi e in lontananza
const MIST_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const MIST_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uCam;
uniform float uOpacity;
uniform float uScale;
uniform vec3 uColor;
varying vec3 vW;
float mh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mh(i), mh(i + vec2(1.0, 0.0)), f.x), mix(mh(i + vec2(0.0, 1.0)), mh(i + vec2(1.0, 1.0)), f.x), f.y);
}
float mfbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * mn(p); p = p * 2.02 + 3.7; a *= 0.5; } return v; }
void main() {
  vec2 q = vW.xz * uScale;
  float n = mfbm(q + vec2(uTime * 0.012, uTime * 0.007)) * 0.65 + mfbm(q * 1.9 - vec2(uTime * 0.02, -uTime * 0.01)) * 0.35;
  float d = distance(vW.xz, uCam.xz);
  float a = smoothstep(0.38, 0.8, n) * uOpacity * smoothstep(5.0, 26.0, d) * (1.0 - smoothstep(150.0, 215.0, d));
  gl_FragColor = vec4(uColor, a);
}`;

// MONDO 3 — VIRENTIA (Ref. M-003) — il fondello aperto, il rotore e la finitura Côtes de Genève.
// Un bosco incantato sotto il fondello: un viale di alberi le cui chiome fanno arco sul sentiero, felci,
// fiori appena luminosi e nebbia bassa; il prato è pettinato a onde di Côtes de Genève; il rotore in oro
// rosa è il sole e un altro rotore fa da porta nella lunetta. Si cammina sulle onde del prato; tronchi,
// rocce, la vite caduta, la porta e la molla non si attraversano.
const PATH = [
  [0, 6, 44, 18, 6],
  [0, 6, 8, 14, 6],
  [-12, 8, -30, 12, 7],
  [6, 9, -70, 13, 9],
  [0, 9, -110, 12, 8],
  [0, 10, -150, 26, 14],
];
const STATIONS = ['cotes', 'screws', 'caseback', 'rosegold', 'rotor'];
const CLEARING = V(0, 0, -160);
const GATE_Z = -112;
const LINKS = { half: 9.4, z0: -85.4, z1: -168.6, top: 1.24 }; // sentiero di maglie sotto la porta
// il monolite: la Virentia vera, completa e gigante, in fondo alla radura sotto il rotore-sole
// (centro della cassa; unità per mm: alta 96, larga 60)
const MONOLITH = { x: 0, y: 50, z: -218, scale: 1.4 };

// Altezza del suolo di onde (stessa formula della mesh, che è centrata in z = -80)
function groundHeight(x, z) {
  const zl = z + 80;
  const u = ((((x + zl * 0.18) / 9) % 1) + 1) % 1;
  return Math.sin(u * Math.PI) * 1.4 + Math.sin(zl * 0.03) * 1.2 + Math.sin(x * 0.02 + 1.3) * 0.8;
}

function floorHeight(x, z) {
  const g = groundHeight(x, z);
  if (Math.abs(x) < LINKS.half && z < LINKS.z0 && z > LINKS.z1) return Math.max(g, LINKS.top);
  return g;
}

function leafTexture() {
  // incisione "a piume" del quadrante Virentia, ridisegnata proceduralmente
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, s, s);
  grd.addColorStop(0, '#2f7a2c');
  grd.addColorStop(1, '#5aa646');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const rand = mulberry32(42);
  for (let p = 0; p < 70; p++) {
    const cx = rand() * s;
    const cy = rand() * s;
    const ang = rand() * Math.PI * 2;
    const len = 40 + rand() * 50;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    for (let k = -9; k <= 9; k++) {
      const ox = -dy * k * 3.2;
      const oy = dx * k * 3.2;
      g.strokeStyle = k % 2 ? 'rgba(190,240,150,0.32)' : 'rgba(20,60,20,0.35)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(cx + ox - dx * len * 0.5, cy + oy - dy * len * 0.5);
      g.quadraticCurveTo(cx + ox + dy * len * 0.25, cy + oy - dx * len * 0.25, cx + ox + dx * len * 0.5, cy + oy + dy * len * 0.5);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function leafGeometry(len = 3.2, w = 1.4) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(w, len * 0.35, 0, len);
  shape.quadraticCurveTo(-w, len * 0.35, 0, 0);
  const geo = new THREE.ShapeGeometry(shape, 8);
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / (w * 2) + 0.5;
    uv[i * 2 + 1] = pos.getY(i) / len;
    // leggera curvatura della foglia
    pos.setZ(i, Math.pow(pos.getX(i) / w, 2) * 0.35 - Math.pow(pos.getY(i) / len, 2) * 0.4);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

export class VirentiaWorld extends World {
  constructor(app) {
    super(app, 'virentia');
    this.audioPalette = 'virentia';
    this.tickTimbre = 'precise';
    this.tickPresence = 0.55;
    this.post = {
      // onirico: bagliore più morbido e diffuso, ombre meno chiuse
      bloom: 1.0,
      bloomThreshold: 0.62,
      exposure: 1.02,
      saturation: 1.06,
      tint: [0.99, 1.02, 0.97],
      vignette: 0.58,
      grain: 0.07,
      ao: { radius: 3, intensity: 2.0 },
      ssr: { intensity: 1, maxDistance: 140, thickness: 1.4 },
    };
    this.speedScale = 1.15;
    this.energy = 0;
    this.winding = null;
    this.eyeHeight = 3.6;
  }

  async load() {
    const app = this.app;
    const s = this.scene;

    s.background = new THREE.Color(0x0a1f16);
    s.fog = new THREE.FogExp2(0x153526, 0.0078);
    s.environment = createEnvironment(app.renderer.renderer, 'forest');
    s.environmentIntensity = 0.9;
    this.sky = new GradientSky({ top: 0x061a12, mid: 0x13402b, horizon: 0x3a7552, bottom: 0x06110b, sunDir: V(0, 1, -0.2), sunColor: 0xffc8a8 });
    s.add(this.sky.mesh);

    this.sun = new THREE.DirectionalLight(0xffd6b8, 1.6);
    this.sun.position.set(10, 100, -40);
    s.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0x5f9a70, 0x10180f, 0.6);
    s.add(this.hemi);
    this.glade = new THREE.PointLight(0xffd6b8, 500, 0, 2);
    this.glade.position.set(0, 26, -160);
    s.add(this.glade);

    this.buildGround();
    this.buildScrewFeature();
    await this.buildWoods();
    this.buildFallingLeaves();
    this.buildMist();
    await this.buildRotorSun();
    this.buildSapphire();
    await this.buildGate();
    await this.buildMonolith();
    this.buildSpring();

    this.fireflies = new DustField({ count: 320, box: [80, 36, 80], color: 0xffe7a8, size: 1.15, opacity: 0.55, rise: 0.015 });
    s.add(this.fireflies.points);
    this.wisp = new GuideWisp(this, { color: 0xe8ffd0, size: 1.3 });
    this.exitPortal = new Portal({ id: 'exit', name: 'SW200-2', ref: 'ÉLABORÉ · SWISS MADE', colorA: 0x103a1c, colorB: 0xf2c0a4, radius: 4.4 });
    s.add(this.exitPortal.group);

    // ombre del sole: alberi, felci, rocce, porta e molla sul prato di Côtes de Genève (luce a chiazze
    // sotto le chiome); il rotore è il sole stesso e non fa ombra (coprirebbe tutta la radura)
    this.rotorHolder.traverse((o) => (o.userData.noCastShadow = true));
    enableShadows(s);
    s.userData.shadow = new SunShadow(this.sun, { extent: 65, distance: 260 });

    this.buildWalkArea();
    this.buildHotspots();
    this.spawn = { position: V(0, 4, 42), yaw: 0, pitch: 0.08 };
    this.attractShots = [
      { from: [18, 10, 40], to: [-10, 12, -20], lookFrom: [0, 30, -80], lookTo: [0, 60, -160], duration: 10, labelKey: 'attract.virentia' },
      { from: [-24, 16, -120], to: [20, 22, -190], lookFrom: [0, 90, -170], lookTo: [0, 110, -170], duration: 10, labelKey: 'attract.virentia' },
    ];
    this.loaded = true;
  }

  // prato di muschio vellutato pettinato a onde parallele: le Côtes de Genève diventano erba che prende
  // la luce a bande, come racconta la tappa (stessa forma di prima: groundHeight la conosce)
  buildGround() {
    const geo = new THREE.PlaneGeometry(320, 320, 220, 220);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const band = 9;
      const u = (((x + z * 0.18) / band) % 1 + 1) % 1;
      const wave = Math.sin(u * Math.PI) * 1.4; // ogni banda è un'onda morbida
      const swell = Math.sin(z * 0.03) * 1.2 + Math.sin(x * 0.02 + 1.3) * 0.8;
      pos.setY(i, wave + swell);
    }
    geo.computeVertexNormals();
    this.groundMat = new THREE.MeshPhysicalMaterial({
      color: 0x2a5230,
      roughness: 0.9,
      metalness: 0,
      sheen: 1,
      sheenColor: new THREE.Color(0xa6e39a),
      sheenRoughness: 0.42,
    });
    patchCotes(this.groundMat, { width: 9, strength: 0.32, angle: -0.18 });
    // macchie di muschio di toni diversi (più azzurre all'ombra, più calde dove batte la luce)
    patchCustom(this.groundMat, {
      key: 'moss',
      fragRough: `
  {
    vec2 mp = vObjPos.xz * 0.035;
    float mv = sin(mp.x * 1.7 + sin(mp.y * 1.3)) * 0.5 + 0.5;
    float mv2 = sin(mp.y * 2.3 + sin(mp.x * 0.9) * 1.5) * 0.5 + 0.5;
    diffuseColor.rgb *= mix(vec3(0.72, 0.84, 0.76), vec3(1.12, 1.08, 0.9), mv * 0.6 + mv2 * 0.4);
  }`,
    });
    const g = new THREE.Mesh(geo, this.groundMat);
    g.position.z = -80;
    this.scene.add(g);
    this.ground = g;
  }

  // la vite caduta della tappa "viti e anglage": testa lucidata ad altezza d'occhio, un ponte accanto
  buildScrewFeature() {
    // filettatura elicoidale sulle viti-tronco (normale perturbata nello shader)
    const shaftMat = Mat.darkSteel({ color: 0x3a3f4a, roughness: 0.28 });
    patchCustom(shaftMat, {
      key: 'thread',
      fragRough: `
  vec2 thSlope = vec2(0.0);
  {
    float ang = atan(vObjPos.z, vObjPos.x);
    float ph = ang / 6.2831 + vObjPos.y / 1.6;
    float th = sin(ph * 6.2831);
    float side = 1.0 - smoothstep(0.3, 0.7, abs(vObjNormal.y));
    thSlope.y = cos(ph * 6.2831) * 0.55 * side;
    diffuseColor.rgb *= 0.75 + 0.25 * (0.5 + 0.5 * th);
  }`,
      fragNormal: 'normal = normalize(normal + vTY * thSlope.y);',
    });
    this.headMat = Mat.steelPolished({ color: 0xe4e6e9, roughness: 0.05 });
    const headGeo = new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const slotGeo = new THREE.BoxGeometry(2.1, 0.45, 0.28);

    // vite "caduta" vicino al sentiero: la testa lucidata ad altezza d'occhio (tappa viti e anglage)
    const feature = new THREE.Group();
    const fs = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 22, 48), shaftMat);
    fs.position.y = -6;
    feature.add(fs);
    const fh = new THREE.Mesh(headGeo, this.headMat.clone());
    fh.scale.set(5.2, 2.6, 5.2);
    fh.position.y = 5;
    feature.add(fh);
    const fsl = new THREE.Mesh(slotGeo, new THREE.MeshStandardMaterial({ color: 0x0a0b0c, roughness: 0.6, metalness: 0.5 }));
    fsl.scale.set(5, 2, 2.2);
    fsl.position.y = 7.6;
    fsl.rotation.y = 0.6;
    feature.add(fsl);
    // un ponte con smussi lucidati accanto alla vite
    const bm = Mat.rhodium({ color: 0x9da1a8, roughness: 0.36 });
    patchCotes(bm, { width: 2.4, strength: 0.2, angle: 0.3 });
    const shape = roundedHull([S(0, 0), S(16, -5)], 4);
    const bgeo = new THREE.ExtrudeGeometry(shape, { depth: 2.4, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.6, bevelSegments: 1 });
    bgeo.rotateX(-Math.PI / 2);
    const bridge = new THREE.Mesh(bgeo, bm);
    bridge.position.set(3, 1.5, 4);
    feature.add(bridge);
    feature.position.set(-22, 0, -32);
    feature.rotation.y = 0.4;
    this.scene.add(feature);
    this.screwFeature = feature;
  }

  pathX(z) {
    // x del sentiero per una data z (interpolazione lineare sui punti del percorso)
    for (let i = 0; i < PATH.length - 1; i++) {
      const a = PATH[i];
      const b = PATH[i + 1];
      if (z <= a[2] && z >= b[2]) return a[0] + ((z - a[2]) / (b[2] - a[2])) * (b[0] - a[0]);
    }
    return 0;
  }

  // ------------------------------------------------------------------ il bosco (modelli Blender)

  // punto del sentiero alla distanza s lungo la polilinea, con direzione (dx, dz) e laterale (nx, nz)
  pathAt(s) {
    let acc = 0;
    for (let i = 0; i < PATH.length - 1; i++) {
      const [ax, , az] = PATH[i];
      const [bx, , bz] = PATH[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (s <= acc + L || i === PATH.length - 2) {
        const t = THREE.MathUtils.clamp((s - acc) / L, 0, 1);
        const dx = (bx - ax) / L;
        const dz = (bz - az) / L;
        return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx, dz, nx: -dz, nz: dx };
      }
      acc += L;
    }
    return null;
  }

  pathLength() {
    let acc = 0;
    for (let i = 0; i < PATH.length - 1; i++) acc += Math.hypot(PATH[i + 1][0] - PATH[i][0], PATH[i + 1][2] - PATH[i][2]);
    return acc;
  }

  // distanza di un punto dal sentiero
  pathDist(x, z) {
    let best = Infinity;
    for (let i = 0; i < PATH.length - 1; i++) {
      const [ax, , az] = PATH[i];
      const [bx, , bz] = PATH[i + 1];
      const vx = bx - ax;
      const vz = bz - az;
      const t = THREE.MathUtils.clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
      best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t)));
    }
    return best;
  }

  // il bosco (Modelli/3D/natura, fatto in Blender): un viale ordinato di alberi ai lati del sentiero, con
  // le chiome che fanno arco; una seconda fila; una corona attorno alla radura, aperta verso il sentiero e
  // verso il monolite; un fondo più rado. Sotto: felci, fiori appena luminosi, erba, funghi luminosi ai
  // piedi degli alberi, rocce con muschio e qualche tronco caduto fuori dalla linea di cammino.
  async buildWoods() {
    const base = (this.app.config.assets || {})['nature.path'] || 'assets/models/natura/';
    const names = ['albero_a', 'albero_b', 'albero_c', 'felce_a', 'felce_b', 'fiori_a', 'fiori_b', 'fiori_c', 'erba_a', 'erba_b', 'roccia_a', 'roccia_b', 'funghi_luminosi', 'tronco_caduto'];
    const M = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await loadNature(`${base}${n}.glb`)])));
    const rand = mulberry32(31);
    const TAU = Math.PI * 2;
    const total = this.pathLength();
    const F = this.screwFeature.position;
    this.natureUniforms = { uTime: { value: 0 }, uGlow: { value: 0.55 } };
    this.trunks = [];
    this.obstacles = [];
    const items = Object.fromEntries(names.map((n) => [n, []]));
    const treeNames = ['albero_a', 'albero_b', 'albero_c'];
    // zone da lasciare libere dagli alberi: porta, vite caduta, radura con la molla, monolite
    const blocked = (x, z, pad = 0) =>
      (Math.abs(z - GATE_Z) < 16 + pad && Math.abs(x) < 26 + pad) ||
      Math.hypot(x - F.x, z - F.z) < 16 + pad ||
      Math.hypot(x - CLEARING.x, z - CLEARING.z) < 38 + pad ||
      Math.hypot(x - MONOLITH.x, z - MONOLITH.z) < 42 + pad;
    const farFromTrees = (x, z, d) => this.trunks.every((t) => Math.hypot(t.x - x, t.z - z) > d);
    const tree = (x, z, scale) => {
      const n = treeNames[Math.floor(rand() * treeNames.length)];
      items[n].push({ x, y: groundHeight(x, z) - 0.5, z, rot: rand() * TAU, scale });
      this.trunks.push({ x, z, r: M[n].trunkRadius * scale });
    };
    // viale: ai due lati del sentiero ogni ~25 unità, appena sfalsati (tra le chiome filtra la luce)
    for (let s = 4, k = 0; s < total; s += 25, k++) {
      const p = this.pathAt(s);
      for (const side of [-1, 1]) {
        const lat = side * (18 + rand() * 3);
        const fwd = (k % 2 ? 2.5 : -2.5) * side;
        const x = p.x + p.nx * lat + p.dx * fwd;
        const z = p.z + p.nz * lat + p.dz * fwd;
        if (blocked(x, z) || !farFromTrees(x, z, 15)) continue;
        tree(x, z, 3.2 + rand() * 0.5);
      }
    }
    // seconda fila, più indietro
    for (let s = 14; s < total; s += 27) {
      const p = this.pathAt(s);
      for (const side of [-1, 1]) {
        const lat = side * (34 + rand() * 6);
        const x = p.x + p.nx * lat;
        const z = p.z + p.nz * lat;
        if (blocked(x, z) || !farFromTrees(x, z, 18)) continue;
        tree(x, z, 3.4 + rand() * 0.6);
      }
    }
    // corona della radura (aperta verso il sentiero e verso il monolite)
    for (let a = 0; a < TAU; a += TAU / 15) {
      const aa = a + (rand() - 0.5) * 0.15;
      if (Math.cos(aa) > 0.72 || Math.cos(aa) < -0.55) continue;
      const r = 44 + rand() * 5;
      const x = CLEARING.x + Math.sin(aa) * r;
      const z = CLEARING.z + Math.cos(aa) * r;
      if (!farFromTrees(x, z, 14)) continue;
      tree(x, z, 3.4 + rand() * 0.6);
    }
    // fondo, più rado
    for (let tries = 0, n = 0; tries < 600 && n < 14; tries++) {
      const x = (rand() - 0.5) * 260;
      const z = 85 - rand() * 360;
      if (this.pathDist(x, z) < 52 || blocked(x, z, 22) || !farFromTrees(x, z, 30)) continue;
      tree(x, z, 3.6 + rand() * 0.7);
      n++;
    }

    // sottobosco: mai sulla porta, sul sentiero di maglie, sulla vite caduta, dentro la molla o nei tronchi
    const plantFree = (x, z) =>
      !(Math.abs(z - GATE_Z) < 9 && Math.abs(x) < 16) &&
      !(Math.abs(x) < LINKS.half + 1 && z < LINKS.z0 + 1 && z > LINKS.z1 - 1) &&
      Math.hypot(x - F.x, z - F.z) > 10 &&
      Math.hypot(x - CLEARING.x, z - CLEARING.z) > 30.5 &&
      farFromTrees(x, z, 2.5);
    const put = (name, x, z, scale) => {
      if (!plantFree(x, z)) return false;
      items[name].push({ x, y: groundHeight(x, z) - 0.05, z, rot: rand() * TAU, scale });
      return true;
    };
    // felci sui bordi del sentiero
    for (let s = 0; s < total; s += 5.5) {
      const p = this.pathAt(s);
      for (const side of [-1, 1]) {
        if (rand() < 0.25) continue;
        const lat = side * (7 + rand() * 8);
        put(rand() < 0.5 ? 'felce_a' : 'felce_b', p.x + p.nx * lat, p.z + p.nz * lat, 3 + rand() * 1.2);
      }
    }
    // fiori a mazzetti vicino al sentiero
    for (let s = 2; s < total; s += 8) {
      const p = this.pathAt(s);
      const lat = (rand() < 0.5 ? -1 : 1) * (4.5 + rand() * 6);
      const cx = p.x + p.nx * lat;
      const cz = p.z + p.nz * lat;
      const kind = ['fiori_a', 'fiori_b', 'fiori_c'][Math.floor(rand() * 3)];
      for (let i = 0, n = 3 + Math.floor(rand() * 4); i < n; i++) put(kind, cx + (rand() - 0.5) * 3.2, cz + (rand() - 0.5) * 3.2, 3.6 + rand() * 1.4);
    }
    // erba in tutta la fascia percorribile e sul bordo della radura
    for (let i = 0; i < 1100; i++) {
      const p = this.pathAt(rand() * total);
      const lat = (rand() < 0.5 ? -1 : 1) * (2.5 + rand() * 24);
      put(rand() < 0.6 ? 'erba_a' : 'erba_b', p.x + p.nx * lat, p.z + p.nz * lat, 3 + rand() * 1.6);
    }
    for (let i = 0; i < 220; i++) {
      const a = rand() * TAU;
      const r = 31 + rand() * 14;
      put(rand() < 0.6 ? 'erba_a' : 'erba_b', CLEARING.x + Math.sin(a) * r, CLEARING.z + Math.cos(a) * r, 3 + rand() * 1.6);
    }
    // funghi luminosi ai piedi degli alberi
    for (const t of this.trunks) {
      if (rand() < 0.45) continue;
      const a = rand() * TAU;
      const d = t.r + 1.2 + rand() * 2;
      put('funghi_luminosi', t.x + Math.cos(a) * d, t.z + Math.sin(a) * d, 4 + rand() * 2.5);
    }
    // rocce con muschio, fuori dalla linea di cammino (ostacoli)
    for (let s = 20, n = 0; s < total && n < 12; s += 17) {
      const p = this.pathAt(s);
      const lat = (rand() < 0.5 ? -1 : 1) * (13 + rand() * 9);
      const x = p.x + p.nx * lat;
      const z = p.z + p.nz * lat;
      const sc = 2.2 + rand() * 1.2;
      if (put(rand() < 0.5 ? 'roccia_a' : 'roccia_b', x, z, sc)) {
        this.obstacles.push({ x, z, r: 1.3 * sc });
        n++;
      }
    }
    // tronchi caduti paralleli al sentiero
    for (const [s, side] of [[38, 1], [96, -1], [150, 1]]) {
      const p = this.pathAt(s);
      const x = p.x + p.nx * side * 13.5;
      const z = p.z + p.nz * side * 13.5;
      if (!plantFree(x, z)) continue;
      const sc = 3.4;
      const rot = Math.atan2(-p.dz, p.dx) + (rand() - 0.5) * 0.4;
      items.tronco_caduto.push({ x, y: groundHeight(x, z) - 0.2, z, rot, scale: sc });
      const half = (3.65 / 2) * sc;
      this.obstacles.push({ ax: x - Math.cos(rot) * half, az: z + Math.sin(rot) * half, bx: x + Math.cos(rot) * half, bz: z - Math.sin(rot) * half, r: 0.5 * sc });
    }

    const U = this.natureUniforms;
    const add = (name, opts) => {
      if (items[name].length) this.scene.add(scatter(M[name], items[name], { uniforms: U, ...opts }));
    };
    treeNames.forEach((n) => add(n, { wind: 1, glow: 0.22 }));
    ['felce_a', 'felce_b'].forEach((n) => add(n, { wind: 5, windAll: true, glow: 0.1 }));
    ['fiori_a', 'fiori_b', 'fiori_c'].forEach((n) => add(n, { wind: 7, windAll: true, glow: 0.9, castShadow: false }));
    ['erba_a', 'erba_b'].forEach((n) => add(n, { wind: 7, windAll: true, glow: 0.06, castShadow: false }));
    ['roccia_a', 'roccia_b', 'tronco_caduto'].forEach((n) => add(n, {}));
    add('funghi_luminosi', { castShadow: false });
    this.columns = this.trunks.map((t) => ({ x: t.x, z: t.z, r: t.r }));
    this.woodsCount = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, v.length]));
  }

  // poche foglie che cadono piano nella luce, attorno a chi cammina (al posto dello sciame di prima):
  // il volume le segue e le ricicla, così il bosco resta ordinato ma vivo
  buildFallingLeaves() {
    this.leafTex = leafTexture();
    this.leafUniforms = { uTime: { value: 0 }, uGlow: { value: 0.3 } };
    const mat = new THREE.MeshStandardMaterial({
      map: this.leafTex,
      emissive: 0x2e7a2a,
      emissiveMap: this.leafTex,
      emissiveIntensity: 0.35,
      roughness: 0.55,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uGlow = this.leafUniforms.uGlow;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= uGlow * 3.0;');
    };
    mat.customProgramCacheKey = () => 'falling-leaves';
    this.leafMat = mat;
    const n = 140;
    const leaves = new THREE.InstancedMesh(leafGeometry(2.2, 1.0), mat, n);
    leaves.frustumCulled = false;
    leaves.userData.noCastShadow = true;
    const rand = mulberry32(9);
    this.fall = Array.from({ length: n }, () => ({
      x: (rand() - 0.5) * FALL.w,
      y: rand() * FALL.h,
      z: (rand() - 0.5) * FALL.w,
      speed: 0.6 + rand() * 0.8,
      phase: rand() * 6.283,
      spin: (rand() - 0.5) * 1.4,
      sway: 1 + rand() * 2.2,
      tilt: rand() * 6.283,
      size: 0.7 + rand() * 0.8,
    }));
    this.leaves = leaves;
    this.scene.add(leaves);
  }

  updateFallingLeaves(dt, t, player) {
    const wrap = (v, c) => c + ((((v - c + FALL.w / 2) % FALL.w) + FALL.w) % FALL.w) - FALL.w / 2;
    this.fall.forEach((f, i) => {
      f.y -= f.speed * dt;
      const x = wrap(f.x, player.x) + Math.sin(t * 0.55 + f.phase) * f.sway;
      const z = wrap(f.z, player.z) + Math.cos(t * 0.41 + f.phase) * f.sway * 0.6;
      if (f.y < groundHeight(x, z) - 0.5) f.y += FALL.h;
      _e.set(f.tilt + Math.sin(t * 0.9 + f.phase) * 0.7, f.spin * t, Math.cos(t * 0.7 + f.phase) * 0.6);
      _q.setFromEuler(_e);
      _m.compose(_p.set(x, f.y, z), _q, _s.setScalar(f.size));
      this.leaves.setMatrixAt(i, _m);
    });
    this.leaves.instanceMatrix.needsUpdate = true;
  }

  // nebbia bassa: veli che scorrono piano tra le onde del prato e svaniscono vicino agli occhi
  buildMist() {
    this.mistUniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() } };
    const layer = (y, opacity, scale, color) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: this.mistUniforms.uTime, uCam: this.mistUniforms.uCam, uOpacity: { value: opacity }, uScale: { value: scale }, uColor: { value: new THREE.Color(color) } },
        vertexShader: MIST_VERT,
        fragmentShader: MIST_FRAG,
        transparent: true,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(440, 440).rotateX(-Math.PI / 2), mat);
      mesh.position.set(0, y, -80);
      mesh.renderOrder = 2;
      mesh.userData.noShadow = true;
      mesh.userData.noSSR = true;
      this.scene.add(mesh);
    };
    layer(1.4, 0.5, 0.022, 0xd4efe0);
    layer(2.8, 0.26, 0.015, 0xe4f5ea);
    layer(10, 0.12, 0.009, 0xdaf1e2);
  }

  // il sole è il rotore vero (Modelli/3D/rotore.glb), gigante: oro rosa IP satinato circolare con le
  // incisioni del fondello. L'oro rosa ha un calore proprio, che cresce con la carica.
  async buildRotorSun() {
    const cfg = this.app.config.assets || {};
    const { object, materials } = await createRotor(cfg['model.rotor'] || 'assets/models/rotore.glb', { scale: 70 / ROTOR_RADIUS });
    this.rotorGold = materials.filter((m) => /oro rosa/i.test(m.name));
    this.rotorGold.forEach((m) => {
      m.emissive = new THREE.Color(0x6a2a16);
      m.emissiveIntensity = 0.7;
    });
    const rotor = new THREE.Group();
    rotor.add(object);
    const holder = new THREE.Group();
    holder.add(rotor);
    holder.position.set(0, 118, -178);
    holder.rotation.x = Math.PI - 0.32; // la faccia decorata guarda la foresta, inclinata verso la radura
    const rotorLight = new THREE.PointLight(0xffd2bc, 9000, 0, 2);
    rotorLight.position.set(0, 64, -150);
    this.scene.add(rotorLight);
    this.rotorLight = rotorLight;
    this.scene.add(holder);
    this.rotor = rotor;
    this.rotorHolder = holder;
    this.rotorAngle = 0;
    this.rotorVel = 0.06;
    const corona = glowSprite(0xffc8a8, 260, 0.28);
    corona.position.set(0, 128, -190);
    this.scene.add(corona);
    this.corona = corona;
    this.shafts = [];
    for (const [x, z, rz] of [[-30, -150, 0.2], [24, -168, -0.18], [0, -130, 0.05]]) {
      const sh = lightShaft({ length: 120, radiusTop: 6, radiusBottom: 22, color: 0xffd2b0, intensity: 0.045 });
      sh.position.set(x, 118, z);
      sh.rotation.z = rz;
      this.scene.add(sh);
      this.shafts.push(sh);
    }
  }

  // il "cielo" è il vetro zaffiro del fondello: anello inciso con le scritte reali del fondello
  buildSapphire() {
    const ring = curvedText('10 ATMOSPHERES  ·  MONICHS  ·  SWISS AUTOMATIC MOVEMENT  ·  316L STAINLESS STEEL  ·', {
      radius: 230,
      width: 16,
      start: 0,
      length: Math.PI * 2 - 0.01,
      font: '500 60px Montserrat',
      color: '#cfe8d6',
      canvasW: 4096,
      canvasH: 128,
      opacity: 0.32,
    });
    ring.position.set(0, 150, -150);
    ring.material.blending = THREE.AdditiveBlending;
    ring.material.fog = false;
    this.scene.add(ring);
    this.skyRing = ring;
    const edge = new THREE.Mesh(new THREE.TorusGeometry(244, 1.2, 8, 256), new THREE.MeshBasicMaterial({ color: 0x9fd8b8, transparent: true, opacity: 0.18, fog: false }));
    edge.rotation.x = Math.PI / 2;
    edge.position.copy(ring.position);
    this.scene.add(edge);
    // riflessi del vetro zaffiro
    const streakMat = new THREE.MeshBasicMaterial({ color: 0xbfe8d0, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    for (let i = 0; i < 3; i++) {
      const st = new THREE.Mesh(new THREE.PlaneGeometry(500, 26 + i * 10), streakMat);
      st.rotation.set(Math.PI / 2, 0, 0.6 + i * 0.35);
      st.position.set(0, 155 + i * 4, -150);
      this.scene.add(st);
    }
  }

  // la lunetta della Virentia come una porta, presa dal modello 3D: anello interno in acciaio satinato
  // circolare, anello esterno in oro rosa IP lucido. Nell'apertura, libera e trasparente, c'è il rotore:
  // in piedi, la faccia incisa verso chi arriva, la mezzaluna in alto come un arco; si passa in mezzo,
  // sotto il mozzo. Attraverso si vede, in fondo alla radura, la Virentia vera (il monolite).
  async buildGate() {
    const g = new THREE.Group();
    const R = 13; // apertura della porta = raggio interno della lunetta (le collisioni sono tarate qui)
    const cfg = this.app.config.assets || {};
    // materiali propri: l'evidenziazione della tappa non deve toccare l'orologio dell'epilogo
    const watch = (await createWatch('virentia', cfg['model.virentia'] || 'assets/models/virentia.glb')).ownMaterials().setScale(1);
    watch.object.updateMatrixWorld(true);
    // nel file (mm, asse Y) la lunetta ha l'apertura a r 14,6 e lo spessore tra y 8,25 e 10,06
    const rings = new THREE.Group();
    for (const part of watch.meshList('lunetta_anello_interno', 'lunetta_anello_esterno')) {
      const m = new THREE.Mesh(part.geometry, part.material);
      m.applyMatrix4(part.matrixWorld);
      rings.add(m);
    }
    rings.position.y = -9.15; // metà spessore sul piano della porta
    const bezel = new THREE.Group();
    bezel.add(rings);
    bezel.rotation.x = Math.PI / 2; // il fronte della lunetta guarda chi arriva (+Z)
    bezel.scale.setScalar(R / 14.6);
    g.add(bezel);
    // il rotore nella porta (asse lungo il sentiero): sul suo asse gira `gateSpin`
    // stessa luce del bosco della lunetta (con lo studio il cuscinetto lucidato abbagliava)
    const { object: gateRotor } = await createRotor(cfg['model.rotor'] || 'assets/models/rotore.glb', { scale: (R - 0.6) / ROTOR_RADIUS });
    const spin = new THREE.Group();
    spin.add(gateRotor);
    const axis = new THREE.Group();
    axis.rotation.x = Math.PI / 2; // faccia incisa verso +Z; ruotando attorno a Y locale gira sul suo asse
    axis.add(spin);
    g.add(axis);
    this.gateSpin = spin;
    this.gateAngle = Math.PI; // mezzaluna in alto: il passaggio sotto il mozzo è libero
    this.gateVel = 0;
    // la lunetta è un arco: la parte bassa affonda nel suolo, si passa a piedi sotto il rotore
    g.position.set(0, 12, GATE_Z);
    this.scene.add(g);
    this.gate = g;
    const gateLight = new THREE.PointLight(0xffd6c0, 700, 0, 2);
    gateLight.position.set(6, 24, -96);
    this.scene.add(gateLight);
    // sentiero di maglie con il centro in oro rosa che passa sotto la porta
    const poses = [];
    for (let i = 0; i < 16; i++) poses.push({ pos: V(0, 0.8, -88 - i * 5.2), dir: V(0, 0, -1) });
    this.links = buildBracelet(poses, { width: 18, length: 5, height: 2.0, accent: 'rose' });
    this.scene.add(this.links.group);
  }

  async buildMonolith() {
    const cfg = this.app.config.assets || {};
    const { group, watch } = await createMonolith('virentia', cfg['model.virentia'] || 'assets/models/virentia.glb', {
      scale: MONOLITH.scale,
      envMap: createEnvironment(this.app.renderer.renderer, 'studio'),
      envIntensity: 0.5,
    });
    group.position.set(MONOLITH.x, MONOLITH.y, MONOLITH.z);
    this.scene.add(group);
    this.monolith = group;
    this.monolithWatch = watch;
  }

  // la molla che si carica: una grande spirale luminosa nella radura
  buildSpring() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xf0b49a, metalness: 1, roughness: 0.18, emissive: 0xff9a70, emissiveIntensity: 0.1, side: THREE.DoubleSide });
    this.springMat = mat;
    this.spring = new SpiralRibbon({ samples: 900, height: 1.4, material: mat });
    this.spring.mesh.position.set(CLEARING.x, 1.2, CLEARING.z);
    this.scene.add(this.spring.mesh);
    this.updateSpring(0);
  }

  updateSpring(e) {
    const a0 = THREE.MathUtils.lerp(10, 3.5, e);
    const a1 = THREE.MathUtils.lerp(28, 16, e);
    const b = a1 - a0;
    const L = 2 * Math.PI * 9 * 13;
    const base = this.springAngle || 0;
    this.spring.update((u) => {
      const r = a0 + b * u;
      return { r, a: base - (L / b) * Math.log(r / a0) };
    });
  }

  buildHotspots() {
    const cards = this.app.config.cards || {};
    const mk = (id, position, radius, focusRadius, targets, extra = {}) => ({
      id,
      textKey: `virentia.stations.${id}`,
      image: cards[`virentia.stations.${id}`] || '',
      kickerKey: 'virentia.kicker',
      kickerVars: { n: STATIONS.indexOf(id) + 1, total: STATIONS.length },
      position,
      radius,
      focusRadius,
      targets,
      ...extra,
    });
    const at = (x, z) => this.walkEye(x, z, 1);
    this.hotspots = [
      mk('cotes', at(0, 6), 22, 12, []),
      mk('screws', at(-12, -22), 20, 11, [this.screwFeature]),
      mk('caseback', at(6, -70), 22, 12, []),
      mk('rosegold', at(0, -100), 20, 11, [this.gate]),
      mk('rotor', at(0, -129), 24, 12, [this.rotor], { actionKey: 'virentia.stations.rotor.action', onAction: () => this.startWinding(), actionOnce: true }),
    ];
    this.hotspots.forEach((h) => (h.uniforms = highlightTargets(h.targets)));
  }

  // il sentiero nella foresta e la radura; tronchi, vite caduta col suo ponte, fianchi della porta
  // e la molla (che si stringe caricando) sono ostacoli
  buildWalkArea() {
    const walk = new WalkArea({ stepTolerance: 1.6 });
    walk.corridor(PATH.map(([x, , z]) => [x, 0, z, 24]), { floorFn: floorHeight, name: 'sentiero' });
    walk.disc(CLEARING.x, CLEARING.z, 33, 0, { floorFn: floorHeight, name: 'radura' });
    this.trunks.forEach((t) => walk.circle(t.x, t.z, t.r + 0.25));
    this.obstacles.forEach((o) => (o.ax !== undefined ? walk.capsule(o.ax, o.az, o.bx, o.bz, o.r, -5, 6) : walk.circle(o.x, o.z, o.r, -5, 8)));
    const f = this.screwFeature;
    walk.circle(f.position.x, f.position.z, 5.5);
    const Y = new THREE.Vector3(0, 1, 0);
    const a = new THREE.Vector3(3, 0, 4).applyAxisAngle(Y, f.rotation.y).add(f.position);
    const b = new THREE.Vector3(19, 0, -1).applyAxisAngle(Y, f.rotation.y).add(f.position);
    walk.capsule(a.x, a.z, b.x, b.z, 4.7, 0.6, 4.8);
    walk.box(12.25, GATE_Z + 1.2, 5.25, 2.1, 0, -5, 30);
    walk.box(-12.25, GATE_Z + 1.2, 5.25, 2.1, 0, -5, 30);
    this.springBlock = walk.circle(CLEARING.x, CLEARING.z, 28.8, -5, 4);
    this.walk = walk;
    const pts = PATH.map(([x, , z]) => this.walkEye(x, z, 1, 0.3));
    pts.push(this.walkEye(0, -128, 1, 0.3));
    this.setPath(pts, 12, 4);
  }

  // ------------------------------------------------------------------ ciclo di vita

  resetProgress() {
    this.hotspots.forEach((h) => {
      h.visited = false;
      h.actionDone = false;
    });
  }

  enter(opts = {}) {
    super.enter(opts);
    this.attract = !!opts.attract;
    this.energy = 0;
    this.winding = null;
    this.app.player.frozen = false;
    this.updateSpring(0);
    this.exitShown = false;
    this.exitPortal.show(false);
    this.exitPortal.reveal = 0;
    this.exitPortal.group.visible = false;
    this.done = false;
    this.wisp.reset(V(0, 7, 28));
    this.wisp.pathLength = 0;
    if (!opts.attract) {
      this.hotspots.forEach((h) => {
        h.visited = false;
        h.actionDone = false;
      });
      this.app.narrator.say('virentia.narration.arrive', { delay: 1.2 });
      this.app.narrator.say('virentia.narration.arrive2');
    }
  }

  exit() {
    super.exit();
    this.app.player.frozen = false;
    this.app.renderer.postOverride = null;
  }

  progressState() {
    const done = this.hotspots.map((h, i) => (h.visited ? i : -1)).filter((i) => i >= 0);
    return { partKey: 'progress.virentia.part', nameKey: 'progress.virentia.name', total: STATIONS.length, done, current: this.hotspots.findIndex((h) => !h.visited) };
  }

  onHotspotVisited(h) {
    if (h.id === 'rosegold') this.app.narrator.say('virentia.narration.toRotor', { once: true, delay: 1.2 });
    this.app.ui.setProgress(this.progressState());
  }

  // ------------------------------------------------------------------ il gesto che carica

  startWinding() {
    if (this.winding) return;
    this.winding = { lastSign: 0, swing: 0, t: 0, swings: 0, done: false, idle: 0 };
    this.app.player.frozen = true; // durante il gesto lo sguardo resta fermo: il mouse carica
    this.app.narrator.clear();
    this.app.narrator.say(this.app.input.device === 'pad' ? 'virentia.narration.windPromptPad' : 'virentia.narration.windPrompt', { priority: true, hold: 6 });
    this.keyOff = this.app.input.on('key', (e) => {
      // alternativa da tastiera: A/D o frecce alternate
      if (!this.winding || this.winding.done) return;
      const sgn = e.code === 'KeyA' || e.code === 'ArrowLeft' ? -1 : e.code === 'KeyD' || e.code === 'ArrowRight' ? 1 : 0;
      if (sgn) this.addSwing(sgn, 160);
    });
  }

  addSwing(sign, amount) {
    const w = this.winding;
    if (sign !== w.lastSign && w.lastSign !== 0 && Math.abs(w.swing) > 90) {
      w.swings++;
      this.energy = Math.min(1, this.energy + 0.075);
      this.rotorVel += 0.9 * sign * -1;
      this.app.audio.ratchet(0.18);
      this.app.input.rumble(0, 0.3, 45);
      if (this.energy > 0.5 && !w.mid) {
        w.mid = true;
        this.app.narrator.say('virentia.narration.windMid', { priority: true });
      }
      w.swing = 0;
    }
    if (sign !== w.lastSign) w.swing = 0;
    w.lastSign = sign;
    w.swing += amount;
    w.idle = 0;
  }

  updateWinding(dt) {
    const w = this.winding;
    if (!w || w.done) return;
    w.t += dt;
    w.idle += dt;
    const input = this.app.input;
    // il mouse (o una delle due levette) muove il rotore: le inversioni di direzione caricano la molla
    const [mdx] = input.consumeMouse();
    const g = input.gamepad;
    const stick = Math.abs(g.rx) > Math.abs(g.lx) ? g.rx : g.lx;
    const dx = mdx + (g.active ? stick * 900 * dt : 0);
    if (Math.abs(dx) > 0.5) this.addSwing(Math.sign(dx), Math.abs(dx));
    this.rotorAngle += dx * 0.0016;
    // dopo un po' di inattività il gesto viene "aiutato" (in fiera nessuno deve restare bloccato)
    if (w.idle > 6) this.energy = Math.min(1, this.energy + dt * 0.08);
    if (this.energy >= 1) {
      w.done = true;
      this.app.player.frozen = false;
      if (this.keyOff) this.keyOff();
      this.app.narrator.say('virentia.narration.windDone', { priority: true });
      this.app.audio.swell([164.81, 246.94, 329.63, 493.88], { gain: 0.04, dur: 7 });
      setTimeout(() => this.showExit(), 6500);
    }
  }

  showExit() {
    if (this.exitShown || !this.active) return;
    this.exitShown = true;
    const p = this.app.player.position.clone();
    const fwd = new THREE.Vector3();
    this.app.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = V(fwd.z, 0, -fwd.x);
    p.addScaledVector(fwd, 10).addScaledVector(right, 8);
    this.placeOnWalk(p, { height: 4.6, radius: 2.5 });
    this.exitPortal.group.position.copy(p);
    this.exitPortal.show(true);
    this.app.narrator.say('virentia.narration.exit', { delay: 0.5 });
  }

  update(dt, t) {
    super.update(dt);
    const app = this.app;
    const cam = app.camera;
    const player = app.player.position;
    this.sky.update(dt, cam);
    this.fireflies.update(dt, cam);
    this.monolithWatch.setTime();
    this.updateFallingLeaves(dt, t, player);
    this.mistUniforms.uTime.value = t;
    this.mistUniforms.uCam.value.copy(cam.position);
    this.leafUniforms.uTime.value = t;
    this.shafts.forEach((sh) => (sh.material.uniforms.uTime.value = t));

    this.updateWinding(dt);
    // il rotore-sole gira piano; caricando accelera e poi rallenta
    this.rotorVel += (0.06 - this.rotorVel) * (1 - Math.exp(-dt * 0.6));
    this.rotorAngle += this.rotorVel * dt;
    this.rotor.rotation.y = this.rotorAngle;
    // il rotore della porta oscilla piano attorno alla mezzaluna in alto (come sotto un polso), senza mai
    // abbassare la fascia sul sentiero; avvicinandosi si ferma dritto e il passaggio sotto il mozzo è libero
    const dg = Math.hypot(player.x, player.z - GATE_Z);
    const calm = THREE.MathUtils.smoothstep(dg, 32, 12);
    const sway = (Math.sin(t * 0.37) * 0.3 + Math.sin(t * 0.13 + 1.1) * 0.2) * (1 - calm);
    this.gateVel += (Math.PI + sway - this.gateAngle) * dt * 2.2 - this.gateVel * dt * 1.6;
    this.gateAngle += this.gateVel * dt;
    this.gateSpin.rotation.y = this.gateAngle;
    this.springAngle = (this.springAngle || 0) - this.energy * dt * 0.2;
    if (this.winding) this.updateSpring(this.energy);
    // la molla occupa il centro della radura: il suo ingombro si stringe con la carica
    this.springBlock.r = THREE.MathUtils.lerp(28, 16, this.energy) + 0.8;

    // la luce cresce con l'energia
    const e = this.energy;
    this.leafUniforms.uGlow.value = 0.55 + e * 1.2 + Math.sin(t * 0.8) * 0.04;
    // il bosco si accende con la carica e ondeggia al vento
    this.natureUniforms.uTime.value = t;
    this.natureUniforms.uGlow.value = this.leafUniforms.uGlow.value;
    this.springMat.emissiveIntensity = 0.1 + e * 2.2;
    this.glade.intensity = 500 + e * 2600;
    this.sun.intensity = 1.5 + e * 1.6;
    this.corona.material.opacity = 0.28 + e * 0.35;
    this.rotorGold.forEach((m) => (m.emissiveIntensity = 0.7 + e * 1.6));
    this.rotorLight.intensity = 9000 + e * 14000;
    this.fireflies.uniforms.uOpacity.value = 0.6 + e * 0.4;
    app.renderer.postOverride = e > 0.01 ? { bloom: 0.9 + e * 0.6, exposure: 1 + e * 0.25 } : null;

    this.exitPortal.update(dt, cam);
    if (this.exitShown && !this.done && app.director.state === 'play' && this.exitPortal.contains(player)) {
      this.done = true;
      app.director.completeWorld('virentia');
    }
    const next = this.hotspots.find((h) => !h.visited);
    this.wisp.setTarget(this.attract ? null : this.exitShown ? this.exitPortal.group.position : next ? next.position : this.hotspots[4].position);
    this.wisp.update(dt, player, { hide: !!app.hotspots.focused || app.director.state !== 'play' || !!(this.winding && !this.winding.done) });
  }
}
