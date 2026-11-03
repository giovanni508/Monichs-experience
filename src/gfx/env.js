import * as THREE from 'three';

// Environment map procedurali (PMREM) per riflessi metallici credibili: una sfera a gradiente
// e alcuni "softbox" emissivi, come in uno studio di fotografia di orologi.
const PRESETS = {
  workshop: {
    top: 0x2a2018, horizon: 0x120d0a, bottom: 0x050404,
    boxes: [
      { pos: [-6, 5, 3], size: [7, 1.4], color: 0xffe2c0, power: 9 },
      { pos: [6, 3, -4], size: [1.2, 6], color: 0xffd6a8, power: 6 },
      { pos: [0, 8, -2], size: [5, 5], color: 0xfff1e0, power: 2.2 },
      { pos: [3, -2, 6], size: [4, 0.8], color: 0x9fb4d8, power: 1.6 },
    ],
  },
  intro: {
    top: 0x141632, horizon: 0x07081a, bottom: 0x020208,
    boxes: [
      { pos: [-5, 4, 5], size: [6, 1.2], color: 0xfff0e0, power: 8 },
      { pos: [5, 2, 4], size: [1.2, 5], color: 0xc8d6ff, power: 4 },
      { pos: [0, 7, 0], size: [5, 5], color: 0xffffff, power: 1.2 },
    ],
  },
  sky: {
    top: 0x7aa6d6, horizon: 0xe8eef3, bottom: 0x9fb2c4,
    boxes: [
      { pos: [-4, 6, -5], size: [4, 4], color: 0xffffff, power: 6 },
      { pos: [6, 1, 3], size: [8, 1.2], color: 0xf2f6ff, power: 3 },
      { pos: [0, -3, 6], size: [6, 1], color: 0xc9d8ea, power: 1.5 },
    ],
  },
  night: {
    top: 0x05082a, horizon: 0x0b1236, bottom: 0x02030d,
    boxes: [
      { pos: [-4, 6, -5], size: [3, 3], color: 0xaebfff, power: 2.2 },
      { pos: [6, 1, 3], size: [8, 0.8], color: 0x6ff0ff, power: 0.9 },
    ],
  },
  amber: {
    top: 0x5a2a1a, horizon: 0x2a1209, bottom: 0x0c0503,
    boxes: [
      { pos: [-6, 3, -2], size: [7, 2], color: 0xffb070, power: 9 },
      { pos: [5, 5, 4], size: [2, 6], color: 0xff8a5c, power: 5 },
      { pos: [0, 8, 0], size: [4, 4], color: 0xffe0c0, power: 2 },
      { pos: [2, -1, -7], size: [6, 1], color: 0xb46fff, power: 0.5 },
    ],
  },
  forest: {
    top: 0x1d3322, horizon: 0x0b1610, bottom: 0x030604,
    boxes: [
      { pos: [0, 9, 0], size: [6, 6], color: 0xffd2b8, power: 5 },
      { pos: [-6, 3, 4], size: [6, 1.4], color: 0xffe4c8, power: 4 },
      { pos: [6, 2, -3], size: [1.4, 5], color: 0xa8e0a0, power: 2.5 },
    ],
  },
  stage: {
    top: 0x15172e, horizon: 0x06071a, bottom: 0x020206,
    boxes: [
      { pos: [-5, 6, 4], size: [6, 1.2], color: 0xfff2e4, power: 10 },
      { pos: [5, 6, 4], size: [6, 1.2], color: 0xfff2e4, power: 10 },
      { pos: [0, 2, 7], size: [9, 0.8], color: 0xffd9c0, power: 3 },
      { pos: [0, 8, -4], size: [3, 3], color: 0xc9d4ff, power: 2 },
    ],
  },
};

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const skyFrag = /* glsl */ `
uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
varying vec3 vDir;
void main() {
  float y = vDir.y;
  vec3 c = y > 0.0 ? mix(horizon, top, pow(y, 0.6)) : mix(horizon, bottom, pow(-y, 0.5));
  gl_FragColor = vec4(c, 1.0);
}`;

// Risoluzione delle mappe d'ambiente: 512 tiene nitidi i riflessi sull'acciaio lucidato
const ENV_SIZE = 512;
let studioEnv = null;

