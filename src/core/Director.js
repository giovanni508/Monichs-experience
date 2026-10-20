import * as THREE from 'three';

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/**
 * Regia dell'esperienza: schermata iniziale ⇄ attrazione → movimento → hub → mondi → epilogo.
 * Stati: 'boot' | 'start' | 'attract' | 'transition' | 'play' | 'epilogue'
 */
export class Director {
  constructor(app) {
    this.app = app;
    this.state = 'boot';
    this.world = null;
    this.progress = { visited: new Set() };
    this.busy = false;
    this.attract = { shots: [], index: 0, time: 0, shot: null };
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
  }

  get playing() {
    return this.state === 'play';
  }

  resetProgress() {
    this.progress = { visited: new Set() };
    for (const w of Object.values(this.app.worlds)) if (w.loaded) w.resetProgress?.();
  }

  async setWorld(id, opts = {}) {
    const app = this.app;
    const next = app.worlds[id];
    if (!next.loaded) await app.whenWorldLoaded(id);
    if (this.world && this.world !== next) this.world.exit();
    app.hotspots.clear();
    app.narrator.clear();
    this.world = next;
    app.player.setWorld(next);
    // il tempo torna normale prima di entrare: un mondo può fermarlo nel suo enter() (la corona da caricare)
    app.clock.setScale(1, 4);
    next.enter(opts);
    if (!opts.attract) app.hotspots.setList(next.hotspots);
    app.player.spawn(next.spawn);
    app.renderer.setPost(next.post, true);
    app.audio.setPalette(next.audioPalette, opts.attract ? 1.5 : 3);
    app.audio.setTickTimbre(next.tickTimbre);
    app.audio.setTickPresence(next.tickPresence, 0);
    // il tic dello scappamento accompagna solo i livelli: tace nel menu, nell'attrazione e nell'epilogo
    app.audio.setTickEnabled(next.tickEnabled && !opts.attract);
    app.ui.setProgress(opts.attract ? null : next.progressState());
  }

  // ------------------------------------------------------------------ schermata iniziale

  async showStart({ fadeOut = true } = {}) {
    const { ui, input } = this.app;
    this.state = 'transition';
    if (fadeOut) await ui.fade(1, 900);
    ui.hideCard();
    ui.showPause(false);
    ui.showEpilogue(false);
    ui.hideHint();
    ui.setPlaying(false);
    input.exitLock();
    this.app.resetFreeLook();
    await this.setWorld('intro');
    ui.showStart(true);
    this.state = 'start';
    await ui.fade(0, 1600);
  }

  // Dal menu iniziale (gesto dell'utente: sblocca audio e pointer lock)
  async enter(target = 'movement') {
    const { ui, input, audio, config } = this.app;
    if (this.state !== 'start' && this.state !== 'attract') return;
    if (!this.app.worlds[target]?.loaded) return;
    audio.unlock();
    input.requestLock();
    this.resetProgress();
    this.state = 'transition';
    ui.showStart(false);
    ui.setAttract(false);
    audio.whoosh(2.2, 0.1);
    await ui.fade(1, 1100);
    await this.setWorld(target, { fromStart: true });
    if (target === 'epilogue') {
      this.state = 'epilogue';
      input.exitLock();
    } else {
      this.state = 'play';
      ui.setPlaying(true);
      ui.showHint(config.kiosk?.hintSeconds ?? 7);
    }
    await ui.fade(0, 1800);
  }

  // Passaggio tra mondi durante il gioco
  async goTo(id, opts = {}) {
    const { ui, input, audio } = this.app;
    if (this.busy) {
      // una richiesta arrivata durante una dissolvenza non va persa: la si esegue subito dopo
      this.pendingGoTo = [id, opts];
      return;
    }
    this.busy = true;
    this.state = 'transition';
    this.app.hotspots.blur();
    this.app.narrator.clear();
    audio.whoosh(2.4, 0.12);
    await ui.fade(1, opts.fadeMs ?? 1300);
    await this.setWorld(id, opts);
    if (id === 'epilogue') {
      this.state = 'epilogue';
      input.exitLock();
      ui.setPlaying(false);
      ui.showPause(false);
    } else {
      this.state = 'play';
      ui.setPlaying(true);
    }
    await ui.fade(0, 1800);
    this.busy = false;
    if (this.pendingGoTo) {
      const [pid, popts] = this.pendingGoTo;
      this.pendingGoTo = null;
      this.goTo(pid, popts);
    }
  }

  completeWorld(id) {
    this.progress.visited.add(id);
    this.goTo('movement', { hub: true, from: id });
  }

  get allWorldsVisited() {
    return ['celeste', 'sunset', 'virentia'].every((w) => this.progress.visited.has(w));
  }

  async restart() {
    if (this.restarting) return;
    this.restarting = true;
    this.pendingGoTo = null;
    // aspetta la fine di un'eventuale transizione in corso
    for (let i = 0; i < 50 && this.busy; i++) await new Promise((r) => setTimeout(r, 100));
    this.busy = true;
    this.app.audio.duckMusic(1, 0.5);
    this.resetProgress();
    await this.showStart();
    this.busy = false;
    this.restarting = false;
  }

  // ------------------------------------------------------------------ modalità attrazione

  buildShots() {
    const shots = [];
    const intro = { world: 'intro', duration: 11 };
    shots.push(intro);
    for (const id of ['movement', 'celeste', 'sunset', 'virentia', 'lab']) {
      const w = this.app.worlds[id];
      if (w?.loaded && w.attractShots?.length) w.attractShots.forEach((s) => shots.push({ ...s, world: id }));
    }
    return shots;
  }

  async startAttract() {
    if (this.state !== 'start' || this.busy) return;
    this.state = 'attract';
    this.attract.shots = this.buildShots();
    this.attract.index = 0;
    this.app.ui.setAttract(true, '');
    await this.playShot(0);
  }

  async playShot(index) {
    const a = this.attract;
    const shots = a.shots;
    if (!shots.length || this.state !== 'attract') return;
    a.index = index % shots.length;
    const shot = shots[a.index];
    a.shot = null;
    await this.app.ui.fade(1, 900);
    if (this.state !== 'attract') return;
    await this.setWorld(shot.world, { attract: true });
    a.shot = shot;
    a.time = 0;
    this.app.ui.setAttract(true, shot.labelKey ? this.app.i18n.t(shot.labelKey) : '');
    this.positionAttractCamera(0);
    await this.app.ui.fade(0, 1300);
  }

  positionAttractCamera(t) {
    const shot = this.attract.shot;
    const cam = this.app.camera;
    if (!shot) return;
    if (shot.world === 'intro') {
      this.world.updateCamera?.(cam, 0);
      return;
    }
    const k = ease(Math.min(1, t));
    this._v1.fromArray(shot.from).lerp(this._v2.fromArray(shot.to), k);
    cam.position.copy(this._v1);
    const lf = this._v1.fromArray(shot.lookFrom || shot.look);
    const lt = this._v2.fromArray(shot.lookTo || shot.look);
    lf.lerp(lt, k);
    cam.lookAt(lf);
  }

  async stopAttract() {
    if (this.state !== 'attract') return;
    this.state = 'transition';
    this.attract.shot = null;
    this.app.ui.setAttract(false);
    await this.showStart();
  }

  updateAttract(dt) {
    const a = this.attract;
    if (!a.shot) return;
    a.time += dt;
    const t = a.time / a.shot.duration;
    this.positionAttractCamera(t);
    if (t >= 1) {
      a.shot = null;
      this.playShot(a.index + 1);
    }
  }
}
