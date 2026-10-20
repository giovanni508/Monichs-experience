import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { glowSprite } from '../../gfx/effects.js';

// ---------------------------------------------------------------------------------------------
// Giovanni e Filippo dietro il banco.
//
// FounderRig  — il modello 3D ricavato dalle foto (public/assets/models/founder-*.glb), con il
//               contratto della specifica (§4): ossa, shape key e clip dai nomi esatti; 1 unità = 1 m,
//               origine al centro del bacino sul piano del sedile, sguardo verso +Z. Qui sopra si
//               aggiungono lo sguardo procedurale (testa, collo, occhi), il battito delle palpebre, la
//               bocca guidata dalla voce e i gesti.
// FounderPresence — il segnaposto finché il modello non c'è: una presenza calda e sfocata, una
//               sagoma senza volto (mai un volto inventato) che si china, si raddrizza e "respira"
//               con la voce.
// Entrambi espongono la stessa interfaccia: object, update(), setPose(), gesture(), headWorld().
// ---------------------------------------------------------------------------------------------

const BONES = ['spine', 'chest', 'neck', 'head', 'eye.L', 'eye.R', 'jaw', 'shoulder.L', 'shoulder.R', 'upper_arm.L', 'upper_arm.R', 'forearm.L', 'forearm.R', 'hand.L', 'hand.R'];
const GESTURES = ['explain', 'pointDown', 'nod'];
const FWD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);
// quanto le palpebre seguono gli occhi che guardano in basso: con la v2.2b poco (oltre si vede il bulbo
// tra le ciglia), con blinkHalf (v3) le chiusure parziali sono pulite
const LID_FOLLOW = 0.08;
const LID_FOLLOW_HALF = 0.15;
const X_AXIS = new THREE.Vector3(1, 0, 0);
const DEG = Math.PI / 180;
const _q = new THREE.Quaternion();
const _qf = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _id = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _e = new THREE.Vector3();
const _t = new THREE.Vector3();

const loader = new GLTFLoader();

/** Carica il modello di un fondatore; null se il file non c'è o non si legge. */
export function loadFounder(url) {
  return new Promise((resolve) => {
    loader.load(url, (gltf) => resolve(gltf), undefined, () => resolve(null));
  });
}

// ---------------------------------------------------------------------------------------------
// Modello 3D
// ---------------------------------------------------------------------------------------------

