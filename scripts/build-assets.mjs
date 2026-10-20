// Pipeline degli asset: legge le foto originali (Modelli/, Branding/) e genera in public/assets/
// versioni ritagliate, ridimensionate e compresse (WebP). Le sorgenti non vengono mai modificate.
//
//   npm run assets            → genera solo ciò che manca o è più vecchio della sorgente
//   npm run assets -- --force → rigenera tutto
//   npm run assets -- --video → rigenera i video (dopo aver cambiato VIDEOS nel manifest)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import yauzl from 'yauzl';
import { SOURCES, OUTPUTS, BRAND_ZIP, BRAND_FILES, VIDEOS, MODELS, MODEL_TEXTURE_RESIZE, PDFS } from './assets-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'assets');
const FORCE = process.argv.includes('--force');
const FORCE_VIDEO = FORCE || process.argv.includes('--video');

sharp.cache(false);
sharp.concurrency(2);

function isFresh(outFile, srcFile, force = FORCE) {
  if (force || !fs.existsSync(outFile)) return false;
  return fs.statSync(outFile).mtimeMs >= fs.statSync(srcFile).mtimeMs;
}

async function buildImage(job) {
  const src = path.join(ROOT, SOURCES[job.src]);
  const out = path.join(OUT_DIR, job.out);
  if (!fs.existsSync(src)) throw new Error(`Sorgente mancante: ${src}`);
  if (isFresh(out, src)) return { job, skipped: true };
  fs.mkdirSync(path.dirname(out), { recursive: true });

  let img = sharp(src, { limitInputPixels: false });
  if (job.crop) {
    const [left, top, width, height] = job.crop;
    img = img.extract({ left, top, width, height });
  }
  if (job.size) img = img.resize({ width: job.size, height: job.size, fit: 'inside', withoutEnlargement: true });
  if (job.flatten) img = img.flatten({ background: job.flatten });
  await img.webp({ quality: job.quality ?? 82, effort: 5, alphaQuality: 92 }).toFile(out);
  const meta = await sharp(out).metadata();
  return { job, width: meta.width, height: meta.height, bytes: fs.statSync(out).size };
}

function extractFromZip(zipPath, wanted) {
  return new Promise((resolve, reject) => {
    const byEntry = new Map(wanted.map((w) => [w.entry, w]));
    const done = [];
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.readEntry();
      zip.on('entry', (entry) => {
        const job = byEntry.get(entry.fileName);
        if (!job) return zip.readEntry();
        const out = path.join(OUT_DIR, job.out);
        if (!FORCE && fs.existsSync(out)) { done.push(job.out + ' (già presente)'); return zip.readEntry(); }
        fs.mkdirSync(path.dirname(out), { recursive: true });
        zip.openReadStream(entry, (e2, stream) => {
          if (e2) return reject(e2);
          const ws = fs.createWriteStream(out);
          stream.pipe(ws);
          ws.on('finish', () => { done.push(job.out); zip.readEntry(); });
          ws.on('error', reject);
        });
      });
      zip.on('end', () => resolve(done));
      zip.on('error', reject);
    });
  });
}

const t0 = Date.now();
console.log('INSIDE MONICHS — pipeline asset\n');

const brand = await extractFromZip(path.join(ROOT, BRAND_ZIP), BRAND_FILES);
brand.forEach((f) => console.log('  brand  ', f));

const report = [];
for (const job of OUTPUTS) {
  const r = await buildImage(job);
  report.push(r);
  if (r.skipped) console.log('  =      ', job.out);
  else console.log('  +      ', job.out.padEnd(34), `${r.width}×${r.height}`.padEnd(11), `${(r.bytes / 1024).toFixed(0)} KB`);
}

// Video: taglio, ridimensionamento, dissolvenze, niente audio, "faststart" per l'avvio immediato
function hasFfmpeg() {
  const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return r.status === 0;
}

function buildVideo(v) {
  const src = path.join(ROOT, v.src);
  const out = path.join(OUT_DIR, v.out);
  if (!fs.existsSync(src)) {
    console.log('  !      ', v.out, '— sorgente mancante:', v.src);
    return;
  }
  if (isFresh(out, src, FORCE_VIDEO)) {
    console.log('  =      ', v.out);
    return;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const dur = v.end - v.start;
  const vf = [
    `scale=${v.width}:-2:flags=lanczos`,
    `fade=t=in:st=0:d=${v.fadeIn}:color=${v.fadeColor}`,
    `fade=t=out:st=${(dur - v.fadeOut).toFixed(2)}:d=${v.fadeOut}:color=${v.fadeColor}`,
    'format=yuv420p',
  ].join(',');
  // tune film + aq-mode 3: più bit alle zone scure (i fondi navy), niente bande nei gradienti
  const args = [
    '-v', 'error', '-y', '-ss', String(v.start), '-t', String(dur), '-i', src, '-vf', vf, '-an',
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-tune', 'film', '-crf', String(v.crf), '-x264-params', 'aq-mode=3',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-movflags', '+faststart', out,
  ];
  const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg non riuscito su ${v.src}`);
  console.log('  +      ', v.out.padEnd(34), `${dur.toFixed(2)} s`.padEnd(11), `${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
  if (v.poster) {
    const pout = path.join(OUT_DIR, v.poster.out);
    const tmp = path.join(OUT_DIR, v.poster.out.replace(/\.\w+$/, '.tmp.png'));
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(v.poster.at), '-i', src, '-frames:v', '1', '-vf', `scale=${v.poster.width || v.width}:-2:flags=lanczos`, tmp], { stdio: 'inherit' });
    return sharp(tmp)
      .webp({ quality: 80 })
      .toFile(pout)
      .then(() => {
        fs.unlinkSync(tmp);
        console.log('  +      ', v.poster.out);
      });
  }
}

