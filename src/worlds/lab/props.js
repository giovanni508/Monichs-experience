import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from '../../gfx/effects.js';
import { patchCustom } from '../../gfx/materials.js';
import { PICTOGRAM_POLYGONS } from '../../ui/UI.js';

// ---------------------------------------------------------------------------------------------
// Il banco del laboratorio. Tutto è modellato in millimetri dentro gruppi scalati di S: il
// visitatore, con gli occhi a 3,2 unità, è alto poco più di un centimetro.
// Gli attrezzi sono generici e senza marchi; la scatola segue la foto MNC_Ph_Pack (blu notte con
// motivo a triangoli in rilievo, interno blu, pack da viaggio in pelle marrone con la placchetta in
// oro rosa).
// ---------------------------------------------------------------------------------------------

export const S = 0.25; // unità di scena per millimetro

// banco e tappetino (mm; origine al centro del tappetino, il fronte verso +Z)
export const BENCH = { x0: -780, x1: 780, z0: -430, z1: 400, thick: 42 };
export const MAT = { hx: 400, hz: 280, thick: 2 };

const canvas = (w, h = w) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

export function toTexture(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Mappa normale da un campo di altezze periodico (w × h)
export function normalMap(height, w, h, strength = 2) {
  const c = canvas(w, h);
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hx = height[y * w + ((x + 1) % w)] - height[y * w + ((x - 1 + w) % w)];
      const hy = height[((y + 1) % h) * w + x] - height[((y - 1 + h) % h) * w + x];
      const nx = -hx * strength;
      const ny = hy * strength; // il canvas scende, la v della texture sale
      const l = Math.hypot(nx, ny, 1);
      const i = (y * w + x) * 4;
      img.data[i] = (nx / l * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, { srgb: false });
}

// Rumore di valore periodico (n × n celle) campionato su una griglia w × h
export function valueNoise(w, h, n, seed, octaves = 4) {
  const rand = mulberry32(seed);
  const out = new Float32Array(w * h);
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = n << o;
    const grid = new Float32Array(cells * cells).map(() => rand());
    const sm = (t) => t * t * (3 - 2 * t);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * cells;
        const fy = (y / h) * cells;
        const x0 = Math.floor(fx) % cells;
        const y0 = Math.floor(fy) % cells;
        const tx = sm(fx - Math.floor(fx));
        const ty = sm(fy - Math.floor(fy));
        const a = grid[y0 * cells + x0] * (1 - tx) + grid[y0 * cells + ((x0 + 1) % cells)] * tx;
        const b = grid[((y0 + 1) % cells) * cells + x0] * (1 - tx) + grid[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)] * tx;
        out[y * w + x] += (a * (1 - ty) + b * ty) * amp;
      }
    }
    norm += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

// Noce del banco (e dei mobili del laboratorio): venature lungo X, un velo di vernice
let walnut = null;
export function woodTexture() {
  if (walnut) return walnut;
  const W = 1024;
  const H = 512;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const base = valueNoise(W, H, 2, 11, 3);
  const img = g.createImageData(W, H);
  const rand = mulberry32(5);
  const lines = Array.from({ length: 70 }, () => ({ y: rand() * H, a: 0.15 + rand() * 0.5, w: 0.6 + rand() * 2.4, f: rand() * 6 }));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = base[y * W + x];
      let v = 0.55 + (n - 0.5) * 0.5;
      for (const l of lines) {
        const yy = l.y + Math.sin((x / W) * Math.PI * 2 + l.f) * 9 + (n - 0.5) * 20;
        const d = Math.abs(((y - yy + H * 1.5) % H) - H / 2) > H / 2 - l.w ? 1 : 0;
        if (d) v -= l.a * 0.35;
      }
      const i = (y * W + x) * 4;
      img.data[i] = 70 + v * 70;
      img.data[i + 1] = 44 + v * 44;
      img.data[i + 2] = 28 + v * 26;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  walnut = toTexture(c);
  return walnut;
}

// Tappetino: cuoio cioccolato, grana fine
function matTextures() {
  const N = 512;
  const mott = valueNoise(N, N, 3, 21, 3);
  const c = canvas(N);
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const v = 0.88 + (mott[i] - 0.5) * 0.22;
    img.data[i * 4] = 58 * v;
    img.data[i * 4 + 1] = 44 * v;
    img.data[i * 4 + 2] = 38 * v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const grain = valueNoise(N, N, 32, 22, 2);
  return { map: toTexture(c), normalMap: normalMap(grain, N, N, 2.2) };
}