export class FounderRig {
  constructor(gltf, { seed = 1 } = {}) {
    this.object = gltf.scene;
    this.isRig = true;
    this.bones = {};
    this.object.traverse((o) => {
      // GLTFLoader toglie i punti dai nomi ("eye.L" → "eyeL"); il nome originale resta in userData
      const raw = o.userData?.name || o.name;
      for (const n of BONES) if (raw === n || o.name === n.replace(/\./g, '')) this.bones[n] = this.bones[n] || o;
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false; // i volumi animati escono dai bordi calcolati sulla posa di riposo
      }
    });
    this.morphMeshes = [];
    this.object.traverse((o) => {
      if (o.isMesh && o.morphTargetDictionary) this.morphMeshes.push(o);
    });
    // cosa sa fare il modello: la v3 ha chiusure parziali pulite delle palpebre (blinkHalf), il sorriso
    // a labbra chiuse con i denti a parte (smileTeeth) e le sopracciglia; con la v2.2b tutto resta com'era
    const morphs = new Set(this.morphMeshes.flatMap((m) => Object.keys(m.morphTargetDictionary)));
    this.caps = { blinkHalf: morphs.has('blinkHalf.L'), smileTeeth: morphs.has('smileTeeth'), browUp: morphs.has('browUp') };
    // occhi opachi (la v3, per togliere l'effetto biglia): sopra, uno strato lucido sottile come la
    // cornea, che dà il piccolo riflesso degli occhi vivi
    this.object.traverse((o) => {
      const src = o.isMesh && o.material;
      if (!src || !/^eye_[LR]$/.test(src.name) || src.roughness < 0.6) return;
      const m = new THREE.MeshPhysicalMaterial();
      THREE.MeshStandardMaterial.prototype.copy.call(m, src);
      m.defines = { STANDARD: '', PHYSICAL: '' };
      m.clearcoat = 1;
      m.clearcoatRoughness = 0.06;
      o.material = m;
    });
    // pose di riposo (relative alla radice) per lo sguardo
    this.object.updateMatrixWorld(true);
    this.object.getWorldQuaternion(_qr).invert();
    this.rest = {};
    this.base = {};
    for (const n of ['neck', 'head', 'eye.L', 'eye.R']) {
      const b = this.bones[n];
      if (!b) continue;
      this.rest[n] = _qr.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion()));
      this.base[n] = b.quaternion.clone();
    }

    // clip: la posa del racconto e quella finale come basi, i gesti sopra, il respiro additivo
    this.mixer = new THREE.AnimationMixer(this.object);
    this.actions = {};
    for (const clip of gltf.animations || []) {
      const name = clip.name;
      if (name === 'idle') {
        // su una copia: l'esportatore di Blender riusa gli stessi dati per le chiavi costanti di tutte
        // le clip, e makeClipAdditive modifica la clip sul posto (azzererebbe scala e posizione delle
        // ossa anche in leanDown, lookUp e nei gesti)
        const add = THREE.AnimationUtils.makeClipAdditive(clip.clone());
        const a = this.mixer.clipAction(add);
        a.blendMode = THREE.AdditiveAnimationBlendMode;
        a.play();
        this.actions.idle = a;
        continue;
      }
      const a = this.mixer.clipAction(clip);
      if (name === 'lookUp' || GESTURES.includes(name)) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = name === 'lookUp';
      }
      this.actions[name] = a;
    }
    this.pose = null;
    this.gestures = []; // { action, start, end, out, outDur }: i gesti in corso o in uscita
    this.gestureMix = 0;
    this.time = 0;
    this.rand = mulberry(seed);
    this.nextBlink = 1 + this.rand() * 3;
    this.lastBlink = -10;
    this.blink = 0;
    this.mouth = 0;
    this.vowelMix = { a: 1, e: 0, o: 0 };
    this.gaze = null;
    this.gazeWeight = 0;
    // gli occhi hanno un punto tutto loro: saltano (saccadi) invece di scivolare con la testa
    this.eyeGaze = null;
    this.saccade = null;
    this.micro = new THREE.Vector3();
    this.nextMicro = 0;
    this.smile = 0.1;
    this.teeth = 0;
    this.brow = 0;
    this.browPulse = 0;
    this.talkEnv = 0;
    // dita (v3): la prima falange di ogni dito, tranne il pollice, per i piccoli movimenti sul banco
    this.fingers = [];
    this.object.traverse((o) => {
      const m = o.isBone && /^(index|middle|ring|pinky)\.01\.[LR]$/.exec(o.userData?.name || o.name);
      if (m) this.fingers.push({ bone: o, name: m[1], phase: this.rand() * 6.3, speed: 0.3 + this.rand() * 0.3, tap: 0 });
    });
    this.fingerWeight = 1;
    this.nextTap = 2 + this.rand() * 3;
  }

  /** Mani e avambracci a contatto col banco nella posa del racconto (metri, nel sistema del modello). */
  benchContact() {
    if (this.actions.leanDown) {
      this.actions.leanDown.reset().play();
      this.mixer.update(0);
    }
    this.object.updateMatrixWorld(true);
    const inv = this.object.matrixWorld.clone().invert();
    const get = (n) => (this.bones[n] ? this.bones[n].getWorldPosition(new THREE.Vector3()).applyMatrix4(inv) : null);
    return { handL: get('hand.L'), handR: get('hand.R'), foreL: get('forearm.L'), foreR: get('forearm.R'), ...this.handsLowest(inv) };
  }

  /**
   * I vertici di ciascuna mano nella posa corrente (palmo, polpastrelli): quelli legati soprattutto
   * all'osso della mano o a quelli delle dita, se il modello li ha, deformati come in scena e portati
   * nel sistema `inv` (l'identità: nel mondo). { L: [Vector3], R: [Vector3] }
   */
  handVertices(inv = new THREE.Matrix4()) {
    const side = new Map();
    for (const s of ['L', 'R']) this.bones[`hand.${s}`]?.traverse((b) => b.isBone && side.set(b, s));
    const out = { L: [], R: [] };
    this.object.traverse((o) => {
      const g = o.isSkinnedMesh && o.geometry;
      if (!g || !g.attributes.skinIndex || !g.attributes.skinWeight) return;
      const { position: pos, skinIndex: si, skinWeight: sw } = g.attributes;
      for (let i = 0; i < pos.count; i++) {
        let w = 0;
        let bi = -1;
        for (let k = 0; k < 4; k++) {
          const wk = sw.getComponent(i, k);
          if (wk > w) {
            w = wk;
            bi = si.getComponent(i, k);
          }
        }
        const s = w >= 0.5 && side.get(o.skeleton.bones[bi]);
        if (!s) continue;
        out[s].push(o.applyBoneTransform(i, new THREE.Vector3().fromBufferAttribute(pos, i)).applyMatrix4(o.matrixWorld).applyMatrix4(inv));
      }
    });
    return out;
  }

  /** Il punto più basso di ciascuna mano nella posa corrente: { lowL, lowR } nel sistema `inv`, null se mancano. */
  handsLowest(inv) {
    const v = this.handVertices(inv);
    const low = (pts) => (pts.length ? pts.reduce((m, p) => Math.min(m, p.y), Infinity) : null);
    return { lowL: low(v.L), lowR: low(v.R) };
  }

  /**
   * Quanto arriva ciascuna mano posata, nel mondo: dal polso al centro dei polpastrelli (la media dei
   * vertici più lontani dal polso, sul piano del banco). { L: { wrist, tip }, R: … }
   */
  handReach() {
    const v = this.handVertices();
    const out = {};
    for (const s of ['L', 'R']) {
      const hand = this.bones[`hand.${s}`];
      if (!hand || !v[s].length) continue;
      const wrist = hand.getWorldPosition(new THREE.Vector3());
      const d = (p) => Math.hypot(p.x - wrist.x, p.z - wrist.z);
      const far = v[s].reduce((m, p) => Math.max(m, d(p)), 0);
      const tips = v[s].filter((p) => d(p) > far * 0.85);
      const tip = tips.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / tips.length);
      out[s] = { wrist, tip };
    }
    return out;
  }

  setPose(name, fade = 1.2) {
    if (this.pose === name) return;
    const next = this.actions[name];
    const prev = this.pose && this.actions[this.pose];
    this.pose = name;
    if (!next) return;
    next.reset();
    next.setEffectiveWeight(1);
    next.play();
    if (prev && prev !== next) prev.crossFadeTo(next, fade, false);
    else next.fadeIn(fade);
    // i gesti nascono e finiscono nella posa del racconto: cambiando posa escono subito
    for (const g of this.gestures) {
      if (g.out < 0) {
        g.out = this.time;
        g.outDur = 0.35;
      }
    }
  }

  gesture(name) {
    const a = this.actions[name];
    // i gesti partono e finiscono nella posa del racconto: dopo lookUp riporterebbero giù il busto
    if (!a || this.pose !== 'leanDown') return;
    // quello in corso esce in fretta, il nuovo entra (i pesi li dà updateGestures)
    for (const g of this.gestures) {
      if (g.out < 0) {
        g.out = this.time;
        g.outDur = 0.35;
      }
    }
    this.gestures = this.gestures.filter((g) => g.action !== a);
    a.reset();
    a.setEffectiveWeight(0);
    a.play();
    this.gestures.push({ action: a, start: this.time, end: this.time + Math.max(0.6, a.getClip().duration - 0.4), out: -1, outDur: 0.5 });
  }

  // Gesti sopra la posa del racconto, che resta a peso 1: un gesto entra in 0,35 s ed esce in 0,5 s. Il
  // mixer fa la media pesata delle clip, quindi con peso m/(1−m) il gesto vale esattamente m, fino a
  // sostituire la posa (a pesi pari valeva la metà, e una mano che indica, con il polso a metà strada,
  // entrava di 5 cm nel banco). Il peso totale non scende mai sotto 1: sotto, il mixer mescolerebbe la
  // posa di riposo, a braccia giù.
  updateGestures() {
    let mix = 0;
    this.gestures = this.gestures.filter((g) => {
      if (g.out < 0 && this.time > g.end) g.out = this.time;
      const ease = (k) => k * k * (3 - 2 * k);
      const fin = ease(Math.min(1, (this.time - g.start) / 0.35));
      const fout = g.out < 0 ? 1 : ease(Math.max(0, 1 - (this.time - g.out) / g.outDur));
      const m = Math.min(fin, fout);
      if (g.out >= 0 && m <= 0) {
        g.action.stop();
        return false;
      }
      g.action.setEffectiveWeight(m >= 0.999 ? 999 : m / (1 - m));
      mix = Math.max(mix, m);
      return true;
    });
    this.gestureMix = mix;
  }

  setMorph(name, value) {
    for (const m of this.morphMeshes) {
      const i = m.morphTargetDictionary[name];
      if (i !== undefined) m.morphTargetInfluences[i] = value;
    }
  }

  headWorld(out = new THREE.Vector3()) {
    const b = this.bones['eye.L'] && this.bones['eye.R'] ? null : this.bones.head;
    if (b) return b.getWorldPosition(out);
    if (this.bones['eye.L']) {
      this.bones['eye.L'].getWorldPosition(out);
      return out.add(this.bones['eye.R'].getWorldPosition(_w)).multiplyScalar(0.5);
    }
    return this.object.getWorldPosition(out);
  }

  // Ruota un osso perché guardi verso `target` (punto nel mondo), con un angolo massimo e un peso
  aim(name, target, maxAngle, weight) {
    const bone = this.bones[name];
    const rest = this.rest[name];
    if (!bone || !rest || weight <= 0) return;
    bone.updateWorldMatrix(true, false);
    bone.getWorldQuaternion(_q);
    bone.getWorldPosition(_p);
    this.object.getWorldQuaternion(_qr);
    // dove guarda adesso: l'avanti della posa di riposo, ruotato come l'osso rispetto al riposo
    _q2.copy(_qr).multiply(rest).invert().premultiply(_q);
    _v.copy(FWD).applyQuaternion(_qr).applyQuaternion(_q2).normalize();
    _w.copy(target).sub(_p).normalize();
    const full = new THREE.Quaternion().setFromUnitVectors(_v, _w);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(full.w)));
    const k = (angle > maxAngle ? maxAngle / angle : 1) * weight;
    _q.premultiply(_id.clone().slerp(full, k));
    bone.parent.getWorldQuaternion(_qp).invert();
    bone.quaternion.copy(_qp.multiply(_q));
    bone.updateMatrixWorld(true);
  }

  startBlink() {
    this.blink = 0.001;
    this.lastBlink = this.time;
    this.nextBlink = this.time + 3 + this.rand() * 3;
  }

  // Palpebre chiuse di b (0..1). Con blinkHalf (v3) le chiusure parziali passano per la forma
  // intermedia, che segue il bulbo: fino a metà solo blinkHalf, poi da blinkHalf a blink.
  setLids(b) {
    const half = this.caps.blinkHalf;
    for (const s of ['L', 'R']) {
      this.setMorph(`blink.${s}`, half ? Math.max(0, 2 * b - 1) : b);
      if (half) this.setMorph(`blinkHalf.${s}`, b <= 0.5 ? 2 * b : 2 * (1 - b));
    }
  }

  /** Enfasi (inizio di una battuta, sorpresa): le sopracciglia si alzano e tornano giù. */
  emphasize(k = 1) {
    this.browPulse = Math.max(this.browPulse, k);
  }

  // Dita: piccoli movimenti della prima falange, solo verso l'alto: verso il palmo i polpastrelli
  // affonderebbero nel banco (+10° li alza di circa 9 mm, −10° li abbassa di 11). Ogni dito ogni tanto
  // si solleva appena e torna giù; ogni tanto uno batte piano, più spesso mentre si parla. Durante i
  // gesti restano come nella clip.
  moveFingers(dt, talking) {
    // la posa della clip, da ripristinare prima del prossimo aggiornamento del mixer
    for (const f of this.fingers) (f.clean ||= new THREE.Quaternion()).copy(f.bone.quaternion);
    this.fingerWeight += (1 - this.gestureMix - this.fingerWeight) * (1 - Math.exp(-dt * 6));
    if (this.fingerWeight < 0.01) return;
    if (this.time > this.nextTap) {
      const f = this.fingers[Math.floor(this.rand() * this.fingers.length)];
      if (f.name === 'index' || f.name === 'middle' || this.rand() < 0.3) f.tap = 0.001;
      this.nextTap = this.time + (talking ? 1.6 + this.rand() * 3 : 5 + this.rand() * 7);
    }
    for (const f of this.fingers) {
      const s = Math.sin(this.time * f.speed + f.phase);
      let deg = s > 0 ? 3 * s * s : 0;
      if (f.tap > 0) {
        f.tap += dt;
        const k = f.tap / 0.32;
        deg += 10 * Math.sin(Math.min(1, k) * Math.PI);
        if (k >= 1) f.tap = 0;
      }
      if (deg > 0) f.bone.quaternion.multiply(_qf.setFromAxisAngle(X_AXIS, deg * DEG * this.fingerWeight));
    }
  }

  // Occhi: fissano un punto e quando il punto cambia ci saltano (saccade: circa 40 ms per 10°, 80 per
  // 30°); un punto che si muove piano, come il visitatore che cammina, lo seguono senza scatti; ogni
  // tanto una microsaccade di frazioni di grado. Un occhio che scivola lento sembra di una bambola.
  moveEyes(dt, target) {
    const from = this.headWorld(_e);
    if (this.time > this.nextMicro) {
      this.micro.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(from.distanceTo(target) * 0.015);
      this.nextMicro = this.time + 0.6 + this.rand() * 1.6;
      if (this.eyeGaze && !this.saccade) this.saccade = { from: this.eyeGaze.clone(), t: 0, dur: 0.025 };
    }
    const goal = _t.copy(target).add(this.micro);
    if (!this.eyeGaze) {
      this.eyeGaze = goal.clone();
      return;
    }
    const angle = _v.subVectors(this.eyeGaze, from).angleTo(_w.subVectors(goal, from));
    if (!this.saccade && angle > 0.06) {
      this.saccade = { from: this.eyeGaze.clone(), t: 0, dur: 0.02 + angle * 0.13 };
      // sui salti grandi le palpebre battono insieme agli occhi
      if (angle > 0.3 && this.blink === 0 && this.time - this.lastBlink > 1.2 && this.rand() < 0.6) this.startBlink();
    }
    if (this.saccade) {
      const s = this.saccade;
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      this.eyeGaze.lerpVectors(s.from, goal, 1 - (1 - k) * (1 - k));
      if (k >= 1) this.saccade = null;
    } else this.eyeGaze.lerp(goal, 1 - Math.exp(-dt * 12));
  }

  // Quanto gli occhi guardano in basso rispetto alla testa (radianti, 0 se guardano dritto o in alto)
  eyesDown() {
    const head = this.bones.head;
    if (!head || !this.eyeGaze || !this.rest.head) return 0;
    head.getWorldQuaternion(_q);
    this.object.getWorldQuaternion(_qr);
    _q2.copy(_qr).multiply(this.rest.head).invert().premultiply(_q);
    const up = _v.copy(UP).applyQuaternion(_qr).applyQuaternion(_q2);
    const dir = _w.subVectors(this.eyeGaze, this.headWorld(_e)).normalize();
    return Math.min(0.38, Math.max(0, -Math.asin(THREE.MathUtils.clamp(dir.dot(up), -1, 1))));
  }

  /**
   * talk: { level 0..1, vowel 'a'|'e'|'i'|'o'|'u' }; gaze: punto nel mondo (o null); smile 0..1 (a
   * labbra chiuse, se il modello ha smileTeeth); teeth 0..1: il sorriso con i denti; lid: palpebre a
   * riposo, appena abbassate (0 = aperte come nel modello). dt = 0 in pausa: tutto fermo.
   */
  update(dt, { talk = null, gaze = null, smile = 0.1, teeth = 0, lid = 0 } = {}) {
    if (dt <= 0) return;
    this.time += dt;
    this.updateGestures();
    // lo sguardo si ricalcola ogni volta dalla posa (le clip che non muovono testa e occhi non le
    // riportano indietro: senza questo le correzioni si sommerebbero fotogramma dopo fotogramma). Lo
    // stesso per le dita: il mixer riscrive un osso solo se il valore della clip cambia, quindi prima
    // tornano come le aveva lasciate la clip
    for (const [n, q] of Object.entries(this.base)) this.bones[n].quaternion.copy(q);
    for (const f of this.fingers) if (f.clean) f.bone.quaternion.copy(f.clean);
    this.mixer.update(dt);

    // sguardo: testa e collo seguono il punto con dolcezza, gli occhi ci saltano (moveEyes)
    if (gaze) {
      if (!this.gaze) this.gaze = gaze.clone();
      this.gaze.lerp(gaze, 1 - Math.exp(-dt * 3.2));
      this.gazeWeight += (1 - this.gazeWeight) * (1 - Math.exp(-dt * 2));
      this.moveEyes(dt, gaze);
    } else this.gazeWeight *= Math.exp(-dt * 2);
    if (this.gaze && this.gazeWeight > 0.01) {
      this.aim('neck', this.gaze, 0.5, 0.4 * this.gazeWeight);
      this.aim('head', this.gaze, 0.75, 0.75 * this.gazeWeight);
      this.aim('eye.L', this.eyeGaze, 0.38, this.gazeWeight);
      this.aim('eye.R', this.eyeGaze, 0.38, this.gazeWeight);
    }
    if (this.fingers.length) this.moveFingers(dt, !!talk);

    // palpebre: a riposo come vuole il modello (lid), scendono con gli occhi che guardano in basso
    // (altrimenti sopra l'iride resta una striscia di bianco: lo sguardo spiritato); un battito ogni 3–6 s
    if (this.time > this.nextBlink) this.startBlink();
    let b = 0;
    if (this.blink > 0) {
      this.blink += dt;
      const k = this.blink / 0.16;
      b = k < 0.5 ? k * 2 : Math.max(0, 2 - k * 2);
      if (k >= 1) this.blink = 0;
    }
    const follow = this.caps.blinkHalf ? LID_FOLLOW_HALF : LID_FOLLOW;
    const rest = lid + Math.min(follow, this.eyesDown() * 0.5) * this.gazeWeight;
    this.setLids(rest + (1 - rest) * b);

    // bocca: apertura dal volume della voce, forma dalla vocale; un movimento leggero, mai frenetico
    const level = talk ? talk.level : 0;
    this.mouth += (level - this.mouth) * (1 - Math.exp(-dt * 18));
    const m = Math.min(1, this.mouth);
    const v = talk?.vowel || 'a';
    // la forma passa da una vocale all'altra in circa 70 ms (di colpo, a bocca aperta, la mandibola
    // scatterebbe di qualche grado: le vocali la ruotano diversamente); l'apertura resta pronta
    const w = this.vowelMix;
    const kv = 1 - Math.exp(-dt * 14);
    w.a += ((v === 'a' ? 1 : 0) - w.a) * kv;
    w.e += ((v === 'e' || v === 'i' ? 1 : 0) - w.e) * kv;
    w.o += ((v === 'o' || v === 'u' ? 1 : 0) - w.o) * kv;
    this.setMorph('jawOpen', m * 0.5);
    this.setMorph('mouthA', m * 0.55 * w.a);
    this.setMorph('mouthE', m * 0.5 * w.e);
    this.setMorph('mouthO', m * 0.55 * w.o);
    this.setMorph('mouthMBP', talk && level < 0.05 ? 0.12 : 0);
    const ks = 1 - Math.exp(-dt * 2);
    this.smile += (smile - this.smile) * ks;
    this.teeth += (teeth - this.teeth) * ks;
    if (this.caps.smileTeeth) {
      this.setMorph('smile', this.smile);
      this.setMorph('smileTeeth', this.teeth);
    } else this.setMorph('smile', Math.min(1, this.smile + this.teeth));

    // sopracciglia (v3): si alzano all'inizio di una battuta e nella sorpresa, poi tornano giù; mentre si
    // parla seguono appena la voce
    if (this.caps.browUp) {
      this.browPulse *= Math.exp(-dt * 1.6);
      this.talkEnv += (level - this.talkEnv) * (1 - Math.exp(-dt * 3));
      const target = Math.min(1, 0.4 * this.browPulse + 0.12 * this.talkEnv);
      this.brow += (target - this.brow) * (1 - Math.exp(-dt * 8));
      this.setMorph('browUp', this.brow);
    }
  }
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// Segnaposto: una presenza calda, una sagoma senza volto
// ---------------------------------------------------------------------------------------------

