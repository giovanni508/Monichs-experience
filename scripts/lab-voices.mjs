// Voci del laboratorio: prepara le clip per il gioco (public/assets/audio/lab/<lingua>/<chiave>.mp3)
// partendo da una cartella di registrazioni o di sintesi, una per battuta (<chiave>.mp3/.wav/...,
// chiavi di content/lab.json: g1, f1, ... both1). Le sorgenti non vengono toccate.
//
//   npm run voci -- <cartella> it          → originali in italiano
//   npm run voci -- <cartella> en          → doppiaggio inglese
//   ... --tail                             → ogni sorgente finisce con una parola in più da togliere
//   ... --tail=g3,f10                      → solo queste
//   ... --tempo=g:0.92                     → più lento (o veloce) senza cambiare la voce: per chi parla
//                                            (g = Giovanni, f = Filippo) o per tutti (--tempo=0.95)
//   ... --out <cartella>                   → altrove (per esempio dist/assets/audio/lab/it)
//
// Per ogni clip: via il silenzio prima e dopo (resta un filo d'aria), via i clic isolati in fondo,
// livello uniforme (-16 LUFS integrati, picco limitato a -1,5 dBFS), dissolvenze brevi, mp3 mono
// 44,1 kHz a 96 kbps. "both1" (detta insieme) può arrivare già mescolata o come both1_g + both1_f:
// lo script le porta allo stesso livello e le sovrappone, Filippo 30 ms dopo.
//
// La "coda sacrificale" serve con la sintesi vocale, che a volte tronca l'ultima sillaba: si fa
// generare la battuta seguita da una pausa e da una parola in più ("…\n\nEcco." / "…\n\nOkay."),
// il troncamento cade su quella e qui la si toglie (deve essere l'ultimo tratto dopo almeno 250 ms
// di silenzio). Il tempo usa atempo di ffmpeg: cambia il passo, non il timbro né l'altezza (tra 0,5
// e 2; per il parlato meglio restare entro ±10%). Serve ffmpeg nel PATH.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SR = 44100;
const TARGET = -16; // LUFS
const PRE = 0.035; // aria prima della prima sillaba (s)
const POST = 0.16; // coda dopo l'ultima: consonanti finali e respiro (s)
const W = Math.round(SR * 0.01); // finestre da 10 ms
const EXTS = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aif', '.aiff'];

// ------------------------------------------------------------------ argomenti

const argv = process.argv.slice(2);
const opt = { tail: null, out: null, tempo: {} };
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--tail') opt.tail = 'all';
  else if (a.startsWith('--tail=')) opt.tail = new Set(a.slice(7).split(','));
  else if (a.startsWith('--tempo=')) {
    for (const part of a.slice(8).split(',')) {
      const [who, v] = part.includes(':') ? part.split(':') : ['*', part];
      opt.tempo[who] = parseFloat(v);
    }
  } else if (a === '--out') opt.out = argv[++i];
  else pos.push(a);
}
const [srcDir, lang] = pos;
if (!srcDir || !lang) {
  console.log('Uso: npm run voci -- <cartella-sorgenti> <it|en> [--tail | --tail=g3,f10] [--tempo=g:0.92] [--out <cartella>]');
  process.exit(1);
}
const outDir = path.resolve(opt.out || path.join(ROOT, 'public', 'assets', 'audio', 'lab', lang));
const wantsTail = (key) => opt.tail === 'all' || (opt.tail && opt.tail.has(key));
// chi parla: la prima lettera della chiave (g1, f10) o il suffisso di una voce di "both" (both1_g)
const tempoOf = (key) => {
  const who = /_([gf])$/.exec(key)?.[1] || key[0];
  return opt.tempo[who] ?? opt.tempo['*'] ?? 1;
};

if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
  console.error('ffmpeg non trovato nel PATH: serve per leggere, misurare e codificare le clip.');
  process.exit(1);
}

// ------------------------------------------------------------------ audio

function ffmpeg(args, input = null) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { input, maxBuffer: 1 << 29 });
  if (r.status !== 0) throw new Error(`ffmpeg: ${String(r.stderr).trim().split('\n').pop()}`);
  return r;
}

const asFloat = (buf) => new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
const asBytes = (x) => Buffer.from(x.buffer, x.byteOffset, x.length * 4);
const RAW = ['-f', 'f32le', '-ar', String(SR), '-ac', '1'];

