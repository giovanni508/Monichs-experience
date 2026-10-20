import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------------------------------------------------------------------------------------------
// Natura per i mondi (alberi, felci, fiori, erba, rocce): modelli GLB di Modelli/3D/natura (ASSETS.md
// §8c), in metri, Y in alto, origine al centro della base. Ogni modello si carica una volta e si
// dispone in centinaia di copie con l'instancing; le copie sono divise in zone, così il renderer
// scarta quelle fuori dall'inquadratura. Il fogliame ondeggia al vento (shader) e può accendersi.
// ---------------------------------------------------------------------------------------------

const loader = new GLTFLoader();
const cache = new Map();
const _m = new THREE.Matrix4();
const _box = new THREE.Box3();

/** Parti di un modello (geometria + materiale), con le trasformazioni del file applicate. */
export function loadNature(url) {
  if (!cache.has(url)) {
    cache.set(
      url,
      new Promise((resolve, reject) => {
        loader.load(
          url,
          (gltf) => {
            gltf.scene.updateMatrixWorld(true);
            const parts = [];
            gltf.scene.traverse((o) => {
              if (!o.isMesh) return;
              const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
              geometry.computeBoundingBox();
              parts.push({ name: o.name, geometry, material: o.material });
            });
            _box.makeEmpty();
            parts.forEach((p) => _box.union(p.geometry.boundingBox));
            resolve({ parts, box: _box.clone(), trunkRadius: trunkRadius(parts) });
          },
          undefined,
          reject,
        );
      }),
    );
  }
  return cache.get(url);
}

// raggio del tronco nel primo metro (alberi): serve alle collisioni
function trunkRadius(parts) {
  const bark = parts.find((p) => /corteccia|tronco|bark/i.test(p.name) || /corteccia|bark/i.test(p.material.name || ''));
  if (!bark) return 0;
  const pos = bark.geometry.attributes.position;
  let r = 0;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 1) r = Math.max(r, Math.hypot(pos.getX(i), pos.getZ(i)));
  return r;
}

const FOLIAGE = /foglie|fronde|leaf|leaves|petal|petali|erba|grass|fern|felce|fiori/i;

/**
 * Vento e luce sul fogliame: le foglie oscillano in proporzione all'altezza (la base resta ferma),
 * ogni copia con la sua fase; `glow` scala una lieve luminosità propria (per esempio con la carica).
 */
export function windMaterial(material, uniforms, { strength = 1, glow = 0 } = {}) {
  const m = material.clone();
  m.side = THREE.DoubleSide;
  if (glow > 0) {
    m.emissive = m.color.clone().multiplyScalar(0.6);
    if (m.map) m.emissiveMap = m.map;
    m.emissiveIntensity = glow;
  }
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = uniforms.uTime;
    shader.uniforms.uWindK = { value: strength };
    shader.uniforms.uNatureGlow = uniforms.uGlow;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWindTime;\nuniform float uWindK;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
  {
    #ifdef USE_INSTANCING
      vec3 wBase = instanceMatrix[3].xyz;
    #else
      vec3 wBase = vec3(0.0);
    #endif
    float ph = dot(wBase.xz, vec2(0.13, 0.17));
    float h = max(position.y, 0.0);
    float sw = sin(uWindTime * 0.9 + ph) * 0.6 + sin(uWindTime * 2.1 + ph * 1.7 + position.x * 0.8) * 0.25;
    transformed.x += sw * h * 0.018 * uWindK;
    transformed.z += cos(uWindTime * 0.7 + ph) * h * 0.012 * uWindK;
  }`,
    );
    if (glow > 0) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNatureGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= uNatureGlow;');
    }
  };
  m.customProgramCacheKey = () => `wind-${glow > 0 ? 'glow' : 'plain'}`;
  return m;
}

/**
 * Dispone copie di un modello: `items` = [{ x, y, z, rot, scale }]. Le copie vanno in zone quadrate
 * di lato `chunk` (un InstancedMesh per parte e per zona). Restituisce il gruppo.
 */
export function scatter(model, items, { chunk = 70, uniforms = null, wind = 1, windAll = false, glow = 0, castShadow = true, receiveShadow = true } = {}) {
  const group = new THREE.Group();
  const zones = new Map();
  for (const it of items) {
    const key = `${Math.floor(it.x / chunk)},${Math.floor(it.z / chunk)}`;
    if (!zones.has(key)) zones.set(key, []);
    zones.get(key).push(it);
  }
  const mats = model.parts.map((p) => {
    // piante piccole: ondeggia tutta la pianta; alberi: solo il fogliame
    const foliage = windAll || FOLIAGE.test(p.name) || FOLIAGE.test(p.material.name || '');
    return foliage && uniforms ? windMaterial(p.material, uniforms, { strength: wind, glow }) : p.material;
  });
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (const list of zones.values()) {
    model.parts.forEach((p, k) => {
      const mesh = new THREE.InstancedMesh(p.geometry, mats[k], list.length);
      list.forEach((it, i) => {
        q.setFromAxisAngle(up, it.rot || 0);
        sc.setScalar(it.scale || 1);
        _m.compose(pos.set(it.x, it.y, it.z), q, sc);
        mesh.setMatrixAt(i, _m);
      });
      mesh.computeBoundingSphere();
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      if (!castShadow) mesh.userData.noCastShadow = true; // enableShadows non la riaccende
      const foliage = mats[k] !== p.material;
      // il fogliame (piani con trasparenza a soglia) resta fuori dal G-buffer dei riflessi
      if (foliage) mesh.userData.noSSR = true;
      group.add(mesh);
    });
  }
  return group;
}
