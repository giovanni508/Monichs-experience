# Il laboratorio: specifica di game design

- **Stato:** storia e vincoli approvati da Giovanni il 7 ottobre 2026. Revisione 2: i fondatori sono **modelli 3D ricavati dalle loro foto**, non riprese video.
- **Design e QA:** sessione "Sezione finale Monichs".
- **Sviluppo:** sessione "Sviluppatore".
- **Modelli 3D dei fondatori:** sessione "Agente Modellazione 3d".

## 1. Cosa e perché

È la sezione finale dell'esperienza. Dopo i tre mondi il visitatore, ancora piccolo, esce dall'orologio e si ritrova sul banco del laboratorio Monichs. Dietro il banco, giganti, Giovanni e Filippo raccontano in circa 3 minuti come è nato Monichs e cosa viene adesso.

Il finale rompe la quarta parete: smettono di guardare il visitatore piccolo sul banco e alzano lo sguardo. Gli dicono di tornare grande e la camera sale a misura d'uomo, fino a incrociare i loro occhi: in quel momento stanno parlando alla persona reale davanti allo schermo. Poi la ringraziano.

L'esperienza si apre con *"Diventa piccolo. Più piccolo di un granello di polvere."* (`movement.narration.intro1`) e si chiude con *"Adesso torna grande."*: è un cerchio voluto e va preservato.

## 2. Posizione nel flusso

```
… → HUB (tre mondi visitati) → luce al centro del bilanciere → LAB → cartello "Grazie" → EPILOGO (attuale) → START
```

- **Hub.** In `MovementWorld.js` (~riga 1179) la luce centrale oggi fa `goTo('epilogue')`; da ora fa `goTo('lab')`. Il testo `movement.narration.hubAll` resta com'è.
- **Nuovo mondo.** `worlds/LabWorld.js`, con l'interfaccia `World`. Va registrato in `App.js` (mappa `W`) e nell'ordine di caricamento progressivo, prima di `epilogue`.
- **Uscita.** Dopo il cartello si chiama `goTo('epilogue', { fromLab: true })`. L'epilogo resta com'è (i tre orologi, la CTA, il QR), ma con `fromLab` **non** dice `epilogue.name`, perché la frase *"Mon, mio. Montre, orologio."* l'hanno già detta i fondatori.
- **Menu.** Aggiungi il capitolo "Il laboratorio" dopo Virentia (`ui.chapter.lab`). Vale anche `?world=lab`.
- **Attrazione (priorità bassa).** Una inquadratura del banco con i fondatori in posa di riposo, senza voce.

## 3. La scena

Il visitatore è piccolo, con gli stessi occhi bassi degli altri mondi, e **cammina**: niente volo. Le collisioni sono solide, come in tutti i mondi (`WalkArea`). Il calpestabile è il tappetino del banco; dal bordo non si cade.

Tutto ciò che è prodotto Monichs deve essere **fedele all'originale**: usa i modelli GLB e i riferimenti reali e verifica con una render accanto alla foto prima di consegnare. Gli attrezzi possono essere procedurali e generici, senza marchi.

