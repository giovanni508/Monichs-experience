# INSIDE MONICHS

Esperienza 3D in prima persona nel browser: un viaggio onirico dentro il calibro SW200-2 Élaboré
e nei tre mondi della Collezione Delta — Celeste (M-001), Sunset (M-002), Virentia (M-003) — che si
chiude con l'epilogo, davanti ai tre orologi completi.
Pensata per la fiera: modalità attrazione, reset automatico, funzionamento offline.

> Il laboratorio (Parte III: i fondatori che raccontano sul banco) è stato tolto dall'esperienza il 3 novembre 2026. Il codice è nella storia di git (ultimo commit che lo contiene: 529b3e7); voci, modelli dei fondatori, texture e script sono in `Archivio/laboratorio/`, fuori dal repository e dalla build.

Stack: Vite · Three.js · postprocessing · Web Audio API (audio interamente procedurale). Nessun backend.

---

## 1. Avvio rapido

Requisiti: **Node.js 18 o superiore** (testato con Node 24) e Google Chrome o Safari recenti.

```bash
npm install
```

```bash
npm run dev
```

Si apre su `http://localhost:5173`. Le modifiche a codice e testi si vedono subito. Se è impostata la variabile `PORT` (l'anteprima dell'app Claude la imposta da sola quando la 5173 è occupata da un altro progetto), il server usa quella porta.

### Repository

