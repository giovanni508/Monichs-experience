import * as THREE from 'three';

// Polvere fluttuante: punti animati interamente nel vertex shader (costo CPU nullo).
// Le particelle vivono in un volume che segue la camera (wrap), così sono sempre intorno al giocatore.
const vert = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform float uPixelRatio;
uniform float uRise;
attribute vec4 aSeed;
varying float vAlpha;
varying float vTw;
void main() {
  vec3 p = position;
  float t = uTime;
  p += vec3(
    sin(t * 0.13 * aSeed.x + aSeed.y * 6.28) * 1.4,
    sin(t * 0.11 * aSeed.y + aSeed.z * 6.28) * 0.9 + t * uRise * (0.4 + aSeed.w),
    cos(t * 0.12 * aSeed.z + aSeed.x * 6.28) * 1.4
  );
  // avvolgi nel volume centrato sulla camera
  vec3 rel = p - uCenter;
  rel = mod(rel + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 wp = uCenter + rel;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  // dissolvenza ai bordi del volume e vicino alla camera
  vec3 edge = abs(rel) / (uBox * 0.5);
  float e = 1.0 - smoothstep(0.7, 1.0, max(max(edge.x, edge.y), edge.z));
  vAlpha = e * smoothstep(0.25, 1.4, dist);
  vTw = 0.55 + 0.45 * sin(t * (0.6 + aSeed.w * 1.7) + aSeed.x * 40.0);
  gl_PointSize = uSize * (0.35 + aSeed.w) * uPixelRatio * (60.0 / max(dist, 0.5));
}`;

const frag = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
varying float vTw;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.0, d);
  a *= a;
  gl_FragColor = vec4(uColor * (0.6 + vTw), a * vAlpha * uOpacity * vTw);
}`;

export class DustField {
  constructor({ count = 1800, box = [60, 30, 60], color = 0xffe1b8, size = 0.9, opacity = 0.55, rise = 0.04 } = {}) {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * box[0];
      pos[i * 3 + 1] = (Math.random() - 0.5) * box[1];
      pos[i * 3 + 2] = (Math.random() - 0.5) * box[2];
      seed[i * 4] = 0.5 + Math.random();
      seed[i * 4 + 1] = Math.random();
      seed[i * 4 + 2] = 0.5 + Math.random();
      seed[i * 4 + 3] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.uniforms = {
      uTime: { value: 0 },
      uSize: { value: size },
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(...box) },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uRise: { value: rise },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.baseCount = count;
  }

  setDensity(f) {
    this.points.geometry.setDrawRange(0, Math.floor(this.baseCount * f));
  }

  update(dt, camera) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uCenter.value.copy(camera.position);
  }
}
