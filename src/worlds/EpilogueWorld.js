import * as THREE from 'three';
import { World } from './World.js';
import { DustField } from '../gfx/particles.js';
import { glowSprite, textPlane } from '../gfx/effects.js';
import { createEnvironment } from '../gfx/env.js';
import { createWatch } from '../gfx/watchModel.js';
import { SunShadow, enableShadows } from '../gfx/shadows.js';

const reflVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const MM = 0.128; // unità di scena per millimetro: l'orologio in piedi è alto circa 9 unità

// EPILOGO: i tre orologi completi, i modelli 3D ricostruiti sulle quote dei disegni tecnici,
// in piedi su fondo scuro, luce da still life; girano appena per mostrare volumi e fianchi.
export class EpilogueWorld extends World {
  constructor(app) {
    super(app, 'epilogue');
    this.audioPalette = 'epilogue';
    // come nel menu, qui niente tic: è una schermata d'attesa (per riattivarlo: tickEnabled = true)
    this.tickEnabled = false;
    this.tickTimbre = 'soft';
    this.tickPresence = 0.45;
    this.post = {
      bloom: 0.38,
      bloomThreshold: 0.95,
      exposure: 1.0,
      vignette: 0.72,
      grain: 0.07,
      ao: { radius: 0.5, intensity: 2 },
      ssr: { intensity: 1, maxDistance: 12, thickness: 0.15 },
    };
  }

