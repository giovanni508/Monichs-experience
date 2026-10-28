// I piani del trailer: camera, fuoco e regia di ogni mondo, a 60 sottofotogrammi al secondo (il
// montaggio li fonde a due a due: 30 fps con un filo di mosso, come un otturatore a 180°).
// Le coordinate sono quelle dei mondi (vedi worlds/*.js); i piani durano un po' più del necessario,
// il montaggio ne prende la parte centrale.
import fs from 'node:fs';
import path from 'node:path';
import { bootGame, saveDataURL } from './browser.mjs';

const FPS = 60;
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// quasi lineare (il movimento continua attraverso i tagli), appena addolcito agli estremi
const glide = (u) => 0.82 * u + 0.18 * (0.5 - 0.5 * Math.cos(Math.PI * u));

export const SHOTS = [
  {
    id: 'A', // le tre Delta sospese nel vuoto, dietro la partenza
    world: 'movement', dur: 3.4,
    setup: 'app.clock.time = 1000; app.clock.setScale(1, 100); app.clock.scale = 1;',
    cam: (u) => {
      const k = glide(u);
      const pos = lerp([-11, 24, 90], [5, 27.5, 107], k);
      return { pos, look: lerp([-3, 26, 208], [2, 26.5, 208], k), fov: 46 - 2.5 * k, focus: dist(pos, [0, 26, 208]) };
    },
  },
  {
    id: 'B', // la passerella verso la corona, e dentro il tubo: accelera, come risucchiati
    world: 'movement', dur: 2.8,
    setup: 'app.clock.time = 1010; app.clock.setScale(1, 100); app.clock.scale = 1;',
    cam: (u) => {
      const k = Math.pow(u, 1.5);
      const pos = lerp([0, 7.7, 119], [0, 6.9, 91], k);
      return { pos, look: [0, 6.3, 60], fov: 40 + 7 * k, focus: Math.max(9, pos[2] - 82) };
    },
  },
  {
    id: 'C', // gli ingranaggi del rodaggio sotto la passerella di zaffiro, in time-lapse (×20)
    world: 'movement', dur: 2.8,
    setup: 'app.clock.time = 1020; app.clock.setScale(20, 100); app.clock.scale = 20;',
    cam: (u) => {
      const k = glide(u);
      const pos = lerp([27.5, 12.7, -0.5], [20, 11.6, -11], k);
      const look = lerp([3, 2, -20], [1, 2, -26], k);
      return { pos, look, fov: 42, focus: dist(pos, look) };
    },
  },
  {
    id: 'D', // Celeste: dal giorno alla notte, si accende la Super-LumiNova
    world: 'celeste', dur: 2.8,
    setup: 'w.setNight(0);',
    hook: 'w.setNight(t);',
    hookArg: (u) => smooth(0.32, 0.66, u),
    cam: (u) => {
      const k = glide(u);
      const pos = lerp([9, 11, -118], [-3, 18.5, -168], k);
      return { pos, look: lerp([0, 66, -292], [0, 71.5, -292], k), fov: 40 - 2 * k, focus: dist(pos, [0, 72, -292]) - 8 };
    },
  },
  {
    id: 'E', // Sunset nell'abside, tra le pareti d'agata
    world: 'sunset', dur: 2.8,
    cam: (u) => {
      const k = glide(u);
      // all'altezza del quadrante il vetro riflette l'agata scura e non la volta chiara: la pietra
      // resta rosso profondo, come nelle foto (dal basso diventava rosa)
      const pos = lerp([-7, 33.5, -196], [-1.5, 34.8, -208], k);
      return { pos, look: lerp([0, 35.5, -277], [0, 35.6, -277], k), fov: 40 - 2 * k, focus: dist(pos, [0, 36, -277]) - 2 };
    },
  },
  {
    id: 'F', // Virentia: il viale del bosco verso la porta con il rotore, carico a tre quarti
    world: 'virentia', dur: 2.8,
    hook: 'w.energy = 0.75;',
    cam: (u) => {
      const k = glide(u);
      const pos = lerp([0.5, 5.6, -56], [0, 7.2, -78], k);
      return { pos, look: lerp([0, 20.5, -160], [0, 22, -160], k), fov: 42, focus: dist(pos, [0, 14, -112]) };
    },
  },
  {
    id: 'G', // i tre orologi dell'epilogo: il montaggio li sfoca dietro il cartello finale
    world: 'epilogue', dur: 3.4,
    setup: 'w.time = 6;',
    hook: 'w.watches.forEach((x) => (x.userData.label.visible = false));',
    cam: (u) => ({ pos: lerp([0, 1.65, 17.5], [0, 1.55, 16.2], u), look: [0, 0.95, 0], fov: 40, focus: 17 }),
  },
];

export async function renderShots({ port, dir, only = [] }) {
  const { browser, page } = await bootGame({ port });
  for (const s of SHOTS) {
    if (only.length && !only.includes(s.id)) continue;
    const out = path.join(dir, s.id);
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    await page.evaluate((id) => window.__cap.world(id), s.world);
    if (s.setup) await page.evaluate(`(() => { const app = window.monichs; const w = app.director.world; ${s.setup} })()`);
    const arg = (u) => (s.hookArg ? s.hookArg(u) : u);
    const frame = (u, grab) => page.evaluate(([c, h, t, g, dt]) => window.__cap.frame(c, dt, g, h, t), [s.cam(u), s.hook || null, arg(u), grab, 1 / FPS]);
    // prima di girare: transizioni del post, fuoco e particelle si assestano sulla prima inquadratura
    for (let i = 0; i < 70; i++) await frame(0, false);
    const n = Math.round(s.dur * FPS);
    for (let i = 0; i < n; i++) {
      const url = await frame(i / (n - 1), true);
      saveDataURL(url, path.join(out, `${String(i).padStart(4, '0')}.jpg`));
    }
    console.log(`piano ${s.id}: ${n} fotogrammi`);
  }
  await browser.close();
}
