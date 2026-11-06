// Test simulato della fiera: un visitatore con il controller fa tutto il percorso, dalla schermata iniziale
// all'epilogo con il QR, più i casi tipici della fiera (attrazione, pausa, lingua, reset per inattività).
// Gira nel Chrome senza finestra del trailer, contro il server di sviluppo acceso (npm run dev).
//   npm run test:fiera            (oppure: node scripts/test-fiera.mjs [porta])
// Il controller è finto (navigator.getGamepads restituisce un pad Xbox che il test preme). L'orologio della
// pagina si può far avanzare (__avanza) per provare i tempi lunghi dei timer di fiera senza aspettarli.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from './trailer/browser.mjs';
import { readQrCanvas } from './lib/read-qr.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 5173);
const SHOTS = path.join(os.tmpdir(), 'monichs-test-fiera');
fs.mkdirSync(SHOTS, { recursive: true });
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/config.json'), 'utf8'));

const results = [];
const errors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'OK  ' : 'NO  '} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await launchChrome();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => errors.push(`pagina: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});
await page.addInitScript(() => {
  // orologio della pagina spostabile in avanti
  const realNow = performance.now.bind(performance);
  let offset = 0;
  window.__avanza = (ms) => {
    offset += ms;
  };
  performance.now = () => realNow() + offset;
  // controller Xbox finto, mappatura standard (A 0, B 1, Y 3, View 8, Menu 9, croce 12–15)
  const btn = () => ({ pressed: false, value: 0, touched: false });
  window.__pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', index: 0, connected: true, mapping: 'standard', timestamp: 0, buttons: Array.from({ length: 17 }, btn), axes: [0, 0, 0, 0] };
  Object.defineProperty(navigator, 'getGamepads', { value: () => [window.__pad, null, null, null], configurable: true });
});

const t0 = Date.now();
await page.goto(`http://localhost:${PORT}/?debug&nolock&lang=it`);
await page.waitForFunction(() => window.monichs?.worlds && ['movement', 'celeste', 'sunset', 'virentia', 'epilogue'].every((id) => window.monichs.worlds[id].loaded), null, { timeout: 600000, polling: 500 });
check('caricamento di tutti i mondi', true, `${((Date.now() - t0) / 1000).toFixed(1)} s`);

const wait = (ms) => page.waitForTimeout(ms);
const state = () => page.evaluate(() => ({ state: window.monichs.director.state, world: window.monichs.director.world?.id, busy: window.monichs.director.busy, lang: window.monichs.i18n.lang, paused: !!window.monichs.pauseShown }));
// attende che il regista arrivi a uno stato (le dissolvenze durano qualche secondo)
const until = async (fn, ms = 12000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await state();
    if (fn(s) && !s.busy) return s;
    await wait(150);
  }
  return state();
};
const press = async (i, holdMs = 140) => {
  await page.evaluate((i) => {
    window.__pad.buttons[i] = { pressed: true, value: 1, touched: true };
  }, i);
  await wait(holdMs);
  await page.evaluate((i) => {
    window.__pad.buttons[i] = { pressed: false, value: 0, touched: false };
  }, i);
  await wait(160);
};
const tp = (x, y, z, yaw = 0, pitch = 0) => page.evaluate(([x, y, z, yaw, pitch]) => window.tp(x, y, z, yaw, pitch), [x, y, z, yaw, pitch]);
const shot = async (name) => page.screenshot({ path: path.join(SHOTS, `${name}.jpg`), type: 'jpeg', quality: 85 });

let s = await until((s) => s.state === 'start');
check('schermata iniziale', s.state === 'start');

// 1. attrazione dopo 25 s senza nessuno, e ritorno al menu toccando il controller
await page.evaluate(() => window.__avanza((window.monichs.config.kiosk?.attractAfterSeconds ?? 25) * 1000 + 1000));
s = await until((s) => s.state === 'attract', 6000);
check('modalità attrazione dopo l\'attesa', s.state === 'attract');
await press(0);
s = await until((s) => s.state === 'start', 8000);
check('un tasto del controller riporta al menu', s.state === 'start');

// 2. lingua con Y, avanti e indietro
const lang0 = s.lang;
await press(3);
s = await state();
const lang1 = s.lang;
await press(3);
s = await state();
check('Y cambia lingua (e torna)', lang1 !== lang0 && s.lang === lang0, `${lang0} → ${lang1} → ${s.lang}`);

