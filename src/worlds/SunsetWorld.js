import * as THREE from 'three';
import { World } from './World.js';
import { WalkArea } from '../core/WalkArea.js';
import { createEnvironment } from '../gfx/env.js';
import { Mat, highlightTargets } from '../gfx/materials.js';
import { DustField } from '../gfx/particles.js';
import { glowSprite, lightShaft, loadTexture, mulberry32 } from '../gfx/effects.js';
import { GradientSky } from '../gfx/sky.js';
import { agateMaterial } from '../gfx/agate.js';
import { createWatch, createMonolith, agateDialMaterial, setAgateCut } from '../gfx/watchModel.js';
import { SunShadow, enableShadows } from '../gfx/shadows.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GuideWisp } from './common/GuideWisp.js';
import { Portal } from './common/Portal.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// MONDO 2 — SUNSET (Ref. M-002) — il quadrante in agata naturale (unicità).
// Un canyon scavato nelle venature di un'agata: pareti di strati colorati, luce che attraversa la
// pietra, una cattedrale finale con un rosone di agata. Le venature cambiano a ogni visita.
// Si cammina sul fondo del canyon: le pareti, il blocco d'agata e la cattedrale non si attraversano.
const HALL = { x: 0, z: -250, r: 33 };
const CANYON = [
  [0, 60],
  [0, -20],
  [8, -70],
  [-6, -120],
  [6, -160],
  [0, -205],
  [0, -225],
];
const STATIONS = ['agate', 'unique', 'slice', 'hard', 'indices'];
// il "wow": quattro Sunset attorno al monolite, due per lato (alto e basso), girati verso chi guarda
// (scala in unità per mm; x, y = posizioni delle due colonne e delle due file)
const WOW = { scale: 0.23, x: 29, rows: [33, 14], z: -265, center: [0, 24, -266] };
// il monolite nell'abside: centro della cassa, unità per mm (alto 69, largo 43)
const MONOLITH = { x: 0, y: 36, z: -277, scale: 1 };
const LIGHT_DIR = new THREE.Vector3(0, 0.3, -1).normalize();

export class SunsetWorld extends World {
  constructor(app) {
    super(app, 'sunset');
    this.audioPalette = 'sunset';
    this.tickTimbre = 'warm';
    this.tickPresence = 0.5;
    this.post = {
      bloom: 0.85,
      bloomThreshold: 0.72,
      exposure: 1.0,
      saturation: 1.06,
      tint: [1.03, 1.0, 0.96],
      vignette: 0.62,
      grain: 0.08,
      ao: { radius: 3, intensity: 2 },
      ssr: { intensity: 1, maxDistance: 160, thickness: 1.5 },
    };
    this.speedScale = 1.2;
    this.seed = 1;
    this.eyeHeight = 3.4;
  }

  async load() {
    const app = this.app;
    const s = this.scene;
    const cfg = app.config.assets || {};
    const [agTex, dialTex] = await Promise.all([loadTexture(cfg['tex.agate'] || 'assets/tex/agate-bands.webp', { repeat: true }), loadTexture(cfg['dial.sunset'] || 'assets/img/dial/sunset.webp')]);
    agTex.wrapS = agTex.wrapT = THREE.MirroredRepeatWrapping;
    this.agTex = agTex;
    this.dialTex = dialTex;

    s.background = new THREE.Color(0x2a120e);
    s.fog = new THREE.FogExp2(0x3a1a16, 0.0052);
    s.environment = createEnvironment(app.renderer.renderer, 'amber');
    s.environmentIntensity = 0.9;

    this.sky = new GradientSky({ top: 0x24103c, mid: 0x7c3355, horizon: 0xf08a4a, bottom: 0x2a0e08, texture: agTex.clone(), texMix: 0.32, sunDir: V(0, 0.1, -1), sunColor: 0xffa860 });
    this.sky.uniforms.uTex.value.needsUpdate = true;
    s.add(this.sky.mesh);

    // luci: il "sole" è in fondo al canyon, la luce attraversa la pietra verso il giocatore
    this.sun = new THREE.DirectionalLight(0xffa864, 2.4);
    this.sun.position.copy(LIGHT_DIR).multiplyScalar(100);
    s.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0xffb38a, 0x2a1020, 0.55);
    s.add(this.hemi);
    this.warm = new THREE.PointLight(0xffb27a, 900, 0, 2);
    this.warm.position.set(0, 30, -200);
    s.add(this.warm);

