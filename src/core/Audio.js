// Audio procedurale (Web Audio API): nessun file, tutto sintetizzato.
// - Palette ambient per mondo (drone, pad, rumori filtrati, campane FM, glissandi)
// - Tick meccanico schedulato sugli eventi dello scappamento: 8 alternanze/s (28.800 A/h)
// - Suoni d'interfaccia discreti (rintocco di scoperta, soffio di transizione, cricchetto)
// - Voci del laboratorio: un "borbottio" segnaposto di sillabe senza parole, oppure, se c'è, la clip
//   registrata della battuta (public/assets/audio/lab/<chiave>.mp3)

const BEAT = 0.125; // secondi meccanici tra due alternanze (1/8 s)

// ---------------------------------------------------------------- borbottio (voce segnaposto)

// Formanti delle vocali italiane (Hz: F1, F2, F3) e peso della seconda: la "i" viene addolcita
const VOWELS = {
  a: [760, 1300, 2500, 0.8],
  e: [500, 1750, 2500, 0.6],
  i: [320, 2100, 2800, 0.32],
  o: [520, 920, 2400, 0.8],
  u: [350, 780, 2300, 0.7],
};

// Due timbri riconoscibili anche senza leggere: registro, colore (formanti e filtro), legato.
// Giovanni più basso, scuro e legato; Filippo più alto, chiaro e staccato.
export const BABBLE_VOICES = {
  giovanni: { f0: 106, range: 2.6, formant: 0.93, lp: 1650, legato: 0.86, gain: 0.15, glide: -0.7 },
  filippo: { f0: 142, range: 3.6, formant: 1.08, lp: 2250, legato: 0.7, gain: 0.12, glide: -0.35 },
};

const PAUSE_WEIGHT = { ',': 1.3, ':': 1.6, ';': 1.6, '—': 1.2, '.': 2.3, '!': 2.3, '?': 2.3 };

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Sillabe di una parola italiana: gruppi di vocali (le cifre valgono circa una sillaba e mezza)
function syllablesOf(word) {
  if (/^\d+$/.test(word)) return Array.from({ length: Math.round(word.length * 1.6) }, (_, i) => 'aeoie'[i % 5]);
  const groups = word.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[aeiouy]+/g) || ['e'];
  // dittonghi con i/u atone: la vocale "piena" del gruppo dà il colore
  return groups.map((g) => (g.length > 1 ? [...g].find((c) => 'aeo'.includes(c)) || g[g.length - 1] : g).replace('y', 'i'));
}

/**
 * Partitura del borbottio di una battuta: sillabe brevi con intonazione che scende lungo la frase,
 * pause sulla punteggiatura e cadenza finale (in salita sulle domande), distribuite su `duration`.
 * Restituisce { events: [{ t, dur, f0, f1, vowel, amp }], duration }.
 */
