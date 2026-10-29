// Le copertine di YouTube del trailer (in inglese): tre varianti per il test A/B, 1280×720 in JPG
// sotto i 2 MB. Lo sfondo è un fotogramma del gioco girato apposta (2880×1620, lancette alle 10:10);
// sopra, un solo gancio enorme in Montserrat Black, "WALK INSIDE THE WATCH", con una riga piccola
// "INTERACTIVE EXPERIENCE": dice che cosa si fa senza ripetere il titolo del video. Un velo scuro
// solo dietro il testo dà il contrasto; l'immagine resta nitida.
//   A, Celeste: il quadrante con la Super-LumiNova a destra, il cielo notturno a sinistra
//   B, le tre Delta in basso, le stelle sopra
//   C, Sunset: l'orologio a destra, l'agata a sinistra
import fs from 'node:fs';
import path from 'node:path';
import { bootGame, launchChrome } from './browser.mjs';

const STILLS = [
  { id: 'A-Celeste', world: 'celeste', setup: 'w.setNight(1);', cam: { pos: [0, 72, -160], look: [-44, 70, -292], fov: 40, focus: 132 } },
  { id: 'B-Delta', world: 'movement', setup: 'app.clock.time = 1000;', cam: { pos: [0, 18, 118], look: [0, 40, 208], fov: 44, focus: 92 } },
  { id: 'C-Sunset', world: 'sunset', cam: { pos: [0, 35.5, -212], look: [-31, 35, -277], fov: 40, focus: 65 } },
];

// impaginazione: testo a sinistra (A, C) o in alto al centro (B); un solo colore d'accento su "INSIDE"
const LAYOUT = {
  'A-Celeste': { side: 'left', accent: '#8ff7ff', glow: 'rgba(110,240,255,.55)' },
  'B-Delta': { side: 'top', accent: '#e9bea9', glow: 'rgba(233,190,169,.35)' },
  'C-Sunset': { side: 'left', accent: '#ffe2b0', glow: 'rgba(255,214,150,.35)' },
};

async function renderStills({ port, dir }) {
  const { browser, page } = await bootGame({ port });
  for (const s of STILLS) {
    await page.evaluate((id) => window.__cap.world(id), s.world);
    if (s.setup) await page.evaluate(`(() => { const app = window.monichs; const w = app.director.world; ${s.setup} })()`);
    // un secondo di assestamento (post, fuoco, nebbia), poi lo scatto
    for (let i = 0; i < 60; i++) await page.evaluate(([c]) => window.__cap.frame(c, 1 / 60, false), [s.cam]);
    const url = await page.evaluate(([c]) => window.__cap.frame(c, 1 / 60, true), [s.cam]);
    fs.writeFileSync(path.join(dir, `${s.id}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
  }
  await browser.close();
}

export async function renderThumbnails({ root, port, dir, out }) {
  fs.mkdirSync(dir, { recursive: true });
  await renderStills({ port, dir });
  const b64 = (p) => fs.readFileSync(p).toString('base64');
  const font = (file, weight) =>
    `@font-face{font-family:'Montserrat';src:url(data:font/woff2;base64,${b64(path.join(root, 'node_modules/@fontsource/montserrat/files', file))}) format('woff2');font-weight:${weight};}`;
  const fonts = font('montserrat-latin-700-normal.woff2', 700) + font('montserrat-latin-900-normal.woff2', 900);
  const browser = await launchChrome();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  for (const s of STILLS) {
    const L = LAYOUT[s.id];
    const left = L.side === 'left';
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${fonts}
html,body{margin:0;width:1280px;height:720px;overflow:hidden;background:#000;}
.bg{position:absolute;inset:0;background:url(data:image/jpeg;base64,${b64(path.join(dir, `${s.id}.jpg`))}) center/cover;
  filter:contrast(1.08) saturate(1.15) brightness(1.04);}
.scrim{position:absolute;inset:0;background:${left
      ? 'linear-gradient(90deg,rgba(0,2,14,.78) 0%,rgba(0,2,14,.5) 38%,rgba(0,2,14,0) 62%)'
      : 'linear-gradient(180deg,rgba(0,2,14,.7) 0%,rgba(0,2,14,.35) 34%,rgba(0,2,14,0) 52%)'};}
.txt{position:absolute;font-family:'Montserrat';color:#fff;${left ? 'left:64px;top:50%;transform:translateY(-52%);text-align:left;' : 'left:0;right:0;top:46px;text-align:center;'}}
.kick{font-weight:700;font-size:${left ? 27 : 26}px;letter-spacing:.28em;opacity:.92;margin:0 0 ${left ? 18 : 10}px ${left ? 4 : 0}px;
  text-shadow:0 2px 10px rgba(0,0,0,.7);}
.hook{font-weight:900;font-size:${left ? 116 : 84}px;line-height:${left ? 0.93 : 1};letter-spacing:-.01em;text-transform:uppercase;white-space:nowrap;
  text-shadow:0 4px 0 rgba(0,0,0,.35),0 8px 28px rgba(0,0,0,.65);}
.hook em{font-style:normal;color:${L.accent};text-shadow:0 0 26px ${L.glow},0 4px 0 rgba(0,0,0,.35),0 8px 28px rgba(0,0,0,.6);}
</style></head><body><div class="bg"></div><div class="scrim"></div>
<div class="txt"><div class="kick">INTERACTIVE EXPERIENCE</div>
<div class="hook">${left ? 'Walk<br><em>inside</em><br>the watch' : 'Walk <em>inside</em> the watch'}</div></div>
</body></html>`;
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    const file = path.join(out, `Inside-Monichs-Thumbnail-${s.id}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 92 });
    console.log('→', path.relative(root, file), `${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
  }
  await browser.close();
}
