import numpy as np, json
W, H = 4400, 4000; OX, OY = 2600, 5300
im = np.fromfile("C:/Users/UTENTE/AppData/Local/Temp/claude/C--Users-UTENTE-Desktop-MNC-GAME/f6e2a322-e58c-420b-8033-60d0bd307ab5/scratchpad/vi4.rgb", dtype=np.uint8).reshape(H, W, 3).astype(np.float32) / 255
lum = im @ np.array([0.3, 0.59, 0.11])
# punti stimati sul bordo della finestra (coordinate del ritaglio 1500 px -> foto)
est = [(405, 555), (1240, 500), (800, 190), (760, 925), (500, 300), (1130, 250), (480, 830), (1130, 800)]
P = np.array([(1200 + x * 4 - OX, 5000 + y * 4 - OY) for x, y in est], float)
def fit_conic(P):
    x, y = P[:, 0], P[:, 1]
    A = np.c_[x * x, x * y, y * y, x, y, np.ones(len(x))]
    _, _, Vt = np.linalg.svd(A)
    return Vt[-1]
def conic_to_ellipse(c):
    a, b, cc, d, e, f = c
    M0 = np.array([[f, d / 2, e / 2], [d / 2, a, b / 2], [e / 2, b / 2, cc]])
    M = np.array([[a, b / 2], [b / 2, cc]])
    x0, y0 = np.linalg.solve(2 * M, [-d, -e])
    ev, evec = np.linalg.eigh(M)
    k = -np.linalg.det(M0) / np.linalg.det(M)
    axes = np.sqrt(k / ev)
    return x0, y0, axes, evec
c = fit_conic(P)
for it in range(6):
    x0, y0, axes, evec = conic_to_ellipse(c)
    pts = []
    gy, gx = np.gradient(lum)
    for t in np.linspace(0, 2 * np.pi, 360, endpoint=False):
        dirv = evec @ (axes * np.array([np.cos(t), np.sin(t)]))
        p0 = np.array([x0, y0]) + dirv
        n = dirv / np.linalg.norm(dirv)
        ss = np.arange(-80, 81)
        q = p0[None, :] + ss[:, None] * n[None, :]
        qi = q.round().astype(int)
        ok = (qi[:, 0] >= 1) & (qi[:, 0] < W - 1) & (qi[:, 1] >= 1) & (qi[:, 1] < H - 1)
        if ok.sum() < 150: continue
        g = np.abs(gx[qi[:, 1], qi[:, 0]] * n[0] + gy[qi[:, 1], qi[:, 0]] * n[1])
        k = np.argmax(g)
        pts.append(q[k])
    pts = np.array(pts)
    c = fit_conic(pts)
    # scarta outlier
    x0, y0, axes, evec = conic_to_ellipse(c)
    loc = (pts - [x0, y0]) @ evec / axes
    rr = np.linalg.norm(loc, axis=1)
    keep = np.abs(rr - 1) < 0.02
    c = fit_conic(pts[keep])
x0, y0, axes, evec = conic_to_ellipse(c)
print("centro foto", x0 + OX, y0 + OY, "assi", axes, "rapporto", axes.min() / axes.max(), "tenuti", keep.sum())
json.dump(dict(x0=float(x0), y0=float(y0), axes=axes.tolist(), evec=evec.tolist(), OX=OX, OY=OY), open("C:/Users/UTENTE/AppData/Local/Temp/claude/C--Users-UTENTE-Desktop-MNC-GAME/f6e2a322-e58c-420b-8033-60d0bd307ab5/scratchpad/vi4_ellipse.json", "w"))
