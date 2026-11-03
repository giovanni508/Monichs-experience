# ASSETS — Inventario del materiale di progetto

Inventario della cartella `MNC GAME/` al 06/10/2026. Le cartelle sorgente (`Branding/`, `Modelli/`) **non vengono mai modificate**: lo script `npm run assets` legge da qui e genera versioni ridimensionate e compresse in `public/assets/` (vedi in fondo).

Totale: 31 file, ~2 GB, più il film `CELESTE INTRO_ORIZ.mp4` aggiunto in seguito (sezione 5b). Nessun modello 3D, nessun disegno tecnico separato. Uno sketch tecnico a matita è visibile solo sullo sfondo della foto `Ce (7)`.

---

## 1. Branding — `Branding/Branding Monichs - 2026.zip` (180 MB)

| Contenuto | Note | Uso nell'esperienza |
|---|---|---|
| `MNC_B25_Guidelines/MNC_B25_Guidelines.pdf` / `.ai` (83 MB ciascuno) + 9 tavole PNG 3579×2552 | Brand guidelines: logo, area di rispetto, palette, tipografia, don'ts, moodboard | Riferimento per colori, font e regole d'uso del logo |
| `MNC_B25_Logo/MNC_B25_LG_Production/MNC_B25_LG_Production.svg` | Logo completo vettoriale (pittogramma + logotipo), senza fondo | **Usato**: logo della schermata iniziale e dell'epilogo (inline SVG, bianco) |
| `MNC_B25_Logo/MNC_B25_LG_Pictogram/MNC_B25_Pic.svg` | Pittogramma (tre triangoli) | **Usato**: pittogramma sulla corona 3D, sul rotore 3D, favicon, indicatore di percorso |
| `MNC_B25_Logo/*` (PNG 4619², 1080², varianti nero/blu/bianco/marrone, "Partner fondatori") | Varianti raster del logo | Non usati (si usa il vettoriale) |
| `MNC_B25_Guidelines/Fonts/Foslin-Regular/Bold/Black.otf` | Font del logo. **Solo 112 glifi: mancano à è é ì ò ù, — e ·** | **Usato** solo per parole senza accenti (MONICHS, CELESTE, SUNSET, VIRENTIA, numerazioni) |
| `Fonts/Montserrat-Medium.otf` | Font corporate (un solo peso) | Montserrat usato via `@fontsource/montserrat` (pesi 300/400/500, stesso disegno, licenza OFL) |
| `Fonts/StyleScript`, `DancingScript`, `MyriadPro` | Script e sans di supporto | Non usati |
| `MNC_B25_Palette/` (Pantone 2767 C, 440 C, 466 C, 13-1008 TCX) | Palette | Colori UI: Navy #000035, Chocolate #392e2d, Sand #d9cbb4, oro 466 C #c5a974, Rose Gold 4N |

Palette dalle guidelines: Navy/Midnight Blue `#000035` (tinte `#282b54`, `#4f5573`, `#778092`), Chocolate Brown `#392e2d` (`#7d6f64`, `#b5a999`, `#ede2cd`), Black `#000000` (`#15171a`, `#555a61`), White `#ffffff` (`#eeeeee`, `#f6f6f6`), Rose Gold 4N. Regole: logo solo in bianco, nero, marrone o blu; mai ruotato/deformato; mai su immagini "agitate".

---

## 2. Celeste (Ref. M-001) — `Modelli/Celeste/` — PNG RGBA