// Motivo della scatola: reticolo di triangoli in rilievo (tre famiglie di solchi a 0°, 60°, 120°).
// La piastrella è larga un lato di triangolo e alta due file: si ripete senza giunture.
function trianglePatternNormal() {
  const W = 128;
  const H = Math.round(W * Math.sqrt(3));
  const h = new Float32Array(W * H);
  const row = H / 2; // altezza di una fila di triangoli
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W; // in lati di triangolo
      const v = y / (2 * row); // in coppie di file
      // distanza (in frazioni di fila) dalle tre famiglie di rette
      const d0 = Math.abs(((v * 2) % 1) - 0.5);
      const p1 = u + v; // rette a +60°: u + v costante (unità: lato)
      const p2 = u - v;
      const d1 = Math.abs((((p1 % 1) + 1) % 1) - 0.5);
      const d2 = Math.abs((((p2 % 1) + 1) % 1) - 0.5);
      const groove = (d) => 1 - Math.min(1, Math.max(0, (0.5 - d) / 0.06));
      h[y * W + x] = 1 - Math.max(groove(d0), groove(d1), groove(d2)) * 0.9;
    }
  }
  return normalMap(h, W, H, 3.5);
}

// Pelle martellata del pack: celle di Voronoi in rilievo
function leatherNormal() {
  const N = 256;
  const rand = mulberry32(31);
  const pts = Array.from({ length: 140 }, () => [rand() * N, rand() * N]);
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let f1 = 1e9;
      let f2 = 1e9;
      for (const [px, py] of pts) {
        let dx = Math.abs(x - px);
        let dy = Math.abs(y - py);
        dx = Math.min(dx, N - dx);
        dy = Math.min(dy, N - dy);
        const d = dx * dx + dy * dy;
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) f2 = d;
      }
      h[y * N + x] = Math.min(1, (Math.sqrt(f2) - Math.sqrt(f1)) / 6);
    }
  }
  return normalMap(h, N, N, 1.6);
}

// ---------------------------------------------------------------- banco e tappetino

export function buildBench() {
  const group = new THREE.Group();
  group.scale.setScalar(S);
  const W = BENCH.x1 - BENCH.x0;
  const D = BENCH.z1 - BENCH.z0;
  const wood = new THREE.MeshPhysicalMaterial({ map: woodTexture(), roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.32 });
  wood.userData.ssr = 0.25;
  wood.userData.ssrRough = 0.32;
  const top = new THREE.Mesh(new THREE.BoxGeometry(W, BENCH.thick, D), wood);
  top.position.set((BENCH.x0 + BENCH.x1) / 2, -MAT.thick - BENCH.thick / 2, (BENCH.z0 + BENCH.z1) / 2);
  group.add(top);

  // tappetino con gli angoli arrotondati e una cucitura a 9 mm dal bordo
  const { map, normalMap: nmap } = matTextures();
  map.repeat.set(5, 3.5);
  nmap.repeat.set(26, 18);
  const r = 14;
  const sh = new THREE.Shape();
  const { hx, hz } = MAT;
  sh.moveTo(-hx + r, -hz);
  sh.lineTo(hx - r, -hz);
  sh.quadraticCurveTo(hx, -hz, hx, -hz + r);
  sh.lineTo(hx, hz - r);
  sh.quadraticCurveTo(hx, hz, hx - r, hz);
  sh.lineTo(-hx + r, hz);
  sh.quadraticCurveTo(-hx, hz, -hx, hz - r);
  sh.lineTo(-hx, -hz + r);
  sh.quadraticCurveTo(-hx, -hz, -hx + r, -hz);
  const mg = new THREE.ExtrudeGeometry(sh, { depth: MAT.thick, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.8, bevelSegments: 2, curveSegments: 6 });
  mg.rotateX(-Math.PI / 2);
  mg.translate(0, -MAT.thick - 0.5, 0); // lo smusso sporge di 0,5 mm: la faccia di sopra torna a y = 0
  // UV dall'alto (x, z) per grana e chiazze
  const uv = mg.attributes.uv;
  const pos = mg.attributes.position;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (2 * hx) + 0.5, pos.getZ(i) / (2 * hz) + 0.5);
  const matMat = new THREE.MeshStandardMaterial({ map, normalMap: nmap, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.82, color: 0xffffff });
  const mat = new THREE.Mesh(mg, matMat);
  group.add(mat);

  // punti della cucitura: piccoli segmenti di filo beige
  const stitch = new THREE.BoxGeometry(3.2, 0.5, 0.75);
  const thread = new THREE.MeshStandardMaterial({ color: 0xc9b493, roughness: 0.7 });
  const inset = 9;
  const pts = [];
  const along = (ax, az, bx, bz) => {
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.floor(L / 5.2);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      pts.push([ax + (bx - ax) * t, az + (bz - az) * t, Math.atan2(-(bz - az), bx - ax)]);
    }
  };
  const ex = hx - inset;
  const ez = hz - inset;
  along(-ex + 6, -ez, ex - 6, -ez);
  along(ex, -ez + 6, ex, ez - 6);
  along(ex - 6, ez, -ex + 6, ez);
  along(-ex, ez - 6, -ex, -ez + 6);
  const stitches = new THREE.InstancedMesh(stitch, thread, pts.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  pts.forEach(([x, z, a], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
    m.compose(new THREE.Vector3(x, 0.1, z), q, new THREE.Vector3(1, 1, 1));
    stitches.setMatrixAt(i, m);
  });
  stitches.userData.noSSR = true;
  group.add(stitches);
  return { group, mat, top };
}

