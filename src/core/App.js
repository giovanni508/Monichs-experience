import * as THREE from 'three';
import { Renderer } from '../gfx/Renderer.js';
import { Input } from './Input.js';
import { Player } from './Player.js';
import { AudioEngine } from './Audio.js';
import { I18n, loadJSON } from './Content.js';
import { UI } from '../ui/UI.js';
import { Narrator } from './Narrator.js';
import { Hotspots } from './Hotspots.js';
import { Director } from './Director.js';
import { Kiosk } from './Kiosk.js';
import { MechClock } from '../mech/Caliber.js';
import { IntroWorld } from '../worlds/IntroWorld.js';
import { MovementWorld } from '../worlds/MovementWorld.js';
import { CelesteWorld } from '../worlds/CelesteWorld.js';
import { SunsetWorld } from '../worlds/SunsetWorld.js';
import { VirentiaWorld } from '../worlds/VirentiaWorld.js';
import { LabWorld } from '../worlds/LabWorld.js';
import { EpilogueWorld } from '../worlds/EpilogueWorld.js';

const params = new URLSearchParams(location.search);

export class App {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.uiRoot = document.getElementById('ui');
    this.debug = params.has('debug');
    this.noLock = params.has('nolock');
    this.worlds = {};
    this.loadWaiters = {};
    this.time = 0;
    this.last = performance.now();
    this.fpsAcc = { frames: 0, time: 0, fps: 0 };
    this.statsOn = false;
    this.pauseShown = false;
    this.padPaused = false; // pausa chiesta dal controller (Menu): senza pointer lock non c'è altro modo
    this.padResetT = 0;
  }

  setBoot(p) {
    const bar = document.querySelector('#boot .bar');
    if (bar) bar.style.strokeDashoffset = String(402 * (1 - p));
  }

  async boot() {
    this.setBoot(0.08);
    const [texts, config, index] = await Promise.all([
      loadJSON('content/texts.json'),
      loadJSON('content/config.json'),
      // indice dei file in assets/: dice se un file facoltativo c'è (voci registrate, modelli dei fondatori)
      loadJSON('assets/index.json').catch(() => null),
    ]);
    this.config = config;
    this.assetIndex = index?.files ? new Set(index.files) : null;
    this.setBoot(0.2);

    // Font del logo (Foslin, dal pacchetto del brand): solo per parole senza accenti
    try {
      const faces = [
        new FontFace('Foslin', 'url(assets/fonts/Foslin-Regular.otf)', { weight: '400' }),
        new FontFace('Foslin', 'url(assets/fonts/Foslin-Bold.otf)', { weight: '700' }),
      ];
      await Promise.all(faces.map((f) => f.load().then((ff) => document.fonts.add(ff))));
    } catch (e) {
      // fallback su Montserrat
    }
    await document.fonts.ready;
    this.setBoot(0.3);

    const lang = params.get('lang') || config.language?.default || 'it';
    this.i18n = new I18n(texts, lang, config.language?.available || ['it', 'en']);
    document.documentElement.lang = this.i18n.lang;

    this.renderer = new Renderer(this.canvas, { quality: params.get('quality') || config.quality?.level || 'auto', preserve: this.debug });
    this.camera = this.renderer.camera;
    this.input = new Input(this.canvas);
    this.player = new Player(this.camera);
    this.clock = new MechClock();
    this.audio = new AudioEngine();
    this.audio.init({ volume: config.audio?.volume ?? 0.8, muted: config.audio?.startMuted ?? false, piano: config.audio?.piano ?? 1 });
    this.ui = new UI(this.uiRoot, this.i18n, config);
    this.ui.setMuted(this.audio.muted);
    if (this.noLock) {
      this.input.free = true;
      this.ui.setFreeLook(true);
    }
    this.ui.loadLogo(config.assets?.logo || 'assets/logo/monichs-logo.svg');
    this.ui.setQR(config.cta?.enabled === false ? '' : config.cta?.qr?.enabled === false ? '' : config.cta?.qr?.url);
    this.narrator = new Narrator(this.ui, this.i18n);
    this.hotspots = new Hotspots({ ui: this.ui, audio: this.audio, onVisited: (h) => this.director.world?.onHotspotVisited?.(h) });
    this.director = new Director(this);
    this.kiosk = new Kiosk(this);
    this.bindEvents();
    if (this.debug) this.installDebug();

    // Mondi
    const W = { intro: IntroWorld, movement: MovementWorld, celeste: CelesteWorld, sunset: SunsetWorld, virentia: VirentiaWorld, lab: LabWorld, epilogue: EpilogueWorld };
    for (const [id, Cls] of Object.entries(W)) this.worlds[id] = new Cls(this);

    await this.loadWorld('intro');
    this.setBoot(0.55);

    // Avvio del loop e della schermata iniziale
    this.renderer.renderer.setAnimationLoop(() => this.frame());
    const boot = document.getElementById('boot');
    const direct = params.get('world');
    if (direct && this.worlds[direct]) {
      await this.loadWorld(direct);
      boot.classList.add('hidden');
      this.director.state = 'start';
      await this.director.enter(direct);
    } else {
      await this.director.showStart({ fadeOut: false });
      this.setBoot(1);
      boot.classList.add('hidden');
    }

    // Caricamento progressivo degli altri mondi, in ordine di percorso
    const order = ['movement', 'celeste', 'sunset', 'virentia', 'lab', 'epilogue'];
    let done = 0;
    for (const id of order) {
      this.ui.setLoading(done / order.length);
      await this.loadWorld(id);
      done++;
      this.ui.setWorldReady(id, true);
      this.ui.setLoading(done / order.length);
    }

  }

  // Strumenti di verifica (solo con ?debug nell'URL; nulla a schermo)
  installDebug() {
    window.monichs = this;
    window.tp = (x, y, z, yaw = 0, pitch = 0) => this.player.spawn({ position: new THREE.Vector3(x, y, z), yaw, pitch });
    window.step = (n = 30, dt = 1 / 30) => {
      for (let i = 0; i < n; i++) {
        this.last = performance.now() - dt * 1000;
        this.frame();
      }
      return this.time.toFixed(2);
    };
    window.look = (x, y, z, tx, ty, tz, n = 40) => {
      const dx = tx - x;
      const dy = ty - y;
      const dz = tz - z;
      window.tp(x, y, z, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
      return window.step(n);
    };
    // a piedi: cammina verso (x, z) guardando la meta; si ferma se bloccato
    window.walkTo = (x, z, maxFrames = 1500, tol = 0.9) => {
      const p = this.player;
      this.input.keys.add('KeyW');
      let last = null;
      let stuck = 0;
      for (let i = 0; i < maxFrames; i++) {
        const dx = x - p.position.x;
        const dz = z - p.position.z;
        if (Math.hypot(dx, dz) < tol) break;
        p.yaw = p.targetYaw = Math.atan2(-dx, -dz);
        window.step(1, 1 / 30);
        if (last && Math.hypot(p.position.x - last.x, p.position.z - last.z) < 0.01) {
          if (++stuck > 20) break;
        } else stuck = 0;
        last = p.position.clone();
      }
      this.input.keys.delete('KeyW');
      window.step(4, 1 / 30);
      return p.position.toArray().map((v) => +v.toFixed(2));
    };
    window.lookAtPt = (x, y, z) => {
      const p = this.player;
      const dx = x - p.position.x;
      const dz = z - p.position.z;
      p.yaw = p.targetYaw = Math.atan2(-dx, -dz);
      p.pitch = p.targetPitch = Math.atan2(y - p.position.y, Math.hypot(dx, dz));
      window.step(2, 1 / 30);
    };
    window.tpWalk = (x, z, y = this.player.position.y) => {
      const p = this.player;
      p.spawn({ position: new THREE.Vector3(x, y, z), yaw: p.yaw, pitch: p.pitch });
      window.step(3, 1 / 30);
      return p.position.toArray().map((v) => +v.toFixed(2));
    };
    // mostra/nasconde le aree calpestabili e gli ostacoli del mondo corrente
    window.walkDebug = (on = true) => {
      const w = this.director.world;
      if (w._walkDbg) {
        w.scene.remove(w._walkDbg);
        w._walkDbg = null;
      }
      if (on && w.walk) {
        w._walkDbg = w.walk.debugObject();
        w.scene.add(w._walkDbg);
      }
    };
    // cattura del canvas a una risoluzione fissa, salvata dal server di sviluppo (vedi vite.config.js)
    window.shot = async (name = 'shot', w = 1280, h = 720) => {
      const r = this.renderer;
      r.renderer.setPixelRatio(1);
      r.renderer.setSize(w, h, false);
      r.composer.setSize(w, h, false);
      r.camera.aspect = w / h;
      r.camera.updateProjectionMatrix();
      r.render(this.director.world.scene, 1 / 60);
      const url = this.canvas.toDataURL('image/jpeg', 0.86);
      r.resize();
      const res = await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
      return res.text();
    };
    // attende lo stato "play", toglie velo e suggerimento (per le catture)
    window.ready = async () => {
      for (let i = 0; i < 60 && this.director.state !== 'play'; i++) {
        await new Promise((r) => setTimeout(r, 400));
        window.step(4);
      }
      const veil = document.getElementById('veil');
      veil.style.transition = 'none';
      veil.style.opacity = 0;
      this.ui.hideHint();
      return this.director.state;
    };
  }

  /** C'è questo file fra gli asset? (senza indice si prova comunque a caricarlo) */
  hasAsset(url) {
    if (!this.assetIndex) return true;
    return this.assetIndex.has(url.replace(/^\.?\//, '').replace(/^assets\//, ''));
  }

  async loadWorld(id) {
    const w = this.worlds[id];
    if (w.loaded) return;
    if (!w._loading) {
      w._loading = (async () => {
        await w.load();
        w.loaded = true;
        // precompila gli shader con la camera in posizione di partenza
        this.camera.position.copy(w.spawn.position);
        await this.renderer.precompile(w.scene);
        (this.loadWaiters[id] || []).forEach((r) => r());
      })();
    }
    await w._loading;
  }

  whenWorldLoaded(id) {
    if (this.worlds[id].loaded) return Promise.resolve();
    return new Promise((r) => (this.loadWaiters[id] ||= []).push(r));
  }

  get controlsActive() {
    return this.director.state === 'play' && (this.input.locked || this.input.gamepad.active || this.noLock);
  }

  bindEvents() {
    const { ui, input, audio, i18n } = this;

    ui.on('enter', (target) => this.director.enter(target));
    ui.on('mute', () => this.toggleMute());
    ui.on('lang', (l) => i18n.setLang(l));
    ui.on('resume', () => {
      this.padPaused = false;
      // con il controller non serve agganciare il mouse
      if (input.device !== 'pad') input.requestLock();
      audio.unlock();
      this.syncPause();
    });
    ui.on('home', () => this.director.restart());
    ui.on('restart', () => this.director.restart());

    input.on('key', (e) => {
      audio.unlock();
      const st = this.director.state;
      if (e.code === 'KeyR' && e.shiftKey) {
        this.director.restart();
        return;
      }
      if (e.code === 'KeyD' && e.shiftKey) {
        this.statsOn = ui.toggleStats();
        return;
      }
      if (e.code === 'KeyF') {
        Kiosk.toggleFullscreen();
        if (st === 'play') setTimeout(() => input.requestLock(), 50);
        return;
      }
      if (e.code === 'KeyM') {
        this.toggleMute();
        return;
      }
      if (e.code === 'KeyL' && (st === 'start' || st === 'epilogue' || !input.locked)) {
        i18n.toggle();
        return;
      }
      // in pausa Spazio e Invio riprendono (riagganciano il mouse) invece di interagire
      if ((e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') && this.pauseShown) {
        input.requestLock();
        return;
      }
      if (e.code === 'Space') {
        if (st === 'play') this.interact();
        else if (st === 'start' && this.worlds.movement.loaded) this.director.enter('movement');
        else if (st === 'epilogue') this.director.restart();
        return;
      }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        if (st === 'start' && this.worlds.movement.loaded) this.director.enter('movement');
        else if (st === 'epilogue') this.director.restart();
        else if (st === 'play' && !input.locked) input.requestLock();
      }
    });

    input.on('mousedown', (e) => {
      audio.unlock();
      const st = this.director.state;
      if (st !== 'play') return;
      if (e.target.closest && e.target.closest('#ui .interactive')) return;
      if (!input.locked && !this.noLock) {
        input.requestLock();
        return;
      }
      // senza pointer lock il tasto premuto può diventare un trascinamento per guardare: si interagisce al rilascio
      if (e.button === 0 && !this.noLock) this.interact();
    });

    input.on('mouseup', (e) => {
      if (!this.noLock || this.director.state !== 'play' || e.button !== 0) return;
      if (!input.press?.onScene || input.dragged) return;
      this.interact();
    });

    input.on('lockchange', () => this.syncPause());
    input.on('lockerror', () => this.syncPause());
    // il browser non concede mai il pointer lock: si gioca con il mouse libero invece di restare in pausa
    input.on('lockunavailable', () => {
      this.noLock = true;
      ui.setFreeLook(true);
      this.syncPause();
      if (this.director.state === 'play') ui.showHint(this.config.kiosk?.hintSeconds ?? 7);
    });

    // Controller (mappatura standard): A 0, B 1, Y 3, View 8, Menu 9, croce 12–15.
    // Menu: la croce o la levetta scelgono, A conferma, Menu entra subito nel tempo, Y cambia lingua.
    // In gioco: A interagisce (tenuto: carica, salta), Menu mette in pausa. In pausa: A conferma la scelta,
    // B o Menu riprendono. Epilogo: A o Menu ricominciano.
    input.on('padbutton', (i) => {
      audio.unlock();
      const st = this.director.state;
      if (st === 'start') {
        if (i === 0 && !ui.activatePadFocus()) this.director.enter('movement');
        else if (i === 9) this.director.enter('movement');
        else if (i === 3) i18n.toggle();
      } else if (st === 'play') {
        if (this.pauseShown) {
          if (i === 0) ui.activatePadFocus();
          else if (i === 1 || i === 9) ui.emit('resume');
          else if (i === 3) i18n.toggle();
        } else if (i === 9) {
          this.padPaused = true;
          this.syncPause();
        } else if (i === 0) this.interact();
      } else if (st === 'epilogue') {
        if (i === 0 || i === 9) this.director.restart();
        else if (i === 3) i18n.toggle();
      }
    });
    input.on('padnav', (dir) => {
      const st = this.director.state;
      if (st === 'start' || (st === 'play' && this.pauseShown)) ui.movePadFocus(dir);
    });
    // i suggerimenti seguono il dispositivo in uso (tastiera e mouse o controller, Xbox o PlayStation)
    input.on('device', (d) => ui.setInputDevice(d, input.gamepad.type));

    document.addEventListener('visibilitychange', () => {
      this.last = performance.now();
      this.syncPause();
    });
  }

  // La pausa segue lo stato reale del mouse, ricontrollato a ogni fotogramma: qualunque cosa sia
  // successa (Esc, cambio scheda, Alt+Tab, un evento perso dal browser) compare "Il tempo è sospeso"
  // e un clic, Spazio o Invio riagganciano il mouse.
  syncPause() {
    // fuori dal gioco la pausa del controller non vale più (si riparte puliti)
    if (this.director.state !== 'play') this.padPaused = false;
    const lockPause = !this.noLock && !this.input.locked && !this.input.gamepad.active;
    const want = this.director.state === 'play' && (this.padPaused || lockPause);
    if (want === this.pauseShown) return;
    this.pauseShown = want;
    this.ui.showPause(want);
    this.narrator.paused = want;
  }

  // A ogni ritorno al menu si riprova il pointer lock: il mouse libero scelto da solo vale per una visita
  // (in un browser che lo rifiuta sempre si ripassa al mouse libero con il clic su "Entra nel tempo").
  resetFreeLook() {
    if (params.has('nolock') || !this.input.free) return;
    this.input.free = false;
    this.noLock = false;
    this.ui.setFreeLook(false);
  }

  interact() {
    if (this.hotspots.interact()) return;
    this.director.world?.onInteract?.();
  }

  toggleMute() {
    this.audio.unlock();
    this.audio.setMuted(!this.audio.muted);
    this.ui.setMuted(this.audio.muted);
  }

  frame() {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.0001, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;

    this.input.pollGamepad();
    // staff: View e Menu tenuti insieme per 2 s riportano alla schermata iniziale, da qualunque punto
    const pb = this.input.gamepad.buttons;
    this.padResetT = pb[8] && pb[9] ? this.padResetT + dt : 0;
    if (this.padResetT > 2) {
      this.padResetT = -1e9;
      this.director.restart();
    }
    this.syncPause();
    if (!params.has('noidle')) this.kiosk.update();
    this.clock.update(dt);

    const d = this.director;
    const world = d.world;
    if (world) {
      if (d.state === 'attract') d.updateAttract(dt);
      else if (d.state === 'start' || (d.state === 'transition' && world.id === 'intro')) world.updateCamera?.(this.camera, dt);
      else if (d.state === 'epilogue' && world.updateCamera) world.updateCamera(this.camera, dt);
      else this.player.update(dt, this.input, this.controlsActive);

      world.update(dt, this.time);

      if (d.state === 'play') {
        const fwd = this._fwd || (this._fwd = new THREE.Vector3());
        this.camera.getWorldDirection(fwd);
        this.hotspots.update(dt, this.player.position, fwd);
      }
      this.narrator.update(dt);
      this.audio.update(dt, this.clock);
      // nel menu il film copre la scena: niente rendering (e la qualità non si misura su fotogrammi vuoti)
      if (!world.skipRender) {
        this.renderer.updateQuality(dt);
        this.renderer.render(world.scene, dt);
      }
    }

    if (this.statsOn) {
      const f = this.fpsAcc;
      f.frames++;
      f.time += dt;
      if (f.time > 0.5) {
        f.fps = f.frames / f.time;
        f.frames = 0;
        f.time = 0;
        const info = this.renderer.renderer.info;
        const p = this.player.position;
        this.ui.setStats(
          `${f.fps.toFixed(0)} fps · ${this.renderer.level.name} · ${info.render.calls} draw · ${(info.render.triangles / 1000).toFixed(0)}k tri\n` +
            `${d.state} · ${world?.id} · pos ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)} · ×${this.clock.scale.toFixed(2)}`,
        );
      }
    }
  }
}
