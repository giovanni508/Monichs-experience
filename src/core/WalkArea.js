import * as THREE from 'three';

/**
 * Spazio calpestabile di un mondo (nel piano XZ, con l'altezza del pavimento).
 *
 * - Regioni: corridoi lungo polilinee (ogni punto ha altezza del pavimento e semilarghezza) e dischi
 *   (con eventuali fori). Il centro del corpo deve restare dentro almeno una regione "al proprio
 *   livello": una regione conta solo se il suo pavimento è entro `stepTolerance` dai piedi, così una
 *   passerella che passa sotto una piattaforma non si confonde con quella.
 *   Le misure delle regioni sono già quelle utili per il centro del corpo (margini compresi).
 * - Ostacoli: cerchi, capsule e rettangoli orientati, con un intervallo di altezze; il corpo
 *   (raggio, altezza) ne viene spinto fuori e la velocità perde la componente contro l'ostacolo.
 */
const _q = { x: 0, z: 0, y: 0 };
const _best = { x: 0, z: 0, y: 0 };

function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function floorOf(reg, x, z, fallback) {
  if (reg.floorFn) return reg.floorFn(x, z);
  return typeof fallback === 'function' ? fallback() : fallback;
}

// Spinge (qx, qz) fuori da un foro rettangolare orientato, verso il lato più vicino
function outOfRectHole(h, q) {
  const dx = q.x - h.x;
  const dz = q.z - h.z;
  const lx = dx * h.cos + dz * h.sin;
  const lz = -dx * h.sin + dz * h.cos;
  const px = h.hx - Math.abs(lx);
  const pz = h.hz - Math.abs(lz);
  if (px <= 0 || pz <= 0) return;
  let ox = lx;
  let oz = lz;
  if (px < pz) ox = (Math.sign(lx) || 1) * h.hx;
  else oz = (Math.sign(lz) || 1) * h.hz;
  q.x = h.x + ox * h.cos - oz * h.sin;
  q.z = h.z + ox * h.sin + oz * h.cos;
}

// Punto valido più vicino dentro una regione. Restituisce lo spostamento (0 = già dentro).
function regionClosest(reg, x, z, out) {
  if (reg.type === 'rect') {
    const dx = x - reg.x;
    const dz = z - reg.z;
    const lx = Math.max(-reg.hx, Math.min(reg.hx, dx * reg.cos + dz * reg.sin));
    const lz = Math.max(-reg.hz, Math.min(reg.hz, -dx * reg.sin + dz * reg.cos));
    const q = { x: reg.x + lx * reg.cos - lz * reg.sin, z: reg.z + lx * reg.sin + lz * reg.cos };
    for (const h of reg.holes) {
      if (h.enabled === false) continue;
      if (h.r !== undefined) {
        const hx = q.x - h.x;
        const hz = q.z - h.z;
        const hd = Math.hypot(hx, hz);
        if (hd < h.r) {
          const k = h.r / (hd || 1e-6);
          q.x = h.x + (hd > 1e-6 ? hx * k : h.r);
          q.z = h.z + (hd > 1e-6 ? hz * k : 0);
        }
      } else outOfRectHole(h, q);
    }
    out.x = q.x;
    out.z = q.z;
    out.y = floorOf(reg, q.x, q.z, reg.y);
    return Math.hypot(q.x - x, q.z - z);
  }
  if (reg.type === 'disc') {
    let qx = x;
    let qz = z;
    const dx = x - reg.x;
    const dz = z - reg.z;
    const d = Math.hypot(dx, dz);
    if (d > reg.radius) {
      const k = reg.radius / (d || 1);
      qx = reg.x + dx * k;
      qz = reg.z + dz * k;
    }
    for (const h of reg.holes) {
      if (h.enabled === false) continue;
      const hx = qx - h.x;
      const hz = qz - h.z;
      const hd = Math.hypot(hx, hz);
      if (hd < h.r) {
        const k = h.r / (hd || 1e-6);
        qx = h.x + (hd > 1e-6 ? hx * k : h.r);
        qz = h.z + (hd > 1e-6 ? hz * k : 0);
      }
    }
    out.x = qx;
    out.z = qz;
    out.y = floorOf(reg, qx, qz, reg.y);
    return Math.hypot(qx - x, qz - z);
  }

  // corridoio: unione di "capsule" tra punti consecutivi, con semilarghezza e pavimento interpolati
  const pts = reg.pts;
  let bestMove = Infinity;
  let bestCenter = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const l2 = ex * ex + ez * ez || 1e-9;
    const t = clamp01(((x - a.x) * ex + (z - a.z) * ez) / l2);
    const cx = a.x + ex * t;
    const cz = a.z + ez * t;
    const w = Math.max(0, a.w + (b.w - a.w) * t);
    const dx = x - cx;
    const dz = z - cz;
    const d = Math.hypot(dx, dz);
    let qx = x;
    let qz = z;
    let move = 0;
    if (d > w) {
      const k = w / (d || 1);
      qx = cx + dx * k;
      qz = cz + dz * k;
      move = d - w;
    }
    // dentro più tratti: vale quello col centro più vicino (pavimento coerente ai raccordi)
    if (move < bestMove - 1e-9 || (move <= 1e-9 && bestMove <= 1e-9 && d < bestCenter)) {
      bestMove = move;
      bestCenter = d;
      out.x = qx;
      out.z = qz;
      out.y = reg.floorFn ? reg.floorFn(qx, qz) : a.y + (b.y - a.y) * t;
    }
  }
  return bestMove;
}