export function babblePlan(text, voiceName, duration, seed = 1) {
  const v = BABBLE_VOICES[voiceName] || BABBLE_VOICES.giovanni;
  const rnd = seeded(seed * 9973 + text.length);
  const tokens = text.match(/[\p{L}\d’']+|[.,:;?!—]/gu) || [];
  const units = [];
  let phrase = [];
  const closePhrase = (mark) => {
    const n = phrase.length;
    phrase.forEach((u, i) => {
      const k = n > 1 ? i / (n - 1) : 0;
      let st = 1.4 - 2.8 * k; // declinazione
      if (mark === '?' && i >= n - 2) st += i === n - 1 ? 4.5 : 2;
      else if ((mark === '.' || mark === '!') && i === n - 1) st -= 2.2;
      else if (mark && i === n - 1) st += 1; // virgola: la frase continua
      u.st = (st + (u.stress ? 1.1 : 0)) * (v.range / 3) + (rnd() - 0.5) * 1.2;
      u.cadence = (mark === '.' || mark === '!') && i === n - 1;
    });
    phrase = [];
  };
  for (const tok of tokens) {
    if (PAUSE_WEIGHT[tok]) {
      closePhrase(tok);
      units.push({ pause: PAUSE_WEIGHT[tok] });
      continue;
    }
    const syl = syllablesOf(tok.replace(/[’']/g, ''));
    syl.forEach((vowel, i) => {
      // accento sulla penultima (parola piana, la più comune in italiano)
      const u = { vowel, stress: syl.length > 1 && i === syl.length - 2, wordEnd: i === syl.length - 1 };
      units.push(u);
      phrase.push(u);
    });
  }
  closePhrase('.');
  // l'ultima pausa non conta: la battuta finisce lì
  while (units.length && units[units.length - 1].pause) units.pop();

  let W = 0;
  for (const u of units) W += u.pause ?? (u.stress ? 1.15 : 1) + (u.wordEnd ? 0.12 : 0);
  const lead = 0.08;
  const tail = 0.24;
  const slot = Math.max(0.09, (duration - lead - tail) / Math.max(1, W));
  const events = [];
  let t = lead;
  for (const u of units) {
    if (u.pause) {
      t += u.pause * slot;
      continue;
    }
    const w = u.stress ? 1.15 : 1;
    const dur = Math.min(0.3, Math.max(0.07, slot * w * v.legato * (u.cadence ? 1.35 : 1)));
    const f0 = v.f0 * Math.pow(2, u.st / 12);
    const glide = u.cadence ? -2.4 : v.glide;
    events.push({ t, dur, f0, f1: f0 * Math.pow(2, glide / 12), vowel: u.vowel, amp: (u.stress ? 1 : 0.84) * (0.92 + rnd() * 0.12) * (u.cadence ? 0.85 : 1) });
    t += slot * w + (u.wordEnd ? slot * 0.12 : 0);
  }
  return { events, duration, voice: voiceName };
}

/** Apertura della bocca (0..1) e vocale del borbottio all'istante t della battuta. */
export function babbleLevel(plan, t) {
  const ev = plan.events;
  let lo = 0;
  let hi = ev.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ev[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  const e = ev[lo];
  if (!e || t < e.t) return { level: 0, vowel: 'a' };
  const k = (t - e.t) / e.dur;
  if (k > 1.25) return { level: 0, vowel: e.vowel };
  const env = k < 0.18 ? k / 0.18 : k < 0.6 ? 1 : Math.max(0, 1 - (k - 0.6) / 0.65);
  return { level: env * e.amp, vowel: e.vowel };
}

// Livelli e colore del tic per mondo. Otto alternanze al secondo per minuti stancano: il tic sta sotto
// la musica, scuro (niente brillantezza oltre 5–6 kHz) e un po' nel riverbero, così si sente senza pungere.
const TICK_TIMBRES = {
  intro: { gain: 0.3, lp: 5200, hp: 400, rate: 1.0, send: 0.45 },
  crisp: { gain: 0.38, lp: 6000, hp: 300, rate: 1.0, send: 0.24 },
  airy: { gain: 0.22, lp: 5000, hp: 900, rate: 1.06, send: 0.75 },
  warm: { gain: 0.36, lp: 3000, hp: 120, rate: 0.74, send: 0.4 },
  precise: { gain: 0.34, lp: 5800, hp: 450, rate: 1.0, send: 0.16 },
  soft: { gain: 0.26, lp: 4200, hp: 300, rate: 0.92, send: 0.5 },
};
// Abitudine: entrando in un mondo il tic si sente bene, poi in circa 13 s scende a fare da sfondo
// (come un orologio vero, che dopo un po' non si nota più); risale avvicinandosi alla sorgente.
const TICK_REST = 0.45;
const TICK_SETTLE = 24; // secondi per passare da 1 a 0 (si ferma a TICK_REST)
// mentre parlano le voci del laboratorio il tic si fa da parte
const TICK_UNDER_VOICE = 0.5;

function rand(a, b) {
  return a + Math.random() * (b - a);
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.volume = 0.8;
    this.current = null;
    this.paletteName = null;
    this.nextBeat = null;
    // il tic parte spento: si sente solo dentro i livelli (mai nel menu, nell'attrazione, nell'epilogo)
    this.tickState = { presence: 0.6, pan: 0, timbre: 'intro', enabled: false };
    this.tickAttention = 1;
    this.lastPresence = null;
    this.clipsPlaying = 0;
    this.events = [];
  }

  init({ volume = 0.8, muted = false } = {}) {
    this.volume = volume;
    this.muted = muted;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = muted ? 0 : volume;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 18;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.01;
    this.comp.release.value = 0.3;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeIR(4.2, 2.4);
    this.reverbOut = ctx.createGain();
    this.reverbOut.gain.value = 0.85;
    this.reverb.connect(this.reverbOut);
    this.reverbOut.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 1;
    this.musicBus.connect(this.master);
    this.musicSend = ctx.createGain();
    this.musicSend.gain.value = 0.55;
    this.musicBus.connect(this.musicSend);
    this.musicSend.connect(this.reverb);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    this.sfxSend = ctx.createGain();
    this.sfxSend.gain.value = 0.7;
    this.sfxBus.connect(this.sfxSend);
    this.sfxSend.connect(this.reverb);

    // Voci del laboratorio: un filtro per timbro, poi un bus unico verso il master (M le spegne)
    this.voiceBus = ctx.createGain();
    this.voiceBus.gain.value = 1;
    this.voiceBus.connect(this.master);
    this.voiceSend = ctx.createGain();
    this.voiceSend.gain.value = 0.12;
    this.voiceBus.connect(this.voiceSend);
    this.voiceSend.connect(this.reverb);
    this.voiceLP = {};
    for (const [name, v] of Object.entries(BABBLE_VOICES)) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = v.lp;
      f.Q.value = 0.5;
      f.connect(this.voiceBus);
      this.voiceLP[name] = f;
    }
    this.waves = new Map();

    // Catena del tick: sorgente → passa-alto → passa-basso → panner → guadagno → bus (+ mandata riverbero)
    this.tickHP = ctx.createBiquadFilter();
    this.tickHP.type = 'highpass';
    this.tickLP = ctx.createBiquadFilter();
    this.tickLP.type = 'lowpass';
    this.tickPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    this.tickGain = ctx.createGain();
    this.tickGain.gain.value = 0;
    this.tickSend = ctx.createGain();
    this.tickSend.gain.value = 0.2;
    this.tickHP.connect(this.tickLP);
    if (this.tickPan) {
      this.tickLP.connect(this.tickPan);
      this.tickPan.connect(this.tickGain);
    } else this.tickLP.connect(this.tickGain);
    this.tickGain.connect(this.master);
    this.tickGain.connect(this.tickSend);
    this.tickSend.connect(this.reverb);

    // Strato "ronzio" per il time-lapse (quando le alternanze diventano troppo fitte per essere distinte)
    this.buffers = {
      tic: this.makeTick(0),
      toc: this.makeTick(1),
      white: this.makeNoise(2.5, 'white'),
      pink: this.makeNoise(5, 'pink'),
    };
    this.buzzSrc = ctx.createBufferSource();
    this.buzzSrc.buffer = this.buffers.white;
    this.buzzSrc.loop = true;
    this.buzzBP = ctx.createBiquadFilter();
    this.buzzBP.type = 'bandpass';
    this.buzzBP.frequency.value = 900;
    this.buzzBP.Q.value = 2.5;
    this.buzzGain = ctx.createGain();
    this.buzzGain.gain.value = 0;
    this.buzzSrc.connect(this.buzzBP);
    this.buzzBP.connect(this.buzzGain);
    this.buzzGain.connect(this.tickLP);
    this.buzzSrc.start();

    this.setTickTimbre('intro', true);
    this.ready = true;
  }

  unlock() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  get running() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setMuted(m) {
    this.muted = m;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(m ? 0 : this.volume, t, 0.25);
  }

  // ---------------------------------------------------------------- sintesi di base

  makeIR(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      const pre = Math.floor(ctx.sampleRate * 0.025);
      for (let i = 0; i < len; i++) {
        if (i < pre) {
          d[i] = 0;
          continue;
        }
        const x = (i - pre) / (len - pre);
        const n = Math.random() * 2 - 1;
        const coef = 0.25 + 0.7 * x; // coda progressivamente più scura
        lp = lp + (n - lp) * (1 - coef);
        d[i] = lp * Math.pow(1 - x, decay) * 0.9;
      }
    }
    return buf;
  }

  makeNoise(seconds, color) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (color === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else d[i] = w * 0.5;
    }
    // dissolvenza ai bordi per un loop senza click
    const f = Math.min(2000, len / 4);
    for (let i = 0; i < f; i++) {
      d[i] *= i / f;
      d[len - 1 - i] *= i / f;
    }
    return buf;
  }

  // Un "tic" è fatto di tre micro-urti (sblocco, impulso, caduta) e di un breve risuonare metallico.
  // Morbido apposta: poco rumore d'urto e parziali acute deboli, più corpo sotto (un clic secco e
  // brillante, ripetuto 8 volte al secondo, dopo qualche minuto stanca).
  makeTick(variant) {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 0.1);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const partials = variant === 0
      ? [[3150, 0.011, 0.4], [4870, 0.008, 0.22], [7420, 0.005, 0.08], [10150, 0.003, 0.03], [1690, 0.02, 0.3]]
      : [[2860, 0.012, 0.4], [4520, 0.009, 0.22], [6960, 0.005, 0.08], [9480, 0.003, 0.03], [1530, 0.022, 0.3]];
    const clicks = [[0, 0.45], [0.0032, 0.6], [0.0071, 1.0]];
    const noise = new Float32Array(len);
    for (let i = 0; i < len; i++) noise[i] = Math.random() * 2 - 1;
    let hp = 0;
    let prev = 0;
    let peak = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let s = 0;
      for (const [t0, a] of clicks) {
        const tt = t - t0;
        if (tt < 0) continue;
        const env = Math.exp(-tt / 0.0012) * a;
        const n = noise[i] * env * 0.55;
        s += n;
        for (const [f, dec, pa] of partials) s += pa * a * Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt / dec);
        s += 0.24 * a * Math.sin(2 * Math.PI * 880 * tt) * Math.exp(-tt / 0.005);
      }
      hp = 0.93 * (hp + s - prev);
      prev = s;
      d[i] = hp;
      peak = Math.max(peak, Math.abs(hp));
    }
    for (let i = 0; i < len; i++) d[i] = (d[i] / peak) * 0.9;
    return buf;
  }

  // ---------------------------------------------------------------- tick

  setTickTimbre(name, immediate = false) {
    if (!this.ctx) return;
    const tb = TICK_TIMBRES[name] || TICK_TIMBRES.crisp;
    // un mondo nuovo: il tic si fa sentire di nuovo, poi torna sfondo
    if (name !== this.tickState.timbre) this.tickAttention = 1;
    this.tickTimbre = tb;
    this.tickState.timbre = name;
    const t = this.ctx.currentTime;
    const tc = immediate ? 0.01 : 0.8;
    this.tickLP.frequency.setTargetAtTime(tb.lp, t, tc);
    this.tickHP.frequency.setTargetAtTime(tb.hp, t, tc);
    this.tickSend.gain.setTargetAtTime(tb.send, t, tc);
  }

  // presence 0..1 (vicinanza al bilanciere), pan -1..1
  setTickPresence(presence, pan = 0) {
    this.tickState.presence = presence;
    this.tickState.pan = pan;
  }

  setTickEnabled(on) {
    // l'orologio che riparte (la corona caricata, un nuovo livello) si fa sentire, poi torna sfondo
    if (on && !this.tickState.enabled) this.tickAttention = 1;
    this.tickState.enabled = !!on;
  }

  updateTicks(clock, dt = 0) {
    if (!this.ready || !this.running) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const s = clock.scale;
    const tb = this.tickTimbre;
    const st = this.tickState;

    if (!st.enabled) {
      // silenzio con una breve dissolvenza; nessun nuovo tic in programma
      this.tickGain.gain.setTargetAtTime(0, now, 0.15);
      this.buzzGain.gain.setTargetAtTime(0, now, 0.15);
      this.nextBeat = null;
      return;
    }

    // abitudine: scende verso TICK_REST e risale quando la presenza cresce (ci si avvicina alla sorgente)
    const rise = Math.max(0, st.presence - (this.lastPresence ?? st.presence));
    this.lastPresence = st.presence;
    this.tickAttention = Math.min(1, Math.max(TICK_REST, this.tickAttention - dt / TICK_SETTLE + rise * 1.5));
    const duck = this.clipsPlaying > 0 ? TICK_UNDER_VOICE : 1;
    const target = tb.gain * st.presence * this.tickAttention * duck;
    this.tickGain.gain.setTargetAtTime(target, now, 0.12);
    if (this.tickPan) this.tickPan.pan.setTargetAtTime(Math.max(-1, Math.min(1, st.pan)), now, 0.15);

    // Time-lapse: oltre ~3,5× le alternanze si fondono in un ronzio
    const buzz = Math.max(0, Math.min(1, (s - 3) / 12));
    this.buzzGain.gain.setTargetAtTime(buzz * 0.35, now, 0.2);
    this.buzzBP.frequency.setTargetAtTime(Math.min(4000, 400 + s * 40), now, 0.2);
    if (s > 3.5) {
      this.nextBeat = Math.ceil(clock.time / BEAT);
      return;
    }

    const look = 0.12;
    if (this.nextBeat === null || Math.abs(this.nextBeat * BEAT - clock.time) > Math.max(0.6, 4 * BEAT * s)) {
      this.nextBeat = Math.ceil(clock.time / BEAT + 1e-6);
    }
    let guard = 0;
    while (guard++ < 16) {
      const dtReal = (this.nextBeat * BEAT - clock.time) / s;
      if (dtReal > look) break;
      if (dtReal > -0.03) this.playTick(now + Math.max(0, dtReal), this.nextBeat & 1, s);
      this.nextBeat++;
    }
  }

  playTick(when, parity, scale) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = parity ? this.buffers.toc : this.buffers.tic;
    const slow = scale < 1 ? 0.55 + 0.45 * Math.sqrt(scale) : 1;
    src.playbackRate.value = this.tickTimbre.rate * slow * rand(0.995, 1.005);
    const g = ctx.createGain();
    g.gain.value = (parity ? 0.92 : 1) * rand(0.94, 1.0);
    src.connect(g);
    g.connect(this.tickHP);
    src.start(when);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
    };
  }

  // ---------------------------------------------------------------- palette ambient

  setPalette(name, fade = 3) {
    if (!this.ready || name === this.paletteName) return;
    const ctx = this.ctx;
    const old = this.current;
    if (old) {
      const t = ctx.currentTime;
      old.out.gain.cancelScheduledValues(t);
      old.out.gain.setValueAtTime(old.out.gain.value, t);
      old.out.gain.linearRampToValueAtTime(0, t + fade);
      setTimeout(() => old.stop(), (fade + 0.3) * 1000);
    }
    this.paletteName = name;
    this.current = name ? this.buildPalette(name) : null;
    if (this.current) {
      const t = ctx.currentTime;
      this.current.out.gain.setValueAtTime(0, t);
      this.current.out.gain.linearRampToValueAtTime(this.current.level, t + fade * 1.2);
    }
  }

  // Abbassa/rialza la musica (es. "un respiro di silenzio")
  duckMusic(level, seconds = 2) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, t);
    this.musicBus.gain.linearRampToValueAtTime(level, t + seconds);
  }

  buildPalette(name) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.musicBus);
    const nodes = [];
    const timers = [];
    const P = { out, level: 0.5, nodes, timers };
    const keep = (n) => (nodes.push(n), n);

    const lfo = (rate, depth, param, offset = null) => {
      const o = keep(ctx.createOscillator());
      o.frequency.value = rate;
      o.type = 'sine';
      const g = keep(ctx.createGain());
      g.gain.value = depth;
      o.connect(g);
      g.connect(param);
      if (offset !== null) param.value = offset;
      o.start(ctx.currentTime + Math.random() * 0.1);
      return o;
    };

    // Pad: oscillatori leggermente scordati → filtro passa-basso con LFO lento
    const pad = (freqs, { type = 'triangle', gain = 0.06, cutoff = 1200, q = 0.5, lfoRate = 0.04, lfoDepth = 300, breathe = 0.4 } = {}) => {
      const filt = keep(ctx.createBiquadFilter());
      filt.type = 'lowpass';
      filt.frequency.value = cutoff;
      filt.Q.value = q;
      lfo(lfoRate, lfoDepth, filt.frequency);
      const bus = keep(ctx.createGain());
      bus.gain.value = 1;
      filt.connect(bus);
      bus.connect(out);
      freqs.forEach((f, i) => {
        const vg = keep(ctx.createGain());
        vg.gain.value = gain * (1 - breathe * 0.5);
        lfo(rand(0.025, 0.09), gain * breathe * 0.5, vg.gain);
        vg.connect(filt);
        for (const det of [-5, 5]) {
          const o = keep(ctx.createOscillator());
          o.type = type;
          o.frequency.value = f;
          o.detune.value = det + rand(-2, 2);
          o.connect(vg);
          o.start(ctx.currentTime + i * 0.02);
        }
      });
      return bus;
    };

    const drone = (freqs, gain = 0.08, type = 'sine') => {
      freqs.forEach((f) => {
        const o = keep(ctx.createOscillator());
        o.type = type;
        o.frequency.value = f;
        const g = keep(ctx.createGain());
        g.gain.value = gain;
        lfo(rand(0.03, 0.07), gain * 0.35, g.gain);
        o.connect(g);
        g.connect(out);
        o.start();
      });
    };

    const noiseBed = ({ color = 'pink', type = 'bandpass', freq = 800, q = 0.8, gain = 0.05, freqLfo = [0.05, 300], gainLfo = [0.07, 0.5] }) => {
      const src = keep(ctx.createBufferSource());
      src.buffer = this.buffers[color];
      src.loop = true;
      src.loopStart = Math.random();
      const f = keep(ctx.createBiquadFilter());
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = keep(ctx.createGain());
      g.gain.value = gain;
      if (freqLfo) lfo(freqLfo[0], freqLfo[1], f.frequency);
      if (gainLfo) lfo(gainLfo[0], gain * gainLfo[1], g.gain);
      src.connect(f);
      f.connect(g);
      g.connect(out);
      src.start(ctx.currentTime, Math.random() * 2);
      return g;
    };

    // Eventi sparsi: rintocchi, scintille, glissandi
    const every = (min, max, fn) => {
      let next = rand(min * 0.4, max * 0.8);
      timers.push((dt) => {
        next -= dt;
        if (next <= 0) {
          next = rand(min, max);
          fn();
        }
      });
    };
    const sparkle = (notes, gain = 0.03) => () => {
      const f = notes[Math.floor(Math.random() * notes.length)];
      this.ping(f, { gain, decay: rand(1.6, 3.2), dest: out, send: 1 });
    };
    const bell = (notes, gain = 0.05) => () => {
      const f = notes[Math.floor(Math.random() * notes.length)];
      this.fmBell(f, { gain, decay: rand(3.5, 6), dest: out, ratio: 1.41, index: 2.2 });
    };

    switch (name) {
      case 'intro':
        P.level = 0.55;
        drone([55, 82.41], 0.07);
        pad([110, 164.81, 277.18, 493.88], { type: 'triangle', gain: 0.03, cutoff: 900, lfoDepth: 250 });
        every(5, 11, sparkle([880, 1318.5, 1108.7], 0.018));
        break;
      case 'movement':
        P.level = 0.55;
        drone([36.71, 73.42], 0.09);
        drone([110], 0.035, 'triangle');
        pad([146.83, 220, 329.63, 440], { type: 'sawtooth', gain: 0.012, cutoff: 700, q: 0.7, lfoDepth: 260 });
        noiseBed({ color: 'white', type: 'bandpass', freq: 3600, q: 7, gain: 0.012, freqLfo: [0.03, 900], gainLfo: [0.05, 0.8] });
        every(3.5, 7.5, sparkle([587.33, 659.25, 880, 987.77, 1174.66], 0.02));
        break;
      case 'celeste':
        P.level = 0.6;
        pad([146.83, 220, 369.99, 659.25, 880], { type: 'sine', gain: 0.045, cutoff: 2600, lfoDepth: 700, lfoRate: 0.03 });
        pad([293.66, 440], { type: 'triangle', gain: 0.018, cutoff: 1800 });
        noiseBed({ color: 'pink', type: 'bandpass', freq: 650, q: 0.6, gain: 0.07, freqLfo: [0.045, 380], gainLfo: [0.06, 0.7] });
        noiseBed({ color: 'pink', type: 'highpass', freq: 2800, q: 0.3, gain: 0.012, freqLfo: [0.02, 600], gainLfo: [0.09, 0.9] });
        every(6, 12, sparkle([1318.5, 1479.98, 1760], 0.014));
        break;
      case 'sunset':
        P.level = 0.55;
        drone([51.91, 77.78], 0.06);
        pad([103.83, 155.56, 261.63, 392, 466.16], { type: 'sawtooth', gain: 0.014, cutoff: 820, q: 0.8, lfoDepth: 280 });
        pad([207.65, 311.13], { type: 'sine', gain: 0.03, cutoff: 1400 });
        every(4, 8.5, bell([415.3, 523.25, 622.25, 830.61], 0.05));
        every(9, 15, () => this.gliss(rand(0, 1) > 0.5 ? [311.13, 392] : [415.3, 523.25], { dest: out, gain: 0.025, dur: rand(2.5, 4) }));
        break;
      case 'virentia':
        P.level = 0.55;
        drone([82.41], 0.06);
        pad([82.41, 123.47, 196, 293.66, 369.99], { type: 'triangle', gain: 0.035, cutoff: 1150, lfoDepth: 320, lfoRate: 0.035 });
        noiseBed({ color: 'white', type: 'highpass', freq: 3800, q: 0.4, gain: 0.018, freqLfo: [0.07, 900], gainLfo: [0.23, 0.95] });
        noiseBed({ color: 'pink', type: 'lowpass', freq: 320, q: 0.5, gain: 0.05, freqLfo: [0.04, 120], gainLfo: [0.05, 0.6] });
        every(5, 10, () => this.pluck([164.81, 196, 246.94, 293.66][Math.floor(Math.random() * 4)], { dest: out, gain: 0.05 }));
        every(7, 13, sparkle([987.77, 1174.66, 1318.5], 0.012));
        break;
      case 'epilogue':
        P.level = 0.6;
        drone([65.41, 98], 0.06);
        pad([130.81, 196, 329.63, 587.33, 987.77], { type: 'sine', gain: 0.04, cutoff: 2000, lfoDepth: 500, lfoRate: 0.025 });
        every(5, 9, sparkle([1046.5, 1318.5, 1567.98], 0.016));
        break;
      case 'lab':
        // una stanza quieta di sera: fondo d'aria, un accordo caldo appena accennato, rare note lontane
        P.level = 0.4;
        drone([65.41], 0.03);
        pad([130.81, 196, 261.63, 329.63, 392], { type: 'sine', gain: 0.02, cutoff: 1300, lfoDepth: 280, lfoRate: 0.02 });
        noiseBed({ color: 'pink', type: 'lowpass', freq: 420, q: 0.4, gain: 0.028, freqLfo: [0.03, 80], gainLfo: [0.04, 0.4] });
        every(10, 18, sparkle([1046.5, 1318.5, 1567.98], 0.007));
        break;
      default:
        break;
    }

    P.update = (dt) => timers.forEach((fn) => fn(dt));
    P.stop = () => {
      nodes.forEach((n) => {
        try {
          if (n.stop) n.stop();
        } catch (e) { /* già fermo */ }
        try {
          n.disconnect();
        } catch (e) { /* già scollegato */ }
      });
      try {
        out.disconnect();
      } catch (e) { /* già scollegato */ }
    };
    return P;
  }

  update(dt, clock) {
    if (!this.ready) return;
    if (this.current && this.current.update && this.running) this.current.update(dt);
    if (clock) this.updateTicks(clock, dt);
  }

  // ---------------------------------------------------------------- voci del laboratorio

  // Forma d'onda di una vocale per un timbro: armoniche pesate dalle formanti. Basta un solo
  // oscillatore per sillaba, e il colore resta quello di una voce anche senza parole.
  vowelWave(voiceName, vowel) {
    const key = `${voiceName}:${vowel}`;
    if (this.waves.has(key)) return this.waves.get(key);
    const v = BABBLE_VOICES[voiceName] || BABBLE_VOICES.giovanni;
    const [F1, F2, F3, w2] = VOWELS[vowel] || VOWELS.a;
    const n = 30;
    const real = new Float32Array(n + 1);
    const imag = new Float32Array(n + 1);
    const res = (f, F, bw) => 1 / (1 + ((f - F * v.formant) / bw) ** 2);
    for (let k = 1; k <= n; k++) {
      const f = k * v.f0;
      imag[k] = (res(f, F1, 120) + w2 * res(f, F2, 170) + 0.22 * res(f, F3, 240) + 0.08) * Math.pow(k, -0.55);
    }
    const wave = this.ctx.createPeriodicWave(real, imag);
    this.waves.set(key, wave);
    return wave;
  }

  // Una sillaba: attacco morbido, intonazione che scivola appena, coda breve (niente clic)
  syllable(e, voiceName, when) {
    const ctx = this.ctx;
    const v = BABBLE_VOICES[voiceName] || BABBLE_VOICES.giovanni;
    const o = ctx.createOscillator();
    o.setPeriodicWave(this.vowelWave(voiceName, e.vowel));
    o.frequency.setValueAtTime(e.f0, when);
    o.frequency.linearRampToValueAtTime(e.f1, when + e.dur);
    const g = ctx.createGain();
    const peak = v.gain * e.amp;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + Math.min(0.03, e.dur * 0.25));
    g.gain.setValueAtTime(peak, when + e.dur * 0.55);
    g.gain.setTargetAtTime(0, when + e.dur * 0.55, e.dur * 0.2);
    o.connect(g);
    g.connect(this.voiceLP[voiceName] || this.voiceBus);
    o.start(when);
    o.stop(when + e.dur * 1.6 + 0.05);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  /**
   * Fa suonare le sillabe di una partitura (vedi babblePlan) fino a `elapsed` secondi dall'inizio
   * della battuta, più un piccolo anticipo. `state` = { plan, voice, cursor }; va chiamata a ogni
   * fotogramma finché la battuta è in corso (in pausa non la si chiama: il borbottio si ferma).
   */
  scheduleBabble(state, elapsed) {
    if (!this.ready || !this.running) return;
    const now = this.ctx.currentTime;
    const ev = state.plan.events;
    while (state.cursor < ev.length) {
      const e = ev[state.cursor];
      const dt = e.t - elapsed;
      if (dt > 0.12) break;
      state.cursor++;
      if (dt < -0.06) continue; // già passata (audio sbloccato in ritardo, salto)
      this.syllable(e, state.voice, now + Math.max(0, dt));
    }
  }

  /** Clip registrata (mp3): decodificata una volta, null se manca o non è audio. */
  async loadClip(url) {
    if (!this.ctx) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.arrayBuffer();
      return await this.ctx.decodeAudioData(data);
    } catch (e) {
      return null;
    }
  }

  /** Suona una clip della voce da `offset` secondi; restituisce il "nastro" da fermare o misurare. */
  playClip(buffer, offset = 0) {
    if (!this.ready || !buffer) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    an.connect(this.voiceBus);
    src.start(ctx.currentTime, Math.max(0, Math.min(offset, buffer.duration - 0.01)));
    const tape = { src, an, data: new Float32Array(an.fftSize) };
    // quante voci stanno parlando: il tic si abbassa sotto di loro
    this.clipsPlaying++;
    src.onended = () => {
      this.clipsPlaying = Math.max(0, this.clipsPlaying - 1);
      try {
        src.disconnect();
        an.disconnect();
      } catch (e) { /* già scollegato */ }
    };
    return tape;
  }

  stopClip(tape) {
    if (!tape) return;
    try {
      tape.src.stop();
    } catch (e) { /* già fermo */ }
  }

  /**
   * Volume istantaneo di una clip (0..1), per muovere la bocca. Tarato sulle clip a -16 LUFS: le
   * sillabe medie (RMS circa 0,15) aprono a metà, solo gli accenti (RMS sopra 0,28) del tutto.
   */
  clipLevel(tape) {
    if (!tape) return 0;
    tape.an.getFloatTimeDomainData(tape.data);
    let s = 0;
    for (let i = 0; i < tape.data.length; i++) s += tape.data[i] * tape.data[i];
    return Math.min(1, Math.sqrt(s / tape.data.length) * 3.5);
  }

  // ---------------------------------------------------------------- piccoli strumenti

  ping(freq, { gain = 0.03, decay = 2, dest = null, send = 1, when = 0 } = {}) {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2.01;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.connect(dest || this.sfxBus);
    if (send && !dest) g.connect(this.sfxSend);
    o.start(t);
    o2.start(t);
    o.stop(t + decay + 0.1);
    o2.stop(t + decay + 0.1);
    o.onended = () => {
      g.disconnect();
      g2.disconnect();
    };
  }

  fmBell(freq, { gain = 0.05, decay = 4, dest = null, ratio = 1.4, index = 2, when = 0 } = {}) {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const car = ctx.createOscillator();
    car.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.frequency.value = freq * ratio;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(freq * index, t);
    mg.gain.exponentialRampToValueAtTime(freq * 0.05, t + decay * 0.6);
    mod.connect(mg);
    mg.connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    car.connect(g);
    g.connect(dest || this.sfxBus);
    car.start(t);
    mod.start(t);
    car.stop(t + decay + 0.1);
    mod.stop(t + decay + 0.1);
    car.onended = () => {
      g.disconnect();
      mg.disconnect();
    };
  }

  pluck(freq, { gain = 0.05, dest = null } = {}) {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2200, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.connect(f);
    f.connect(g);
    g.connect(dest || this.sfxBus);
    o.start(t);
    o.stop(t + 1.5);
    o.onended = () => g.disconnect();
  }

  gliss(range, { gain = 0.03, dur = 3, dest = null } = {}) {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(range[0], t);
    o.frequency.exponentialRampToValueAtTime(range[1], t + dur * 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g);
    g.connect(dest || this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
    o.onended = () => g.disconnect();
  }

  // Rintocco di scoperta di un hotspot: due note morbide
  chime(kind = 'discover') {
    if (!this.running) return;
    const notes = kind === 'complete' ? [880, 1318.5, 1760] : [1318.5, 1975.5];
    notes.forEach((f, i) => this.ping(f, { gain: 0.035, decay: 2.6, when: i * 0.11 }));
  }

  // Soffio di transizione (rumore filtrato in salita)
  whoosh(dur = 1.8, gain = 0.12) {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.buffers.pink;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(180, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + dur * 0.7);
    f.frequency.exponentialRampToValueAtTime(600, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.55);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxBus);
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.1);
    src.onended = () => g.disconnect();
  }

  // Cricchetto della carica (clic della ruota di carica sul suo arresto)
  ratchet(gain = 0.35) {
    if (!this.running) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.buffers.tic;
    src.playbackRate.value = rand(1.5, 1.7);
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.sfxBus);
    src.start();
    src.onended = () => g.disconnect();
  }

  // Strisciata di una punta su una superficie dura
  scratch(dur = 1.2, gain = 0.12, bright = 1) {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.buffers.white;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 3200 * bright;
    f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.05);
    g.gain.setValueAtTime(gain, t + dur - 0.15);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const trem = ctx.createOscillator();
    trem.frequency.value = 38;
    const tg = ctx.createGain();
    tg.gain.value = gain * 0.4;
    trem.connect(tg);
    tg.connect(g.gain);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxBus);
    src.start(t, Math.random());
    trem.start(t);
    src.stop(t + dur + 0.05);
    trem.stop(t + dur + 0.05);
    src.onended = () => g.disconnect();
  }

  // Accordo che si apre (momenti "wow")
  swell(freqs, { gain = 0.05, dur = 6 } = {}) {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(3000, t + dur * 0.4);
    f.connect(g);
    g.connect(this.sfxBus);
    freqs.forEach((fr) => {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = fr;
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    });
    setTimeout(() => g.disconnect(), (dur + 0.5) * 1000);
  }
}
