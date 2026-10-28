// Trailer di INSIDE MONICHS per Kickstarter: 15 s, 1920×1080, 30 fps, senza il laboratorio.
// Le riprese vengono dal gioco vero, guidato fotogramma per fotogramma; la musica è un pianoforte
// a feltro sintetizzato qui sul motivo 6-3-2-1, a 64 BPM, con i cambi d'armonia sui tagli.
//
//   npm run dev                                 → prima, in un altro terminale (porta 5173, o PORT)
//   npm run trailer                             → tutto: riprese, musica, titoli, montaggio IT ed EN
//   npm run trailer -- musica montaggio         → solo alcuni passi (riprese, musica, titoli, montaggio)
//   npm run trailer -- riprese --piani=D,E      → rifà solo alcuni piani (A–G, vedi trailer/shots.mjs)
//
// Escono trailer/Inside-Monichs-Trailer-EN.mp4 e -IT.mp4 (con un fotogramma del cartello finale
// per l'anteprima); il materiale di lavoro (circa 1 GB di fotogrammi) resta in trailer/lavoro.
// La cartella trailer/ non va nel repository: è pubblico e il video esce con la campagna.
//
// Servono ffmpeg nel PATH, Google Chrome e Playwright (quello di @playwright/cli installato
// globalmente; altrimenti PLAYWRIGHT_MODULE e CHROME_PATH indicano dove sono). Le riprese usano
// la scheda video: con una RTX ogni piano richiede una decina di secondi.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderShots } from './trailer/shots.mjs';
import { renderMusic } from './trailer/music.mjs';
import { renderTitles } from './trailer/titles.mjs';
import { edit } from './trailer/edit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'trailer');
const WORK = path.join(OUT, 'lavoro');
const STEPS = ['riprese', 'musica', 'titoli', 'montaggio'];

const argv = process.argv.slice(2);
const only = argv.find((a) => a.startsWith('--piani='))?.slice(8).split(',') || [];
const steps = argv.filter((a) => STEPS.includes(a));
const run = steps.length ? steps : STEPS;
const port = Number(process.env.PORT) || 5173;
fs.mkdirSync(WORK, { recursive: true });

if (run.includes('riprese')) {
  const ok = await fetch(`http://localhost:${port}/`).then((r) => r.ok, () => false);
  if (!ok) {
    console.error(`Il gioco non risponde su http://localhost:${port}: avviare prima "npm run dev".`);
    process.exit(1);
  }
  await renderShots({ port, dir: path.join(WORK, 'piani'), only });
}
if (run.includes('musica')) await renderMusic({ dir: path.join(WORK, 'audio') });
if (run.includes('titoli')) await renderTitles({ root: ROOT, dir: path.join(WORK, 'titoli') });
if (run.includes('montaggio')) {
  for (const lang of ['en', 'it']) {
    const file = path.join(OUT, `Inside-Monichs-Trailer-${lang.toUpperCase()}.mp4`);
    edit({ work: WORK, lang, out: file });
    console.log('→', path.relative(ROOT, file));
  }
}