/**
 * Le estremità di un corridoio sono arrotondate: il centro del corpo arriva fino a una semilarghezza
 * oltre il primo e l'ultimo punto. Dove la passerella finisce con una ringhiera (o nel vuoto) si
 * arretrano gli estremi: il bordo utile cade a `margin` prima della fine visibile.
 * points: [[x, y, z, w], ...]; start/end: true per arretrare quell'estremo.
 */
export function insetEnds(points, { start = false, end = false, margin = 0.7 } = {}) {
  // accorcia la polilinea dall'inizio di (semilarghezza + margine), anche attraverso più tratti
  const trimStart = (list) => {
    let remaining = list[0][3] + margin;
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i];
      const b = list[i + 1];
      const l = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (l > remaining || i === list.length - 2) {
        const t = Math.min(0.95, remaining / (l || 1));
        const p = a.map((v, k) => v + (b[k] - v) * t);
        return [p, ...list.slice(i + 1)];
      }
      remaining -= l;
    }
    return list;
  };
  let pts = points.map((p) => [...p]);
  if (pts.length < 2) return pts;
  if (start) pts = trimStart(pts);
  if (end) pts = trimStart(pts.reverse()).reverse();
  return pts;
}

export class WalkArea {
  constructor({ stepTolerance = 1.6 } = {}) {
    this.regions = [];
    this.colliders = [];
    this.stepTolerance = stepTolerance;
  }

  // ------------------------------------------------------------------ costruzione

  /** points: [[x, yPavimento, z, semilarghezza], ...] */
  corridor(points, { floorFn = null, name = '' } = {}) {
    const reg = { type: 'corridor', pts: points.map(([x, y, z, w]) => ({ x, y, z, w })), floorFn, enabled: true, name };
    this.regions.push(reg);
    return reg;
  }

  /** y può essere un numero o una funzione (es. piattaforma mobile); holes: [{ x, z, r }] */
  disc(x, z, radius, y, { holes = [], floorFn = null, name = '' } = {}) {
    const reg = { type: 'disc', x, z, radius, y, holes, floorFn, enabled: true, name };
    this.regions.push(reg);
    return reg;
  }

  /**
   * Rettangolo orientato (centro, semilati, rotazione attorno a Y) con pavimento y (numero) o
   * floorFn; holes: dischi { x, z, r } o rettangoli { x, z, hx, hz, rot }. Nei fori la regione non
   * c'è: lì vale un'altra regione (più alta o più bassa), se c'è, altrimenti è un muro.
   */
  rect(x, z, hx, hz, y, { rot = 0, holes = [], floorFn = null, name = '' } = {}) {
    const hs = holes.map((h) => (h.r !== undefined ? { ...h } : { ...h, cos: Math.cos(h.rot || 0), sin: Math.sin(h.rot || 0) }));
    const reg = { type: 'rect', x, z, hx, hz, rot, cos: Math.cos(rot), sin: Math.sin(rot), y, holes: hs, floorFn, enabled: true, name };
    this.regions.push(reg);
    return reg;
  }

  circle(x, z, r, y0 = -Infinity, y1 = Infinity) {
    const c = { type: 'circle', x, z, r, y0, y1, enabled: true };
    this.colliders.push(c);
    return c;
  }

  capsule(ax, az, bx, bz, r, y0 = -Infinity, y1 = Infinity) {
    const c = { type: 'capsule', ax, az, bx, bz, r, y0, y1, enabled: true };
    this.colliders.push(c);
    return c;
  }

  box(x, z, hx, hz, rot = 0, y0 = -Infinity, y1 = Infinity) {
    const c = { type: 'box', x, z, hx, hz, rot, cos: Math.cos(rot), sin: Math.sin(rot), y0, y1, enabled: true };
    this.colliders.push(c);
    return c;
  }

