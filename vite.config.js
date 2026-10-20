import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.join(ROOT, 'content');

// I testi e la configurazione vivono in /content e vengono letti a runtime (fetch),
// così si possono modificare anche dopo la build, direttamente in dist/content/.
function contentPlugin() {
  let outDir = 'dist';
  return {
    name: 'monichs-content',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use('/content', (req, res, next) => {
        const rel = decodeURIComponent((req.url || '').split('?')[0]);
        const file = path.join(CONTENT_DIR, rel);
        if (!file.startsWith(CONTENT_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        fs.createReadStream(file).pipe(res);
      });
      server.watcher.add(CONTENT_DIR);
      server.watcher.on('change', (file) => {
        if (path.resolve(file).startsWith(CONTENT_DIR)) server.ws.send({ type: 'full-reload' });
      });
    },
    closeBundle() {
      if (!fs.existsSync(outDir)) return;
      fs.cpSync(CONTENT_DIR, path.join(outDir, 'content'), { recursive: true });
    },
  };
}

// Indice dei file in assets/ (assets/index.json): il gioco controlla lì se un file facoltativo c'è
// (le voci registrate del laboratorio, i modelli 3D dei fondatori) prima di chiederlo, così un file
// mancante non produce errori. In sviluppo l'indice si legge al volo; nella build viene scritto alla
// fine (e il server della fiera lo rilegge a ogni richiesta: basta copiare i file nuovi in dist/assets).
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

function assetIndexPlugin() {
  let outDir = 'dist';
  const PUBLIC_ASSETS = path.join(ROOT, 'public', 'assets');
  return {
    name: 'monichs-asset-index',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use('/assets/index.json', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ files: listAssets(PUBLIC_ASSETS) }));
      });
    },
    closeBundle() {
      const dir = path.join(outDir, 'assets');
      if (!fs.existsSync(dir)) return;
      fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ files: listAssets(dir) }));
    },
  };
}

// Solo in sviluppo: con ?debug, window.shot() salva una cattura del canvas nella cartella temporanea
// di sistema (monichs-shots). Accetta richieste solo dalla macchina locale.
function debugShotPlugin() {
  return {
    name: 'monichs-debug-shot',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
        if (req.method !== 'POST' || !local) {
          res.statusCode = 403;
          res.end();
          return;
        }
        const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'shot').replace(/[^\w-]/g, '').slice(0, 60) || 'shot';
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const m = Buffer.concat(chunks).toString().match(/^data:image\/(png|jpeg);base64,(.+)$/);
          if (!m) {
            res.statusCode = 400;
            res.end('bad image');
            return;
          }
          const dir = path.join(os.tmpdir(), 'monichs-shots');
          fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, `${name}.${m[1] === 'png' ? 'png' : 'jpg'}`);
          fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
          res.end(file);
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [contentPlugin(), assetIndexPlugin(), debugShotPlugin()],
  // la porta assegnata dall'anteprima dell'app (PORT), altrimenti 5173; con PORT nessun ripiego su un'altra
  server: { port: Number(process.env.PORT) || 5173, strictPort: !!process.env.PORT, host: true },
  preview: { port: 4173, host: true },
  build: {
    target: 'es2020',
    assetsDir: 'bundle',
    chunkSizeWarningLimit: 1600,
    sourcemap: false,
  },
});
