import * as THREE from 'three';
import { World } from './World.js';
import { WalkArea } from '../core/WalkArea.js';
import { loadJSON } from '../core/Content.js';
import { createEnvironment } from '../gfx/env.js';
import { createWatch } from '../gfx/watchModel.js';
import { layBraceletFlat } from '../gfx/braceletFlat.js';
import { highlightTargets } from '../gfx/materials.js';
import { SunShadow, enableShadows } from '../gfx/shadows.js';
import { lightShaft, glowSprite, loadTexture } from '../gfx/effects.js';
import { DustField } from '../gfx/particles.js';
import { S, MAT, buildBench, buildSheet, buildLoupe, buildTweezers, buildScrewdriver, buildPencil, buildLamp, buildBox } from './lab/props.js';
import { buildRoom } from './lab/room.js';
import { FounderRig, FounderPresence, loadFounder } from './lab/Founder.js';
import { LabStory } from './lab/LabStory.js';

// ---------------------------------------------------------------------------------------------
// IL LABORATORIO (sezione finale, docs/specs/2026-10-07-laboratorio.md). Il visitatore, ancora
// piccolo, esce dal fondello della Virentia coricata sul banco Monichs e cammina sul tappetino fra
// gli orologi, il disegno tecnico, il foglio della cassa 4029, lo schizzo del rotore e la scatola.
// Dietro il banco, giganti, Giovanni e Filippo raccontano (content/lab.json). Alla fine alzano lo
// sguardo verso la persona davanti allo schermo, la camera torna "grande" fino ai loro occhi, poi
// "Grazie", il bianco caldo, il cartello e l'epilogo.
// ---------------------------------------------------------------------------------------------

const M = 1000 * S; // unità di scena per metro (i fondatori)
const mm = (v) => v * S;
const NAMES = ['giovanni', 'filippo'];
// la camera a misura d'uomo: a distanza di conversazione, con l'angolo di campo dell'occhio
const FINAL = { distance: 1.0, lookDrop: 0.07, fov: 50 };
const ease = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

// Disposizione sul banco (mm; origine al centro del tappetino, il fronte verso +Z, i fondatori a -Z)
const LAYOUT = {
  virentia: { x: 0, z: 60, yaw: 0, face: 'front' }, // coricata sul quadrante, fondello in alto
  celeste: { x: -255, z: 85, yaw: 0.1, face: 'back' }, // quadrante in su
  sunset: { x: 258, z: 70, yaw: -0.12, face: 'back' },
  drawing: { x: -178, z: -165, yaw: 0.05, w: 297, h: 210 }, // A4, scala 1:1
  // lo schizzo si accende alla prima battuta del racconto: davanti al visitatore appena arrivato (che
  // guarda i fondatori), non alle sue spalle; la tavola 4029, ruotata, prende il suo posto dietro
  case4029: { x: -118, z: 140, yaw: Math.PI / 2 + 0.06, w: 272, h: 164.5 },
  sketch: { x: 192, z: -170, yaw: -0.18, w: 160, h: 160 },
  // lente e matita lontane dalle mani dei fondatori: la matita stava sotto le dita della sinistra di
  // Giovanni, e dal punto d'arrivo la lente incorniciava un polpastrello di Filippo (ora sta al centro
  // del banco, fuori dalla linea fra il visitatore e le mani)
  loupe: { x: 60, z: -110, yaw: 0.6 },
  tweezers: { x: 70, z: 210, yaw: 0.35 },
  screwdriver: { x: 352, z: 150, yaw: 1.75 },
  pencil: { x: -110, z: -118, yaw: 1.25 },
  box: { x: 588, z: -212, yaw: -0.42 },
  lamp: { base: [-700, -335], head: [-440, 470, -80] },
  seat: -420, // il piano del sedile, sotto il banco
  // a 72 cm l'uno dall'altro: chini sul banco, con le braccia aperte, i gomiti interni non si toccano
  founders: {
    giovanni: { x: -360, z: -650, yaw: 0.1, hands: -190 },
    filippo: { x: 360, z: -650, yaw: -0.1, hands: -190 },
  },
};

// segnaposto: due presenze calde, nei toni degli abiti delle foto (dolcevita nero, camicia bianca)
const PRESENCE = {
  giovanni: { color: 0xf2a76a, core: 0x3a2618, seed: 3 },
  filippo: { color: 0xffe6cc, core: 0xa08a74, seed: 7 },
};

