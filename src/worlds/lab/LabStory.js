import { babblePlan, babbleLevel } from '../../core/Audio.js';

// ---------------------------------------------------------------------------------------------
// Il racconto del laboratorio, guidato dai dati (content/lab.json): una battuta dopo l'altra, con
// chi parla, l'oggetto che si accende, i gesti, gli eventi della regia (tickStop, lookUp, grow,
// thanks) e le pause. Le voci sono in italiano; in inglese sono doppiate. Ogni battuta parla nella
// lingua scelta quando comincia: la clip di quella lingua se c'è (assets/audio/lab/<lingua>/<chiave>.mp3,
// ne decide la durata); in inglese, se il doppiaggio manca, la voce italiana con i sottotitoli in
// inglese; senza clip, il borbottio segnaposto con i tempi calcolati sul testo di quella lingua.
// I sottotitoli seguono sempre la lingua (anche a metà battuta). In pausa tutto si ferma insieme.
// ---------------------------------------------------------------------------------------------

export const TIMING = {
  charsPerSecond: { giovanni: 13.2, filippo: 14.2, both: 9 },
  lineBase: 0.55,
  commaPause: 0.24,
  stopPause: 0.42,
  gap: 0.65,
  arrive: 3.6,
  tickSilence: 1.8,
  grow: 4.2,
  white: 2.4,
  card: 5.2,
};

const shortKey = (key) => key.split('.').pop();
const listOf = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Durata parlata di una battuta senza clip: più lenta della lettura, con il respiro della punteggiatura. */
export function lineDuration(text, speaker, T = TIMING) {
  const body = text.trim();
  const commas = (body.match(/[,:;—]/g) || []).length;
  const stops = (body.slice(0, -1).match(/[.?!]/g) || []).length;
  const cps = T.charsPerSecond[speaker] ?? 12;
  return T.lineBase + body.length / cps + commas * T.commaPause + stops * T.stopPause;
}

export class LabStory {
  /**
   * world: il LabWorld (eventi della scena); script: content/lab.json;
   * clips: Map "lingua:chiave" → AudioBuffer (per esempio "it:g1", "en:g1")
   */
  constructor(world, script, clips = new Map()) {
    this.world = world;
    this.app = world.app;
    this.lines = script.lines || [];
    this.T = { ...TIMING, ...(script.timing || {}), charsPerSecond: { ...TIMING.charsPerSecond, ...(script.timing?.charsPerSecond || {}) } };
    this.clips = clips;
    this.sections = [];
    for (const l of this.lines) if (l.section && !this.sections.includes(l.section)) this.sections.push(l.section);
    this.app.i18n.onChange(() => this.showSubtitle());
    this.reset();
  }

  reset() {
    this.stopVoice();
    this.phase = 'idle';
    this.index = -1;
    this.elapsed = 0;
    this.lineT = 0;
    this.lineDur = 0;
    this.wait = 0;
    this.voices = [];
    this.tape = null;
    this.section = -1;
    this.lookUpAt = -1;
    this.paused = false;
    this.voiceLang = 'it';
  }

  start() {
    this.reset();
    this.phase = 'arrive';
    this.wait = this.T.arrive;
  }

  get running() {
    return this.phase !== 'idle' && this.phase !== 'done';
  }

  // il reset per inattività resta sospeso finché si racconta; dal cartello in poi torna normale, e
  // anche in pausa: chi se ne va lasciando il racconto sospeso ritrova il menu, come negli altri livelli
  get holdsIdle() {
    return this.running && !this.paused && this.phase !== 'card';
  }

  get line() {
    return this.lines[this.index] || null;
  }

  /** Chi sta parlando adesso (nomi), [] nelle pause. */
  get speakers() {
    if (this.phase !== 'line' || !this.line) return [];
    return this.line.speaker === 'both' ? ['giovanni', 'filippo'] : [this.line.speaker];
  }

  /** Indice della battuta che rompe la quarta parete (il salto porta lì). */
  get fourthWall() {
    const i = this.lines.findIndex((l) => listOf(l.event).includes('tickStop') || listOf(l.event).includes('lookUp'));
    return i < 0 ? this.lines.length - 1 : i;
  }

  textOf(line, lang = null) {
    const i18n = this.app.i18n;
    if (!lang) return i18n.t(line.key);
    const node = i18n.raw(line.key);
    return (node && (node[lang] ?? node.it)) || '';
  }