| Oggetto | Fonte reale | Ruolo |
|---|---|---|
| **Virentia** coricata sul quadrante, fondello aperto in alto, rotore visibile sotto lo zaffiro | `assets/models/virentia.glb` + `rotore.glb`. Verifica che il GLB abbia il fondello aperto: confronta con le foto Vi (4) e Vi (7) | Punto di arrivo: la luce che svanisce dal fondello dà l'idea che il visitatore sia appena uscito da lì. Ticchetta piano |
| **Celeste** e **Sunset** a quadrante in su, lancette sull'ora reale | GLB esistenti (`createWatch`) | Si accendono nel capitolo "Oggi" |
| **Foglio del disegno tecnico** (orologio + bracciale), grande come una piazza e calpestabile | `C:\Users\UTENTE\Desktop\Monichs Asset vari locale\MNC_T_Draw_Print.pdf`, pagina 1 | Si accende nel capitolo "Il percorso" |
| **Foglio dell'esploso 4029** | `C:\Users\UTENTE\Desktop\4029-MOS-SW200-VR13-EXPLOSION.pdf` | Come sopra |
| **Schizzo a matita del rotore** | `Modelli/ROTORE/MNC_Dw_Rotor 2 (2).png` | Gli "schizzi" del capitolo "Come è nata" |
| **Scatola blu notte** a motivo di triangoli, aperta, con il pack da viaggio in pelle marrone e la placchetta in oro rosa | `C:\Users\UTENTE\Desktop\Monichs Asset vari locale\MNC_Ph_Pack.png` | Si accende nel capitolo "Oggi" |
| Lente, pinzette, cacciavite, matita | procedurali | Arredo e ostacoli |
| **Giovanni e Filippo**, seduti dietro il banco, a scala gigante | modelli 3D (§4) | I narratori |

