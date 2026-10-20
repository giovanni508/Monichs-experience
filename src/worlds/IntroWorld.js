import * as THREE from 'three';
import { World } from './World.js';
import { DustField } from '../gfx/particles.js';
import { glowSprite, loadTexture } from '../gfx/effects.js';

// Schermata iniziale. Lo sfondo è il film "CELESTE INTRO" in loop, senza audio: un elemento <video>
// nativo tra la scena 3D e il menu. Il browser lo decodifica in hardware e lo mostra alla risoluzione
// piena dello schermo, senza post-processing (grana, tone mapping) né sfocature: resta nitido.
// Se il video manca o non parte, compare l'orologio che respira con una minuteria di luce e la polvere.
// Nel menu il tic dello scappamento tace: si sente solo dentro i livelli.
export class IntroWorld extends World {
  constructor(app) {
    super(app, 'intro');
    this.audioPalette = 'intro';
    this.tickEnabled = false;
    this.post = { bloom: 0.5, bloomThreshold: 0.86, exposure: 1.0, vignette: 0.62, grain: 0.075 };
    this.watchIndex = 0;
    this.video = null;
    this.videoBroken = false;
    this.videoOnFor = 0;
    this.lastTry = 0;
    this.fallbackOn = false;
  }

  async load() {
    const s = this.scene;
    s.background = new THREE.Color(0x02020b);
    s.fog = new THREE.FogExp2(0x02020b, 0.035);
    const cfg = this.app.config.assets || {};
    const intro = this.app.config.intro || {};

    // ---- film di sfondo
    const videoUrl = intro.video ?? 'assets/video/celeste-intro.mp4';
    if (videoUrl) {
      const v = document.createElement('video');
      v.id = 'intro-video';
      v.muted = true;
      v.defaultMuted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.disablePictureInPicture = true;
      v.tabIndex = -1;
      for (const a of ['muted', 'playsinline', 'disablepictureinpicture', 'disableremoteplayback']) v.setAttribute(a, '');
      v.setAttribute('aria-hidden', 'true');
      // luminosità (1 = il film così com'è): attenua senza sfocare
      const b = Math.max(0, Math.min(1, Number(intro.videoBrightness ?? 0.9)));
      if (b < 0.999) v.style.filter = `brightness(${b})`;
      v.src = videoUrl;
      this.app.canvas.after(v);
      this.video = v;
      v.addEventListener('playing', () => {
        if (!this.active) {
          v.pause();
          return;
        }
        this.setFallback(false);
        v.classList.add('on');
      });
      v.addEventListener('error', () => {
        this.videoBroken = true;
        v.classList.remove('on');
        this.setFallback(true);
      });
      // attende i primi fotogrammi (al massimo qualche secondo: l'avvio non si blocca mai)
      await new Promise((resolve) => {
        v.addEventListener('canplay', resolve, { once: true });
        v.addEventListener('error', resolve, { once: true });
        setTimeout(resolve, 4000);
        v.load();
      });
    }

    // ---- riserva: orologio che respira
    const urls = [cfg['watch.celeste'], cfg['watch.sunset'], cfg['watch.virentia']].filter(Boolean);
    this.textures = await Promise.all(urls.map((u) => loadTexture(u, { anisotropy: 4 })));
    this.watchMat = new THREE.MeshBasicMaterial({ map: this.textures[0], transparent: true, depthWrite: false, toneMapped: false });
    this.watch = new THREE.Mesh(new THREE.PlaneGeometry(9.2, 9.2), this.watchMat);
    this.watch.position.set(3.1, -0.15, 0);
    this.watch.renderOrder = 3;
    s.add(this.watch);
    this.halo = glowSprite(0x3a4cff, 13, 0.18);
    this.halo.position.set(3.1, 0.2, -1.5);
    this.halo.renderOrder = 1;
    s.add(this.halo);

    // ---- minuteria luminosa (60 indici, 12 più lunghi)
    const ring = new THREE.Group();
    const segs = [];
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const r0 = i % 5 === 0 ? 7.3 : 7.7;
      segs.push(Math.cos(a) * r0, Math.sin(a) * r0, 0, Math.cos(a) * 8, Math.sin(a) * 8, 0);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    this.ringMat = new THREE.LineBasicMaterial({ color: 0xd8a28a, transparent: true, opacity: 0.16, depthWrite: false });
    ring.add(new THREE.LineSegments(lg, this.ringMat));
    this.circleMat = new THREE.MeshBasicMaterial({ color: 0xede2cd, transparent: true, opacity: 0.08, depthWrite: false });
    ring.add(new THREE.Mesh(new THREE.RingGeometry(8.35, 8.37, 256), this.circleMat));
    ring.position.set(3.1, -0.15, -4);
    this.ring = ring;
    s.add(ring);

    this.dust = new DustField({ count: 900, box: [26, 16, 18], color: 0xe9d6c0, size: 0.55, opacity: 0.45, rise: 0.02 });
    s.add(this.dust.points);

    this.setFallback(!this.video || this.videoBroken);
    this.spawn = { position: new THREE.Vector3(0, 0, 10.5), yaw: 0, pitch: 0 };
    this.loaded = true;
  }

