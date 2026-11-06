// Lettore QR minimo, per i controlli: legge un codice disegnato pulito e dritto in un canvas (come quello
// dell'epilogo), versioni 1–6, modalità numerica, alfanumerica e byte. Non corregge errori e non cerca il
// codice in una foto: campiona i moduli al centro e segue la norma (ISO/IEC 18004) passo per passo, così
// il controllo non dipende dalla libreria che ha disegnato il codice.
// Si esegue nella pagina: page.evaluate(readQrCanvas, '#epilogue .qr canvas').
export function readQrCanvas(selector) {
  const canvas = document.querySelector(selector);
  if (!canvas) return { error: 'nessun canvas' };
  const W = canvas.width;
  const H = canvas.height;
  const px = canvas.getContext('2d').getImageData(0, 0, W, H).data;

  // il lato in moduli: quello per cui la riga di temporizzazione (riga 6) alterna scuro e chiaro
  let N = 0;
  let dark = null;
  for (const n of [21, 25, 29, 33, 37, 41]) {
    const d = (r, c) => {
      const k = (Math.floor(((r + 0.5) * H) / n) * W + Math.floor(((c + 0.5) * W) / n)) * 4;
      return px[k] * 0.3 + px[k + 1] * 0.59 + px[k + 2] * 0.11 < 128;
    };
    let ok = true;
    for (let c = 8; c <= n - 9 && ok; c++) ok = d(6, c) === (c % 2 === 0) && d(c, 6) === (c % 2 === 0);
    if (ok && d(0, 0) && d(3, 3) && !d(1, 1) && d(0, n - 1) && d(n - 1, 0)) {
      N = n;
      dark = d;
      break;
    }
  }
  if (!N) return { error: 'motivo di temporizzazione non trovato' };
  const version = (N - 17) / 4;

  // informazioni di formato (prima copia, attorno al motivo in alto a sinistra): correzione e maschera
  const fpos = [];
  for (let i = 0; i <= 5; i++) fpos.push([i, 8]);
  fpos.push([7, 8], [8, 8], [8, 7]);
  for (let i = 9; i < 15; i++) fpos.push([8, 14 - i]);
  let fbits = 0;
  fpos.forEach(([r, c], i) => {
    if (dark(r, c)) fbits |= 1 << i;
  });
  fbits ^= 0x5412;
  const ecl = ['M', 'L', 'H', 'Q'][fbits >> 13];
  const mask = (fbits >> 10) & 7;

  // moduli di servizio: motivi di posizione con separatori e formato, temporizzazione, allineamento
  const a = N - 7;
  const isFunction = (r, c) =>
    (r < 9 && c < 9) || (r < 9 && c >= N - 8) || (r >= N - 8 && c < 9) || r === 6 || c === 6 || (version >= 2 && Math.abs(r - a) <= 2 && Math.abs(c - a) <= 2);
  const masks = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const inv = masks[mask];

  // lettura a zig-zag, due colonne alla volta da destra, saltando la colonna 6
  const bits = [];
  for (let right = N - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < N; v++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? N - 1 - v : v;
        if (!isFunction(y, x)) bits.push(dark(y, x) !== inv(x, y) ? 1 : 0);
      }
    }
  }
  const raw = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) raw.push(bits.slice(i, i + 8).reduce((s, b) => (s << 1) | b, 0));

  // blocchi di correzione (versioni 1–6) e ricomposizione dei dati intercalati
  const ECC = { L: [7, 10, 15, 20, 26, 18], M: [10, 16, 26, 18, 24, 16], Q: [13, 22, 18, 26, 18, 24], H: [17, 28, 22, 16, 22, 28] };
  const BLOCKS = { L: [1, 1, 1, 1, 1, 2], M: [1, 1, 1, 2, 2, 4], Q: [1, 1, 2, 2, 4, 4], H: [1, 1, 2, 4, 4, 4] };
  const RAW = [26, 44, 70, 100, 134, 172];
  if (version > 6) return { error: `versione ${version} non gestita` };
  const nb = BLOCKS[ecl][version - 1];
  const eccLen = ECC[ecl][version - 1];
  const total = RAW[version - 1];
  const shortLen = Math.floor(total / nb);
  const numShort = nb - (total % nb);
  const dataLens = Array.from({ length: nb }, (_, j) => shortLen - eccLen + (j < numShort ? 0 : 1));
  const blocks = dataLens.map(() => []);
  let p = 0;
  for (let i = 0; i < Math.max(...dataLens); i++) for (let j = 0; j < nb; j++) if (i < dataLens[j]) blocks[j].push(raw[p++]);
  const data = blocks.flat();

  // segmenti: numerico, alfanumerico, byte (fino al terminatore)
  const stream = data.flatMap((b) => [7, 6, 5, 4, 3, 2, 1, 0].map((s) => (b >> s) & 1));
  let q = 0;
  const read = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | (stream[q++] ?? 0);
    return v;
  };
  const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
  const big = version >= 10;
  let text = '';
  const bytes = [];
  const flush = () => {
    if (bytes.length) text += new TextDecoder('utf-8').decode(new Uint8Array(bytes.splice(0)));
  };
  while (q + 4 <= stream.length) {
    const mode = read(4);
    if (mode === 0) break;
    if (mode === 4) {
      const n = read(big ? 16 : 8);
      for (let i = 0; i < n; i++) bytes.push(read(8));
    } else if (mode === 2) {
      flush();
      let n = read(big ? 11 : 9);
      for (; n >= 2; n -= 2) {
        const v = read(11);
        text += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45];
      }
      if (n) text += ALNUM[read(6)];
    } else if (mode === 1) {
      flush();
      let n = read(big ? 12 : 10);
      for (; n >= 3; n -= 3) text += String(read(10)).padStart(3, '0');
      if (n === 2) text += String(read(7)).padStart(2, '0');
      else if (n === 1) text += String(read(4));
    } else return { error: `modalità ${mode} non gestita`, version, ecl, mask };
  }
  flush();
  return { text, version, ecl, mask };
}
