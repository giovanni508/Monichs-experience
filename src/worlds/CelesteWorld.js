import * as THREE from 'three';
import { World } from './World.js';
import { WalkArea, insetEnds } from '../core/WalkArea.js';
import { createEnvironment } from '../gfx/env.js';
import { Mat, highlightTargets } from '../gfx/materials.js';
import { SunShadow, enableShadows } from '../gfx/shadows.js';
import { DustField } from '../gfx/particles.js';
import { glowSprite, noiseTexture, textPlane, mulberry32 } from '../gfx/effects.js';
import { DialSky, CloudSea } from '../gfx/sky.js';
import { createWatch } from '../gfx/watchModel.js';
import { buildBracelet } from '../gfx/bracelet.js';
import { curvedText, pictogramMesh } from './movement/parts.js';
import { GuideWisp } from './common/GuideWisp.js';
import { Portal } from './common/Portal.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// MONDO 1 — CELESTE (Ref. M-001) — la cassa e il bracciale integrato.
// Una terrazza sospesa sopra un mare di nuvole; le maglie del bracciale diventano un ponte che sale
// verso la cassa, monolite lontano. Il cielo è il quadrante laccato. Si cammina sulla terrazza e
// sulle maglie (i bordi non si oltrepassano).
const STATIONS = ['case', 'bracelet', 'coating', 'dial', 'water', 'lume'];
const LINK_TOP = 0.53; // superficie spazzolata della maglia sopra il centro della posa (altezza 2,4)

export class CelesteWorld extends World {
  constructor(app) {
    super(app, 'celeste');
    this.audioPalette = 'celeste';
    this.tickTimbre = 'airy';
    this.tickPresence = 0.45;
    this.post = {
      bloom: 0.45,
      bloomThreshold: 0.92,
      exposure: 0.86,
      saturation: 1.08,
      vignette: 0.5,
      vignetteOffset: 0.32,
      grain: 0.055,
      ao: { radius: 3, intensity: 2 },
      ssr: { intensity: 1, maxDistance: 220, thickness: 2 },
    };
    this.night = 0;
    this.nightAnim = null;
    this.scratch = null;
    this.speedScale = 1.35;
    this.eyeHeight = 3.4;
  }

