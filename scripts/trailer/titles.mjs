// I titoli del trailer, composti in Chrome con i font del brand e salvati come PNG trasparenti
// 1920×1080, tutti al centro. Le frasi, in Montserrat ExtraBold maiuscolo, raccontano in anticipo
// che cosa si vedrà e si farà nell'esperienza; sotto la frase di ogni mondo, piccolo, il suo nome
// in Foslin. Il cartello finale: pittogramma e INSIDE MONICHS in Foslin, il sottotitolo in
// Cormorant Garamond corsivo ("al ritmo che decidi tu", dalla presentazione della Collezione Delta),
// l'invito in Montserrat.
import fs from 'node:fs';
import path from 'node:path';
import { launchChrome } from './browser.mjs';

// le frasi, nell'ordine in cui compaiono (i tempi sono in edit.mjs); "\n" manda a capo. Dicono che
// cosa si fa nell'esperienza, con le azioni vere del gioco: si cammina dentro l'orologio, si carica
// la corona, su Celeste si lascia scendere la sera (tappa "lume"), in Sunset si scopre perché ogni
// quadrante è irripetibile (tappa "unique"), in Virentia si carica il rotore
export const BEATS = ['explore', 'crown', 'night', 'unique', 'rotor'];
const WORLD = { night: 'CELESTE', unique: 'SUNSET', rotor: 'VIRENTIA' };

export const TEXT = {
  en: {
    explore: 'Become small.\nExplore Monichs from the inside.',
    crown: 'Wind the crown\nand walk inside the movement.',
    night: 'Let evening fall\nand watch the indices glow.',
    unique: 'Discover why no two\ndials are alike.',
    rotor: 'Wind the rotor\nand wake the forest.',
    sub: 'An interactive experience, at your own pace.',
    unlock: 'Unlocks at $50,000',
    free: 'Free for every backer',
  },
  it: {
    explore: 'Diventa piccolo.\nEsplora Monichs dall’interno.',
    crown: 'Carica la corona\ne cammina dentro il movimento.',
    night: 'Lascia che scenda la sera\ne guarda gli indici accendersi.',
    unique: 'Scopri perché nessun\nquadrante è uguale.',
    rotor: 'Carica il rotore\ne risveglia il bosco.',
    sub: 'Un’esperienza interattiva, al ritmo che decidi tu.',
    unlock: 'Si sblocca a $50.000',
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
    font('Cormorant', 'node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-400-italic.woff2', 400, 'italic', 'woff2'),
    font('Montserrat', 'node_modules/@fontsource/montserrat/files/montserrat-latin-500-normal.woff2', 500, 'normal', 'woff2'),
    font('Montserrat', 'node_modules/@fontsource/montserrat/files/montserrat-latin-800-normal.woff2', 800, 'normal', 'woff2'),
  ].join('\n');
  // il pittogramma, in avorio
  const picto = fs
    .readFileSync(path.join(root, 'public/assets/logo/monichs-pictogram.svg'), 'utf8')
    .replace(/<\?xml[^>]*>/, '')
    .replace(/fill:\s*#[0-9a-fA-F]{3,6}/g, 'fill: #f6f3ec');
  // stessi colori del gioco (src/styles/main.css). Dietro le lettere un velo scuro morbido, solo lì
  // (il film resta nitido e luminoso)
  const css = `${fonts}
:root{--white:#f6f3ec;--ivory:#ede2cd;--rose:#d8a28a;--rose2:#e9bea9;}
html,body{margin:0;width:1920px;height:1080px;background:transparent;overflow:hidden;}
.layer{position:absolute;inset:0;display:none;}
.mid{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;}
.mid::before{content:'';position:absolute;left:50%;top:50%;width:1700px;height:420px;transform:translate(-50%,-50%);
  background:radial-gradient(closest-side,rgba(2,3,16,.46),rgba(2,3,16,.2) 60%,rgba(2,3,16,0));}
.beat{position:relative;max-width:1500px;text-align:center;text-wrap:balance;font-family:'Montserrat';font-weight:800;
  font-size:60px;line-height:1.18;letter-spacing:0.07em;text-transform:uppercase;color:var(--white);
  text-shadow:0 0 34px rgba(0,0,12,.65),0 0 8px rgba(0,0,12,.45);}
.world{position:relative;margin-top:30px;display:flex;align-items:center;gap:22px;font-family:'Foslin';font-size:24px;
  letter-spacing:0.6em;padding-left:0.6em;color:var(--rose2);text-shadow:0 0 18px rgba(0,0,10,.7);}
.world::before,.world::after{content:'';width:46px;height:1.5px;background:var(--rose2);}
.world::before{margin-right:0.36em;}
.card{position:absolute;left:0;right:0;text-align:center;}
.picto{top:232px;}
.picto svg{width:150px;height:150px;}
.title{top:384px;font-family:'Foslin';font-size:66px;letter-spacing:0.5em;padding-left:0.5em;color:var(--white);}
.sub{top:500px;font-family:'Cormorant';font-style:italic;font-weight:400;font-size:46px;color:var(--ivory);}
.rule{top:612px;height:1.5px;width:120px;left:900px;right:auto;background:var(--rose);}
.cta,.cta2{font-family:'Montserrat';font-weight:500;font-size:25px;letter-spacing:0.32em;padding-left:0.32em;text-transform:uppercase;}
.cta{top:650px;color:var(--white);}
.cta2{top:700px;color:var(--rose2);}`;
  const beat = (t, id) =>
    `<div class="layer" id="${id}"><div class="mid"><div class="beat">${t[id].replace('\n', '<br>')}</div>${WORLD[id] ? `<div class="world">${WORLD[id]}</div>` : ''}</div></div>`;
  const html = (t) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
${BEATS.map((id) => beat(t, id)).join('\n')}
<div class="layer" id="card1"><div class="card picto">${picto}</div><div class="card title">INSIDE MONICHS</div></div>
<div class="layer" id="card2"><div class="card sub">${t.sub}</div></div>
<div class="layer" id="card3"><div class="card rule"></div><div class="card cta">${t.unlock}</div><div class="card cta2">${t.free}</div></div>
</body></html>`;

  const browser = await launchChrome();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  for (const [lang, t] of Object.entries(TEXT)) {
    await page.setContent(html(t));
    for (const id of [...BEATS, 'card1', 'card2', 'card3']) {
      if (lang !== 'en' && id === 'card1') continue; // uguale nelle due lingue
      await page.evaluate(async (id) => {
        document.querySelectorAll('.layer').forEach((l) => (l.style.display = l.id === id ? 'block' : 'none'));
        await document.fonts.ready;
      }, id);
      await page.screenshot({ path: path.join(dir, id === 'card1' ? 'card1.png' : `${id}_${lang}.png`), omitBackground: true });
    }
  }
  await browser.close();
  console.log('titoli: pronti');
}