if (VIDEOS?.length) {
  if (hasFfmpeg()) for (const v of VIDEOS) await buildVideo(v);
  else console.log('  !       ffmpeg non trovato: video non rigenerati (restano quelli già presenti in public/assets/video)');
}

// Modelli GLB: stessa struttura, texture secondarie ridimensionate. Il GLB è un'intestazione, un blocco
// JSON e un blocco binario: si rimpacchetta il binario con le immagini nuove (allineamento a 4 byte).
async function buildModel(job) {
  const src = path.join(ROOT, job.src);
  const out = path.join(OUT_DIR, job.out);
  if (!fs.existsSync(src)) {
    console.log('  !      ', job.out, '— sorgente mancante:', job.src);
    return;
  }
  if (isFresh(out, src)) {
    console.log('  =      ', job.out);
    return;
  }
  const glb = fs.readFileSync(src);
  if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error(`Non è un GLB: ${job.src}`);
  const jsonLen = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const binLen = glb.readUInt32LE(20 + jsonLen);
  const bin = glb.subarray(binStart, binStart + binLen);
  const views = json.bufferViews.map((bv) => bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength));
  const { pattern, size, quality } = MODEL_TEXTURE_RESIZE;
  for (const img of json.images || []) {
    if (img.bufferView === undefined || !pattern.test(img.name || '')) continue;
    const meta = await sharp(views[img.bufferView]).metadata();
    if (meta.width <= size) continue;
    views[img.bufferView] = await sharp(views[img.bufferView]).resize(size, size, { fit: 'inside' }).jpeg({ quality, mozjpeg: true }).toBuffer();
    img.mimeType = 'image/jpeg';
  }
  const chunks = [];
  let offset = 0;
  json.bufferViews.forEach((bv, i) => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      offset += pad;
    }
    bv.byteOffset = offset;
    bv.byteLength = views[i].length;
    chunks.push(views[i]);
    offset += views[i].length;
  });
  const tail = (4 - (offset % 4)) % 4;
  if (tail) chunks.push(Buffer.alloc(tail));
  const newBin = Buffer.concat(chunks);
  json.buffers[0].byteLength = newBin.length;
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  if (jsonBuf.length % 4) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(4 - (jsonBuf.length % 4), 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + newBin.length, 8);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonBuf.length, 0);
  jsonHead.writeUInt32LE(0x4e4f534a, 4);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(newBin.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.concat([header, jsonHead, jsonBuf, binHead, newBin]));
  console.log('  +      ', job.out.padEnd(34), `${(glb.length / 1048576).toFixed(1)} → ${(fs.statSync(out).size / 1048576).toFixed(1)} MB`);
}

for (const m of MODELS || []) await buildModel(m);

// Fogli del laboratorio dai PDF: pdftoppm (Poppler) rasterizza la pagina, sharp ritaglia e comprime
function hasPdftoppm() {
  const r = spawnSync('pdftoppm', ['-v'], { stdio: 'ignore' });
  return !r.error;
}

async function buildPdf(job) {
  const src = path.join(ROOT, job.src);
  const out = path.join(OUT_DIR, job.out);
  if (!fs.existsSync(src)) {
    console.log('  !      ', job.out, '— sorgente mancante:', job.src);
    return;
  }
  if (isFresh(out, src)) {
    console.log('  =      ', job.out);
    return;
  }
  const tmp = path.join(os.tmpdir(), `monichs-pdf-${process.pid}`);
  const r = spawnSync('pdftoppm', ['-r', String(job.dpi), '-png', '-f', String(job.page), '-l', String(job.page), '-singlefile', src, tmp], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`pdftoppm non riuscito su ${job.src}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  let img = sharp(`${tmp}.png`, { limitInputPixels: false });
  if (job.crop) {
    const [left, top, width, height] = job.crop;
    img = img.extract({ left, top, width, height });
  }
  if (job.size) img = img.resize({ width: job.size, height: job.size, fit: 'inside', withoutEnlargement: true });
  await img.webp({ quality: job.quality ?? 88, effort: 5 }).toFile(out);
  fs.unlinkSync(`${tmp}.png`);
  const meta = await sharp(out).metadata();
  console.log('  +      ', job.out.padEnd(34), `${meta.width}×${meta.height}`.padEnd(11), `${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

if (PDFS?.length) {
  if (hasPdftoppm()) for (const p of PDFS) await buildPdf(p);
  else console.log('  !       pdftoppm non trovato: fogli del laboratorio non rigenerati (restano quelli in public/assets/tex/lab)');
}

// Riepilogo leggibile (usato anche per la documentazione)
const manifest = OUTPUTS.map((j) => ({ file: `assets/${j.out}`, source: SOURCES[j.src], crop: j.crop ?? null }));
(VIDEOS || []).forEach((v) => manifest.push({ file: `assets/${v.out}`, source: v.src, crop: `${v.start}–${v.end} s, ${v.width}px, senza audio` }));
(MODELS || []).forEach((m) => manifest.push({ file: `assets/${m.out}`, source: m.src, crop: `texture secondarie a ${MODEL_TEXTURE_RESIZE.size} px` }));
(PDFS || []).forEach((p) => manifest.push({ file: `assets/${p.out}`, source: `${p.src} (pagina ${p.page}, ${p.dpi} dpi)`, crop: p.crop ?? null }));
manifest.push(...BRAND_FILES.map((b) => ({ file: `assets/${b.out}`, source: `${BRAND_ZIP} → ${b.entry}`, crop: null })));
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`\nFatto in ${((Date.now() - t0) / 1000).toFixed(1)} s → public/assets/`);
