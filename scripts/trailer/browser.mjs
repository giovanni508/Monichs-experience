// Il gioco in Chrome senza finestra, con la scheda video, guidato fotogramma per fotogramma: il loop
// in tempo reale si ferma e ogni fotogramma avanza di un dt fisso, quindi le riprese sono fluide e
// ripetibili qualunque sia la velocità della macchina.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE || 'C:/Users/UTENTE/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

export function launchChrome() {
  const { chromium } = require(PLAYWRIGHT);
  return chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
}

// dpr 2: con la qualità ultra (1,5×) il canvas è 2880×1620, poi il montaggio lo riduce a 1080p
export async function bootGame({ port = 5173, dpr = 2, lang = 'en' } = {}) {
  const browser = await launchChrome();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dpr });
  page.on('pageerror', (e) => console.log('[pagina]', e.message));
  await page.goto(`http://localhost:${port}/?debug&noidle&nolock&quality=ultra&lang=${lang}`);
  await page.waitForFunction(() => window.monichs?.worlds && ['movement', 'celeste', 'sunset', 'virentia', 'epilogue'].every((id) => window.monichs.worlds[id].loaded), null, { timeout: 600000, polling: 1000 });
  await page.evaluate(() => {
    const app = window.monichs;
    app.renderer.renderer.setAnimationLoop(null);
    app.audio.setMuted?.(true);
    // le lancette segnano 10:10, l'ora delle foto di prodotto (il logo resta libero), e avanzano
    // con il tempo delle riprese
    const RealDate = Date;
    window.__vt = new RealDate(2026, 9, 28, 10, 9, 32).getTime();
    window.Date = class extends RealDate {
      constructor(...a) {
        if (a.length) super(...a);
        else super(window.__vt);
      }
      static now() {
        return window.__vt;
      }
    };
    window.__cap = {
      // un mondo come nella modalità attrazione: niente tappe, niente narrazione, la camera è nostra
      async world(id) {
        const d = app.director;
        d.state = 'transition';
        await d.setWorld(id, { attract: true });
        d.state = 'attract';
        d.attract.shot = null;
        app.renderer.focusOverride = null;
        app.renderer.focusRangeOverride = null;
      },
      // un fotogramma: eventuale regia del mondo (hook), camera, poi il gioco avanza di dt e disegna
      frame(cam, dt, grab, hook = null, t = 0) {
        window.__vt += dt * 1000;
        if (hook) new Function('app', 'w', 't', hook)(app, app.director.world, t);
        const c = app.camera;
        c.position.set(...cam.pos);
        c.up.set(0, 1, 0);
        c.lookAt(...cam.look);
        if (cam.fov && c.fov !== cam.fov) {
          c.fov = cam.fov;
          c.updateProjectionMatrix();
        }
        if (cam.focus != null) app.renderer.focusOverride = cam.focus;
        app.last = performance.now() - dt * 1000;
        app.frame();
        return grab ? app.canvas.toDataURL('image/jpeg', 0.94) : null;
      },
    };
  });
  return { browser, page };
}

export function saveDataURL(url, file) {
  const m = url.match(/^data:image\/(png|jpeg);base64,(.+)$/);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
}