  /** Lingua della voce adesso: quella scelta (le voci sono in italiano, l'inglese è doppiato). */
  get lang() {
    return this.app.i18n.lang;
  }

  /**
   * La voce di una battuta in una lingua: { clip, lang }. In inglese, se il doppiaggio manca, si
   * usa la clip italiana; senza clip, clip è null e parla il borbottio nella lingua chiesta.
   */
  voiceOf(i, lang = this.lang) {
    const k = shortKey(this.lines[i].key);
    const own = this.clips.get(`${lang}:${k}`);
    if (own) return { clip: own, lang };
    const it = lang !== 'it' ? this.clips.get(`it:${k}`) : null;
    if (it) return { clip: it, lang: 'it' };
    return { clip: null, lang };
  }

  durationOf(i, lang = this.lang) {
    const l = this.lines[i];
    const v = this.voiceOf(i, lang);
    if (v.clip) return v.clip.duration + 0.12;
    return lineDuration(this.textOf(l, v.lang), l.speaker, this.T);
  }

  /** Silenzio dopo una battuta: il suo gap (più corto nei botta e risposta) o quello comune, più la pausa. */
  gapAfter(l) {
    return (l.gap ?? this.T.gap) + (l.pause || 0);
  }

  /** Durata totale prevista (s) in una lingua: arrivo, battute, pause, crescita, bianco, cartello. */
  totalDuration(lang = this.lang) {
    let t = this.T.arrive;
    this.lines.forEach((l, i) => {
      const ev = listOf(l.event);
      if (ev.includes('tickStop')) t += this.T.tickSilence;
      t += this.durationOf(i, lang);
      if (ev.includes('grow')) t += this.T.grow;
      else if (!ev.includes('thanks')) t += this.gapAfter(l);
    });
    return t + this.T.white + this.T.card;
  }

  // ------------------------------------------------------------------ voce e sottotitoli

  speakerLabel(line) {
    const t = (k) => this.app.i18n.t(`lab.speaker.${k}`);
    if (!line) return '';
    return line.speaker === 'both' ? `${t('giovanni')} · ${t('filippo')}` : t(line.speaker);
  }

  showSubtitle() {
    if (this.phase !== 'line' || !this.line) return;
    this.app.ui.setSubtitle(this.textOf(this.line), this.speakerLabel(this.line));
  }

  // la voce della battuta corrente, nella lingua fissata quando è cominciata (this.voiceLang)
  startVoice(offset = 0) {
    const l = this.line;
    const audio = this.app.audio;
    const { clip } = this.voiceOf(this.index, this.voiceLang);
    this.tape = null;
    this.voices = [];
    if (clip) {
      this.tape = audio.playClip(clip, offset);
      return;
    }
    // borbottio: una partitura per ogni voce che parla (in "both" parlano insieme)
    const text = this.textOf(l, this.voiceLang);
    for (const v of l.speaker === 'both' ? ['giovanni', 'filippo'] : [l.speaker]) {
      const plan = babblePlan(text, v, this.lineDur, this.index + (v === 'filippo' ? 101 : 1));
      const state = { plan, voice: v, cursor: 0 };
      // dopo una pausa si riprende da dove si era: le sillabe già dette restano dette
      while (state.cursor < plan.events.length && plan.events[state.cursor].t < offset) state.cursor++;
      this.voices.push(state);
    }
  }

  stopVoice() {
    if (this.tape) this.app.audio.stopClip(this.tape);
    this.tape = null;
    this.voices = [];
  }

  /** Apertura della bocca e vocale per un fondatore (null se non parla). */
  talkOf(name) {
    if (!this.speakers.includes(name) || this.paused) return null;
    if (this.tape) return { level: this.app.audio.clipLevel(this.tape), vowel: 'a' };
    const v = this.voices.find((s) => s.voice === name);
    return v ? babbleLevel(v.plan, this.lineT) : null;
  }

  // ------------------------------------------------------------------ svolgimento

  setPaused(p) {
    if (p === this.paused) return;
    this.paused = p;
    if (this.phase !== 'line') return;
    if (p) {
      if (this.tape) this.app.audio.stopClip(this.tape);
      this.tape = null;
      this.voices = [];
    } else this.startVoice(this.lineT);
  }