  async load() {
    const s = this.scene;
    s.background = new THREE.Color(0x03031a);
    s.fog = new THREE.FogExp2(0x03031a, 0.02);
    // studio neutro per il rendering di prodotto: sull'acciaio le sfumature bianche delle foto ufficiali
    s.environment = createEnvironment(this.app.renderer.renderer, 'studio');
    s.environmentIntensity = 0.6;
    const cfg = this.app.config.assets || {};
    const ids = ['sunset', 'celeste', 'virentia'];
    const models = await Promise.all(ids.map((id) => createWatch(id, cfg[`model.${id}`] || `assets/models/${id}.glb`)));

    // luce da still life: due strisce morbide nell'ambiente, una principale calda e un controluce freddo
    const key = new THREE.DirectionalLight(0xfff1e2, 2.0);
    key.position.set(-7, 10, 14);
    s.add(key);
    const rim = new THREE.DirectionalLight(0xbfd2ff, 1.3);
    rim.position.set(9, 6, -12);
    s.add(rim);
    s.add(new THREE.HemisphereLight(0x8a96c8, 0x08080f, 0.3));

    // fondale: gradiente navy del brand
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 60),
      new THREE.ShaderMaterial({
        uniforms: { uTop: { value: new THREE.Color(0x000035) }, uBottom: { value: new THREE.Color(0x020208) } },
        vertexShader: reflVert,
        fragmentShader: `uniform vec3 uTop; uniform vec3 uBottom; varying vec2 vUv;
          void main() { float r = length((vUv - vec2(0.5, 0.62)) * vec2(1.0, 1.7)); vec3 c = mix(uTop * 1.35, uBottom, smoothstep(0.0, 0.62, r)); gl_FragColor = vec4(c, 1.0); }`,
        depthWrite: false,
      }),
    );
    bg.position.set(0, 4, -18);
    s.add(bg);

    this.watches = [];
    const defs = [
      { x: -8, z: -0.4, glow: 0xff7a40, name: 'SUNSET', ref: 'REF. M-002' },
      { x: 0, z: 0.5, glow: 0x3f6dff, name: 'CELESTE', ref: 'REF. M-001' },
      { x: 8, z: -0.4, glow: 0x4fd06a, name: 'VIRENTIA', ref: 'REF. M-003' },
    ];
    defs.forEach((d, i) => {
      const g = new THREE.Group();
      const watch = models[i].setScale(MM).upright();
      // perno al centro della cassa (il modello ha l'origine sul fondello); gira solo l'orologio
      watch.object.position.z = -5 * MM;
      const turn = new THREE.Group();
      turn.add(watch.object);
      g.add(turn);
      const glow = glowSprite(d.glow, 13, 0.16);
      glow.position.set(0, 0.6, -1.5);
      g.add(glow);
      const label = textPlane(
        [
          { text: d.name, font: '400 84px Foslin, Montserrat', letterSpacing: 22, color: '#ede2cd', y: 64 },
          { text: d.ref, font: '500 30px Montserrat', letterSpacing: 9, color: '#d8a28a', y: 136 },
        ],
        { width: 1024, height: 190, size: 4.2 },
      );
      label.position.set(0, -5.4, 0.1);
      g.add(label);
      g.position.set(d.x, 0.4, d.z);
      g.userData = { base: g.position.clone(), phase: i * 1.7, glow, label, watch, turn };
      s.add(g);
      this.watches.push(g);
    });
    // linea d'orizzonte sottile
    const line = new THREE.Mesh(new THREE.PlaneGeometry(40, 0.02), new THREE.MeshBasicMaterial({ color: 0xede2cd, transparent: true, opacity: 0.12 }));
    line.position.set(0, -3.95, 0);
    s.add(line);

    // ombre della luce da still life sugli orologi stessi: lancette e lunetta sul quadrante
    enableShadows(s);
    s.userData.shadow = new SunShadow(key, { extent: 14, distance: 40, center: new THREE.Vector3(0, 0.4, 0), normalBias: 0.01, bias: -0.0002, radius: 2 });

    this.dust = new DustField({ count: 500, box: [30, 16, 20], color: 0xede2cd, size: 0.45, opacity: 0.4, rise: 0.02 });
    s.add(this.dust.points);
    this.spawn = { position: new THREE.Vector3(0, 1.4, 17), yaw: 0, pitch: 0 };
    this.loaded = true;
  }

  enter(opts = {}) {
    super.enter(opts);
    this.time = 0;
    this.watches.forEach((w) => {
      w.userData.label.material.opacity = 0;
      w.scale.setScalar(0.92);
      w.userData.watch.setNight(0); // i materiali sono condivisi con Celeste, che di notte li accende
    });
    if (!opts.attract) {
      this.app.ui.showEpilogue(true);
      // dal laboratorio no: "Mon, mio. Montre, orologio." l'hanno già detto i fondatori
      if (!opts.fromLab) this.app.narrator.say('epilogue.name', { delay: 3.5, hold: 5 });
    }
  }

  exit() {
    super.exit();
    this.app.ui.showEpilogue(false);
  }

  updateCamera(camera) {
    const t = this.time;
    const k = 1 - Math.exp(-t * 0.18);
    camera.position.set(Math.sin(t * 0.05) * 0.6, 1.6 + Math.sin(t * 0.07) * 0.15, 19 - k * 3);
    camera.lookAt(0, 0.9, 0);
  }

  update(dt) {
    super.update(dt);
    const t = this.time;
    const now = new Date();
    this.watches.forEach((w, i) => {
      const u = w.userData;
      const appear = THREE.MathUtils.smoothstep(t, 0.6 + i * 0.5, 3 + i * 0.5);
      w.position.y = u.base.y + Math.sin(t * 0.5 + u.phase) * 0.12;
      w.scale.setScalar(0.92 + appear * 0.08);
      // giro lento da vetrina: si vedono fianchi, corona e bracciale, poi torna il quadrante
      u.turn.rotation.y = Math.sin(t * 0.21 + u.phase) * 0.55;
      u.watch.setTime(now);
      u.label.material.opacity = THREE.MathUtils.smoothstep(t, 2.5 + i * 0.4, 4.5 + i * 0.4);
      u.glow.material.opacity = 0.1 + 0.06 * Math.sin(t * 0.6 + u.phase);
    });
    this.dust.update(dt, this.app.camera);
  }
}