  // Orologio, minuteria e polvere servono solo se il film non c'è (sotto il video sarebbero coperti)
  setFallback(on) {
    this.fallbackOn = on;
    if (!this.watch) return;
    this.watch.visible = on;
    this.halo.visible = on;
    this.ring.visible = on;
    this.dust.points.visible = on;
  }

  playVideo() {
    const v = this.video;
    if (!v || this.videoBroken) return;
    const p = v.play();
    if (p && p.catch) {
      p.catch((e) => {
        // AbortError: play() interrotto da una pausa (uscita rapida dal menu), nessun problema.
        // Altrimenti (riproduzione negata) intanto compare l'orologio e si riprova ogni 3 secondi.
        if (e && e.name === 'AbortError') return;
        if (this.active) this.setFallback(true);
      });
    }
  }

  enter() {
    super.enter();
    this.time = 0;
    this.lastTry = 0;
    this.videoOnFor = 0;
    this.watchMat.map = this.textures[this.watchIndex % this.textures.length] || this.textures[0];
    this.watchMat.needsUpdate = true;
    this.watchIndex++;
    this.playVideo();
  }

  exit() {
    super.exit();
    // fuori dalla schermata iniziale il film si ferma e sparisce subito (si esce sempre a velo chiuso)
    if (this.video) {
      this.video.pause();
      this.video.classList.remove('on');
    }
    this.videoOnFor = 0;
  }

  // Con il film a tutto schermo la scena 3D è coperta: non serve disegnarla (meno lavoro per la GPU)
  get skipRender() {
    return this.videoOnFor > 1.6 && !this.fallbackOn;
  }

  // La camera è guidata dal mondo (nessun controllo del giocatore nella schermata iniziale)
  updateCamera(camera) {
    const t = this.time;
    camera.position.set(Math.sin(t * 0.07) * 0.35, Math.sin(t * 0.05) * 0.18, 10.5);
    camera.lookAt(0.4 + Math.sin(t * 0.06) * 0.1, 0, 0);
  }

  update(dt) {
    super.update(dt);
    const t = this.time;
    const v = this.video;
    if (v && this.active && !this.videoBroken) {
      // se il browser ha sospeso la riproduzione (scheda nascosta, risparmio energetico) riprova ogni 3 s
      if (v.paused && t - this.lastTry > 3) {
        this.lastTry = t;
        this.playVideo();
      }
      this.videoOnFor = v.classList.contains('on') && !v.paused ? this.videoOnFor + dt : 0;
    }
    if (!this.fallbackOn) return;
    // respiro lento (~0,2 Hz): niente lampeggi rapidi
    const breath = 0.5 + 0.5 * Math.sin(t * 1.25);
    this.watch.scale.setScalar(1 + breath * 0.012);
    const b = 0.9 + breath * 0.12;
    this.watchMat.color.setRGB(b, b, b);
    this.halo.material.opacity = 0.12 + breath * 0.1;
    this.ring.rotation.z = -t * 0.01;
    this.ringMat.opacity = 0.11 + breath * 0.06;
    this.dust.update(dt, this.app.camera);
  }
}
