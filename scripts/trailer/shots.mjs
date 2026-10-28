// I piani del trailer: camera, fuoco e regia di ogni mondo, a 60 sottofotogrammi al secondo (il
// montaggio li fonde a due a due: 30 fps con un filo di mosso, come un otturatore a 180°).
// Le coordinate sono quelle dei mondi (vedi worlds/*.js); i piani durano un po' più del necessario,
// il montaggio ne prende la parte centrale. Movimenti lenti; la frase sta al centro su un fondo
// tranquillo (stelle, il cielo che si fa notte, agata, bosco): dove l'orologio è al centro una
// panoramica lo scopre quando la frase sfuma, altrove l'orologio resta sul terzo destro.
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
      const look = lerp([-2, 78, 208], [1.5, 26.5, 208], smooth(0.633, 0.856, u));
      return { pos, look, fov: 44 - 1.5 * k, focus: dist(pos, [0, 26, 208]) };
    },
  },
  {
    id: 'B', // la passerella verso la corona, e dentro il tubo: accelera piano, come risucchiati
    world: 'movement', dur: 6.2,
    setup: 'app.clock.time = 1010; app.clock.setScale(1, 100); app.clock.scale = 1;',
    cam: (u) => {
      const k = Math.pow(u, 1.4);
      const pos = lerp([0, 7.7, 119], [0, 7.0, 96], k);
      return { pos, look: [0, 6.3, 60], fov: 40 + 6 * k, focus: Math.max(9, pos[2] - 82) };
    },
  },
  {
    id: 'C', // gli ingranaggi del rodaggio sotto la passerella di zaffiro, in time-lapse (×10)
    world: 'movement', dur: 7.2,
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
    world: 'celeste', dur: 10.5,
    setup: 'w.setNight(0);',
    hook: 'w.setNight(t);',
    hookArg: (u) => smooth(0.248, 0.457, u),
    cam: (u) => {
      const k = glide(u);
      const pos = lerp([7, 12, -128], [-3, 18.5, -168], k);
      const look = lerp([0, 170, -292], [0, 71.5, -292], smooth(0.686, 0.895, u));
      return { pos, look, fov: 40 - 2 * k, focus: dist(pos, [0, 72, -292]) - 8 };
    },
  },
  {
    id: 'E', // Sunset: le pareti d'agata al centro, l'orologio sul terzo destro; si avvicina piano
    world: 'sunset', dur: 7.5,
    cam: (u) => {
      const k = glide(u);
      // all'altezza del quadrante il vetro riflette l'agata scura e non la volta chiara: la pietra
      // resta rosso profondo, come nelle foto (dal basso diventava rosa)
      const pos = lerp([-4, 33.5, -190], [-3.5, 34.2, -199], k);
      const look = lerp([-47, 31, -277], [-42, 32, -277], k);
      return { pos, look, fov: 41, focus: dist(pos, [0, 36, -277]) - 2 };
    },
  },
  {
    id: 'F', // Virentia: il bosco al centro, la porta con il rotore (carico a tre quarti) sul terzo destro
    world: 'virentia', dur: 7.8,
    hook: 'w.energy = 0.75;',
    cam: (u) => {
      const k = glide(u);
      const pos = lerp([-30, 6, -58], [-21, 6.2, -64], k);
      return { pos, look: lerp([-28, 15, -160], [-20, 16, -160], k), fov: 42, focus: dist(pos, [0, 14, -112]) };
    },
  },
  {
    id: 'G', // i tre orologi dell'epilogo: il montaggio li sfoca dietro il cartello finale
    world: 'epilogue', dur: 7.3,
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