    // materiali d'agata (il seme cambia a ogni visita)
    this.wallMat = agateMaterial({ texture: agTex, scale: 0.045, glow: 0.42, lightDir: LIGHT_DIR, side: THREE.DoubleSide });
    this.floorMat = agateMaterial({ texture: agTex, scale: 0.03, glow: 0.08, dark: 0.55, roughness: 0.1, clearcoat: 1, lightDir: LIGHT_DIR });
    // riflessi del pavimento: pietra lucidata, non uno specchio
    this.floorMat.userData.ssr = 0.9;
    this.floorMat.userData.ssrRough = 0.07;
    this.stoneMats = [this.wallMat, this.floorMat];

    this.buildCanyon();
    this.buildCathedral();
    this.buildPebbles();
    this.buildSlicer();
    this.buildTweezers();
    await this.buildMonolith();
    await this.buildWowDials();

    // ombre del sole: le proiettano gli oggetti (ciottoli, archi, taglierina, pinzette, orologi);
    // pareti, volta e pavimento le ricevono soltanto, perché la luce attraversa la pietra
    [...this.walls, this.hall, this.floor].forEach((m) => (m.userData.noCastShadow = true));
    enableShadows(s);
    s.userData.shadow = new SunShadow(this.sun, { extent: 55, distance: 260 });

    this.dust = new DustField({ count: 1100, box: [70, 40, 70], color: 0xffc89a, size: 0.8, opacity: 0.45, rise: 0.05 });
    s.add(this.dust.points);
    this.wisp = new GuideWisp(this, { color: 0xffd2a8, size: 1.4 });
    this.exitPortal = new Portal({ id: 'exit', name: 'SW200-2', ref: 'ÉLABORÉ · SWISS MADE', colorA: 0x3a120c, colorB: 0xffc49a, radius: 4.4 });
    s.add(this.exitPortal.group);

