import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, loadTexture } from '../../gfx/effects.js';
import { loadNature } from '../../gfx/nature.js';
import { S, BENCH, MAT, woodTexture, valueNoise, normalMap, toTexture } from './props.js';

// ---------------------------------------------------------------------------------------------
// La stanza del laboratorio intorno al banco: un atelier di orologeria a misura d'uomo (6,8 × 6,4 m,
// soffitto a 3,2 m con le travi). Pavimento di rovere, pareti sabbia con lo zoccolo blu notte, due
// finestre alte alle spalle dei fondatori con la luce del tardo pomeriggio e la vista sul lago, la
// libreria in noce dietro di loro (i volti si leggono, niente controluce), la cassettiera da
// orologiaio, il banco di lato con il microscopio, i quadri con le macro dei Monichs, la porta, una
// pianta. Il banco ha le gambe fino al pavimento e i fondatori i loro sgabelli.
// Tutto in millimetri, in un gruppo scalato di S come il resto del banco (origine al centro del
// tappetino, y = 0 sul tappetino, il fronte verso +Z, i fondatori a -Z).
// ---------------------------------------------------------------------------------------------

export const ROOM = { x0: -3400, x1: 3400, z0: -2800, z1: 3600, floor: -950, ceil: 2250 };
const F = ROOM.floor;
const WAINSCOT = 900; // altezza dello zoccolo blu notte
// finestre della parete di fondo (centro x, larghezza; dal davanzale all'architrave)
const WINDOWS = [
  { x: -2080, w: 1300 },
  { x: 2080, w: 1300 },
];
const WIN_Y0 = F + WAINSCOT + 40; // il davanzale di pietra poggia sullo zoccolo
const WIN_Y1 = F + 2700;

const canvas = (w, h = w) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

// ---------------------------------------------------------------- materiali

// Rovere: tavole lungo Z, larghe 180 mm, di lunghezze e toni diversi, con le fughe scure
function oakTextures() {
  const N = 1024; // una piastrella = 10 tavole × 1800 mm
  const c = canvas(N);
  const g = c.getContext('2d');
  const h = canvas(N);
  const gh = h.getContext('2d');
  gh.fillStyle = '#fff';
  gh.fillRect(0, 0, N, N);
  const rand = mulberry32(41);
  const pw = N / 10;
  for (let p = 0; p < 10; p++) {
    const x = p * pw;
    let y = -rand() * N * 0.6;
    while (y < N) {
      const len = N * (0.3 + rand() * 0.45);
      const hue = 27 + rand() * 6;
      const light = 31 + rand() * 10;
      const grad = g.createLinearGradient(x, 0, x + pw, 0);
      grad.addColorStop(0, `hsl(${hue}, 26%, ${light - 2}%)`);
      grad.addColorStop(0.5, `hsl(${hue}, 28%, ${light}%)`);
      grad.addColorStop(1, `hsl(${hue}, 26%, ${light - 3}%)`);
      for (const dy of [0, N, -N]) {
        g.fillStyle = grad;
        g.fillRect(x, y + dy, pw, len);
        // venature: linee sottili e ondulate lungo la tavola
        for (let k = 0; k < 14; k++) {
          const gx = x + rand() * pw;
          const amp = 2 + rand() * 6;
          const ph = rand() * 6.3;
          g.strokeStyle = `rgba(45, 28, 14, ${0.05 + rand() * 0.1})`;
          g.lineWidth = 0.6 + rand() * 1.6;
          g.beginPath();
          for (let s = 0; s <= 24; s++) {
            const yy = y + dy + (len * s) / 24;
            const xx = gx + Math.sin(ph + s * 0.45) * amp;
            if (s) g.lineTo(xx, yy);
            else g.moveTo(xx, yy);
          }
          g.stroke();
        }
        // testa della tavola
        g.fillStyle = 'rgba(40, 24, 12, 0.85)';
        g.fillRect(x, y + dy, pw, 2);
        gh.fillStyle = '#000';
        gh.fillRect(x, y + dy, pw, 2);
      }
      y += len;
    }
    // fuga lungo la tavola
    g.fillStyle = 'rgba(40, 24, 12, 0.9)';
    g.fillRect(x, 0, 2, N);
    gh.fillStyle = '#000';
    gh.fillRect(x, 0, 2, N);
  }
  const data = gh.getImageData(0, 0, N, N).data;
  const height = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) height[i] = data[i * 4] / 255;
  return { map: toTexture(c), normalMap: normalMap(height, N, N, 1.4) };
}

