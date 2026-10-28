# INSIDE MONICHS

Esperienza 3D in prima persona nel browser: un viaggio onirico dentro il calibro SW200-2 Élaboré
e nei tre mondi della Collezione Delta — Celeste (M-001), Sunset (M-002), Virentia (M-003) — che si
chiude nel laboratorio Monichs, sul banco, con Giovanni e Filippo che raccontano come è nato Monichs.
Pensata per la fiera: modalità attrazione, reset automatico, funzionamento offline.

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

Il materiale di terzi (la tavola 4029 e le maschere ricavate dalle tavole del fornitore della cassa, il font Foslin del brand) è nel repository dal 20 ottobre 2026: Giovanni ha i permessi per pubblicarlo.

## 2. Build

```bash
npm run build
```

Crea la cartella `dist/` (circa 18 MB, di cui 13 MB il film della schermata iniziale): contiene tutto, font, immagini e video compresi. Non servono connessione né CDN.

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

Un video di 45 s in 16:9 (1920×1080, 30 fps), lento, che presenta l'esperienza senza il laboratorio: le tre Delta, la corona, gli ingranaggi, Celeste dal giorno alla notte, Sunset, Virentia e il cartello "INSIDE MONICHS · An interactive experience, at your own pace · Unlocks at $50,000 · Free for every backer". Al centro, in Montserrat ExtraBold, cinque frasi lunghe sullo schermo dicono che cosa si fa nell'esperienza, con le azioni vere del gioco ("Become small. Explore Monichs from the inside.", "Wind the crown and walk inside the movement.", "Let evening fall and watch the indices glow.", "Discover why no two dials are alike.", "Wind the rotor and wake the forest."). Esce in inglese e in italiano.

```bash
npm run dev        # in un altro terminale
npm run trailer    # riprese, musica, titoli e montaggio: trailer/Inside-Monichs-Trailer-EN.mp4 e -IT.mp4
```

Le riprese vengono dal gioco, guidato fotogramma per fotogramma in Chrome senza finestra (qualità ultra, 2880×1620 ridotto a 1080p); la musica è un pianoforte a feltro sintetizzato sul motivo 6-3-2-1, a 60 BPM, con i cambi d'armonia sui tagli. Piani e camere sono in `scripts/trailer/shots.mjs`, frasi in `scripts/trailer/titles.mjs` (i tempi in `edit.mjs`), partitura in `scripts/trailer/music.mjs`; per rifare solo una parte: `npm run trailer -- musica montaggio` (o `riprese --piani=D,E`). Servono ffmpeg, Google Chrome e Playwright (dettagli in testa a `scripts/trailer.mjs`). La cartella `trailer/` resta fuori dal repository.

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
| **Saltare il racconto** (laboratorio) | **tenere premuto** Spazio o il mouse per 1,5 s (compare dopo circa 10 s): si va alla quarta parete, e da lì all'epilogo | tenere premuto A |

**Controller.**
- **Modelli.** Va bene qualunque controller con la mappatura standard del browser (Xbox, PlayStation, la maggior parte degli altri): si collega al PC prima di aprire Chrome.
- **Suggerimenti a schermo.** Mostrano i pulsanti del controller in uso, con le lettere dell'Xbox o i simboli del PlayStation, e tornano ai tasti appena si usa la tastiera. Con `kiosk.controller` (in `content/config.json`) li mostrano già dal menu, prima che qualcuno tocchi il controller: Chrome lo vede solo dopo la prima pressione.
- **Vibrazione.** È leggera: a ogni scatto della corona e del rotore, e quando l'orologio riparte.
- **Pausa.** Col controller non serve agganciare il mouse, e la pausa si apre solo con Menu.

Esc libera il mouse e mette in pausa ("Il tempo è sospeso"). Lo stesso accade se si cambia scheda o finestra (Alt+Tab, notifiche): al ritorno la pausa è già a schermo e un clic, Spazio o Invio riagganciano il mouse.