// ---------------------------------------------------------------- fogli di carta

/**
 * Un foglio appoggiato sul tappetino (mm): carta un po' imbarcata ai bordi, il contenuto reale come
 * texture. uniforms.uLit (0..1) accende i tratti del disegno di una luce oro rosa.
 */
export function buildSheet(texture, { width, height, curl = 1.4, seed = 1, paper = 0xf3efe6 } = {}) {
  const geo = new THREE.PlaneGeometry(width, height, 48, 32);
  geo.rotateX(-Math.PI / 2);
  const rand = mulberry32(seed);
  const ph = rand() * 6;
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / (width / 2);
    const z = pos.getZ(i) / (height / 2);
    // bordi che si sollevano appena, più sui lati lunghi; un'onda lieve nel mezzo
    const edge = Math.pow(Math.max(Math.abs(z), 0), 6) * curl + Math.pow(Math.abs(x), 8) * curl * 0.6;
    const wave = Math.sin(x * 2.1 + ph) * Math.cos(z * 1.7 + ph) * 0.25;
    pos.setY(i, 0.3 + edge + (wave + 0.25) * 0.5);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    color: paper,
    roughness: 0.92,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  mat.userData.ssr = 0;
  const uniforms = patchCustom(mat, {
    key: 'sheet-lit',
    uniforms: { uLit: { value: 0 }, uLitColor: { value: new THREE.Color(0xffc08c) } },
    fragDecl: 'uniform float uLit; uniform vec3 uLitColor;',
    // i tratti scuri del disegno si accendono di oro rosa; la carta si abbassa un poco perché brillino
    fragRough: `
      float sheetInk = smoothstep(0.62, 0.18, dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)));
      diffuseColor.rgb *= 1.0 - 0.3 * uLit;`,
    fragEmissive: 'totalEmissiveRadiance += uLitColor * uLit * (sheetInk * 3.4 + 0.03);',
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.lit = uniforms.uLit;
  return mesh;
}

// ---------------------------------------------------------------- attrezzi (generici, senza marchi)

const steel = () => new THREE.MeshPhysicalMaterial({ color: 0xc9ccd1, metalness: 1, roughness: 0.22 });
const steelPolished = () => new THREE.MeshStandardMaterial({ color: 0xdfe2e6, metalness: 1, roughness: 0.08 });

// Lente da orologiaio: corpo nero opaco, vetro, coricata sul fianco
export function buildLoupe() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.55 });
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(16, 18.5, 26, 48, 1, true), body);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(16.4, 1.4, 12, 48), body);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 13;
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(16, 40, 12, 0, Math.PI * 2, 0, 0.42),
    new THREE.MeshPhysicalMaterial({ color: 0xe8eef8, metalness: 0, roughness: 0.02, transparent: true, opacity: 0.25, envMapIntensity: 1.6 }),
  );
  glass.position.y = 13 - 16 * Math.cos(0.42);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(15.4, 17.8, 25.6, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.8, side: THREE.BackSide }));
  g.add(shell, inner, rim, glass);
  // coricata: l'asse lungo il banco, appoggiata sul bordo largo
  g.rotation.z = Math.PI / 2 - Math.atan(2.5 / 26);
  g.position.y = 17.6;
  const out = new THREE.Group();
  out.add(g);
  return out;
}

