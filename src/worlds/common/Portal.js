import * as THREE from 'three';
import { glowSprite, textPlane } from '../../gfx/effects.js';

const portalVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Finestra del portale: vortice lento nei colori del mondo + il quadrante reale in trasparenza
const portalFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uColA;
uniform vec3 uColB;
uniform sampler2D uMap;
uniform float uHasMap;
uniform float uOpacity;
uniform float uDim;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float swirl = noise(vec2(a * 2.0 + uTime * 0.15 + r * 3.0, r * 4.0 - uTime * 0.3));
  vec3 col = mix(uColA, uColB, smoothstep(0.1, 0.9, swirl + r * 0.3));
  if (uHasMap > 0.5) {
    vec2 uv = vec2(0.5) + p * 0.9;
    float ang = uTime * 0.03;
    uv = vec2(0.5) + mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * (uv - 0.5);
    vec3 dial = texture2D(uMap, uv).rgb;
    col = mix(col * 0.55, dial * 1.05, 0.82 * smoothstep(1.0, 0.6, r));
  }
  float edge = smoothstep(1.0, 0.82, r);
  float glow = smoothstep(0.75, 1.0, r) * 0.9;
  vec3 c = col * (0.7 + 0.25 * edge) + uColB * glow * 0.8;
  c *= mix(1.0, 0.3, uDim);
  gl_FragColor = vec4(c * 0.92, uOpacity * (0.86 + 0.14 * edge));
}`;

/**
 * Portale verso un mondo: anello luminoso, finestra con il quadrante reale, nome in Foslin.
 */
export class Portal {
  constructor({ id, name, ref, colorA, colorB, map = null, radius = 4.6 }) {
    this.id = id;
    this.group = new THREE.Group();
    this.radius = radius;
    this.uniforms = {
      uTime: { value: Math.random() * 10 },
      uColA: { value: new THREE.Color(colorA) },
      uColB: { value: new THREE.Color(colorB) },
      uMap: { value: map },
      uHasMap: { value: map ? 1 : 0 },
      uOpacity: { value: 0 },
      uDim: { value: 0 },
    };
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 64),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: portalVert,
        fragmentShader: portalFrag,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    disc.renderOrder = 3;
    this.disc = disc;
    this.group.add(disc);

    this.ringMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 1, roughness: 0.18, emissive: new THREE.Color(colorB), emissiveIntensity: 0 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.14, 12, 96), this.ringMat);
    this.group.add(ring);
    // minuteria attorno al portale
    const ticks = [];
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const r0 = radius + (i % 5 === 0 ? 0.35 : 0.5);
      const r1 = radius + 0.75;
      ticks.push(Math.cos(a) * r0, Math.sin(a) * r0, 0, Math.cos(a) * r1, Math.sin(a) * r1, 0);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
    this.tickMat = new THREE.LineBasicMaterial({ color: colorB, transparent: true, opacity: 0, depthWrite: false });
    this.ticks = new THREE.LineSegments(tg, this.tickMat);
    this.group.add(this.ticks);

    this.glow = glowSprite(colorB, radius * 4, 0);
    this.group.add(this.glow);

    this.label = textPlane(
      [
        { text: name, font: '400 92px Foslin, Montserrat', letterSpacing: 26, y: 70 },
        { text: ref, font: '500 34px Montserrat', letterSpacing: 10, color: '#d8a28a', y: 150 },
      ],
      { width: 1024, height: 200, size: radius * 1.9 },
    );
    // il nome sta sopra il disco: il portale poggia sul pavimento e chi cammina ci entra dentro
    this.label.position.y = radius + 1.7;
    this.label.material.opacity = 0;
    this.group.add(this.label);

    this.reveal = 0;
    this.targetReveal = 0;
    this.visited = false;
    this.group.visible = false;
  }

  setSubtitle(text) {
    this.subtitle = text;
  }

  show(on = true) {
    this.targetReveal = on ? 1 : 0;
    if (on) this.group.visible = true;
  }

  update(dt, camera) {
    this.uniforms.uTime.value += dt;
    this.reveal += (this.targetReveal - this.reveal) * (1 - Math.exp(-dt * 1.2));
    if (this.reveal < 0.002 && this.targetReveal === 0) this.group.visible = false;
    const r = this.reveal;
    const dim = this.visited ? 1 : 0;
    this.uniforms.uDim.value += (dim - this.uniforms.uDim.value) * (1 - Math.exp(-dt * 2));
    this.uniforms.uOpacity.value = r;
    const pulse = 0.85 + 0.15 * Math.sin(this.uniforms.uTime.value * 1.3);
    this.ringMat.emissiveIntensity = r * (this.visited ? 0.6 : 2.4) * pulse;
    this.tickMat.opacity = r * 0.55;
    this.glow.material.opacity = r * (this.visited ? 0.06 : 0.16) * pulse;
    this.label.material.opacity = r * (this.visited ? 0.55 : 1);
    this.group.scale.setScalar(0.6 + 0.4 * r);
    this.ticks.rotation.z -= dt * 0.02;
    // il portale guarda sempre verso la camera sul piano orizzontale
    if (camera) {
      const p = this.group.position;
      this.group.rotation.y = Math.atan2(camera.position.x - p.x, camera.position.z - p.z);
    }
  }

  // il giocatore (a piedi) entra se attraversa il disco vicino al centro, all'altezza del portale
  contains(pos) {
    if (this.reveal < 0.8) return false;
    const p = this.group.position;
    return Math.hypot(pos.x - p.x, pos.z - p.z) < this.radius * 0.6 && Math.abs(pos.y - p.y) < this.radius * 1.1;
  }
}