**Si cammina, non si vola.** Il visitatore è piccolo e cammina sui pavimenti dei mondi; guardare in alto o in basso non lo solleva. Ingranaggi, pareti, tronchi e oggetti non si attraversano e dai bordi non si cade:

- **Il movimento**: una passerella in vetro zaffiro (si vedono le ruote sotto i piedi) che entra nella cassa dal tubo della corona, passa accanto al rotore, a un balcone sopra il bariletto, sopra il rodaggio e lo scappamento e gira attorno al bilanciere. Un ascensore (un disco che sale quando ci si ferma sopra) porta sulla piattaforma sopra il bilanciere, sotto il rotore: lì ci sono i tre portali. Si torna giù allo stesso modo.
- **La corona**: all'inizio l'orologio è fermo e la passerella si interrompe davanti alla corona. Tenendo premuto si carica (la corona gira, la minuteria di luce si riempie in circa 3,5 secondi, si sentono gli scatti del cricchetto). Carica, il bilanciere riparte, il tic ricomincia, un ponte si distende fino alla corona, che si dissolve: si entra. Se nessuno la carica, dopo 30 secondi davanti alla corona si carica da sola (in fiera nessuno resta bloccato).
- **Il laboratorio**: si arriva in piedi sullo zaffiro del fondello della Virentia, coricata sul banco, e si scende lungo il suo bracciale aperto fino al tappetino. Si cammina sul tappetino e sui fogli (il disegno tecnico è una piazza); sui bracciali di Celeste e Sunset si può salire fino al vetro, sopra il quadrante. Le casse sono muri, gli attrezzi ostacoli, dal bordo del tappetino non si cade. Intorno al banco c'è l'atelier vero, a misura d'uomo: pavimento di rovere, due finestre alte sul lago al tramonto alle spalle dei fondatori, libreria, cassettiera da orologiaio, banco laterale con il microscopio, porta e vetrina; il banco ha le gambe fino al pavimento.
- **Celeste**: la terrazza e il ponte di maglie del bracciale. **Sunset**: il fondo del canyon d'agata e la cattedrale; il blocco d'agata è un ostacolo. **Virentia**: un bosco incantato (alberi, felci, fiori e rocce modellati in Blender) su un prato di muschio pettinato a onde di Côtes de Genève; tronchi, rocce, tronchi caduti, la vite caduta e la molla della radura sono ostacoli; la porta è la lunetta in oro rosa con dentro il rotore, e ci si passa in mezzo, sotto il mozzo.

## 5. Modalità fiera

- **Attrazione**: dopo 25 s di inattività sulla schermata iniziale parte un loop: il film Celeste alternato a inquadrature dei mondi. Qualsiasi tasto o movimento riporta al menu.
- **Audio**: nel menu, nell'attrazione e nell'epilogo c'è solo l'ambiente sonoro. Il tic dell'orologio (8 alternanze al secondo) si sente solo dentro i livelli: movimento, Celeste, Sunset, Virentia e il laboratorio, dove ticchetta piano la Virentia sul banco e si ferma prima della quarta parete.
  - **Timbro.** Il tic è morbido e scuro (niente brillantezza oltre 5–6 kHz) e sta sotto la musica.
  - **Abitudine.** Entrando in un mondo si sente bene, poi in circa 13 s scende a fare da sfondo, come un orologio vero che dopo un po' non si nota più. Risale avvicinandosi alla sorgente.
  - **Voci.** Mentre parlano i fondatori il tic si abbassa ancora.
  - **Pianoforte.** Sopra l'ambiente di ogni mondo, menu ed epilogo compresi, suona una melodia di pianoforte molto leggera. È un pianoforte "felt", con i martelletti coperti di feltro, sintetizzato nel browser. Suona poche note lente, in frasi brevi separate da lunghi silenzi, nella tonalità del mondo. La prima frase è sempre il motivo di Monichs, una discesa che si posa. Nel laboratorio è più rada e più bassa e aspetta che i fondatori finiscano di parlare. Per far posto al pianoforte, l'ambiente è stato riequilibrato: pad più morbidi e meno note sparse. Il volume si regola in `config.json` → `audio.piano`.