  // ------------------------------------------------------------------ interrogazioni

  /** Pavimento in (x, z) per chi ha i piedi a yRef (null se non c'è nulla di calpestabile lì). */
  floorAt(x, z, yRef = 0, anyLevel = false) {
    let best = null;
    let bestDy = Infinity;
    for (const reg of this.regions) {
      if (!reg.enabled) continue;
      const m = regionClosest(reg, x, z, _q);
      if (m > 1e-6) continue;
      const dy = Math.abs(_q.y - yRef);
      if (!anyLevel && dy > this.stepTolerance) continue;
      if (dy < bestDy) {
        bestDy = dy;
        best = _q.y;
      }
    }
    return best;
  }

  /**
   * Muove p ({x, y: piedi, z}) nel punto valido più vicino al proprio livello (o a qualunque
   * livello con anyLevel) e lo spinge fuori dagli ostacoli. Restituisce il pavimento, o null.
   */
  resolve(p, vel, radius, height, anyLevel = false) {
    let floor = null;
    for (let it = 0; it < 3; it++) {
      let pushed = false;
      for (const c of this.colliders) {
        if (!c.enabled) continue;
        if (p.y + height < c.y0 || p.y > c.y1) continue;
        if (pushOut(c, p, vel, radius)) pushed = true;
      }
      const res = this.clamp(p, vel, anyLevel);
      if (res.floor !== null) floor = res.floor;
      if (!pushed && !res.moved) break;
    }
    return floor;
  }

  clamp(p, vel, anyLevel = false) {
    let found = false;
    let bestMove = Infinity;
    let bestDy = Infinity;
    for (const reg of this.regions) {
      if (!reg.enabled) continue;
      const m = regionClosest(reg, p.x, p.z, _q);
      const dy = Math.abs(_q.y - p.y);
      if (!anyLevel && dy > this.stepTolerance) continue;
      // preferisce chi non sposta; a parità (dentro più regioni) il pavimento più vicino ai piedi
      if (m < bestMove - 1e-6 || (Math.abs(m - bestMove) <= 1e-6 && dy < bestDy)) {
        bestMove = m;
        bestDy = dy;
        _best.x = _q.x;
        _best.z = _q.z;
        _best.y = _q.y;
        found = true;
      }
    }
    if (!found) return { moved: false, floor: null };
    if (bestMove <= 1e-6) return { moved: false, floor: _best.y };
    const nx = _best.x - p.x;
    const nz = _best.z - p.z;
    const l = Math.hypot(nx, nz) || 1;
    p.x = _best.x;
    p.z = _best.z;
    if (vel) {
      // via la componente della velocità che punta fuori dalla regione (si scivola lungo il bordo)
      const ux = -nx / l;
      const uz = -nz / l;
      const vo = vel.x * ux + vel.z * uz;
      if (vo > 0) {
        vel.x -= ux * vo;
        vel.z -= uz * vo;
      }
    }
    return { moved: true, floor: _best.y };
  }

  /** Porta un punto sul calpestabile al livello più vicino a p.y (per comparse, portali, guide). */
  settle(p, radius = 0.5) {
    const v = { x: 0, z: 0 };
    return this.resolve(p, v, radius, 2, true);
  }

  // ------------------------------------------------------------------ disegno di verifica (solo debug)

