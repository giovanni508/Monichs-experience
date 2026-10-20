// Server statico per la fiera: nessuna dipendenza, funziona offline.
//   npm run fiera            → http://localhost:8080
//   npm run fiera -- 9000    → porta personalizzata
// Supporta le richieste "Range" (necessarie a Safari per riprodurre il video in loop).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.glb': 'model/gltf-binary',
  '.ico': 'image/x-icon',
};

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error('\n  Build mancante: eseguire prima "npm run build".\n');
  process.exit(1);
}

// Indice dei file in dist/assets, riletto a ogni richiesta: le voci registrate del laboratorio
// (assets/audio/lab/*.mp3) e i modelli dei fondatori si aggiungono copiando i file, senza rifare la build
function listAssets(dir) {
  const out = [];
  const walk = (d, rel) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(path.join(d, e.name), `${rel}${e.name}/`);
      else if (e.name !== 'index.json' || rel) out.push(`${rel}${e.name}`);
    }
  };
  walk(dir, '');
  return out.sort();
}

const server = http.createServer((req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel === '/assets/index.json') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ files: listAssets(path.join(ROOT, 'assets')) }));
      return;
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const size = fs.statSync(file).size;
    // i testi e la configurazione non vanno mai in cache: si possono modificare durante la fiera
    const noCache = rel.startsWith('/content/') || rel.endsWith('.html');
    const headers = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': noCache ? 'no-store' : 'public, max-age=3600',
    };
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
      if (m && !m[1] && m[2]) {
        start = size - parseInt(m[2], 10);
        end = size - 1;
      }
      if (start >= size || end >= size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        res.end();
        return;
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(500);
    res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  INSIDE MONICHS — pronto su http://localhost:${PORT}\n  (Ctrl+C per fermare)\n`);
});