function decode(file, tempo = 1) {
  // atempo (WSOLA, pensato per il parlato): lascia identico lo spettro, quindi il timbro della voce;
  // rubberband qui spostava l'equilibrio di circa 1 dB e lasciava uno scoppio in fondo al flusso
  const af = tempo !== 1 ? ['-af', `atempo=${tempo}`] : [];
  return asFloat(ffmpeg(['-v', 'error', '-i', file, ...af, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-']).stdout);
}

function loudness(x) {
  const log = String(ffmpeg(['-v', 'info', ...RAW, '-i', 'pipe:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'], asBytes(x)).stderr);
  const sum = log.slice(log.lastIndexOf('Summary:'));
  return {
    I: parseFloat((/I:\s+(-?[\d.]+) LUFS/.exec(sum) || [])[1]),
    peak: parseFloat((/Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(sum) || [])[1]),
  };
}

const LIMITER = 'alimiter=limit=0.841:attack=2:release=60:level=0:latency=1';
function level(x, gainDb) {
  return asFloat(ffmpeg(['-v', 'error', ...RAW, '-i', 'pipe:0', '-af', `volume=${gainDb.toFixed(2)}dB,${LIMITER}`, '-f', 'f32le', '-'], asBytes(x)).stdout);
}

// livello in dB per finestre da 10 ms
function envelope(x) {
  const n = Math.floor(x.length / W);
  const db = new Float32Array(n);
  let top = -120;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < W; j++) s += x[i * W + j] ** 2;
    db[i] = 10 * Math.log10(s / W + 1e-12);
    top = Math.max(top, db[i]);
  }
  return { db, n, top };
}

// tratti sopra soglia, fusi se separati da meno di `bridge` finestre
function segments(db, thr, bridge) {
  const segs = [];
  let cur = null;
  for (let i = 0; i < db.length; i++) {
    if (db[i] < thr) continue;
    if (cur && i - cur.b - 1 < bridge) cur.b = i;
    else segs.push((cur = { a: i, b: i }));
  }
  return segs;
}

function trim(x, key, tail) {
  const { db, n, top } = envelope(x);
  const thr = Math.max(-50, top - 38);
  let segs = segments(db, thr, 10);
  if (!segs.length) throw new Error(`${key}: clip muta`);
  let limit = n;
  let start = 0;
  let note = '';
  // in fondo, dopo una pausa di almeno 80 ms, un frammento breve (fino a 200 ms) che arriva alla fine
  // del file: il generatore l'ha cominciato e troncato (un respiro, l'attacco di un'altra sillaba)
  const fine = segments(db, thr, 6);
  if (fine.length > 1) {
    const f = fine[fine.length - 1];
    if (n - 1 - f.b < 3 && f.a - fine[fine.length - 2].b - 1 >= 8 && f.b - f.a + 1 <= 20) {
      // un tratto largo che l'aveva inglobato (pausa sotto i 100 ms) finisce dove finiva la voce
      const end = fine[fine.length - 2].b;
      segs = segs.filter((s) => s.a < f.a).map((s) => (s.b >= f.a ? { a: s.a, b: end } : s));
      limit = f.a - 1;
      note = `  (tolto un frammento troncato in fondo: ${((f.b - f.a + 1) * W) / SR} s)`;
    }
  }
  // clic isolati (meno di 60 ms, a ridosso dei bordi): non sono parlato, e la coda non li riprende
  const blip = (s) => s.b - s.a + 1 < 6;
  while (segs.length > 1 && blip(segs[segs.length - 1]) && limit - 1 - segs[segs.length - 1].b < 8) limit = segs.pop().a - 1;
  while (segs.length > 1 && blip(segs[0]) && segs[0].a < 8) start = segs.shift().b + 1;
  if (tail) {
    // la parola in più è l'ultimo gruppo dopo una pausa di almeno 250 ms (più lunga della
    // chiusura di una doppia, "Ecco", che non deve spezzarla); se la pausa è più corta (la coda
    // della frase resta sopra la soglia bassa), la si cerca di nuovo con una soglia più alta
    const lastWord = (list, bridge) => {
      const words = [];
      for (const s of list) {
        const w = words[words.length - 1];
        if (w && s.a - w.b - 1 < bridge) w.b = s.b;
        else words.push({ ...s });
      }
      const last = words[words.length - 1];
      const len = ((last.b - last.a + 1) * W) / SR;
      return words.length >= 2 && len >= 0.15 && len <= 1.3 ? { last, len } : null;
    };
    // dopo l'ultima sillaba forte (entro 25 dB dal picco) restano solo respiri e fruscio: non contano
    let hard = Math.min(n, limit) - 1; // i frammenti e i clic in fondo sono già fuori
    while (hard > 0 && db[hard] < top - 25) hard--;
    const upTo = (list) => list.filter((s) => s.a <= hard + 15).map((s) => ({ a: s.a, b: Math.min(s.b, hard + 15) }));
    const found = lastWord(upTo(segs), 25) || lastWord(upTo(segments(db, Math.max(-45, top - 30), 6)), 18);
    if (!found) throw new Error(`${key}: parola in più non trovata`);
    const { last, len } = found;
    // i tratti a cavallo dell'inizio della parola si fermano lì
    segs = segs.filter((s) => s.a < last.a).map((s) => (s.b >= last.a ? { a: s.a, b: last.a - 3 } : s));
    limit = Math.min(limit, last.a - 2);
    note = `  (tolta la parola in più: ${len.toFixed(2)} s)`;
  }
  const s0 = Math.max(start * W, segs[0].a * W - Math.round(PRE * SR));
  const s1 = Math.min(x.length, limit * W, (segs[segs.length - 1].b + 1) * W + Math.round(POST * SR));
  return { x: x.slice(s0, s1), note };
}

function write(key, x, note) {
  const I0 = loudness(x).I;
  // due giri: quando il limitatore lavora toglie un po' di volume, il secondo giro lo rende
  let gain = TARGET - I0;
  gain += TARGET - loudness(level(x, gain)).I;
  const y = level(x, gain);
  const dur = y.length / SR;
  const out = path.join(outDir, `${key}.mp3`);
  ffmpeg(['-v', 'error', ...RAW, '-i', 'pipe:0', '-af', `afade=t=in:st=0:d=0.008,afade=t=out:st=${(dur - 0.05).toFixed(3)}:d=0.05`, '-c:a', 'libmp3lame', '-b:a', '96k', '-ar', String(SR), '-ac', '1', '-y', out], asBytes(y));
  const m = loudness(decode(out));
  console.log(`  ${key.padEnd(6)} ${dur.toFixed(2).padStart(6)} s   ${I0.toFixed(1)} → ${m.I.toFixed(1)} LUFS, picco ${m.peak.toFixed(1)} dBFS${note}`);
  return dur;
}

// ------------------------------------------------------------------ battute

function find(dir, key) {
  for (const ext of EXTS) {
    const f = path.join(dir, key + ext);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

const script = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'lab.json'), 'utf8'));
const keys = script.lines.map((l) => l.key.split('.').pop());
const dir = path.resolve(srcDir);
fs.mkdirSync(outDir, { recursive: true });
const shown = path.relative(ROOT, outDir);
console.log(`Voci ${lang}: ${dir} → ${shown && !shown.startsWith('..') ? shown : outDir}`);