    this.buildWalkArea();
    this.buildHotspots();
    this.spawn = { position: V(0, this.eyeHeight, 34), yaw: 0, pitch: 0.05 };
    this.attractShots = [
      { from: [6, 10, 30], to: [-4, 8, -40], lookFrom: [0, 12, -60], lookTo: [8, 14, -120], duration: 10, labelKey: 'attract.sunset' },
      { from: [-10, 14, -190], to: [6, 12, -226], lookFrom: [0, 22, -280], lookTo: [0, 26, -280], duration: 10, labelKey: 'attract.sunset' },
    ];
    this.loaded = true;
  }

  // ------------------------------------------------------------------ canyon

  buildCanyon() {
    const pts = CANYON.map(([x, z]) => V(x, 0, z));
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const rand = mulberry32(21);
    const ph = Array.from({ length: 8 }, () => rand() * 10);
    const noise = (u, y, k) => Math.sin(u * 23 + ph[0] + k) * 0.5 + Math.sin(u * 61 + y * 0.09 + ph[1] + k) * 0.3 + Math.sin(y * 0.21 + u * 9 + ph[2] + k) * 0.35 + Math.sin(u * 140 + y * 0.4 + ph[3]) * 0.12;
    const build = (side) => {
      const US = 220;
      const VS = 30;
      const pos = new Float32Array((US + 1) * (VS + 1) * 3);
      const idx = [];
      const up = V(0, 1, 0);
      for (let i = 0; i <= US; i++) {
        const u = i / US;
        const c = this.curve.getPointAt(u);
        const t = this.curve.getTangentAt(u);
        const r = new THREE.Vector3().crossVectors(t, up).normalize();
        const hw = 13.5 + Math.sin(u * 9 + side) * 2.2 + (u > 0.92 ? (u - 0.92) * 40 : 0);
        const h = 46 + noise(u, 0, side * 3) * 16;
        for (let j = 0; j <= VS; j++) {
          const v = j / VS;
          const y = -6 + v * (h + 6);
          const bulge = noise(u, y, side * 7) * 3.2;
          const lean = -Math.pow(v, 2.2) * (5 + noise(u, 10, side) * 4); // in alto le pareti si chiudono (cattedrale)
          const off = side * (hw + bulge + lean);
          const k = (i * (VS + 1) + j) * 3;
          pos[k] = c.x + r.x * off;
          pos[k + 1] = y;
          pos[k + 2] = c.z + r.z * off;
          if (i < US && j < VS) {
            const a = i * (VS + 1) + j;
            const b = a + VS + 1;
            if (side > 0) idx.push(a, b, a + 1, a + 1, b, b + 1);
            else idx.push(a, a + 1, b, a + 1, b + 1, b);
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, this.wallMat);
      this.scene.add(m);
      return m;
    };
    this.walls = [build(1), build(-1)];

    // spazio libero tra le pareti all'altezza del corpo (stesse formule delle pareti, con margine)
    const offset = (u, side, y) => {
      const hw = 13.5 + Math.sin(u * 9 + side) * 2.2 + (u > 0.92 ? (u - 0.92) * 40 : 0);
      const h = 46 + noise(u, 0, side * 3) * 16;
      const v = (y + 6) / (h + 6);
      return hw + noise(u, y, side * 7) * 3.2 - Math.pow(v, 2.2) * (5 + noise(u, 10, side) * 4);
    };
    const up = V(0, 1, 0);
    this.canyonWalk = [];
    for (let i = 0; i <= 150; i++) {
      // si parte un po' dentro il canyon: dietro, l'imbocco resta aperto e non si raggiunge
      const u = 0.05 + (i / 150) * 0.95;
      const c = this.curve.getPointAt(u);
      const r = new THREE.Vector3().crossVectors(this.curve.getTangentAt(u), up).normalize();
      let right = Infinity;
      let left = Infinity;
      for (const y of [0.2, 1.4, 2.6, 3.9]) {
        right = Math.min(right, offset(u, 1, y));
        left = Math.min(left, offset(u, -1, y));
      }
      const mid = (right - left) / 2;
      let half = (right + left) / 2 - 1.1 - this.bodyRadius;
      // verso la cattedrale si passa dal varco della sua parete
      if (c.z < -205) half = Math.min(half, 9.5);
      this.canyonWalk.push([c.x + r.x * mid, 0, c.z + r.z * mid, half]);
    }

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(260, 420, 1, 1).rotateX(-Math.PI / 2), this.floorMat);
    floor.position.set(0, 0, -100);
    this.scene.add(floor);
    this.floor = floor;
    // archi naturali che attraversano il canyon
    const archGeo = new THREE.TorusGeometry(15, 2.2, 14, 64, Math.PI);
    for (const [z, rot, y] of [[-46, 0.1, 30], [-138, -0.15, 36]]) {
      const c = this.curve.getPointAt(this.curveU(z));
      const arch = new THREE.Mesh(archGeo, this.wallMat);
      arch.position.set(c.x, y, z);
      arch.rotation.set(0, rot, 0);
      this.scene.add(arch);
    }
  }

  curveU(z) {
    // parametro della curva più vicino a una data z (il canyon procede lungo -Z)
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i <= 200; i++) {
      const u = i / 200;
      const d = Math.abs(this.curve.getPointAt(u).z - z);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  buildCathedral() {
    const s = this.scene;
    const gap = 0.62;
    const geo = new THREE.CylinderGeometry(34, 42, 90, 120, 24, true, gap / 2, Math.PI * 2 - gap);
    const pos = geo.attributes.position;
    const rand = mulberry32(8);
    const ph = [rand() * 9, rand() * 9, rand() * 9];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const a = Math.atan2(x, z);
      const k = 1 + (Math.sin(a * 5 + ph[0]) * 0.05 + Math.sin(a * 13 + y * 0.08 + ph[1]) * 0.03 + Math.sin(y * 0.12 + ph[2]) * 0.03);
      const top = (y + 45) / 90;
      const inward = 1 - Math.pow(top, 3) * 0.35; // volta che si chiude
      pos.setXYZ(i, x * k * inward, y, z * k * inward);
    }
    geo.computeVertexNormals();
    const hall = new THREE.Mesh(geo, this.wallMat);
    hall.position.set(0, 39, -250);
    s.add(hall);
    this.hall = hall;
    // alone caldo dietro il monolite: il sole che attraversa l'abside
    const behind = glowSprite(0xffb070, 70, 0.55);
    behind.position.set(0, MONOLITH.y - 4, -292);
    s.add(behind);
    this.roseGlow = behind;
    this.shafts = [];
    for (const [x, rz] of [[-6, 0.18], [0, 0], [7, -0.2]]) {
      const sh = lightShaft({ length: 70, radiusTop: 4, radiusBottom: 16, color: 0xffb47a, intensity: 0.05 });
      sh.position.set(x, 30, -280);
      sh.rotation.set(-1.05, 0, rz);
      s.add(sh);
      this.shafts.push(sh);
    }
  }

  buildPebbles() {
    const rand = mulberry32(13);
    this.pebbles = [];
    for (let i = 0; i < 16; i++) {
      const r = 1.2 + rand() * 2.6;
      const geo = new THREE.SphereGeometry(r, 28, 20);
      const off = V(rand() * 200, rand() * 200, rand() * 200);
      geo.translate(off.x, off.y, off.z);
      const mesh = new THREE.Mesh(geo, this.wallMat);
      mesh.scale.set(1, 0.72, 0.9);
      const u = rand();
      const c = this.curve.getPointAt(u);
      // sospesi sopra la testa di chi cammina
      mesh.userData = { base: V(c.x + (rand() - 0.5) * 16, 9.5 + rand() * 18, c.z + (rand() - 0.5) * 8), off, spin: (rand() - 0.5) * 0.3, bob: rand() * 6 };
      mesh.position.copy(mesh.userData.base).sub(off);
      this.scene.add(mesh);
      this.pebbles.push(mesh);
    }
  }

  // blocco d'agata grezzo e fette che se ne staccano
  buildSlicer() {
    const g = new THREE.Group();
    const geo = new THREE.IcosahedronGeometry(5.6, 4);
    const pos = geo.attributes.position;
    const rand = mulberry32(31);
    const ph = [rand() * 9, rand() * 9, rand() * 9];
    for (let i = 0; i < pos.count; i++) {
      const v = V(pos.getX(i), pos.getY(i), pos.getZ(i));
      const n = 1 + Math.sin(v.x * 0.6 + ph[0]) * 0.06 + Math.sin(v.y * 0.9 + ph[1]) * 0.05 + Math.sin(v.z * 1.3 + v.x * 0.4 + ph[2]) * 0.04;
      v.multiplyScalar(n);
      pos.setXYZ(i, v.x, v.y * 0.86, v.z);
    }
    geo.deleteAttribute('normal');
    geo.deleteAttribute('uv');
    const smooth = mergeVertices(geo);
    smooth.computeVertexNormals();
    this.blockMat = agateMaterial({ texture: this.agTex, scale: 0.09, glow: 0.3, lightDir: LIGHT_DIR, roughness: 0.55, clearcoat: 0.2 });
    this.stoneMats.push(this.blockMat);
    this.block = new THREE.Mesh(smooth, this.blockMat);
    g.add(this.block);
    const fill = new THREE.PointLight(0xffc8a0, 260, 0, 2);
    fill.position.set(12, 10, 10);
    g.add(fill);
    // lama diamantata (disco sottile luminoso)
    this.blade = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 0.08, 64).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.2, emissive: 0xffc890, emissiveIntensity: 0 }));
    this.blade.position.set(0, 11, 0);
    g.add(this.blade);
    this.slices = [];
    g.position.set(-12, 5.5, -117);
    this.slicer = g;
    this.scene.add(g);
  }

  makeSlice(seed) {
    const mat = agateMaterial({ seed, texture: this.agTex, scale: 0.16, glow: 0.9, lightDir: LIGHT_DIR, clearcoat: 1, roughness: 0.12 });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, 0.3, 72).rotateZ(Math.PI / 2), mat);
    return m;
  }

  buildTweezers() {
    const g = new THREE.Group();
    const steel = Mat.steelPolished({ color: 0xdfe2e6, roughness: 0.08 });
    const arm = (sign) => {
      const shape = new THREE.Shape([new THREE.Vector2(0, -0.9), new THREE.Vector2(34, -0.25), new THREE.Vector2(34, 0.25), new THREE.Vector2(0, 0.9)]);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.2, bevelSegments: 1 });
      const m = new THREE.Mesh(geo, steel);
      m.rotation.z = sign * 0.05;
      m.position.z = sign * 0.75;
      return m;
    };
    // pinzette giganti che scendono dal cielo e tengono il disco per il bordo superiore
    const tw = new THREE.Group();
    tw.add(arm(1), arm(-1));
    tw.rotation.set(0, 0, -Math.PI / 2);
    tw.position.set(0, 8.1 + 34, 0);
    g.add(tw);
    // disco sottilissimo, tenuto per il bordo: la luce lo attraversa
    this.thinMat = agateMaterial({ seed: 3.3, texture: this.agTex, scale: 0.14, glow: 1.25, lightDir: LIGHT_DIR, clearcoat: 1, roughness: 0.1 });
    this.stoneMats.push(this.thinMat);
    this.thin = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 0.22, 96).rotateX(Math.PI / 2), this.thinMat);
    g.add(this.thin);
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 20).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x120604 }));
    g.add(hole);
    g.position.set(9, 13.6, -162); // il bordo basso del disco resta sopra la testa
    g.rotation.y = -0.35;
    this.tweezers = g;
    this.scene.add(g);
  }

  // il monolite: il Sunset vero, completo e gigante, nell'abside della cattedrale. L'anello del
  // bracciale rientra nella parete: la testa dell'orologio sembra uscire dalla pietra.
  async buildMonolith() {
    const cfg = this.app.config.assets || {};
    const { group, watch } = await createMonolith('sunset', cfg['model.sunset'] || 'assets/models/sunset.glb', {
      scale: MONOLITH.scale,
      envMap: createEnvironment(this.app.renderer.renderer, 'studio'),
      envIntensity: 0.42,
    });
    group.position.set(MONOLITH.x, MONOLITH.y, MONOLITH.z);
    // l'agata in controluce: il sole è dietro l'abside e la pietra si accende da dentro
    const dial = watch.meshes.quadrante.material;
    dial.emissive = new THREE.Color(0xffffff);
    dial.emissiveMap = dial.map;
    dial.emissiveIntensity = 0.16;
    // non fa ombra: con il sole basso dietro l'abside coprirebbe tutta la navata
    group.traverse((o) => (o.userData.noCastShadow = true));
    this.scene.add(group);
    this.monolith = group;
    this.monolithWatch = watch;
  }

  // il "wow": quattro Sunset veri (il modello 3D) sospesi davanti al monolite. Il primo ha il quadrante
  // reale; negli altri tre restano stampe e minuteria e la stessa agata è vista da un altro taglio,
  // diverso a ogni visita. Hanno materiali propri con la luce d'ambiente dello studio fotografico:
  // quella del canyon è scura e renderebbe quasi nero l'acciaio lucido.
  async buildWowDials() {
    this.wowGroup = new THREE.Group();
    this.wowGroup.visible = false;
    const cfg = this.app.config.assets || {};
    const url = cfg['model.sunset'] || 'assets/models/sunset.glb';
    const S = WOW.scale;
    this.wowEnv = createEnvironment(this.app.renderer.renderer, 'studio');
    this.wowDials = [];
    for (let i = 0; i < 4; i++) {
      const watch = (await createWatch('sunset', url)).ownMaterials({ envMap: this.wowEnv, envIntensity: 0.6 }).setScale(S).upright().setBracelet(false);
      watch.object.position.z = -5 * S;
      const spin = new THREE.Group();
      spin.add(watch.object);
      const group = new THREE.Group();
      group.add(spin);
      let dialMat = null;
      if (i > 0) {
        const dial = watch.meshes.quadrante;
        dialMat = agateDialMaterial(dial.material, 10 + i * 7.7);
        dial.material = dialMat;
      }
      this.wowDials.push({ group, spin, watch, dialMat, real: i === 0 });
      this.wowGroup.add(group);
    }
    this.scene.add(this.wowGroup);
    // faro da vetrina, alto alle spalle di chi guarda: il sole del canyon è dietro ai quadranti.
    // Creato subito (aggiungere luci a runtime ricompila gli shader); dall'alto il suo riflesso sul
    // vetro piatto va verso il basso, lontano dagli occhi.
    this.wowLight = new THREE.SpotLight(0xffe8d6, 0, 0, 0.72, 0.6, 2);
    this.wowLight.position.set(0, 24, -224);
    this.wowLight.target.position.set(...WOW.center);
    this.scene.add(this.wowLight, this.wowLight.target);
    this.wowT = -1;
  }

  buildHotspots() {
    const cards = this.app.config.cards || {};
    const mk = (id, position, radius, focusRadius, targets, extra = {}) => ({
      id,
      textKey: `sunset.stations.${id}`,
      image: cards[`sunset.stations.${id}`] || '',
      kickerKey: 'sunset.kicker',
      kickerVars: { n: STATIONS.indexOf(id) + 1, total: STATIONS.length },
      position,
      radius,
      focusRadius,
      targets,
      ...extra,
    });
    const at = (x, z) => this.walkEye(x, z, 0);
    this.hotspots = [
      mk('agate', at(0, -16), 22, 12, []), // le pareti condividono il materiale: niente evidenziazione
      mk('unique', at(7, -66), 20, 11, []),
      mk('slice', at(-2.5, -111), 20, 10, [this.block], { actionKey: 'sunset.stations.slice.action', onAction: () => this.startSlice() }),
      mk('hard', at(6, -155), 18, 10, [this.tweezers]),
      // la tappa degli indici fa brillare indici e lancette veri del monolite
      mk('indices', at(0, -232), 22, 12, this.monolithWatch.meshList('indici', 'lancetta_ore', 'lancetta_minuti', 'lancetta_secondi'), { actionKey: 'sunset.stations.indices.action', onAction: () => this.startWow(), actionOnce: true }),
    ];
    this.hotspots.forEach((h) => (h.uniforms = highlightTargets(h.targets)));
  }

  // fondo del canyon (corridoio tra le pareti) e pavimento della cattedrale; il blocco d'agata è un ostacolo
  buildWalkArea() {
    const walk = new WalkArea({ stepTolerance: 1.6 });
    walk.corridor(this.canyonWalk, { name: 'canyon' });
    walk.disc(HALL.x, HALL.z, HALL.r, 0, { name: 'cattedrale' });
    walk.circle(this.slicer.position.x, this.slicer.position.z, 6.3, 0, 11.5);
    // il monolite: ci si ferma davanti al bracciale che scende verso il pavimento
    walk.box(MONOLITH.x, MONOLITH.z - 3, 13, 15, 0, -1, 80);
    this.walk = walk;
    const pts = this.canyonWalk.filter((_, i) => i % 6 === 0).map(([x, , z]) => V(x, this.eyeHeight + 0.3, z));
    pts.push(V(HALL.x, this.eyeHeight + 0.3, HALL.z + 12));
    this.setPath(pts, 10, 4);
  }

  // ------------------------------------------------------------------ ciclo di vita

  reseed() {
    // nuova agata a ogni visita: stesso disegno generale, venature mai uguali
    this.seed = Math.random() * 1000;
    this.stoneMats.forEach((m, i) => (m.userData.agate.uAgSeed.value = this.seed + i * 3.17));
    this.wowDials.forEach((w, i) => {
      if (w.dialMat) setAgateCut(w.dialMat, this.seed * 0.37 + i * 5.3);
    });
  }

  resetProgress() {
    this.hotspots.forEach((h) => {
      h.visited = false;
      h.actionDone = false;
    });
  }

  enter(opts = {}) {
    super.enter(opts);
    this.attract = !!opts.attract;
    this.reseed();
    this.slices.forEach((sl) => this.slicer.remove(sl.mesh));
    this.slices = [];
    this.sliceAnim = null;
    this.wowT = -1;
    this.wowGroup.visible = false;
    this.wowLight.intensity = 0;
    this.exitShown = false;
    this.exitPortal.show(false);
    this.exitPortal.reveal = 0;
    this.exitPortal.group.visible = false;
    this.done = false;
    this.wisp.reset(V(0, 7, 20));
    this.wisp.pathLength = 0;
    if (!opts.attract) {
      this.hotspots.forEach((h) => {
        h.visited = false;
        h.actionDone = false;
      });
      this.app.narrator.say('sunset.narration.arrive', { delay: 1.2 });
      this.app.narrator.say('sunset.narration.arrive2');
    }
    this.app.audio.setTickPresence(0.5, 0);
  }

  exit() {
    super.exit();
    this.app.renderer.postOverride = null;
  }

  progressState() {
    const done = this.hotspots.map((h, i) => (h.visited ? i : -1)).filter((i) => i >= 0);
    return { partKey: 'progress.sunset.part', nameKey: 'progress.sunset.name', total: STATIONS.length, done, current: this.hotspots.findIndex((h) => !h.visited) };
  }

  onHotspotVisited(h) {
    if (h.id === 'agate' || h.id === 'unique') this.app.narrator.say('sunset.narration.unique', { once: true, delay: 1.2 });
    if (h.id === 'hard') this.app.narrator.say('sunset.narration.toCathedral', { once: true, delay: 1.2 });
    this.app.ui.setProgress(this.progressState());
  }

  startSlice() {
    if (this.sliceAnim || this.slices.length >= 4) return;
    const seed = this.seed + 100 + this.slices.length * 11.3;
    const mesh = this.makeSlice(seed);
    mesh.position.set(0, 0, 0);
    mesh.scale.setScalar(0.01);
    this.slicer.add(mesh);
    this.sliceAnim = { t: 0, mesh, index: this.slices.length };
    this.app.audio.scratch(1.2, 0.07, 0.6);
  }

  startWow() {
    if (this.wowT >= 0) return;
    this.wowT = 0;
    this.wowGroup.visible = true;
    // ai lati del monolite, come satelliti: due a sinistra e due a destra, girati verso chi guarda
    const p = this.app.player.position;
    this.wowDials.forEach((w, i) => {
      const pos = V((i < 2 ? -1 : 1) * WOW.x, WOW.rows[i % 2], WOW.z);
      w.base = pos;
      w.group.position.copy(pos);
      w.group.lookAt(p.x, p.y + 1.5, p.z);
      w.group.scale.setScalar(0.001);
    });
    this.app.player.guideLook(V(...WOW.center), 2.4, 2);
    this.app.narrator.clear();
    this.app.narrator.say('sunset.narration.wow', { priority: true, delay: 2.5 });
    this.app.narrator.say('sunset.narration.wow2', { delay: 0.5 });
    this.app.audio.swell([207.65, 261.63, 311.13, 415.3], { gain: 0.035, dur: 7 });
    for (let i = 0; i < 4; i++) this.app.audio.fmBell([415.3, 523.25, 622.25, 830.61][i], { gain: 0.04, decay: 5, when: 0.4 + i * 0.6 });
  }

  update(dt, t) {
    super.update(dt);
    const app = this.app;
    const cam = app.camera;
    const player = app.player.position;
    this.sky.update(dt, cam);
    this.dust.update(dt, cam);
    this.shafts.forEach((sh) => (sh.material.uniforms.uTime.value = t));
    this.roseGlow.material.opacity = 0.45 + 0.1 * Math.sin(t * 0.7);
    this.pebbles.forEach((p) => {
      const u = p.userData;
      p.rotation.y += u.spin * dt;
      p.rotation.x += u.spin * 0.6 * dt;
      p.position.copy(u.base).sub(u.off.clone().applyEuler(p.rotation));
      p.position.y += Math.sin(t * 0.5 + u.bob) * 0.6;
    });
    this.thin.rotation.z += dt * 0.05;
    this.monolithWatch.setTime();

    // taglio: la lama scende, la fetta esce e si mette in fila
    if (this.sliceAnim) {
      const a = this.sliceAnim;
      a.t += dt;
      const bladeK = THREE.MathUtils.clamp(a.t / 1.3, 0, 1);
      this.blade.position.set(3.2 + a.index * 0.4, 11 - bladeK * 16, 0);
      this.blade.rotation.x += dt * 22;
      this.blade.material.emissiveIntensity = bladeK > 0 && bladeK < 1 ? 1.5 : 0;
      if (a.t > 1.1) {
        const k = THREE.MathUtils.smoothstep(a.t, 1.1, 4.2);
        a.mesh.scale.setScalar(Math.max(0.01, k));
        a.mesh.position.set(4 + k * (4 + a.index * 1.2), k * (4.5 + a.index * 2.6), k * (5 - a.index * 3.2));
        a.mesh.rotation.y = -k * 1.25;
      }
      if (a.t > 4.3) {
        this.slices.push({ mesh: a.mesh });
        this.sliceAnim = null;
        this.blade.position.set(0, 11, 0);
        this.blade.material.emissiveIntensity = 0;
      }
    }
    this.slices.forEach((sl, i) => (sl.mesh.position.y += Math.sin(t * 0.8 + i) * 0.004));

    // orologi del "wow"
    if (this.wowT >= 0) {
      this.wowT += dt;
      const now = new Date();
      this.wowDials.forEach((w, i) => {
        const k = THREE.MathUtils.smoothstep(this.wowT, 0.4 + i * 0.7, 2.6 + i * 0.7);
        w.group.scale.setScalar(Math.max(0.001, k));
        w.group.position.y = w.base.y + Math.sin(t * 0.6 + i * 1.3) * 0.5;
        w.spin.rotation.y = Math.sin(t * 0.35 + i * 1.7) * 0.32;
        w.spin.rotation.x = Math.sin(t * 0.27 + i) * 0.08;
        w.watch.setTime(now);
      });
      this.wowLight.intensity = THREE.MathUtils.smoothstep(this.wowT, 0.2, 2.5) * 4000;
      if (this.wowT > 16 && !this.exitShown) this.showExit();
    }

    this.exitPortal.update(dt, cam);
    if (this.exitShown && !this.done && app.director.state === 'play' && this.exitPortal.contains(player)) {
      this.done = true;
      app.director.completeWorld('sunset');
    }
    const next = this.hotspots.find((h) => !h.visited);
    this.wisp.setTarget(this.attract ? null : this.exitShown ? this.exitPortal.group.position : next ? next.position : this.hotspots[4].position);
    this.wisp.update(dt, player, { hide: !!app.hotspots.focused || app.director.state !== 'play' });
  }

  showExit() {
    this.exitShown = true;
    const p = this.app.player.position.clone();
    const fwd = new THREE.Vector3();
    this.app.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = V(fwd.z, 0, -fwd.x);
    p.addScaledVector(fwd, -2).addScaledVector(right, 11);
    this.placeOnWalk(p, { height: 4.6, radius: 2 });
    this.exitPortal.group.position.copy(p);
    this.exitPortal.show(true);
    this.app.narrator.say('sunset.narration.exit', { delay: 0.5 });
  }
}
