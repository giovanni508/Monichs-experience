// La musica del trailer: un pianoforte a feltro leggero sul motivo di Monichs (6-3-2-1, lo stesso
// che apre la melodia di ogni mondo nel gioco), un pad sotto, qualche tic dello scappamento
// all'inizio e un riverbero da sala. 64 BPM (un battito = 0,9375 s): 16 battiti = 15 s, e
// l'armonia cambia sui tagli del montaggio (battiti 3, 5, 7, 9, 11, 13).
//
// Il pianoforte è sintetizzato in differita, quindi senza i limiti del gioco (dove la CPU serve alla
// grafica): fino a 40 parziali appena inarmoniche per nota, due corde scordate di un capello nelle
// prime dieci, decadimento in due tempi (più lungo nei bassi), il colpo del martelletto sul feltro,
// gli smorzatori a ogni cambio di pedale. Il casuale ha un seme fisso: l'audio è sempre lo stesso.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SR = 48000;
const LEN = 15.6;
const N = Math.ceil(LEN * SR);
const BEAT = 60 / 64;

let seed = 7;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const NOTE = (s) => {
  const m = s.match(/^([A-G])(#|b)?(-?\d)$/);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  return 12 * (Number(m[3]) + 1) + base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
};

// ------------------------------------------------------------------ partitura (re maggiore)
// [battito, nota, velocità]; il pedale si rialza all'inizio di ogni tratto (battiti)
const PEDAL = [0, 3, 4, 7, 9, 11, 13, 99];
const SCORE = [
  // A, le tre Delta: basso re, il motivo 6-3-2-1 (si fa# mi re)
  [0.0, 'D2', 0.3], [0.03, 'A2', 0.24],
  [0.5, 'B4', 0.46],
  [2.0, 'F#4', 0.4],
  // B, si entra: sol sotto il mi
  [3.0, 'G2', 0.3], [3.03, 'D3', 0.22], [3.0, 'E4', 0.4],
  // il motivo si posa (si minore), poi gli ingranaggi: un arpeggio che sale
  [4.0, 'B1', 0.3], [4.03, 'F#2', 0.24], [4.0, 'D4', 0.38],
  [5.0, 'B3', 0.26], [5.5, 'D4', 0.25], [6.0, 'F#4', 0.27], [6.5, 'A4', 0.29],
  // D, Celeste: alto e arioso
  [7.0, 'G2', 0.3], [7.03, 'D3', 0.23], [7.06, 'B3', 0.17], [7.0, 'D5', 0.42],
  [8.0, 'E5', 0.37],
  // E, Sunset
  [9.0, 'A2', 0.3], [9.03, 'E3', 0.23], [9.06, 'C#4', 0.15], [9.0, 'F#5', 0.42],
  [10.5, 'B5', 0.32],
  // F, Virentia: mi minore, il bosco
  [11.0, 'E2', 0.3], [11.03, 'B2', 0.23], [11.06, 'G3', 0.18], [11.0, 'A5', 0.38],
  [12.0, 'F#5', 0.34],
  // G, il cartello: a casa, re con la nona
  [13.0, 'D2', 0.34], [13.03, 'A2', 0.27], [13.06, 'E3', 0.2], [13.09, 'F#3', 0.2], [13.0, 'D5', 0.4],
  [14.4, 'D6', 0.2],
];
// gli accordi del pad sotto il pianoforte (battiti → note)
const PAD = [
  [0, 3, ['D3', 'A3', 'F#4']],
  [3, 4, ['G3', 'B3', 'D4']],
  [4, 7, ['B2', 'F#3', 'D4']],
  [7, 9, ['G3', 'B3', 'D4']],
  [9, 11, ['A3', 'C#4', 'E4']],
  [11, 13, ['E3', 'G3', 'B3']],
  [13, 16.6, ['D3', 'A3', 'F#4']],
];

// ------------------------------------------------------------------ una nota di pianoforte a feltro
function pianoNote(L, R, f0, t0, vel, tOff, pan, level = 1) {
  const B = 0.00018 * Math.pow(2, Math.log2(f0 / 261.6) * 0.9); // inarmonicità
  const x0 = 0.122; // punto in cui batte il martelletto: smorza le parziali vicine all'ottava
  const fc = 900 + 2600 * vel; // il feltro: scuro, più chiaro quando si suona forte
  const p = 2.0 - 0.8 * vel;
  const tau2 = Math.min(14, 7.5 * Math.pow(f0 / 130, -0.55)); // la coda (s)
  const start = Math.floor(t0 * SR);
  const end = Math.min(N, Math.floor((tOff + 1.2) * SR));
  const gl = Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = Math.sin(((pan + 1) * Math.PI) / 4);
  const partials = [];
  for (let n = 1; n <= 40; n++) {
    const fn = n * f0 * Math.sqrt(1 + B * n * n);
    if (fn > 11000) break;
    const a = (Math.pow(n, -p) * Math.abs(Math.sin(Math.PI * n * x0))) / (1 + Math.pow(fn / fc, 2));
    if (a < 1e-5) continue;
    const t2 = tau2 / (1 + 0.1 * (n - 1) * (1 + f0 / 500));
    const t1 = Math.max(0.05, t2 / 7);
    const strings = n <= 10 ? [-0.45, 0.45] : [0];
    for (const c of strings) {
      partials.push({
        w: (2 * Math.PI * fn * Math.pow(2, (c + (rnd() - 0.5) * 0.25) / 1200)) / SR,
        ph: rnd() * 2 * Math.PI,
        a: a / strings.length,
        d1: Math.exp(-1 / (t1 * SR)),
        d2: Math.exp(-1 / (t2 * SR)),
        side: c < 0 ? -1 : c > 0 ? 1 : 0,
      });
    }
  }
  const gain = 0.16 * (0.3 + 0.7 * vel) * level;
  const atk = Math.floor(0.003 * SR);
  const relStart = Math.floor(tOff * SR) - start;
  const relK = Math.exp(-1 / (0.16 * SR)); // lo smorzatore di feltro
  for (const q of partials) {
    let e1 = 0.55;
    let e2 = 0.45;
    let rel = 1;
    let ph = q.ph;
    // le due corde stanno appena separate nell'immagine stereo
    const sl = gl * (1 - 0.12 * q.side);
    const sr = gr * (1 + 0.12 * q.side);
    for (let i = 0; i < end - start; i++) {
      const env = (e1 + e2) * rel * (i < atk ? 0.5 - 0.5 * Math.cos((Math.PI * i) / atk) : 1);
      const s = Math.sin(ph) * q.a * env * gain;
      L[start + i] += s * sl;
      R[start + i] += s * sr;
      ph += q.w;
      e1 *= q.d1;
      e2 *= q.d2;
      if (i >= relStart) rel *= relK;
      if (rel < 1e-4 || e1 + e2 < 1e-5) break;
    }
  }
  // il martelletto sul feltro: un tonfo breve e scuro e un soffio di meccanica
  let lp = 0;
  const nf = Math.min(0.25, (2 * Math.PI * Math.min(1800, f0 * 3)) / SR);
  const tn = Math.floor(0.045 * SR);
  for (let i = 0; i < tn; i++) {
    const env = Math.exp(-i / (0.008 * SR)) * 0.6 + Math.exp(-i / (0.02 * SR)) * 0.4;
    lp += nf * (rnd() * 2 - 1 - lp);
    const thump = Math.sin((2 * Math.PI * 95 * i) / SR) * Math.exp(-i / (0.012 * SR));
    const s = (lp * 0.5 + thump * 0.25) * env * gain * vel * 0.9;
    L[start + i] += s * gl;
    R[start + i] += s * gr;
  }
}

// ------------------------------------------------------------------ pad: sinusoidi scordate, respiro lento
function pad(L, R) {
  for (const [b0, b1, notes] of PAD) {
    const t0 = b0 * BEAT - 0.25;
    const t1 = b1 * BEAT + 0.35;
    for (const nn of notes) {
      const f = midiHz(NOTE(nn));
      for (const [det, pan] of [[-6, -0.5], [0, 0], [6, 0.5]]) {
        const w = (2 * Math.PI * f * Math.pow(2, det / 1200)) / SR;
        let ph = rnd() * 6.28;
        const gl = Math.cos(((pan + 1) * Math.PI) / 4);
        const gr = Math.sin(((pan + 1) * Math.PI) / 4);
        const s0 = Math.max(0, Math.floor(t0 * SR));
        const s1 = Math.min(N, Math.floor((t1 + 1.6) * SR));
        for (let i = s0; i < s1; i++) {
          const t = i / SR;
          const up = Math.min(1, Math.max(0, (t - t0) / 1.1));
          const down = t > t1 ? Math.exp(-(t - t1) / 0.5) : 1;
          const env = Math.sin((up * Math.PI) / 2) ** 2 * down;
          // un gonfiarsi lento verso il "si entra" (battiti 2–3)
          const swell = 1 + 0.6 * Math.exp(-Math.pow((t - 2.7) / 0.5, 2));
          const s = (Math.sin(ph) + 0.18 * Math.sin(2 * ph)) * env * swell * 0.0045;
          L[i] += s * gl;
          R[i] += s * gr;
          ph += w;
        }
      }
    }
  }
}

// ------------------------------------------------------------------ i tic dello scappamento (solo all'inizio)
function ticks(L, R) {
  for (let k = 0; k < 26; k++) {
    const t0 = 0.06 + k * 0.125;
    const fade = Math.min(1, t0 / 0.5) * Math.max(0, 1 - Math.max(0, t0 - 1.6) / 1.4);
    if (fade <= 0) continue;
    const f = k % 2 ? 2900 : 3350;
    const s0 = Math.floor(t0 * SR);
    let lp = 0;
    for (let i = 0; i < 0.03 * SR; i++) {
      const n = rnd() * 2 - 1;
      lp += 0.35 * (n - lp);
      const env = Math.exp(-i / (0.0025 * SR));
      const ring = Math.sin((2 * Math.PI * f * i) / SR) * Math.exp(-i / (0.006 * SR));
      const s = ((n - lp) * 0.3 * env + ring * 0.5) * 0.02 * fade;
      L[s0 + i] += s * 0.9;
      R[s0 + i] += s * 1.1;
    }
  }
}

// ------------------------------------------------------------------ risposta all'impulso della sala
function impulse(seconds = 3.4) {
  const n = Math.floor(seconds * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const pre = Math.floor(0.022 * SR);
  for (const ch of [L, R]) {
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / SR;
      // gli acuti si spengono prima: il passa-basso si chiude mentre la coda decade
      const cut = 0.55 * Math.exp(-t / 0.9) + 0.06;
      lp += cut * (rnd() * 2 - 1 - lp);
      const env = Math.exp((-6.9 * t) / 2.9) * Math.min(1, t / 0.04 + 0.2);
      ch[i] = lp * env;
    }
    // qualche prima riflessione
    for (const [ms, g] of [[11, 0.5], [19, 0.35], [29, 0.3], [41, 0.22], [57, 0.18]]) ch[Math.floor((ms / 1000) * SR) + pre] += g * (rnd() > 0.5 ? 1 : -1);
  }
  return [L, R];
}

function writeWav(file, chans) {
  const n = chans[0].length;
  const buf = Buffer.alloc(44 + n * chans.length * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * chans.length * 4, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20); // virgola mobile
  buf.writeUInt16LE(chans.length, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * chans.length * 4, 28);
  buf.writeUInt16LE(chans.length * 4, 32);
  buf.writeUInt16LE(32, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * chans.length * 4, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (const c of chans) {
      buf.writeFloatLE(c[i], o);
      o += 4;
    }
  }
  fs.writeFileSync(file, buf);
}

export async function renderMusic({ dir }) {
  fs.mkdirSync(dir, { recursive: true });
  seed = 7;
  const pL = new Float32Array(N);
  const pR = new Float32Array(N);
  for (const [beat, nn, vel] of SCORE) {
    const m = NOTE(nn);
    const t0 = beat * BEAT + (rnd() - 0.5) * 0.012;
    const tOff = PEDAL.find((p) => p > beat + 1e-6) * BEAT + 0.02;
    // la melodia guida: il motivo sta sopra il basso e il pad
    const level = m >= 62 ? 1.7 : m < 48 ? 0.8 : 1;
    pianoNote(pL, pR, midiHz(m), t0, vel, tOff, Math.max(-0.45, Math.min(0.45, (m - 62) / 36)), level);
  }
  writeWav(path.join(dir, 'piano.wav'), [pL, pR]);
  const aL = new Float32Array(N);
  const aR = new Float32Array(N);
  pad(aL, aR);
  writeWav(path.join(dir, 'pad.wav'), [aL, aR]);
  const tL = new Float32Array(N);
  const tR = new Float32Array(N);
  ticks(tL, tR);
  writeWav(path.join(dir, 'ticks.wav'), [tL, tR]);
  writeWav(path.join(dir, 'ir.wav'), impulse());

  // missaggio: pianoforte e pad nella sala (un terzo di riverbero), i tic asciutti, un filo di
  // corpo a 220 Hz, -16 LUFS con il picco sotto -1,5 dBFS, dissolvenza negli ultimi 0,65 s
  const f = (n) => path.join(dir, n);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', f('piano.wav'), '-i', f('pad.wav'), '-i', f('ticks.wav'), '-i', f('ir.wav'), '-filter_complex',
    "[0][1]amix=inputs=2:weights='1 1':normalize=0[pp];[pp]asplit[dry][tow];[tow][3]afir=dry=1:wet=1:irgain=1[rev];" +
    "[dry][rev]amix=inputs=2:weights='1 0.32':normalize=0[mix];[mix][2]amix=inputs=2:weights='1 1':normalize=0," +
    'equalizer=f=220:t=q:w=1:g=1.5,equalizer=f=3500:t=q:w=1.2:g=-1,atrim=0:15,afade=t=out:st=14.35:d=0.65,' +
    'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[out]',
    '-map', '[out]', '-c:a', 'pcm_s16le', f('mix.wav')], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg: missaggio non riuscito');
  console.log('musica: mix.wav');
}