// Pinzette: due lame d'acciaio che convergono in punta
export function buildTweezers() {
  const g = new THREE.Group();
  const mat = steel();
  const L = 120;
  for (const side of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(0, -4.6);
    shape.lineTo(L - 22, -3.4);
    shape.lineTo(L, -0.5);
    shape.lineTo(L, 0.4);
    shape.lineTo(L - 22, 2.6);
    shape.lineTo(0, 4.6);
    shape.lineTo(0, -4.6);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.1, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.3, bevelSegments: 1 });
    geo.rotateX(-Math.PI / 2);
    const blade = new THREE.Mesh(geo, mat);
    // a riposo le pinzette sono aperte: la lama di sotto è piatta sul banco, quella di sopra parte
    // dalla testa e sale verso la punta
    blade.position.y = side > 0 ? 2.2 : 0.4;
    blade.rotation.z = side > 0 ? 0.035 : 0;
    g.add(blade);
  }
  return g;
}

// Cacciavite: manico zigrinato, testa girevole, lama
export function buildScrewdriver() {
  const g = new THREE.Group();
  const knurl = new THREE.MeshStandardMaterial({ color: 0xb9bcc2, metalness: 1, roughness: 0.38 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 62, 24), knurl);
  handle.rotation.z = Math.PI / 2;
  handle.position.x = 31;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 4.6, 6, 24), new THREE.MeshStandardMaterial({ color: 0x23324f, metalness: 0.6, roughness: 0.35 }));
  top.rotation.z = Math.PI / 2;
  top.position.x = -3;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 36, 12), steelPolished());
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = 80;
  const tip = new THREE.Mesh(new THREE.BoxGeometry(5, 0.45, 1.6), steelPolished());
  tip.position.x = 99;
  g.add(handle, top, shaft, tip);
  g.position.y = 4.6;
  const out = new THREE.Group();
  out.add(g);
  return out;
}

// Matita esagonale, legno naturale, punta di grafite
export function buildPencil() {
  const g = new THREE.Group();
  const L = 160;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, L, 6), new THREE.MeshStandardMaterial({ color: 0x23324f, roughness: 0.42 }));
  body.rotation.z = Math.PI / 2;
  const wood = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 3.4, 15, 24), new THREE.MeshStandardMaterial({ color: 0xd8b48a, roughness: 0.8 }));
  wood.rotation.z = -Math.PI / 2;
  wood.position.x = L / 2 + 7.5;
  const lead = new THREE.Mesh(new THREE.ConeGeometry(0.8, 3.2, 12), new THREE.MeshStandardMaterial({ color: 0x2a2a2e, metalness: 0.4, roughness: 0.4 }));
  lead.rotation.z = -Math.PI / 2;
  lead.position.x = L / 2 + 16.6;
  g.add(body, wood, lead);
  g.position.set(-8, 3.6 * Math.cos(Math.PI / 6), 0);
  const out = new THREE.Group();
  out.add(g);
  return out;
}

// ---------------------------------------------------------------- lampada da banco

export function buildLamp({ base, head }) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x1d2236, metalness: 0.7, roughness: 0.35 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc8a76e, metalness: 1, roughness: 0.3 });
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(70, 76, 22, 48), metal);
  foot.position.set(base[0], -MAT.thick + 11, base[1]);
  const postH = head[1] + 70;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, postH, 16), metal);
  post.position.set(base[0], postH / 2, base[1]);
  const joint = new THREE.Mesh(new THREE.SphereGeometry(13, 20, 12), brass);
  joint.position.set(base[0], postH, base[1]);
  const hx = head[0] - base[0];
  const hz = head[2] - base[1];
  const armLen = Math.hypot(hx, hz, postH - head[1]);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, armLen, 12), metal);
  arm.position.set((base[0] + head[0]) / 2, (postH + head[1]) / 2, (base[1] + head[2]) / 2);
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(head[0] - base[0], head[1] - postH, head[2] - base[1]).normalize());
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(26, 62, 70, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0x1d2236, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }));
  shade.position.set(head[0], head[1], head[2]);
  const bulb = new THREE.Mesh(new THREE.CircleGeometry(56, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0d8).multiplyScalar(3.2), toneMapped: false }));
  bulb.rotation.x = Math.PI / 2;
  bulb.position.set(head[0], head[1] - 30, head[2]);
  bulb.userData.noSSR = true;
  g.add(foot, post, joint, arm, shade, bulb);
  return g;
}

