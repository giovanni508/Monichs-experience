// Mappa degli asset derivati: da quale foto originale, con quale ritaglio, a quale dimensione.
// Le coordinate di ritaglio sono in pixel dell'immagine sorgente: [left, top, width, height].
// Per sostituire un'immagine: cambia `src` o `crop` qui e rilancia `npm run assets`,
// oppure sostituisci direttamente il file WebP in public/assets/ con lo stesso nome.

export const SOURCES = {
  // Celeste
  ce1: 'Modelli/Celeste/MNC_I25_Ed_Ce (1).png',
  ce2: 'Modelli/Celeste/MNC_I25_Ed_Ce (2).png',
  ce3: 'Modelli/Celeste/MNC_I25_Ed_Ce (3).png',
  ce4: 'Modelli/Celeste/MNC_I25_Ed_Ce (4).png',
  ce6: 'Modelli/Celeste/MNC_I25_Ed_Ce (6).png',
  ce7: 'Modelli/Celeste/MNC_I25_Ed_Ce (7).png',
  ce12: 'Modelli/Celeste/MNC_I25_Ed_Ce (12).png',
  // Sunset
  su2: 'Modelli/Sunset/MNC_I25_Ed_Su (2).jpg',
  su4: 'Modelli/Sunset/MNC_I25_Ed_Su (4).png',
  su7: 'Modelli/Sunset/MNC_I25_Ed_Su (7).jpg',
  su10: 'Modelli/Sunset/MNC_I25_Ed_Su (10) Lu.png',
  // Virentia
  vi2: 'Modelli/Virentia/MNC_I25_Ed_Virentia (1)/MNC_I25_Ed_Vi (2).png',
  vi4: 'Modelli/Virentia/MNC_I25_Ed_Virentia (1)/MNC_I25_Ed_Vi (4).png',
  vi6: 'Modelli/Virentia/MNC_I25_Ed_Virentia (1)/MNC_I25_Ed_Vi (6).png',
  vi7: 'Modelli/Virentia/MNC_I25_Ed_Virentia (1)/MNC_I25_Ed_Vi (7).png',
  // Scontornati frontali ("soldatini")
  solCeleste: 'Modelli/Soldatini/Celeste.png',
  solSunset: 'Modelli/Soldatini/Sunset.png',
  solVirentia: 'Modelli/Soldatini/Virentia.png',
  // Laboratorio: schizzo a matita del rotore
  rotorSketch: 'Modelli/ROTORE/MNC_Dw_Rotor 2 (2).png',
};

// Laboratorio: i fogli sul banco. I PDF stanno fuori dal progetto (sul Desktop, mai modificati): si
// rasterizzano con pdftoppm di Poppler (in Git Bash è in /mingw64/bin) alla risoluzione `dpi`, poi si
// ritagliano ([left, top, width, height] in pixel della pagina rasterizzata) e si comprimono in WebP.
// Dopo una modifica qui: `npm run assets -- --force`.
export const PDFS = [
  // MNC_T_Draw_Print, pagina 1: orologio e bracciale aperto in scala 1:1 su A4. È il foglio
  // calpestabile: 4096 px per tenere nitidi i tratti anche visti da vicino.
  { out: 'tex/lab/drawing.webp', src: '../Monichs Asset vari locale/MNC_T_Draw_Print.pdf', page: 1, dpi: 400, size: 4096, quality: 90 },
  // 4029, pagina 1 (cassa in tre viste, 1:1): solo l'area dei disegni, senza l'intestazione e il
  // cartiglio del fornitore. Il ritaglio misura 272 × 164,5 mm.
  { out: 'tex/lab/case-4029.webp', src: '../4029-MOS-SW200-VR13-EXPLOSION.pdf', page: 1, dpi: 300, crop: [150, 276, 3210, 1943], size: 2048, quality: 90 },
];

// Video (richiede ffmpeg nel PATH). Il film "CELESTE INTRO_ORIZ" (4K, 8,7 s) diventa lo sfondo
// della schermata iniziale: si usa solo la parte prima del logo finale (il menu mostra già il logo:
// le guidelines vietano i duplicati), senza audio, con dissolvenza dal/al blu navy per un loop
// senza stacchi. 2560×1440 ad alta qualità (crf 19): nitido su proiettori Full HD e schermi 4K,
// leggero da decodificare. Dopo una modifica qui: `npm run assets -- --video`.
export const VIDEOS = [
  {
    out: 'video/celeste-intro.mp4',
    src: 'CELESTE INTRO_ORIZ.mp4',
    start: 0,
    end: 5.85,
    width: 2560,
    fadeIn: 0.8,
    fadeOut: 0.6,
    fadeColor: '0x02021a',
    crf: 19,
    poster: { out: 'video/celeste-intro-poster.webp', at: 1.7, width: 1280 },
  },
];