  update(dt) {
    if (!this.running || this.paused || dt <= 0) return;
    this.elapsed += dt;
    switch (this.phase) {
      case 'arrive':
        this.wait -= dt;
        if (this.wait <= 0) this.begin(0);
        break;
      case 'pre':
        this.wait -= dt;
        if (this.wait <= 0) this.speak();
        break;
      case 'line':
        this.lineT += dt;
        for (const v of this.voices) this.app.audio.scheduleBabble(v, this.lineT);
        if (this.lookUpAt >= 0 && this.lineT >= this.lookUpAt) {
          this.lookUpAt = -1;
          this.world.onLookUp();
        }
        if (this.lineT >= this.lineDur) this.end();
        break;
      case 'gap':
        this.wait -= dt;
        if (this.wait <= 0) this.begin(this.index + 1);
        break;
      case 'grow':
        this.wait -= dt;
        this.world.onGrowProgress(1 - Math.max(0, this.wait) / this.T.grow);
        if (this.wait <= 0) {
          this.world.onGrowEnd();
          this.begin(this.index + 1);
        }
        break;
      case 'white':
        this.wait -= dt;
        if (this.wait <= 0) {
          this.phase = 'card';
          this.wait = this.T.card;
          this.world.onCard();
        }
        break;
      case 'card':
        this.wait -= dt;
        if (this.wait <= 0) this.finish();
        break;
      default:
        break;
    }
  }

  begin(i) {
    if (i >= this.lines.length) {
      this.finish();
      return;
    }
    this.index = i;
    const l = this.lines[i];
    if (l.section) {
      this.section = this.sections.indexOf(l.section);
      this.world.onSection(this.section);
    }
    if (listOf(l.event).includes('tickStop')) {
      // il tic si ferma, poi un attimo di silenzio prima della quarta parete
      this.world.onTickStop();
      this.phase = 'pre';
      this.wait = this.T.tickSilence;
      return;
    }
    this.speak();
  }

  speak() {
    const l = this.line;
    this.phase = 'line';
    this.lineT = 0;
    // la battuta resta nella lingua in cui comincia (cambiando lingua a metà cambiano solo i sottotitoli)
    const voice = this.voiceOf(this.index, this.lang);
    this.voiceLang = voice.lang;
    this.lineDur = this.durationOf(this.index, this.lang);
    this.startVoice(0);
    this.showSubtitle();
    this.app.audio.duckMusic(0.5, 0.6);
    const ev = listOf(l.event);
    // lookUp alla fine della prima frase ("Anzi, aspetta." → si raddrizzano e guardano oltre)
    this.lookUpAt = -1;
    if (ev.includes('lookUp')) {
      const said = this.textOf(l, this.voiceLang);
      const m = /[.?!](\s|$)/.exec(said);
      const frac = m ? Math.min(0.6, Math.max(0.2, (m.index + 1) / said.length)) : 0.3;
      this.lookUpAt = frac * this.lineDur;
    }
    if (l.highlight) this.world.onHighlight(l.highlight, this.speakers);
    if (l.gesture) for (const s of this.speakers) this.world.onGesture(s, l.gesture);
    this.world.onLine(l, this.speakers);
  }

  end() {
    const l = this.line;
    const ev = listOf(l.event);
    this.stopVoice();
    if (this.lookUpAt >= 0) {
      this.lookUpAt = -1;
      this.world.onLookUp();
    }
    this.app.ui.setSubtitle('');
    if (ev.includes('grow')) {
      this.phase = 'grow';
      this.wait = this.T.grow;
      this.world.onGrowStart(this.T.grow);
      return;
    }
    if (ev.includes('thanks')) {
      this.phase = 'white';
      this.wait = this.T.white;
      this.app.audio.duckMusic(1, 3);
      this.world.onThanks(this.T.white);
      return;
    }
    const gap = this.gapAfter(l);
    if (gap > 1.2) this.app.audio.duckMusic(0.85, 1.4);
    this.phase = 'gap';
    this.wait = gap;
  }

  finish() {
    if (this.phase === 'done') return;
    this.stopVoice();
    this.phase = 'done';
    this.app.ui.setSubtitle('');
    this.app.audio.duckMusic(1, 2);
    this.world.onFinish();
  }

  /**
   * Tenere premuto: prima della quarta parete si salta lì (così tutti vedono il finale); dalla
   * quarta parete in poi si va all'epilogo.
   */
  skip() {
    if (!this.running) return;
    const fw = this.fourthWall;
    if (this.index >= fw || this.phase === 'white' || this.phase === 'card' || this.phase === 'grow') {
      this.finish();
      return;
    }
    this.stopVoice();
    this.app.ui.setSubtitle('');
    this.world.onSkip();
    this.begin(fw);
  }
}