// Intonaco sabbia: un rumore leggero, a chiazze
function plasterTexture(seed, base) {
  const N = 256;
  const n = valueNoise(N, N, 6, seed, 3);
  const c = canvas(N);
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  const col = new THREE.Color(base);
  for (let i = 0; i < N * N; i++) {
    const v = 0.975 + (n[i] - 0.5) * 0.05;
    img.data[i * 4] = Math.min(255, col.r * 255 * v);
    img.data[i * 4 + 1] = Math.min(255, col.g * 255 * v);
    img.data[i * 4 + 2] = Math.min(255, col.b * 255 * v);
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTexture(c);
}

// La vista dalle finestre: il lago a fine pomeriggio, i monti, la riva con gli alberi. Dipinta morbida:
// la profondità di campo la sfuma comunque, come una foto con lo sfondo fuori fuoco
function viewTexture() {
  const W = 2048;
  const H = 1024;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const rand = mulberry32(77);
  const sky = g.createLinearGradient(0, 0, 0, H * 0.62);
  sky.addColorStop(0, '#7d9cc4');
  sky.addColorStop(0.45, '#c9b8b0');
  sky.addColorStop(0.8, '#efc79c');
  sky.addColorStop(1, '#f7d6a6');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  // il sole basso, a destra: un alone caldo
  const sun = g.createRadialGradient(W * 0.72, H * 0.5, 0, W * 0.72, H * 0.5, H * 0.55);
  sun.addColorStop(0, 'rgba(255, 236, 200, 0.95)');
  sun.addColorStop(0.25, 'rgba(255, 214, 160, 0.45)');
  sun.addColorStop(1, 'rgba(255, 200, 150, 0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, W, H);
  // nuvole leggere
  g.filter = 'blur(18px)';
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(255, 246, 236, ${0.18 + rand() * 0.22})`;
    g.beginPath();
    g.ellipse(rand() * W, H * (0.08 + rand() * 0.3), 120 + rand() * 260, 18 + rand() * 30, 0, 0, Math.PI * 2);
    g.fill();
  }
  // tre catene di monti, dalla più lontana (azzurra) alla più vicina (blu verde)
  const ridge = (base, amp, color, rough, seed) => {
    const r = mulberry32(seed);
    const pts = [];
    let y = base;
    for (let x = -40; x <= W + 40; x += 16) {
      y += (r() - 0.5) * rough;
      y += (base - y) * 0.06;
      pts.push([x, y - Math.abs(Math.sin(x * 0.0032 + seed)) * amp]);
    }
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(-40, H);
    for (const [x, yy] of pts) g.lineTo(x, yy);
    g.lineTo(W + 40, H);
    g.fill();
  };
  g.filter = 'blur(3px)';
  ridge(H * 0.5, H * 0.16, '#b7a5ad', 26, 3);
  ridge(H * 0.56, H * 0.12, '#8f8698', 30, 7);
  ridge(H * 0.62, H * 0.07, '#5d6470', 22, 11);
  // il lago: una fascia chiara con i riflessi orizzontali
  const lake = g.createLinearGradient(0, H * 0.63, 0, H * 0.8);
  lake.addColorStop(0, '#e6cfae');
  lake.addColorStop(1, '#8f979e');
  g.fillStyle = lake;
  g.fillRect(0, H * 0.635, W, H * 0.2);
  g.filter = 'blur(1px)';
  for (let i = 0; i < 160; i++) {
    const y = H * (0.64 + rand() * 0.15);
    const x = rand() * W;
    g.fillStyle = `rgba(255, 238, 210, ${0.15 + rand() * 0.35 * (1 - Math.abs(x / W - 0.72) * 2)})`;
    g.fillRect(x, y, 20 + rand() * 90, 1.5);
  }
  // la riva vicina: chiome scure e tetti di pietra
  g.filter = 'blur(4px)';
  for (let i = 0; i < 90; i++) {
    const x = rand() * W;
    const y = H * (0.8 + rand() * 0.1);
    const r = 30 + rand() * 70;
    g.fillStyle = ['#3f5a3c', '#4c6a43', '#35503a', '#5a7148'][Math.floor(rand() * 4)];
    g.beginPath();
    g.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 9; i++) {
    const x = rand() * W;
    const y = H * (0.79 + rand() * 0.05);
    g.fillStyle = '#c8b9a4';
    g.fillRect(x, y, 60 + rand() * 60, 34);
    g.fillStyle = '#8a5a44';
    g.beginPath();
    g.moveTo(x - 8, y);
    g.lineTo(x + 45, y - 26);
    g.lineTo(x + 128, y);
    g.fill();
  }
  g.fillStyle = '#2f4433';
  g.fillRect(0, H * 0.9, W, H * 0.1);
  g.filter = 'none';
  const t = toTexture(c, { repeat: false });
  return t;
}

// ---------------------------------------------------------------- la stanza

/**
 * Costruisce la stanza. Restituisce { group, lights, ready } (ready: la pianta e i quadri, caricati
 * dopo). Tutte le parti hanno userData.noCastShadow: l'ombra della lampada da banco riguarda solo il
 * banco (il soffitto, dentro il volume dell'ombra, lo spegnerebbe).
 */
export function buildRoom() {
  RectAreaLightUniformsLib.init();
  const group = new THREE.Group();
  group.scale.setScalar(S);
  const rand = mulberry32(5);
  const add = (mesh, x, y, z) => {
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  // un blocco per gli estremi (x0..x1, y0..y1, z0..z1)
  const block = (mat, x0, x1, y0, y1, z0, z1) => add(new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

  // ------------------------------------------------ materiali
  const oak = oakTextures();
  oak.map.repeat.set((ROOM.x1 - ROOM.x0) / 1800, (ROOM.z1 - ROOM.z0) / 1800);
  oak.normalMap.repeat.copy(oak.map.repeat);
  const floorMat = new THREE.MeshStandardMaterial({ map: oak.map, normalMap: oak.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.56 });
  floorMat.userData.ssr = 0.16;
  floorMat.userData.ssrRough = 0.4;
  const wallTex = plasterTexture(9, 0xe4ddd0);
  wallTex.repeat.set(12, 5);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.94 });
  const ceilMat = new THREE.MeshStandardMaterial({ map: plasterTexture(13, 0xebe6dc), roughness: 0.96 });
  const navy = new THREE.MeshStandardMaterial({ color: 0x1c2340, roughness: 0.55 });
  const walnutTex = woodTexture();
  const walnut = new THREE.MeshStandardMaterial({ map: walnutTex, roughness: 0.55 });
  const walnutDark = new THREE.MeshStandardMaterial({ map: walnutTex, color: 0x8a7a72, roughness: 0.6 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc8a76e, metalness: 1, roughness: 0.32 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x23293d, metalness: 0.6, roughness: 0.42 });
  const blackSteel = new THREE.MeshStandardMaterial({ color: 0x1a1d24, metalness: 0.5, roughness: 0.5 });

  // ------------------------------------------------ pavimento, soffitto, travi
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.x1 - ROOM.x0, ROOM.z1 - ROOM.z0), floorMat);
  floor.rotation.x = -Math.PI / 2;
  add(floor, (ROOM.x0 + ROOM.x1) / 2, F, (ROOM.z0 + ROOM.z1) / 2);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.x1 - ROOM.x0, ROOM.z1 - ROOM.z0), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  add(ceil, (ROOM.x0 + ROOM.x1) / 2, ROOM.ceil, (ROOM.z0 + ROOM.z1) / 2);
  for (const z of [-1900, -500, 900, 2300]) block(walnutDark, ROOM.x0, ROOM.x1, ROOM.ceil - 240, ROOM.ceil, z - 110, z + 110);

  // ------------------------------------------------ pareti: intonaco sopra, zoccolo blu notte sotto
  const wall = (x0, x1, y0, y1, z0, z1) => block(wallMat, x0, x1, y0, y1, z0, z1);
  const T = 120; // spessore
  const wy = F + WAINSCOT;
  // parete di fondo (z0), con le due aperture delle finestre
  let cx = ROOM.x0;
  for (const w of WINDOWS) {
    const a = w.x - w.w / 2;
    const b = w.x + w.w / 2;
    wall(cx, a, wy, ROOM.ceil, ROOM.z0 - T, ROOM.z0);
    wall(a, b, WIN_Y1, ROOM.ceil, ROOM.z0 - T, ROOM.z0);
    wall(a, b, wy, WIN_Y0, ROOM.z0 - T, ROOM.z0);
    cx = b;
  }
  wall(cx, ROOM.x1, wy, ROOM.ceil, ROOM.z0 - T, ROOM.z0);
  wall(ROOM.x0, ROOM.x1, wy, ROOM.ceil, ROOM.z1, ROOM.z1 + T); // fronte
  wall(ROOM.x0 - T, ROOM.x0, wy, ROOM.ceil, ROOM.z0, ROOM.z1); // sinistra
  wall(ROOM.x1, ROOM.x1 + T, wy, ROOM.ceil, ROOM.z0, ROOM.z1); // destra
  // zoccolo: pannelli blu notte con la cornice in rilievo e il battiscopa
  const panel = (x0, x1, z0, z1, alongX) => {
    block(navy, x0, x1, F, wy, z0, z1);
    const len = alongX ? x1 - x0 : z1 - z0;
    const n = Math.max(1, Math.round(len / 900));
    const out = alongX ? (z0 < 0 ? 1 : -1) : x0 < 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const a = (alongX ? x0 : z0) + (len * i) / n + 90;
      const b = (alongX ? x0 : z0) + (len * (i + 1)) / n - 90;
      const face = alongX ? (out > 0 ? z1 : z0) : out > 0 ? x1 : x0;
      for (const [p0, p1, q0, q1] of [
        [a, b, F + 230, F + 250],
        [a, b, wy - 140, wy - 120],
        [a, a + 20, F + 230, wy - 120],
        [b - 20, b, F + 230, wy - 120],
      ]) {
        if (alongX) block(navy, p0, p1, q0, q1, face - (out < 0 ? 12 : 0), face + (out > 0 ? 12 : 0));
        else block(navy, face - (out < 0 ? 12 : 0), face + (out > 0 ? 12 : 0), q0, q1, p0, p1);
      }
    }
    // la modanatura in cima allo zoccolo
    if (alongX) block(walnutDark, x0, x1, wy - 6, wy + 22, z0 - (out < 0 ? 18 : 0), z1 + (out > 0 ? 18 : 0));
    else block(walnutDark, x0 - (out < 0 ? 18 : 0), x1 + (out > 0 ? 18 : 0), wy - 6, wy + 22, z0, z1);
  };
  cx = ROOM.x0;
  for (const w of WINDOWS) {
    panel(cx, w.x - w.w / 2 - 60, ROOM.z0 - T, ROOM.z0, true);
    panel(w.x - w.w / 2 - 60, w.x + w.w / 2 + 60, ROOM.z0 - T, ROOM.z0, true);
    cx = w.x + w.w / 2 + 60;
  }
  panel(cx, ROOM.x1, ROOM.z0 - T, ROOM.z0, true);
  panel(ROOM.x0, ROOM.x1, ROOM.z1, ROOM.z1 + T, true);
  panel(ROOM.x0 - T, ROOM.x0, ROOM.z0, ROOM.z1, false);
  panel(ROOM.x1, ROOM.x1 + T, ROOM.z0, ROOM.z1, false);

  // ------------------------------------------------ finestre a griglia d'acciaio e la vista
  const lights = [];
  const view = new THREE.Mesh(new THREE.PlaneGeometry(13000, 6500), new THREE.MeshBasicMaterial({ map: viewTexture(), fog: false }));
  view.material.color.setScalar(1.15);
  view.userData.noSSR = true;
  add(view, 0, F + 2200, ROOM.z0 - 3200);
  for (const w of WINDOWS) {
    const a = w.x - w.w / 2;
    const b = w.x + w.w / 2;
    const z = ROOM.z0 - T / 2;
    // telaio, montanti e traversi (tre colonne, quattro file)
    block(blackSteel, a, b, WIN_Y0, WIN_Y0 + 50, z - 25, z + 25);
    block(blackSteel, a, b, WIN_Y1 - 50, WIN_Y1, z - 25, z + 25);
    block(blackSteel, a, a + 50, WIN_Y0, WIN_Y1, z - 25, z + 25);
    block(blackSteel, b - 50, b, WIN_Y0, WIN_Y1, z - 25, z + 25);
    for (let i = 1; i < 3; i++) block(blackSteel, a + (w.w * i) / 3 - 14, a + (w.w * i) / 3 + 14, WIN_Y0, WIN_Y1, z - 18, z + 18);
    for (let i = 1; i < 4; i++) {
      const y = WIN_Y0 + ((WIN_Y1 - WIN_Y0) * i) / 4;
      block(blackSteel, a, b, y - 14, y + 14, z - 18, z + 18);
    }
    // davanzale di pietra chiara e sguincio
    block(new THREE.MeshStandardMaterial({ color: 0xd9d2c4, roughness: 0.7 }), a - 60, b + 60, WIN_Y0 - 40, WIN_Y0, ROOM.z0 - T, ROOM.z0 + 110);
    // la luce del giorno che entra: un'area grande come la finestra, calda di fine pomeriggio
    const area = new THREE.RectAreaLight(0xffdcb4, 4.5, w.w * S, (WIN_Y1 - WIN_Y0) * S);
    area.position.set(w.x * S, ((WIN_Y0 + WIN_Y1) / 2) * S, (ROOM.z0 + 30) * S);
    area.lookAt(w.x * S, ((WIN_Y0 + WIN_Y1) / 2) * S, 0);
    lights.push(area);
  }

  // ------------------------------------------------ la libreria in noce dietro ai fondatori
  const shelfX0 = -1260;
  const shelfX1 = 1260;
  const shelfZ0 = ROOM.z0;
  const shelfZ1 = ROOM.z0 + 380;
  const shelfTop = F + 2350;
  block(walnut, shelfX0, shelfX0 + 40, F, shelfTop, shelfZ0, shelfZ1);
  block(walnut, shelfX1 - 40, shelfX1, F, shelfTop, shelfZ0, shelfZ1);
  block(walnut, -20, 20, F + 900, shelfTop, shelfZ0, shelfZ1 - 10);
  block(walnut, shelfX0, shelfX1, shelfTop - 40, shelfTop, shelfZ0, shelfZ1);
  block(walnutDark, shelfX0, shelfX1, F, F + 900, shelfZ0, shelfZ1); // la base chiusa, con le ante
  for (const x of [-940, -320, 320, 940]) {
    block(walnut, x - 290, x + 290, F + 90, F + 860, shelfZ1, shelfZ1 + 12);
    block(brass, x + (x < 0 ? 230 : -250), x + (x < 0 ? 250 : -230), F + 600, F + 700, shelfZ1 + 12, shelfZ1 + 26);
  }
  const shelves = [F + 900, F + 1260, F + 1620, F + 1980];
  for (const y of shelves) block(walnut, shelfX0, shelfX1, y, y + 32, shelfZ0, shelfZ1);
  // libri, raccoglitori, scatole: istanze con colori della palette (blu notte, sabbia, cioccolato, oro)
  const bookGeo = new THREE.BoxGeometry(1, 1, 1);
  bookGeo.translate(0, 0.5, 0);
  const books = [];
  const PALETTE = [0x1c2340, 0x23305a, 0xd8c7a6, 0x5a3a2c, 0x392e2d, 0x7a2f2a, 0x2f4a3a, 0xe9dfcc, 0x9c7a55, 0x4a4f63];
  for (const y of shelves) {
    for (const half of [-1, 1]) {
      let x = half < 0 ? shelfX0 + 50 : 30;
      const end = half < 0 ? -30 : shelfX1 - 50;
      while (x < end - 60) {
        if (rand() < 0.16) {
          // un piccolo oggetto: scatola o pila coricata, poi spazio
          const w = 120 + rand() * 120;
          books.push({ x: x + w / 2, y: y + 32, z: shelfZ0 + 200, w, h: 40 + rand() * 90, d: 160 + rand() * 80, c: PALETTE[Math.floor(rand() * PALETTE.length)], r: 0 });
          x += w + 40 + rand() * 60;
          continue;
        }
        const t = 22 + rand() * 38;
        const h = 210 + rand() * 90;
        const lean = rand() < 0.06 ? 0.18 : 0;
        books.push({ x: x + t / 2, y: y + 32, z: shelfZ0 + 190 + rand() * 30, w: t, h, d: 170 + rand() * 50, c: PALETTE[Math.floor(rand() * PALETTE.length)], r: lean });
        x += t + (rand() < 0.1 ? 30 : 1.5);
      }
    }
  }
  const bookMat = new THREE.MeshStandardMaterial({ roughness: 0.72 });
  const bookMesh = new THREE.InstancedMesh(bookGeo, bookMat, books.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  books.forEach((b, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), b.r);
    m4.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.w, b.h, b.d));
    bookMesh.setMatrixAt(i, m4);
    bookMesh.setColorAt(i, col.setHex(b.c).multiplyScalar(0.85 + rand() * 0.25));
  });
  group.add(bookMesh);

  // ------------------------------------------------ parete sinistra: la cassettiera da orologiaio
  const cabZ0 = -1900;
  const cabZ1 = -250;
  const cabX1 = ROOM.x0 + 460;
  const cabTop = F + 1880;
  block(walnut, ROOM.x0, cabX1, F, F + 60, cabZ0, cabZ1);
  block(walnut, ROOM.x0, cabX1, cabTop - 40, cabTop, cabZ0 - 20, cabZ1 + 20);
  block(walnut, ROOM.x0, cabX1, F + 60, cabTop - 40, cabZ0, cabZ0 + 30);
  block(walnut, ROOM.x0, cabX1, F + 60, cabTop - 40, cabZ1 - 30, cabZ1);
  block(walnutDark, ROOM.x0, cabX1 - 30, F + 60, cabTop - 40, cabZ0 + 30, cabZ1 - 30);
  const cols = 8;
  const rows = 12;
  const dw = (cabZ1 - cabZ0 - 60) / cols;
  const dh = (cabTop - 100 - F - 60) / rows;
  const drawerGeo = new THREE.BoxGeometry(24, dh - 10, dw - 10);
  const pullGeo = new THREE.BoxGeometry(14, 10, dw * 0.32);
  const labelGeo = new THREE.BoxGeometry(6, dh * 0.22, dw * 0.38);
  const drawers = new THREE.InstancedMesh(drawerGeo, walnut, cols * rows);
  const pulls = new THREE.InstancedMesh(pullGeo, brass, cols * rows);
  const labels = new THREE.InstancedMesh(labelGeo, new THREE.MeshStandardMaterial({ color: 0xefe6d2, roughness: 0.8 }), cols * rows);
  let k = 0;
  for (let r = 0; r < rows; r++) {
    for (let c2 = 0; c2 < cols; c2++) {
      const z = cabZ0 + 30 + dw * (c2 + 0.5);
      const y = F + 60 + dh * (r + 0.5);
      const pull = rand() < 0.08 ? 18 : 0; // qualche cassetto appena aperto
      m4.makeTranslation(cabX1 - 12 + pull, y, z);
      drawers.setMatrixAt(k, m4);
      m4.makeTranslation(cabX1 + 6 + pull, y - dh * 0.18, z);
      pulls.setMatrixAt(k, m4);
      m4.makeTranslation(cabX1 + 2 + pull, y + dh * 0.14, z);
      labels.setMatrixAt(k, m4);
      k++;
    }
  }
  group.add(drawers, pulls, labels);

  // l'orologio da parete, sopra la cassettiera spostato verso il centro della stanza: sabbia e blu
  const clock = new THREE.Group();
  const face = new THREE.Mesh(new THREE.CylinderGeometry(230, 230, 30, 64), new THREE.MeshStandardMaterial({ color: 0xf1e9da, roughness: 0.6 }));
  face.rotation.z = Math.PI / 2;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(232, 16, 12, 64), brass);
  rim.rotation.y = Math.PI / 2;
  rim.position.x = 16;
  clock.add(face, rim);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const tick = new THREE.Mesh(new THREE.BoxGeometry(8, i % 3 === 0 ? 46 : 26, 10), navy);
    tick.position.set(18, Math.cos(a) * 190, Math.sin(a) * 190);
    tick.rotation.x = -a;
    clock.add(tick);
  }
  const hand = (len, width, angle) => {
    const h = new THREE.Mesh(new THREE.BoxGeometry(6, len, width), navy);
    h.geometry.translate(0, len / 2 - 20, 0);
    h.position.x = 24;
    h.rotation.x = -angle;
    clock.add(h);
  };
  hand(130, 14, (10 / 12) * Math.PI * 2 + (10 / 60) * (Math.PI / 6)); // 10:10, l'ora delle foto
  hand(185, 9, (10 / 60) * Math.PI * 2);
  clock.position.set(ROOM.x0 + 20, F + 2250, 650);
  group.add(clock);

  // ------------------------------------------------ parete destra: il banco di lato, mensola, attrezzi
  const sbZ0 = -1900;
  const sbZ1 = 500;
  const sbX0 = ROOM.x1 - 680;
  block(walnut, sbX0, ROOM.x1, -44, -2, sbZ0, sbZ1);
  for (const [x, z] of [
    [sbX0 + 40, sbZ0 + 40],
    [sbX0 + 40, sbZ1 - 40],
    [ROOM.x1 - 40, sbZ0 + 40],
    [ROOM.x1 - 40, sbZ1 - 40],
  ])
    block(walnutDark, x - 25, x + 25, F, -44, z - 25, z + 25);
  block(walnutDark, sbX0 + 20, ROOM.x1, -330, -44, sbZ0 + 60, sbZ0 + 560); // cassettiera sotto
  for (let i = 0; i < 3; i++) {
    block(walnut, sbX0 + 8, sbX0 + 20, -320 + i * 92, -240 + i * 92, sbZ0 + 70, sbZ0 + 550);
    block(brass, sbX0, sbX0 + 8, -285 + i * 92, -275 + i * 92, sbZ0 + 260, sbZ0 + 360);
  }
  // il microscopio: base, colonna, braccio, oculari e obiettivo
  const micro = new THREE.Group();
  const m = (geo, mat, x, y, z) => {
    const o = new THREE.Mesh(geo, mat);
    o.position.set(x, y, z);
    micro.add(o);
    return o;
  };
  m(new THREE.BoxGeometry(220, 30, 260), steel, 0, 15, 0);
  m(new THREE.CylinderGeometry(22, 26, 330, 20), steel, 0, 195, -90);
  const armM = m(new THREE.BoxGeometry(70, 60, 220), steel, 0, 330, -10);
  armM.rotation.x = 0.1;
  m(new THREE.CylinderGeometry(30, 34, 120, 24), steel, 0, 300, 70);
  for (const s of [-1, 1]) {
    const e = m(new THREE.CylinderGeometry(16, 16, 110, 16), blackSteel, s * 34, 400, 40);
    e.rotation.x = -0.6;
  }
  m(new THREE.CylinderGeometry(70, 70, 10, 32), new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.3 }), 0, 34, 70);
  micro.position.set(sbX0 + 330, -2, -900);
  micro.rotation.y = -Math.PI / 2;
  group.add(micro);
  // vassoi dei pezzi e una campana di vetro
  for (let i = 0; i < 4; i++) block(navy, sbX0 + 90 + i * 120, sbX0 + 190 + i * 120, -2, 16, -400, -300);
  // pannello forato con gli attrezzi
  block(new THREE.MeshStandardMaterial({ color: 0xcfc3ad, roughness: 0.85 }), ROOM.x1 - 16, ROOM.x1, 120, 1050, sbZ0 + 200, sbZ1 - 200);
  for (let i = 0; i < 14; i++) {
    const z = sbZ0 + 300 + i * 130;
    const len = 160 + rand() * 120;
    block(i % 3 ? steel : brass, ROOM.x1 - 40, ROOM.x1 - 22, 760 - len, 760, z - 7, z + 7);
    block(i % 2 ? navy : walnutDark, ROOM.x1 - 46, ROOM.x1 - 18, 760, 860, z - 14, z + 14);
  }
  // mensola con i raccoglitori
  block(walnut, ROOM.x1 - 300, ROOM.x1, 1300, 1332, sbZ0, sbZ1);
  const binders = [];
  for (let z = sbZ0 + 40; z < sbZ1 - 80; ) {
    const t = 50 + rand() * 30;
    binders.push({ x: ROOM.x1 - 150, y: 1332, z: z + t / 2, w: 240, h: 290 + rand() * 20, d: t, c: PALETTE[Math.floor(rand() * 4)], r: 0 });
    z += t + 2;
  }
  const binderMesh = new THREE.InstancedMesh(bookGeo, bookMat, binders.length);
  binders.forEach((b, i) => {
    m4.compose(new THREE.Vector3(b.x, b.y, b.z), q.identity(), new THREE.Vector3(b.w, b.h, b.d));
    binderMesh.setMatrixAt(i, m4);
    binderMesh.setColorAt(i, col.setHex(b.c));
  });
  group.add(binderMesh);

  // ------------------------------------------------ parete di fronte: la porta e la vetrina
  const doorX = 1900;
  block(walnutDark, doorX - 520, doorX + 520, F, F + 2200, ROOM.z1 - 30, ROOM.z1); // stipite
  block(walnut, doorX - 450, doorX + 450, F, F + 2130, ROOM.z1 - 50, ROOM.z1 - 20);
  block(new THREE.MeshStandardMaterial({ color: 0x8f877a, emissive: 0x3a2e20, roughness: 0.55 }), doorX - 330, doorX + 330, F + 1150, F + 1950, ROOM.z1 - 56, ROOM.z1 - 48);
  for (const x of [doorX - 110, doorX + 110]) block(walnut, x - 14, x + 14, F + 1150, F + 1950, ROOM.z1 - 62, ROOM.z1 - 50);
  for (const y of [F + 1417, F + 1683]) block(walnut, doorX - 330, doorX + 330, y - 14, y + 14, ROOM.z1 - 62, ROOM.z1 - 50);
  block(brass, doorX - 400, doorX - 280, F + 1000, F + 1030, ROOM.z1 - 90, ROOM.z1 - 50);
  // vetrina: cornice in noce, ripiani, le scatole blu notte dei Monichs
  const vX0 = -2600;
  const vX1 = -900;
  block(walnut, vX0, vX1, F, F + 900, ROOM.z1 - 450, ROOM.z1);
  block(walnut, vX0, vX1, F + 1980, F + 2020, ROOM.z1 - 400, ROOM.z1);
  for (const x of [vX0, vX1 - 40]) block(walnut, x, x + 40, F + 900, F + 2020, ROOM.z1 - 400, ROOM.z1);
  for (const y of [F + 1260, F + 1620]) block(new THREE.MeshStandardMaterial({ color: 0xe8eef2, roughness: 0.1, transparent: true, opacity: 0.35 }), vX0 + 40, vX1 - 40, y, y + 10, ROOM.z1 - 390, ROOM.z1);
  for (const y of [F + 910, F + 1270, F + 1630]) {
    for (let i = 0; i < 4; i++) {
      const x = vX0 + 200 + i * 380;
      block(navy, x - 110, x + 110, y, y + 90, ROOM.z1 - 300, ROOM.z1 - 120);
    }
  }

  block(walnut, -2700, 700, F + 2300, F + 2332, ROOM.z1 - 260, ROOM.z1);
  const top = [];
  for (let x = -2620; x < 640; ) {
    if (rand() < 0.2) {
      const w = 160 + rand() * 140;
      top.push({ x: x + w / 2, y: F + 2332, z: ROOM.z1 - 130, w, h: 60 + rand() * 120, d: 150 + rand() * 60, c: PALETTE[Math.floor(rand() * PALETTE.length)], r: 0 });
      x += w + 80 + rand() * 160;
      continue;
    }
    const t = 24 + rand() * 36;
    top.push({ x: x + t / 2, y: F + 2332, z: ROOM.z1 - 125, w: t, h: 200 + rand() * 80, d: 160 + rand() * 40, c: PALETTE[Math.floor(rand() * PALETTE.length)], r: 0 });
    x += t + 1.5;
  }
  const topMesh = new THREE.InstancedMesh(bookGeo, bookMat, top.length);
  top.forEach((b, i) => {
    m4.compose(new THREE.Vector3(b.x, b.y, b.z), q.identity(), new THREE.Vector3(b.w, b.h, b.d));
    topMesh.setMatrixAt(i, m4);
    topMesh.setColorAt(i, col.setHex(b.c).multiplyScalar(0.85 + rand() * 0.25));
  });
  group.add(topMesh);
  for (const x of [vX0 - 180, vX1 + 180]) {
    block(brass, x - 50, x + 50, F + 1500, F + 1600, ROOM.z1 - 30, ROOM.z1);
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(70, 50, 150, 24, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd8a8).multiplyScalar(1.6), side: THREE.DoubleSide, toneMapped: false }));
    glow.userData.noSSR = true;
    add(glow, x, F + 1700, ROOM.z1 - 110);
  }

  // ------------------------------------------------ il banco: gambe e pannelli fino al pavimento
  const bx0 = BENCH.x0;
  const bx1 = BENCH.x1;
  const under = -MAT.thick - BENCH.thick;
  // fronte chiuso (verso il visitatore), con due specchiature
  block(walnut, bx0 + 20, bx1 - 20, F + 90, under, BENCH.z1 - 40, BENCH.z1 - 20);
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? bx0 + 90 : 40;
    const x1 = s < 0 ? -40 : bx1 - 90;
    block(walnutDark, x0, x1, F + 180, under - 90, BENCH.z1 - 22, BENCH.z1 - 14);
  }
  block(navy, bx0 + 30, bx1 - 30, F, F + 90, BENCH.z1 - 70, BENCH.z1 - 30); // zoccolo
  // fianchi pieni
  for (const x of [bx0 + 20, bx1 - 40]) block(walnut, x, x + 20, F, under, BENCH.z0 + 20, BENCH.z1 - 20);
  // cassettiere sotto il piano, dal lato dei fondatori (lo spazio delle ginocchia resta libero)
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? bx0 + 40 : 560;
    const x1 = s < 0 ? -560 : bx1 - 40;
    block(walnutDark, x0, x1, under - 520, under, BENCH.z0 + 20, BENCH.z0 + 420);
    for (let i = 0; i < 4; i++) {
      const y = under - 30 - i * 125;
      block(walnut, x0 + 10, x1 - 10, y - 110, y, BENCH.z0 + 8, BENCH.z0 + 20);
      block(brass, (x0 + x1) / 2 - 50, (x0 + x1) / 2 + 50, y - 62, y - 50, BENCH.z0, BENCH.z0 + 8);
    }
  }
  // gli sgabelli dei fondatori: seduta tonda in pelle, colonna, piede a cinque razze
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x392e2d, roughness: 0.7 });
  const stools = [];
  for (const x of [-360, 360]) {
    const st = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(200, 190, 60, 40), seatMat);
    seat.position.y = -30;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(28, 28, -420 - 60 - F, 16), steel);
    post.position.y = -60 - (-420 - 60 - F) / 2;
    st.add(seat, post);
    for (let i = 0; i < 5; i++) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(300, 30, 40), steel);
      leg.geometry.translate(150, 0, 0);
      leg.rotation.y = (i / 5) * Math.PI * 2;
      leg.position.y = F + 60 + 420;
      st.add(leg);
    }
    st.position.set(x, -420, -650);
    group.add(st);
    stools.push(st);
  }

  // ------------------------------------------------ lampade a sospensione sopra il banco
  for (const x of [-480, 480]) {
    block(blackSteel, x - 3, x + 3, 1500, ROOM.ceil, -180, -174);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(70, 230, 200, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x1c2340, metalness: 0.4, roughness: 0.35, side: THREE.DoubleSide }));
    add(shade, x, 1400, -177);
    const bulb = new THREE.Mesh(new THREE.CircleGeometry(200, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe6c4).multiplyScalar(2.2), toneMapped: false }));
    bulb.rotation.x = Math.PI / 2;
    bulb.userData.noSSR = true;
    add(bulb, x, 1302, -177);
    const p = new THREE.PointLight(0xffd2a0, 30000, 0, 2);
    p.position.set(x * S, 1260 * S, -177 * S);
    lights.push(p);
  }

  // il sole basso che entra dalle finestre: luce calda di taglio, senza ombra (ce l'ha la lampada)
  const sun = new THREE.DirectionalLight(0xffd3a1, 0.55);
  sun.position.set(1600 * S, 2300 * S, -3600 * S);
  sun.target.position.set(0, 0, 0);
  lights.push(sun, sun.target);

  // nessuna parte della stanza fa ombra (l'ombra della lampada da banco è solo per il banco) e tutte
  // riflettono meno l'ambiente "studio", che resta pieno sull'acciaio degli orologi
  group.traverse((o) => {
    if (!o.isMesh) return;
    o.userData.noCastShadow = true;
    for (const m of [].concat(o.material)) if (m.isMeshStandardMaterial) m.envMapIntensity = 0.55;
  });

  mergeStatic(group);

  // ------------------------------------------------ dopo: quadri con le macro, una pianta in vaso
  const ready = Promise.all([
    framedPrints(group, walnutDark),
    plant(group).catch(() => null),
  ]);
  return { group, lights, stools, ready };
}

// Unisce i pezzi fermi della stanza con lo stesso materiale in una sola geometria (le istanze e le parti
// luminose restano a sé): da circa trecento chiamate di disegno a una per materiale
function mergeStatic(group) {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const byMat = new Map();
  const old = [];
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.userData.noSSR || Array.isArray(o.material)) return;
    const g = o.geometry.index ? o.geometry : null;
    if (!g || !g.attributes.uv || !g.attributes.normal) return;
    const geo = g.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(geo);
    old.push(o);
  });
  for (const o of old) o.parent.remove(o);
  for (const [mat, geos] of byMat) {
    const merged = new THREE.Mesh(mergeGeometries(geos, false), mat);
    merged.userData.noCastShadow = true;
    group.add(merged);
    geos.forEach((g) => g.dispose());
  }
}

// tre macro dei Monichs incorniciate (niente logo in vista: uno solo alla volta)
async function framedPrints(group, frameMat) {
  const PRINTS = [
    { url: 'assets/img/cards/vi-balance.webp', at: [ROOM.x0 + 30, F + 1700, 1500], side: 'left' },
    { url: 'assets/img/cards/su-stones.webp', at: [ROOM.x0 + 30, F + 1700, 2450], side: 'left' },
    { url: 'assets/img/cards/vi-watchmaker.webp', at: [600, F + 1650, ROOM.z1 - 30], side: 'front' },
  ];
  const texs = await Promise.all(PRINTS.map((p) => loadTexture(p.url).catch(() => null)));
  const paper = new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.9 });
  PRINTS.forEach((p, i) => {
    if (!texs[i]) return;
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(620, 620, 36), frameMat);
    const mat = new THREE.Mesh(new THREE.BoxGeometry(560, 560, 38), paper);
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: texs[i], roughness: 0.55 }));
    pic.position.z = 20;
    g.add(frame, mat, pic);
    g.position.set(...p.at);
    if (p.side === 'left') g.rotation.y = Math.PI / 2;
    if (p.side === 'front') g.rotation.y = Math.PI;
    g.traverse((o) => o.isMesh && (o.userData.noCastShadow = true));
    group.add(g);
  });
}

// una felce in un vaso di cotto, nell'angolo vicino alla finestra di sinistra
async function plant(group) {
  const model = await loadNature('assets/models/natura/felce_a.glb');
  const g = new THREE.Group();
  const potMat = new THREE.MeshStandardMaterial({ color: 0xa0583a, roughness: 0.85 });
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(230, 170, 420, 32), potMat);
  pot.position.y = 210;
  g.add(pot);
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(215, 215, 10, 32), new THREE.MeshStandardMaterial({ color: 0x2c2018, roughness: 1 }));
  soil.position.y = 405;
  g.add(soil);
  const fern = new THREE.Group();
  for (const p of model.parts) fern.add(new THREE.Mesh(p.geometry, p.material));
  const size = model.box.getSize(new THREE.Vector3());
  // in metri nel file: alta circa un metro sopra il vaso
  fern.scale.setScalar(1000 * Math.min(1.6, 1 / Math.max(0.3, size.y)));
  fern.position.y = 400;
  g.add(fern);
  g.position.set(ROOM.x0 + 380, F, ROOM.z0 + 420);
  g.traverse((o) => o.isMesh && (o.userData.noCastShadow = true));
  group.add(g);
}