  debugObject() {
    const pos = [];
    const seg = (x1, y1, z1, x2, y2, z2) => pos.push(x1, y1, z1, x2, y2, z2);
    const circ = (cx, cy, cz, r, n = 48) => {
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        seg(cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r, cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r);
      }
    };
    const quad = (cx, cz, hx, hz, cos, sin, y) => {
      const k = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => [cx + sx * hx * cos - sz * hz * sin, cz + sx * hx * sin + sz * hz * cos]);
      for (let i = 0; i < 4; i++) seg(k[i][0], y, k[i][1], k[(i + 1) % 4][0], y, k[(i + 1) % 4][1]);
    };
    for (const reg of this.regions) {
      if (reg.type === 'disc') {
        const y = (typeof reg.y === 'function' ? reg.y() : reg.y) + 0.05;
        circ(reg.x, y, reg.z, reg.radius);
        reg.holes.forEach((h) => circ(h.x, y, h.z, h.r, 24));
        continue;
      }
      if (reg.type === 'rect') {
        const y = (reg.floorFn ? reg.floorFn(reg.x, reg.z) : reg.y) + 0.05;
        quad(reg.x, reg.z, reg.hx, reg.hz, reg.cos, reg.sin, y);
        reg.holes.forEach((h) => (h.r !== undefined ? circ(h.x, y, h.z, h.r, 24) : quad(h.x, h.z, h.hx, h.hz, h.cos, h.sin, y)));
        continue;
      }
      const pts = reg.pts;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const ya = (reg.floorFn ? reg.floorFn(a.x, a.z) : a.y) + 0.05;
        const yb = (reg.floorFn ? reg.floorFn(b.x, b.z) : b.y) + 0.05;
        const ex = b.x - a.x;
        const ez = b.z - a.z;
        const l = Math.hypot(ex, ez) || 1;
        const nx = -ez / l;
        const nz = ex / l;
        seg(a.x, ya, a.z, b.x, yb, b.z);
        seg(a.x + nx * a.w, ya, a.z + nz * a.w, b.x + nx * b.w, yb, b.z + nz * b.w);
        seg(a.x - nx * a.w, ya, a.z - nz * a.w, b.x - nx * b.w, yb, b.z - nz * b.w);
      }
    }
    for (const c of this.colliders) {
      const y = Number.isFinite(c.y0) ? c.y0 + 0.3 : 0.3;
      if (c.type === 'circle') circ(c.x, y, c.z, c.r, 32);
      else if (c.type === 'capsule') {
        circ(c.ax, y, c.az, c.r, 24);
        circ(c.bx, y, c.bz, c.r, 24);
        seg(c.ax, y, c.az, c.bx, y, c.bz);
      } else {
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
          const lx = sx * c.hx;
          const lz = sz * c.hz;
          return [c.x + lx * c.cos - lz * c.sin, c.z + lx * c.sin + lz * c.cos];
        });
        for (let i = 0; i < 4; i++) seg(corners[i][0], y, corners[i][1], corners[(i + 1) % 4][0], y, corners[(i + 1) % 4][1]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x40ff90, depthTest: false, transparent: true }));
    lines.renderOrder = 999;
    return lines;
  }
}

// ------------------------------------------------------------------ ostacoli

function pushCircle(cx, cz, r, p, vel, radius) {
  const dx = p.x - cx;
  const dz = p.z - cz;
  const d = Math.hypot(dx, dz);
  const m = r + radius;
  if (d >= m) return false;
  const nx = d > 1e-6 ? dx / d : 1;
  const nz = d > 1e-6 ? dz / d : 0;
  p.x = cx + nx * m;
  p.z = cz + nz * m;
  if (vel) {
    const vn = vel.x * nx + vel.z * nz;
    if (vn < 0) {
      vel.x -= nx * vn;
      vel.z -= nz * vn;
    }
  }
  return true;
}

function pushOut(c, p, vel, radius) {
  if (c.type === 'circle') return pushCircle(c.x, c.z, c.r, p, vel, radius);
  if (c.type === 'capsule') {
    const ex = c.bx - c.ax;
    const ez = c.bz - c.az;
    const t = clamp01(((p.x - c.ax) * ex + (p.z - c.az) * ez) / (ex * ex + ez * ez || 1e-9));
    return pushCircle(c.ax + ex * t, c.az + ez * t, c.r, p, vel, radius);
  }
  // rettangolo orientato: coordinate locali
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  const lx = dx * c.cos + dz * c.sin;
  const lz = -dx * c.sin + dz * c.cos;
  const cx = Math.max(-c.hx, Math.min(c.hx, lx));
  const cz = Math.max(-c.hz, Math.min(c.hz, lz));
  let nx;
  let nz;
  let ox;
  let oz;
  if (cx === lx && cz === lz) {
    // dentro il rettangolo: esce dal lato più vicino
    const px = c.hx - Math.abs(lx);
    const pz = c.hz - Math.abs(lz);
    if (px < pz) {
      nx = Math.sign(lx) || 1;
      nz = 0;
      ox = nx * (c.hx + radius);
      oz = lz;
    } else {
      nx = 0;
      nz = Math.sign(lz) || 1;
      ox = lx;
      oz = nz * (c.hz + radius);
    }
  } else {
    const ddx = lx - cx;
    const ddz = lz - cz;
    const d = Math.hypot(ddx, ddz);
    if (d >= radius) return false;
    nx = ddx / (d || 1);
    nz = ddz / (d || 1);
    ox = cx + nx * radius;
    oz = cz + nz * radius;
  }
  p.x = c.x + ox * c.cos - oz * c.sin;
  p.z = c.z + ox * c.sin + oz * c.cos;
  if (vel) {
    const wx = nx * c.cos - nz * c.sin;
    const wz = nx * c.sin + nz * c.cos;
    const vn = vel.x * wx + vel.z * wz;
    if (vn < 0) {
      vel.x -= wx * vn;
      vel.z -= wz * vn;
    }
  }
  return true;
}