// ---------------------------------------------------------------- la scatola blu notte con il pack

// Pittogramma Monichs su canvas (tre triangoli), opzionalmente con la scritta MONICHS sotto
function pictogramCanvas(size, { color, word = false, bg = null }) {
  const c = canvas(size, word ? Math.round(size * 0.62) : size);
  const g = c.getContext('2d');
  if (bg) {
    g.fillStyle = bg;
    g.fillRect(0, 0, c.width, c.height);
  }
  g.fillStyle = color;
  const s = (word ? size * 0.34 : size * 0.8) / 480;
  const ox = c.width / 2 - 540 * s;
  const oy = (word ? size * 0.05 : size * 0.12) - 360 * s;
  for (const p of PICTOGRAM_POLYGONS) {
    const v = p.split(/\s+/).map(Number);
    g.beginPath();
    for (let i = 0; i < v.length; i += 2) g[i ? 'lineTo' : 'moveTo'](ox + v[i] * s, oy + v[i + 1] * s);
    g.closePath();
    g.fill();
  }
  if (word) {
    g.font = `400 ${Math.round(size * 0.075)}px Foslin, Montserrat`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if ('letterSpacing' in g) g.letterSpacing = `${Math.round(size * 0.02)}px`;
    g.fillText('MONICHS', c.width / 2, c.height * 0.8);
  }
  return c;
}

/**
 * Scatola aperta (mm): fuori blu notte con i triangoli in rilievo, dentro blu liscio con il
 * pittogramma tono su tono nel coperchio, sul fondo il pack da viaggio in pelle marrone (due metà)
 * con la placchetta in oro rosa. Origine al centro della base, il fronte verso +Z, la cerniera dietro.
 */