// 3. Menu entra nel tempo
await press(9);
s = await until((s) => s.state === 'play' && s.world === 'movement', 15000);
check('Menu entra nel movimento', s.state === 'play' && s.world === 'movement');
await wait(1500);
await shot('01-partenza');

// 4. pausa con Menu, ripresa con B
await press(9);
s = await state();
const paused = s.paused;
await press(1);
s = await state();
check('pausa con Menu e ripresa con B', paused && !s.paused);

// 5. la corona: davanti alla corona, A tenuto premuto la carica
await tp(0, 8.2, 106, 0, 0);
await wait(600);
const focus = await page.evaluate(() => window.monichs.hotspots.focused?.id || null);
await page.evaluate(() => {
  window.__pad.buttons[0] = { pressed: true, value: 1, touched: true };
});
await wait(5200);
await page.evaluate(() => {
  window.__pad.buttons[0] = { pressed: false, value: 0, touched: false };
});
await wait(300);
const wound = await page.evaluate(() => window.monichs.worlds.movement.wound);
check('la corona si carica tenendo premuto A', wound, `tappa a fuoco: ${focus}`);
await shot('02-corona-carica');

// 6. i tre mondi dall'hub: si entra dal portale, si visita una tappa con A, si esce dal portale d'uscita
await page.evaluate(() => window.monichs.director.goTo('movement', { hub: true }));
s = await until((s) => s.state === 'play' && s.world === 'movement', 15000);
check('piattaforma dell\'hub', s.state === 'play');
for (const id of ['celeste', 'sunset', 'virentia']) {
  const p = await page.evaluate((id) => {
    const w = window.monichs.worlds.movement;
    const portal = w.portals.find((q) => q.id === id);
    return portal ? portal.group.position.toArray() : null;
  }, id);
  await tp(p[0], p[1], p[2], 0, 0);
  s = await until((s) => s.state === 'play' && s.world === id, 15000);
  check(`portale verso ${id}`, s.world === id);
  await wait(1200);
  await shot(`03-${id}-arrivo`);
  // una tappa: davanti al primo punto d'interesse, A
  const visited = await page.evaluate(() => {
    const app = window.monichs;
    const h = app.director.world.hotspots[0];
    const p = h.position;
    const back = new p.constructor(0, 0, 5);
    app.player.spawn({ position: p.clone().add(back), yaw: 0, pitch: 0 });
    return h.id;
  });
  await wait(700);
  const focused = await page.evaluate(() => window.monichs.hotspots.focused?.id || null);
  await press(0);
  await wait(400);
  const ok = await page.evaluate(() => window.monichs.director.world.hotspots[0].visited || !!window.monichs.ui.card?.classList?.contains('open'));
  check(`${id}: la prima tappa risponde ad A`, ok || focused === visited, `tappa ${visited}, a fuoco: ${focused}`);
  // uscita
  await page.evaluate(() => {
    const w = window.monichs.director.world;
    w.hotspots.forEach((h) => (h.visited = true));
    if (!w.exitShown) w.showExit();
  });
  await wait(2500);
  const ep = await page.evaluate(() => window.monichs.director.world.exitPortal.group.position.toArray());
  await tp(ep[0], ep[1], ep[2], 0, 0);
  s = await until((s) => s.state === 'play' && s.world === 'movement', 15000);
  check(`${id}: il portale d'uscita riporta all'hub`, s.world === 'movement');
}

// 7. la luce al centro del bilanciere porta all'epilogo
await wait(2500);
const light = await page.evaluate(() => window.monichs.worlds.movement.epiGlow.position.toArray());
const ly = await page.evaluate(() => window.monichs.player.position.y);
await tp(light[0], ly, light[2], 0, 0);
s = await until((s) => s.state === 'epilogue', 15000);
check('la luce dell\'hub porta all\'epilogo', s.state === 'epilogue');
await wait(5000);
await shot('04-epilogo');