// Modelli 3D degli orologi (Modelli/3D, ricostruiti in Blender sulle quote dei disegni tecnici:
// vedi ASSETS.md §8). Copiati in public/assets/models; le texture secondarie (mappe normali, fondelli,
// foto del movimento) scendono a 1024 px per restare leggeri in memoria video. I quadranti restano a 2048.
export const MODELS = [
  { out: 'models/celeste.glb', src: 'Modelli/3D/celeste.glb' },
  { out: 'models/sunset.glb', src: 'Modelli/3D/sunset.glb' },
  { out: 'models/virentia.glb', src: 'Modelli/3D/virentia.glb' },
  // rotore (massa oscillante, oro rosa IP): nessuna texture, solo materiali
  { out: 'models/rotore.glb', src: 'Modelli/3D/rotore.glb' },
  // bosco di Virentia (Modelli/3D/natura, ASSETS.md §8c)
  ...['albero_a', 'albero_b', 'albero_c', 'felce_a', 'felce_b', 'fiori_a', 'fiori_b', 'fiori_c', 'erba_a', 'erba_b', 'roccia_a', 'roccia_b', 'funghi_luminosi', 'tronco_caduto'].map((n) => ({
    out: `models/natura/${n}.glb`,
    src: `Modelli/3D/natura/${n}.glb`,
  })),
  // fondatori in stile animato (ASSETS.md §9): la v3.1 (volti meno inquietanti, mani nuove con le ossa
  // delle dita, polsini), nel gioco su indicazione di Giovanni del 20 ottobre 2026; la v2.2b resta nella
  // cartella sopra
  { out: 'models/founder-giovanni.glb', src: 'Modelli/3D/fondatori/v3/founder-giovanni.glb' },
  { out: 'models/founder-filippo.glb', src: 'Modelli/3D/fondatori/v3/founder-filippo.glb' },
];
export const MODEL_TEXTURE_RESIZE = { pattern: /normal|caseback|movement/, size: 1024, quality: 88 };

// File estratti dallo zip del brand (copiati così come sono).
export const BRAND_ZIP = 'Branding/Branding Monichs - 2026.zip';
export const BRAND_FILES = [
  { entry: 'MNC_B25_Logo/MNC_B25_LG_Production/MNC_B25_LG_Production.svg', out: 'logo/monichs-logo.svg' },
  { entry: 'MNC_B25_Logo/MNC_B25_LG_Pictogram/MNC_B25_Pic.svg', out: 'logo/monichs-pictogram.svg' },
  { entry: 'MNC_B25_Guidelines/Fonts/Foslin-Regular.otf', out: 'fonts/Foslin-Regular.otf' },
  { entry: 'MNC_B25_Guidelines/Fonts/Foslin-Bold.otf', out: 'fonts/Foslin-Bold.otf' },
];

// Il quadrante nei soldatini (7192×7192) è centrato sul pignone delle lancette.
const DIAL = [2330, 1844, 2500, 2500];

export const OUTPUTS = [
  // Orologi interi (scontornati con alfa): schermata iniziale, attract, epilogo
  { out: 'img/watch/celeste.webp', src: 'solCeleste', size: 2048, quality: 90 },
  { out: 'img/watch/sunset.webp', src: 'solSunset', size: 2048, quality: 90 },
  { out: 'img/watch/virentia.webp', src: 'solVirentia', size: 2048, quality: 90 },

  // Quadranti reali (ritaglio circolare, frontale)
  { out: 'img/dial/celeste.webp', src: 'solCeleste', crop: DIAL, size: 1024, quality: 90 },
  { out: 'img/dial/sunset.webp', src: 'solSunset', crop: DIAL, size: 1024, quality: 90 },
  { out: 'img/dial/virentia.webp', src: 'solVirentia', crop: DIAL, size: 1024, quality: 90 },

  // Texture: bande reali dell'agata (Sunset)
  { out: 'tex/agate-bands.webp', src: 'su7', crop: [3600, 2960, 1280, 560], quality: 90 },

  // Laboratorio: lo schizzo a matita del rotore (foglio sul banco, capitolo "Come è nata")
  // (il PNG ha lo sfondo trasparente: lo si appoggia sulla carta)
  { out: 'tex/lab/rotor-sketch.webp', src: 'rotorSketch', size: 2048, quality: 88, flatten: '#f7f4ee' },

  // Card degli hotspot ("lente": ritagli quadrati 512 px)
  { out: 'img/cards/ce-case.webp', src: 'ce1', crop: [3887, 2871, 4300, 4300], size: 512 },
  { out: 'img/cards/ce-dial.webp', src: 'ce2', crop: [2333, 864, 2592, 2592], size: 512 },
  { out: 'img/cards/ce-lume.webp', src: 'ce3', crop: [2678, 432, 3283, 3283], size: 512 },
  { out: 'img/cards/ce-caseback.webp', src: 'ce4', crop: [2894, 1296, 2851, 2851], size: 512 },
  { out: 'img/cards/ce-bracelet.webp', src: 'ce6', crop: [2333, 1642, 3629, 3629], size: 512 },
  { out: 'img/cards/ce-clasp.webp', src: 'ce7', crop: [2851, 1728, 3283, 3283], size: 512 },
  { out: 'img/cards/ce-profile.webp', src: 'ce12', crop: [2419, 2246, 3629, 3629], size: 512 },
  { out: 'img/cards/su-dial.webp', src: 'su2', crop: [2938, 1037, 4493, 4493], size: 512 },
  { out: 'img/cards/su-stones.webp', src: 'su4', crop: [2333, 605, 3974, 3974], size: 512 },
  { out: 'img/cards/su-pebble.webp', src: 'su7', crop: [2894, 1642, 2592, 2592], size: 512 },
  { out: 'img/cards/su-lume.webp', src: 'su10', crop: [3067, 1166, 2851, 2851], size: 512 },
  { out: 'img/cards/vi-dial.webp', src: 'vi2', crop: [2851, 864, 3974, 3974], size: 512 },
  { out: 'img/cards/vi-caseback.webp', src: 'vi4', crop: [2678, 5098, 3629, 3629], size: 512 },
  { out: 'img/cards/vi-balance.webp', src: 'vi4', crop: [4595, 6199, 1100, 1100], size: 512 },
  { out: 'img/cards/vi-movement.webp', src: 'vi4', crop: [3450, 5761, 2000, 2000], size: 512 },
  { out: 'img/cards/vi-rotor.webp', src: 'vi7', crop: [3110, 1469, 2592, 2592], size: 512 },
  { out: 'img/cards/vi-watchmaker.webp', src: 'vi6', crop: [2592, 2074, 3110, 3110], size: 512 },
];
