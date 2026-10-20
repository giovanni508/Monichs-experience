// Tastiera (codici fisici: funziona con layout italiano), mouse con Pointer Lock, gamepad (bonus).
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
    this.gamepad = { active: false, lx: 0, ly: 0, rx: 0, ry: 0, buttons: [] };
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

  idleSeconds() {
    return (performance.now() - this.lastActivity) / 1000;
  }

  onKeyDown(e) {
    this.activity();
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
      x += this.gamepad.lx;
      z -= this.gamepad.ly;
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
      return;
    }
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
    }
    now.forEach((pressed, i) => {
      if (pressed && !prev[i]) this.emit('padbutton', i);
    });
    g.buttons = now;
  }
}
