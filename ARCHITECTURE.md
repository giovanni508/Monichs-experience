# INSIDE MONICHS — Architettura

## Stack
- **Vite** (dev server + build statica, nessun backend) · **Three.js r186** · **postprocessing** (pmndrs: bloom mipmap, profondità di campo, SMAA, vignettatura, grana, tone mapping Khronos PBR Neutral) · **n8ao** (occlusione ambientale) · **qrcode** (QR generato a runtime dall'URL in `config.json`).
- Font: Foslin (font del logo, dal pacchetto brand, solo testi senza accenti) + Montserrat (corporate, `@fontsource`) + Cormorant Garamond corsivo per le frasi poetiche (`@fontsource`). Tutto impacchettato nella build → funziona offline.
- Audio: Web Audio API, interamente procedurale (nessun file audio).
- Asset: `npm run assets` (Node + `sharp`) ritaglia/ridimensiona/comprime le foto originali in WebP dentro `public/assets/`. Le cartelle `Branding/` e `Modelli/` non vengono mai toccate.

## Struttura
```
content/                 ← modificabili senza toccare il codice (anche dopo la build: dist/content/)
  texts.json             tutti i testi IT/EN (ogni foglia è { "it": "...", "en": "..." })
  config.json            CTA + QR, tempi modalità fiera, mappa immagini, volume, qualità
public/assets/           immagini derivate (WebP), font Foslin, logo SVG
scripts/
  build-assets.mjs       pipeline immagini (sharp)  ·  assets-manifest.mjs = cosa si ritaglia e da dove
  serve-dist.mjs         server statico senza dipendenze per la fiera (offline); risponde anche a
                         assets/index.json rileggendo la cartella a ogni richiesta
src/
  main.js                avvio
  core/                  App (loop), Director (flusso), Kiosk (attract/reset/fullscreen), Input (tastiera,
                         mouse, pointer lock, gamepad), Player (camera onirica), Hotspots, Narrator, Audio,
                         I18n, Content (caricamento JSON)
  gfx/                   Renderer + post (ssr.js riflessi in ray tracing, shadows.js ombre del sole),
                         env map, watchModel.js (modelli GLB degli orologi e del rotore), nature.js (alberi e piante in instancing), materiali (acciaio satinato/
                         lucido, oro rosa, rubino, laccatura), texture procedurali (perlage, Côtes de
                         Genève, guilloché), ingranaggi procedurali, particelle, raggi di luce, cielo
  mech/                  cinematica del calibro (bilanciere 4 Hz, ancora, scappamento, rodaggio)
  worlds/                IntroWorld · MovementWorld (Parte 1 + hub dei portali) · CelesteWorld ·
                         SunsetWorld · VirentiaWorld · EpilogueWorld   (stessa interfaccia World)
  ui/                    overlay DOM: schermata iniziale, sottotitoli, card hotspot, indicatore percorso,
                         pausa, epilogo
```

## Mondi e flusso
`START (menu) ⇄ ATTRACT (loop) → MOVEMENT (le tre Delta come monoliti, corona da caricare + 7 tappe) → HUB (piattaforma sopra il bilanciere, 3 portali, ordine libero) → CELESTE / SUNSET / VIRENTIA → HUB → luce al centro del bilanciere → EPILOGO → START`
- Ogni mondo implementa `load() · enter() · update(dt) · exit()`, espone `hotspots`, `walk` (spazio calpestabile, vedi sotto), `eyeHeight`, `spawn`, `audioPalette`, `post` (bloom/esposizione), `attractShots` (inquadrature per il loop di attrazione).
- **Hotspot comune**: avvicinamento → il componente si illumina (rim-light nel materiale) → card con titolo, 2–3 frasi tecniche, frase poetica, foto reale facoltativa → Spazio/click per l'azione della tappa (es. rallentare il tempo).
- **Tempo meccanico**: un unico `mechTime` guida bilanciere, ancora, scappamento e rodaggio con rapporti coerenti; il tick audio è schedulato sugli eventi dello scappamento (8 alternanze/s a velocità reale). Rallentatore e "time-lapse" cambiano solo la scala del tempo. Il tick si sente solo nei livelli (`tickEnabled` del mondo): tace nel menu, nell'attrazione e nell'epilogo.
  - **Tic morbido (`core/Audio.js`).** Il suono è sintetizzato con poco rumore d'urto, parziali acute deboli e più corpo. Livelli e taglio dei bassi per mondo sono in `TICK_TIMBRES`: sta sotto la musica, scuro, e un po' nel riverbero.
  - **Abitudine (`tickAttention`).** Entrando in un mondo, o quando l'orologio riparte, vale 1; poi scende a `TICK_REST` (0,45) in circa 13 s e risale quando la presenza cresce (ci si avvicina alla sorgente).
  - **Misura.** Vicino al bilanciere i picchi erano a −5 dBFS, 12 dB sopra la musica: ora sono a −13 dBFS entrando e a −19 dBFS a regime, alla pari della musica.
- **Musica (`core/Audio.js` → `buildPalette`)**: ogni mondo ha un ambiente procedurale (drone, pad con un filtro che respira, letti di rumore, eventi sparsi) e, sopra, un pianoforte.
  - **Il suono.** `feltPiano()` sintetizza una nota di pianoforte con i martelletti di feltro.
    - Parziali appena inarmoniche, come in una corda vera.
    - Due corde scordate di un capello nelle tre parziali basse, dove il battimento si sente.
    - Il tonfo del martelletto e un passa-basso che si chiude dopo l'attacco.
    - Una coda più lunga nei bassi.
    - Le parziali sopra il filtro non si generano: circa 11 oscillatori per nota, perché in fiera la CPU serve alla grafica.
  - **La melodia.** `piano({ root, scale, low, high, bpm, gain, rest })` suona le frasi di `PIANO_PHRASES`.
    - Le frasi sono gradi della pentatonica del mondo: maggiore, minore in Virentia.
    - La prima è sempre il motivo 6-3-2-1, una discesa che si posa.
    - Ogni frase si sposta di ottava tutta insieme per stare nel registro `low–high`, così il profilo resta quello.
    - Sotto l'inizio della frase c'è a volte una nota grave; dopo la fine, a volte, un'eco all'ottava.
    - Fra una frase e l'altra passano 5–12 s di silenzio.
  - **Quando aspetta.** La frase non parte durante il "respiro di silenzio" di Celeste (`musicBus` sotto 0,4).
  - **Taratura.** Misurata con un rendering offline di ogni mondo (OfflineAudioContext, 2–3 semi da 75 s, pesatura A, finestre da 400 ms).
    - Nel 90° percentile la frase sta 6–7 dB sotto l'ambiente e solo negli attacchi lo raggiunge; poi la coda ci si perde dentro.
    - Per fargli posto, i pad sono più morbidi (−1,4 dB, filtro −12%).
    - In Celeste e nell'epilogo i pad del registro medio-alto sono scesi di 2,5–3,5 dB.
    - Scintille, campane, glissandi e pizzicati sono più radi e più bassi.
  - **Volume.** `config.audio.piano` moltiplica il volume del pianoforte; con 0 il pianoforte non parte affatto.
- **Schermata iniziale**: il film è un elemento `<video>` nativo tra il canvas e il menu (decodifica hardware, risoluzione piena, nessun post-processing). Mentre copre lo schermo, la scena 3D non viene disegnata.
- **Pausa e mouse**: lo stato del pointer lock è letto dal browser a ogni fotogramma (non da un flag in memoria). Se il mouse viene rilasciato (Esc, cambio scheda, Alt+Tab) compare "Il tempo è sospeso"; un clic, Spazio o Invio lo riagganciano.
  - **Mouse libero.** Alcuni browser rifiutano sempre il pointer lock, per esempio il browser integrato dell'app Claude: la richiesta fallisce con `WrongDocumentError` anche durante un clic, con la pagina visibile e attiva. Lì `Input.setFree()` passa al mouse libero, come con `?nolock`.
  - **Come si gioca senza aggancio.** Niente pausa. Si guarda trascinando sulla scena (`press.onScene`). Il tasto premuto fermo resta `actionHeld`; oltre 8 px è uno sguardo (`dragged`). Il clic interagisce al rilascio.
  - **Quanto dura.** Gli altri rifiuti (manca il gesto, Esc appena premuto) sono passeggeri e lasciano la pausa. Il mouse libero scelto da solo vale una visita: `Director.showStart` chiama `App.resetFreeLook()` e si riprova l'aggancio.
- **Controller (`core/Input.js`, `core/App.js`, `ui/UI.js`)**: in fiera si gioca con quello (mappatura standard del browser).
  - **Input.** `pollGamepad` legge levette e pulsanti a ogni fotogramma e riconosce il tipo dal nome (Sony: PlayStation; il resto: Xbox).
    - Emette `padbutton` alla pressione e `padnav` (su/giù/sinistra/destra) dalla croce o dalla levetta sinistra, con ripetizione tenendo premuto.
    - Tiene `device`, l'ultimo dispositivo usato (`kbm` o `pad`): l'interfaccia cambia i suggerimenti quando cambia.
    - La croce muove anche il visitatore. `rumble()` fa vibrare piano il controller, se lo supporta.
  - **App.** Nel menu la croce sceglie e A conferma (`UI.movePadFocus`/`activatePadFocus`: il pulsante più vicino nella direzione).
    - In gioco Menu apre la pausa (`padPaused`): lì A conferma la scelta, B o Menu riprendono.
    - View e Menu tenuti insieme per 2 s riportano alla schermata iniziale, per lo staff.
  - **UI.** Legende, scheda dei punti d'interesse, pausa e invito dell'attrazione mostrano i pulsanti del controller (`padLabel`, `padLegendHTML`); la scelta corrente ha l'aspetto del passaggio del mouse (`.pad-focus`, solo con `body.input-pad`).
    - `config.kiosk.controller` attiva questi suggerimenti già all'avvio.
  - **Mondi.** Gli inviti a caricare corona e rotore hanno la versione col pulsante (`windPromptPad`, con `{A}`), e il rotore di Virentia si carica con l'una o l'altra levetta.
- **A piedi (`core/WalkArea.js` + `core/Player.js`)**: ogni mondo ha uno spazio calpestabile nel piano XZ: *regioni* (corridoi lungo polilinee con pavimento e semilarghezza per punto, dischi con fori, pavimenti a funzione come le onde di Virentia) e *ostacoli* (cerchi, capsule, rettangoli con un intervallo di altezze). A ogni passo il corpo (raggio, altezza) viene spinto fuori dagli ostacoli e riportato dentro la regione più vicina *al proprio livello* (pavimento entro 1,6 unità dai piedi): così una passerella che passa sotto una piattaforma non si confonde con essa e l'ascensore (un disco con altezza variabile) porta da un livello all'altro. Il giocatore ha occhi a 2,2 (movimento) – 3,6 (Virentia) unità dal pavimento; la velocità perde la componente contro i bordi, quindi si scivola lungo pareti e ringhiere. Regioni e ostacoli si possono accendere e spegnere (il tubo della corona si apre solo dopo la carica).
- **Passerelle (`worlds/movement/walkway.js`)**: costruite dalla stessa polilinea della regione calpestabile: vetro zaffiro con riflesso di Fresnel, longheroni lucidi, corrimano in oro rosa, filetti di luce con un uniform di "rivelazione" lungo il percorso.
- **Indice degli asset** (`assets/index.json`): servito al volo da Vite e da `serve-dist.mjs`, scritto nella build. `app.hasAsset(url)` lo consulta prima di chiedere un file facoltativo: un file che manca non produce errori in console.

## Grafica (`gfx/Renderer.js`)
Ordine dei passaggi: scena → occlusione ambientale (N8AO, raggi nel buffer di profondità; le trasparenze non occludono) → riflessi SSR → rete di sicurezza contro NaN → profondità di campo → bloom, correzione colore, tone mapping → SMAA, vignettatura, grana.
- **Riflessi (`gfx/ssr.js`)**: la scena viene ridisegnata in un G-buffer con un solo materiale (normale in spazio vista, ruvidità, riflettività per oggetto); per ogni pixel lucido il raggio riflesso avanza in spazio schermo (fino a 96 passi, uno ogni ~3 px) con raffinamento binario, poi il riflesso viene sfocato secondo la ruvidità (mipmap + disco bilaterale) e pesato con Fresnel. Dove il raggio esce dallo schermo resta il riflesso dell'ambiente dei materiali. Riflettività automatica da metallicità e ruvidità; si regola per materiale con `userData.ssr` (0..1) e `userData.ssrRough`; `userData.noSSR` esclude un oggetto, `userData.ssrSolid` include un trasparente. Lo stesso G-buffer fornisce la sonda dell'autofocus (distanza al centro dello schermo, letta in modo asincrono).
- **Ombre (`gfx/shadows.js`)**: una luce direzionale per mondo (`SunShadow`); la scatola della mappa d'ombra segue la camera, spostata in avanti, e si muove a passi di un texel (niente tremolio). `enableShadows(scena)` accende proiezione e ricezione sugli oggetti illuminati e opachi; `userData.noCastShadow` per le grandi strutture che devono solo ricevere (pareti del canyon e cattedrale di Sunset, cassa del movimento, rotore-sole di Virentia), `userData.noShadow` per escludere. L'epilogo usa una scatola fissa attorno ai tre orologi.
- **Parametri per mondo** in `world.post`: `ao { radius, intensity }`, `ssr { intensity, maxDistance, thickness }` (o `false`), `dof { scale, range }` (o `false`).
- **Cielo del movimento (`DreamSky`, `gfx/sky.js`)**: un solo shader su una sfera che segue la camera, all'infinito, senza geometria (circa 0,1 ms per fotogramma in 1080p sulla RTX 5070 Ti).
  - Crepuscolo a gradiente, più caldo verso `uGlowDir` (dietro le tre Delta, +Z), con luna e stelle procedurali che brillano.
  - Tre catene di montagne: rumore periodico "a cresta" sul giro dell'orizzonte, quindi senza cuciture. L'ampiezza varia per fare massicci e passi; neve a due falde (luce e ombra dalla pendenza), filo di luce sulle creste verso il bagliore, velo d'aria crescente con la distanza.
  - Nebbia luminosa ai piedi delle montagne. Sotto l'orizzonte il lago riflette la stessa funzione capovolta, spostata di lato dalle increspature (il riflesso si allunga in verticale), con un Fresnel che scurisce guardando in basso.
  - `uDim` lo spegne dentro la cassa (segue il fattore dentro/fuori della nebbia). Fuori la nebbia è più rada e indaco; una luce direzionale dal bagliore (`glowRim`) dà il controluce alle tre Delta. Il faro dei monoliti è stato tolto: sul logo applicato lucido lasciava un punto bianco abbagliante.
- **Luce d'ambiente degli orologi**: preset `studio` di `gfx/env.js`, uno studio fotografico generato una volta sola all'avvio (mappa d'ambiente a 512 px, nessun costo per fotogramma).
  - **Come è fatto.** Una "tenda di luce" chiara davanti, buio dietro, un piano chiaro sotto (i monoliti si guardano spesso dal basso), bande nere che disegnano i riflessi sul lucido e strisce luminose sui fianchi e sopra.
  - **Perché.** Prima era la stanza neutra di three.js (RoomEnvironment), tutta chiara: l'acciaio usciva grigio uniforme, come plastica bianca. `STUDIO.gain` compensa le intensità con cui i mondi usano lo studio (0,4–0,6).
  - **Acciaio.** Riflettanza dell'inox 316L, 0,62 (nei GLB e in `build_watches.py`; prima 0,80, il valore dell'alluminio).
  - **Quadrante sempre dritto (`faceViewer` in `watchModel.js`).** I monoliti (le tre Delta, Celeste, Sunset, Virentia) si voltano a ogni fotogramma verso la camera, morbidamente (`1 − e^(−1,2·dt)`), con le ore 12 in alto e un limite all'inclinazione (`maxPitch` 0,6 rad, così da sotto un orologio gigante non si piega sul visitatore). All'ingresso nel mondo guardano già il punto di partenza. Visto dal basso e di lato con il quadrante fisso, l'orologio sembrava storto.
  - **Vetro antiriflesso.** Nel materiale del vetro (`watchGlassMaterial`) il riflesso diretto delle luci puntiformi è ridotto quasi a zero; restano i riflessi dell'ambiente. Senza, il faro dei monoliti lasciava una macchia bianca sul quadrante.
  - **Satinatura visibile (`watchModel.js`, `BRUSH`).** Sui materiali satinati con anisotropia, righe fini della spazzolatura: lineari da ore 12 a ore 6 sulla cassa e sul bracciale, circolari sulla lunetta e sul rotore, 10 per mm. Riflettanza, ruvidità e normale variano leggermente riga per riga, come nell'acciaio spazzolato vero. Si spengono quando diventano più fini di un pixel, così da lontano non sfarfallano.
- **Fuoco e post fissati**: `renderer.focusOverride` / `focusRangeOverride` sostituiscono l'autofocus (le riprese del trailer, `scripts/trailer/browser.mjs`); `renderer.postOverride`, fissato da un mondo, sovrascrive bloom, esposizione e simili con una transizione morbida.
- **Livelli di qualità**: `LEVELS` in `Renderer.js` (risoluzione, occlusione, riflessi, ombre, profondità di campo, preset SMAA); in automatico il livello sale fino a ultra e scende se i fotogrammi superano ~18,5 ms.

## Mappa degli asset
| Dove | Asset |
|---|---|
| Schermata iniziale / attract | Film `CELESTE INTRO_ORIZ` (0–5,85 s, senza audio), logo SVG; i soldatini come riserva se il video non parte |
| Parte 1 (movimento) | Calibro procedurale; rotore = modello 3D del rotore; tre monoliti (modelli 3D Celeste, Sunset, Virentia) nel cielo alle spalle della partenza; cielo onirico con le Alpi e il lago = shader `DreamSky` (`gfx/sky.js`); card con foto reali: rotore (Vi 7), fondello aperto (Vi 4) |
| Hub | Finestre dei portali con macro reali dei quadranti |
| Celeste | Procedurale (cielo-quadrante, maglie) + monolite = modello 3D Celeste; card: Ce 1, Ce 2, Ce 3, Ce 4, Ce 6, Ce 7 |
| Sunset | Texture delle bande da Su 7; monolite = modello 3D Sunset nell'abside della cattedrale; attorno, quattro Sunset (uno con il quadrante reale, tre con la stessa pietra in un altro taglio); card: Su 2, Su 4, Su 7, Su 10 |
| Virentia | Bosco = modelli Blender di Modelli/3D/natura (alberi a viale, felci, fiori, erba, rocce, funghi); prato di muschio pettinato a Côtes de Genève e nebbia bassa; il sole è il modello 3D del rotore; porta = lunetta del modello 3D Virentia con il rotore 3D dentro (ci si passa sotto il mozzo); monolite = modello 3D Virentia in fondo alla radura; card: Vi 2, Vi 4, Vi 6, Vi 7 |
| Epilogo | I tre modelli 3D su fondo scuro, luce da studio |

Dettagli: `ASSETS.md`. Istruzioni operative: `README.md`.
