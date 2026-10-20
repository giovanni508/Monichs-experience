import * as THREE from 'three';
import { World } from './World.js';
import { WalkArea, insetEnds } from '../core/WalkArea.js';
import { createEnvironment } from '../gfx/env.js';
import { Mat, highlightTargets } from '../gfx/materials.js';
import { DustField } from '../gfx/particles.js';
import { lightShaft, glowSprite, loadTexture } from '../gfx/effects.js';
import { caliberState, CALIBER } from '../mech/Caliber.js';
import { pinionShape, wheelShape, extrudeXZ, crownGeometry } from '../gfx/gears.js';
import { GuideWisp } from './common/GuideWisp.js';
import { Portal } from './common/Portal.js';
import * as P from './movement/parts.js';
import { SunShadow, enableShadows } from '../gfx/shadows.js';
import { createMonolith, createRotor, ROTOR_RADIUS } from '../gfx/watchModel.js';
import { buildWalkway, buildHubPlatform, buildLift, stripMaterial } from './movement/walkway.js';

// TODO(brand): la riserva di carica NON è indicata da nessuna parte: nei documenti compaiono
// due valori diversi (38 h e 65 h). Da chiarire prima di aggiungerla ai testi.

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const dir2 = (deg) => new THREE.Vector2(Math.cos((deg * Math.PI) / 180), -Math.sin((deg * Math.PI) / 180));
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// ------------------------------------------------------------------ layout del calibro (unità ≈ 0,1 mm, stilizzato)
// Le distanze tra gli assi sono la somma dei raggi primitivi: gli ingranaggi ingranano davvero.
const M = { barrel: 0.5, center: 0.3, third: 0.28, fourth: 0.2 };
const L = (() => {
  const B = new THREE.Vector2(-17, 8);
  const C = B.clone().addScaledVector(dir2(40), (72 * M.barrel) / 2 + (12 * M.barrel) / 2);
  const T = C.clone().addScaledVector(dir2(72), (80 * M.center) / 2 + (10 * M.center) / 2);
  const F = T.clone().addScaledVector(dir2(112), (75 * M.third) / 2 + (10 * M.third) / 2);
  const E = F.clone().addScaledVector(dir2(62), (96 * M.fourth) / 2 + (6 * M.fourth) / 2);
  const escR = 5.5;
  const escDist = escR / Math.cos(Math.PI / 6);
  const Pp = E.clone().addScaledVector(dir2(90), escDist);
  const forkLen = 8;
  const S = Pp.clone().addScaledVector(dir2(90), forkLen + 0.92);
  return {
    B, C, T, F, E, P: Pp, S, escR, escDist, forkLen,
    alpha: { BC: 40, CT: 72, TF: 112, FE: 62 },
    plateY: -6,
    bridgeY: 14,
    bridgeT: 2.4,
    rotorY: 34,
    stemY: 4,
    CW: new THREE.Vector2(-7.5, 17.5),
  };
})();

// ------------------------------------------------------------------ a piedi nel calibro
// Sei piccolo: gli occhi stanno a 2,2 unità dal pavimento. Si cammina su una passerella in vetro
// zaffiro sospesa tra la piastra e i ponti: sopra l'asta di carica, accanto al bariletto, sopra il
// rodaggio, attorno al bilanciere. Un ascensore porta sulla piattaforma sopra il bilanciere, sotto il rotore.
const FL = 6; // pavimento della passerella (sopra l'asta, sotto i ponti)
const FU = 17.6; // piattaforma sopra i ponti
const EYE = 2.2;
const W = 2.2; // semilarghezza della passerella
const TUBE_R = 6.4; // tubo della corona, allargato: ci si passa a piedi sopra l'asta
const RING_R = 16; // passerella attorno al bilanciere
const ringAt = (deg, r = RING_R) => [L.S.x + r * Math.sin((deg * Math.PI) / 180), L.S.y + r * Math.cos((deg * Math.PI) / 180)];
const LIFT = (() => {
  const [x, z] = ringAt(165);
  return { x, z, r: 3 };
})();
const H = V(L.S.x, FU + EYE, L.S.y); // centro della piattaforma, all'altezza degli occhi

// percorsi: [x, z, semilarghezza]; tutto alla quota FL
// fuori: dalla partenza al pianerottolo davanti alla corona, a distanza (la si vede intera, con la minuteria)
const OUT = [
  [0, 124, W],
  [0, 110, W],
  [0, 104, 3.4],
  [0, 96.3, 3.4],
];
// ponte che si distende sopra il vuoto quando la corona è carica
const BRIDGE = [
  [0, 96.3, W],
  [0, 81.4, W],
];
// dentro: nel tubo sopra l'asta, poi tra gli ingranaggi fino all'ascensore
// (comincia dentro il volume della corona: finché è intera non si vede)
const IN = [
  [0, 81.4, W],
  [0, 66, W],
  [0, 56, W],
  [2.4, 47, W],
  [4.5, 40, W], // rotore
  [6, 30, W],
  [6.4, 19, W],
  [5.2, 9, W], // innesto del balcone sul bariletto
  [6, -1, W],
  [8.5, -10, W],
  [9.2, -17, W], // rodaggio
  [9.5, -27, W],
  [8.6, -35, W],
  [8, -41.5, W], // scappamento: la ruota di scappamento è sotto i piedi, a sinistra
];
for (let d = 45; d <= 150; d += 7.5) {
  const [x, z] = ringAt(d);
  IN.push([x, z, W]);
}
IN.push([...ringAt(154.2), W]); // fine: bordo dell'ascensore
const JUNCTION = 7; // IN[JUNCTION] = innesto del balcone
const SPUR = [
  [3.1, 8.85, 1.8],
  [-1, 8.5, 1.8],
  [-6.3, 8, 1.8],
];

const STATION_ORDER = ['crown', 'rotor', 'barrel', 'train', 'escapement', 'balance', 'rubies', 'finishing'];
// i monoliti: le tre Delta, complete e giganti, nel vuoto alle spalle della partenza. Si vedono per
// prime; poi lo sguardo va alla corona. Centro della cassa; scala in unità per mm (alti 69, larghi 43).
const MONOLITHS = { y: 26, scale: 1, list: [
  { id: 'celeste', x: 51, z: 205 },
  { id: 'sunset', x: 0, z: 212 },
  { id: 'virentia', x: -51, z: 205 },
] };
const START = V(0, FL + EYE, 119);

export class MovementWorld extends World {
  constructor(app) {
    super(app, 'movement');
    this.audioPalette = 'movement';
    this.tickTimbre = 'crisp';
    this.post = {
      bloom: 0.85,
      bloomThreshold: 0.78,
      exposure: 1.05,
      vignette: 0.62,
      grain: 0.085,
      ao: { radius: 2, intensity: 2.6 },
      ssr: { intensity: 1, maxDistance: 140, thickness: 1.2 },
    };
    this.speedScale = 1;
    this.eyeHeight = EYE;
    this.bodyRadius = 0.55;
    this.wind = 0.55;
    this.windAnim = null;
    this.timeAction = null;
    this.hubMode = false;
    this.flags = new Set();
    this.state = {};
    this.jewelAnim = null;
    this.sweep = null;
    // la corona: finché non la si carica l'orologio è fermo e il tubo è chiuso
    this.wound = false;
    this.crownWind = 0;
    this.windBoost = 0;
    this.windClicks = 0;
    this.crownFocusT = 0;
    this.lift = { y: FL, from: FL, to: FL, k: 1, onT: 0, callT: 0 };
  }

