import { pick } from '../core/Content.js';

// Pittogramma Monichs (tre triangoli) — dal file del brand MNC_B25_Pic.svg
export const PICTOGRAM_POLYGONS = [
  '653.8 483.4 539 713 768.1 712.7 653.8 483.4',
  '424.5 483.7 309.7 713.2 538.8 713 424.5 483.7',
  '538.4 598.4 653.1 368.9 424 369.1 538.4 598.4',
];

export function pictogramSVG(extra = '') {
  return `<svg viewBox="300 360 480 360" ${extra} aria-hidden="true">${PICTOGRAM_POLYGONS.map((p) => `<polygon points="${p}"/>`).join('')}</svg>`;
}

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

// Bandiere per la scelta della lingua (vettoriali, disegnate qui: nessun file esterno)
const FLAGS = {
  it: `<svg viewBox="0 0 3 3" aria-hidden="true"><rect width="1" height="3" fill="#009246"/><rect x="1" width="1" height="3" fill="#f1f2f1"/><rect x="2" width="1" height="3" fill="#ce2b37"/></svg>`,
  en: `<svg viewBox="15 0 30 30" aria-hidden="true"><clipPath id="uk-t"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/></clipPath><path d="M0,0 v30 h60 v-30 z" fill="#012169"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 L60,30 M60,0 L0,30" clip-path="url(#uk-t)" stroke="#c8102e" stroke-width="4"/><path d="M30,0 v30 M0,15 h60" stroke="#fff" stroke-width="10"/><path d="M30,0 v30 M0,15 h60" stroke="#c8102e" stroke-width="6"/></svg>`,
};

export class UI {
  constructor(root, i18n, config) {
    this.root = root;
    this.i18n = i18n;
    this.config = config;
    this.handlers = {};
    this.cardHotspot = null;
    this.subtitleTimer = null;
    this.hintTimer = null;
    // Con il controller (in fiera si gioca con quello) i suggerimenti mostrano i suoi pulsanti e i menu
    // si scorrono con la croce; config.kiosk.controller li mostra già prima che qualcuno lo tocchi
    this.device = config.kiosk?.controller ? 'pad' : 'kbm';
    this.padType = 'xbox';
    this.padFocused = null;
    document.body.classList.toggle('input-pad', this.device === 'pad');
    this.build();
    i18n.onChange(() => this.refreshTexts());
  }

  on(name, fn) {
    (this.handlers[name] ||= []).push(fn);
  }

  emit(name, ...args) {
    (this.handlers[name] || []).forEach((fn) => fn(...args));
  }

  t(key, vars) {
    return this.i18n.t(key, vars);
  }

  // ------------------------------------------------------------------ costruzione

