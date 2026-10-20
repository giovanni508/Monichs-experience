import * as THREE from 'three';

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _d = new THREE.Vector3();

/**
 * Interfaccia comune dei mondi.
 * - load(progress)   costruisce geometrie e materiali, carica le texture
 * - enter(opts)      chiamato a schermo nero: posiziona il giocatore, avvia narrazione
 * - update(dt, t)    animazioni
 * - exit()           pulizia leggera (le risorse restano in memoria per rientri rapidi)
 * - walk             WalkArea: dove si cammina (pavimenti, ostacoli). Senza, la camera fluttua
 *                    nel "tubo" morbido del percorso (constrain).
 */
export class World {
  constructor(app, id) {
    this.app = app;
    this.id = id;
    this.scene = new THREE.Scene();
    this.hotspots = [];
    this.loaded = false;
    this.active = false;
    this.post = {};
    this.audioPalette = id;
    this.tickTimbre = 'crisp';
    this.tickPresence = 0.5;
    this.tickEnabled = true; // false nei mondi senza tic (schermata iniziale, epilogo)
    this.speedScale = 1;
    this.spawn = { position: new THREE.Vector3(0, 2, 10), yaw: 0, pitch: 0 };
    this.attractShots = [];
    this.time = 0;
    this.path = null; // { points: Vector3[], radius, vRadius } — guida (lucciola)
    this.walk = null; // WalkArea
    this.eyeHeight = 3.2; // altezza degli occhi sul pavimento: si è piccoli
    this.bodyRadius = 0.55;
  }

  // Punto ad altezza d'occhi (+ lift) sul calpestabile più vicino a (x, z), al livello più vicino a yRef
  walkEye(x, z, yRef = 0, lift = 0) {
    if (!this.walk) return new THREE.Vector3(x, yRef + this.eyeHeight + lift, z);
    const q = { x, z, y: yRef };
    const f = this.walk.settle(q, this.bodyRadius);
    return new THREE.Vector3(q.x, (f ?? yRef) + this.eyeHeight + lift, q.z);
  }

  // Porta un punto sul calpestabile più vicino e lo alza di `height` sul pavimento (portali, guide)
  placeOnWalk(p, { height = this.eyeHeight, radius = 1.2, yRef = null } = {}) {
    if (!this.walk) return p;
    const q = { x: p.x, z: p.z, y: yRef ?? this.app.player.feetY };
    const f = this.walk.settle(q, radius);
    p.set(q.x, (f ?? q.y) + height, q.z);
    return p;
  }

  async load() {
    this.loaded = true;
  }

  enter() {
    this.active = true;
  }

  exit() {
    this.active = false;
  }

  update(dt) {
    this.time += dt;
  }

  // Stato per l'indicatore del percorso (null = nascosto)
  progressState() {
    return null;
  }

  // ------------------------------------------------------------------ volume navigabile

  setPath(points, radius = 8, vRadius = 4) {
    this.path = { points: points.map((p) => p.clone()), radius, vRadius };
  }

  // [[x, y, z, raggioOrizzontale, raggioVerticale], ...]
  setPathRadii(list) {
    this.path = {
      points: list.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      radii: list.map((p) => [p[3], p[4]]),
      radius: list[0][3],
      vRadius: list[0][4],
    };
  }

  // Punto più vicino sul percorso (polilinea) e parametro normalizzato 0..1
  nearestOnPath(pos, out = new THREE.Vector3()) {
    const pts = this.path.points;
    let best = Infinity;
    let bestT = 0;
    let total = 0;
    const lens = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const l = pts[i].distanceTo(pts[i + 1]);
      lens.push(l);
      total += l;
    }
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      _d.subVectors(b, a);
      const len2 = _d.lengthSq() || 1;
      let t = _p.subVectors(pos, a).dot(_d) / len2;
      t = Math.max(0, Math.min(1, t));
      _q.copy(a).addScaledVector(_d, t);
      const dist = _q.distanceToSquared(pos);
      if (dist < best) {
        best = dist;
        out.copy(_q);
        bestT = (acc + lens[i] * t) / total;
      }
      acc += lens[i];
    }
    return bestT;
  }

  // Molla morbida verso il "tubo" attorno al percorso: si esplora liberamente ma non ci si perde.
  // Se path.radii è definito ([orizzontale, verticale] per punto) i raggi vengono interpolati.
  constrainToPath(pos, vel, dt) {
    if (!this.path) return;
    const near = new THREE.Vector3();
    let radius = this.path.radius;
    let vRadius = this.path.vRadius;
    if (this.path.radii) {
      const pts = this.path.points;
      let best = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        _d.subVectors(pts[i + 1], pts[i]);
        const t = Math.max(0, Math.min(1, _p.subVectors(pos, pts[i]).dot(_d) / (_d.lengthSq() || 1)));
        _q.copy(pts[i]).addScaledVector(_d, t);
        const dist = _q.distanceToSquared(pos);
        if (dist < best) {
          best = dist;
          near.copy(_q);
          radius = this.path.radii[i][0] + (this.path.radii[i + 1][0] - this.path.radii[i][0]) * t;
          vRadius = this.path.radii[i][1] + (this.path.radii[i + 1][1] - this.path.radii[i][1]) * t;
        }
      }
    } else this.nearestOnPath(pos, near);
    // componente orizzontale
    _d.set(pos.x - near.x, 0, pos.z - near.z);
    const h = _d.length();
    if (h > radius) {
      const excess = h - radius;
      _d.multiplyScalar(1 / h);
      pos.addScaledVector(_d, -excess * (1 - Math.exp(-dt * 6)));
      const vn = vel.dot(_d);
      if (vn > 0) vel.addScaledVector(_d, -vn * 0.85);
    }
    const dy = pos.y - near.y;
    if (Math.abs(dy) > vRadius) {
      const excess = Math.abs(dy) - vRadius;
      pos.y -= Math.sign(dy) * excess * (1 - Math.exp(-dt * 6));
      if (Math.sign(vel.y) === Math.sign(dy)) vel.y *= 0.2;
    }
  }

  constrain(pos, vel, dt) {
    this.constrainToPath(pos, vel, dt);
  }

  // Spinge fuori il giocatore da colonne verticali (alberi, assi) — cilindri infiniti
  pushOutOfColumns(pos, columns, pad = 0.6) {
    for (const c of columns) {
      const dx = pos.x - c.x;
      const dz = pos.z - c.z;
      const r = c.r + pad;
      if (c.yMin !== undefined && (pos.y < c.yMin || pos.y > c.yMax)) continue;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 0.001;
        pos.x = c.x + (dx / d) * r;
        pos.z = c.z + (dz / d) * r;
      }
    }
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
  }
}