  // ------------------------------------------------------------------ costruzione
  async load() {
    const app = this.app;
    const s = this.scene;
    s.background = new THREE.Color(0x07060a);
    this.fogInside = new THREE.Color(0x0d0a08);
    this.fogOutside = new THREE.Color(0x05060c);
    s.fog = new THREE.FogExp2(this.fogInside.clone(), 0.0105);
    s.environment = createEnvironment(app.renderer.renderer, 'workshop');
    s.environmentIntensity = 1;

    this.buildLights();
    this.buildStructure();
    this.buildKeyless();
    this.buildTrain();
    this.buildEscapementAndBalance();
    await this.buildRotor();
    this.buildJewelsAndScrews();
    this.buildWalkways();
    await this.buildHub();
    await this.buildMonoliths();
    this.buildWalkArea();

    // ombre della luce principale: ingranaggi, ponti, rotore e travi le proiettano sulla piastra;
    // la parete della cassa no (è luce che entra da fuori: una mezzaluna d'ombra coprirebbe tutto)
    enableShadows(s);
    s.userData.shadow = new SunShadow(this.key, { extent: 70, distance: 220 });

    this.dust = new DustField({ count: 1700, box: [70, 30, 70], color: 0xffd9b0, size: 0.8, opacity: 0.5, rise: 0.03 });
    s.add(this.dust.points);
    this.wisp = new GuideWisp(this, { color: 0xffe0b0, size: 1.1 });

    // guida: lungo la passerella, poi su con l'ascensore fino al centro della piattaforma
    const pathPts = [...OUT.slice(0, 2), ...IN].map(([x, z]) => V(x, FL + EYE + 0.2, z));
    pathPts.push(V(LIFT.x, FL + EYE + 0.2, LIFT.z), V(LIFT.x, FU + EYE + 0.2, LIFT.z), V(H.x, H.y + 0.2, H.z));
    this.setPath(pathPts, 3, 2);
    this.buildHotspots();
    this.setWound(false);
    this.setLift(FL);

    this.spawn = { position: V(0, FL + EYE, 119), yaw: 0, pitch: -0.03 };
    this.attractShots = [
      { from: [14, 12, 128], to: [-12, 14, 136], lookFrom: [0, 28, 204], lookTo: [0, 30, 204], duration: 9, labelKey: 'attract.movement' },
      { from: [3, 9.5, 116], to: [0, 8.6, 96], lookFrom: [0, 5.5, 82], lookTo: [0, 4.5, 82], duration: 9, labelKey: 'attract.movement' },
      { from: [22, 13, -2], to: [-6, 11, -26], lookFrom: [2, 2, -14], lookTo: [4, 1, -40], duration: 10, labelKey: 'attract.movement' },
      { from: [28, 26, -40], to: [-14, 24, -72], lookFrom: [L.S.x, 4, L.S.y], lookTo: [L.S.x, 4, L.S.y], duration: 10, labelKey: 'attract.movement' },
    ];
    this.updateMechanism(0);
    this.loaded = true;
  }

  buildLights() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight(0xffe6cc, 0x0a0806, 0.35);
    s.add(this.hemi);
    // luce principale radente: guardando in basso dalla passerella il suo riflesso sull'acciaio
    // lucidato non finisce negli occhi (con una luce alta, il riflesso abbagliava)
    this.key = new THREE.DirectionalLight(0xffe0bc, 1.6);
    this.key.position.set(-46, 30, 22);
    s.add(this.key);
    this.fill = new THREE.DirectionalLight(0x8ea6ff, 0.28);
    this.fill.position.set(40, 10, -60);
    s.add(this.fill);
    this.crownLight = new THREE.PointLight(0xc4d4ff, 600, 0, 2);
    this.crownLight.position.set(-20, 15, 102);
    s.add(this.crownLight);
    this.barrelLight = new THREE.PointLight(0xffcf9c, 420, 0, 2);
    this.barrelLight.position.set(-8, 12, 14);
    s.add(this.barrelLight);
    // luci lontane dalla passerella e dalla piattaforma (niente sorgenti all'altezza degli occhi)
    this.heartLight = new THREE.PointLight(0xffc48e, 500, 0, 2);
    this.heartLight.position.set(L.S.x - 6, 11, L.S.y + 4);
    s.add(this.heartLight);
    this.trainLight = new THREE.PointLight(0xffe2c4, 260, 0, 2);
    this.trainLight.position.set(-7, 11, -24);
    s.add(this.trainLight);

    // raggi di luce dal lucernario (sotto il rotore) e sopra il bilanciere
    this.shafts = [];
    const add = (x, y, z, len, rt, rb, inten, tilt = 0) => {
      const sh = lightShaft({ length: len, radiusTop: rt, radiusBottom: rb, color: 0xffd6a4, intensity: inten });
      sh.position.set(x, y, z);
      sh.rotation.z = tilt;
      s.add(sh);
      this.shafts.push(sh);
    };
    add(8, 30, 44, 38, 2.5, 10, 0.07, 0.15);
    add(-6, 30, 32, 36, 2, 8, 0.05, -0.1);
    add(L.S.x + 2, 34, L.S.y, 36, 3, 13, 0.06, 0.08);