let total = 0;
const missing = [];
for (const key of keys) {
  const file = find(dir, key);
  if (file) {
    const { x, note } = trim(decode(file, tempoOf(key)), key, wantsTail(key));
    total += write(key, x, note);
    continue;
  }
  // detta insieme: due sorgenti, <chiave>_g e <chiave>_f
  const parts = ['g', 'f'].map((who) => find(dir, `${key}_${who}`));
  if (parts.every(Boolean)) {
    const voices = parts.map((f, i) => {
      const { x } = trim(decode(f, tempoOf(`${key}_${'gf'[i]}`)), `${key}_${'gf'[i]}`, wantsTail(key));
      const g = 10 ** ((TARGET - loudness(x).I) / 20);
      return x.map((v) => v * g);
    });
    const lag = Math.round(0.03 * SR);
    const mix = new Float32Array(Math.max(voices[0].length, voices[1].length + lag));
    voices[0].forEach((v, i) => (mix[i] += v));
    voices[1].forEach((v, i) => (mix[i + lag] += v));
    total += write(key, mix, `  (${key}_g + ${key}_f)`);
    continue;
  }
  missing.push(key);
}
console.log(`Parlato: ${total.toFixed(1)} s in ${keys.length - missing.length} clip.`);
if (missing.length) console.log(`Mancano: ${missing.join(', ')} (in gioco useranno la voce italiana o il borbottio).`);