- **Fogli.** Carta leggermente imbarcata, contenuto reale come texture. Rasterizza i PDF con `pdftoppm` (c'è in Git Bash, `/mingw64/bin`), poi passali in `scripts/assets-manifest.mjs`: WebP, al massimo 2048 px, o 4096 solo per il foglio calpestabile se serve nitidezza. Gli originali non si toccano mai.
- **Luce.** Lampada da banco calda come luce principale, con ombra (`SunShadow`), e un riempimento freddo da finestra. Ambiente `studio` per l'acciaio degli orologi, come nell'epilogo. Palette navy del brand. La luce sui fondatori è morbida e calda: niente controluce duro sui volti.
- **Profondità di campo e fuoco.** Si usa l'autofocus esistente: quando il visitatore alza lo sguardo verso i fondatori, il fuoco va su di loro. Durante il racconto la camera **non** va forzata.

## 4. I fondatori in 3D

### Riferimenti

| Persona | Foto (copie degli originali da 3600 px, che restano in `Downloads`) | Abiti |
|---|---|---|
| **Giovanni** | `Modelli/Fondatori/Giovanni.png` | dolcevita nero |
| **Filippo** | `Modelli/Fondatori/Filippo.png` | camicia bianca aperta al collo, catenina sottile |

- Per ognuno c'è **una sola foto, di tre quarti**. Per profilo, nuca e mani bisogna chiedere altre foto a Giovanni (§10). Intanto si lavora con quelle che ci sono.
- **Fedeltà prima di tutto.** Il modellatore consegna render accanto alla foto, con la stessa inquadratura e la stessa luce. Se la somiglianza non convince, ci si ferma e si mostra a Giovanni **prima** di integrare.
- Meglio un'animazione sobria e credibile che un'animazione ricca che cade nell'effetto "uncanny".
- **Nessuna foto come texture.** Le foto servono solo come riferimento: misure, proporzioni, colori. Ogni texture è dipinta o procedurale (richiesta di Giovanni).

### Direzione artistica: 3D animato (aggiornamento dell'8 ottobre 2026)

Giovanni ha poi chiesto un **3D animato tipo Pixar**, che sostituisce lo stile scultoreo qui sotto. I riferimenti sono in `Modelli/Fondatori/stile/Giovanni_stile.webp` e `Filippo_stile.webp`.

- **Forme e pelle:** forme pulite e simmetriche, pelle liscia e calda con subsurface leggero.
- **Occhi:** grandi, con iridi marroni lucide.
- **Capelli:** volumi pieni pettinati, senza alpha. Giovanni ha ricci voluminosi sopra e lati corti; Filippo ha il ciuffo spazzolato in su e i lati corti.
- **Giovanni:** barba corta e sfumata con baffi e pizzetto, sorriso a bocca chiusa, dolcevita nero a coste.
- **Filippo:** sopracciglia scure e marcate, sorriso con i denti, camicia bianca aperta, catenina e croce d'argento.

Restano valide le regole sulle foto (solo riferimento, mai texture), sulle mani (palmo in giù) e sul contratto tecnico.

**Realizzazione.** Con il permesso di Giovanni i due riferimenti di stile sono stati convertiti in 3D su Higgsfield: prima un'immagine pulita in posa A, poi Tripo H3.1. Le foto vere non sono state usate. Il modello generato è stato poi montato in Blender secondo il contratto: occhi veri che ruotano, palpebre, bocca apribile, ossa, shape key e clip. Dettagli e numeri sono in `ASSETS.md` §9.

### Direzione artistica precedente: stile scultoreo (superata)

Decisione di Giovanni dell'8 ottobre 2026, dopo la prima prova semi-realistica: quella aveva effetto manichino, mani con il palmo in su, una barba a macchia e capelli "a foglie".

I fondatori diventano **busti animati in porcellana biscuit**, come statue di un atelier che prendono vita. Non sono cartoni animati e non sono un tentativo di realismo fotografico.

**Materiali**, una sola famiglia ceramica opaca, con le parti smaltate dove serve riconoscerle:

| Parte | Resa |
|---|---|
| Volto, collo, mani | Biscuit avorio caldo, opaco (roughness alta), senza pori né macchie dipinte. Le forme sono semplificate per piani, come in un ritratto scolpito. Subsurface molto leggero o nullo |
| Capelli, barba, sopracciglia | Volumi pieni scolpiti, **niente card con alpha**, con solchi di stecca nella normal map e una velatura terra d'ombra scura, opaca |
| Occhi | Iride incisa e pupilla smaltata scura con un minimo punto lucido: lo sguardo deve leggersi, perché il finale è un contatto visivo |
| Dolcevita di Giovanni | Smalto satinato nero-blu notte (navy del brand); deve restare **nero** sotto la lampada, niente sheen bianco |
| Camicia di Filippo | Smalto satinato bianco avorio, più freddo dell'incarnato; la catenina con la croce in oro rosa, come gli accenti della Virentia |

**Somiglianza**, affidata a forma del viso, capigliatura, barba, espressione e abiti:
- **Giovanni:** viso pieno; capelli scuri corti, mossi e spettinati, con volume in alto; barba corta e piena con baffi, che segue la mandibola; sorriso a bocca chiusa, un po' asimmetrico; occhi socchiusi nel sorriso.
- **Filippo:** viso pieno, guance tonde; sopracciglia scure, dritte e marcate; capelli corti, lati più corti e sopra spazzolati in avanti e in su; **sorriso aperto con i denti** (scolpiti come un blocco unico) come espressione di base.

**Mani:** poggiano sul banco **con il palmo in giù**, dita rilassate.

**Contratto tecnico:** invariato rispetto al paragrafo seguente (ossa, shape key, clip, scala, budget). Unica differenza: i capelli sono volumi solidi, non card.

**Prove richieste prima dei due modelli completi:**
1. Uno *style frame* di Giovanni (solo testa e busto) nel nuovo materiale, sotto la luce del laboratorio (lampada calda, fondo scuro), da far approvare a Giovanni.
2. Poi, per entrambi, tre render:
   - confronto con la foto alla stessa inquadratura;
   - `leanDown` visto dal visitatore piccolo sul banco (camera a ~13 mm dal piano, ~0,4 m davanti);
   - l'inquadratura finale del contatto visivo (camera ad altezza occhi, 1,0–1,25 m, campo visivo 50°).

### Contratto tra Modellazione 3D e Sviluppatore

Da rispettare alla lettera: così si lavora in parallelo.

**File.**
- Per il gioco: `public/assets/models/founder-giovanni.glb` e `public/assets/models/founder-filippo.glb`.
- Sorgenti: `Modelli/3D/fondatori/*.blend`.
- Percorsi in `config.json` → `assets["model.founder.giovanni"]` e `assets["model.founder.filippo"]`.

**Inquadratura del modello.**
- Busto fino ai fianchi, braccia e **mani** che poggiano sul piano del banco: le mani giganti vicino al visitatore sono uno dei momenti più forti.
- Sotto il banco non serve nulla.
- Postura: seduti, leggermente chinati in avanti.

**Unità e orientamento.**
- 1 unità = 1 metro, scala reale. Origine al centro del bacino sul piano del sedile, sguardo verso +Z.
- La scala gigante la decide lo Sviluppatore.

**Scheletro.** Nomi esatti delle ossa: `spine`, `chest`, `neck`, `head`, `eye.L`, `eye.R`, `jaw`, `shoulder.L/R`, `upper_arm.L/R`, `forearm.L/R`, `hand.L/R`. Le dita sono facoltative (la v3 le ha). Se ci sono valgono queste regole:
- **Ossa.** Tre ossa per dito: `thumb.01–03.L/R`, `index.01–03.L/R`, `middle.01–03.L/R`, `ring.01–03.L/R`, `pinky.01–03.L/R`. Le `.01` sono figlie di `hand.*`, le altre a catena; `thumb.01` è il metacarpo. `hand.*` finisce alla nocca del medio. In three.js i punti spariscono dai nomi (`index01L`), ma il nome originale resta in `userData.name`.
- **Assi.** La Z locale è il dorso del dito. La flessione è una rotazione attorno alla X locale, con angolo negativo verso il palmo, uguale ai due lati. L'apertura laterale è attorno alla Z.
- **Banco.** Sul banco, verso il palmo i polpastrelli affondano: −10° sulla `.01` li abbassa di circa 11 mm, +10° li alza di circa 9. Il motore muove le dita solo verso l'alto.
- **Clip.** Tutte le clip chiavano le dita.
  - In `leanDown` le dita sono rilassate e i polpastrelli sono il punto più basso, uguali a destra e a sinistra.
  - In `pointDown` l'indice è teso verso il banco e le altre dita sono piegate.
  - In `explain` la mano è aperta, con metà della torsione passata all'avambraccio. `head` e `eye.*` devono poter essere orientati via codice (look-at).

**Shape key**, nomi esatti:

| Gruppo | Shape key |
|---|---|
| Occhi | `blink.L`, `blink.R`; facoltative `blinkHalf.L`, `blinkHalf.R` |
| Bocca, aperture | `jawOpen`, `mouthA`, `mouthO`, `mouthE` |
| Bocca, chiusure | `mouthMBP`, `mouthFV` |
| Espressione | `smile`; facoltative `smileTeeth`, `browUp` |

Le shape key facoltative (v3) cambiano il comportamento del motore così:
- **`blinkHalf`.** Serve alle chiusure parziali delle palpebre, con il bordo che segue il bulbo. Per una chiusura b, fino a 0,5 vale solo `blinkHalf` = 2b; oltre, `blinkHalf` = 2(1−b) e `blink` = 2b−1. Con `blinkHalf` l'apertura rilassata sta già nella forma base: palpebre a riposo = 0.
- **`smile` e `smileTeeth`.** Se c'è `smileTeeth`, `smile` è a labbra chiuse e i denti arrivano solo con `smileTeeth` (il "Grazie").
- **`browUp`.** Le sopracciglia si alzano a inizio battuta e nella sorpresa.

**Occhi.** Bulbi opachi (roughness ≥ 0,6, materiali `eye_L` ed `eye_R`): il motore aggiunge uno strato lucido sottile (clearcoat), come la cornea, per il piccolo riflesso degli occhi vivi.

**Clip di animazione glTF**, nomi esatti, in loop dove ha senso:

| Clip | Cosa fa |
|---|---|
| `idle` | Respiro e micro-movimenti |
| `leanDown` | Chinati verso il banco: la posa del racconto |
| `lookUp` | Si raddrizzano e alzano lo sguardo all'altezza degli occhi |
| `explain` | Gesto con una mano mentre si parla |
| `pointDown` | Indicano un oggetto sul banco |
| `nod` | Un cenno di assenso |

**Materiali e budget.**
- PBR, materiali ceramici dello stile scultoreo (vedi sopra), senza shader custom. I capelli sono volumi solidi, non card con alpha.
- Al massimo 60k triangoli a persona; texture 2048, il volto fino a 4096.
- Formato compatibile con il loader GLB che il progetto usa già per gli orologi.

### Comportamento in gioco (Sviluppatore)

- **Sguardo.** Con look-at procedurale su `head` ed `eye.*`:
  - durante il racconto chi parla guarda la camera del visitatore piccolo, cioè in basso sul banco; ogni tanto guarda l'oggetto nominato o l'altro fondatore;
  - chi ascolta guarda chi parla o il banco.
- **Bocca.** Movimento guidato dalle voci, con l'ampiezza dell'audio sulle shape key. Senza voce si guida con la durata del testo: un "lip flap" leggero, mai frenetico.
- **Occhi.** Blink casuali, ogni 3–6 s.
- **Gesti.** `explain` su alcune battute lunghe, `pointDown` quando c'è un `highlight`.

### Voci

Decisione di Giovanni: la versione definitiva delle voci sarà **generata con l'AI**, in un compito successivo. **Per ora** si usano suoni segnaposto e sottotitoli.

**Oggi: voce segnaposto procedurale.** Va fatta con la Web Audio API, come il resto dell'audio del progetto (`core/Audio.js`).
- È un "borbottio" di sillabe brevi e casuali, alla maniera dei giochi che danno voce ai personaggi senza parole: piccoli impulsi tonali con intonazione che sale e scende, pause sulle virgole e sui punti, una cadenza finale a fine frase.
- I due fondatori devono avere **due timbri distinti** (registro, colore, velocità), così si capisce chi parla anche senza leggere.
- Volume morbido, mai stridulo, e niente impulsi ripetuti troppo fitti: deve accompagnare, non infastidire. Giovanni ha già trovato fastidioso il tic nel menu.
- Il borbottio dura quanto la battuta, cioè i tempi calcolati sulla lunghezza del testo (come `Narrator.durationFor` ma più lenti, perché è parlato; totale tra 2:50 e 3:10), e guida la bocca (shape key) e la "respirazione" dei segnaposto.
- Si spegne con M, come il resto dell'audio, e si ferma in pausa.

**Domani: voci AI, in italiano (originale) e doppiate in inglese.** Decisione di Giovanni dell'8 ottobre 2026.

Una clip per battuta e per lingua:
- `public/assets/audio/lab/it/<key>.mp3` per l'originale italiano (per esempio `it/g1.mp3`). Per l'italiano vale anche la cartella principale, `audio/lab/g1.mp3`.
- `public/assets/audio/lab/en/<key>.mp3` per il doppiaggio inglese.
- Dopo la build si usano le stesse cartelle in `dist/assets`.

Regole:
- Ogni battuta parla nella lingua attiva nel momento in cui comincia, e la clip di quella lingua ne decide la durata.
- In inglese, se manca il doppiaggio di una battuta, si sente la clip italiana con i sottotitoli in inglese.
- Senza clip parla il borbottio, cadenzato sul testo di quella lingua: 180,9 s in italiano, 179,8 s in inglese.
- Se si cambia lingua a metà battuta, i sottotitoli cambiano subito e la voce finisce la battuta che stava dicendo.
- Il passaggio dal segnaposto alle voci vere resta solo una questione di file, senza codice. Le istruzioni sono in `public/assets/audio/lab/LEGGIMI.txt`.

Durante il parlato, segnaposto o voce vera che sia, abbassa l'ambiente.

### Segnaposto finché non arrivano i GLB

Due presenze calde e sfocate dietro il banco: sagome o luci, **mai volti inventati**. Se il file manca non si blocca nulla.

### Cue guidati dai dati

Usa `content/lab.json`: una lista ordinata, in cui ogni voce ha questi campi.

| Campo | Valori |
|---|---|
| `key` | chiave del testo (`lab.lines.*`) |
| `speaker` | `giovanni`, `filippo` o `both` |
| `highlight` (facoltativo) | `sketch`, `drawing`, `watches`, `box` |
| `event` (facoltativo) | `tickStop`, `lookUp`, `grow`, `thanks` |
| `gesture` (facoltativo) | `explain`, `pointDown`, `nod` |
| `pause` (facoltativo) | secondi di silenzio dopo la battuta |
| `gap` (facoltativo) | silenzio dopo la battuta al posto di quello comune (`timing.gap`): più corto nei botta e risposta |

Così si riordina o si ritima senza toccare il codice.

## 5. Copione (`texts.json` → sezione `lab`, IT + EN)

G = Giovanni, F = Filippo. Le voci originali sono in italiano, con doppiaggio inglese (§4, Voci). Voce e sottotitoli seguono la lingua scelta.

| key | chi | cue | IT | EN |
|---|---|---|---|---|
| **Arrivo** | | | | |
| `lab.lines.g1` | G | | Eccoti. Hai fatto tutto il giro. | There you are. You made it all the way through. |
| `lab.lines.f1` | F | | Piano: da lì sotto sembriamo giganti. Ti diamo il benvenuto nel nostro laboratorio. | Gently: from down there we look like giants. Welcome to our workshop. |
| `lab.lines.g2` | G | | Io sono Giovanni. | I'm Giovanni. |
| `lab.lines.f2` | F | | Io Filippo. Quello che hai appena attraversato, quattro anni fa non esisteva. | And I'm Filippo. Four years ago, everything you've just walked through didn't exist. |
| **Come è nata** | | | | |
| `lab.lines.g3` | G | highlight `sketch` | Era il 2022. Avevamo un'ossessione: l'orologio svizzero che avremmo voluto portare noi. Fatto bene, e non un privilegio per pochi. | It was 2022. We had one obsession: the Swiss watch we wanted to wear ourselves. Made properly, and not a privilege for the few. |
| `lab.lines.f3` | F | | Il mondo non smette mai di correre. Noi volevamo un oggetto che ti facesse rallentare. | The world never stops running. We wanted an object that would make you slow down. |
| `lab.lines.g4` | G | | E gli abbiamo dato un nome che fosse tuo. Mon, mio. Montre, orologio. Monichs. | And we gave it a name that would be yours. Mon, mine. Montre, watch. Monichs. |
| **Il percorso** | | | | |
| `lab.lines.f4` | F | highlight `drawing` | Nel 2023 abbiamo cominciato a disegnare. Tutto da zero: cassa, bracciale, quadrante, corona, fondello, perfino il rotore. Niente pezzi da catalogo. | In 2023 we started drawing. Everything from scratch: case, bracelet, dial, crown, caseback, even the rotor. Nothing from a catalogue. |
| `lab.lines.g5` | G | | E io quell'anno ho fatto il salto: da collezionista a imprenditore. | That year I made the leap: from collector to entrepreneur. |
| `lab.lines.f5` | F | | Poi la Svizzera: i fornitori, i prototipi, la pre-serie. Prendi il bracciale: in tanti orologi c'è uno stacco tra cassa e bracciale. Per noi era inaccettabile. Doveva essere una linea sola. | Then Switzerland: suppliers, prototypes, the pre-series. Take the bracelet: on so many watches there's a break between case and bracelet. For us that was unacceptable. It had to be one single line. |
| `lab.lines.g6` | G | | Abbiamo passato un tempo irragionevole su ogni dettaglio. | We spent an unreasonable amount of time on every detail. |
| `lab.lines.f6` | F | | E lo rifaremmo. | And we'd do it again. |
| **Oggi** | | | | |
| `lab.lines.g7` | G | highlight `watches` | Quest'anno abbiamo presentato la Trilogia al mondo, su Kickstarter: Celeste, Sunset, Virentia. | This year we presented the Trilogy to the world, on Kickstarter: Celeste, Sunset, Virentia. |
| `lab.lines.f7` | F | highlight `box` | Chi ci ha creduto per primo avrà un numero di serie basso inciso sul fondello. Il suo posto nella storia di Monichs. | Those who believed in us first will have a low serial number engraved on the caseback. Their place in the Monichs story. |
| `lab.lines.g8` | G | | Le prime consegne arriveranno nei primi mesi del 2027. | The first deliveries will arrive in the early months of 2027. |
| **E adesso** | | | | |
| `lab.lines.f8` | F | | E adesso? | And now? |
| `lab.lines.g9` | G | | Adesso c'è da rimboccarsi le maniche. | Now it's time to roll up our sleeves. |
| `lab.lines.f9` | F | gesture `nod` | Come sempre. | As always. |
| **La quarta parete** | | | | |
| `lab.lines.g10` | G | event `tickStop`, poi `lookUp` | Anzi, aspetta. Non sto parlando a chi è lì sul banco. | Actually, wait. I'm not talking to the one down there on the bench. |
| `lab.lines.f10` | F | | Parliamo con te. Sì, proprio tu, davanti allo schermo. | We're talking to you. Yes, you, in front of the screen. |
| `lab.lines.g11` | G | | All'inizio ti abbiamo chiesto di diventare piccolo, per farti vedere quanto conta ogni dettaglio. | At the start we asked you to become small, to show you how much every detail matters. |
| `lab.lines.f11` | F | event `grow` (a fine battuta) | Adesso torna grande. | Now grow big again. |
| `lab.lines.g12` | G | sguardo negli occhi | Torna nel mondo reale. Il tempo, quello vero, ha il ritmo che decidi tu. | Go back to the real world. Real time moves at the pace you choose. |
| `lab.lines.both1` | entrambi | event `thanks` | Grazie. | Thank you. |

**Testi di interfaccia**

| key | IT | EN |
|---|---|---|
| `lab.card.title` | Grazie per aver rallentato con noi. | Thank you for slowing down with us. |
| `lab.card.names` | Giovanni · Filippo | Giovanni · Filippo |
| `lab.skip` | Tieni premuto per saltare | Hold to skip |
| `ui.chapter.lab` | Il laboratorio | The workshop |
| `progress.lab` | part "Parte III", name "Il laboratorio" | part "Part III", name "The workshop" |
| `lab.speaker.giovanni` | Giovanni | Giovanni |
| `lab.speaker.filippo` | Filippo | Filippo |

## 6. Regia degli eventi

| Evento | Cosa succede |
|---|---|
| `highlight` | L'oggetto nominato si illumina con la stessa rim light degli hotspot e si spegne dopo circa 8 s. Chi parla fa `pointDown` verso l'oggetto. Niente card: qui il contenuto è il racconto. |
| tic | La Virentia sul banco ticchetta piano: `tickEnabled` vero, timbro `soft`, presenza bassa. |
| `tickStop` | Il tic si ferma. Silenzio prima della quarta parete. |
| `lookUp` | Entrambi passano da `leanDown` a `lookUp`: si raddrizzano e lo sguardo lascia il visitatore piccolo e va **dritto davanti a loro, ad altezza d'occhi umana**. Dal banco li vedi guardare sopra di te, verso qualcuno che non sei tu. Quel qualcuno è la persona davanti allo schermo. |
| `grow` | "Torna grande", circa 4 s. I comandi si disattivano. La camera si stacca dal corpo piccolo e sale fino all'altezza dei loro occhi, a una distanza normale da conversazione: il banco, gli orologi e i fogli tornano piccoli, alla scala vera. Alla fine della salita i loro sguardi sono **già lì**: contatto visivo diretto. La profondità di campo si apre su entrambi i volti. Nessun lampeggio (pulsazioni sotto 0,5 Hz). |
| `g12` e `both1` | Battute dette guardando negli occhi, a misura d'uomo. |
| `thanks` | Dopo "Grazie", dissolvenza in un bianco caldo. Poi il cartello DOM `lab.card.title` + `lab.card.names` per circa 5 s, **senza logo** (l'epilogo ha già il suo: niente doppio branding). Poi `goTo('epilogue', { fromLab: true })`. |

## 7. Comandi, fiera, durata

- **Movimento.** Durante il racconto si cammina liberamente sul banco. Non ci sono hotspot da attivare.
- **Saltare.** Dopo circa 10 s compare `lab.skip`. Tenendo premuto Spazio, il mouse o A per 1,5 s si salta **alla quarta parete** (`g10`), così tutti vedono il finale. Tenendo premuto durante la quarta parete si va all'epilogo.
- **Fiera.** Il reset per inattività dopo 60 s va **sospeso** mentre il racconto è in corso; per esempio `Kiosk` legge `director.world?.holdsIdle`. Dal cartello in poi torna normale.
- **Pausa.** Esc o cambio scheda mettono in pausa voci, cue e animazioni insieme; si riprende da dove si era.
- **Audio e lingua.** M toglie l'audio anche alle voci. Il cambio IT/EN cambia subito i sottotitoli.
- **Durata.** Circa 3:00. Il percorso completo passa da 7–9 a circa 10–12 minuti: va aggiornato nel README.

## 8. Vincoli di contenuto (non negoziabili)

- **Non nominare Angelo:** né nelle battute né nel cartello.
- Niente prezzi, niente riserva di carica, nessun numero di Kickstarter (backer, somme raccolte).
- **Consegne:** "nei primi mesi del 2027" (Q1 2027).
- **Prossimi passi:** solo "rimboccarsi le maniche". Non aggiungere roadmap, nuovi modelli o rivenditori.
- I volti sono solo quelli ricavati dalle foto di Giovanni e Filippo, mai inventati.
- Voci: per ora il borbottio procedurale; la versione definitiva sarà generata con l'AI (§4, Voci).
- Prodotti, packaging e disegni fedeli ai riferimenti reali, con verifica affiancata.
- Un solo logo alla volta.

## 9. Fatto quando

**Sviluppatore**
- `?world=lab` gira dall'inizio alla fine **con il borbottio procedurale e senza GLB dei fondatori** (segnaposto): 3:00 ±10 s, due timbri distinti, sottotitoli IT ed EN, accensioni degli oggetti, stop del tic, `lookUp`, crescita della camera, cartello, epilogo senza ripetere `epilogue.name`.
- Con un MP3 qualsiasi copiato come `g1.mp3`, quella battuta usa la clip al posto del borbottio.
- Con i GLB, appena arrivano: look-at, blink, bocca, gesti, contatto visivo a fine crescita.
- Dall'hub, dopo i tre mondi, si arriva al laboratorio. Funzionano il capitolo dal menu, il salto, la sospensione del reset, la pausa e il muto.
- 60 fps in qualità `auto`, nessun errore in console.
- Catture di: arrivo, disegno acceso, fondatori che guardano in basso, contatto visivo dopo la crescita, cartello.
- Aggiornati `README.md` (flusso, comandi, durata, TODO voci e foto), `ARCHITECTURE.md` (`LabWorld`, sistema dei cue) e `ASSETS.md` (nuovi asset).

**Modellazione 3D**
- I due GLB rispettano il contratto del §4 (nomi di ossa, shape key e clip, scala, budget).
- Render accanto alle foto, nella stessa inquadratura di tre quarti, per entrambi.
- Una render della posa `leanDown` e una di `lookUp`.

**Tutti:** a lavoro finito, avvisare la sessione "Sezione finale Monichs" per la QA.

## 10. Richieste a Giovanni e Filippo

1. **Altre foto** di ciascuno, per la fedeltà del 3D: fronte, profilo destro e sinistro, nuca, tre quarti dall'alto, più una foto delle mani appoggiate su un tavolo. Luce diffusa, stessi abiti delle foto attuali, telefono va bene.
2. **Voci**: si faranno con l'AI in un compito successivo. Per ora c'è il borbottio procedurale.