Il progetto sta su [github.com/giovanni508/Monichs-experience](https://github.com/giovanni508/Monichs-experience), che è **pubblico**. Ogni modifica va pushata lì. Restano fuori (vedi `.gitignore`):
- `node_modules/` e `dist/`: si rifanno con `npm install` e `npm run build`.
- Le sorgenti grezze: `Modelli/`, `Branding/` e il film originale. Sono oltre 3 GB e contengono anche le foto vere dei fondatori, che non si caricano mai. Restano su questo PC, e `npm run assets` le legge da qui.

Il materiale di terzi (le maschere ricavate dalle tavole del fornitore della cassa, il font Foslin del brand) è nel repository dal 20 ottobre 2026: Giovanni ha i permessi per pubblicarlo.

## 2. Build

```bash
npm run build
```

Crea la cartella `dist/` (circa 36 MB, di cui 13 MB il film della schermata iniziale): contiene tutto, font, immagini e video compresi. Non servono connessione né CDN.

## 3. In fiera (offline)

**Windows:** doppio clic su `FIERA-avvia.bat`. Avvia il server locale e apre Chrome a schermo intero in modalità kiosk, con l'audio che parte anche senza clic.

**macOS:** la prima volta, nel Terminale: `chmod +x fiera-avvia.command`. Poi doppio clic su `fiera-avvia.command`.

**A mano:**

```bash
npm run fiera
```

Poi aprire `http://localhost:8080` e premere **F** per lo schermo intero.

> La build non si può aprire facendo doppio clic su `dist/index.html` (`file://`): i browser bloccano moduli, texture WebGL e video. Serve sempre il piccolo server incluso (`scripts/serve-dist.mjs`, senza dipendenze).

Consigli per il PC della fiera: alimentazione collegata, risparmio energetico disattivato, Chrome aggiornato. Per uscire dalla modalità kiosk: **Alt+F4** (Windows) o **Cmd+Q** (Mac).

### Trailer per Kickstarter

Un video di 45 s in 16:9 (1920×1080, 30 fps), lento, che presenta l'esperienza: le tre Delta, la corona, gli ingranaggi, Celeste dal giorno alla notte, Sunset, Virentia e il cartello "INSIDE MONICHS · An interactive experience, at your own pace · Unlocks at $50,000 · Free for every backer". Al centro, in Montserrat ExtraBold, cinque frasi lunghe sullo schermo dicono che cosa si fa nell'esperienza, con le azioni vere del gioco ("Become small. Explore Monichs from the inside.", "Wind the crown and walk inside the movement.", "Let evening fall and watch the indices glow.", "Discover why no two dials are alike.", "Wind the rotor and wake the forest."). Esce in inglese e in italiano.

```bash
npm run dev        # in un altro terminale
npm run trailer    # riprese, musica, titoli e montaggio: trailer/Inside-Monichs-Trailer-EN.mp4 e -IT.mp4
```

Le riprese vengono dal gioco, guidato fotogramma per fotogramma in Chrome senza finestra (qualità ultra, 2880×1620 ridotto a 1080p); la musica è un pianoforte a feltro sintetizzato sul motivo 6-3-2-1, a 60 BPM, con i cambi d'armonia sui tagli. Piani e camere sono in `scripts/trailer/shots.mjs`, frasi in `scripts/trailer/titles.mjs` (i tempi in `edit.mjs`), partitura in `scripts/trailer/music.mjs`; per rifare solo una parte: `npm run trailer -- musica montaggio` (o `riprese --piani=D,E`). Servono ffmpeg, Google Chrome e Playwright (dettagli in testa a `scripts/trailer.mjs`). La cartella `trailer/` resta fuori dal repository.

Lo stesso comando prepara anche tre copertine di YouTube in inglese per il test A/B (1280×720 JPG: `trailer/Inside-Monichs-Thumbnail-A-Celeste.jpg`, `-B-Delta`, `-C-Sunset`). Sono fotogrammi del gioco girati apposta con il gancio "WALK INSIDE THE WATCH" e la riga "INTERACTIVE EXPERIENCE"; solo loro: `npm run trailer -- copertine` (`scripts/trailer/thumbnails.mjs`).

## 4. Comandi

| Azione | Tastiera / mouse | Controller (in fiera) |
|---|---|---|
| Muoversi | W A S D / frecce | levetta sinistra o croce |
| Guardare | mouse (pointer lock); trascinando, se il browser non concede il pointer lock | levetta destra |
| Lentamente | Shift | LT o B (PlayStation: L2 o ○) |
| Interagire | Spazio / clic | A (PlayStation: ✕) |
| **Caricare la corona** (inizio del viaggio) | **tenere premuto** Spazio o il tasto sinistro del mouse | tenere premuto A |
| Caricare il rotore (Virentia) | mouse avanti e indietro, o A/D alternati | una levetta a destra e a sinistra |
| Entrare (menu) | Invio / Spazio / pulsante | croce o levetta per scegliere un capitolo, A per entrare; Menu entra subito |
| Pausa | Esc | Menu (PlayStation: Options); in pausa croce e A, B riprende |
| Schermo intero | F | — |
| Audio on/off | M o pulsante in alto a destra | — |
| Lingua IT/EN | bandierine in alto a destra, accanto all'audio; L (menu, pausa, epilogo) | Y (menu, pausa, epilogo) |
| **Riavvio segreto** | **Shift+R** | **View e Menu insieme per 2 s** (PlayStation: Create e Options) |
| Statistiche (nascoste) | Shift+D | — |

**Controller.**
- **Modelli.** Va bene qualunque controller con la mappatura standard del browser (Xbox, PlayStation, la maggior parte degli altri): si collega al PC prima di aprire Chrome.
- **Suggerimenti a schermo.** Mostrano i pulsanti del controller in uso, con le lettere dell'Xbox o i simboli del PlayStation, e tornano ai tasti appena si usa la tastiera. Con `kiosk.controller` (in `content/config.json`) li mostrano già dal menu, prima che qualcuno tocchi il controller: Chrome lo vede solo dopo la prima pressione.
- **Vibrazione.** È leggera: a ogni scatto della corona e del rotore, e quando l'orologio riparte.
- **Pausa.** Col controller non serve agganciare il mouse, e la pausa si apre solo con Menu.

Esc libera il mouse e mette in pausa ("Il tempo è sospeso"). Lo stesso accade se si cambia scheda o finestra (Alt+Tab, notifiche): al ritorno la pausa è già a schermo e un clic, Spazio o Invio riagganciano il mouse.

**Si cammina, non si vola.** Il visitatore è piccolo e cammina sui pavimenti dei mondi; guardare in alto o in basso non lo solleva. Ingranaggi, pareti, tronchi e oggetti non si attraversano e dai bordi non si cade:

- **Il movimento**: una passerella in vetro zaffiro (si vedono le ruote sotto i piedi) che entra nella cassa dal tubo della corona, passa accanto al rotore, a un balcone sopra il bariletto, sopra il rodaggio e lo scappamento e gira attorno al bilanciere. Un ascensore (un disco che sale quando ci si ferma sopra) porta sulla piattaforma sopra il bilanciere, sotto il rotore: lì ci sono i tre portali. Si torna giù allo stesso modo.
- **La corona**: all'inizio l'orologio è fermo e la passerella si interrompe davanti alla corona. Tenendo premuto si carica (la corona gira, la minuteria di luce si riempie in circa 3,5 secondi, si sentono gli scatti del cricchetto). Carica, il bilanciere riparte, il tic ricomincia, un ponte si distende fino alla corona, che si dissolve: si entra. Se nessuno la carica, dopo 30 secondi davanti alla corona si carica da sola (in fiera nessuno resta bloccato).
- **Celeste**: la terrazza e il ponte di maglie del bracciale. **Sunset**: il fondo del canyon d'agata e la cattedrale; il blocco d'agata è un ostacolo. **Virentia**: un bosco incantato (alberi, felci, fiori e rocce modellati in Blender) su un prato di muschio pettinato a onde di Côtes de Genève; tronchi, rocce, tronchi caduti, la vite caduta e la molla della radura sono ostacoli; la porta è la lunetta in oro rosa con dentro il rotore, e ci si passa in mezzo, sotto il mozzo.

## 5. Modalità fiera

- **Attrazione**: dopo 25 s di inattività sulla schermata iniziale parte un loop: il film Celeste alternato a inquadrature dei mondi. Qualsiasi tasto o movimento riporta al menu.
- **Audio**: nel menu, nell'attrazione e nell'epilogo c'è solo l'ambiente sonoro. Il tic dell'orologio (8 alternanze al secondo) si sente solo dentro i livelli: movimento, Celeste, Sunset e Virentia.
  - **Timbro.** Il tic è morbido e scuro (niente brillantezza oltre 5–6 kHz) e sta sotto la musica.
  - **Abitudine.** Entrando in un mondo si sente bene, poi in circa 13 s scende a fare da sfondo, come un orologio vero che dopo un po' non si nota più. Risale avvicinandosi alla sorgente.
  - **Pianoforte.** Sopra l'ambiente di ogni mondo, menu ed epilogo compresi, suona una melodia di pianoforte molto leggera. È un pianoforte "felt", con i martelletti coperti di feltro, sintetizzato nel browser. Suona poche note lente, in frasi brevi separate da lunghi silenzi, nella tonalità del mondo. La prima frase è sempre il motivo di Monichs, una discesa che si posa. Per far posto al pianoforte, l'ambiente è stato riequilibrato: pad più morbidi e meno note sparse. Il volume si regola in `config.json` → `audio.piano`.
- **Reset automatico**: dopo 60 s senza input durante il viaggio o nell'epilogo si torna alla schermata iniziale.
- **Browser senza pointer lock**: alcuni browser non lasciano mai agganciare il mouse (per esempio il browser integrato dell'app Claude). Lì il gioco non resta in pausa: passa al mouse libero, si guarda trascinando sulla scena e un clic interagisce. Tenere premuto senza muovere il mouse resta "tieni premuto". Al ritorno al menu riprova ad agganciare il mouse. In fiera si usa Chrome, che il mouse lo aggancia.
- **Durata**: circa 7–9 minuti per il percorso completo. Dal menu si può saltare a un capitolo (Il movimento, Celeste, Sunset, Virentia).
- Nessun testo di debug a schermo. Le statistiche compaiono solo con Shift+D.

Tutti i tempi si regolano in `content/config.json` → `kiosk`.

## 6. Modificare testi, configurazione e immagini

### Testi (IT/EN)

Tutto è in **`content/texts.json`**. Ogni voce ha la versione italiana e inglese:

```json
"title": { "it": "La corona e l'asta di carica", "en": "The crown and the winding stem" }
```

- In sviluppo la pagina si ricarica da sola a ogni salvataggio.
- **Dopo la build** non serve ricompilare: si modifica `dist/content/texts.json` e si ricarica il browser.
- Le chiavi sono organizzate per sezione: `ui`, `movement`, `celeste`, `sunset`, `virentia`, `epilogue`. Ogni tappa ha `title`, `body`, `poem` e, se interattiva, `action`.

### Configurazione: `content/config.json` (anche `dist/content/config.json`)

| Chiave | Cosa regola |
|---|---|
| `cta.text`, `cta.qr.url` | **Testo e QR dell'epilogo (ora segnaposto: da sostituire)**. `cta.enabled: false` li nasconde |
| `kiosk.idleResetSeconds`, `kiosk.attractAfterSeconds`, `kiosk.hintSeconds` | Tempi della modalità fiera |
| `kiosk.controller` | `true`: i suggerimenti mostrano i pulsanti del controller già dal menu (in fiera si gioca con quello) |
| `intro.video`, `intro.videoBrightness` | Film di sfondo della schermata iniziale: percorso e luminosità (1 = il film così com'è, 0,9 = appena attenuato). Se il video manca o non parte, compare l'orologio "che respira" |
| `audio.volume`, `audio.startMuted` | Volume generale e avvio in muto |
| `audio.piano` | Volume della melodia di pianoforte rispetto al resto della musica (1 = come tarato, 0 = spento) |
| `language.default` | Lingua iniziale (`it` o `en`) |
| `quality.level` | `auto` (consigliato: parte da medium e sale fino a ultra se la scheda video regge i 60 fps), oppure fisso `low`, `medium`, `high`, `ultra` (vedi §8, Grafica). Sul PC della fiera, se ha una scheda video dedicata, si può fissare `ultra` |
| `cards` | Foto reali mostrate nella "lente" di ogni tappa (stringa vuota = nessuna foto) |
| `assets` | Logo, orologi scontornati, quadranti, texture dell'agata, modelli 3D |

### Immagini e video

Le foto originali restano in `Branding/` e `Modelli/` e non vengono mai modificate. Le versioni usate dal sito stanno in `public/assets/` (WebP compressi, max 2048 px).

- **Sostituzione rapida**: mettere un nuovo file con **lo stesso nome** in `public/assets/...`, oppure in `dist/assets/...` se la build è già fatta. In alternativa, cambiare il percorso in `config.json`.
- **Rigenerazione dalle foto originali**: modificare sorgente o ritaglio in `scripts/assets-manifest.mjs`, poi:

  ```bash
  npm run assets
  ```

  Rielabora solo ciò che è cambiato. Con `npm run assets -- --force` rifà tutto. Per rigenerare il video serve `ffmpeg` installato.
- **Video della schermata iniziale**: dal film `CELESTE INTRO_ORIZ.mp4` (4K) si usano i secondi 0–5,85, prima del logo finale, senza audio, a 2560×1440 ad alta qualità (circa 13 MB): nitido su proiettori Full HD e schermi 4K. Il browser lo mostra come video nativo dietro al menu, senza filtri né sfocature. Taglio, risoluzione e qualità si cambiano in `scripts/assets-manifest.mjs` → `VIDEOS`, poi:

  ```bash
  npm run assets -- --video
  ```

  Per usare un altro film senza rielaborarlo basta indicarne il percorso in `config.json` → `intro.video` (MP4 H.264, senza audio).

L'inventario completo (cosa mostra ogni file, dove è usato, cosa è inutilizzato) è in `ASSETS.md`.

## 7. Struttura

```
content/            testi e configurazione (modificabili senza toccare il codice)
public/assets/      immagini, video, font del logo, SVG (generati da `npm run assets`)
scripts/            pipeline asset, server offline per la fiera, trailer
src/core/           App, regia, input, giocatore, audio, hotspot, narratore, modalità fiera
src/gfx/            renderer e post-processing (riflessi in ray tracing, occlusione, ombre,
                    profondità di campo), modelli 3D degli orologi, materiali e finiture
                    orologiere, ingranaggi, bracciale, cieli, agata, particelle
src/mech/           cinematica del calibro (bilanciere 4 Hz, ancora, scappamento, rodaggio)
src/worlds/         Intro, Movimento (+ hub dei portali), Celeste, Sunset, Virentia, Epilogo
src/ui/, src/styles/ overlay (menu, sottotitoli, card, pausa, epilogo)
```

Architettura: `ARCHITECTURE.md`.

## 8. Note tecniche

- **Il calibro**: rodaggio con rapporti coerenti (bariletto 72/12, centrale 80/10, terza 75/10, quarta 96/6). La ruota centrale fa 1 giro all'ora, la quarta 1 al minuto, la ruota di scappamento (15 denti) 16 giri al minuto a 4 Hz. Gli ingranaggi ingranano davvero e girano nel verso giusto visti dal fondello. Tick audio, ancora e ruota di scappamento sono sincronizzati sugli stessi eventi: 8 alternanze al secondo. Rallentatore e time-lapse agiscono su un unico "tempo meccanico".
- **Orologi 3D**: sono i modelli GLB ricostruiti sulle quote dei disegni tecnici (`Modelli/3D`, vedi `ASSETS.md` §8). Ogni livello ha il suo monolite, l'orologio completo e gigante: nel movimento le tre Delta nel vuoto alle spalle della partenza (si vedono per prime, poi lo sguardo va alla corona); Celeste in fondo al ponte di maglie; Sunset nell'abside della cattedrale, con i quattro Sunset della tappa degli indici attorno; Virentia in fondo alla radura, sotto il rotore-sole (la porta della foresta è la lunetta del modello). Anche l'epilogo usa i modelli. Lancette sull'ora reale; i secondi avanzano a scatti di 1/8 di secondo.
- **Rotore 3D**: è il modello `Modelli/3D/rotore.glb` (oro rosa IP satinato circolare, incisioni del fondello): nel movimento oscilla sopra i ponti, in Virentia è il sole sopra la radura e si accende con la carica (vedi `ASSETS.md` §8b).
- **Sunset**: le pareti hanno venature generate a ogni visita. Nei tre Sunset "varianti" della cattedrale la pietra è quella vera del quadrante, ripulita dalle scritte e vista da un altro taglio (ruotata, specchiata, ingrandita), diverso a ogni visita: stampe e minuteria restano al loro posto.
- **Sicurezza visiva**: nessun lampeggio rapido (le pulsazioni di luce stanno sotto 0,5 Hz).
- **Grafica**: riflessi in tempo reale con ray tracing nello spazio dello schermo (i raggi riflessi avanzano nel buffer di profondità: pavimenti lucidi e acciaio riflettono davvero orologi, pareti e ingranaggi), occlusione ambientale a raggi (N8AO), ombre del sole in tempo reale, profondità di campo da macro con fuoco automatico su ciò che si guarda, antialiasing SMAA, studio fotografico neutro come luce d'ambiente degli orologi. Il ray tracing hardware delle schede RTX non è accessibile dai browser (né WebGL né WebGPU): queste tecniche sono l'equivalente in tempo reale per il web.
- **Qualità adattiva**: in automatico parte da "medium" e sale o scende in base agli fps, per mantenere i 60 fps. Un livello abbandonato perché lento non si riprova per 45 secondi.

  | Livello | Risoluzione | Occlusione | Riflessi | Ombre | Profondità di campo |
  |---|---|---|---|---|---|
  | low | 0,75× | no | no | 1024 px | no |
  | medium | 1× | mezza ris. | mezza ris., 40 passi | 2048 px | no |
  | high | 1× | mezza ris. | piena, 80 passi | 2048 px | sì |
  | ultra | 1,5× | piena | piena, 96 passi | 4096 px | sì |

  Su una scheda video recente in 1080p un fotogramma costa circa 2 ms in high e 5 ms in ultra (misurati in sviluppo).

### Parametri di verifica (solo per lo sviluppo)

`?debug` espone gli strumenti in console (`walkDebug()` mostra in verde le aree calpestabili e gli ostacoli del mondo corrente; `shot('nome')`, solo con `npm run dev`, salva una cattura del canvas nella cartella temporanea di sistema `monichs-shots`). `?world=celeste` (o `movement`, `sunset`, `virentia`, `epilogue`) salta direttamente a un mondo. `?nolock` gioca senza pointer lock, con il mouse libero: si guarda trascinando. `?noidle` disattiva la modalità fiera. `?quality=low` forza la qualità. `?lang=en` imposta la lingua.

## 9. TODO aperti (da chiarire con il brand)

1. **Riserva di carica**: non indicata (nei documenti compaiono 38 h e 65 h). Segnaposto nel codice: `src/worlds/MovementWorld.js` (TODO in testa al file).
2. **CTA e QR dell'epilogo**: segnaposto in `content/config.json` (`https://example.com/...`). Da sostituire prima della fiera. Non sono stati inseriti prezzi né date.
3. **Calibro**: nella foto del fondello aperto (Virentia, `Vi (4)`) si legge inciso "SW200-1", mentre i testi dicono SW200-2 Élaboré, come da brief.
4. **Oro rosa (Virentia)**: confermare se lunetta e maglie centrali sono in oro massiccio o trattate. Il testo dice "in oro rosa", come nel brief.
5. **Finitura del rotore**: le foto mostrano una lavorazione circolare. Il testo parla di Côtes de Genève, come nel brief: confermare la dicitura.
6. **Colore Celeste**: il brief dice "azzurro polvere"; nelle foto il blu è intenso. I testi seguono il brief.
7. **Super-LumiNova**: usata la grafia ufficiale del marchio, il brief scrive "SuperLuminova".
8. **Confronto 1.200 HV**: il valore di circa 200 HV per il 316L non trattato è un riferimento generale di letteratura. Verificarlo con il fornitore se si vuole citarlo.
9. **Prove finali**: provare sul PC e sul proiettore della fiera (prestazioni, volume) e su Safari.