export function buildBox() {
  const g = new THREE.Group();
  const W = 290;
  const D = 230;
  const H = 112;
  const t = 6; // spessore delle pareti
  const pattern = trianglePatternNormal();
  const outside = new THREE.MeshStandardMaterial({ color: 0x1e2a58, roughness: 0.62, normalMap: pattern, normalScale: new THREE.Vector2(0.55, 0.55) });
  const inside = new THREE.MeshStandardMaterial({ color: 0x1a2550, roughness: 0.7 });
  const floor = new THREE.MeshStandardMaterial({ color: 0x2a2626, roughness: 0.95 });
  const panel = (w, h, d, x, y, z, mats) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    // il motivo ripetuto a passo costante (lato del triangolo ~6 mm) su ogni faccia
    const uv = geo.attributes.uv;
    const nrm = geo.attributes.normal;
    const p = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      const ax = Math.abs(nrm.getX(i));
      const ay = Math.abs(nrm.getY(i));
      const [a, b] = ax > 0.5 ? [p.getZ(i), p.getY(i)] : ay > 0.5 ? [p.getX(i), p.getZ(i)] : [p.getX(i), p.getY(i)];
      uv.setXY(i, a / 6, b / (6 * Math.sqrt(3)));
    }
    const m = new THREE.Mesh(geo, mats);
    m.position.set(x, y, z);
    return m;
  };
  // facce: +x, -x, +y, -y, +z, -z (esterno con il motivo, interno liscio)
  const wallX = (sign) => [sign > 0 ? outside : inside, sign > 0 ? inside : outside, inside, outside, outside, outside];
  const box = new THREE.Group();
  box.add(panel(W, t, D, 0, t / 2, 0, [outside, outside, floor, outside, outside, outside]));
  box.add(panel(t, H, D, W / 2 - t / 2, H / 2, 0, wallX(1)));
  box.add(panel(t, H, D, -W / 2 + t / 2, H / 2, 0, wallX(-1)));
  box.add(panel(W - 2 * t, H, t, 0, H / 2, D / 2 - t / 2, [outside, outside, inside, outside, outside, inside]));
  box.add(panel(W - 2 * t, H, t, 0, H / 2, -D / 2 + t / 2, [outside, outside, inside, outside, inside, outside]));
  g.add(box);

  // coperchio sulla cerniera posteriore, aperto oltre la verticale
  const lid = new THREE.Group();
  lid.position.set(0, H, -D / 2);
  const lidPanel = panel(W, t, D, 0, t / 2, D / 2, [outside, outside, outside, inside, outside, outside]);
  lid.add(lidPanel);
  // pittogramma e scritta tono su tono, stampati all'interno del coperchio
  const logoTex = toTexture(pictogramCanvas(512, { color: 'rgba(8, 12, 40, 0.85)', word: true }), { repeat: false });
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(44, 44 * 0.62), new THREE.MeshStandardMaterial({ map: logoTex, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1 }));
  logo.rotation.x = Math.PI / 2;
  logo.position.set(0, -0.15, D * 0.78);
  lid.add(logo);
  lid.rotation.x = -(Math.PI / 2 + 0.2);
  g.add(lid);

  // il pack da viaggio: due metà di pelle cucita, accostate
  const leather = new THREE.MeshPhysicalMaterial({ color: 0x4a2f25, roughness: 0.52, normalMap: leatherNormal(), normalScale: new THREE.Vector2(0.6, 0.6), sheen: 0.4, sheenColor: new THREE.Color(0x8a5a44), sheenRoughness: 0.6 });
  const pack = new THREE.Group();
  const hw = 51;
  const pd = 92;
  const ph = 76;
  for (const side of [-1, 1]) {
    const half = new THREE.Mesh(new RoundedBoxGeometry(hw, ph, pd, 4, 6), leather);
    half.position.set(side * (hw / 2 + 0.6), t + ph / 2, 8);
    // la grana: UV su scala costante
    const uv = half.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.2, uv.getY(i) * 2.2);
    pack.add(half);
  }
  // cuciture beige lungo i bordi superiori delle due metà
  const thread = new THREE.MeshStandardMaterial({ color: 0xcdb48e, roughness: 0.7 });
  const st = new THREE.BoxGeometry(2.2, 0.5, 0.6);
  const sp = [];
  for (const side of [-1, 1]) {
    const cx = side * (hw / 2 + 0.6);
    for (let z = -pd / 2 + 7; z <= pd / 2 - 7; z += 3.6) sp.push([cx - hw / 2 + 4.5, z, Math.PI / 2], [cx + hw / 2 - 4.5, z, Math.PI / 2]);
    for (let x = -hw / 2 + 7; x <= hw / 2 - 7; x += 3.6) sp.push([cx + x, -pd / 2 + 4.5, 0], [cx + x, pd / 2 - 4.5, 0]);
  }
  const stitches = new THREE.InstancedMesh(st, thread, sp.length);
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  sp.forEach(([x, z, a], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
    mtx.compose(new THREE.Vector3(x, t + ph + 0.15, z + 8), q, new THREE.Vector3(1, 1, 1));
    stitches.setMatrixAt(i, mtx);
  });
  stitches.userData.noSSR = true;
  pack.add(stitches);
  // placchetta quadrata in oro rosa satinato, a cavallo delle due metà, con il pittogramma inciso
  const rose = new THREE.MeshPhysicalMaterial({ color: 0xe9ab8f, metalness: 1, roughness: 0.26 });
  const engr = toTexture(pictogramCanvas(256, { color: '#ffffff', bg: '#6e6e6e' }), { srgb: false, repeat: false });
  const plaqueTop = rose.clone();
  plaqueTop.roughness = 0.62;
  plaqueTop.roughnessMap = engr; // l'incisione è più ruvida: si legge come un'ombra opaca
  const plaque = new THREE.Mesh(new RoundedBoxGeometry(17, 2.4, 15, 2, 1.2), [rose, rose, plaqueTop, rose, rose, rose]);
  plaque.position.set(0, t + ph + 1.1, 8 + pd / 2 - 16);
  pack.add(plaque);
  g.add(pack);
  return { group: g, size: { W, D, H }, highlight: [box, lid, pack] };
}
