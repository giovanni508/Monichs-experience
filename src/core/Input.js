// Tastiera (codici fisici: funziona con layout italiano), mouse con Pointer Lock e controller (in fiera
// si gioca con quello: mappatura standard, Xbox o PlayStation).
const MOVE_KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
};
const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

export class Input {
  constructor(lockTarget) {
    this.lockTarget = lockTarget;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.lastActivity = performance.now();
    this.handlers = {};
    this.gamepad = { active: false, lx: 0, ly: 0, rx: 0, ry: 0, buttons: [], type: 'xbox', pad: null };
    // l'ultimo dispositivo usato ('kbm' tastiera e mouse, 'pad' controller): decide i suggerimenti a schermo
    this.device = 'kbm';
    this.nav = { dir: null, next: 0 };
    this.lockWanted = false;
    this.lockRequestedAt = -1e9;
    this.enabled = true;
    // senza pointer lock (?nolock, o un browser che lo rifiuta sempre) si guarda trascinando sulla scena
    this.free = false;
    this.press = null;

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.activity();
    });
    // uscendo dalla finestra o dalla scheda: tasti rilasciati, movimenti accumulati scartati
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
    document.addEventListener('mousemove', (e) => {
      // il rilascio del tasto fuori dalla finestra può non arrivare: lo dice lo stato dei tasti
      if (this.mouseHeld && !(e.buttons & 1)) this.mouseHeld = false;
      // un mouse appena sfiorato non cambia dispositivo (vibrazioni del tavolo, un urto)
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 3) this.setDevice('kbm');
      const drag = this.free && this.mouseHeld && this.press?.onScene;
      if (this.locked || drag) {
        // Alcuni browser producono picchi anomali all'aggancio del pointer lock: li scartiamo
        if (Math.abs(e.movementX) < 400 && Math.abs(e.movementY) < 400) {
          this.mouseDX += e.movementX;
          this.mouseDY += e.movementY;
          if (drag) this.press.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
        }
      }
      this.activity();
    });
    document.addEventListener('pointerlockchange', () => {
      this.lockRequestedAt = -1e9;
      this.mouseDX = 0;
      this.mouseDY = 0;
      this.emit('lockchange', this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.lockRequestedAt = -1e9;
      this.emit('lockerror');
    });
    window.addEventListener('mousedown', (e) => {
      this.activity();
      this.setDevice('kbm');
      if (e.button === 0) {
        this.mouseHeld = true;
        // premuto sulla scena e non su un pulsante: senza pointer lock, trascinando si guarda intorno
        this.press = { onScene: e.target === this.lockTarget, moved: 0 };
      }
      this.emit('mousedown', e);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseHeld = false;
      this.emit('mouseup', e);
    });
    window.addEventListener('wheel', () => this.activity(), { passive: true });
    window.addEventListener('touchstart', () => this.activity(), { passive: true });
  }

  on(name, fn) {
    (this.handlers[name] ||= []).push(fn);
    return () => (this.handlers[name] = this.handlers[name].filter((f) => f !== fn));
  }

  emit(name, ...args) {
    (this.handlers[name] || []).forEach((fn) => fn(...args));
  }

  activity() {
    this.lastActivity = performance.now();
  }

  setDevice(d) {
    if (this.device === d) return;
    this.device = d;
    this.emit('device', d);
  }

  // Vibrazione leggera del controller, se c'è e la supporta: strong e weak 0..1, durata in ms
  rumble(strong, weak, ms) {
    const act = this.gamepad.pad?.vibrationActuator;
    if (!act?.playEffect || this.device !== 'pad') return;
    try {
      const p = act.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak });
      if (p?.catch) p.catch(() => {});
    } catch (e) {
      // vibrazione non disponibile: si continua senza
    }
  }

  idleSeconds() {
    return (performance.now() - this.lastActivity) / 1000;
  }

  onKeyDown(e) {
    this.activity();
    this.setDevice('kbm');
    if (PREVENT.has(e.code) && !(e.target instanceof HTMLInputElement)) e.preventDefault();
    if (e.repeat) {
      this.keys.add(e.code);
      return;
    }
    this.keys.add(e.code);
    this.emit('key', e);
  }

  // Stato reale del pointer lock, letto ogni volta dal browser: un flag in memoria può restare
  // "agganciato" se il browser rilascia il mouse senza avvisare (cambio scheda, Alt+Tab, notifiche).
  get locked() {
    return !!this.lockTarget && document.pointerLockElement === this.lockTarget;
  }

  releaseAll() {
    this.keys.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseHeld = false;
    this.press = null;
  }

  // senza pointer lock: il tasto premuto si è spostato abbastanza da essere un trascinamento per guardare
  get dragged() {
    return !!this.press && this.press.moved > 8;
  }

  // "Tieni premuto": Spazio, tasto sinistro del mouse (fermo: trascinare serve a guardare) o A del gamepad
  get actionHeld() {
    return this.keys.has('Space') || this.keys.has('Enter') || (!!this.mouseHeld && !this.dragged) || !!this.gamepad.buttons[0];
  }

  // Alcuni browser non concedono mai il pointer lock (i browser integrati nelle app, per esempio): la
  // richiesta fallisce con WrongDocumentError anche durante un clic, con la pagina visibile e attiva.
  // Lì si passa al mouse libero invece di restare per sempre in pausa. Gli altri rifiuti sono passeggeri
  // (manca il gesto, Esc premuto da meno di un secondo): basta il clic successivo.
  setFree() {
    if (this.free) return;
    this.free = true;
    this.emit('lockunavailable');
  }

  // Va chiamato da un gesto dell'utente (clic, tasto): i browser lo esigono per agganciare il mouse.
  requestLock() {
    this.lockWanted = true;
    if (this.free || this.locked || document.hidden) return;
    if (!this.lockTarget.requestPointerLock) {
      this.setFree();
      return;
    }
    // una richiesta alla volta (mousedown e click dello stesso gesto non devono sovrapporsi)
    const now = performance.now();
    if (now - this.lockRequestedAt < 700) return;
    this.lockRequestedAt = now;
    const gesture = !!navigator.userActivation?.isActive && document.hasFocus();
    const failed = (e) => {
      this.lockRequestedAt = -1e9;
      if (gesture && (e?.name === 'WrongDocumentError' || e?.name === 'NotSupportedError')) this.setFree();
      this.emit('lockerror');
    };
    try {
      const p = this.lockTarget.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(failed);
    } catch (e) {
      failed(e);
    }
  }

  exitLock() {
    this.lockWanted = false;
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  }

  isDown(code) {
    return this.keys.has(code);
  }

  any(codes) {
    return codes.some((c) => this.keys.has(c));
  }

  get slow() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.gamepad.buttons[6] || this.gamepad.buttons[1];
  }

  // Vettore di movimento normalizzato: x = laterale, z = avanti (+1 avanti)
  moveVector(out = { x: 0, z: 0 }) {
    let x = 0;
    let z = 0;
    if (this.any(MOVE_KEYS.forward)) z += 1;
    if (this.any(MOVE_KEYS.back)) z -= 1;
    if (this.any(MOVE_KEYS.right)) x += 1;
    if (this.any(MOVE_KEYS.left)) x -= 1;
    if (this.gamepad.active) {
      const b = this.gamepad.buttons;
      x += this.gamepad.lx + (b[15] ? 1 : 0) - (b[14] ? 1 : 0);
      z += -this.gamepad.ly + (b[12] ? 1 : 0) - (b[13] ? 1 : 0);
    }
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    out.x = x;
    out.z = z;
    return out;
  }

  consumeMouse() {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return [dx, dy];
  }

  // Gamepad: stick sinistro = movimento, destro = sguardo, A = interagisci, Start = entra/menu
  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    const g = this.gamepad;
    if (!pad) {
      g.active = false;
      g.pad = null;
      return;
    }
    g.pad = pad;
    // PlayStation (Sony) ha croce, cerchio, quadrato, triangolo; tutti gli altri le lettere dell'Xbox
    g.type = /054c|sony|dualsense|dualshock|playstation/i.test(pad.id) ? 'playstation' : 'xbox';
    const dz = (v) => (Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84);
    g.lx = dz(pad.axes[0] || 0);
    g.ly = dz(pad.axes[1] || 0);
    g.rx = dz(pad.axes[2] || 0);
    g.ry = dz(pad.axes[3] || 0);
    const prev = g.buttons;
    const now = pad.buttons.map((b) => !!(b && (b.pressed || b.value > 0.5)));
    const moved = g.lx || g.ly || g.rx || g.ry || now.some(Boolean);
    if (moved) {
      g.active = true;
      this.activity();
      this.setDevice('pad');
    }
    now.forEach((pressed, i) => {
      if (pressed && !prev[i]) this.emit('padbutton', i);
    });
    g.buttons = now;

    // menu: croce direzionale o levetta sinistra; tenendo premuto la scelta scorre (dopo 0,42 s, ogni 0,16 s)
    const dir = now[12] ? 'up' : now[13] ? 'down' : now[14] ? 'left' : now[15] ? 'right'
      : g.ly < -0.6 ? 'up' : g.ly > 0.6 ? 'down' : g.lx < -0.6 ? 'left' : g.lx > 0.6 ? 'right' : null;
    const t = performance.now();
    if (dir !== this.nav.dir) {
      this.nav.dir = dir;
      this.nav.next = t + 420;
      if (dir) this.emit('padnav', dir);
    } else if (dir && t >= this.nav.next) {
      this.nav.next = t + 160;
      this.emit('padnav', dir);
    }
  }
}
