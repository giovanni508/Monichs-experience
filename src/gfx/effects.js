import * as THREE from 'three';

// ------------------------------------------------------------------ raggi di luce volumetrici finti

const shaftVert = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  vH = uv.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const shaftFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  float facing = abs(dot(vN, vV));
  float soft = pow(facing, 2.2);
  float along = smoothstep(0.0, 0.25, vH) * pow(1.0 - vH, 1.4);
  float flicker = 0.88 + 0.12 * sin(uTime * 0.7 + vH * 9.0);
  gl_FragColor = vec4(uColor * uIntensity * soft * along * flicker, 1.0);
}`;

export function lightShaft({ length = 40, radiusTop = 1.5, radiusBottom = 9, color = 0xffd9a8, intensity = 0.12 } = {}) {
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 40, 1, true);
  geo.translate(0, -length / 2, 0); // l'origine è la sorgente, il fascio scende lungo -Y
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: intensity }, uTime: { value: 0 } },
    vertexShader: shaftVert,
    fragmentShader: shaftFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 4;
  m.userData.isShaft = true;
  return m;
}

// ------------------------------------------------------------------ texture morbide

let _glow = null;
export function glowTexture() {
  if (_glow) return _glow;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  _glow = new THREE.CanvasTexture(c);
  _glow.colorSpace = THREE.SRGBColorSpace;
  return _glow;
}

// Alone luminoso sempre rivolto alla camera
export function glowSprite(color = 0xffe0b0, size = 4, opacity = 1) {
  const mat = new THREE.SpriteMaterial({
    map: glowTexture(),
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(size, size, 1);
  s.renderOrder = 6;
  return s;
}

// ------------------------------------------------------------------ testo su piano (etichette 3D)

export function textPlane(lines, { width = 1024, height = 256, font = '500 64px Montserrat', color = '#ede2cd', letterSpacing = 0, align = 'center', size = 10, glow = 0 } = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d');
  const draw = () => {
    g.clearRect(0, 0, width, height);
    const list = Array.isArray(lines) ? lines : [lines];
    list.forEach((ln, i) => {
      const spec = typeof ln === 'string' ? { text: ln } : ln;
      g.font = spec.font || font;
      g.fillStyle = spec.color || color;
      g.textAlign = align;
      g.textBaseline = 'middle';
      if ('letterSpacing' in g) g.letterSpacing = `${spec.letterSpacing ?? letterSpacing}px`;
      if (glow) {
        g.shadowColor = spec.color || color;
        g.shadowBlur = glow;
      }
      const y = spec.y ?? (height / (list.length + 1)) * (i + 1);
      g.fillText(spec.text, align === 'center' ? width / 2 : 20, y);
    });
  };
  draw();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // le lettere scrivono la profondità (solo dove sono piene): la profondità di campo le mette a
  // fuoco alla loro distanza invece di sfocarle come lo sfondo che c'è dietro
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: true, alphaTest: 0.12, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, (size * height) / width), mat);
  mesh.userData.redraw = (newLines) => {
    lines = newLines;
    draw();
    tex.needsUpdate = true;
  };
  return mesh;
}

// ------------------------------------------------------------------ rumore tassellabile (per nuvole, pietra)

export function noiseTexture(size = 256, octaves = 5, seed = 1) {
  const data = new Uint8Array(size * size * 4);
  const rand = mulberry32(seed);
  const grids = [];
  for (let o = 0; o < octaves; o++) {
    const n = 4 << o;
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rand();
    grids.push({ n, g });
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let amp = 0.5;
      let norm = 0;
      for (const { n, g } of grids) {
        const fx = (x / size) * n;
        const fy = (y / size) * n;
        const x0 = Math.floor(fx) % n;
        const y0 = Math.floor(fy) % n;
        const x1 = (x0 + 1) % n;
        const y1 = (y0 + 1) % n;
        const tx = smooth(fx - Math.floor(fx));
        const ty = smooth(fy - Math.floor(fy));
        const a = g[y0 * n + x0] * (1 - tx) + g[y0 * n + x1] * tx;
        const b = g[y1 * n + x0] * (1 - tx) + g[y1 * n + x1] * tx;
        v += (a * (1 - ty) + b * ty) * amp;
        norm += amp;
        amp *= 0.5;
      }
      v /= norm;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.floor(v * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ caricamento texture

const loader = new THREE.TextureLoader();
export function loadTexture(url, { srgb = true, repeat = false, anisotropy = 8 } = {}) {
  return new Promise((resolve) => {
    loader.load(
      url,
      (t) => {
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = anisotropy;
        if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
        resolve(t);
      },
      undefined,
      () => {
        // texture mancante: un pixel neutro, l'esperienza continua
        const d = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
        d.needsUpdate = true;
        resolve(d);
      },
    );
  });
}