// Studio fotografico degli orologi: una "tenda di luce" che avvolge l'orologio davanti (le superfici
// satinate restano chiare), il buio dietro, bandiere nere che disegnano i riflessi sul lucido (lunetta,
// smussi, maglie centrali) e strisce luminose sui fianchi e sopra, come nelle foto ufficiali. Sotto, un
// piano chiaro come il tavolo luminoso dei fotografi: il visitatore guarda spesso i monoliti dal basso,
// e senza il lucido della lunetta rifletterebbe il buio.
// La stanza neutra di three.js (RoomEnvironment) era tutta chiara: l'acciaio ne usciva grigio uniforme,
// come plastica. gain tiene conto delle intensità con cui i mondi usano lo studio (0,4–0,6).
const STUDIO = {
  gain: 1.8,
  front: 0.55, back: 0.1, top: 0.3, bottom: 0.42,
  flags: [
    { pos: [-4.2, 0.5, 8], size: [1.3, 14] },
    { pos: [4.2, 0.5, 8], size: [1.3, 14] },
    { pos: [0, -4.2, 8], size: [14, 1.1] },
  ],
  boxes: [
    { pos: [0, 9, 3], size: [10, 5], power: 3, grad: 0.3 },
    { pos: [-8.5, 1.5, 2], size: [1.8, 10], power: 5 },
    { pos: [8.5, 1.5, 2], size: [1.8, 10], power: 5 },
    { pos: [0, 6, -9], size: [14, 1.4], power: 3, color: 0xdde6ff },
  ],
};

const tentFrag = /* glsl */ `
uniform float uFront; uniform float uBack; uniform float uTop; uniform float uBottom;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float L = mix(uBack, uFront, smoothstep(-0.25, 0.65, d.z)) + uTop * smoothstep(0.35, 0.95, d.y) + uBottom * smoothstep(0.25, 0.9, -d.y);
  gl_FragColor = vec4(vec3(L), 1.0);
}`;

// softbox dai bordi morbidi, più chiaro al centro (grad) come i softbox graduati da still life
const panelVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const panelFrag = /* glsl */ `
uniform vec3 uColor; uniform float uGrad;
varying vec2 vUv;
void main() {
  vec2 d = abs(vUv - 0.5) * 2.0;
  float e = (1.0 - smoothstep(0.65, 1.0, d.x)) * (1.0 - smoothstep(0.65, 1.0, d.y));
  e *= mix(1.0, 1.0 - d.y * d.y, uGrad);
  gl_FragColor = vec4(uColor * e, 1.0);
}`;

function studioScene() {
  const p = STUDIO;
  const scene = new THREE.Scene();
  scene.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(20, 64, 32),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uFront: { value: p.front * p.gain },
          uBack: { value: p.back * p.gain },
          uTop: { value: p.top * p.gain },
          uBottom: { value: p.bottom * p.gain },
        },
        vertexShader: skyVert,
        fragmentShader: tentFrag,
      }),
    ),
  );
  const black = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
  for (const f of p.flags) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(f.size[0], f.size[1]), black);
    m.position.set(...f.pos);
    m.lookAt(0, 0, 0);
    scene.add(m);
  }
  for (const b of p.boxes) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(b.size[0], b.size[1]),
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Color(b.color ?? 0xffffff).multiplyScalar(b.power * p.gain) }, uGrad: { value: b.grad ?? 0.5 } },
        vertexShader: panelVert,
        fragmentShader: panelFrag,
      }),
    );
    m.position.set(...b.pos);
    m.lookAt(0, 0, 0);
    scene.add(m);
  }
  return scene;
}

export function createEnvironment(renderer, presetName = 'workshop') {
  // "studio": lo studio fotografico qui sopra. È sempre uguale: lo si genera una volta sola e lo si
  // condivide (orologi dell'epilogo, monoliti, vetrina di Sunset, cancello di Virentia)
  if (presetName === 'studio') {
    if (studioEnv) return studioEnv;
    const scene = studioScene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromScene(scene, 0, 0.1, 100, { size: ENV_SIZE });
    pmrem.dispose();
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    studioEnv = rt.texture;
    return studioEnv;
  }
  const p = PRESETS[presetName] || PRESETS.workshop;
  const scene = new THREE.Scene();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(20, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(p.top) },
        horizon: { value: new THREE.Color(p.horizon) },
        bottom: { value: new THREE.Color(p.bottom) },
      },
      vertexShader: skyVert,
      fragmentShader: skyFrag,
    }),
  );
  scene.add(sphere);
  for (const b of p.boxes) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(b.size[0], b.size[1]),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(b.color).multiplyScalar(b.power), side: THREE.DoubleSide }),
    );
    m.position.set(...b.pos);
    m.lookAt(0, 0, 0);
    scene.add(m);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.015, 0.1, 100, { size: ENV_SIZE });
  pmrem.dispose();
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  return rt.texture;
}