// 8. il QR dell'epilogo porta a monichs.com: il codice disegnato si legge (con un lettore indipendente
// dalla libreria che lo disegna) ed è abbastanza grande per un telefono a qualche passo dal televisore
const qr = await page.evaluate(readQrCanvas, '#epilogue .qr canvas');
const qrBox = await page.evaluate(() => {
  const r = document.querySelector('#epilogue .qr canvas').getBoundingClientRect();
  return { size: Math.round(r.width), shown: document.querySelector('#epilogue .cta .url')?.textContent };
});
check("il QR dell'epilogo porta a monichs.com", /^https:\/\/(www\.)?monichs\.com\/?$/.test(qr.text || ''), `letto: ${qr.text || qr.error} (versione ${qr.version}-${qr.ecl}), ${qrBox.size} px a 1080p, scritto accanto: ${qrBox.shown}`);
check('il QR è quello della configurazione del repository', qr.text === config.cta?.qr?.url);
check('il QR misura almeno 120 px a 1080p', qrBox.size >= 120);

// 9. A sull'epilogo ricomincia
await press(0);
s = await until((s) => s.state === 'start', 15000);
check('A sull\'epilogo torna al menu', s.state === 'start');

// entra in un capitolo dal menu come un visitatore: la croce porta la scelta sul capitolo, A conferma
const PAD_DIR = { up: 12, down: 13, left: 14, right: 15 };
const enterChapter = async (id) => {
  await until((s) => s.state === 'start', 15000);
  await wait(1200);
  for (let i = 0; i < 8; i++) {
    // la direzione dalla scelta attuale verso il capitolo
    const dir = await page.evaluate((id) => {
      const ui = window.monichs.ui;
      const target = ui.chapterBtns[id];
      const cur = ui.padFocused;
      if (cur === target) return null;
      if (!cur) return 'down';
      const a = cur.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      const dx = b.left + b.width / 2 - (a.left + a.width / 2);
      const dy = b.top + b.height / 2 - (a.top + a.height / 2);
      return Math.abs(dy) > Math.abs(dx) ? (dy > 0 ? 'down' : 'up') : dx > 0 ? 'right' : 'left';
    }, id);
    if (!dir) break;
    await press(PAD_DIR[dir]);
  }
  const chosen = await page.evaluate((id) => window.monichs.ui.padFocused === window.monichs.ui.chapterBtns[id], id);
  await press(0);
  const s = await until((s) => s.state === 'play' && s.world === id, 15000);
  return { ...s, chosen };
};

// 10. reset per inattività: dentro un mondo, nessuno tocca nulla per oltre 60 s
s = await enterChapter('sunset');
check('menu dei capitoli con la croce e A (Sunset)', s.chosen && s.state === 'play' && s.world === 'sunset');
await wait(800);
await page.evaluate(() => window.__avanza((window.monichs.config.kiosk?.idleResetSeconds ?? 60) * 1000 + 2000));
s = await until((s) => s.state === 'start', 15000);
check('reset per inattività riporta al menu', s.state === 'start');
// il menu resta per il visitatore successivo; se non arriva nessuno, dopo l'attesa riparte l'attrazione
await wait(2000);
s = await state();
check('dopo il reset il menu resta visibile', s.state === 'start');
await page.evaluate(() => window.__avanza((window.monichs.config.kiosk?.attractAfterSeconds ?? 25) * 1000 + 1000));
s = await until((s) => s.state === 'attract', 6000);
check("poi, senza nessuno, riparte l'attrazione", s.state === 'attract');
await press(0);
s = await until((s) => s.state === 'start', 8000);

// 11. il reset del personale: View + Menu tenuti 2 s, da dentro un mondo
s = await enterChapter('virentia');
check('menu dei capitoli con la croce e A (Virentia)', s.chosen && s.state === 'play' && s.world === 'virentia');
await page.evaluate(() => {
  window.__pad.buttons[8] = { pressed: true, value: 1, touched: true };
  window.__pad.buttons[9] = { pressed: true, value: 1, touched: true };
});
await wait(2600);
await page.evaluate(() => {
  window.__pad.buttons[8] = { pressed: false, value: 0, touched: false };
  window.__pad.buttons[9] = { pressed: false, value: 0, touched: false };
});
s = await until((s) => s.state === 'start', 15000);
check('View + Menu tenuti 2 s: reset del personale', s.state === 'start');

check('nessun errore nella pagina', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} controlli superati. Catture: ${SHOTS}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
