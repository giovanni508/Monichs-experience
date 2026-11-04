import * as THREE from 'three';

// ---------------------------------------------------------------------------------------------
// Cielo-quadrante di Celeste: gradiente azzurro polvere all'orizzonte, lacca blu allo zenit con il
// motivo a triangoli; i 12 indici applicati brillano come costellazioni diurne e di notte si
// accendono di luminescenza. Tutto in un unico shader, senza luci.
// ---------------------------------------------------------------------------------------------

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFrag = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform vec3 uSunDir;
uniform vec3 uHorizon;
uniform vec3 uMid;
uniform vec3 uZenith;
uniform vec3 uNightHorizon;
uniform vec3 uNightZenith;
uniform vec3 uLume;
uniform float uIdxRing;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; } return v; }

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);
  // gradiente diurno
  vec3 day = mix(uHorizon, uMid, smoothstep(0.0, 0.35, h));
  day = mix(day, uZenith, smoothstep(0.35, 0.95, h));
  vec3 nightC = mix(uNightHorizon, uNightZenith, smoothstep(0.0, 0.8, h));
  vec3 col = mix(day, nightC, uNight);

  // coordinate sulla "calotta" del quadrante (proiezione dallo zenit)
  float polar = acos(clamp(h, -1.0, 1.0));           // 0 allo zenit
  vec2 disk = d.xz / max(0.0001, 1.0 + h) * 1.0;     // proiezione stereografica
  float dialMask = smoothstep(1.05, 0.55, polar);   // il quadrante occupa la parte alta del cielo

  // motivo a triangoli (lacca) con riflesso del sole che scorre sulle faccette
  vec2 p = disk * 70.0;
  vec2 s = vec2(p.x - p.y * 0.57735, p.y * 1.1547);
  vec2 f = fract(s);
  float up = step(1.0, f.x + f.y);
  vec3 b = up < 0.5 ? vec3(1.0 - f.x - f.y, f.x, f.y) : vec3(f.x + f.y - 1.0, 1.0 - f.y, 1.0 - f.x);
  float m = min(b.x, min(b.y, b.z));
  float facet = hash(floor(s) + up * 7.0);
  float glint = pow(max(0.0, sin(facet * 6.2831 + dot(uSunDir.xz, disk) * 6.0 + uTime * 0.08)), 24.0);
  float groove = smoothstep(0.0, 0.06, m);
  vec3 lacq = mix(col * 0.9, col * 1.04, groove) + vec3(0.6, 0.75, 1.0) * glint * 0.22 * (1.0 - uNight);
  col = mix(col, lacq, dialMask * 0.85);

  // 12 indici applicati attorno allo zenit
  float ang = atan(disk.x, -disk.y);
  float rr = length(disk);
  float seg = 6.2831 / 12.0;
  float a12 = mod(ang + seg * 0.5, seg) - seg * 0.5;
  float across = abs(a12) * rr;
  float along = rr - uIdxRing;
  float bar = smoothstep(0.011, 0.006, across) * smoothstep(0.055, 0.042, abs(along));
  float idxGlint = 0.55 + 0.45 * sin(uTime * 0.6 + floor((ang + seg * 0.5) / seg) * 1.7);
  vec3 idxDay = vec3(1.0, 0.98, 0.94) * (0.9 + 1.4 * idxGlint);
  col = mix(col, idxDay, bar * (1.0 - uNight));
  col += uLume * bar * uNight * 2.4;

  // stelle (notte)
  vec2 sp = d.xz / (0.3 + h) * 90.0;
  float star = step(0.9965, hash(floor(sp))) * smoothstep(0.05, 0.4, h);
  col += vec3(0.85, 0.9, 1.0) * star * uNight * (0.6 + 0.4 * sin(uTime * 2.0 + hash(floor(sp)) * 40.0));

  // sole morbido
  float sun = max(0.0, dot(d, normalize(uSunDir)));
  col += vec3(1.0, 0.93, 0.82) * (pow(sun, 900.0) * 6.0 + pow(sun, 18.0) * 0.25) * (1.0 - uNight);

  // foschia d'orizzonte
  float haze = smoothstep(0.18, -0.05, h);
  col = mix(col, mix(uHorizon, uNightHorizon, uNight), haze * 0.55);
  gl_FragColor = vec4(col, 1.0);
}`;

export class DialSky {
  constructor({ radius = 2500 } = {}) {
    this.uniforms = {
      uTime: { value: 0 },
      uNight: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.45, 0.42, -0.78).normalize() },
      uHorizon: { value: new THREE.Color(0xd3e0ec) },
      uMid: { value: new THREE.Color(0x8db0d8) },
      uZenith: { value: new THREE.Color(0x1d4bb0) },
      uNightHorizon: { value: new THREE.Color(0x0d1640) },
      uNightZenith: { value: new THREE.Color(0x01021a) },
      uLume: { value: new THREE.Color(0x6ff4ff) },
      uIdxRing: { value: 0.34 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  update(dt, camera) {
    this.uniforms.uTime.value += dt;
    this.mesh.position.copy(camera.position);
  }
}

// ---------------------------------------------------------------------------------------------
// Cielo a gradiente con una texture fotografica sovrapposta (Sunset: le bande reali dell'agata).
// ---------------------------------------------------------------------------------------------

const gradFrag = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform sampler2D uTex;
uniform float uTexMix;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(uHorizon, uMid, smoothstep(0.0, 0.3, h)) : mix(uHorizon, uBottom, smoothstep(0.0, -0.3, h));
  col = mix(col, uTop, smoothstep(0.3, 0.95, h));
  float az = atan(d.x, -d.z);
  vec2 uv = vec2(az / 6.2831 * 2.0 + uTime * 0.002, h * 1.4 + 0.3);
  vec3 tex = texture2D(uTex, uv).rgb;
  col = mix(col, col * 0.5 + tex * 0.7, uTexMix * smoothstep(-0.05, 0.25, h) * (1.0 - smoothstep(0.6, 0.95, h)));
  float sun = max(0.0, dot(d, normalize(uSunDir)));
  col += uSunColor * (pow(sun, 400.0) * 4.0 + pow(sun, 12.0) * 0.45);
  gl_FragColor = vec4(col, 1.0);
}`;

