// Audio procedurale (Web Audio API): nessun file, tutto sintetizzato.
// - Palette ambient per mondo (drone, pad, rumori filtrati, campane FM, glissandi)
// - Tick meccanico schedulato sugli eventi dello scappamento: 8 alternanze/s (28.800 A/h)
// - Suoni d'interfaccia discreti (rintocco di scoperta, soffio di transizione, cricchetto)

const BEAT = 0.125; // secondi meccanici tra due alternanze (1/8 s)

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

function rand(a, b) {
  return a + Math.random() * (b - a);
}

const midiFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Pianoforte: scale (semitoni dalla tonica) e frasi. Le frasi sono gradi della scala (0 = tonica,
// oltre la fine si sale di ottava) con la durata in battiti. La prima, in ogni mondo, è il motivo di
// Monichs: 6-3-2-1, una discesa che si posa ("un oggetto che ti fa rallentare"); le altre rispondono.
const PENTA = [0, 2, 4, 7, 9];
const PENTA_MINOR = [0, 3, 5, 7, 10];
const PIANO_PHRASES = [
  [[4, 1.5], [2, 1], [1, 1], [0, 3]],
  [[0, 1], [1, 1], [2, 1.5], [4, 1], [3, 3]],
  [[2, 1], [3, 1], [4, 2], [3, 3]],
  [[5, 2], [4, 1], [2, 4]],
  [[3, 1.5], [2, 1], [3, 1], [1, 1], [0, 3]],
  [[1, 1], [2, 1], [0, 3]],
];

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
    this.events = [];
  }

  init({ volume = 0.8, muted = false, piano = 1 } = {}) {
    this.volume = volume;
    this.muted = muted;
    this.pianoLevel = Math.max(0, Number(piano) || 0); // config audio.piano: 0 lo spegne
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
    const target = tb.gain * st.presence * this.tickAttention;
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

    // Pad: oscillatori leggermente scordati → filtro passa-basso con LFO lento. Un po' più bassi e scuri
    // di come erano nati: lasciano il registro medio al pianoforte
    const pad = (freqs, { type = 'triangle', gain = 0.06, cutoff = 1200, q = 0.5, lfoRate = 0.04, lfoDepth = 300, breathe = 0.4 } = {}) => {
      gain *= 0.85;
      cutoff *= 0.88;
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

    // Pianoforte: una melodia lenta e rada sopra l'atmosfera, nella tonalità del mondo. Frasi di poche
    // note (PIANO_PHRASES, la prima è il motivo) e silenzi lunghi: il tempo ha il ritmo che decidi tu.
    // root: la tonica (MIDI); low–high: il registro della melodia; rest: il silenzio dopo ogni frase (s).
    // gain è tarato mondo per mondo sull'ambiente: negli attacchi la frase arriva al suo livello (pesatura A),
    // poi la coda ci si perde dentro (vedi ARCHITECTURE, "Musica" → "Taratura").
    const piano = ({ root, scale = PENTA, low = 62, high = 81, bpm = 50, gain = 0.05, rest = [5, 10], bass = 0.5 }) => {
      if (!(this.pianoLevel > 0)) return;
      const beat = 60 / bpm;
      const bus = keep(ctx.createGain());
      bus.gain.value = this.pianoLevel;
      bus.connect(out);
      const degree = (d) => root + scale[((d % scale.length) + scale.length) % scale.length] + 12 * Math.floor(d / scale.length);
      const fit = (m) => {
        while (m > high) m -= 12;
        while (m < low) m += 12;
        return m;
      };
      let bassM = root - 12;
      while (bassM > 48) bassM -= 12;
      while (bassM < 36) bassM += 12;
      let wait = rand(2.5, 5);
      let count = 0;
      timers.push((dt) => {
        wait -= dt;
        if (wait > 0) return;
        // la frase aspetta che l'audio sia sbloccato e che passi il "respiro di silenzio" di Celeste
        if (!this.running || this.musicBus.gain.value < 0.4) {
          wait = 0.5;
          return;
        }
        const phrase = count === 0 ? PIANO_PHRASES[0] : PIANO_PHRASES[1 + Math.floor(Math.random() * (PIANO_PHRASES.length - 1))];
        // dopo il motivo, a volte la frase sale o scende di un grado: lo stesso pensiero detto di nuovo
        const shift = count === 0 ? 0 : [0, 0, 0, 1, -1][Math.floor(Math.random() * 5)];
        // la frase si sposta di ottava tutta insieme, così il profilo resta quello (il motivo scende sempre);
        // fra le ottave possibili, quella che sta nel registro e più vicina al suo centro
        const raw = phrase.map(([d]) => degree(d + shift));
        const mid = (Math.min(...raw) + Math.max(...raw)) / 2;
        let k = 0;
        let best = Infinity;
        for (let o = -36; o <= 36; o += 12) {
          const over = raw.reduce((acc, m) => acc + Math.max(0, m + o - high) + Math.max(0, low - m - o), 0);
          const score = over * 100 + Math.abs(mid + o - (low + high) / 2);
          if (score < best) {
            best = score;
            k = o;
          }
        }
        const t0 = ctx.currentTime + 0.05;
        let t = 0;
        let last = null;
        phrase.forEach(([, dur], i) => {
          const m = fit(raw[i] + k);
          this.feltPiano(midiFreq(m), { when: t0 + t + rand(-0.02, 0.03), velocity: (i === 0 ? 0.5 : 0.4) * rand(0.85, 1.1), dest: bus, pan: (m - 70) / 40, gain });
          last = m;
          t += dur * beat * rand(0.96, 1.06);
        });
        // mano sinistra: una nota grave lunga sotto l'inizio della frase (la tonica, a volte la quinta)
        if (Math.random() < bass) this.feltPiano(midiFreq(bassM + (Math.random() < 0.75 ? 0 : 7)), { when: t0, velocity: 0.3, dest: bus, pan: -0.25, gain });
        // a volte l'ultima nota torna un'ottava sopra, appena sfiorata, come un'eco
        if (last !== null && last + 12 <= high + 7 && Math.random() < 0.25) this.feltPiano(midiFreq(last + 12), { when: t0 + t + beat, velocity: 0.2, dest: bus, pan: 0.3, gain });
        count++;
        wait = t + rand(rest[0], rest[1]);
      });
    };

    switch (name) {
      case 'intro':
        P.level = 0.55;
        drone([55, 82.41], 0.07);
        pad([110, 164.81, 277.18, 493.88], { type: 'triangle', gain: 0.03, cutoff: 900, lfoDepth: 250 });
        every(9, 16, sparkle([880, 1318.5, 1108.7], 0.012));
        piano({ root: 57, low: 62, high: 81, bpm: 48, gain: 0.1, rest: [6, 12] }); // la maggiore
        break;
      case 'movement':
        P.level = 0.55;
        drone([36.71, 73.42], 0.09);
        drone([110], 0.035, 'triangle');
        pad([146.83, 220, 329.63, 440], { type: 'sawtooth', gain: 0.012, cutoff: 700, q: 0.7, lfoDepth: 260 });
        noiseBed({ color: 'white', type: 'bandpass', freq: 3600, q: 7, gain: 0.012, freqLfo: [0.03, 900], gainLfo: [0.05, 0.8] });
        every(7, 12, sparkle([587.33, 659.25, 880, 987.77, 1174.66], 0.012));
        piano({ root: 62, low: 62, high: 81, bpm: 52, gain: 0.063 }); // re maggiore, il passo del bilanciere
        break;
      case 'celeste':
        P.level = 0.6;
        // il cielo era tutto nel registro medio-alto: più leggero, per lasciare spazio al pianoforte
        pad([146.83, 220, 369.99, 659.25, 880], { type: 'sine', gain: 0.03, cutoff: 2600, lfoDepth: 700, lfoRate: 0.03 });
        pad([293.66, 440], { type: 'triangle', gain: 0.014, cutoff: 1800 });
        noiseBed({ color: 'pink', type: 'bandpass', freq: 650, q: 0.6, gain: 0.05, freqLfo: [0.045, 380], gainLfo: [0.06, 0.7] });
        noiseBed({ color: 'pink', type: 'highpass', freq: 2800, q: 0.3, gain: 0.012, freqLfo: [0.02, 600], gainLfo: [0.09, 0.9] });
        every(10, 18, sparkle([1318.5, 1479.98, 1760], 0.01));
        piano({ root: 62, low: 66, high: 86, bpm: 50, gain: 0.17 }); // re maggiore, alto e arioso
        break;
      case 'sunset':
        P.level = 0.55;
        drone([51.91, 77.78], 0.06);
        pad([103.83, 155.56, 261.63, 392, 466.16], { type: 'sawtooth', gain: 0.014, cutoff: 820, q: 0.8, lfoDepth: 280 });
        pad([207.65, 311.13], { type: 'sine', gain: 0.03, cutoff: 1400 });
        every(9, 15, bell([415.3, 523.25, 622.25, 830.61], 0.028));
        every(16, 26, () => this.gliss(rand(0, 1) > 0.5 ? [311.13, 392] : [415.3, 523.25], { dest: out, gain: 0.016, dur: rand(2.5, 4) }));
        piano({ root: 56, low: 58, high: 77, bpm: 46, gain: 0.107 }); // la bemolle maggiore, più grave e caldo
        break;
      case 'virentia':
        P.level = 0.55;
        drone([82.41], 0.06);
        pad([82.41, 123.47, 196, 293.66, 369.99], { type: 'triangle', gain: 0.035, cutoff: 1150, lfoDepth: 320, lfoRate: 0.035 });
        noiseBed({ color: 'white', type: 'highpass', freq: 3800, q: 0.4, gain: 0.018, freqLfo: [0.07, 900], gainLfo: [0.23, 0.95] });
        noiseBed({ color: 'pink', type: 'lowpass', freq: 320, q: 0.5, gain: 0.05, freqLfo: [0.04, 120], gainLfo: [0.05, 0.6] });
        every(9, 16, () => this.pluck([164.81, 196, 246.94, 293.66][Math.floor(Math.random() * 4)], { dest: out, gain: 0.03 }));
        every(12, 20, sparkle([987.77, 1174.66, 1318.5], 0.008));
        piano({ root: 64, scale: PENTA_MINOR, low: 62, high: 83, bpm: 50, gain: 0.114 }); // mi minore, il bosco
        break;
      case 'epilogue':
        P.level = 0.6;
        drone([65.41, 98], 0.06);
        pad([130.81, 196, 329.63, 587.33, 987.77], { type: 'sine', gain: 0.03, cutoff: 2000, lfoDepth: 500, lfoRate: 0.025 });
        every(10, 16, sparkle([1046.5, 1318.5, 1567.98], 0.01));
        piano({ root: 60, low: 60, high: 79, bpm: 46, gain: 0.218, rest: [6, 11] }); // do maggiore, si chiude
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

  // Pianoforte "felt" (martelletti coperti di feltro, suono intimo e ovattato): parziali appena
  // inarmoniche come in una corda vera, due corde scordate di un capello, un attacco morbido con il
  // tonfo del martelletto, poi una caduta rapida e una coda lunga (più lunga nei bassi). Il feltro
  // smorza le armoniche alte: un passa-basso che si chiude subito dopo l'attacco.
  feltPiano(freq, { when = 0, velocity = 0.5, dest = null, pan = 0, gain = 0.05 } = {}) {
    if (!this.running) return;
    const ctx = this.ctx;
    const t0 = Math.max(ctx.currentTime, when);
    const out = ctx.createGain();
    out.gain.value = gain * (0.35 + 0.65 * velocity);
    let tail = out;
    if (ctx.createStereoPanner) {
      tail = ctx.createStereoPanner();
      tail.pan.value = Math.max(-0.8, Math.min(0.8, pan));
      out.connect(tail);
    }
    tail.connect(dest || this.musicBus);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.3;
    const bright = Math.min(9000, freq * (4 + 6 * velocity));
    lp.frequency.setValueAtTime(bright, t0);
    lp.frequency.exponentialRampToValueAtTime(Math.max(freq * 2.5, 700), t0 + 1.6);
    lp.connect(out);
    const sustain = Math.max(2.2, Math.min(8, 9 - Math.log2(freq / 65) * 1.4)); // secondi
    // solo le parziali che il feltro lascia passare (in fiera la CPU serve alla grafica)
    const N = Math.max(3, Math.min(10, Math.floor(Math.min(6500, bright * 1.4) / freq)));
    let longest = 0;
    for (let n = 1; n <= N; n++) {
      const fn = n * freq * Math.sqrt(1 + 0.00035 * n * n);
      const amp = 0.5 * Math.pow(n, -1.35) * (n === 8 ? 0.2 : 1);
      const fast = 0.3 / (1 + 0.25 * n);
      const slow = sustain / (1 + 0.3 * (n - 1));
      const atk = t0 + 0.004 + 0.0015 * n;
      const end = atk + fast * 2 + slow * 4;
      longest = Math.max(longest, end);
      // due corde scordate di un capello solo nelle parziali basse, dove il battimento si sente
      for (const det of n <= 3 ? [-0.7, 0.7] : [0]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = fn;
        o.detune.value = det + rand(-0.2, 0.2);
        const g = ctx.createGain();
        const a = n <= 3 ? amp : amp * Math.SQRT2; // una corda sola con l'energia di due
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(a, atk);
        g.gain.setTargetAtTime(a * 0.35, atk, fast);
        g.gain.setTargetAtTime(0, atk + fast * 2, slow);
        o.connect(g);
        g.connect(lp);
        o.start(t0);
        o.stop(end);
        o.onended = () => {
          o.disconnect();
          g.disconnect();
        };
      }
    }
    // il tonfo del martelletto sul feltro: rumore brevissimo e scuro
    const nz = ctx.createBufferSource();
    nz.buffer = this.buffers.pink;
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = Math.min(2400, freq * 4);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t0);
    ng.gain.linearRampToValueAtTime(0.2 * velocity, t0 + 0.002);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    nz.connect(nf);
    nf.connect(ng);
    ng.connect(out);
    nz.start(t0, rand(0, 3), 0.08);
    nz.onended = () => {
      nz.disconnect();
      nf.disconnect();
      ng.disconnect();
    };
    // a nota spenta si stacca anche la catena comune
    const done = ctx.createConstantSource ? ctx.createConstantSource() : null;
    if (done) {
      done.start(t0);
      done.stop(longest + 0.05);
      done.onended = () => {
        try {
          lp.disconnect();
          out.disconnect();
          if (tail !== out) tail.disconnect();
        } catch (e) { /* già scollegato */ }
      };
    }
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
