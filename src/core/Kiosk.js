// Modalità fiera: attrazione in loop, reset per inattività, fullscreen (F), riavvio segreto (Shift+R),
// statistiche nascoste (Shift+D). Nessun testo di debug a schermo per default.
export class Kiosk {
  constructor(app) {
    this.app = app;
    const k = app.config.kiosk || {};
    this.idleReset = k.idleResetSeconds ?? 60;
    this.attractAfter = k.attractAfterSeconds ?? 25;
    this.lastActivitySeen = app.input.lastActivity;
  }

  update() {
    const { director, input } = this.app;
    const now = performance.now();
    // mentre i fondatori raccontano il reset per inattività è sospeso; finito il racconto l'attesa
    // riparte da zero, così chi ha guardato senza toccare nulla vede il cartello e l'epilogo
    if (director.world?.holdsIdle) this.heldAt = now;
    const idle = Math.min(input.idleSeconds(), (now - (this.heldAt ?? -Infinity)) / 1000);
    const s = director.state;
    if ((s === 'play' || s === 'epilogue') && idle > this.idleReset && !director.busy) {
      director.restart();
    } else if (s === 'start' && idle > this.attractAfter && !director.busy) {
      director.startAttract();
    } else if (s === 'attract' && input.lastActivity !== this.lastActivitySeen && idle < 0.3) {
      director.stopAttract();
    }
    this.lastActivitySeen = input.lastActivity;
  }

  static toggleFullscreen() {
    const d = document;
    const el = d.documentElement;
    const isFs = d.fullscreenElement || d.webkitFullscreenElement;
    try {
      if (!isFs) {
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        const p = req && req.call(el, { navigationUI: 'hide' });
        if (p && p.catch) p.catch(() => {});
      } else {
        const exit = d.exitFullscreen || d.webkitExitFullscreen;
        const p = exit && exit.call(d);
        if (p && p.catch) p.catch(() => {});
      }
    } catch (e) {
      // fullscreen non disponibile (es. iframe): si ignora
    }
  }
}