  async load() {
    const app = this.app;
    const s = this.scene;
    s.background = new THREE.Color(0xdfe8f0);
    this.dayFog = new THREE.Color(0xc6d6e8);
    this.nightFog = new THREE.Color(0x0b1238);
    s.fog = new THREE.FogExp2(this.dayFog.clone(), 0.0007);
    this.envDay = createEnvironment(app.renderer.renderer, 'sky');
    this.envNight = createEnvironment(app.renderer.renderer, 'night');
    s.environment = this.envDay;

    // cielo-quadrante e nuvole
    this.sky = new DialSky();
    s.add(this.sky.mesh);
    this.noise = noiseTexture(256, 5, 7);
    this.clouds = new CloudSea(this.noise, { y: -70 });
    s.add(this.clouds.mesh);
    this.buildCloudPuffs();

    // luci
    this.sunDir = this.sky.uniforms.uSunDir.value.clone();
    this.sun = new THREE.DirectionalLight(0xfff3e4, 2.3);
    this.sun.position.copy(this.sunDir).multiplyScalar(100);
    s.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0xc3d8f2, 0xd8d6d2, 0.55);
    s.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0x9fb4ff, 0);
    this.moon.position.set(-60, 80, 40);
    s.add(this.moon);

    this.buildTerrace();
    this.buildBridge();
    await this.buildMonolith();
    this.buildScratchRig();
    this.buildDroplets();

    this.dust = new DustField({ count: 500, box: [80, 40, 80], color: 0xffffff, size: 0.7, opacity: 0.32, rise: 0.02 });
    s.add(this.dust.points);
    this.wisp = new GuideWisp(this, { color: 0xffffff, size: 1.3 });

    this.exitPortal = new Portal({ id: 'exit', name: 'SW200-2', ref: 'ÉLABORÉ · SWISS MADE', colorA: 0x16205a, colorB: 0xbfe4ff, radius: 4.4 });
    s.add(this.exitPortal.group);

    // ombre del sole: una scatola grande e spostata in avanti, così dal ponte arriva fino al
    // monolite (lancette e lunetta proiettano ombra sul quadrante gigante)
    enableShadows(s);
    s.userData.shadow = new SunShadow(this.sun, { extent: 100, distance: 320, ahead: 0.6 });

    this.buildWalkArea();
    this.buildHotspots();
    this.spawn = { position: V(0, this.eyeHeight, 24), yaw: 0, pitch: 0.08 };
    this.attractShots = [
      { from: [36, 14, 34], to: [-14, 9, -24], lookFrom: [0, 70, -292], lookTo: [0, 62, -292], duration: 10, labelKey: 'attract.celeste' },
      { from: [16, 14, -86], to: [-6, 20, -176], lookFrom: [0, 55, -292], lookTo: [0, 75, -292], duration: 10, labelKey: 'attract.celeste' },
    ];
    this.loaded = true;
  }

  buildCloudPuffs() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const rand = mulberry32(11);
    for (let i = 0; i < 26; i++) {
      const x = 128 + (rand() - 0.5) * 120;
      const y = 140 + (rand() - 0.5) * 60;
      const r = 40 + rand() * 60;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.55)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.puffs = [];
    const rand2 = mulberry32(5);
    for (let i = 0; i < 22; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, fog: true });
      const sp = new THREE.Sprite(mat);
      const a = rand2() * Math.PI * 2;
      const r = 120 + rand2() * 300;
      sp.position.set(Math.cos(a) * r, -48 + rand2() * 30, -100 + Math.sin(a) * r);
      const sc = 60 + rand2() * 120;
      sp.scale.set(sc * 1.7, sc, 1);
      sp.userData.drift = 0.5 + rand2() * 1.2;
      this.scene.add(sp);
      this.puffs.push(sp);
    }
  }

  buildTerrace() {
    const s = this.scene;
    const mat = Mat.steelSatin({ color: 0xd2d6dc, roughness: 0.32, anisotropy: 0.75 });
    const geo = new THREE.CylinderGeometry(42, 39, 4, 128, 1);
    // tangenti circolari: satinatura concentrica
    const pos = geo.attributes.position;
    const t = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const l = Math.hypot(x, z);
      t[i * 4] = l > 1e-5 ? -z / l : 1;
      t[i * 4 + 2] = l > 1e-5 ? x / l : 0;
      t[i * 4 + 3] = 1;
    }
    geo.setAttribute('tangent', new THREE.BufferAttribute(t, 4));
    this.terrace = new THREE.Mesh(geo, mat);
    this.terrace.position.y = -2;
    s.add(this.terrace);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(42, 0.5, 12, 160), Mat.steelPolished());
    rim.rotation.x = Math.PI / 2;
    s.add(rim);
    // anello inciso come sul fondello reale di Celeste
    const ring = curvedText('10 ATMOSPHERES  ·  MONICHS  ·  SWISS AUTOMATIC MOVEMENT  ·  316L STAINLESS STEEL  ·', {
      radius: 36,
      width: 3.4,
      start: 0,
      length: Math.PI * 2 - 0.02,
      font: '500 58px Montserrat',
      color: '#555b66',
      canvasW: 4096,
      canvasH: 128,
      opacity: 0.55,
    });
    ring.position.y = 0.03;
    s.add(ring);
    this.ringText = ring;
    const circle = new THREE.Mesh(new THREE.RingGeometry(33, 33.15, 160), new THREE.MeshBasicMaterial({ color: 0x6b7280, transparent: true, opacity: 0.35 }));
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = 0.02;
    s.add(circle);
    // pittogramma lucido al centro
    const pic = pictogramMesh(10, Mat.steelPolished({ color: 0xf0f2f4, roughness: 0.04 }), 0.3);
    pic.rotation.x = -Math.PI / 2;
    pic.position.y = 0.02;
    s.add(pic);
  }

  buildBridge() {
    const pts = [V(0, -0.5, -40), V(6, 2.5, -90), V(-4, 6.5, -140), V(3, 10.5, -190), V(0, 14, -228), V(0, 16.5, -252), V(0, 18.5, -268)];
    this.bridgeCurve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const len = this.bridgeCurve.getLength();
    const step = 5.6;
    const n = Math.floor(len / step);
    const poses = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const pos = this.bridgeCurve.getPointAt(u);
      const dir = this.bridgeCurve.getTangentAt(u);
      dir.y *= 0.4;
      poses.push({ pos, dir, scale: 1 + Math.pow(u, 6) * 0.22 });
    }
    this.bridgePoses = poses;
    this.bracelet = buildBracelet(poses, { width: 22, length: 5.2, height: 2.4 });
    this.scene.add(this.bracelet.group);
  }

  // terrazza (disco) e ponte di maglie (corridoio): misure per il centro del corpo
  buildWalkArea() {
    const walk = new WalkArea({ stepTolerance: 1.6 });
    const body = this.bodyRadius;
    walk.disc(0, 0, 42 - 0.7 - body, 0, { name: 'terrazza' });
    // il ponte finisce nel vuoto davanti alla cassa: ci si ferma sull'ultima maglia
    walk.corridor(
      insetEnds(this.bridgePoses.map((p) => [p.pos.x, p.pos.y + LINK_TOP, p.pos.z, 11 * p.scale - 0.5 - body]), { end: true, margin: 0.8 }),
      { name: 'bracciale' },
    );
    this.walk = walk;
    // la lucciola segue la terrazza e poi la mezzeria del ponte, all'altezza degli occhi
    const pts = [V(0, 0, 24), V(0, 0, -30)].map((p) => this.walkEye(p.x, p.z, 0, 0.3));
    this.bridgePoses.forEach((p, i) => {
      if (i % 3 === 0 || i === this.bridgePoses.length - 1) pts.push(V(p.pos.x, p.pos.y + LINK_TOP + this.eyeHeight + 0.3, p.pos.z));
    });
    this.setPath(pts, 10, 4);
  }

  // l'orologio-monolite: il modello 3D di Celeste (quote dei disegni tecnici), gigante, in piedi
  // sull'orizzonte con il bracciale che scende verso le nuvole
  async buildMonolith() {
    const cfg = this.app.config.assets || {};
    const S = 2.48; // unità per millimetro: il quadrante (Ø 29 mm) misura 72 unità, come prima
    this.mm = S;
    this.watch = (await createWatch('celeste', cfg['model.celeste'] || 'assets/models/celeste.glb')).setScale(S).upright();
    this.watch.object.position.z = -5 * S; // centro della cassa sull'origine del gruppo
    const g = new THREE.Group();
    g.add(this.watch.object);
    g.position.set(0, 75, -292);
    g.rotation.x = 0.3; // chinato verso il ponte: il quadrante si legge salendo (da sotto)
    this.monolith = g;
    this.scene.add(g);
    // alone di luce dietro il monolite
    const halo = glowSprite(0xffffff, 420, 0.06);
    halo.position.set(0, 72, -350);
    this.scene.add(halo);
    this.halo = halo;
  }

  buildScratchRig() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(9, 8.4, 1.2, 64), Mat.steelPolished({ color: 0xd9dce0, roughness: 0.1 }));
    g.add(base);
    // due campioni: 316L non trattato (sinistra) e con hard coating (destra)
    this.plainMat = Mat.steelSatin({ color: 0xc9ccd1, roughness: 0.34, anisotropy: 0.8 });
    this.coatMat = Mat.steelSatin({ color: 0xbfc3c9, roughness: 0.26, anisotropy: 0.8 });
    const plate = (x, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.9, 9), mat);
      m.position.set(x, 1.05, 0);
      const pos = m.geometry.attributes.position;
      const t = new Float32Array(pos.count * 4);
      for (let i = 0; i < pos.count; i++) {
        t[i * 4] = 1;
        t[i * 4 + 3] = 1;
      }
      m.geometry.setAttribute('tangent', new THREE.BufferAttribute(t, 4));
      g.add(m);
      return m;
    };
    this.plainPlate = plate(-3.6, this.plainMat);
    this.coatPlate = plate(3.6, this.coatMat);
    const lab1 = textPlane([{ text: '316L', font: '500 70px Montserrat', letterSpacing: 8, color: '#2a2f38' }], { width: 512, height: 128, size: 3.6 });
    lab1.rotation.x = -Math.PI / 2;
    lab1.position.set(-3.6, 1.52, 3.6);
    g.add(lab1);
    const lab2 = textPlane([{ text: '1.200 HV', font: '500 70px Montserrat', letterSpacing: 8, color: '#2a2f38' }], { width: 512, height: 128, size: 3.6 });
    lab2.rotation.x = -Math.PI / 2;
    lab2.position.set(3.6, 1.52, 3.6);
    g.add(lab2);
    // graffio (sul solo campione non trattato): cresce durante la prova
    this.scratchLine = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 1), new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.2, metalness: 1 }));
    this.scratchLine.position.set(-3.6, 1.52, 0);
    this.scratchLine.scale.z = 0.001;
    g.add(this.scratchLine);
    // punta di diamante
    this.stylus = new THREE.Group();
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.1, 0),
      new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0, transmission: 0, clearcoat: 1, ior: 2.4, envMapIntensity: 2.4, specularIntensity: 1 }),
    );
    gem.scale.set(1, 1.6, 1);
    this.stylus.add(gem);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 6, 16), Mat.steelPolished());
    arm.position.y = 4.2;
    this.stylus.add(arm);
    this.stylus.position.set(-6.5, 5, -3.5);
    g.add(this.stylus);
    this.sparks = glowSprite(0xffffff, 3, 0);
    g.add(this.sparks);
    // accanto al bordo del ponte, sotto lo sguardo: si vedono dall'alto i due campioni e il graffio
    g.position.set(21, 4.6, -126);
    this.rig = g;
    this.scene.add(g);
  }

  buildDroplets() {
    // gocce che scivolano sul fianco del monolite (10 ATM)
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0, clearcoat: 1, ior: 1.33, transparent: true, opacity: 0.55, envMapIntensity: 2 });
    this.drops = [];
    const rand = mulberry32(3);
    for (let i = 0; i < 9; i++) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.9 + rand() * 0.8, 20, 14), mat);
      d.scale.y = 1.25;
      d.userData = { x: 10 + rand() * 18, phase: rand() * 10, speed: 2 + rand() * 3 };
      this.scene.add(d);
      this.drops.push(d);
    }
  }

  buildHotspots() {
    const cards = this.app.config.cards || {};
    const mk = (id, position, radius, focusRadius, targets, extra = {}) => ({
      id,
      textKey: `celeste.stations.${id}`,
      image: cards[`celeste.stations.${id}`] || '',
      kickerKey: 'celeste.kicker',
      kickerVars: { n: STATIONS.indexOf(id) + 1, total: STATIONS.length },
      position,
      radius,
      focusRadius,
      targets,
      ...extra,
    });
    // posizioni sul calpestabile, all'altezza degli occhi
    const at = (x, z, y) => this.walkEye(x, z, y);
    this.hotspots = [
      mk('case', at(0, -34, 0), 26, 14, this.watch.meshList('cassa', 'lunetta_anello_esterno', 'lunetta_anello_interno')),
      mk('bracelet', at(4, -76, 2), 22, 12, [this.bracelet.group]),
      mk('coating', at(16, -126, 5), 18, 9, [this.plainPlate, this.coatPlate], { actionKey: 'celeste.stations.coating.action', onAction: () => this.startScratch() }),
      mk('dial', at(-2, -168, 9), 22, 12, this.watch.meshList('quadrante')),
      mk('water', at(14, -212, 13), 18, 10, [...this.watch.meshList('corona', 'fondello'), ...this.drops]),
      mk('lume', at(0, -230, 14), 18, 10, [], { actionKey: 'celeste.stations.lume.action', onAction: () => this.startNight(), actionOnce: true }),
    ];
    this.hotspots.forEach((h) => (h.uniforms = highlightTargets(h.targets)));
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
    this.setNight(0);
    this.nightAnim = null;
    this.scratch = null;
    this.scratchLine.scale.z = 0.001;
    this.exitShown = false;
    this.exitPortal.show(false);
    this.exitPortal.reveal = 0;
    this.exitPortal.group.visible = false;
    this.done = false;
    this.wisp.reset(V(0, 6, 10));
    this.wisp.pathLength = 0;
    if (!opts.attract) {
      this.hotspots.forEach((h) => {
        h.visited = false;
        h.actionDone = false;
      });
      this.app.narrator.say('celeste.narration.arrive', { delay: 1.2 });
      this.app.narrator.say('celeste.narration.arrive2');
    }
    this.app.audio.setTickPresence(0.45, 0);
  }

  exit() {
    super.exit();
    this.app.renderer.postOverride = null;
    this.app.audio.duckMusic(1, 1);
  }

  progressState() {
    const done = this.hotspots.map((h, i) => (h.visited ? i : -1)).filter((i) => i >= 0);
    return { partKey: 'progress.celeste.part', nameKey: 'progress.celeste.name', total: STATIONS.length, done, current: this.hotspots.findIndex((h) => !h.visited) };
  }

  onHotspotVisited(h) {
    if (h.id === 'case') this.app.narrator.say('celeste.narration.bridge', { once: true, delay: 1.5 });
    this.app.ui.setProgress(this.progressState());
  }

  // ------------------------------------------------------------------ prova del graffio

  startScratch() {
    if (this.scratch) return;
    this.scratch = { t: 0 };
    this.scratchLine.scale.z = 0.001;
  }

  updateScratch(dt) {
    const sc = this.scratch;
    if (!sc) return;
    sc.t += dt;
    const t = sc.t;
    // 0–1 s: discesa; 1–3 s: passata sul 316L; 3–5 s: passata sul campione trattato; poi risale
    let x = -6.5;
    let y = 5;
    let z = -3.5;
    let contact = 0;
    if (t < 1) y = 5 - t * 3.0;
    else if (t < 3) {
      const k = (t - 1) / 2;
      x = -3.6;
      z = -3.5 + k * 7;
      y = 2.0;
      contact = 1;
      this.scratchLine.scale.z = Math.max(0.001, k * 7);
      this.scratchLine.position.z = -3.5 + (k * 7) / 2;
    } else if (t < 3.6) {
      const k = (t - 3) / 0.6;
      x = -3.6 + k * 7.2;
      y = 2.6;
      z = 3.5 - k * 7;
    } else if (t < 5.6) {
      const k = (t - 3.6) / 2;
      x = 3.6;
      z = -3.5 + k * 7;
      y = 2.0;
      contact = 2;
    } else if (t < 6.6) {
      x = 3.6;
      y = 2 + (t - 5.6) * 3;
      z = 3.5;
    } else {
      this.scratch = null;
      this.stylus.position.set(-6.5, 5, -3.5);
      this.sparks.material.opacity = 0;
      return;
    }
    this.stylus.position.set(x, y, z);
    this.sparks.position.set(x, 1.6, z);
    this.sparks.material.opacity = contact ? 0.6 + Math.random() * 0.4 : 0;
    this.sparks.scale.setScalar(contact === 2 ? 2.2 + Math.random() * 1.5 : 1.2 + Math.random());
    if (contact && !sc[`s${contact}`]) {
      sc[`s${contact}`] = true;
      this.app.audio.scratch(2, contact === 1 ? 0.12 : 0.09, contact === 1 ? 0.8 : 1.5);
    }
  }

  // ------------------------------------------------------------------ dal giorno alla notte

  startNight() {
    if (this.nightAnim) return;
    this.nightAnim = { t: 0, stage: 0 };
    this.app.narrator.clear();
    this.app.narrator.say('celeste.narration.dusk', { priority: true });
  }

  setNight(f) {
    this.night = f;
    this.sky.uniforms.uNight.value = f;
    this.clouds.uniforms.uNight.value = f;
    this.watch.setNight(THREE.MathUtils.smoothstep(f, 0.45, 0.9));
    this.sun.intensity = 2.3 * (1 - f);
    this.hemi.intensity = THREE.MathUtils.lerp(0.55, 0.18, f);
    this.hemi.color.setHex(0xc3d8f2).lerp(new THREE.Color(0x1d2c66), f);
    this.hemi.groundColor.setHex(0xd8d6d2).lerp(new THREE.Color(0x05060f), f);
    this.moon.intensity = f * 0.9;
    this.scene.fog.color.copy(this.dayFog).lerp(this.nightFog, f);
    this.scene.background.copy(this.scene.fog.color);
    this.scene.environment = f > 0.55 ? this.envNight : this.envDay;
    this.scene.environmentIntensity = f > 0.55 ? THREE.MathUtils.lerp(0.4, 1, (f - 0.55) / 0.45) : THREE.MathUtils.lerp(1, 0.4, f / 0.55);
    this.halo.material.opacity = 0.06 * (1 - f) + 0.08 * f;
    this.halo.material.color.setHex(0xffffff).lerp(new THREE.Color(0x6ff4ff), f);
    this.puffs?.forEach((p) => p.material.color.setHex(0xffffff).lerp(new THREE.Color(0x3a4a80), f));
    this.app.renderer.postOverride = f > 0.01 ? { bloom: 0.45 + f * 0.9, bloomThreshold: 0.9 - f * 0.35, vignette: 0.42 + f * 0.25, exposure: 1 + f * 0.1 } : null;
  }

  updateNight(dt) {
    const n = this.nightAnim;
    if (!n) return;
    n.t += dt;
    const f = THREE.MathUtils.smoothstep(n.t, 0.5, 8.5);
    this.setNight(f);
    if (n.stage === 0 && n.t > 6.5) {
      n.stage = 1;
      this.app.narrator.say('celeste.narration.night', { priority: true });
      this.app.audio.swell([293.66, 369.99, 440, 659.25], { gain: 0.03, dur: 6 });
    }
    if (n.stage === 1 && n.t > 11) {
      n.stage = 2;
      this.app.narrator.say('celeste.narration.silence', { priority: true, hold: 3.2 });
      this.app.audio.duckMusic(0.08, 3); // un respiro di silenzio
      this.app.audio.setTickPresence(0.2, 0);
    }
    if (n.stage === 2 && n.t > 19) {
      n.stage = 3;
      this.app.audio.duckMusic(1, 6);
      this.showExit();
    }
  }

  showExit() {
    if (this.exitShown) return;
    this.exitShown = true;
    const cam = this.app.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const p = this.app.player.position.clone().addScaledVector(fwd, 12).addScaledVector(right, -5);
    // sul ponte, con il fondo del portale appena sopra la maglia: ci si entra camminando
    this.placeOnWalk(p, { height: 4.6, radius: 2 });
    this.exitPortal.group.position.copy(p);
    this.exitPortal.show(true);
    this.app.narrator.say('celeste.narration.exit', { delay: 0.5 });
  }

  // ------------------------------------------------------------------ aggiornamento

  update(dt, t) {
    super.update(dt);
    const app = this.app;
    const cam = app.camera;
    const player = app.player.position;
    this.sky.update(dt, cam);
    this.clouds.update(dt, cam);
    this.dust.update(dt, cam);
    this.watch.setTime();
    this.updateScratch(dt);
    this.updateNight(dt);
    this.puffs.forEach((p) => {
      p.position.x += p.userData.drift * dt;
      if (p.position.x > 400) p.position.x = -400;
    });
    // gocce: scivolano lungo il fianco destro della cassa (20,55 mm dal centro) e ricominciano
    const m = this.monolith;
    const mm = this.mm;
    this.drops.forEach((d) => {
      const u = d.userData;
      const k = ((t * u.speed * 0.08 + u.phase) % 1 + 1) % 1;
      const local = new THREE.Vector3(20.8 * mm + (u.x - 19) * 0.12, (21 - k * 42) * mm, (1 + Math.sin(u.phase + k * 6) * 0.8) * mm);
      d.position.copy(local.applyMatrix4(m.matrixWorld));
    });

    // uscita
    this.exitPortal.update(dt, cam);
    if (this.exitShown && !this.done && app.director.state === 'play' && this.exitPortal.contains(player)) {
      this.done = true;
      app.director.completeWorld('celeste');
    }
    // se tutte le tappe sono state viste ma la sera non è stata richiesta, la si propone
    const next = this.hotspots.find((h) => !h.visited);
    this.wisp.setTarget(this.attract ? null : this.exitShown ? this.exitPortal.group.position : next ? next.position : this.hotspots[5].position);
    this.wisp.update(dt, player, { hide: !!app.hotspots.focused || app.director.state !== 'play' });
  }
}