- **Voci del laboratorio**: le voci sono in italiano; in inglese sono doppiate. Sono le voci di Giovanni e Filippo, clonate dalle loro registrazioni (due vocali di circa 30 s) e fatte recitare da ElevenLabs v3 con una regia battuta per battuta: un'emozione per ogni battuta (calore, gioco, orgoglio, sorpresa), punti esclamativi per l'energia e puntini di sospensione per le pause, con "Montre" detto alla francese. Il testo esatto dato alla sintesi è in `scripts/lab-voices-regia.json`. Una clip per battuta, in `public/assets/audio/lab/it/` (originali) e `public/assets/audio/lab/en/` (doppiaggio), con il nome della chiave (`g1.mp3`, `f1.mp3`…; istruzioni in `LEGGIMI.txt`), tutte allo stesso livello (-16 LUFS). Ogni battuta parla nella lingua scelta quando comincia e dura quanto la sua clip; cambiando lingua a metà battuta cambiano subito i sottotitoli, la voce finisce la battuta. Il silenzio fra le battute si regola in `content/lab.json` (`gap` per battuta, più corto nei botta e risposta; `pause` a fine capitolo). Se una clip manca, in inglese si sente la voce italiana con i sottotitoli in inglese; senza nessuna clip torna il borbottio segnaposto (sillabe senza parole, due timbri). Per sostituirle, per esempio con battute registrate davvero, basta una registrazione per battuta e `npm run voci -- <cartella> it` (o `en`), che le pulisce, le porta allo stesso livello e le mette al loro posto; dopo la build si possono copiare direttamente in `dist/assets/audio/lab/`. Non serve toccare il codice.
- **Reset automatico**: dopo 60 s senza input durante il viaggio o nell'epilogo si torna alla schermata iniziale. Mentre i fondatori raccontano il reset è sospeso; in pausa e dal cartello finale torna normale.
- **Browser senza pointer lock**: alcuni browser non lasciano mai agganciare il mouse (per esempio il browser integrato dell'app Claude). Lì il gioco non resta in pausa: passa al mouse libero, si guarda trascinando sulla scena e un clic interagisce. Tenere premuto senza muovere il mouse resta "tieni premuto". Al ritorno al menu riprova ad agganciare il mouse. In fiera si usa Chrome, che il mouse lo aggancia.
- **Durata**: circa 10–12 minuti per il percorso completo, di cui circa 3 minuti di laboratorio (con le voci: 2:36 in italiano e in inglese, dall'arrivo all'epilogo). Dal menu si può saltare a un capitolo (Il movimento, Celeste, Sunset, Virentia, Il laboratorio).
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
- Le chiavi sono organizzate per sezione: `ui`, `movement`, `celeste`, `sunset`, `virentia`, `lab`, `epilogue`. Ogni tappa ha `title`, `body`, `poem` e, se interattiva, `action`.
- **La regia del laboratorio** è in **`content/lab.json`** (anche `dist/content/lab.json`): le battute in ordine, con chi parla, l'oggetto che si accende (`highlight`), gli eventi (`tickStop`, `lookUp`, `grow`, `thanks`), i gesti e le pause; in `timing` la velocità del parlato e le durate di arrivo, crescita, bianco e cartello. Si riordina e si ritima senza toccare il codice (il copione approvato è in `docs/specs/2026-10-07-laboratorio.md`).

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
| `assets` | Logo, orologi scontornati, quadranti, texture dell'agata, modelli 3D; per il laboratorio i fogli (`lab.drawing`, `lab.case4029`, `lab.sketch`), la cartella delle voci (`lab.voices`) e i modelli dei fondatori (`model.founder.giovanni`, `model.founder.filippo`): finché i file non ci sono, dietro il banco compaiono due presenze di luce, senza volto |

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
- **Fogli del laboratorio**: il disegno tecnico (`MNC_T_Draw_Print.pdf`, pagina 1) e la tavola della cassa 4029 (pagina 1, solo l'area dei disegni) si rasterizzano dai PDF sul Desktop con `pdftoppm` (Poppler, in Git Bash): `scripts/assets-manifest.mjs` → `PDFS`, poi `npm run assets -- --force`.
- **Voci del laboratorio**: da una cartella con una registrazione per battuta (`g1.wav`, `f1.wav`… `both1.wav`, oppure `both1_g` + `both1_f` da sovrapporre; vanno bene anche mp3, m4a, flac):

  ```bash
  npm run voci -- <cartella> it
  ```

  (`en` per il doppiaggio). Toglie i silenzi, porta tutto a -16 LUFS, aggiunge dissolvenze brevi e scrive gli mp3 in `public/assets/audio/lab/<lingua>/`; serve `ffmpeg`. `--tempo=g:0.92` rallenta (o accelera) le battute di una voce senza cambiarne timbro e altezza. Con la sintesi ElevenLabs, che a volte tronca l'ultima sillaba, si fa generare ogni battuta seguita da una riga vuota e da una parola in più ("Ecco." / "Okay.") e si aggiunge `--tail`: lo script toglie quella parola (così sono fatte le clip di oggi; il testo di ogni battuta è in `scripts/lab-voices-regia.json`).

L'inventario completo (cosa mostra ogni file, dove è usato, cosa è inutilizzato) è in `ASSETS.md`.

## 7. Struttura

```
content/            testi e configurazione (modificabili senza toccare il codice)
public/assets/      immagini, video, font del logo, SVG (generati da `npm run assets`)
scripts/            pipeline asset, voci del laboratorio, server offline per la fiera, trailer
src/core/           App, regia, input, giocatore, audio, hotspot, narratore, modalità fiera
src/gfx/            renderer e post-processing (riflessi in ray tracing, occlusione, ombre,
                    profondità di campo), modelli 3D degli orologi, materiali e finiture
                    orologiere, ingranaggi, bracciale, cieli, agata, particelle
src/mech/           cinematica del calibro (bilanciere 4 Hz, ancora, scappamento, rodaggio)
src/worlds/         Intro, Movimento (+ hub dei portali), Celeste, Sunset, Virentia, Laboratorio
                    (+ worlds/lab/: banco e oggetti, fondatori, regia del racconto), Epilogo
src/ui/, src/styles/ overlay (menu, sottotitoli, card, pausa, epilogo)
```

Architettura: `ARCHITECTURE.md`.

## 8. Note tecniche

- **Il calibro**: rodaggio con rapporti coerenti (bariletto 72/12, centrale 80/10, terza 75/10, quarta 96/6). La ruota centrale fa 1 giro all'ora, la quarta 1 al minuto, la ruota di scappamento (15 denti) 16 giri al minuto a 4 Hz. Gli ingranaggi ingranano davvero e girano nel verso giusto visti dal fondello. Tick audio, ancora e ruota di scappamento sono sincronizzati sugli stessi eventi: 8 alternanze al secondo. Rallentatore e time-lapse agiscono su un unico "tempo meccanico".
- **Orologi 3D**: sono i modelli GLB ricostruiti sulle quote dei disegni tecnici (`Modelli/3D`, vedi `ASSETS.md` §8). Ogni livello ha il suo monolite, l'orologio completo e gigante: nel movimento le tre Delta nel vuoto alle spalle della partenza (si vedono per prime, poi lo sguardo va alla corona); Celeste in fondo al ponte di maglie; Sunset nell'abside della cattedrale, con i quattro Sunset della tappa degli indici attorno; Virentia in fondo alla radura, sotto il rotore-sole (la porta della foresta è la lunetta del modello). Anche l'epilogo usa i modelli. Lancette sull'ora reale; i secondi avanzano a scatti di 1/8 di secondo.
- **Rotore 3D**: è il modello `Modelli/3D/rotore.glb` (oro rosa IP satinato circolare, incisioni del fondello): nel movimento oscilla sopra i ponti, in Virentia è il sole sopra la radura e si accende con la carica (vedi `ASSETS.md` §8b).
- **Sunset**: le pareti hanno venature generate a ogni visita. Nei tre Sunset "varianti" della cattedrale la pietra è quella vera del quadrante, ripulita dalle scritte e vista da un altro taglio (ruotata, specchiata, ingrandita), diverso a ogni visita: stampe e minuteria restano al loro posto.
- **Il laboratorio**: il banco è a scala reale, 0,25 unità per millimetro (il visitatore, con gli occhi a 3,2 unità, è alto poco più di un centimetro). I tre orologi sono i modelli GLB con il bracciale aperto e disteso sul banco, maglia per maglia, come nel disegno tecnico (`gfx/braceletFlat.js`); la Virentia è coricata sul quadrante con il fondello aperto (movimento e rotore della foto Vi 4 sotto lo zaffiro). Alla fine "torna grande": la camera sale in 4,2 s fino all'altezza degli occhi dei fondatori, a un metro da loro, e la profondità di campo si apre sui volti.
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

`?debug` espone gli strumenti in console (`walkDebug()` mostra in verde le aree calpestabili e gli ostacoli del mondo corrente; `shot('nome')`, solo con `npm run dev`, salva una cattura del canvas nella cartella temporanea di sistema `monichs-shots`). `?world=celeste` (o `movement`, `sunset`, `virentia`, `lab`, `epilogue`) salta direttamente a un mondo. `?debug&founders=Modelli/3D/fondatori/` carica i modelli dei fondatori da quella cartella, per provarli in locale prima di copiarli in `public/` (solo con `?debug`; nella build della fiera la cartella non c'è). `?nolock` gioca senza pointer lock, con il mouse libero: si guarda trascinando. `?noidle` disattiva la modalità fiera. `?quality=low` forza la qualità. `?lang=en` imposta la lingua.

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
10. **Voci del laboratorio**: clonate dalle voci di Giovanni e Filippo e recitate con una regia (vedi §5): da ascoltare e approvare, in particolare "Monichs", "Montre" (detto alla francese) e "Kickstarter". Per cambiare l'interpretazione di una battuta basta modificarne il testo in `scripts/lab-voices-regia.json` (tag d'emozione, punteggiatura) e rigenerarla. Con registrazioni più lunghe (1–2 minuti a testa, in una stanza silenziosa, non un vocale compresso) il clone somiglierebbe di più; `npm run voci` prepara anche battute registrate davvero (§6).
11. **Fondatori in 3D**: i modelli `founder-giovanni.glb` e `founder-filippo.glb` sono in preparazione (contratto in `docs/specs/2026-10-07-laboratorio.md` §4). Per la fedeltà servono altre foto di entrambi: fronte, profili, nuca, tre quarti dall'alto e le mani appoggiate su un tavolo. Finché i file non ci sono, il laboratorio usa due presenze di luce senza volto.
12. **Tavola 4029 sul banco**: è un documento del fornitore della cassa (Asia Leader Industrial), con la nota "All rights reserved… no part may be reproduced without written permission". Nel gioco si vede solo l'area dei disegni, senza intestazione né cartiglio; confermare che la si possa mostrare in pubblico (in alternativa basta indicare in `config.json` → `lab.case4029` un'altra tavola di `MNC_T_Draw_Print.pdf`).
13. **Celeste e Sunset sul banco**: sono a quadrante in su con il bracciale aperto e disteso (il GLB ha il bracciale chiuso ad anello: coricato attraverserebbe il tappetino). Aperto misura 172 mm contro i 222 mm del disegno, perché il modello ha meno maglie amovibili (taglia di un polso medio).
