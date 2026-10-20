import numpy as np
W, H = 3510, 2483
P = 23.62
T = 1536; HALF = 18.6
lin = (np.arange(T) + 0.5) / T * 2 * HALF - HALF
Xw, Yw = np.meshgrid(lin, lin[::-1])       # coordinate mondo (x verso ore 3), riga 0 = ore 12
R = np.hypot(Xw, Yw)
def dil(m, n):
    o = m.copy()
    for _ in range(n):
        a = o.copy(); a[1:] |= o[:-1]; a[:-1] |= o[1:]; a[:, 1:] |= o[:, :-1]; a[:, :-1] |= o[:, 1:]; o = a
    return o
def ero(m, n):
    return ~dil(~m, n)
def center(img):
    dark = img < 150
    cx, cy = 999, 1135
    row = np.where(dark[cy, 400:1600])[0] + 400; col = np.where(dark[500:1800, cx])[0] + 500
    return (row.min() + row.max()) / 2, (col.min() + col.max()) / 2
for name, page in (("open", "ex-001"), ("solid", "ex-002")):
    img = np.fromfile(f"C:/Users/UTENTE/AppData/Local/Temp/claude/C--Users-UTENTE-Desktop-MNC-GAME/f6e2a322-e58c-420b-8033-60d0bd307ab5/scratchpad/cad/{page}.gray", dtype=np.uint8).reshape(H, W) if False else None
    img = np.fromfile(f"C:/Users/UTENTE/AppData/Local/Temp/claude/C--Users-UTENTE-Desktop-MNC-GAME/f6e2a322-e58c-420b-8033-60d0bd307ab5/scratchpad/cad/{page}.gray", dtype=np.uint8).reshape(H, W)
    cx, cy = 999.0, 1135.0
    # vista dal fondello: la destra del disegno e' ore 9 (x negativo nel mondo)
    px = cx - Xw * P; py = cy - Yw * P
    v = img[np.clip(py.round().astype(int), 0, H - 1), np.clip(px.round().astype(int), 0, W - 1)] < 140
    ring = (R > 13.3) & (R < 14.85)
    art = (R < 13.05)
    txt = ero(dil(v & ring, 3), 2) & ring
    lines = dil(v & art, 1) & art if name == "solid" else np.zeros_like(v)
    m = (txt | lines).astype(np.float32)
    # leggera sfumatura
    k = np.ones(3) / 3
    m = np.apply_along_axis(lambda r: np.convolve(r, k, 'same'), 1, m)
    m = np.apply_along_axis(lambda c: np.convolve(c, k, 'same'), 0, m)
    (np.clip(m, 0, 1) * 255).astype(np.uint8).tofile(f"C:/Users/UTENTE/AppData/Local/Temp/claude/C--Users-UTENTE-Desktop-MNC-GAME/f6e2a322-e58c-420b-8033-60d0bd307ab5/scratchpad/back_{name}.gray")
    print(name, "centro", cx, cy)