// L'espressione dei modelli: sorriso a riposo, mentre ascoltano nell'inquadratura finale e nel "Grazie".
// v2.2b: il volto a riposo sorride già a labbra chiuse e smile scopre i denti da 0,2 (un sorriso fisso a
// denti stretti, mentre si ascolta, inquieta); le palpebre appena abbassate tolgono il bianco sopra
// l'iride (oltre 0,2 il bulbo passa tra le ciglia). v3: smile a labbra chiuse, i denti con smileTeeth
// solo nel "Grazie", palpebre già rilassate nel modello.
const EXPRESSION = {
  v2: { smile: 0.05, listen: 0.15, thanks: 0.35, teeth: 0, lid: 0.1 },
  v3: { smile: 0.25, listen: 0.45, thanks: 0.5, teeth: 0.5, lid: 0 },
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class LabWorld extends World {
  constructor(app) {
    super(app, 'lab');
    this.audioPalette = 'lab';
    // la Virentia sul banco ticchetta piano
    this.tickTimbre = 'soft';
    this.tickPresence = 0.2;
    this.tickEnabled = true;
    this.speedScale = 1.4;
    this.post = {
      // come nell'epilogo: l'acciaio lucidato sotto la lampada non deve fare alone
      bloom: 0.42,
      bloomThreshold: 0.93,
      exposure: 1.0,
      saturation: 1.02,
      vignette: 0.62,
      vignetteOffset: 0.3,
      grain: 0.05,
      ao: { radius: 1.6, intensity: 1.8 },
      ssr: { intensity: 1, maxDistance: 70, thickness: 0.35 },
      dof: { scale: 2.2, range: 1.2 },
    };
    this.glance = {};
    this.nextGlance = {};
    this._gaze = { giovanni: new THREE.Vector3(), filippo: new THREE.Vector3() };
  }

  get holdsIdle() {
    return this.active && !this.attract && !!this.story?.holdsIdle;
  }

  async load() {
    const app = this.app;
    const s = this.scene;
    const cfg = app.config.assets || {};
    // la stanza chiude la scena: lo sfondo si vede solo dalle finestre, e lì c'è la vista sul lago
    s.background = new THREE.Color(0x1d1712);
    s.fog = new THREE.FogExp2(0x2b2219, 0.0003);
    // ambiente "studio" per l'acciaio degli orologi, come nell'epilogo
    s.environment = createEnvironment(app.renderer.renderer, 'studio');
    s.environmentIntensity = 0.42;

    const [script, drawingTex, caseTex, sketchTex] = await Promise.all([
      loadJSON('content/lab.json').catch(() => ({ lines: [] })),
      loadTexture(cfg['lab.drawing'] || 'assets/tex/lab/drawing.webp'),
      loadTexture(cfg['lab.case4029'] || 'assets/tex/lab/case-4029.webp'),
      loadTexture(cfg['lab.sketch'] || 'assets/tex/lab/rotor-sketch.webp'),
    ]);

    // ---------------------------------------------------------------- luci
    // la lampada da banco, calda, è la luce principale e proietta le ombre
    const head = LAYOUT.lamp.head;
    const key = new THREE.DirectionalLight(0xffd8ae, 2.4);
    key.position.set(mm(head[0]), mm(head[1]), mm(head[2]));
    key.target.position.set(0, 0, mm(30));
    s.add(key, key.target);
    // sui fondatori una luce morbida e calda dal davanti (niente controluce duro sui volti)
    const faces = new THREE.DirectionalLight(0xffe3c8, 0.55);
    faces.position.set(mm(250), mm(800), mm(900));
    faces.target.position.set(0, mm(250), mm(-650));
    s.add(faces, faces.target);
    // il rimbalzo della stanza: soffitto chiaro, pavimento di rovere
    s.add(new THREE.HemisphereLight(0xfff2e2, 0x4a3324, 0.34));

    // ---------------------------------------------------------------- banco e oggetti
    this.bench = buildBench();
    s.add(this.bench.group);
    const sheet = (tex, L, seed) => {
      const mesh = buildSheet(tex, { width: L.w, height: L.h, seed });
      const g = new THREE.Group();
      g.scale.setScalar(S);
      g.add(mesh);
      g.position.set(mm(L.x), 0, mm(L.z));
      g.rotation.y = L.yaw;
      mesh.userData.noCastShadow = true; // un foglio non fa ombra sul tappetino su cui poggia
      s.add(g);
      return mesh;
    };
    this.sheets = {
      drawing: sheet(drawingTex, LAYOUT.drawing, 1),
      case4029: sheet(caseTex, LAYOUT.case4029, 2),
      sketch: sheet(sketchTex, LAYOUT.sketch, 3),
    };
    const place = (obj, L, y = 0) => {
      obj.scale.setScalar(S);
      obj.position.set(mm(L.x), y, mm(L.z));
      obj.rotation.y = L.yaw;
      s.add(obj);
      return obj;
    };
    place(buildLoupe(), LAYOUT.loupe);
    place(buildTweezers(), LAYOUT.tweezers);
    place(buildScrewdriver(), LAYOUT.screwdriver);
    place(buildPencil(), LAYOUT.pencil, mm(0.6)); // sopra il disegno
    const box = buildBox();
    place(box.group, LAYOUT.box, mm(-MAT.thick));
    const lamp = buildLamp(LAYOUT.lamp);
    lamp.scale.setScalar(S);
    // la luce viene dalla lampada stessa: le sue parti non le fanno ombra
    lamp.traverse((o) => (o.userData.noCastShadow = true));
    s.add(lamp);

    // ---------------------------------------------------------------- la stanza intorno al banco
    // (le finestre con la luce del pomeriggio e la luce delle lampade a sospensione)
    this.room = buildRoom();
    s.add(this.room.group);
    for (const l of this.room.lights) s.add(l);

    // ---------------------------------------------------------------- orologi (GLB)
    this.watches = {};
    const watchHL = [];
    for (const id of ['virentia', 'celeste', 'sunset']) {
      const L = LAYOUT[id];
      const w = await createWatch(id, cfg[`model.${id}`] || `assets/models/${id}.glb`);
      // materiali propri: l'evidenziazione non tocca gli orologi degli altri mondi
      w.ownMaterials();
      const flat = layBraceletFlat(w, { face: L.face });
      w.setScale(S);
      if (L.face === 'front') {
        // coricata sul quadrante: si capovolge e poggia sul vetro
        w.object.rotation.set(Math.PI, 0, 0);
        w.object.position.y = mm(flat.top);
      }
      const holder = new THREE.Group();
      holder.add(w.object);
      holder.position.set(mm(L.x), 0, mm(L.z));
      holder.rotation.y = L.yaw;
      s.add(holder);
      w.holder = holder;
      w.flat = flat;
      this.watches[id] = w;
      const meshes = [];
      w.object.traverse((o) => {
        if (o.isMesh && o.visible && !o.material.transparent) meshes.push(o);
      });
      watchHL.push(...highlightTargets(meshes, 0xffd8b4));
    }
    // il movimento sotto lo zaffiro (foto Vi 4): si accende all'arrivo e poi si spegne
    this.watches.virentia.object.traverse((o) => {
      if (o.isMesh && /Movimento \(foto/.test(o.material.name)) {
        const m = o.material;
        m.emissive = new THREE.Color(0xffffff);
        m.emissiveMap = m.map;
        m.emissiveIntensity = 0;
        this.movementMat = m;
      }
    });

    // ---------------------------------------------------------------- luce del fondello all'arrivo
    const vir = this.watches.virentia.holder.position;
    this.casebackTop = mm(this.watches.virentia.flat.top);
    this.arrival = new THREE.Group();
    this.arrival.position.set(vir.x, this.casebackTop, vir.z);
    const shaft = lightShaft({ length: 90, radiusTop: mm(12.4), radiusBottom: 16, color: 0xffe2bc, intensity: 0 });
    shaft.rotation.x = Math.PI; // sale dal fondello
    this.arrival.add(shaft);
    const glow = glowSprite(0xffdcb0, 26, 0);
    glow.position.y = 1;
    this.arrival.add(glow);
    this.arrivalLight = new THREE.PointLight(0xffd2a0, 0, mm(400), 2);
    this.arrivalLight.position.y = 2;
    this.arrival.add(this.arrivalLight);
    this.arrivalParts = { shaft, glow };
    s.add(this.arrival);

    // ---------------------------------------------------------------- fondatori
    this.founders = {};
    for (const name of NAMES) {
      const F = LAYOUT.founders[name];
      // ?debug&founders=Modelli/3D/fondatori/ : prova in locale di modelli non ancora approvati, letti
      // dalla loro cartella e mai copiati in public/ (nella build della fiera quella cartella non c'è)
      const trial = app.debug ? new URLSearchParams(location.search).get('founders') : null;
      const url = trial ? `${trial}founder-${name}.glb` : cfg[`model.founder.${name}`] || `assets/models/founder-${name}.glb`;
      let f = null;
      if (trial || app.hasAsset(url)) {
        const gltf = await loadFounder(url);
        if (gltf) f = new FounderRig(gltf, { seed: PRESENCE[name].seed });
      }
      if (!f) f = new FounderPresence(PRESENCE[name]);
      f.object.scale.setScalar(M);
      f.object.position.set(mm(F.x), mm(LAYOUT.seat), mm(F.z));
      f.object.rotation.y = F.yaw;
      s.add(f.object);
      if (f.isRig) this.fitRig(f, F);
      f.setPose('leanDown', 0);
      this.founders[name] = f;
    }
    this.usingPlaceholders = !this.founders.giovanni.isRig || !this.founders.filippo.isRig;

    // ---------------------------------------------------------------- dove si cammina
    this.buildWalk();

    // ---------------------------------------------------------------- evidenziazioni
    const boxHL = highlightTargets(box.highlight, 0xffd8b4);
    this.hlSet = {
      sketch: (v) => (this.sheets.sketch.userData.lit.value = v),
      drawing: (v) => {
        this.sheets.drawing.userData.lit.value = v;
        this.sheets.case4029.userData.lit.value = v;
      },
      // sull'acciaio basta poco: con tutta la luce degli hotspot sembrerebbe smaltato
      watches: (v) => watchHL.forEach((u) => (u.uHL.value = v * 0.45)),
      box: (v) => boxHL.forEach((u) => (u.uHL.value = v * 0.6)),
    };
    this.hlTargets = {
      sketch: this.sheets.sketch.parent.position,
      drawing: this.sheets.drawing.parent.position,
      watches: this.watches.virentia.holder.position,
      box: box.group.position.clone().setY(mm(60)),
    };
    this.hl = {};

    // ---------------------------------------------------------------- ombre, polvere nella luce
    enableShadows(s);
    for (const f of Object.values(this.founders)) if (!f.isRig) f.object.traverse((o) => (o.castShadow = o.receiveShadow = false));
    s.userData.shadow = new SunShadow(key, { extent: 120, distance: 300, center: new THREE.Vector3(0, 0, mm(-90)), bias: -0.0003, normalBias: 0.02, radius: 3 });
    this.dust = new DustField({ count: 420, box: [60, 34, 60], color: 0xffe6c8, size: 0.32, opacity: 0.35, rise: 0.015 });
    s.add(this.dust.points);

    // ---------------------------------------------------------------- racconto
    // voci registrate (facoltative): solo le clip che ci sono davvero (indice degli asset). Una
    // cartella per lingua: it/ (le voci originali) ed en/ (il doppiaggio); per l'italiano vale anche
    // il file nella cartella principale (g1.mp3)
    const clips = new Map();
    const base = cfg['lab.voices'] || 'assets/audio/lab/';
    const jobs = [];
    for (const l of script.lines || []) {
      const k = l.key.split('.').pop();
      for (const lang of app.i18n.available) {
        const urls = [`${base}${lang}/${k}.mp3`, ...(lang === 'it' ? [`${base}${k}.mp3`] : [])];
        const url = urls.find((u) => app.hasAsset(u));
        if (!url) continue;
        jobs.push(app.audio.loadClip(url).then((buf) => buf && clips.set(`${lang}:${k}`, buf)));
      }
    }
    await Promise.all(jobs);
    this.story = new LabStory(this, script, clips);

    // arrivo: in piedi sullo zaffiro del fondello, lo sguardo sui fondatori che parlano (più in basso il
    // riflesso del bracciale finirebbe sotto il primo sottotitolo e lo renderebbe illeggibile)
    this.spawn = { position: new THREE.Vector3(vir.x, this.casebackTop + this.eyeHeight, vir.z), yaw: 0, pitch: 0.22 };
    this.attractShots = [
      { from: [-52, 70, 118], to: [38, 80, 96], lookFrom: [0, 56, -120], lookTo: [0, 64, -128], duration: 11, labelKey: 'attract.lab' },
    ];
    await this.room.ready; // i quadri e la pianta
    this.loaded = true;
  }

  // Modello vero: le mani poggiano sul banco, davanti al visitatore; mani e avambracci fanno da ostacolo
  fitRig(f, F) {
    const c = f.benchContact();
    if (!c.handL || !c.handR) return;
    // il piano del banco passa per il punto più basso delle mani posate (palmi, polpastrelli): nessun
    // dito affonda nel tappetino. Senza i pesi di skinning si stima 3,5 cm sotto l'osso della mano
    const lowL = c.lowL ?? c.handL.y - 0.035;
    const lowR = c.lowR ?? c.handR.y - 0.035;
    const handY = Math.min(lowL, lowR);
    f.benchFit = { below: (c.handL.y + c.handR.y) / 2 - handY, spread: Math.abs(lowL - lowR) };
    const handZ = (c.handL.z + c.handR.z) / 2;
    f.object.position.y = -handY * M;
    f.object.position.z = Math.min(mm(F.hands) - handZ * M, mm(-560));
    f.object.updateMatrixWorld(true);
    this.rigContacts = this.rigContacts || [];
    const reach = f.handReach();
    for (const side of ['L', 'R']) {
      const hand = f.bones[`hand.${side}`];
      const fore = f.bones[`forearm.${side}`];
      if (!hand) continue;
      const a = hand.getWorldPosition(new THREE.Vector3());
      const b = fore ? fore.getWorldPosition(new THREE.Vector3()) : a.clone();
      if (a.y >= mm(80)) continue;
      this.rigContacts.push({ a, b });
      // la mano intera, dal polso ai polpastrelli: l'avambraccio da solo lasciava entrare il visitatore
      // fra le dita (la mano arriva 17 cm oltre il polso); la capsula si ferma poco oltre le punte
      const h = reach[side];
      if (!h) continue;
      const r = mm(45);
      const dir = new THREE.Vector3(h.tip.x - h.wrist.x, 0, h.tip.z - h.wrist.z);
      const len = dir.length();
      if (len > r) this.rigContacts.push({ a: h.wrist, b: h.wrist.clone().addScaledVector(dir.normalize(), len - r * 0.7), r });
    }
  }

  // ------------------------------------------------------------------ cammino

  // Profilo d'altezza di un orologio lungo l'asse del bracciale (coordinate del supporto, ruotato
  // solo attorno a Y): il punto più alto delle sue superfici in fette di 1,5 mm, entro la larghezza
  // del bracciale. Così si sale dalla punta del bracciale fino al vetro (o al fondello) e si scende.
  watchProfile(w, half) {
    const holder = w.holder;
    holder.updateMatrixWorld(true);
    const inv = holder.matrixWorld.clone().invert();
    const step = mm(1.5);
    const bins = new Map();
    w.object.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
        if (Math.abs(_v.x) > half) continue;
        const k = Math.round(_v.z / step);
        bins.set(k, Math.max(bins.get(k) ?? -Infinity, _v.y));
      }
    });
    const keys = [...bins.keys()].sort((a, b) => a - b);
    const k0 = keys[0];
    const n = keys[keys.length - 1] - k0 + 1;
    let h = new Float32Array(n).fill(NaN);
    for (const k of keys) h[k - k0] = bins.get(k);
    // fette vuote (fra una maglia e l'altra): interpolate
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(h[i])) continue;
      let a = i - 1;
      let b = i + 1;
      while (a >= 0 && Number.isNaN(h[a])) a--;
      while (b < n && Number.isNaN(h[b])) b++;
      h[i] = a < 0 ? h[b] : b >= n ? h[a] : h[a] + ((h[b] - h[a]) * (i - a)) / (b - a);
    }
    // si cammina sulle creste: massimo vicino, poi una media leggera
    const mx = h.map((_, i) => Math.max(h[Math.max(0, i - 1)], h[i], h[Math.min(n - 1, i + 1)]));
    h = mx.map((_, i) => (mx[Math.max(0, i - 1)] + 2 * mx[i] + mx[Math.min(n - 1, i + 1)]) / 4);
    return { z0: k0 * step, step, h, zMin: k0 * step, zMax: (k0 + n - 1) * step };
  }

  buildWalk() {
    const walk = new WalkArea({ stepTolerance: 1.6 });
    const holes = [];
    const R = this.bodyRadius;
    for (const id of ['virentia', 'celeste', 'sunset']) {
      const w = this.watches[id];
      const half = mm(10.5);
      const prof = this.watchProfile(w, half);
      w.profile = prof;
      const yaw = w.holder.rotation.y;
      const c = w.holder.position;
      const sn = Math.sin(yaw);
      const cs = Math.cos(yaw);
      const zc = (prof.zMin + prof.zMax) / 2;
      const len = (prof.zMax - prof.zMin) / 2;
      // centro del corridoio nel mondo (asse locale z ruotato di yaw)
      const cx = c.x + zc * sn;
      const cz = c.z + zc * cs;
      const floorFn = (x, z) => {
        const lz = (x - c.x) * sn + (z - c.z) * cs;
        const f = (lz - prof.z0) / prof.step;
        const i = Math.max(0, Math.min(prof.h.length - 1, Math.floor(f)));
        const j = Math.min(prof.h.length - 1, i + 1);
        const t = Math.max(0, Math.min(1, f - i));
        return prof.h[i] + (prof.h[j] - prof.h[i]) * t;
      };
      walk.rect(cx, cz, half - mm(2), len, 0, { rot: -yaw, floorFn, name: id });
      // nel tappetino: un foro un po' più stretto del bracciale (si sale e si scende dai lati e dalle
      // punte) e uno largo quanto la cassa (lì il bordo è un muro)
      holes.push({ x: cx, z: cz, hx: half - mm(2) - 0.4, hz: len - 0.9, rot: -yaw });
      holes.push({ x: c.x, z: c.z, hx: mm(23) + R, hz: mm(24) + R, rot: -yaw });
    }
    walk.rect(0, 0, mm(MAT.hx) - R - 0.3, mm(MAT.hz) - R - 0.3, 0, { holes, name: 'tappetino' });

    // attrezzi: ostacoli (capsule lungo l'asse dell'oggetto)
    const capsule = (L, x0, x1, r, h) => {
      const sn = Math.sin(L.yaw);
      const cs = Math.cos(L.yaw);
      const p = (lx) => [mm(L.x) + mm(lx) * cs, mm(L.z) - mm(lx) * sn];
      const [ax, az] = p(x0);
      const [bx, bz] = p(x1);
      walk.capsule(ax, az, bx, bz, mm(r), -1, mm(h));
    };
    capsule(LAYOUT.loupe, -13, 13, 19, 37);
    capsule(LAYOUT.tweezers, 0, 120, 5, 8);
    capsule(LAYOUT.screwdriver, -6, 101, 5.5, 10);
    capsule(LAYOUT.pencil, -88, 96, 4.5, 8);
    for (const { a, b, r = mm(42) } of this.rigContacts || []) walk.capsule(a.x, a.z, b.x, b.z, r, -1, mm(90));
    this.walk = walk;
  }

  // ------------------------------------------------------------------ ingresso e uscita

  enter(opts = {}) {
    super.enter(opts);
    const app = this.app;
    this.time = 0;
    this.attract = !!opts.attract;
    this.growing = false;
    this.grown = false;
    this.lookedUp = false;
    this.tickStopped = false;
    this.holdT = 0;
    this.skipLatch = false;
    this.wasPaused = false;
    this.arrivalT = this.attract ? 99 : 0;
    this.glance = {};
    this.nextGlance = { giovanni: 6, filippo: 9 };
    app.player.frozen = false;
    app.renderer.focusOverride = null;
    app.renderer.focusRangeOverride = null;
    app.renderer.postOverride = null;
    this.restoreFov();
    for (const k of Object.keys(this.hl)) this.hlSet[k](0);
    this.hl = {};
    for (const f of Object.values(this.founders)) f.setPose('leanDown', 0);
    app.ui.showSkip(false);
    app.ui.labEnd(false, 0);
    this.story.reset();
    if (!this.attract) this.story.start();
  }

  exit() {
    super.exit();
    const app = this.app;
    this.restoreFov();
    this.story.reset();
    app.player.frozen = false;
    app.renderer.focusOverride = null;
    app.renderer.focusRangeOverride = null;
    app.renderer.postOverride = null;
    app.ui.showSkip(false);
    app.ui.labEnd(false, 0);
    app.audio.duckMusic(1, 1);
  }

  restoreFov() {
    const cam = this.app.camera;
    if (this.baseFov && cam.fov !== this.baseFov) {
      cam.fov = this.baseFov;
      cam.updateProjectionMatrix();
    }
  }

  progressState() {
    const n = this.story?.sections.length || 6;
    const cur = Math.max(0, this.story?.section ?? 0);
    return { partKey: 'progress.lab.part', nameKey: 'progress.lab.name', total: n, done: [...Array(cur).keys()], current: cur };
  }

  // ------------------------------------------------------------------ eventi del racconto

  onSection() {
    this.app.ui.setProgress(this.progressState());
  }

  onLine(line, speakers = []) {
    // chi parla, ogni tanto, guarda l'altro; chi ascolta, ogni tanto, il visitatore
    for (const name of NAMES) this.nextGlance[name] = Math.min(this.nextGlance[name], this.story.elapsed + 3 + Math.random() * 5);
    // chi comincia a parlare alza appena le sopracciglia
    for (const s of speakers) this.founders[s]?.emphasize?.(1);
  }

  onHighlight(name, speakers) {
    if (!this.hlSet[name]) return;
    this.hl[name] = 0;
    const point = this.hlTargets[name];
    for (const s of speakers) {
      this.founders[s].gesture('pointDown');
      this.glance[s] = { point, until: this.story.elapsed + 2.8 };
    }
  }

  onGesture(speaker, gesture) {
    this.founders[speaker]?.gesture(gesture);
  }

  onTickStop() {
    this.tickStopped = true;
    this.app.audio.setTickEnabled(false);
  }

  onLookUp() {
    if (this.lookedUp) return;
    this.lookedUp = true;
    // "Anzi… aspetta": la sorpresa di vedere chi c'è davanti allo schermo
    for (const f of Object.values(this.founders)) {
      f.setPose('lookUp', 1.4);
      f.emphasize?.(1.3);
    }
    this.computeFinal(true);
  }

  onSkip() {
    for (const k of Object.keys(this.hl)) this.hlSet[k](0);
    this.hl = {};
  }

  // dove arriva la camera: ad altezza dei loro occhi, a distanza di conversazione (≈1,1 m)
  computeFinal(estimate = false) {
    const g = this.founders.giovanni.headWorld(new THREE.Vector3());
    const f = this.founders.filippo.headWorld(new THREE.Vector3());
    const mid = g.add(f).multiplyScalar(0.5);
    // appena alzano lo sguardo sono ancora chinati: si stima la testa già dritta
    if (estimate) {
      mid.y += 0.08 * M;
      mid.z -= 0.12 * M;
    }
    this.facesMid = mid;
    this.finalEye = new THREE.Vector3(0, mid.y, mid.z + FINAL.distance * M);
    // si guarda appena sotto gli occhi: i volti nel terzo alto, sotto il banco con le loro mani
    const look = mid.clone().setY(mid.y - FINAL.lookDrop * M);
    const m = new THREE.Matrix4().lookAt(this.finalEye, look, new THREE.Vector3(0, 1, 0));
    this.finalQ = new THREE.Quaternion().setFromRotationMatrix(m);
  }

  onGrowStart() {
    const cam = this.app.camera;
    this.app.player.frozen = true;
    this.growing = true;
    this.growK = 0;
    this.growFrom = { p: cam.position.clone(), q: cam.quaternion.clone() };
    this.baseFov = cam.fov;
    // a misura d'uomo gli orologi sono piccoli sullo schermo: il bagliore dei riflessi dell'acciaio li
    // avvolgerebbe tutti, quindi lo si abbassa mentre si sale (il Renderer ci arriva con dolcezza)
    this.app.renderer.postOverride = { bloom: 0.12, bloomThreshold: 1.0 };
    this.computeFinal();
    this.app.ui.showSkip(false);
  }

  onGrowProgress(k) {
    this.growK = k;
  }

  onGrowEnd() {
    this.growK = 1;
    this.grown = true;
  }

  onThanks(seconds) {
    this.app.ui.labEnd('white', seconds);
  }

  onCard() {
    this.app.ui.labEnd('card');
  }

  onFinish() {
    this.app.director.goTo('epilogue', { fromLab: true });
  }

  // ------------------------------------------------------------------ fotogramma

  gazeTarget(name) {
    if (this.attract) return _w.set(0, mm(10), mm(20));
    if (this.lookedUp && this.finalEye) return this.finalEye;
    const st = this.story;
    const g = this.glance[name];
    if (g && g.until > st.elapsed) return g.point;
    const other = name === 'giovanni' ? 'filippo' : 'giovanni';
    const sp = st.speakers;
    const listening = sp.length > 0 && !sp.includes(name);
    // un'occhiata ogni tanto: chi parla verso l'altro, chi ascolta verso il visitatore
    if (st.elapsed > this.nextGlance[name] && st.phase === 'line') {
      this.nextGlance[name] = st.elapsed + 6 + Math.random() * 5;
      this.glance[name] = listening
        ? { point: this.app.camera.position.clone(), until: st.elapsed + 1.8 }
        : { point: this.founders[other].headWorld(new THREE.Vector3()), until: st.elapsed + 1.3 };
      return this.glance[name].point;
    }
    if (listening) return this.founders[other].headWorld(this._gaze[name]);
    return this.app.camera.position;
  }

  update(dt) {
    super.update(dt);
    const app = this.app;
    const cam = app.camera;
    const paused = app.pauseShown;
    if (paused !== this.wasPaused) {
      this.story.setPaused(paused);
      this.wasPaused = paused;
    }
    const sdt = paused ? 0 : dt;

    this.story.update(sdt);

    // fondatori: voce, sguardo, posa
    const thanks = this.story.line?.event === 'thanks' && this.story.phase !== 'gap';
    for (const name of NAMES) {
      // il sorriso aperto solo per il "Grazie"; a misura d'uomo, mentre ascoltano, appena più caldo
      const f = this.founders[name];
      const e = f.caps?.smileTeeth ? EXPRESSION.v3 : EXPRESSION.v2;
      const smile = thanks ? e.thanks : this.grown ? e.listen : e.smile;
      f.update(sdt, { talk: this.story.talkOf(name), gaze: this.gazeTarget(name), smile, teeth: thanks ? e.teeth : 0, lid: e.lid });
    }

    // oggetti che si accendono (circa 8 s, poi si spengono)
    for (const [name, t] of Object.entries(this.hl)) {
      const nt = t + sdt;
      this.hl[name] = nt;
      const v = clamp01(nt / 0.9) * (1 - clamp01((nt - 8) / 1.6));
      this.hlSet[name](v * v * (3 - 2 * v));
      if (nt > 9.6) {
        this.hlSet[name](0);
        delete this.hl[name];
      }
    }

    // orologi all'ora vera
    const now = new Date();
    for (const w of Object.values(this.watches)) w.setTime(now);

    // la luce che svanisce dal fondello: il visitatore è appena uscito da lì
    if (this.arrivalT < 30) {
      this.arrivalT += sdt;
      const k = Math.max(0, 1 - this.arrivalT / 7);
      const e = k * k;
      this.arrivalParts.shaft.material.uniforms.uIntensity.value = 0.55 * e;
      this.arrivalParts.shaft.material.uniforms.uTime.value = this.time;
      this.arrivalParts.glow.material.opacity = 0.5 * e;
      this.arrivalLight.intensity = 260 * e;
      if (this.movementMat) this.movementMat.emissiveIntensity = 1.5 * e;
    }

    // il tic viene dalla Virentia: più vicino, più presente
    if (!this.tickStopped && !this.attract) {
      const vp = this.watches.virentia.holder.position;
      const d = cam.position.distanceTo(vp);
      _v.subVectors(vp, cam.position);
      const right = _w.set(1, 0, 0).applyQuaternion(cam.quaternion);
      app.audio.setTickPresence(0.08 + 0.2 * Math.exp(-d / 60), THREE.MathUtils.clamp(_v.dot(right) / Math.max(1, d), -0.7, 0.7));
    }

    // tenere premuto per saltare (dopo una decina di secondi)
    const canSkip = !this.attract && this.story.running && app.director.state === 'play' && !paused && this.story.elapsed > 10 && !this.growing;
    app.ui.showSkip(canSkip || (this.story.phase === 'card' && !paused));
    const held = app.input.actionHeld;
    if ((canSkip || this.story.phase === 'card') && held && !this.skipLatch) {
      this.holdT += dt;
      if (this.holdT >= 1.5) {
        this.holdT = 0;
        this.skipLatch = true;
        this.story.skip();
      }
    } else if (!held) {
      this.holdT = 0;
      this.skipLatch = false;
    }
    app.ui.setSkipProgress(this.holdT / 1.5);

    // "torna grande": la camera si stacca dal corpo piccolo e sale fino ai loro occhi
    if (this.growing) {
      const k = this.growK;
      const e = ease(k);
      const up = ease(Math.min(1, k * 1.25)); // prima si sale, poi ci si allontana
      const from = this.growFrom.p;
      const to = this.finalEye;
      cam.position.set(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * up, from.z + (to.z - from.z) * e);
      cam.quaternion.slerpQuaternions(this.growFrom.q, this.finalQ, e);
      const fov = this.baseFov + (FINAL.fov - this.baseFov) * e;
      if (Math.abs(cam.fov - fov) > 0.01) {
        cam.fov = fov;
        cam.updateProjectionMatrix();
      }
      if (this.grown) {
        // a misura d'uomo: il respiro di chi guarda, appena percettibile
        cam.position.y += Math.sin((this.time / 4.8) * Math.PI * 2) * 0.35;
      }
      // la profondità di campo si apre su entrambi i volti
      app.renderer.focusOverride = cam.position.distanceTo(this.facesMid);
      // a fine salita volti nitidi e banco appena morbido: niente aloni sui riflessi dell'acciaio
      app.renderer.focusRangeOverride = 60 + 330 * e;
    }

    this.dust.update(dt, cam);
  }
}
