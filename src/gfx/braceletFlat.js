import * as THREE from 'three';

// ---------------------------------------------------------------------------------------------
// Bracciale aperto, disteso sul banco. Nei GLB degli orologi il bracciale è chiuso ad anello sotto
// la cassa (piano YZ: ore 12 verso -Z, quadrante verso +Y). Le maglie sono pezzi separati: qui
// ognuna viene ruotata e spostata in modo rigido, senza deformarla, come se la chiusura si aprisse e
// il bracciale si stendesse piatto, come nel disegno tecnico (MNC_T_Draw_Print, pagina 1) e nella
// foto Vi (4). La chiusura resta in fondo al lato delle ore 12, come nel disegno.
//
// face: 'back'  = l'orologio poggia sul fondello (quadrante in su): le maglie poggiano sul piano y = 0
//                 con la faccia esterna in alto.
//       'front' = l'orologio poggia sul vetro (fondello in su): il piano è alla quota del vetro e le
//                 maglie vi poggiano con la faccia esterna (quella che si vede al polso).
// ---------------------------------------------------------------------------------------------

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _X = new THREE.Vector3(1, 0, 0);

// Pezzi connessi di una geometria indicizzata (vertici saldati per posizione): liste di indici
function components(geo) {
  const pos = geo.attributes.position;
  const n = pos.count;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const join = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[a] = b;
  };
  const idx = geo.index;
  if (idx) for (let t = 0; t < idx.count; t += 3) {
    join(idx.getX(t), idx.getX(t + 1));
    join(idx.getX(t), idx.getX(t + 2));
  }
  else for (let t = 0; t < n; t += 3) {
    join(t, t + 1);
    join(t, t + 2);
  }
  const weld = new Map();
  for (let i = 0; i < n; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (weld.has(key)) join(i, weld.get(key));
    else weld.set(key, i);
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  }
  return [...groups.values()];
}

function centroidOf(pos, list) {
  const c = new THREE.Vector3();
  for (const i of list) c.x += pos.getX(i), c.y += pos.getY(i), c.z += pos.getZ(i);
  return c.multiplyScalar(1 / list.length);
}

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * Stende il bracciale di un WatchModel. Le geometrie del bracciale e della chiusura vengono copiate
 * (le altre istanze dello stesso modello restano chiuse ad anello). Restituisce la lunghezza del
 * bracciale aperto lungo Z (mm, coordinate del modello): { zMin, zMax }.
 */