| File | Cosa mostra | Componente | Risoluzione | Uso |
|---|---|---|---|---|
| `MNC_I25_Ed_Ce (1).png` | Hero ¾ dal basso, quadrante blu, fondo sfumato blu/nero | Cassa, lunetta ottagonale, corona | 11954×8251 | Card "La cassa" |
| `MNC_I25_Ed_Ce (2).png` | Macro quadrante: pattern a triangoli, indici applicati, lancette | Quadrante laccato, indici | 8640×5760 | Card "Quadrante e indici" |
| `MNC_I25_Ed_Ce (3).png` | Notturna: lume ciano su indici e lancette | SuperLuminova | 8640×5760 | Card "SuperLuminova" |
| `MNC_I25_Ed_Ce (4).png` | Fondello pieno inciso (scritte "10 ATMOSPHERES", "316L STAINLESS STEEL", "SWISS AUTOMATIC MOVEMENT") + bracciale | Fondello, bracciale | 8640×5760 | Card "10 ATM" |
| `MNC_I25_Ed_Ce (5).png` | Fondello con pinzette e viti, atelier | Fondello, viti | 8640×5760 | Non usato (alternativa card) |
| `MNC_I25_Ed_Ce (6).png` | Bracciale con chiusura déployante e cacciavite | Bracciale, chiusura | 8640×5760 | Card "Bracciale integrato" |
| `MNC_I25_Ed_Ce (7).png` | Chiusura del bracciale, sketch tecnico sullo sfondo ("MOLLA") | Chiusura | 8640×7896 | Card "Hard coating" |
| `MNC_I25_Ed_Ce (8).png` | Orologio tra le dita | Insieme | 8640×5760 | Non usato |
| `MNC_I25_Ed_Ce (9).png` | Al polso, luce di tramonto | Insieme | 8640×5760 | Non usato |
| `MNC_I25_Ed_Ce (12).png` | Profilo laterale B/N tra le dita: carrure, viti, corona | Profilo cassa (spessore) | 8640×6965 | Card "La corona e l'asta di carica" (Parte 1) |
| `MNC_I25_Ed_Ce (19).png` | Quadrante su supporto da banco, lente, campana di vetro | Quadrante (atelier) | 8640×5760 | Non usato |

## 3. Sunset (Ref. M-002) — `Modelli/Sunset/`

| File | Cosa mostra | Componente | Risoluzione | Uso |
|---|---|---|---|---|
| `MNC_I25_Ed_Su (1).png` | Still life in luce calda tra pannelli | Insieme | 14064×8895 | Non usato |
| `MNC_I25_Ed_Su (2).jpg` | Macro quadrante in agata rosso-arancio con bande | Quadrante in agata | 8640×5760 (JPEG) | Card "Indici e lancette" |
| `MNC_I25_Ed_Su (4).png` | Agata grezza, agata burattata e quadrante su lastra | Dal grezzo al quadrante | 8640×5760 | Card "Cos'è l'agata" + "Dal blocco al quadrante" |
| `MNC_I25_Ed_Su (7).jpg` | Agata burattata tra le dita, bande ben visibili | Materia prima | 8640×5760 (JPEG) | **Texture** di pareti/cielo del canyon (crop delle bande) + card "Irripetibile" |
| `MNC_I25_Ed_Su (10) Lu.png` | Quadrante sciolto in pinzetta, lume ciano | Quadrante, lume | 8640×5760 | Card "Pietra dura" |
| `MNC_I25_Ed_Su (13).png` | Al polso, luce calda | Insieme | 8640×5760 | Non usato |

## 4. Virentia (Ref. M-003) — `Modelli/Virentia/`

`MNC_I25_Ed_Virentia (1).zip` (441 MB) è un **duplicato esatto** della cartella `MNC_I25_Ed_Virentia (1)/` (stessi 8 file, stesse dimensioni in byte): si usa la cartella.

| File | Cosa mostra | Componente | Risoluzione | Uso |
|---|---|---|---|---|
| `MNC_I25_Ed_Vi (1).png` | Still life in penombra calda, foglia in primo piano | Insieme | 11225×10143 | Non usato |
| `MNC_I25_Ed_Vi (2).png` | Macro quadrante verde inciso a foglie, lancette e indici oro rosa | Quadrante, oro rosa | 8640×5760 | Card "Oro rosa" |
| `MNC_I25_Ed_Vi (3).png` | Al polso | Insieme | 8640×5760 | Non usato |
| `MNC_I25_Ed_Vi (4).png` | **Fondello aperto in zaffiro**: rotore oro rosa inciso "TWENTY-SIX (26) JEWELS SWISS MADE", bilanciere con rubino e antiurto | Fondello aperto, rotore, movimento | 8640×12039 | Card "Fondello in zaffiro" (Virentia), "Il rotore" (Virentia), Parte 1: "Il bilanciere", "I 26 rubini", "La finitura" |
| `MNC_I25_Ed_Vi (6).png` | Orologiaio al lavoro sul fondello | Atelier | 8640×5760 | Card "Viti e anglage" |
| `MNC_I25_Ed_Vi (7).png` | Rotore sollevato con pinzetta | Rotore custom | 8640×5760 | Card "Il rotore" (Parte 1) e "Côtes de Genève" (Virentia) |
| `MNC_I25_Ed_Vi (9).png` | Chiusura del bracciale bicolore | Bracciale, oro rosa | 8640×5760 | Non usato |
| `MNC_I25_Ed_Vi (11.1).png` | Quadrante sciolto, lume ciano | Quadrante | 8640×9905 | Non usato |

