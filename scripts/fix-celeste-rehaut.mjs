// Tacche del rehaut della Celeste: bianche come nella foto di prodotto.
// La texture del quadrante (ricavata dalla foto, scripts/blender/textures_src) aveva sull'anello esterno
// le tacche giallo-arancio (ore 10–12) o azzurre (ore 3 e 8): riflessi della foto di partenza. Qui,
// nell'anello del rehaut (12,95–14,2 mm dal centro, misurato sulla texture), i toni caldi diventano
// neutri e le tacche (più chiare del fondo vicino) bianco freddo; il fondo blu resta.
// Corregge la texture sorgente (Modelli/3D/textures/celeste_dial.png, per le prossime ricostruzioni in
// Blender) e l'immagine già dentro i GLB (Modelli/3D/celeste.glb e public/assets/models/celeste.glb).
// Uso: node scripts/fix-celeste-rehaut.mjs  (rieseguirlo non cambia più nulla: le tacche sono già bianche)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIAL_MM = 29; // la texture copre esattamente il diametro del quadrante
const RING = [12.95, 14.2];

async function whitenTicks(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // il fondo vicino: la stessa immagine molto sfocata (le tacche sono sottili)
  const { data: base } = await sharp(input).ensureAlpha().blur(14).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const pxmm = w / DIAL_MM;
  const cx = w / 2;
  const cy = h / 2;
  let changed = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / pxmm;
      if (r < RING[0] || r > RING[1]) continue;
      const k = (y * w + x) * 4;
      const R = data[k];
      const G = data[k + 1];
      const B = data[k + 2];
      const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      const baseLum = 0.2126 * base[k] + 0.7152 * base[k + 1] + 0.0722 * base[k + 2];
      const smooth = (a, b, x) => Math.min(1, Math.max(0, (x - a) / (b - a)));
      const warm = smooth(0, 40, R - B); // riflesso caldo della foto: neutro
      const tick = smooth(18, 60, lum - baseLum); // tacca: bianco freddo
      if (warm <= 0 && tick <= 0) continue;
      let cr = R + (lum * 0.95 - R) * warm;
      let cg = G + (lum * 0.98 - G) * warm;
      let cb = B + (lum * 1.06 - B) * warm;
      const v = Math.min(255, lum * 1.1);
      cr += (v * 0.97 - cr) * tick;
      cg += (v - cg) * tick;
      cb += (Math.min(255, v * 1.05) - cb) * tick;
      data[k] = Math.round(Math.min(255, cr));
      data[k + 1] = Math.round(Math.min(255, cg));
      data[k + 2] = Math.round(Math.min(255, cb));
      changed++;
    }
  }
  return { raw: data, info, changed };
}

async function fixPng(file) {
  if (!fs.existsSync(file)) return console.log('  (manca)', path.relative(ROOT, file));
  const { raw, info, changed } = await whitenTicks(file);
  await sharp(raw, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(file + '.tmp');
  fs.renameSync(file + '.tmp', file);
  console.log('  png', path.relative(ROOT, file), `${changed} pixel`);
}

async function fixGlb(file) {
  if (!fs.existsSync(file)) return console.log('  (manca)', path.relative(ROOT, file));
  const glb = fs.readFileSync(file);
  const jsonLen = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const bin = glb.subarray(binStart, binStart + glb.readUInt32LE(20 + jsonLen));
  const views = json.bufferViews.map((bv) => bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength));
  const img = (json.images || []).find((im) => im.name === 'celeste_dial');
  if (!img) return console.log('  (nessuna texture celeste_dial)', path.relative(ROOT, file));
  const { raw, info, changed } = await whitenTicks(views[img.bufferView]);
  views[img.bufferView] = await sharp(raw, { raw: { width: info.width, height: info.height, channels: 4 } }).removeAlpha().jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  img.mimeType = 'image/jpeg';
  // ricompone il blocco binario (allineamento a 4 byte) e il GLB
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
  const binOut = Buffer.concat(chunks);
  const binPad = Buffer.alloc((4 - (binOut.length % 4)) % 4);
  json.buffers[0].byteLength = binOut.length;
  let text = JSON.stringify(json);
  while (Buffer.byteLength(text) % 4) text += ' ';
  const jsonBuf = Buffer.from(text, 'utf8');
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonBuf.length, 0);
  jsonHead.writeUInt32LE(0x4e4f534a, 4);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(binOut.length + binPad.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4);
  const out = Buffer.concat([head, jsonHead, jsonBuf, binHead, binOut, binPad]);
  out.writeUInt32LE(out.length, 8);
  fs.writeFileSync(file, out);
  console.log('  glb', path.relative(ROOT, file), `${changed} pixel`);
}

console.log('Tacche del rehaut della Celeste:');
await fixPng(path.join(ROOT, 'Modelli/3D/textures/celeste_dial.png'));
await fixGlb(path.join(ROOT, 'Modelli/3D/celeste.glb'));
await fixGlb(path.join(ROOT, 'public/assets/models/celeste.glb'));