  build() {
    const r = this.root;

    this.veil = el('div');
    this.veil.id = 'veil';
    r.appendChild(this.veil);

    // Angolo: lingua (bandiere) + audio, sempre visibili
    this.corner = el('div');
    this.corner.id = 'corner';
    this.langSwitch = el('div', 'lang interactive');
    this.langSwitch.setAttribute('role', 'radiogroup');
    this.i18n.available.forEach((code) => {
      const b = el('button', 'flag');
      b.dataset.lang = code;
      b.setAttribute('role', 'radio');
      b.innerHTML = FLAGS[code] || `<span class="code">${code.toUpperCase()}</span>`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.emit('lang', code);
      });
      this.langSwitch.appendChild(b);
    });
    this.muteBtn = el('button', 'interactive');
    this.muteBtn.id = 'mute';
    this.muteBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path class="wave" d="M15.3 9.2c.9.8 1.4 1.8 1.4 2.8s-.5 2-1.4 2.8"/><path class="wave w2" d="M17.8 6.8c1.6 1.4 2.5 3.2 2.5 5.2s-.9 3.8-2.5 5.2"/><path class="cross" d="M16 9.5l5 5M21 9.5l-5 5"/></svg>`;
    this.muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.emit('mute');
    });
    this.corner.append(this.langSwitch, this.muteBtn);
    r.appendChild(this.corner);

    this.buildStart();

    // Indicatore del percorso (anello come una minuteria)
    this.progress = el('div', 'hidden');
    this.progress.id = 'progress';
    this.progress.innerHTML = `<svg viewBox="-24 -24 48 48"><circle class="ring" r="20"/><g class="ticks"></g><line class="hand" x1="0" y1="0" x2="0" y2="-13"/></svg><div class="label"><div class="part"></div><div class="name"></div></div>`;
    r.appendChild(this.progress);

    this.hint = el('div', 'hidden');
    this.hint.id = 'hint';
    r.appendChild(this.hint);

    this.subtitles = el('div');
    this.subtitles.id = 'subtitles';
    this.subA = el('p');
    this.subB = el('p');
    this.subtitles.append(this.subA, this.subB);
    this.subFlip = false;
    r.appendChild(this.subtitles);

    // Card hotspot
    this.card = el('div');
    this.card.id = 'card';
    this.card.innerHTML = `<div class="head"><div class="loupe"><img alt=""></div><div><div class="kicker"></div><h2 class="title"></h2></div></div><p class="body"></p><p class="poem"></p><div class="action"><span class="key"></span><span class="label"></span></div>`;
    r.appendChild(this.card);

    // Pausa
    this.pause = el('div', 'hidden interactive');
    this.pause.id = 'pause';
    this.pause.innerHTML = `<div class="box"><div class="big"></div><div class="small"></div><div class="row"><button class="crown-btn resume"><span class="lbl"></span><span class="crown">${pictogramSVG()}</span></button><button class="text-btn home"></button></div></div>`;
    this.pause.addEventListener('click', (e) => {
      if (e.target.closest('.home')) this.emit('home');
      else this.emit('resume');
    });
    r.appendChild(this.pause);

    // Epilogo
    this.epilogue = el('div', 'hidden');
    this.epilogue.id = 'epilogue';
    this.epilogue.innerHTML = `<div class="quote"></div><div class="panel interactive"><div class="claim"><div class="it"></div><div class="en"></div></div><div class="cta"><div class="txt"></div><div class="qr"></div></div><button class="crown-btn restart"><span class="lbl"></span><span class="crown">${pictogramSVG()}</span></button></div>`;
    this.epilogue.querySelector('.restart').addEventListener('click', (e) => {
      e.stopPropagation();
      this.emit('restart');
    });
    r.appendChild(this.epilogue);

    // Laboratorio: "tieni premuto per saltare", con un anello che si riempie mentre si tiene premuto
    this.skip = el('div', 'hidden');
    this.skip.id = 'skip';
    this.skip.innerHTML = `<svg viewBox="-12 -12 24 24" aria-hidden="true"><circle class="track" r="10"/><circle class="fill" r="10" pathLength="1"/></svg><span class="lbl"></span>`;
    r.appendChild(this.skip);
    this.skipOn = false;

    // Laboratorio: dissolvenza nel bianco caldo e cartello finale, senza logo (l'epilogo ha già il suo)
    this.labEndEl = el('div', 'hidden');
    this.labEndEl.id = 'lab-end';
    this.labEndEl.innerHTML = `<div class="sign"><p class="title"></p><p class="names"></p></div>`;
    r.appendChild(this.labEndEl);

    this.stats = el('div', 'hidden');
    this.stats.id = 'stats';
    r.appendChild(this.stats);

    this.refreshTexts();
  }

  buildStart() {
    const s = el('div');
    s.id = 'start';
    s.innerHTML = `
      <header class="top">
        <div class="logo"></div>
        <div class="tagline"></div>
      </header>
      <section class="hero">
        <div class="title">INSIDE MONICHS</div>
        <h1 class="lead"></h1>
        <div class="cta-row">
          <button class="crown-btn enter interactive" disabled><span class="lbl"></span><span class="crown">${pictogramSVG()}</span></button>
          <span class="loading"></span>
        </div>
      </section>
      <footer class="bottom">
        <nav class="chapters">
          <div class="label"></div>
          <div class="list"></div>
        </nav>
        <div class="controls"></div>
      </footer>`;
    this.root.appendChild(s);
    this.start = s;
    this.enterBtn = s.querySelector('.enter');
    this.enterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.emit('enter', 'movement');
    });

    const list = s.querySelector('.chapters .list');
    this.chapterBtns = {};
    const chapters = [
      { id: 'movement', color: 'var(--rose)', ref: 'SW200-2' },
      { id: 'celeste', color: 'var(--celeste)', ref: 'M-001' },
      { id: 'sunset', color: 'var(--sunset)', ref: 'M-002' },
      { id: 'virentia', color: 'var(--virentia)', ref: 'M-003' },
      { id: 'lab', color: 'var(--rose-2)', ref: '' },
    ];
    chapters.forEach((c, i) => {
      const b = el('button', 'chapter interactive');
      b.style.setProperty('--c', c.color);
      b.disabled = true;
      b.innerHTML = `<span class="bar"></span><span class="num">${ROMAN[i]}</span><span class="name"></span><span class="ref">${c.ref}</span>`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.emit('enter', c.id);
      });
      list.appendChild(b);
      this.chapterBtns[c.id] = b;
    });

    // la dissolvenza d'ingresso del menu riparte ogni volta che si torna alla schermata iniziale
    this.startEntrance = () => {
      s.classList.remove('enter-anim');
      void s.offsetWidth;
      s.classList.add('enter-anim');
    };
    this.attractCue = el('div', 'hidden');
    this.attractCue.id = 'attract-cue';
    this.attractCue.innerHTML = `<div class="press"></div><div class="where"></div>`;
    this.root.appendChild(this.attractCue);
  }

  async loadLogo(url) {
    try {
      const res = await fetch(url);
      const svg = await res.text();
      const box = this.start.querySelector('.logo');
      box.innerHTML = svg.replace(/<\?xml[^>]*>/, '');
      const svgEl = box.querySelector('svg');
      svgEl.removeAttribute('id');
      svgEl.setAttribute('aria-label', 'MONICHS');
    } catch (e) {
      this.start.querySelector('.logo').innerHTML = `<div style="font-family:var(--font-logo);font-size:2rem;letter-spacing:.2em">MONICHS</div>`;
    }
  }

  // Il nome di un pulsante come è scritto sul controller (PlayStation: simboli; gli altri: lettere Xbox)
  padLabel(b) {
    const ps = this.padType === 'playstation';
    return { a: ps ? '✕' : 'A', b: ps ? '○' : 'B', y: ps ? '△' : 'Y', lt: ps ? 'L2' : 'LT', menu: ps ? 'Options' : 'Menu', view: ps ? 'Create' : 'View' }[b];
  }

  // Legenda dei comandi del controller: levette, A, grilletto per andare piano, Menu per la pausa
  padLegendHTML() {
    const k = (label, cls = '') => `<span class="key${cls ? ` ${cls}` : ''}">${label}</span>`;
    return [
      `<span>${k('L', 'stick')} ${this.t('ui.controls.move')}</span>`,
      `<span>${k('R', 'stick')} ${this.t('ui.controls.look')}</span>`,
      `<span>${k(this.padLabel('a'), 'btn')} ${this.t('ui.controls.interact')}</span>`,
      `<span>${k(this.padLabel('lt'), 'wide')} ${this.t('ui.controls.slow')}</span>`,
      `<span>${k(this.padLabel('menu'), 'wide')} ${this.t('ui.controls.pause')}</span>`,
    ].join('');
  }

  controlsHTML() {
    if (this.device === 'pad') return this.padLegendHTML();
    const k = (label, wide) => `<span class="key${wide ? ' wide' : ''}">${label}</span>`;
    return [
      `<span>${k('W')}${k('A')}${k('S')}${k('D')} ${this.t('ui.controls.move')}</span>`,
      `<span>${k(this.t(this.freeLook ? 'ui.keys.drag' : 'ui.keys.mouse'), true)} ${this.t('ui.controls.look')}</span>`,
      `<span>${k('Shift', true)} ${this.t('ui.controls.slow')}</span>`,
      `<span>${k(this.t('ui.keys.space'), true)} ${this.t('ui.controls.interact')}</span>`,
      `<span>${k('F')} ${this.t('ui.controls.fullscreen')}</span>`,
    ].join('');
  }

  refreshTexts() {
    const lang = this.i18n.lang;
    this.langSwitch.setAttribute('aria-label', this.t('ui.language'));
    this.langSwitch.querySelectorAll('button').forEach((b) => {
      const on = b.dataset.lang === lang;
      const name = this.i18n.has(`ui.languageName.${b.dataset.lang}`) ? this.t(`ui.languageName.${b.dataset.lang}`) : b.dataset.lang.toUpperCase();
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.setAttribute('aria-label', name);
      b.title = name;
    });
    this.muteBtn.setAttribute('aria-label', this.t('ui.mute'));
    const s = this.start;
    s.querySelector('.tagline').textContent = this.t('ui.tagline');
    s.querySelector('.lead').innerHTML = this.t('ui.lead').replace(/\n/g, '<br>');
    this.enterBtn.querySelector('.lbl').textContent = this.t('ui.enter');
    s.querySelector('.chapters .label').textContent = this.t('ui.chapters');
    for (const id of Object.keys(this.chapterBtns)) {
      this.chapterBtns[id].querySelector('.name').textContent = this.t(`ui.chapter.${id}`);
    }
    s.querySelector('.controls').innerHTML = this.controlsHTML();
    const pad = this.device === 'pad';
    this.attractCue.querySelector('.press').textContent = this.t(pad ? 'ui.pressAnyPad' : 'ui.pressAny');
    this.pause.querySelector('.big').textContent = this.t('ui.pause.title');
    this.pause.querySelector('.small').textContent = this.t(pad ? 'ui.pause.hintPad' : 'ui.pause.hint', { A: this.padLabel('a'), B: this.padLabel('b') });
    this.pause.querySelector('.resume .lbl').textContent = this.t('ui.pause.resume');
    this.pause.querySelector('.home').textContent = this.t('ui.pause.home');
    this.skip.querySelector('.lbl').textContent = this.t('lab.skip');
    this.labEndEl.querySelector('.title').textContent = this.t('lab.card.title');
    this.labEndEl.querySelector('.names').textContent = this.t('lab.card.names');
    this.refreshEpilogue();
    if (this.loadingKey) this.setLoading(this.loadingValue, this.loadingKey);
    if (this.cardHotspot) this.fillCard(this.cardHotspot);
    if (this.progressState) this.setProgress(this.progressState);
    if (this.hintShowing) this.hint.innerHTML = this.hintHTML();
  }

  // ------------------------------------------------------------------ start / attract

  showStart(show = true) {
    this.start.classList.toggle('hidden', !show);
    if (show) {
      this.setAttract(false);
      this.startEntrance();
      this.focusPad(this.enterBtn);
    } else this.attractCue.classList.add('hidden');
  }

  setAttract(on, whereText = '') {
    this.start.classList.toggle('attract', on);
    this.attractCue.classList.toggle('hidden', !on);
    this.attractCue.querySelector('.where').textContent = whereText;
  }

  setLoading(value, key = 'ui.loading') {
    this.loadingValue = value;
    this.loadingKey = key;
    const l = this.start.querySelector('.loading');
    if (value >= 1) {
      l.textContent = '';
      return;
    }
    l.textContent = `${this.t(key)} ${Math.round(value * 100)}%`;
  }

  setWorldReady(id, ready) {
    if (id === 'movement') this.enterBtn.disabled = !ready;
    if (this.chapterBtns[id]) this.chapterBtns[id].disabled = !ready;
  }

  // ------------------------------------------------------------------ velo (dissolvenze)

  fade(to, ms = 1000) {
    return new Promise((resolve) => {
      const v = this.veil;
      v.style.transition = `opacity ${ms}ms cubic-bezier(0.4, 0, 0.2, 1)`;
      // forza il reflow perché la transizione parta dal valore corrente
      void v.offsetWidth;
      v.style.opacity = String(to);
      setTimeout(resolve, ms + 30);
    });
  }

  // ------------------------------------------------------------------ indicatore percorso

  // state: { partKey, nameKey, total, done: Set|Array di indici, current }
  setProgress(state) {
    this.progressState = state;
    if (!state) {
      this.progress.classList.add('hidden');
      return;
    }
    this.progress.classList.remove('hidden');
    const g = this.progress.querySelector('.ticks');
    const n = state.total;
    let html = '';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x1 = Math.sin(a) * 16;
      const y1 = -Math.cos(a) * 16;
      const x2 = Math.sin(a) * 20.5;
      const y2 = -Math.cos(a) * 20.5;
      const done = state.done && (state.done.has ? state.done.has(i) : state.done.includes(i));
      const cls = done ? 'tick done' : i === state.current ? 'tick current' : 'tick';
      html += `<line class="${cls}" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
    }
    g.innerHTML = html;
    const doneCount = state.done ? (state.done.size ?? state.done.length) : 0;
    const angle = n ? (doneCount / n) * 360 : 0;
    this.progress.querySelector('.hand').style.transform = `rotate(${angle}deg)`;
    this.progress.querySelector('.part').textContent = this.t(state.partKey);
    this.progress.querySelector('.name').textContent = this.t(state.nameKey);
  }

  // ------------------------------------------------------------------ suggerimento comandi

  hintHTML() {
    if (this.device === 'pad') return this.padLegendHTML();
    const k = (label, wide) => `<span class="key${wide ? ' wide' : ''}">${label}</span>`;
    return [
      `<span>${k('W')}${k('A')}${k('S')}${k('D')} ${this.t('ui.controls.move')}</span>`,
      `<span>${k(this.t(this.freeLook ? 'ui.keys.drag' : 'ui.keys.mouse'), true)} ${this.t('ui.controls.look')}</span>`,
      `<span>${k('Shift', true)} ${this.t('ui.controls.slow')}</span>`,
      `<span>${k(this.t('ui.keys.space'), true)} ${this.t('ui.controls.interact')}</span>`,
    ].join('');
  }

  showHint(seconds = 7) {
    clearTimeout(this.hintTimer);
    this.hint.innerHTML = this.hintHTML();
    this.hint.classList.remove('hidden');
    this.hintShowing = true;
    this.hintTimer = setTimeout(() => this.hideHint(), seconds * 1000);
  }

  hideHint() {
    clearTimeout(this.hintTimer);
    this.hint.classList.add('hidden');
    this.hintShowing = false;
  }

  // senza pointer lock: cursore visibile anche in gioco, e nel suggerimento "Trascina" invece di "Mouse"
  setFreeLook(on) {
    this.freeLook = on;
    document.body.classList.toggle('free-look', on);
    // comandi del menu e suggerimento in gioco
    this.refreshTexts();
  }

  // ------------------------------------------------------------------ sottotitoli

  setSubtitle(text, speaker = '') {
    // due paragrafi alternati per una dissolvenza incrociata morbida
    const show = this.subFlip ? this.subB : this.subA;
    const hide = this.subFlip ? this.subA : this.subB;
    hide.classList.remove('on');
    this.subtitles.classList.toggle('has-text', !!text);
    if (text) {
      // nel laboratorio, sopra la battuta, il nome di chi parla
      show.textContent = '';
      if (speaker) {
        const who = document.createElement('span');
        who.className = 'who';
        who.textContent = speaker;
        show.appendChild(who);
      }
      show.appendChild(document.createTextNode(text));
      void show.offsetWidth;
      show.classList.add('on');
      this.subFlip = !this.subFlip;
    } else {
      show.classList.remove('on');
    }
  }

  // ------------------------------------------------------------------ card

  fillCard(h) {
    const base = h.textKey;
    const c = this.card;
    c.querySelector('.kicker').textContent = h.kickerKey ? this.t(h.kickerKey, h.kickerVars) : '';
    c.querySelector('.title').textContent = this.t(`${base}.title`);
    c.querySelector('.body').textContent = this.t(`${base}.body`);
    c.querySelector('.poem').textContent = this.i18n.has(`${base}.poem`) ? this.t(`${base}.poem`) : '';
    const loupe = c.querySelector('.loupe');
    if (h.image) {
      loupe.classList.remove('none');
      const img = loupe.querySelector('img');
      if (img.getAttribute('src') !== h.image) img.src = h.image;
    } else loupe.classList.add('none');
    const act = c.querySelector('.action');
    if (h.actionKey && !h.actionDone) {
      act.classList.remove('none');
      const key = act.querySelector('.key');
      key.textContent = this.device === 'pad' ? this.padLabel('a') : this.t('ui.keys.space');
      key.classList.toggle('btn', this.device === 'pad');
      act.querySelector('.label').textContent = this.t(h.actionKey);
    } else act.classList.add('none');
  }

  showCard(h) {
    this.cardHotspot = h;
    this.fillCard(h);
    this.card.classList.add('on');
    document.body.classList.add('card-open');
  }

  hideCard() {
    this.cardHotspot = null;
    this.card.classList.remove('on');
    document.body.classList.remove('card-open');
  }

  // ------------------------------------------------------------------ pausa / epilogo / stato

  showPause(show) {
    this.pause.classList.toggle('hidden', !show);
    if (show) this.focusPad(this.pause.querySelector('.resume'));
  }

  // ------------------------------------------------------------------ menu con il controller

  setInputDevice(device, padType = this.padType) {
    if (device === this.device && padType === this.padType) return;
    this.device = device;
    this.padType = padType;
    document.body.classList.toggle('input-pad', device === 'pad');
    this.refreshTexts();
    if (device === 'pad' && !this.focusables().includes(this.padFocused)) this.focusPad(this.focusables()[0]);
  }

  // i pulsanti su cui si muove il controller nella schermata visibile
  focusables() {
    if (!this.pause.classList.contains('hidden')) return [...this.pause.querySelectorAll('button')];
    if (!this.epilogue.classList.contains('hidden')) return [this.epilogue.querySelector('.restart')];
    if (!this.start.classList.contains('hidden')) return [this.enterBtn, ...Object.values(this.chapterBtns)].filter((b) => !b.disabled);
    return [];
  }

  // la scelta corrente (si vede solo usando il controller: body.input-pad)
  focusPad(elm) {
    this.padFocused?.classList.remove('pad-focus');
    this.padFocused = elm || null;
    this.padFocused?.classList.add('pad-focus');
  }

  // la croce sposta la scelta sul pulsante più vicino in quella direzione
  movePadFocus(dir) {
    const list = this.focusables();
    if (!list.length) return false;
    const cur = list.includes(this.padFocused) ? this.padFocused : null;
    if (!cur) {
      this.focusPad(list[0]);
      return true;
    }
    const center = (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const c0 = center(cur);
    let best = null;
    let bestScore = Infinity;
    for (const e of list) {
      if (e === cur) continue;
      const c = center(e);
      const dx = c.x - c0.x;
      const dy = c.y - c0.y;
      const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
      const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
      if (along <= 4) continue;
      const score = along + across * 2;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best) this.focusPad(best);
    return !!best;
  }

  // A: preme il pulsante scelto (false se non c'è una scelta valida)
  activatePadFocus() {
    const e = this.padFocused;
    if (!e || !this.focusables().includes(e)) return false;
    e.click();
    return true;
  }

  refreshEpilogue() {
    const lang = this.i18n.lang;
    const e = this.epilogue;
    e.querySelector('.quote').textContent = this.t('epilogue.quote');
    e.querySelector('.claim .it').textContent = this.t('epilogue.claim');
    e.querySelector('.claim .en').textContent = this.t('epilogue.claimEn');
    e.querySelector('.restart .lbl').textContent = this.t('ui.restart');
    const cta = this.config.cta || {};
    e.querySelector('.cta').style.display = cta.enabled === false ? 'none' : '';
    e.querySelector('.cta .txt').textContent = pick(cta.text, lang);
  }

  async setQR(url) {
    const box = this.epilogue.querySelector('.qr');
    if (!url) {
      box.classList.add('none');
      return;
    }
    try {
      const QR = await import('qrcode');
      const canvas = document.createElement('canvas');
      await QR.toCanvas(canvas, url, { margin: 0, width: 256, color: { dark: '#000035', light: '#ede2cd' }, errorCorrectionLevel: 'M' });
      // la libreria imposta dimensioni in pixel inline: il riquadro CSS decide la misura
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      box.innerHTML = '';
      box.appendChild(canvas);
      box.classList.remove('none');
    } catch (err) {
      box.classList.add('none');
    }
  }

  // ------------------------------------------------------------------ laboratorio

  showSkip(on) {
    if (on === this.skipOn) return;
    this.skipOn = on;
    this.skip.classList.toggle('hidden', !on);
  }

  setSkipProgress(p) {
    const v = Math.max(0, Math.min(1, p));
    if (Math.abs(v - (this.skipP ?? -1)) < 0.004) return;
    this.skipP = v;
    this.skip.style.setProperty('--p', v.toFixed(3));
    this.skip.classList.toggle('holding', v > 0);
  }

  /** mode: false (nascosto), 'white' (dissolvenza nel bianco caldo in `seconds`), 'card' (il cartello). */
  labEnd(mode, seconds = 2.4) {
    const e = this.labEndEl;
    if (!mode) {
      e.classList.add('hidden');
      e.classList.remove('is-white', 'is-card');
      return;
    }
    e.classList.remove('hidden');
    if (mode === 'white') {
      e.style.setProperty('--white-ms', `${Math.round(seconds * 1000)}ms`);
      void e.offsetWidth;
      e.classList.add('is-white');
    } else if (mode === 'card') e.classList.add('is-white', 'is-card');
  }

  showEpilogue(show) {
    this.epilogue.classList.toggle('hidden', !show);
    if (show) this.focusPad(this.epilogue.querySelector('.restart'));
  }

  setMuted(m) {
    this.muteBtn.classList.toggle('muted', m);
  }

  setPlaying(p) {
    document.body.classList.toggle('playing', p);
  }

  setStats(text) {
    this.stats.textContent = text;
  }

  toggleStats() {
    this.stats.classList.toggle('hidden');
    return !this.stats.classList.contains('hidden');
  }
}