const presenceVert = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vH = (modelMatrix * vec4(position, 1.0)).y;
  gl_Position = projectionMatrix * mv;
}`;
const presenceFrag = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uTalk;
uniform float uOpacity;
uniform float uBase;
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  // densa al centro e trasparente verso il contorno: una figura di luce, senza bordi netti
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float body = smoothstep(0.05, 0.9, facing);
  vec3 c = mix(uColor, uCore, body * 0.55) * (0.9 + uTalk * 0.45);
  float a = pow(body, 1.6) * 0.42 * uOpacity;
  a *= smoothstep(uBase - 2.0, uBase + 18.0, vH); // svanisce sulla linea del banco
  gl_FragColor = vec4(c, a);
}`;

export class FounderPresence {
  /** color: il bordo di luce; core: il colore della sagoma (abiti: dolcevita nero, camicia bianca). */
  constructor({ color, core, seed = 1 }) {
    this.isRig = false;
    this.object = new THREE.Group();
    this.uniforms = {
      uColor: { value: new THREE.Color(color) },
      uCore: { value: new THREE.Color(core) },
      uTalk: { value: 0 },
      uOpacity: { value: 1 },
      uBase: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: presenceVert, fragmentShader: presenceFrag, transparent: true, depthWrite: false });
    // misure in metri, come il modello vero: bacino sul sedile, busto, collo, testa
    this.torso = new THREE.Group();
    this.object.add(this.torso);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.26, 8, 28), mat);
    body.scale.set(1.42, 1, 0.8);
    body.position.y = 0.33;
    this.torso.add(body);
    this.neck = new THREE.Group();
    this.neck.position.y = 0.6;
    this.torso.add(this.neck);
    const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.07, 6, 20), mat);
    neck.position.y = 0.01;
    this.neck.add(neck);
    this.head = new THREE.Group();
    this.head.position.y = 0.08;
    this.neck.add(this.head);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 36, 24), mat);
    head.scale.set(0.9, 1.15, 1.0);
    head.position.y = 0.08;
    this.head.add(head);
    this.eyes = new THREE.Object3D(); // punto degli occhi (senza occhi disegnati)
    this.eyes.position.set(0, 0.1, 0.07);
    this.head.add(this.eyes);
    this.halo = glowSprite(color, 1.7, 0.2);
    this.halo.position.set(0, 0.5, -0.05);
    this.torso.add(this.halo);
    for (const o of [body, neck, head]) {
      o.userData.noSSR = true;
      o.renderOrder = 3;
    }
    this.lean = 1;
    this.leanTarget = 1;
    this.talk = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.time = seed * 1.7;
    this.nodT = -1;
  }

  setPose(name) {
    this.leanTarget = name === 'leanDown' ? 1 : 0;
  }

  gesture(name) {
    if (name === 'nod') this.nodT = 0;
  }

  headWorld(out = new THREE.Vector3()) {
    return this.eyes.getWorldPosition(out);
  }

  update(dt, { talk = null, gaze = null } = {}) {
    if (dt <= 0) return;
    this.time += dt;
    this.lean += (this.leanTarget - this.lean) * (1 - Math.exp(-dt * 1.6));
    const breath = Math.sin((this.time / 4.6) * Math.PI * 2);
    this.torso.rotation.x = 0.05 + this.lean * 0.3 + breath * 0.006;
    this.torso.scale.setScalar(1 + breath * 0.006);
    // la testa segue lo sguardo (girata verso chi ascolta, chinata verso il banco)
    let yaw = 0;
    let pitch = this.lean * 0.2;
    if (gaze) {
      this.head.getWorldPosition(_p);
      this.object.getWorldQuaternion(_q).invert();
      _v.copy(gaze).sub(_p).applyQuaternion(_q);
      yaw = THREE.MathUtils.clamp(Math.atan2(_v.x, _v.z), -0.7, 0.7);
      pitch = THREE.MathUtils.clamp(-Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -0.3, 0.6) - this.torso.rotation.x;
    }
    if (this.nodT >= 0) {
      this.nodT += dt;
      pitch += Math.sin(Math.min(1, this.nodT / 0.9) * Math.PI * 2) * 0.12;
      if (this.nodT > 0.9) this.nodT = -1;
    }
    const k = 1 - Math.exp(-dt * 3);
    this.yaw += (yaw - this.yaw) * k;
    this.pitch += (pitch - this.pitch) * k;
    this.head.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    // la voce scalda la presenza
    const level = talk ? talk.level : 0;
    this.talk += (level - this.talk) * (1 - Math.exp(-dt * 10));
    this.uniforms.uTalk.value = this.talk;
    this.halo.material.opacity = 0.16 + this.talk * 0.12 + breath * 0.02;
  }
}