    // luce radente per la tappa della finitura (creata subito: aggiungere luci a runtime ricompila gli shader)
    this.sweepLight = new THREE.SpotLight(0xfff2e0, 0, 60, 0.32, 0.6, 1.2);
    this.sweepLight.position.set(L.S.x, 34, L.S.y);
    this.sweepLight.target.position.set(L.S.x, 14, L.S.y);
    s.add(this.sweepLight, this.sweepLight.target);
  }

  buildStructure() {
    const s = this.scene;
    // piastra (perlage)
    s.add(P.buildPlate({ center: L.C, radius: 66, y: L.plateY }));
    // cassa con il tubo della corona
    const caseGroup = P.buildCase({ center: L.C, rInner: 70, rOuter: 78, yMin: -12, yMax: 32, gapAngle: 0, gapWidthAngle: 0.2 });
    caseGroup.traverse((o) => (o.userData.noCastShadow = true));
    s.add(caseGroup);
    const caseMat = caseGroup.userData.material;
    const zIn = L.C.y + 70;
    const zOut = L.C.y + 78;
    this.tubeZ = [zIn, zOut];
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(TUBE_R, TUBE_R, zOut - zIn + 1, 64, 1, true), Mat.steelPolished({ color: 0xc9ccd1, roughness: 0.12, side: THREE.DoubleSide }));
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, L.stemY, (zIn + zOut) / 2);
    s.add(tube);
    const gasket = new THREE.Mesh(new THREE.TorusGeometry(TUBE_R - 0.4, 0.45, 12, 72), new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.75 }));
    gasket.position.set(0, L.stemY, (zIn + zOut) / 2 + 1.5);
    s.add(gasket);
    // tassello della carrure con il foro del tubo (chiude il varco lasciato nella parete)
    const hw = TUBE_R + 2.2;
    const slab = new THREE.Shape([
      new THREE.Vector2(-hw, -12),
      new THREE.Vector2(hw, -12),
      new THREE.Vector2(hw, 32),
      new THREE.Vector2(-hw, 32),
    ]);
    const holePath = new THREE.Path();
    holePath.absarc(0, L.stemY, TUBE_R, 0, Math.PI * 2, true);
    slab.holes.push(holePath);
    const slabGeo = new THREE.ExtrudeGeometry(slab, { depth: zOut - zIn, bevelEnabled: false, curveSegments: 32 });
    const slabMesh = new THREE.Mesh(slabGeo, caseMat);
    slabMesh.position.z = zIn;
    slabMesh.userData.noCastShadow = true;
    s.add(slabMesh);

    // ponti (Côtes de Genève, smussi lucidati)
    this.bridgeMat = P.bridgeMaterial();
    this.cockMat = P.bridgeMaterial();
    const by = L.bridgeY;
    const add = (points, margin, mat = this.bridgeMat, y = by) => {
      const m = P.buildBridge({ points, margin, y, thickness: L.bridgeT, material: mat });
      s.add(m);
      return m;
    };
    add([[L.B.x, L.B.y]], 20);
    add([[L.CW.x, L.CW.y], [1, 22]], 7);
    add([[L.C.x, L.C.y], [L.T.x, L.T.y], [L.F.x, L.F.y], [L.E.x, L.E.y]], 4.6);
    add([[L.P.x, L.P.y], [L.P.x + 5, L.P.y + 2]], 2.8);
    this.cock = add([[L.S.x, L.S.y], [L.S.x - 16, L.S.y - 8]], 3.4, this.cockMat, 13);
    // pilastri tra piastra e ponti
    const pillarMat = Mat.rhodium({ color: 0x8e9298, roughness: 0.4 });
    this.pillars = [[-30, 18], [-33, -2], [10, 6], [-8, -40], [16, -32], [-13, -62]];
    for (const [x, z] of this.pillars) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, L.bridgeY - L.plateY, 24), pillarMat);
      p.position.set(x, (L.bridgeY + L.plateY) / 2, z);
      s.add(p);
    }
  }

  buildKeyless() {
    const s = this.scene;
    // corona (si dissolve una volta caricata) e asta
    this.crown = P.buildCrown({ radius: 9, length: 8, z: this.tubeZ[1] + 8.8, y: L.stemY });
    s.add(this.crown);
    this.crownFaceZ = this.crown.position.z + 9 * 0.08;
    // minuteria di luce attorno alla corona: si accende mentre la si carica
    this.windRing = new THREE.Mesh(
      new THREE.RingGeometry(9.55, 11.3, 240, 1),
      new THREE.ShaderMaterial({
        uniforms: { uProgress: { value: 0 }, uOpacity: { value: 1 }, uFlash: { value: 0 }, uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vPos;
          void main() { vPos = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uProgress; uniform float uOpacity; uniform float uFlash; uniform float uTime;
          varying vec2 vPos;
          void main() {
            float r = length(vPos);
            float u = fract(atan(vPos.x, vPos.y) / 6.2831853 + 1.0); // 0 a ore 12, in senso orario
            float seg = u * 60.0;
            float idx = floor(seg);
            float major = 1.0 - step(0.5, mod(idx, 5.0));
            float w = mix(0.13, 0.22, major);
            float tick = 1.0 - smoothstep(w, w + 0.07, abs(fract(seg) - 0.5));
            float rIn = mix(10.35, 9.75, major);
            float radial = smoothstep(rIn - 0.05, rIn + 0.05, r) * (1.0 - smoothstep(11.0, 11.12, r));
            float lit = step((idx + 0.5) / 60.0, uProgress);
            float next = (1.0 - lit) * step(uProgress, (idx + 0.5) / 60.0) * step((idx - 0.5) / 60.0, uProgress);
            vec3 dim = vec3(0.55, 0.47, 0.42) * 0.3;
            vec3 on = vec3(1.0, 0.8, 0.6) * (2.3 + uFlash * 3.0);
            vec3 col = mix(dim, on, lit) + vec3(1.0, 0.85, 0.7) * next * (0.6 + 0.4 * sin(uTime * 6.0));
            float a = tick * radial * uOpacity;
            gl_FragColor = vec4(col * a, a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.windRing.position.set(0, L.stemY, this.crownFaceZ + 0.3);
    this.windRing.renderOrder = 5;
    s.add(this.windRing);

    this.stem = new THREE.Group();
    const stemMat = Mat.steelPolished({ color: 0xd6d9de, roughness: 0.1 });
    this.stemMat = stemMat;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, this.tubeZ[1] + 8 - 16, 32), stemMat);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = (this.tubeZ[1] + 8 + 16) / 2;
    this.stem.add(shaft);
    // pignone scorrevole (dentatura Breguet stilizzata)
    const slidingGeo = crownGeometry({ radius: 2.1, length: 2.4, flutes: 12, depth: 0.35 });
    const sliding = new THREE.Mesh(slidingGeo, stemMat);
    sliding.position.z = 27;
    this.stem.add(sliding);
    // pignone di carica (asse lungo Z)
    const wp = pinionShape({ leaves: 14, module: 0.35, addendum: 0.9, dedendum: 1.2, thickness: 0.45 });
    const wpGeo = new THREE.ExtrudeGeometry(wp.shape, { depth: 1.6, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 1 });
    const winding = new THREE.Mesh(wpGeo, stemMat);
    winding.position.z = 20;
    this.stem.add(winding);
    this.stem.position.set(0, L.stemY, 0);
    s.add(this.stem);

    // ruota corona (orizzontale) che ingrana con il rocchetto del bariletto
    const cwShape = wheelShape({ teeth: 40, module: 0.2925, spokes: 4, thickness: 0.48 });
    this.crownWheelMat = Mat.steelSatin({ color: 0xd9dce0, roughness: 0.18, anisotropy: 0.8 });
    this.crownWheel = new THREE.Mesh(extrudeXZ(cwShape.shape, 1.0, { bevel: 0.1 }), this.crownWheelMat);
    this.crownWheel.position.set(L.CW.x, 6.5, L.CW.y);
    s.add(this.crownWheel);

    // bariletto, molla e rocchetto
    this.barrelMats = {
      barrel: Mat.brass({ color: 0xd8b878, roughness: 0.28 }),
      barrelFloor: Mat.brass({ color: 0xc9a868, roughness: 0.4 }),
      steel: Mat.steelPolished({ color: 0xd2d5da, roughness: 0.14 }),
      ratchet: Mat.steelSatin({ color: 0xdadde2, roughness: 0.16, anisotropy: 0.85 }),
      spring: Mat.steelPolished({ color: 0xc9d0dc, roughness: 0.16, side: THREE.DoubleSide }),
      screw: Mat.steelPolished({ color: 0xe5e7ea, roughness: 0.05 }),
    };
    this.ratchetR = L.CW.distanceTo(L.B) - 5.85;
    this.barrel = P.buildBarrel({ x: L.B.x, z: L.B.y, ratchetR: this.ratchetR, mats: this.barrelMats });
    s.add(this.barrel.group);
    this.updateSpring();
  }

  buildTrain() {
    const s = this.scene;
    const wheelMat = Mat.brass({ color: 0xe2c07c, roughness: 0.24 });
    const pinionMat = Mat.steelPolished({ color: 0xd9dce0, roughness: 0.1 });
    this.trainMats = { wheel: wheelMat, pinion: pinionMat, steel: pinionMat };
    const tr = CALIBER.train;
    const specs = {
      center: {
        wheel: { teeth: tr.center, module: M.center, thickness: 0.5, y: -1, spokes: 5 },
        pinion: { leaves: tr.centerPinion, module: M.barrel, height: 2.2, y: -5.6 },
        arbor: { yMin: L.plateY, yMax: L.bridgeY, radius: 0.55 },
      },
      third: {
        wheel: { teeth: tr.third, module: M.third, thickness: 0.45, y: -4.2, spokes: 5, curve: 0.18 },
        pinion: { leaves: tr.thirdPinion, module: M.center, height: 2.0, y: -1.6 },
        arbor: { yMin: L.plateY, yMax: L.bridgeY, radius: 0.45 },
      },
      fourth: {
        wheel: { teeth: tr.fourth, module: M.fourth, thickness: 0.4, y: -1, spokes: 5, curve: 0.22 },
        pinion: { leaves: tr.fourthPinion, module: M.third, height: 1.8, y: -4.6 },
        arbor: { yMin: L.plateY, yMax: L.bridgeY, radius: 0.4 },
      },
    };
    this.arbors = {};
    for (const [name, spec] of Object.entries(specs)) {
      const g = P.buildTrainArbor({ ...spec, mats: this.trainMats });
      const pos = { center: L.C, third: L.T, fourth: L.F }[name];
      g.position.set(pos.x, 0, pos.y);
      s.add(g);
      this.arbors[name] = g;
    }
    // fasi iniziali perché denti e ali ingranino (vedi Caliber.js per i rapporti)
    const wrap = (a, p) => ((((a + p / 2) % p) + p) % p) - p / 2;
    const meshOffset = (rhoWheel, zWheel, zPinion, alphaDeg) => {
      const a = (alphaDeg * Math.PI) / 180;
      const pw = TAU / zWheel;
      const pp = TAU / zPinion;
      const delta = wrap(a - rhoWheel, pw);
      return a + Math.PI + pp / 2 + delta * (zWheel / zPinion);
    };
    this.offsets = { barrel: 0 };
    this.offsets.center = meshOffset(0, tr.barrel, tr.centerPinion, L.alpha.BC);
    this.offsets.third = meshOffset(this.offsets.center, tr.center, tr.thirdPinion, L.alpha.CT);
    this.offsets.fourth = meshOffset(this.offsets.third, tr.third, tr.fourthPinion, L.alpha.TF);
    this.offsets.escape = meshOffset(this.offsets.fourth, tr.fourth, tr.escapePinion, L.alpha.FE);
  }

  buildEscapementAndBalance() {
    const s = this.scene;
    this.escMats = {
      escape: Mat.steelPolished({ color: 0xdcdfe3, roughness: 0.08 }),
      escapeSteel: Mat.steelPolished({ color: 0xd2d5da, roughness: 0.1 }),
      fork: Mat.steelSatin({ color: 0xd5d8dc, roughness: 0.2, anisotropy: 0.6 }),
      ruby: Mat.ruby({ emissiveIntensity: 1.1 }),
    };
    const esc = P.buildEscapement({ escRadius: L.escR, escDist: L.escDist, forkLen: L.forkLen, mats: this.escMats });
    esc.escGroup.position.set(L.E.x, 0, L.E.y);
    esc.forkGroup.position.set(L.P.x, 0, L.P.y);
    s.add(esc.escGroup, esc.forkGroup);
    this.escGroup = esc.escGroup;
    this.forkGroup = esc.forkGroup;
    // fase della ruota di scappamento: un dente in appoggio sulla paletta d'entrata a riposo
    const stone = esc.stones[0];
    const fw = new THREE.Vector3(stone.x, 0, -stone.y).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2).add(V(L.P.x, 0, L.P.y));
    this.escPhase = Math.atan2(-(fw.z - L.E.y), fw.x - L.E.x);

    this.balMats = {
      balance: Mat.glucydur(),
      steel: Mat.steelPolished({ color: 0xd8dbe0, roughness: 0.08 }),
      ruby: this.escMats.ruby,
      hairspring: Mat.steelPolished({ color: 0xaab8cc, roughness: 0.16, side: THREE.DoubleSide }),
    };
    const bal = P.buildBalance({ radius: 12, mats: this.balMats });
    bal.group.position.set(L.S.x, 0, L.S.y);
    s.add(bal.group);
    this.balance = bal.group;
    this.hairspring = P.buildHairspring(this.balMats);
    this.hairspring.mesh.position.x = L.S.x;
    this.hairspring.mesh.position.z = L.S.y;
    s.add(this.hairspring.mesh);
    // pitone (stud) e racchetta sul ponte del bilanciere
    const studA = 0; // estremità esterna della spirale (vedi updateMechanism)
    const stud = new THREE.Mesh(new THREE.BoxGeometry(0.9, 8.2, 0.9), this.balMats.steel);
    stud.position.set(L.S.x + Math.cos(studA) * 6.25, 9.0, L.S.y - Math.sin(studA) * 6.25);
    s.add(stud);
    const index = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.3, 0.6), this.balMats.steel);
    index.position.set(L.S.x + 3.2, 12.75, L.S.y + 1.2);
    index.rotation.y = 0.35;
    s.add(index);
  }

  // il rotore: il modello 3D (Modelli/3D/rotore.glb), sul perno al centro del calibro, sopra i ponti.
  // Faccia incisa in alto, verso il fondello, come nell'orologio; da sotto si vedono il bordo pesante
  // a gradini e il cuscinetto. Braccio centrale verso -Z (l'animazione conta l'angolo da lì).
  async buildRotor() {
    const cfg = this.app.config.assets || {};
    const R = 60;
    const { object, materials } = await createRotor(cfg['model.rotor'] || 'assets/models/rotore.glb', { scale: R / ROTOR_RADIUS });
    object.rotation.y = Math.PI;
    this.rotor = new THREE.Group();
    this.rotor.add(object);
    this.rotor.position.set(L.C.x, L.rotorY + 2.2, L.C.y);
    this.scene.add(this.rotor);
    this.rotorMats = materials;
    this.rotorAngle = 2.2;
    this.rotorVel = 0;
  }

  buildJewelsAndScrews() {
    const s = this.scene;
    const top = L.bridgeY + L.bridgeT + 0.12;
    const under = L.bridgeY - 0.12;
    const plate = L.plateY + 0.12;
    // 26 rubini logici: ogni voce può avere più "dischi" visibili (sotto e sopra un ponte)
    const logical = [];
    const addArbor = (p, cockY = null) => {
      logical.push([{ x: p.x, y: plate, z: p.y }]);
      logical.push([
        { x: p.x, y: cockY ?? under, z: p.y, flip: true },
        { x: p.x, y: (cockY ?? under) + L.bridgeT + 0.24, z: p.y },
      ]);
    };
    [L.C, L.T, L.F, L.E, L.P].forEach((p) => addArbor(p));
    // bilanciere: pietre forate + contropietre, sulla piastra e sul ponte
    addArbor(L.S, 13 - 0.12);
    logical.push([{ x: L.S.x + 1.6, y: plate, z: L.S.y + 0.6, s: 0.7 }]);
    logical.push([{ x: L.S.x, y: 13 + L.bridgeT + 0.4, z: L.S.y, s: 0.75 }]);
    // modulo automatico (sotto il rotore, sopra i ponti)
    const auto = [[-9, 2], [-14, -6], [-5, -14], [8, 10], [12, -2], [-20, 4], [4, -6], [-24, -10], [15, 14]];
    auto.forEach(([dx, dz]) => logical.push([{ x: L.C.x + dx, y: top, z: L.C.y + dz, s: 0.8 }]));
    this.logicalJewelCount = logical.length + 3; // + 2 palette + ellisse = 26
    const flat = [];
    this.jewelMap = logical.map((discs) => discs.map((d) => (flat.push(d), flat.length - 1)));
    this.jewels = P.buildJewels(flat);
    s.add(this.jewels);

    const screwPos = [
      { x: L.B.x + 13, y: top, z: L.B.y + 11 },
      { x: L.B.x - 14, y: top, z: L.B.y - 6 },
      { x: L.B.x - 4, y: top, z: L.B.y + 16 },
      { x: L.CW.x + 4, y: top, z: L.CW.y + 6 },
      { x: L.C.x + 3.5, y: top, z: L.C.y - 3 },
      { x: L.F.x - 3.6, y: top, z: L.F.y + 2 },
      { x: L.E.x + 3.4, y: top, z: L.E.y + 1 },
      { x: L.P.x + 4.5, y: top, z: L.P.y + 2 },
    ];
    this.screws = P.buildScrews(screwPos, { radius: 1.25, head: 0.7 });
    s.add(this.screws);
    this.cockScrews = P.buildScrews([{ x: L.S.x - 14.5, y: 13 + L.bridgeT + 0.12, z: L.S.y - 7.3 }, { x: L.S.x - 9.5, y: 13 + L.bridgeT + 0.12, z: L.S.y - 4.6 }], { radius: 1.3, head: 0.75 });
    s.add(this.cockScrews);
  }

  // passerelle: fuori (fino al pianerottolo), ponte sul vuoto (si distende dopo la carica), dentro
  // (fino all'ascensore) e balcone sopra il bariletto
  buildWalkways() {
    const pts = (list) => list.map(([x, z, w]) => ({ x, y: FL, z, w }));
    this.stripOut = stripMaterial(0xffd7b0, 1.35);
    this.stripBridge = stripMaterial(0xffd7b0, 1.35);
    this.stripIn = stripMaterial(0xffd7b0, 1.35);
    this.stripSpur = stripMaterial(0xffd7b0, 1.35);
    this.walkOut = buildWalkway(pts(OUT), { capStart: true, capEnd: 'separate', strip: this.stripOut });
    this.scene.add(this.walkOut);
    // il ponte è costruito a partire dal pianerottolo: allungandone la scala in z si "distende" verso la corona
    const [bx0, bz0] = BRIDGE[0];
    this.walkBridge = buildWalkway(BRIDGE.map(([x, z, w]) => ({ x: x - bx0, y: FL, z: z - bz0, w })), { strip: this.stripBridge });
    this.walkBridge.position.set(bx0, 0, bz0);
    this.scene.add(this.walkBridge);
    const inPts = pts(IN);
    let s = 0;
    const inS = inPts.map((p, i) => (i ? (s += Math.hypot(p.x - inPts[i - 1].x, p.z - inPts[i - 1].z)) : 0));
    this.junctionS = inS[JUNCTION];
    this.walkIn = buildWalkway(inPts, { gaps: { left: [[this.junctionS - 2.1, this.junctionS + 2.1]] }, strip: this.stripIn });
    this.scene.add(this.walkIn);
    this.walkSpur = buildWalkway(pts(SPUR), { capEnd: true, strip: this.stripSpur });
    this.scene.add(this.walkSpur);
    this.revealEnd = this.walkIn.userData.length + 4;
    this.reveal = -10;
    this.revealTarget = -10;
    this.bridgeK = 0;
    this.stripOut.uniforms.uReveal.value = 1e6;
  }

  async buildHub() {
    const cfg = this.app.config.assets || {};
    // piattaforma in zaffiro sopra il bilanciere e ascensore
    this.hubPlatform = buildHubPlatform({ x: H.x, z: H.z, y: FU, rOuter: 20, rGlass: 15.6, hole: { x: LIFT.x, z: LIFT.z, r: LIFT.r + 0.1 } });
    this.scene.add(this.hubPlatform);
    this.liftGroup = buildLift({ r: LIFT.r });
    this.liftGroup.position.set(LIFT.x, FL, LIFT.z);
    this.scene.add(this.liftGroup);
    this.liftBeam = lightShaft({ length: FU - FL + 1.5, radiusTop: LIFT.r * 0.8, radiusBottom: LIFT.r * 0.95, color: 0xffe2c0, intensity: 0 });
    this.liftBeam.rotation.x = Math.PI; // il fascio sale dal disco
    this.liftBeam.position.set(LIFT.x, FL + 0.05, LIFT.z);
    this.scene.add(this.liftBeam);

    const [dc, ds, dv] = await Promise.all(['dial.celeste', 'dial.sunset', 'dial.virentia'].map((k) => (cfg[k] ? loadTexture(cfg[k], { anisotropy: 4 }) : null)));
    const defs = [
      { id: 'celeste', name: 'CELESTE', ref: 'REF. M-001', colorA: 0x2c5fd6, colorB: 0xbfdcff, map: dc, angle: 0 },
      { id: 'sunset', name: 'SUNSET', ref: 'REF. M-002', colorA: 0xb8341a, colorB: 0xffb27a, map: ds, angle: 120 },
      { id: 'virentia', name: 'VIRENTIA', ref: 'REF. M-003', colorA: 0x2f6b34, colorB: 0xf0b49a, map: dv, angle: 240 },
    ];
    this.portals = defs.map((d) => {
      const p = new Portal(d);
      const a = (d.angle * Math.PI) / 180;
      p.group.position.set(H.x + Math.cos(a) * 14.5, FU + 4.9, H.z - Math.sin(a) * 14.5);
      this.scene.add(p.group);
      return p;
    });
    // luce dell'epilogo: colonna che sale dal bilanciere, attraverso lo zaffiro
    this.epiShaft = lightShaft({ length: 40, radiusTop: 2.2, radiusBottom: 2.6, color: 0xfff1dc, intensity: 0 });
    this.epiShaft.rotation.x = Math.PI;
    this.epiShaft.position.set(H.x, 15.8, H.z);
    this.scene.add(this.epiShaft);
    this.epiGlow = glowSprite(0xfff0d8, 10, 0);
    this.epiGlow.position.set(H.x, H.y, H.z);
    this.scene.add(this.epiGlow);
    this.epiReveal = 0;
  }

  // le tre Delta come monoliti nel vuoto dietro la partenza, girate verso chi arriva, con un faro
  // proprio (il vuoto è buio); non fanno ombra: attorno non c'è niente che la riceva
  async buildMonoliths() {
    const cfg = this.app.config.assets || {};
    const envMap = createEnvironment(this.app.renderer.renderer, 'studio');
    const S = MONOLITHS.scale;
    this.monoliths = await Promise.all(
      MONOLITHS.list.map(async (d) => {
        const { group, watch } = await createMonolith(d.id, cfg[`model.${d.id}`] || `assets/models/${d.id}.glb`, { scale: S, envMap, envIntensity: 0.55 });
        group.position.set(d.x, MONOLITHS.y, d.z);
        group.lookAt(START.x, MONOLITHS.y, START.z);
        group.traverse((o) => (o.userData.noCastShadow = true));
        this.scene.add(group);
        return watch;
      }),
    );
    const spot = new THREE.SpotLight(0xfff0e0, 16000, 0, 0.8, 0.5, 2);
    spot.position.set(0, 88, START.z + 2); // alto: il riflesso sul vetro finisce fuori dal quadrante
    spot.target.position.set(0, MONOLITHS.y, 208);
    this.scene.add(spot, spot.target);
  }

  // dove si cammina: le misure delle regioni sono quelle utili per il centro del corpo
  buildWalkArea() {
    const walk = new WalkArea({ stepTolerance: 1.6 });
    const body = this.bodyRadius;
    const ww = (w) => w - 0.12 - body;
    const toPts = (list) => list.map(([x, z, w]) => [x, FL, z, ww(w)]);
    // alle ringhiere di testa (partenza, bordo del pianerottolo, fine del balcone) ci si ferma prima
    this.regionOutside = walk.corridor(insetEnds(toPts(OUT), { start: true, end: true, margin: 0.65 }), { name: 'fuori' });
    this.regionBridge = walk.corridor([[0, FL, 99.5, ww(W)], [0, FL, BRIDGE[1][1], ww(W)]], { name: 'ponte' });
    this.regionInside = walk.corridor(toPts(IN), { name: 'dentro' });
    this.regionSpur = walk.corridor(insetEnds(toPts(SPUR), { end: true, margin: 0.65 }), { name: 'bariletto' });
    walk.disc(LIFT.x, LIFT.z, LIFT.r, () => this.lift.y, { name: 'ascensore' });
    walk.disc(H.x, H.z, 20 - 0.25 - body, FU, { holes: [{ x: LIFT.x, z: LIFT.z, r: LIFT.r - 0.15 }], name: 'piattaforma' });
    // rocchetto del bariletto (sporge sopra la passerella del balcone) e pilastro vicino
    walk.circle(L.B.x, L.B.y, this.ratchetR + 0.3, FL - 0.5, FL + 3);
    walk.circle(10, 6, 1.7);
    // pozzo dell'ascensore al piano della passerella, quando il disco è salito
    this.shaftBlock = walk.circle(LIFT.x, LIFT.z, LIFT.r - 0.2, -Infinity, FL + 0.8);
    this.shaftBlock.enabled = false;
    this.walk = walk;
  }

  buildHotspots() {
    const cards = this.app.config.cards || {};
    const key = (k) => `movement.stations.${k}`;
    const mk = (id, position, radius, focusRadius, targets, extra = {}) => ({
      id,
      textKey: key(id),
      image: cards[key(id)] || '',
      kickerKey: 'movement.kicker',
      kickerVars: { n: STATION_ORDER.indexOf(id) + 1, total: STATION_ORDER.length },
      position,
      radius,
      focusRadius,
      targets,
      ...extra,
    });
    const eye = (x, z) => V(x, FL + EYE, z);
    const crown = mk('crown', eye(0, 100.5), 30, 6.5, [this.crown], {
      manualVisit: true, // la tappa si completa caricando la corona
      onAction: () => this.windPress(),
      onFocus: () => {
        if (this.wound || this.attract) return;
        this.app.narrator.say('movement.narration.windPrompt', { once: true, priority: true, delay: 0.4 });
        // lo sguardo scende dolcemente sul centro della corona: si vede tutta, con la minuteria
        if (!this.lookedAtCrown) {
          this.lookedAtCrown = true;
          this.app.player.guideLook(V(0, L.stemY + 0.5, this.crownFaceZ), 2.2, 2.2);
        }
      },
    });
    // l'invito "tieni premuto" sparisce quando la corona è carica
    Object.defineProperty(crown, 'actionKey', { get: () => (this.wound ? null : 'movement.stations.crown.action'), enumerable: true });
    const [bx, bz] = ringAt(90);
    const [rx, rz] = ringAt(128);
    this.hotspots = [
      crown,
      mk('rotor', eye(4.5, 40), 22, 9, [this.rotor]),
      mk('barrel', eye(-4.6, 8.1), 18, 6, [this.barrel.group, this.crownWheel], { actionKey: 'movement.stations.barrel.action', onAction: () => this.startWind() }),
      mk('train', eye(9.2, -17), 22, 8.5, [this.arbors.center, this.arbors.third, this.arbors.fourth], { actionKey: 'movement.stations.train.action', onAction: () => this.startTimeAction('fast') }),
      mk('escapement', eye(8, -41.5), 16, 7.5, [this.escGroup, this.forkGroup], { actionKey: 'movement.stations.escapement.action', onAction: () => this.startTimeAction('slow') }),
      mk('balance', eye(bx, bz), 22, 8.5, [this.balance, this.hairspring.mesh]),
      mk('rubies', eye(rx, rz), 16, 7, [], { actionKey: 'movement.stations.rubies.action', onAction: () => this.startJewels() }),
      mk('finishing', V(-3, FU + EYE, -57.5), 18, 8.5, [this.cock, this.cockScrews], { actionKey: 'movement.stations.finishing.action', onAction: () => this.startSweep() }),
    ];
    this.stationById = Object.fromEntries(this.hotspots.map((h) => [h.id, h]));
    // patch di evidenziazione applicate subito, così vengono precompilate con il mondo
    this.hotspots.forEach((h) => (h.uniforms = highlightTargets(h.targets)));
  }

  // ------------------------------------------------------------------ ciclo di vita

  resetProgress() {
    this.hubMode = false;
    this.flags.clear();
    this.setWound(false);
    for (const h of this.hotspots) {
      h.visited = false;
      h.actionDone = false;
    }
    this.portals?.forEach((p) => {
      p.visited = false;
      p.show(false);
      p.reveal = 0;
      p.group.visible = false;
    });
    this.setLift(FL);
    this.epiReveal = 0;
  }

  // Stato della carica: senza, l'orologio è fermo (nessun tic), il ponte verso la corona non c'è,
  // le luci della passerella si fermano al pianerottolo
  setWound(on, { keepCrown = false } = {}) {
    this.wound = on;
    this.crownWind = on ? 1 : 0;
    this.windBoost = 0;
    this.windClicks = on ? 32 : 0;
    this.crownFocusT = 0;
    this.lookedAtCrown = false;
    this.regionBridge.enabled = on;
    this.regionInside.enabled = on;
    this.crownOpen = on && !keepCrown;
    this.crownDis = this.crownOpen ? 1 : 0;
    this.windRing.material.uniforms.uOpacity.value = on ? 0 : 1;
    this.windRing.material.uniforms.uProgress.value = on ? 1 : 0;
    this.windRing.visible = !on;
    this.bridgeK = on ? 1 : 0;
    this.walkBridge.scale.z = on ? 1 : 0.001;
    this.walkBridge.visible = on;
    this.walkOut.userData.endCap.visible = !on;
    this.stripBridge.uniforms.uReveal.value = on ? 1e6 : -10;
    this.reveal = this.revealTarget = on ? this.revealEnd : -10;
    this.wind = on ? 0.55 : 0.08;
    this.updateSpring();
    this.tickEnabled = on;
  }

  setLift(y) {
    const l = this.lift;
    l.y = l.from = l.to = y;
    l.k = 1;
    l.onT = 0;
    l.callT = 0;
    this.liftGroup.position.y = y;
    this.shaftBlock.enabled = y > FL + 1.2;
  }

  enter(opts = {}) {
    super.enter(opts);
    this.attract = !!opts.attract;
    this.timeAction = null;
    this.introTurn = 0;
    const director = this.app.director;
    this.portals.forEach((p) => (p.visited = director.progress.visited.has(p.id)));
    if (opts.hub) {
      this.hubMode = true;
      this.setWound(true);
      this.setLift(FU);
      this.hotspots.forEach((h) => (h.visited = true));
      this.portals.forEach((p) => {
        p.show(true);
        p.reveal = 1;
        p.group.visible = true;
      });
      const next = this.portals.find((p) => !p.visited);
      const look = next ? next.group.position : V(H.x, FU, H.z);
      const from = opts.from ? this.portals.find((p) => p.id === opts.from) : null;
      const pos = from ? from.group.position.clone().lerp(H, 0.5) : H.clone().add(V(0, 0, 6));
      pos.y = FU + EYE;
      const d = look.clone().sub(pos);
      this.spawn = { position: pos, yaw: Math.atan2(-d.x, -d.z), pitch: -0.1 };
      this.wisp.reset(pos);
      if (!this.attract) {
        if (director.allWorldsVisited) this.app.narrator.say('movement.narration.hubAll', { delay: 1.2 });
        else this.app.narrator.say('movement.narration.hubReturn', { delay: 1.2 });
      }
    } else if (this.attract) {
      // nel loop di attrazione il calibro gira, la corona resta intera
      this.setWound(true, { keepCrown: true });
      this.setLift(FL);
      this.spawn = { position: V(0, FL + EYE, 119), yaw: 0, pitch: -0.03 };
    } else {
      if (!this.wound) {
        this.setWound(false);
        // orologio fermo: il bilanciere attende la carica
        this.app.clock.setScale(0.005, 60);
      }
      // si comincia guardando le tre Delta giganti nel vuoto; dopo la prima frase lo sguardo va alla corona
      this.spawn = { position: START.clone(), yaw: Math.PI, pitch: 0.12 };
      this.introTurn = 6.5;
      this.wisp.reset(V(0, FL + EYE + 1, 110));
      this.app.narrator.say('movement.narration.intro1', { delay: 1.4 });
      this.app.narrator.say('movement.narration.intro2');
    }
    this.tickEnabled = this.wound;
    this.wisp.pathLength = 0;
  }

  exit() {
    super.exit();
    this.app.clock.setScale(1, 4);
    this.app.renderer.postOverride = null;
  }

  progressState() {
    if (this.hubMode) {
      const v = this.app.director.progress.visited;
      const ids = ['celeste', 'sunset', 'virentia'];
      return { partKey: 'progress.hub.part', nameKey: 'progress.hub.name', total: 3, done: ids.map((id, i) => (v.has(id) ? i : -1)).filter((i) => i >= 0), current: ids.findIndex((id) => !v.has(id)) };
    }
    const done = this.hotspots.map((h, i) => (h.visited ? i : -1)).filter((i) => i >= 0);
    return { partKey: 'progress.movement.part', nameKey: 'progress.movement.name', total: STATION_ORDER.length, done, current: this.hotspots.findIndex((h) => !h.visited) };
  }

  onHotspotVisited(h) {
    const n = this.app.narrator;
    const next = {
      rotor: 'toBarrel',
      barrel: 'toTrain',
      train: 'toEscapement',
      escapement: 'toBalance',
      balance: 'toRubies',
      rubies: 'toFinish',
    }[h.id];
    if (next) n.say(`movement.narration.${next}`, { once: true, delay: 1.5 });
    if (h.id === 'finishing') this.split();
    this.app.ui.setProgress(this.progressState());
  }

  split() {
    if (this.hubMode) return;
    this.hubMode = true;
    this.portals.forEach((p, i) => setTimeout(() => p.show(true), 600 + i * 700));
    this.app.narrator.say('movement.narration.split', { delay: 2.5, once: true });
    this.app.audio.swell([146.83, 220, 329.63, 440], { gain: 0.035, dur: 7 });
    setTimeout(() => this.app.ui.setProgress(this.progressState()), 3000);
  }

  // ------------------------------------------------------------------ la corona: caricarla per cominciare

  windPress() {
    if (this.wound || this.attract) return;
    this.windBoost += 0.07;
  }

  updateCrown(dt) {
    const app = this.app;
    const h = this.stationById.crown;
    const u = this.windRing.material.uniforms;
    u.uTime.value += dt;
    if (!this.wound && !this.attract) {
      const focused = app.hotspots.focused === h;
      const playing = app.director.state === 'play';
      let d = this.windBoost;
      this.windBoost = 0;
      // tieni premuto (Spazio, mouse, A): circa 3,5 secondi per la carica completa
      if (focused && playing && app.input.actionHeld) d += dt / 3.5;
      this.crownFocusT = focused ? this.crownFocusT + dt : 0;
      // in fiera nessuno deve restare bloccato: dopo un lungo indugio la corona si carica da sola
      if (focused && playing && this.crownFocusT > 30) d += dt / 8;
      if (d > 0) {
        d = Math.min(d, 1 - this.crownWind);
        this.crownWind += d;
        // la corona gira in senso orario vista da fuori; la carica arriva fino al rocchetto
        this.crown.rotation.z -= d * TAU * 2;
        this.stem.rotation.z -= d * TAU * 2;
        const prev = this.wind;
        this.wind = THREE.MathUtils.lerp(0.08, 0.62, this.crownWind);
        const dW = this.wind - prev;
        this.barrelArborAngle = (this.barrelArborAngle || 0) - dW * 26;
        this.crownWheel.rotation.y += dW * 26 * (this.ratchetR / 5.85);
        this.updateSpring();
        const clicks = Math.floor(this.crownWind * 32);
        if (clicks > this.windClicks) {
          this.windClicks = clicks;
          app.audio.ratchet(0.2 + this.crownWind * 0.12);
        }
        if (this.crownWind >= 1 - 1e-6) this.completeWinding();
      }
    }
    // la minuteria segue la carica; dopo, lampo e dissolvenza
    u.uProgress.value += (this.crownWind - u.uProgress.value) * (1 - Math.exp(-dt * 14));
    if (this.wound) {
      u.uFlash.value = Math.max(0, u.uFlash.value - dt * 0.8);
      u.uOpacity.value = Math.max(0, u.uOpacity.value - dt * 0.45);
      this.windRing.visible = u.uOpacity.value > 0.002;
    }
    // il ponte si distende sul vuoto fino alla corona; arrivato, si può entrare
    if (this.wound && this.bridgeK < 1) {
      this.bridgeK = Math.min(1, this.bridgeK + dt / 1.6);
      this.walkBridge.visible = true;
      this.walkBridge.scale.z = Math.max(0.001, smoother(this.bridgeK));
      if (this.bridgeK >= 1) {
        this.regionBridge.enabled = true;
        this.regionInside.enabled = true;
        this.revealTarget = this.revealEnd;
        this.stripBridge.uniforms.uReveal.value = 1e6;
      }
    }
    // dissolvenza della corona: una volta carica, la si attraversa
    const want = this.crownOpen ? 1 : 0;
    this.crownDis += (want - this.crownDis) * (1 - Math.exp(-dt * 1.4));
    this.crown.userData.uniforms.forEach((un) => (un.uDissolve.value = this.crownDis));
    this.crown.visible = this.crownDis < 0.995;
  }

  completeWinding() {
    const app = this.app;
    const h = this.stationById.crown;
    this.wound = true;
    this.crownOpen = true;
    this.crownWind = 1;
    this.tickEnabled = true;
    this.bridgeK = 0; // il ponte comincia a distendersi (updateCrown)
    this.walkOut.userData.endCap.visible = false;
    this.windRing.material.uniforms.uFlash.value = 1;
    // il bilanciere riparte: il tempo meccanico accelera fino alla velocità reale (e il tic con lui)
    app.audio.setTickEnabled(true);
    app.clock.setScale(1, 0.75);
    app.audio.chime('complete');
    app.audio.swell([146.83, 220, 293.66, 440], { gain: 0.03, dur: 6 });
    app.narrator.clear();
    app.narrator.say('movement.narration.wound', { priority: true, delay: 0.4 });
    h.actionDone = true;
    app.hotspots.markVisited(h);
    if (app.hotspots.focused === h) app.ui.fillCard(h);
  }

  // ------------------------------------------------------------------ l'ascensore

  updateLift(dt) {
    const l = this.lift;
    const app = this.app;
    const player = app.player;
    if (l.k < 1) {
      l.k = Math.min(1, l.k + dt / 5.2);
      l.y = THREE.MathUtils.lerp(l.from, l.to, smoother(l.k));
      if (l.k >= 1) l.y = l.to;
    } else if (app.director.state === 'play' && !this.attract && this.wound) {
      const dh = Math.hypot(player.position.x - LIFT.x, player.position.z - LIFT.z);
      const on = dh < LIFT.r - 0.35 && Math.abs(player.feetY - l.y) < 0.9;
      l.onT = on ? l.onT + dt : 0;
      const other = l.y > (FL + FU) / 2 ? FL : FU;
      // chi aspetta accanto al pozzo, all'altro piano, richiama il disco
      const calling = !on && dh < LIFT.r + 3 && Math.abs(player.feetY - other) < 0.9;
      l.callT = calling ? l.callT + dt : 0;
      if (l.onT > 0.9 || l.callT > 1.0) {
        // sopra il disco: lo porta all'altro piano; dall'altro piano: lo richiama
        l.from = l.y;
        l.to = other;
        l.k = 0;
        l.onT = 0;
        l.callT = 0;
        app.audio.whoosh(4.5, 0.05);
        app.audio.swell(l.to > l.from ? [220, 277.18, 329.63] : [329.63, 277.18, 220], { gain: 0.018, dur: 5.5 });
      }
    }
    this.liftGroup.position.y = l.y;
    this.shaftBlock.enabled = l.y > FL + 1.2;
    // invito: il fascio di luce sopra il disco quando aspetta al piano della passerella
    const atBottom = l.k >= 1 && l.y < FL + 0.1;
    const want = atBottom && this.wound ? 0.07 : 0;
    const u = this.liftBeam.material.uniforms.uIntensity;
    u.value += (want - u.value) * (1 - Math.exp(-dt * 2));
    this.liftBeam.visible = u.value > 0.002;
    this.liftGroup.userData.glowMat.opacity = 0.25 + 0.25 * (0.5 + 0.5 * Math.sin(this.time * 1.4)) + (l.k < 1 ? 0.3 : 0);
  }

  // ------------------------------------------------------------------ azioni delle tappe

  startWind() {
    if (this.windAnim) return;
    this.windAnim = { t: 0, from: this.wind, to: Math.min(0.97, this.wind + 0.4), dur: 6.5, clickT: 0 };
    this.app.narrator.say('movement.narration.wind', { priority: true });
  }

  startTimeAction(kind) {
    if (this.timeAction) return;
    if (kind === 'fast') {
      this.app.clock.setScale(60, 0.9);
      this.timeAction = { kind, t: 0, dur: 9 };
      this.app.narrator.say('movement.narration.timelapse', { priority: true });
      this.app.audio.whoosh(2.5, 0.08);
    } else {
      this.app.clock.setScale(0.05, 1.4);
      this.timeAction = { kind, t: 0, dur: 16 };
      this.app.narrator.say('movement.narration.slowmo', { priority: true });
    }
  }

  startJewels() {
    if (this.jewelAnim) return;
    this.jewelAnim = { t: 0, lit: 0 };
    this.app.narrator.say('movement.narration.jewels', { priority: true, delay: 3.2 });
  }

  startSweep() {
    if (this.sweep) return;
    this.sweep = { t: 0, dur: 6 };
    this.app.narrator.say('movement.narration.sweep', { priority: true, delay: 1 });
  }

  // ------------------------------------------------------------------ aggiornamento

  updateSpring() {
    const w = this.wind;
    const a0 = THREE.MathUtils.lerp(9.2, 3.2, w);
    const a1 = THREE.MathUtils.lerp(15.1, 9.6, w);
    const b = a1 - a0;
    const Lspring = 2 * Math.PI * 15 * 6.4;
    const base = this.barrelArborAngle || 0;
    this.barrel.spring.update((u) => {
      const r = a0 + b * u;
      const ang = (Lspring / b) * Math.log(r / a0);
      return { r, a: base - ang };
    });
  }

  updateMechanism() {
    const clock = this.app.clock;
    const legibility = 1 + 2.4 * THREE.MathUtils.clamp((1 - clock.scale) / 0.95, 0, 1);
    const st = caliberState(clock.time, legibility, this.state);
    const off = this.offsets;
    // tutti i versi visti dal lato fondello (dall'alto): centrale e quarta antiorarie
    this.barrel.drum.rotation.y = -st.barrel + off.barrel;
    this.arbors.center.rotation.y = -st.center + off.center;
    this.arbors.third.rotation.y = -st.third + off.third;
    this.arbors.fourth.rotation.y = -st.fourth + off.fourth;
    this.escGroup.rotation.y = -st.escape + off.escape;
    this.escGroup.children[0].rotation.y = this.escPhase - off.escape;
    this.forkGroup.rotation.y = Math.PI / 2 + st.fork;
    this.balance.rotation.y = st.theta;
    const theta = st.theta;
    const turns = 10;
    this.hairspring.update((u) => ({ r: 1.0 + 5.2 * u, a: TAU * turns * u + theta * (1 - u) * 0.85 }));
  }

  update(dt, t) {
    super.update(dt);
    const app = this.app;
    const cam = app.camera;
    const player = app.player.position;
    const clock = app.clock;

    // monoliti sull'ora vera; alla partenza, dopo la prima frase, lo sguardo si volge alla corona
    this.monoliths.forEach((m) => m.setTime());
    if (this.introTurn > 0 && app.director.state === 'play') {
      this.introTurn -= dt;
      if (this.introTurn <= 0) app.player.guideLook(V(0, L.stemY + 0.5, this.crownFaceZ), 3, 1.6);
    }

    // azioni sul tempo
    if (this.timeAction) {
      this.timeAction.t += dt;
      if (this.timeAction.t > this.timeAction.dur) {
        clock.setScale(1, this.timeAction.kind === 'fast' ? 0.8 : 1.2);
        this.timeAction = null;
      }
    }

    this.updateMechanism(dt);
    this.updateCrown(dt);
    this.updateLift(dt);

    // carica della molla (bariletto)
    if (this.windAnim) {
      const w = this.windAnim;
      w.t += dt;
      const k = Math.min(1, w.t / w.dur);
      const e = 1 - Math.pow(1 - k, 2);
      const prev = this.wind;
      this.wind = THREE.MathUtils.lerp(w.from, w.to, e);
      const dW = this.wind - prev;
      this.barrelArborAngle = (this.barrelArborAngle || 0) - dW * 26;
      this.crownWheel.rotation.y += dW * 26 * (this.ratchetR / 5.85);
      this.stem.rotation.z += dW * 30;
      this.crown.rotation.z += dW * 30;
      w.clickT += dt;
      if (w.clickT > 0.16 && k < 1) {
        w.clickT = 0;
        app.audio.ratchet(0.28);
      }
      this.updateSpring();
      if (k >= 1) this.windAnim = null;
    }
    this.barrel.arbor.rotation.y = this.barrelArborAngle || 0;

    // rotore: oscilla come sotto un polso che si muove; vicino alla tappa "cade" verso il giocatore
    const toward = Math.atan2(-(player.z - L.C.y), player.x - L.C.x) - Math.PI / 2;
    const nearRotor = player.distanceTo(this.stationById.rotor.position) < 30 ? 1 : 0;
    const wander = Math.sin(t * 0.21) * 1.2 + Math.sin(t * 0.083 + 1.3) * 1.6 + t * 0.05;
    const target = nearRotor ? toward : wander;
    const diff = Math.atan2(Math.sin(target - this.rotorAngle), Math.cos(target - this.rotorAngle));
    this.rotorVel += diff * dt * 0.9 - this.rotorVel * dt * 1.1;
    this.rotorAngle += this.rotorVel * dt;
    this.rotor.rotation.y = this.rotorAngle;

    // dentro / fuori dalla cassa
    const outside = THREE.MathUtils.smoothstep(player.z, this.tubeZ[0] - 2, this.tubeZ[1] + 6);
    this.scene.fog.color.copy(this.fogInside).lerp(this.fogOutside, outside);
    this.scene.fog.density = THREE.MathUtils.lerp(0.0105, 0.0075, outside);
    this.scene.environmentIntensity = THREE.MathUtils.lerp(1.0, 0.55, outside);
    this.key.intensity = THREE.MathUtils.lerp(1.6, 0.35, outside);
    this.crownLight.intensity = THREE.MathUtils.lerp(80, 600, outside);
    if (!this.attract && !this.hubMode && this.wound) {
      if (player.z < this.crownFaceZ - 1) app.narrator.say('movement.narration.stem', { once: true });
      if (player.z < this.tubeZ[0] - 4) app.narrator.say('movement.narration.inside', { once: true, delay: 0.5 });
    }

    // filetti di luce: fuori sempre accesi; dopo la carica corrono dentro il movimento
    if (this.reveal < this.revealTarget) this.reveal = Math.min(this.revealTarget, this.reveal + dt * 34);
    this.stripIn.uniforms.uReveal.value = this.reveal;
    this.stripSpur.uniforms.uReveal.value = this.reveal - this.junctionS;
    for (const m of [this.stripOut, this.stripBridge, this.stripIn, this.stripSpur]) m.uniforms.uTime.value = t;

    // presenza del tick: cresce avvicinandosi al bilanciere
    const dS = Math.hypot(player.x - L.S.x, player.y - 3, player.z - L.S.y);
    const presence = THREE.MathUtils.clamp(1.12 - dS / 95, 0.1, 1) * (outside > 0.5 ? 0.6 : 1);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const toS = new THREE.Vector3(L.S.x - player.x, 0, L.S.y - player.z).normalize();
    app.audio.setTickPresence(this.attract ? 0.4 : presence, right.dot(toS) * 0.6 * (1 - Math.min(1, 12 / Math.max(dS, 1)) * 0.5));

    // il cuore: luce e bloom crescono avvicinandosi (respiro lento, nessun lampeggio)
    const heart = THREE.MathUtils.clamp(1 - dS / 45, 0, 1);
    const breathe = 0.5 + 0.5 * Math.sin(t * 1.1);
    this.heartLight.intensity = 220 + heart * (380 + breathe * 110);
    app.renderer.postOverride = heart > 0.05 ? { bloom: 0.85 + heart * 0.3, exposure: 1.05 + heart * 0.08 } : null;

    // rubini: accensione in sequenza
    this.updateJewels(dt, t);
    // passata di luce sulla finitura
    if (this.sweep) {
      const sw = this.sweep;
      sw.t += dt;
      const k = sw.t / sw.dur;
      const env = Math.sin(Math.min(1, k) * Math.PI);
      const x = THREE.MathUtils.lerp(-22, 18, k);
      this.sweepLight.position.set(L.S.x + x, 34, L.S.y + 6 - k * 10);
      this.sweepLight.target.position.set(L.S.x + x * 0.6, 14, L.S.y - 3);
      this.sweepLight.intensity = env * 9000;
      if (k >= 1) {
        this.sweep = null;
        this.sweepLight.intensity = 0;
      }
    }

    // hub: portali ed epilogo
    this.portals.forEach((p) => p.update(dt, cam));
    if (this.hubMode && !this.attract && this.app.director.state === 'play') {
      for (const p of this.portals) {
        if (!p.visited && p.contains(player)) {
          this.app.director.goTo(p.id, {});
          break;
        }
      }
      const all = this.app.director.allWorldsVisited;
      this.epiReveal += ((all ? 1 : 0) - this.epiReveal) * (1 - Math.exp(-dt * 0.8));
      if (all && this.epiReveal > 0.6) {
        const dh = Math.hypot(player.x - H.x, player.z - H.z);
        // la luce al centro del bilanciere porta al laboratorio (poi l'epilogo)
        if (dh < 3.2 && Math.abs(player.y - H.y) < 3) this.app.director.goTo('lab', {});
      }
    }
    this.epiShaft.material.uniforms.uIntensity.value = this.epiReveal * 0.5;
    this.epiGlow.material.opacity = this.epiReveal * (0.55 + 0.15 * Math.sin(t * 1.4));

    // guida
    let target3 = null;
    if (this.hubMode) {
      const next = this.portals.find((p) => !p.visited);
      if (this.app.director.allWorldsVisited) target3 = H.clone();
      else if (next) target3 = next.group.position.clone().setY(H.y);
    } else {
      const next = this.hotspots.find((h) => !h.visited);
      target3 = next ? next.position : H;
    }
    this.wisp.setTarget(this.attract ? null : target3);
    this.wisp.update(dt, player, { hide: !!app.hotspots.focused || this.app.director.state !== 'play' || this.lift.k < 1 });

    this.shafts.forEach((sh) => (sh.material.uniforms.uTime.value = t));
    this.liftBeam.material.uniforms.uTime.value = t;
    this.epiShaft.material.uniforms.uTime.value = t;
    this.dust.update(dt, cam);
  }

  updateJewels(dt, t) {
    const attr = this.jewels.userData.glow;
    const base = 0.18 + 0.06 * Math.sin(t * 0.9);
    const st = this.stationById.rubies;
    const near = st && this.app.hotspots.focused === st ? 0.45 : 0;
    let lit = 0;
    if (this.jewelAnim) {
      this.jewelAnim.t += dt;
      lit = Math.floor(this.jewelAnim.t / 0.17);
      if (lit > this.jewelAnim.lit && lit <= 26) {
        this.jewelAnim.lit = lit;
        const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
        this.app.audio.ping(scale[(lit - 1) % scale.length] * (lit > 18 ? 2 : 1), { gain: 0.016, decay: 1.6 });
      }
      if (this.jewelAnim.t > 26 * 0.17 + 7) this.jewelAnim = null;
    }
    const allOn = this.jewelAnim ? 1 : 0;
    this.jewelMap.forEach((discs, i) => {
      const on = this.jewelAnim && i < (this.jewelAnim.lit || 0) ? 1.6 : 0;
      discs.forEach((idx) => attr.setX(idx, base + near + on));
    });
    attr.needsUpdate = true;
    // palette e ellisse: rubini 24–26 della sequenza
    const partsOn = this.jewelAnim && this.jewelAnim.lit >= 24 ? 1 : 0;
    this.escMats.ruby.emissiveIntensity = 1.1 + partsOn * 2.5 * allOn + near * 2;
  }
}