export function layBraceletFlat(watch, { face = 'back', ramp = 13 } = {}) {
  const meshes = watch.meshes;
  const linkMeshes = ['bracciale_maglie_centrali', 'bracciale_maglie_esterne'].map((n) => meshes[n]).filter((m) => m?.isMesh);
  const claspMeshes = ['chiusura', 'chiusura_logo', 'chiusura_pulsanti'].map((n) => meshes[n]).filter((m) => m?.isMesh);
  if (!linkMeshes.length) return null;

  // quota del vetro (piano d'appoggio quando l'orologio è coricato sul quadrante)
  let top = -Infinity;
  for (const [name, m] of Object.entries(meshes)) {
    if (!m.isMesh || /bracciale|chiusura/.test(name)) continue;
    m.geometry.computeBoundingBox();
    top = Math.max(top, m.geometry.boundingBox.max.y);
  }

  // tutti i pezzi, con il loro baricentro
  const parts = [];
  for (const mesh of linkMeshes) {
    mesh.geometry = mesh.geometry.clone();
    const pos = mesh.geometry.attributes.position;
    for (const list of components(mesh.geometry)) parts.push({ mesh, list, c: centroidOf(pos, list) });
  }
  // la chiusura con il logo e i pulsanti: un pezzo unico
  let clasp = null;
  if (claspMeshes.length) {
    const c = new THREE.Vector3();
    let count = 0;
    for (const mesh of claspMeshes) {
      mesh.geometry = mesh.geometry.clone();
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) c.x += pos.getX(i), c.y += pos.getY(i), c.z += pos.getZ(i), count++;
    }
    clasp = { c: c.multiplyScalar(1 / count) };
  }

  // centro dell'anello: a metà fra l'attacco alle anse e il fondo
  let yTop = -Infinity;
  let yBot = Infinity;
  for (const p of parts) {
    yTop = Math.max(yTop, p.c.y);
    yBot = Math.min(yBot, p.c.y);
  }
  const yC = (yTop + yBot) / 2;
  const angle = (c) => Math.atan2(c.y - yC, Math.abs(c.z));

  let zMin = 0;
  let zMax = 0;
  for (const side of [1, -1]) {
    // catena dall'ansa verso la chiusura
    const chain = parts.filter((p) => Math.sign(p.c.z) === side).sort((a, b) => angle(b.c) - angle(a.c));
    if (side === -1 && clasp) chain.push({ clasp: true, c: clasp.c });
    if (!chain.length) continue;
    // linea media addolcita (le maglie centrali ed esterne stanno a raggi un po' diversi)
    const P = chain.map((p) => new THREE.Vector2(p.c.z, p.c.y));
    const S = P.map((p, i) => (i === 0 || i === P.length - 1 ? p.clone() : p.clone().multiplyScalar(2).add(P[i - 1]).add(P[i + 1]).multiplyScalar(0.25)));
    const s = [0];
    for (let i = 1; i < S.length; i++) s.push(s[i - 1] + S[i].distanceTo(S[i - 1]));
    const z0 = Math.abs(chain[0].c.z);
    // altezza del piano di appoggio sotto ogni maglia: sale verso l'ansa (l'attacco è a mezza cassa)
    const lugLift = face === 'back' ? Math.max(0, chain[0].c.y - 1.6) : Math.max(0, top - chain[0].c.y - 1.6);
    const lift = (d) => lugLift * (1 - smooth(d / ramp));
    const slope = (d) => (lift(d + 0.5) - lift(d - 0.5)) / 1;

    chain.forEach((p, i) => {
      const a = S[Math.max(0, i - 1)];
      const b = S[Math.min(S.length - 1, i + 1)];
      const phi = Math.atan2(b.y - a.y, b.x - a.x); // angolo della tangente nel piano (z, y)
      let rot = side === 1 ? phi : phi - Math.PI;
      // inclinazione delle prime maglie, che scendono dall'ansa al banco (o salgono verso il vetro)
      const beta = Math.atan(-slope(s[i]));
      rot += face === 'back' ? side * beta : -side * beta;
      _q.setFromAxisAngle(_X, rot);
      const targets = p.clasp ? claspMeshes.map((m) => ({ mesh: m, list: null })) : [{ mesh: p.mesh, list: p.list }];
      // estensione verticale della maglia ruotata (per appoggiarla al piano)
      let lo = Infinity;
      let hi = -Infinity;
      for (const t of targets) {
        const pos = t.mesh.geometry.attributes.position;
        const n = t.list ? t.list.length : pos.count;
        for (let k = 0; k < n; k++) {
          const vi = t.list ? t.list[k] : k;
          _v.fromBufferAttribute(pos, vi).sub(p.c).applyQuaternion(_q);
          lo = Math.min(lo, _v.y);
          hi = Math.max(hi, _v.y);
        }
      }
      const zc = side * (z0 + s[i]);
      const yc = face === 'back' ? lift(s[i]) - lo + 0.02 : top - lift(s[i]) - hi - 0.02;
      for (const t of targets) {
        const pos = t.mesh.geometry.attributes.position;
        const nrm = t.mesh.geometry.attributes.normal;
        const tan = t.mesh.geometry.attributes.tangent; // direzione della satinatura: gira con la maglia
        const n = t.list ? t.list.length : pos.count;
        for (let k = 0; k < n; k++) {
          const vi = t.list ? t.list[k] : k;
          _v.fromBufferAttribute(pos, vi).sub(p.c).applyQuaternion(_q);
          pos.setXYZ(vi, p.c.x + _v.x, yc + _v.y, zc + _v.z);
          if (nrm) {
            _v.fromBufferAttribute(nrm, vi).applyQuaternion(_q);
            nrm.setXYZ(vi, _v.x, _v.y, _v.z);
          }
          if (tan) {
            _v.set(tan.getX(vi), tan.getY(vi), tan.getZ(vi)).applyQuaternion(_q);
            tan.setXYZ(vi, _v.x, _v.y, _v.z);
          }
          zMin = Math.min(zMin, zc + _v.z);
          zMax = Math.max(zMax, zc + _v.z);
        }
      }
    });
  }
  for (const m of [...linkMeshes, ...claspMeshes]) {
    const g = m.geometry;
    g.attributes.position.needsUpdate = true;
    if (g.attributes.normal) g.attributes.normal.needsUpdate = true;
    if (g.attributes.tangent) g.attributes.tangent.needsUpdate = true;
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
  return { zMin, zMax, top };
}
