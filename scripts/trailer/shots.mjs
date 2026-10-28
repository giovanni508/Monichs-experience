// I piani del trailer: camera, fuoco e regia di ogni mondo, a 60 sottofotogrammi al secondo (il
// montaggio li fonde a due a due: 30 fps con un filo di mosso, come un otturatore a 180°).
// Le coordinate sono quelle dei mondi (vedi worlds/*.js); i piani durano un po' più del necessario,
// il montaggio ne prende la parte centrale. Movimenti lenti; dove c'è un titolo (al centro) il piano
// comincia su un fondo tranquillo (stelle, bosco, agata, il cielo che si fa notte) e poi una
// panoramica scopre l'orologio mentre il titolo sfuma.
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
    id: 'A', // le stelle, poi la panoramica scende sulle tre Delta sospese nel vuoto
    world: 'movement', dur: 9,
    setup: 'app.clock.time = 1000; app.clock.setScale(1, 100); app.clock.scale = 1;',
    cam: (u) => {
      const k = glide(u);
      const pos = lerp([-8, 24, 92], [4, 27, 104], k);
      const look = lerp([-2, 78, 208], [1.5, 26.5, 208], smooth(0.556, 0.81, u));
      return { pos, look, fov: 44 - 1.5 * k, focus: dist(pos, [0, 26, 208]) };
    },
  },
  {
    id: 'B', // la passerella verso la corona, e dentro il tubo: accelera piano, come risucchiati
    world: 'movement', dur: 6.8,
    setup: 'app.clock.time = 1010; app.clock.setScale(1, 100); app.clock.scale = 1;',
    cam: (u) => {
      const k = Math.pow(u, 1.4);
      const pos = lerp([0, 7.7, 119], [0, 7.0, 96], k);
      return { pos, look: [0, 6.3, 60], fov: 40 + 6 * k, focus: Math.max(9, pos[2] - 82) };
    },
  },
  {
    id: 'C', // gli ingranaggi del rodaggio sotto la passerella di zaffiro, in time-lapse (×10)
    world: 'movement', dur: 7.6,
    setup: 'app.clock.time = 1020; app.clock.setScale(10, 100); app.clock.scale = 10;',
    cam: (u) => {
      const k = glide(u);
      const pos = lerp([27.5, 12.7, -0.5], [22.5, 11.9, -8], k);
      const look = lerp([3, 2, -20], [1.5, 2, -24.5], k);
      return { pos, look, fov: 42, focus: dist(pos, look) };
    },
  },
  {
    id: 'D', // Celeste: il cielo-quadrante sopra l'orologio; scende la notte, gli indici sospesi si
    // accendono, poi la panoramica scende sulla Super-LumiNova del quadrante
    world: 'celeste', dur: 9.6,
    setup: 'w.setNight(0);',
    hook: 'w.setNight(t);',
    hookArg: (u) => smooth(0.375, 0.583, u),
    cam: (u) => {
      const k = glide(u);
      const pos = lerp([7, 12, -128], [-3, 18.5, -168], k);
      const look = lerp([0, 170, -292], [0, 71.5, -292], smooth(0.625, 0.896, u));
      return { pos, look, fov: 40 - 2 * k, focus: dist(pos, [0, 72, -292]) - 8 };
    },
  },
  {
    id: 'E', // Sunset: le pareti d'agata, poi la panoramica gira sull'orologio nell'abside
    world: 'sunset', dur: 7,
    cam: (u) => {
      const k = glide(u);
      // all'altezza del quadrante il vetro riflette l'agata scura e non la volta chiara: la pietra
      // resta rosso profondo, come nelle foto (dal basso diventava rosa)
      const pos = lerp([-7, 33.5, -196], [-1.5, 34.8, -208], k);
      const look = lerp([-75, 30, -277], [0, 35.6, -277], smooth(0.47, 0.83, u));
      return { pos, look, fov: 40 - 2 * k, focus: dist(pos, [0, 36, -277]) - 2 };
    },
  },
  {
    id: 'F', // Virentia: un carrello laterale tra i tronchi fino alla porta con il rotore, carico a tre quarti
    world: 'virentia', dur: 6.3,
    hook: 'w.energy = 0.75;',
    cam: (u) => {
      const k = glide(u);
      const pos = lerp([-26, 6, -62], [-2, 7, -78], k);
      return { pos, look: lerp([-24, 15, -160], [0, 21.5, -160], k), fov: 42, focus: dist(pos, [0, 14, -112]) };
    },
  },
  {
    id: 'G', // i tre orologi dell'epilogo: il montaggio li sfoca dietro il cartello finale
    world: 'epilogue', dur: 9.3,
    setup: 'w.time = 6;',
    hook: 'w.watches.forEach((x) => (x.userData.label.visible = false));',
    cam: (u) => ({ pos: lerp([0, 1.65, 18], [0, 1.55, 16.4], u), look: [0, 0.95, 0], fov: 40, focus: 17 }),
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