## 5. Soldatini e Trio

| File | Cosa mostra | Risoluzione | Uso |
|---|---|---|---|
| `Modelli/Soldatini/Celeste.png` | Scontornato frontale (alpha pulito) | 7192×7192 | **Epilogo**; quadrante reale nel portale Celeste; orologio "che respira" di riserva nella schermata iniziale (se il video non parte) |
| `Modelli/Soldatini/Sunset.png` | Scontornato frontale | 7192×7192 | **Epilogo**; **quadrante reale** fluttuante nel "wow" di Sunset; portale Sunset |
| `Modelli/Soldatini/Virentia.png` | Scontornato frontale | 7192×7192 | **Epilogo**; quadrante reale nel portale Virentia e nella "porta" in oro rosa |
| `Modelli/Trio orologi/MNC_I25_Ed_Trio.zip` → `MNC_I25_Ed_Trio.png` | I tre orologi su piedistalli, fondo ambra | 8715×7595 | Non usato in scena (fondo chiaro, non adatto al buio dell'epilogo) |
| `…Trio.zip` → `MNC_I25_Ed_Trio_Up.png` | Come sopra, formato verticale | 8715×10925 | Non usato |

## 5b. Video

| File | Cosa mostra | Risoluzione / durata | Uso |
|---|---|---|---|
| `CELESTE INTRO_ORIZ.mp4` (radice del progetto, 53 MB) | Film Celeste: luce blu, macro del quadrante a triangoli, uno sguardo, macro di cassa e quadrante, dissolvenza al navy e logo MONICHS finale | 3840×2160, 25 fps, 8,7 s, H.264 + audio AAC | **Sfondo in loop della schermata iniziale e dell'attrazione**, senza audio, nitido e appena attenuato (luminosità 0,9), come video nativo dietro al menu. Si usa solo 0–5,85 s: il logo finale è escluso perché il menu mostra già il logo (le guidelines vietano i duplicati). Derivato: `public/assets/video/celeste-intro.mp4` (2560×1440, H.264 crf 19, ~13 MB, senza traccia audio, dissolvenza dal/al navy per un loop senza stacchi) + `celeste-intro-poster.webp` (fotogramma a 1,7 s, velato dietro la schermata di caricamento) |

---

## 6. Osservazioni emerse dalle immagini (da verificare con il brand)

1. **Calibro**: nella foto `Vi (4)` sul ponte del bilanciere si legge inciso **"SW200-1"**, mentre il brief indica **SW200-2 Élaboré**. Nei testi usiamo SW200-2 Élaboré (dato confermato nel brief) — vedi TODO.
2. **Rotore**: le foto mostrano una finitura circolare (concentrica) sul rotore in oro rosa; il brief parla di Côtes de Genève. Nei mondi il rotore è il modello 3D (satinatura circolare, come nelle foto) e le Côtes rettilinee stanno sul paesaggio di Virentia. Da confermare la dicitura esatta dei testi.
3. **Colore Celeste**: in foto il quadrante è un blu intenso con pattern a triangoli; il brief dice "azzurro polvere laccato". I testi seguono il brief, le immagini sono quelle reali.
4. **Lume**: in tutte le foto notturne il SuperLuminova emette **ciano/acqua**: usiamo quel colore (nessuna affermazione sul grado).
5. **Rose gold** (Virentia, lunetta e maglie centrali): non è specificato se oro massiccio o trattamento: i testi dicono "oro rosa" come nel brief — vedi TODO.
6. **Foslin** non contiene lettere accentate: non va usato per testi italiani con accenti.

---

## 7. Asset derivati (generati da `npm run assets` → `public/assets/`)

Tutte le immagini usate nell'esperienza vengono da questa cartella o sono procedurali. Lo script `scripts/build-assets.mjs` ritaglia, ridimensiona (max 2048 px) e comprime in WebP (qualità 82–90); il video è elaborato con ffmpeg. Sorgenti e ritagli sono in `scripts/assets-manifest.mjs`; l'elenco generato è in `public/assets/manifest.json`. Totale: ~15 MB (di cui ~13 MB il video).

| Cartella | File | Dove |
|---|---|---|
| `video/` | `celeste-intro.mp4`, `celeste-intro-poster.webp` | Schermata iniziale e attrazione; caricamento |
| `img/watch/` | `celeste`, `sunset`, `virentia` (2048 px, alfa) | Epilogo; riserva della schermata iniziale |
| `img/dial/` | `celeste`, `sunset`, `virentia` (1024 px) | Portali dell'hub; quadrante reale nel "wow" di Sunset; porta in oro rosa di Virentia |
| `tex/` | `agate-bands` | Pareti, cielo, pietre e fette d'agata di Sunset (mescolata alle venature procedurali) |
| `img/cards/` | 17 "lenti" (512 px) | Card delle tappe: mappa completa in `content/config.json` → `cards` |
| `logo/` | `monichs-logo.svg`, `monichs-pictogram.svg` | Menu; favicon (il pittogramma 3D su corona e rotore è ricostruito dagli stessi poligoni) |
| `fonts/` | `Foslin-Regular.otf`, `Foslin-Bold.otf` | Nomi dei mondi, etichette dei portali, "INSIDE MONICHS" |
| `index.json` | elenco dei file in `assets/` (generato, non va modificato) | Il gioco lo consulta prima di chiedere un file facoltativo |

### Riepilogo: usati e inutilizzati

- **Usati** (22 sorgenti): Ce 1, 2, 3, 4, 6, 7, 12 · Su 2, 4, 7, 10 Lu · Vi 2, 4, 6, 7 · i tre soldatini · `CELESTE INTRO_ORIZ.mp4` · dallo zip del brand: logo e pittogramma SVG, Foslin Regular e Bold.
- **Inutilizzati**: Ce 5, 8, 9, 19 · Su 1, 13 · Vi 1, 3, 9, 11.1 · Trio e Trio_Up (fondo ambra chiaro, poco adatto al buio dell'epilogo; gli scontornati rendono meglio) · zip Virentia (duplicato) · dallo zip del brand: PDF/AI delle guidelines (solo riferimento), loghi PNG, Foslin Black, Montserrat-Medium (sostituito dalla stessa famiglia via `@fontsource`, con più pesi), StyleScript, DancingScript, MyriadPro, immagini della palette (solo riferimento).
- Tutto il resto (ingranaggi, ponti, cassa del movimento, bracciale-ponte, cieli, agata, foresta) è **procedurale**; orologi e rotore sono i modelli 3D di §8 e §8b.

---

## 8. Modelli 3D degli orologi — `Modelli/3D/` (Blender)

Ricostruiti da `scripts/blender/build_watches.py` (Blender 5.2) sulle **quote dei disegni tecnici del produttore** e verificati sovrapponendo i render agli scontornati. Per rigenerarli:
`blender --background --factory-startup --python scripts/blender/build_watches.py` (`-- --no-render` salta i render, `-- --draft` per anteprime veloci).

**Fonti delle quote**
- `4029 new band drawing-3.pdf` (fornitore bracciale ZS0187, PDF vettoriale, 12 tavole): ogni maglia quotata (esterne 24,00→22,24 / 22,20→20,73 / 20,70→19,52 / 19,50→18,61 / 18,59→18,00, poi 18,00; centrali 12,80 / 11,80 / 11,00 / 10,00 / 9,00; testa 13,45 × 5,79; passo 7,50 + 0,20; R15 e R10 di bombatura), lunetta (Ø 37,06 con settori a ±24° e confini a r 16,53 / 17,83), profilo laterale (spessore, vetro bombato, fianco).
- `4029-MOS-SW200-VR13-EXPLOSION.pdf` (Asia Leader, 12 tavole raster a 300 dpi): cassa 41,1 × 44,0 mm, spessore 11, corona Ø 6, quadrante Ø 29 (tavola 2:1: indici, logo, scritte), lancette 8,5 / 13 / 13 (tavola 4:1), fondelli (tavola 2:1: ottagono, 6 viti, testi, montagne incise), finiture (satinato 12-6, satinato circolare, lucido, sabbiato). Versioni: **14 = Sunset, 15 = Celeste, 17 = Virentia**.
- Scontornati `Modelli/Soldatini/*.png`: le tre immagini hanno sagoma identica al pixel (stesso impianto) e scala 85,27 px/mm (verificata su lunetta CAD Ø 37,06 e cassa 41,1). Da qui: contorno reale della cassa (il disegno del bracciale riporta solo il bordo del piano superiore), indici (r 10,4–13,85), ora delle lancette (10:09:36).
- Foto `Vi (4)`: movimento visibile dal fondello in zaffiro.

**Texture** (`Modelli/3D/textures/`, sorgenti in `scripts/blender/textures_src/`, script di estrazione una tantum con percorsi locali)
- `*_dial.png` + `*_dial_normal.png`: quadranti estratti dagli scontornati, raddrizzati e centrati sugli indici; indici, logo e lancette rimossi e ricostruiti (Celeste: cella media del reticolo a triangoli, lato 1,245 mm; anello dei minuti sintetizzato con periodo di 6°); stampe originali (MONICHS, nome, AUTOMATIC, SWISS MADE, minuteria) mantenute.
- `caseback_solid.png` / `caseback_open.png`: incisioni dei fondelli.
  - **Montagne e cerchi:** dalle tavole 2:1. Il cerchio sottile a 14,8 mm è ridisegnato continuo come nella foto.
  - **Testi dell'anello:** rifatti l'8 ottobre 2026 con `scripts/blender/textures_src/caseback_text.py`. La maschera ricavata dalla tavola rendeva le S come 8 e girava le lettere verso il centro. Ora usano Montserrat Light, maiuscole di 0,88 mm, con la parte alta verso il bordo e lettura in senso orario guardando il fondello, come nella foto `Vi (4)`.
  - **Posizione e ampiezza:** quelle della tavola, cioè ◮ MONICHS (ore 12), 316L STAINLESS STEEL, SWISS AUTOMATIC MOVEMENT (ore 6, capovolta), 10 ATMOSPHERES (vicino alla corona).
  - **Sorgenti:** le maschere originali della tavola restano in `textures_src/caseback_*_disegno.png`. Il fondello aperto (Virentia) è a 3072 px, quello pieno a 1536 px.
  - **Confronto:** `render/virentia_fondello_foto_vs_modello.jpg`.
- `virentia_movement.png`: foto `Vi (4)` raddrizzata (ellisse della finestra → cerchio, orientata sulle scritte del fondello).

| File | Contenuto |
|---|---|
| `celeste.glb`, `sunset.glb`, `virentia.glb` | Un orologio per file, texture JPEG incorporate (2,7–4,5 MB). Nodo radice scalato a 0,001: unità in metri, Y in alto |
| `monichs_delta.blend` | I tre orologi (unità mm), luci da still life e camera |
| `render/*_confronto_fronte.png`, `render/confronto_*_foto_vs_modello.jpg` | Stessa inquadratura ortogonale degli scontornati, per il confronto diretto |
| `render/*_eroe.png`, `*_tre_quarti.png`, `*_fondello.png`, `*_profilo.png`, `trio.png` | Viste di presentazione (sfondo trasparente) |

**Nel gioco** (`public/assets/models/*.glb`, copie alleggerite da `npm run assets`: normali, fondelli e movimento a 1024 px; caricati da `src/gfx/watchModel.js`)
- Un monolite per livello (orologio completo, gigante, con la luce d'ambiente dello studio fotografico; `createMonolith` in `watchModel.js`): movimento = le tre Delta nel vuoto dietro la partenza (1 unità per mm); Celeste in fondo al ponte (circa 2,5 unità per mm); Sunset nell'abside della cattedrale, al posto del rosone (1 unità per mm; il quadrante d'agata appena illuminato da dentro, come la pietra in controluce); Virentia in fondo alla radura (1,4 unità per mm).
- Epilogo: i tre orologi completi, luce d'ambiente da studio fotografico.
- Sunset, tappa degli indici: quattro orologi (senza bracciale) attorno al monolite. Il primo ha il quadrante reale; negli altri tre la pietra è quella della texture `sunset_dial.png`, ripulita dalle scritte al caricamento (le stampe bianche e i riquadri di MONICHS e SUNSET AUTOMATIC vengono riempiti con la pietra intorno) e vista da un altro taglio: ruotata, specchiata, ingrandita verso le bande aranciate, appena deformata. Il taglio cambia a ogni visita; stampe, indici e minuteria restano quelli veri. Centro e raggio della pietra nella texture (u 0,493, v 0,501, r 0,44) sono misurati sull'immagine.
- Virentia: la porta è la lunetta del modello (anello interno in acciaio satinato circolare, anello esterno in oro rosa IP lucido), ingrandita perché l'apertura misuri 13 unità; nell'apertura solo il vetro zaffiro, attraverso cui si vede il monolite. La foto del quadrante non è più usata in questo mondo (resta nei portali dell'hub).

**Limiti noti**: le parti non quotate né fotografate sono ricostruite (interno del bracciale, meccanismo della chiusura deployante, sottofondo del vano). Il movimento di Virentia è una foto su un disco, non un movimento 3D. Le satinature sono rese con materiali anisotropi, senza texture di righe. Il bracciale è chiuso ad anello con 2 maglie amovibili per lato, mentre il disegno ne prevede 4: è la taglia di un polso medio.

### 8b. Rotore (massa oscillante) — `Modelli/3D/rotore.blend`, `rotore.glb`

Generato da `scripts/blender/build_rotor.py` (`blender --background --factory-startup --python scripts/blender/build_rotor.py`). Fonti in `Modelli/ROTORE/`: lo schizzo `MNC_Dw_Rotor 2 (2).png` (forma, tre razze, sezione con il bordo pesante a gradini) e la foto `MNC_I25_Ed_Vi (7).png` (rotore sollevato). Le quote in pianta sono misurate con una griglia di 1 mm sulla foto `Vi (4)` raddrizzata (`textures/virentia_movement.png`, 62 px/mm):
- **Fascia e mozzo:** fascia da r 9,5 a 12,1; disco del mozzo r 4,04.
- **Razze:** razza centrale a cuneo da 3,3 a 7,6 mm; razze d'estremità da 2,0 a 1,6 mm.
- **Finestre:** lato verso il mozzo a 4,07 mm dal centro.
- **Cuscinetto:** acciaio dentellato fino a r 2,74, anello rosa, vite centrale con taglio.
- **Incisioni:** "TWENTY - SIX 26 JEWELS SWISS MADE" lungo la fascia a r 10,8 (altezza 0,6), pittogramma (2,4) a r 7,75, "MONICHS" a r 9,6.
- **Finitura:** oro rosa IP satinato circolare, smusso superiore lucido.

Gli spessori (piastra 0,55, fascia 1,0, bordo pesante 1,5) sono ricostruiti dalla sezione dello schizzo, che non è quotata. Render: `render/rotore_*.png`, confronti `render/rotore_confronto_foto_vs_modello.jpg` e `render/rotore_confronto_vi7.jpg`.

**Nel gioco** (`public/assets/models/rotore.glb`, `createRotor` in `src/gfx/watchModel.js`): nel movimento è il rotore sopra i ponti, sul perno al centro del calibro (raggio 60 unità, circa 5 per mm), con la faccia incisa verso il fondello come nell'orologio e il bordo pesante verso chi cammina sotto; oscilla come sotto un polso e alla sua tappa "cade" verso il visitatore. In Virentia è il sole sopra la radura (raggio 70 unità, circa 5,8 per mm), girato con la faccia incisa verso la foresta; l'oro rosa ha un calore proprio che cresce con la carica, e la tappa "Il rotore" lo fa brillare.

### 8c. Bosco di Virentia — `Modelli/3D/natura/` (Blender)

Generati dalla sessione di modellazione con `scripts/blender/build_nature.py` (sorgente `natura.blend`, texture in `natura/textures/`, render `render/natura_*.png`, misure e triangoli in `natura/report.json`). Metri, Y in alto, origine al centro della base.

| File | Contenuto |
|---|---|
| `albero_a/b/c.glb` | Faggio, acero, betulla: 16,5–19 m, 16–20 mila triangoli; mesh `corteccia` e `foglie` (piani con trasparenza a soglia) |
| `felce_a/b.glb`, `erba_a/b.glb` | Felci (0,9–1,3 m) e ciuffi d'erba (0,2–0,6 m) |
| `fiori_a/b/c.glb` | Mazzetti bassi (0,3–0,5 m): petali, centri, foglie, steli |
| `roccia_a/b.glb`, `tronco_caduto.glb`, `funghi_luminosi.glb` | Rocce con muschio, tronco caduto, funghi luminosi |

**Nel gioco** (`public/assets/models/natura/`, caricati da `src/gfx/nature.js` con l'instancing, divisi in zone per lo scarto fuori campo): in Virentia un viale ai lati del sentiero (circa 3,2–3,7 volte la scala reale: il visitatore è piccolo), una seconda fila, una corona attorno alla radura aperta verso il sentiero e il monolite, un fondo più rado; felci, fiori appena luminosi, erba, funghi ai piedi degli alberi, rocce e tronchi caduti fuori dalla linea di cammino. Il fogliame ondeggia al vento e si accende con la carica dell'orologio.

### 8c. Natura del mondo Virentia — `Modelli/3D/natura/`

Generata da `scripts/blender/build_nature.py` (`blender --background --factory-startup --python scripts/blender/build_nature.py`, opzioni `-- --draft` e `-- --no-render`). Tutto è procedurale e deterministico, comprese le texture: rametti, fronde ed erba disegnati in numpy, cortecce, roccia e muschio tileabili con normal map. Palette: verdi del quadrante Virentia #1f5c2a #2f7a2c #5aa646 #a8e08a, crema #ede2cd e oro rosa #f0b49b per fiori e accenti. Ogni GLB ha Y in alto, unità in metri a scala reale, origine al centro della base e trasformazioni applicate. Le foglie sono piani con alpha (`alphaMode: MASK`, doppia faccia), le texture PNG solo dove serve l'alpha e JPEG per le opache, tutte da 1024 px al massimo. Niente trasmissione né volume.

| File | Cosa | Misure (L × P × A, m) | Triangoli | Mesh / materiali |
|---|---|---|---|---|
| `albero_a.glb` | Faggio, corteccia grigio argento, chioma morbida a strati | 11,4 × 11,9 × 19,0 | 17.352 | `corteccia`, `foglie` |
| `albero_b.glb` | Acero giapponese, corteccia bruna, chioma a palchi orizzontali, qualche foglia oro rosa | 12,3 × 11,9 × 16,0 | 15.956 | `corteccia`, `foglie` |
| `albero_c.glb` | Betulla, corteccia bianca con lenticelle, punte leggermente ricadenti | 10,0 × 10,4 × 18,9 | 19.584 | `corteccia`, `foglie` |
| `felce_a.glb` / `felce_b.glb` | Felce a vaso alta / felce aperta più chiara | 2,0 × 2,2 × 1,3 / 2,0 × 2,0 × 0,9 | 360 / 440 | `fronde` |
| `fiori_a.glb` | Anemoni crema con centro dorato | 0,2 × 0,3 × 0,43 | 1.044 | `fiori`: `petali`, `centri`, `steli`, `foglie` |
| `fiori_b.glb` | Campanule oro rosa, pendule | 0,25 × 0,25 × 0,47 | 1.232 | come sopra |
| `fiori_c.glb` | Ombrelle di fiorellini bianco caldo | 0,2 × 0,2 × 0,3 | 928 | come sopra |
| `erba_a.glb` / `erba_b.glb` | Ciuffo d'erba con fiorellini / cuscino di muschio fiorito | 0,6 × 0,7 × 0,6 / 0,7 × 0,7 × 0,2 | 72 / 56 | `erba` |
| `roccia_a.glb` / `roccia_b.glb` | Masso / gruppo di tre pietre, muschio sulle facce in alto | 2,8 × 2,3 × 1,3 / 2,9 × 1,8 × 1,1 | 1.280 / 1.920 | `roccia`: `roccia`, `muschio` |
| `funghi_luminosi.glb` | Sette funghi, cappelli crema con emissione oro rosa (emissiveFactor) | 0,26 × 0,24 × 0,29 | 1.106 | `funghi`: `cappelli`, `gambi` |
| `tronco_caduto.glb` | Tronco di faggio con muschio sul dorso e sezioni del legno | 3,65 × 0,95 × 1,06 | 392 | `tronco`: `corteccia`, `muschio`, `legno` |

Render di controllo: `render/natura_alberi.png`, `natura_felci.png`, `natura_fiori.png`, `natura_erba.png`, `natura_rocce.png`, `natura_extra.png`, `natura_viale.png` (sentiero con alberi alterni ai lati). Sorgente Blender: `natura/natura.blend`. Dati per elemento: `natura/report.json`. Le chiome sono simmetriche: per il viale ad arco conviene alternare le varianti e ruotarle a caso, a 5–6 m dal sentiero e a 8–10 m di distanza l'una dall'altra.
