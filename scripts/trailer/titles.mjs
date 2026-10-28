// I titoli del trailer, composti in Chrome con i font del brand e salvati come PNG trasparenti
// 1920×1080: Foslin per le parole del logo (senza accenti), Cormorant Garamond corsivo per la frase,
// Montserrat per l'invito. La frase d'apertura è la prima del gioco (texts.json, intro1); il
// sottotitolo del cartello riprende la frase del menu ("Un viaggio silenzioso dentro...").
import fs from 'node:fs';
import path from 'node:path';
import { launchChrome } from './browser.mjs';

export const TEXT = {
  en: {
    line: 'Become small. Smaller than a speck of dust.',
    sub: 'An interactive journey inside a mechanical watch.',
    unlock: 'Unlocks at CHF 60,000',
    free: 'Free for every backer',
  },
  it: {
    line: 'Diventa piccolo. Più piccolo di un granello di polvere.',
    sub: 'Un viaggio interattivo dentro un orologio meccanico.',
    unlock: 'Si sblocca a CHF 60.000',
    free: 'Gratis per tutti i backer',
  },
};

export async function renderTitles({ root, dir }) {
  fs.mkdirSync(dir, { recursive: true });
  const b64 = (p) => fs.readFileSync(path.join(root, p)).toString('base64');
  const font = (family, file, weight, style, fmt) =>
    `@font-face{font-family:'${family}';src:url(data:font/${fmt};base64,${b64(file)}) format('${fmt === 'otf' ? 'opentype' : fmt}');font-weight:${weight};font-style:${style};}`;
  const fonts = [
    font('Foslin', 'public/assets/fonts/Foslin-Regular.otf', 400, 'normal', 'otf'),
    font('Cormorant', 'node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-300-italic.woff2', 300, 'italic', 'woff2'),
    font('Cormorant', 'node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-400-italic.woff2', 400, 'italic', 'woff2'),
    font('Montserrat', 'node_modules/@fontsource/montserrat/files/montserrat-latin-500-normal.woff2', 500, 'normal', 'woff2'),
  ].join('\n');
  // il pittogramma, in avorio
  const picto = fs
    .readFileSync(path.join(root, 'public/assets/logo/monichs-pictogram.svg'), 'utf8')
    .replace(/<\?xml[^>]*>/, '')
    .replace(/fill:\s*#[0-9a-fA-F]{3,6}/g, 'fill: #f6f3ec');
  // stessi colori del gioco (src/styles/main.css); il nome del mondo come il titolo del menu
  const css = `${fonts}
:root{--white:#f6f3ec;--ivory:#ede2cd;--rose:#d8a28a;--rose2:#e9bea9;}
html,body{margin:0;width:1920px;height:1080px;background:transparent;overflow:hidden;}
.layer{position:absolute;inset:0;display:none;}
.line{position:absolute;left:0;right:0;bottom:118px;text-align:center;font-family:'Cormorant';font-style:italic;font-weight:300;
  font-size:58px;letter-spacing:0.01em;color:var(--white);text-shadow:0 0 28px rgba(0,0,12,.75),0 0 6px rgba(0,0,12,.55);}
.label{position:absolute;left:132px;bottom:112px;display:flex;align-items:center;gap:26px;font-family:'Foslin';font-size:30px;
  letter-spacing:0.56em;color:var(--white);text-shadow:0 0 22px rgba(0,0,10,.7),0 0 4px rgba(0,0,10,.5);}
.label::before{content:'';width:74px;height:1.5px;background:var(--rose2);box-shadow:0 0 10px rgba(0,0,10,.5);}
.card{position:absolute;left:0;right:0;text-align:center;}
.picto{top:232px;}
.picto svg{width:150px;height:150px;}
.title{top:384px;font-family:'Foslin';font-size:66px;letter-spacing:0.5em;padding-left:0.5em;color:var(--white);}
.sub{top:500px;font-family:'Cormorant';font-style:italic;font-weight:400;font-size:46px;color:var(--ivory);}
.rule{top:612px;height:1.5px;width:120px;left:900px;right:auto;background:var(--rose);}
.cta,.cta2{font-family:'Montserrat';font-weight:500;font-size:25px;letter-spacing:0.32em;padding-left:0.32em;text-transform:uppercase;}
.cta{top:650px;color:var(--white);}
.cta2{top:700px;color:var(--rose2);}`;
  const html = (t) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div class="layer" id="line"><div class="line">${t.line}</div></div>
<div class="layer" id="celeste"><div class="label">CELESTE</div></div>
<div class="layer" id="sunset"><div class="label">SUNSET</div></div>
<div class="layer" id="virentia"><div class="label">VIRENTIA</div></div>
<div class="layer" id="card1"><div class="card picto">${picto}</div><div class="card title">INSIDE MONICHS</div></div>
<div class="layer" id="card2"><div class="card sub">${t.sub}</div></div>
<div class="layer" id="card3"><div class="card rule"></div><div class="card cta">${t.unlock}</div><div class="card cta2">${t.free}</div></div>
</body></html>`;

  const shared = ['celeste', 'sunset', 'virentia', 'card1']; // uguali nelle due lingue
  const browser = await launchChrome();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  for (const [lang, t] of Object.entries(TEXT)) {
    await page.setContent(html(t));
    for (const id of ['line', 'celeste', 'sunset', 'virentia', 'card1', 'card2', 'card3']) {
      if (lang !== 'en' && shared.includes(id)) continue;
      await page.evaluate(async (id) => {
        document.querySelectorAll('.layer').forEach((l) => (l.style.display = l.id === id ? 'block' : 'none'));
        await document.fonts.ready;
      }, id);
      await page.screenshot({ path: path.join(dir, shared.includes(id) ? `${id}.png` : `${id}_${lang}.png`), omitBackground: true });
    }
  }
  await browser.close();
  console.log('titoli: pronti');
}