export class GradientSky {
  constructor({ top, mid, horizon, bottom, texture = null, texMix = 0.35, sunDir = new THREE.Vector3(0, 0.2, -1), sunColor = 0xffb070, radius = 2500 } = {}) {
    this.uniforms = {
      uTop: { value: new THREE.Color(top) },
      uMid: { value: new THREE.Color(mid) },
      uHorizon: { value: new THREE.Color(horizon) },
      uBottom: { value: new THREE.Color(bottom) },
      uTex: { value: texture },
      uTexMix: { value: texture ? texMix : 0 },
      uTime: { value: 0 },
      uSunDir: { value: sunDir.clone().normalize() },
      uSunColor: { value: new THREE.Color(sunColor) },
    };
    if (texture) {
      texture.wrapS = THREE.MirroredRepeatWrapping;
      texture.wrapT = THREE.MirroredRepeatWrapping;
      texture.needsUpdate = true;
    }
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: skyVert, fragmentShader: gradFrag, side: THREE.BackSide, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  update(dt, camera) {
    this.uniforms.uTime.value += dt;
    this.mesh.position.copy(camera.position);
  }
}

// ---------------------------------------------------------------------------------------------
// Mare di nuvole: un grande piano con rumore animato, che sfuma nella foschia dell'orizzonte.
// ---------------------------------------------------------------------------------------------

const cloudVert = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const cloudFrag = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform vec3 uCamPos;
uniform vec3 uLight;
uniform vec3 uShadow;
uniform vec3 uNightLight;
uniform vec3 uHorizon;
uniform vec3 uNightHorizon;
uniform sampler2D uNoise;
varying vec3 vWorld;
void main() {
  vec2 p = vWorld.xz * 0.0016 + vec2(uTime * 0.004, uTime * 0.0013);
  float n = texture2D(uNoise, p).r * 0.55 + texture2D(uNoise, p * 2.7 + 0.31).r * 0.3 + texture2D(uNoise, p * 7.1 - uTime * 0.002).r * 0.15;
  float c = smoothstep(0.32, 0.72, n);
  vec3 lit = mix(uLight, uNightLight, uNight);
  vec3 col = mix(uShadow * mix(1.0, 0.25, uNight), lit, smoothstep(0.3, 0.9, n));
  float dist = length(vWorld.xz - uCamPos.xz);
  float fade = smoothstep(2200.0, 600.0, dist);
  col = mix(mix(uHorizon, uNightHorizon, uNight), col, fade);
  float alpha = mix(0.0, 1.0, c) * 0.92 + (1.0 - fade) * 0.9;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`;

export class CloudSea {
  constructor(noiseTex, { y = -40, size = 6000 } = {}) {
    this.uniforms = {
      uTime: { value: 0 },
      uNight: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uLight: { value: new THREE.Color(0xffffff) },
      uShadow: { value: new THREE.Color(0xa8b9cf) },
      uNightLight: { value: new THREE.Color(0x5d6f9c) },
      uHorizon: { value: new THREE.Color(0xd3e0ec) },
      uNightHorizon: { value: new THREE.Color(0x0d1640) },
      uNoise: { value: noiseTex },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: cloudVert,
      fragmentShader: cloudFrag,
      transparent: true,
      depthWrite: false,
    });
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = y;
    this.mesh.renderOrder = -5;
  }

  update(dt, camera) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uCamPos.value.copy(camera.position);
    this.mesh.position.x = camera.position.x;
    this.mesh.position.z = camera.position.z;
  }
}

// ---------------------------------------------------------------------------------------------
// Cielo onirico (DreamSky): un solo shader all'infinito, senza geometria, che costa poco anche su un
// portatile. Gradiente del crepuscolo più caldo verso il bagliore (glowDir), fino a quattro file di
// sagome all'orizzonte (montagne alpine con la neve e il filo di luce sulle creste, oppure cime di
// abeti), sempre più velate con la distanza, la nebbia luminosa ai loro piedi, luna e stelle. Sotto
// l'orizzonte un lago che riflette tutto, oppure la foschia della valle.
// Il movimento usa i valori predefiniti; gli altri mondi passano i loro colori e le loro sagome.
// ---------------------------------------------------------------------------------------------

const dreamFrag = /* glsl */ `
uniform float uTime;
uniform float uDim;
uniform vec3 uGlowDir;
uniform vec3 uMoonDir;
uniform vec3 uZenith;
uniform vec3 uHigh;
uniform vec3 uLow;
uniform vec3 uHorizon;
uniform vec3 uHorizonCool;
uniform vec3 uGlow;
uniform vec3 uRim;
uniform vec3 uSnow;
uniform vec3 uMist;
uniform vec3 uLake;
uniform vec3 uMoon;
uniform vec4 uShape[4];   // base, ampiezza, celle per giro, seme
uniform vec4 uLook[4];    // velo d'aria, neve, tipo (0 montagne, 1 abeti), accesa
uniform vec3 uRock[4];
uniform float uLakeOn;
uniform float uMoonAmt;
uniform float uStarAmt;
uniform float uGlowAmt;
uniform float uMistAmt;
uniform float uRimAmt;
uniform float uOnly;      // 1: solo le sagome, sopra un altro cielo (il resto è scartato)
varying vec3 vDir;

float h1(float x) { return fract(sin(x * 127.1 + 31.7) * 43758.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// rumore periodico sul giro dell'orizzonte (t in [0, 1), P celle per giro): nessuna cucitura
float np(float t, float P, float seed) {
  float x = t * P;
  float i = floor(x);
  float u = smoothstep(0.0, 1.0, fract(x));
  return mix(h1(mod(i, P) + seed), h1(mod(i + 1.0, P) + seed), u);
}
// creste alpine: rumore "a cresta" su quattro ottave; il primo dà i massicci, gli altri le creste
float ridge(float t, float P, float seed) {
  float a = 0.0;
  float w = 0.55;
  for (int k = 0; k < 4; k++) {
    float n = 1.0 - abs(np(t, P, seed + float(k) * 17.0) * 2.0 - 1.0);
    a += w * n * n;
    P *= 2.0;
    w *= 0.42;
  }
  return pow(a, 1.6); // cime più appuntite, valli più distese
}
// cime di abeti: tre file sfasate di punte, ognuna con la sua altezza, larghezza e posizione nella
// cella (niente motivo regolare), sopra la massa ondulata del bosco
float trees(float t, float P, float seed) {
  float x = t * P;
  float best = 0.0;
  for (int j = 0; j < 3; j++) {
    float xx = x + float(j) * 0.37;
    float i = mod(floor(xx), P);
    float s0 = seed + float(j) * 13.0;
    float c = 0.3 + 0.4 * h1(i + s0 + 6.0);
    float hgt = (0.3 + 0.7 * pow(h1(i + s0), 2.0)) * (1.0 - float(j) * 0.18);
    float w = 1.6 + 2.2 * h1(i + s0 + 3.0);
    best = max(best, hgt * max(0.0, 1.0 - abs(fract(xx) - c) * w * 2.0));
  }
  float canopy = 0.2 + 0.12 * np(t, floor(P * 0.2), seed + 11.0) + 0.06 * np(t, floor(P * 0.7), seed + 19.0);
  return max(best, canopy);
}
float shapeH(float t, vec4 sh, float kind) {
  if (kind > 0.5) return sh.x + sh.y * trees(t, sh.z, sh.w);
  float amp = sh.y * (0.4 + 0.6 * smoothstep(0.2, 0.85, np(t, floor(sh.z / 5.0), sh.w + 5.0)));
  return sh.x + amp * ridge(t, sh.z, sh.w);
}

// una fila di sagome: colore, neve sulle cime (due falde, una in luce e una in ombra), filo di luce
// sulla cresta verso il bagliore, velo d'aria che la confonde con l'orizzonte
void silhouette(inout vec3 col, inout float hit, float t, float el, vec4 sh, vec4 lk, vec3 rock, vec3 hor, float glowF) {
  float h = shapeH(t, sh, lk.z);
  if (el >= h) return;
  hit = 1.0;
  vec3 c = rock;
  if (lk.y > 0.0) {
    float e = 0.0012;
    float slope = shapeH(t + e, sh, lk.z) - shapeH(t - e, sh, lk.z);
    float cap = smoothstep(sh.x + sh.y * 0.42, sh.x + sh.y * 0.62, h) * smoothstep(h - sh.y * 0.3, h - sh.y * 0.08, el);
    vec3 snow = uSnow * mix(0.55, 1.0, smoothstep(-0.004, 0.004, slope));
    c = mix(c, snow, cap * lk.y);
  }
  c += uRim * uRimAmt * smoothstep(h - 0.0016, h, el) * (0.08 + 0.42 * glowF * glowF * glowF);
  c = mix(c, hor, lk.x * (1.0 - smoothstep(0.0, h, el) * 0.5));
  col = c;
}

vec3 scene(float t, float el, float glowF, vec3 d, inout float hit) {
  vec3 hor = mix(uHorizonCool, uHorizon, smoothstep(0.15, 1.0, glowF));
  vec3 col = mix(hor, uLow, smoothstep(0.0, 0.12, el));
  col = mix(col, uHigh, smoothstep(0.1, 0.45, el));
  col = mix(col, uZenith, smoothstep(0.4, 0.95, el));
  col += uGlow * uGlowAmt * pow(glowF, 6.0) * exp(-el * 9.0) * 0.9;
  // luna (prima delle sagome: può tramontare dietro le creste)
  float md = dot(normalize(vec3(d.x, el, d.z)), normalize(uMoonDir));
  float disc = smoothstep(0.99935, 0.99945, md);
  col += uMoon * uMoonAmt * (disc * (1.25 + 0.08 * h2(floor(d.xz * 420.0))) + pow(max(md, 0.0), 900.0) * 0.5 + pow(max(md, 0.0), 40.0) * 0.07);
  // stelle: più fitte allo zenit, spente vicino all'orizzonte; ognuna brilla al suo ritmo
  vec2 sp = vec2(t * 1100.0, el * 520.0);
  vec2 ci = floor(sp);
  float r = h2(ci);
  if (r > 0.982 && uStarAmt > 0.0) {
    vec2 o = vec2(h2(ci + 7.1), h2(ci + 3.7)) - 0.5;
    float dd = length(fract(sp) - 0.5 - o * 0.5);
    float b = (r - 0.982) / 0.018;
    float tw = 0.65 + 0.35 * sin(uTime * (0.8 + 2.5 * h2(ci + 1.3)) + r * 40.0);
    col += vec3(1.0, 0.95, 0.9) * uStarAmt * smoothstep(0.2, 0.0, dd) * b * tw * 1.6 * smoothstep(0.06, 0.3, el) * (1.0 - disc * uMoonAmt);
  }
  // le file di sagome, dalla più lontana alla più vicina
  for (int k = 0; k < 4; k++) {
    if (uLook[k].w > 0.5) silhouette(col, hit, t + float(k) * 0.13 + float(k * (k - 1)) * 0.055, el, uShape[k], uLook[k], uRock[k], hor, glowF);
  }
  // nebbia luminosa ai piedi delle sagome, che scorre piano
  float mist = (1.0 - smoothstep(0.0, 0.04, el)) * (0.55 + 0.45 * np(t + uTime * 0.0006, 40.0, 5.0));
  col = mix(col, uMist * mix(0.7, 1.2, glowF), mist * uMistAmt);
  return col;
}

void main() {
  vec3 d = normalize(vDir);
  float t = atan(d.x, d.z) / 6.2831853 + 0.5;
  vec2 gd = normalize(uGlowDir.xz);
  float glowF = dot(normalize(d.xz + vec2(1e-5)), gd) * 0.5 + 0.5;
  vec3 col;
  float hit = 0.0;
  if (d.y >= 0.0) {
    col = scene(t, d.y, glowF, d, hit);
    if (uOnly > 0.5 && hit < 0.5) discard;
  } else if (uOnly > 0.5) {
    discard;
  } else if (uLakeOn > 0.5) {
    // il lago: il cielo e le sagome capovolti, più scuri guardando in basso; le increspature spostano
    // il riflesso di lato (come nei laghi veri, si allunga in verticale), nulla vicino all'orizzonte
    float ae = -d.y;
    float rip = (np(t + uTime * 0.0015, 700.0, 9.0) - 0.5) * 0.006 * smoothstep(0.0, 0.25, ae);
    vec3 refl = scene(t + rip, ae, glowF, vec3(d.x, ae, d.z), hit) * vec3(0.7, 0.72, 0.8);
    float f = 0.12 + 0.88 * pow(1.0 - clamp(ae * 5.0, 0.0, 1.0), 3.0);
    col = mix(uLake, refl, f);
  } else {
    // la valle: foschia che scende verso il basso
    vec3 hor = mix(uHorizonCool, uHorizon, smoothstep(0.15, 1.0, glowF));
    col = mix(uLake, mix(hor, uMist, 0.5), exp(d.y * 10.0));
  }
  gl_FragColor = vec4(col * uDim, 1.0);
}`;

// valori del movimento: crepuscolo blu notte e oro rosa, tre catene di Alpi, lago, luna e stelle
const DREAM_DEFAULTS = {
  colors: {
    zenith: 0x04082a, high: 0x161b52, low: 0x4b3b72, horizon: 0xe6b49c, horizonCool: 0x6a6aa0,
    glow: 0xffc8a2, rim: 0xffc59e, snow: 0xd9d2ec, mist: 0xe0b4b4, lake: 0x050822, moon: 0xf4ead8,
  },
  layers: [
    { kind: 'mountains', base: 0.02, amp: 0.2, cells: 18, seed: 3, color: 0x8a76a6, haze: 0.62, snow: 0.45 },
    { kind: 'mountains', base: 0.008, amp: 0.26, cells: 14, seed: 41, color: 0x40386c, haze: 0.32, snow: 0.8 },
    { kind: 'mountains', base: -0.01, amp: 0.3, cells: 10, seed: 87, color: 0x171a3c, haze: 0.12, snow: 1 },
  ],
  lake: true,
  only: false,
  moon: 1,
  stars: 1,
  glow: 1,
  mist: 0.7,
  rim: 1,
};

export class DreamSky {
  constructor({
    glowDir = new THREE.Vector3(0, 0.05, 1),
    moonDir = new THREE.Vector3(0.46, 0.5, 0.74),
    radius = 2500,
    ...opts
  } = {}) {
    const o = { ...DREAM_DEFAULTS, ...opts, colors: { ...DREAM_DEFAULTS.colors, ...(opts.colors || {}) } };
    const c = (hex) => new THREE.Color(hex);
    const layers = (o.layers || []).slice(0, 4);
    const shape = [];
    const look = [];
    const rock = [];
    for (let i = 0; i < 4; i++) {
      const l = layers[i];
      shape.push(l ? new THREE.Vector4(l.base, l.amp, l.cells, l.seed) : new THREE.Vector4());
      look.push(l ? new THREE.Vector4(l.haze ?? 0.3, l.snow ?? 0, l.kind === 'trees' ? 1 : 0, 1) : new THREE.Vector4());
      rock.push(c(l ? l.color : 0));
    }
    const k = o.colors;
    this.uniforms = {
      uTime: { value: 0 },
      uDim: { value: 1 },
      uGlowDir: { value: glowDir.clone().normalize() },
      uMoonDir: { value: moonDir.clone().normalize() },
      uZenith: { value: c(k.zenith) },
      uHigh: { value: c(k.high) },
      uLow: { value: c(k.low) },
      uHorizon: { value: c(k.horizon) },
      uHorizonCool: { value: c(k.horizonCool) },
      uGlow: { value: c(k.glow) },
      uRim: { value: c(k.rim) },
      uSnow: { value: c(k.snow) },
      uMist: { value: c(k.mist) },
      uLake: { value: c(k.lake) },
      uMoon: { value: c(k.moon) },
      uShape: { value: shape },
      uLook: { value: look },
      uRock: { value: rock },
      uLakeOn: { value: o.lake ? 1 : 0 },
      uMoonAmt: { value: o.moon },
      uStarAmt: { value: o.stars },
      uGlowAmt: { value: o.glow },
      uMistAmt: { value: o.mist },
      uRimAmt: { value: o.rim },
      uOnly: { value: o.only ? 1 : 0 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: skyVert, fragmentShader: dreamFrag, side: THREE.BackSide, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = o.only ? -9 : -10; // le sole sagome si disegnano sopra il cielo del mondo
  }

  update(dt, camera) {
    this.uniforms.uTime.value += dt;
    this.mesh.position.copy(camera.position);
  }
}
