"""Fase 2: occhi e bocca dalla vista frontale della texture (<nome>_face_tex.png).

blender -b --python gen_face.py -- <nome> [lip_mode]
Esce <nome>_face.json (coordinate nel sistema del modello, metri: x a sinistra del soggetto, z in alto) e
<nome>_face_check.png con i contorni trovati sopra la texture.
"""
import json
import os
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
NAME = argv[0]
LIP_MODE = argv[1] if len(argv) > 1 else "dark"
OUTD = r"C:\Users\UTENTE\Desktop\MNC GAME\Modelli\3D\fondatori\generati"
body = json.load(open(os.path.join(OUTD, NAME + "_body.json")))
fc = body["face_cam"]

im = bpy.data.images.load(os.path.join(OUTD, NAME + "_face_tex.png"))
W, H = im.size
A = np.array(im.pixels[:], np.float32).reshape(H, W, 4)[::-1].copy()     # riga 0 = in alto
rgb = A[..., :3]
V = rgb.max(-1); mn = rgb.min(-1)
S = np.where(V > 1e-4, (V - mn) / np.maximum(V, 1e-4), 0)
L = rgb @ np.array([0.299, 0.587, 0.114], np.float32)


def px2w(col, row):
    return (fc["cx"] + (col / W - 0.5) * fc["side"], fc["cz"] + (0.5 - row / H) * fc["side"])


def components(mask):
    """etichette 4-connesse (riempimento a pila; maschere piccole)"""
    lab = np.zeros(mask.shape, np.int32)
    n = 0
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if lab[y0, x0]:
            continue
        n += 1
        st = [(y0, x0)]; lab[y0, x0] = n
        while st:
            y, x = st.pop()
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < H and 0 <= xx < W and mask[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = n; st.append((yy, xx))
    return lab, n


def hull(pts):
    pts = sorted(set(map(tuple, pts)))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def fill_poly(poly, shape):
    m = np.zeros(shape, bool)
    poly = np.array(poly, np.float64)
    r0, r1 = int(poly[:, 1].min()), int(poly[:, 1].max())
    n = len(poly)
    for r in range(r0, r1 + 1):
        xs = []
        for i in range(n):
            (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
            if (y1 <= r < y2) or (y2 <= r < y1):
                xs.append(x1 + (r - y1) * (x2 - x1) / (y2 - y1))
        xs.sort()
        for a, b in zip(xs[::2], xs[1::2]):
            m[r, int(np.ceil(a)):int(np.floor(b)) + 1] = True
    return m


# ---------------------------------------------------------------- occhi
sclera = (V > 0.55) & (S < 0.16)
sclera[: int(H * 0.25)] = False; sclera[int(H * 0.80):] = False
lab, n = components(sclera)
sizes = np.bincount(lab.ravel())[1:]
order = np.argsort(sizes)[::-1]
cand = []
for k in order[:12]:
    if sizes[k] < 120:
        continue
    ys, xs = np.nonzero(lab == k + 1)
    cand.append((xs.mean(), ys.mean(), k + 1, sizes[k]))
print("BLOBS", [(round(b[0]), round(b[1]), int(b[3])) for b in cand])
# la sclera di ogni occhio e' spezzata dall'iride: si uniscono i pezzi alla stessa altezza, divisi per meta' volto
row0 = cand[0][1]
cand = [b for b in cand if abs(b[1] - row0) < 0.06 * H]
eyes = {}
check = rgb.copy()
blobs = []
for sfx, half in (("R", lambda x: x < W / 2), ("L", lambda x: x >= W / 2)):   # a sinistra nell'immagine = occhio destro
    parts = [b for b in cand if half(b[0])]
    msk = np.isin(lab, [b[2] for b in parts])
    ys, xs = np.nonzero(msk)
    blobs.append((xs.mean(), ys.mean()))
    # finestra attorno alla sclera: dentro, sclera + iride/pupilla (scure o marroni sature) connesse alla sclera
    bw, bh = np.ptp(xs), np.ptp(ys)
    y0, y1 = max(int(ys.min() - 0.45 * bh), 0), int(ys.max() + 0.45 * bh)
    x0, x1 = max(int(xs.min() - 0.25 * bw), 0), int(xs.max() + 0.25 * bw)
    win = np.zeros((H, W), bool); win[y0:y1, x0:x1] = True
    skin = (S > 0.30) & (V > 0.55)
    eyeish = win & ~skin
    elab, _ = components(eyeish)
    keep = np.unique(elab[msk & eyeish]); keep = keep[keep > 0]
    em = np.isin(elab, keep)
    ys2, xs2 = np.nonzero(em)
    poly = hull(np.stack([xs2, ys2], 1))
    m = fill_poly(poly, (H, W))
    iris = m & (S > 0.45) & (V > 0.08) & (V < 0.6)
    pupil = m & (V < 0.085) & (S < 0.35)
    iy, ix = np.nonzero(iris)
    print("mask", m.sum(), "iris", iris.sum(), "pupil", pupil.sum(), "poly", len(poly))
    # raggio dell'iride: la macchia connessa (iride + pupilla) attorno al centro mediano, larghezza orizzontale
    il, nl = components(iris)
    big = np.argmax(np.bincount(il.ravel())[1:]) + 1          # l'anello marrone e' la macchia piu' grande
    by, bx = np.nonzero(il == big)
    near = np.abs(by - int(np.median(by))) < 4
    wmax = np.ptp(bx[near])
    iy, ix = by, bx
    py, pxs = np.nonzero(pupil)
    pr = max(np.ptp(pxs[py == r]) for r in np.unique(py)) / 2 if len(py) else wmax * 0.22
    pr = min(pr, wmax * 0.30)
    col = rgb[iris & (S > 0.5) & (V > 0.1)].mean(0) if (iris & (S > 0.5) & (V > 0.1)).any() else rgb[iris].mean(0)
    # centro dell'iride: cerchio adattato al bordo iride/sclera, escluso il settore in alto coperto dalla palpebra
    # (il riflesso spezza l'anello e la palpebra ne copre la parte alta: baricentri e anelli sbagliano)
    scl = m & (V > 0.55) & (S < 0.22)
    irisish = m & ~scl & (V < 0.75)
    nb = np.zeros_like(scl)
    for dy_, dx_ in ((1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0), (0, 2), (0, -2)):
        nb |= np.roll(np.roll(scl, dy_, 0), dx_, 1)
    edge = irisish & nb
    ey, ex = np.nonzero(edge)
    c0x, c0y, r0 = ix.mean(), iy.mean(), wmax / 2
    for _it in range(3):
        ang = np.degrees(np.arctan2(-(ey - c0y), ex - c0x))          # 90 = in alto
        d_ = np.hypot(ex - c0x, ey - c0y)
        keep = ~((ang > 35) & (ang < 145)) & (d_ > 0.6 * r0) & (d_ < 1.45 * r0)
        if keep.sum() < 20:
            break
        Am = np.c_[2 * ex[keep], 2 * ey[keep], np.ones(keep.sum())]
        sol = np.linalg.lstsq(Am, ex[keep].astype(float) ** 2 + ey[keep].astype(float) ** 2, rcond=None)[0]
        c0x, c0y = float(sol[0]), float(sol[1]); r0 = float(np.sqrt(max(sol[2] + sol[0] ** 2 + sol[1] ** 2, 1.0)))
    ccol, crow = c0x, c0y
    print(sfx, "iris edge-circle center", round(ccol, 1), round(crow, 1), "r px", round(r0, 1), "blob centroid", round(ix.mean(), 1), round(iy.mean(), 1))
    eyes[sfx] = {
        "outline": [list(px2w(c, r)) for c, r in poly],
        "iris_c": list(px2w(ccol, crow)), "iris_r": wmax / 2 / W * fc["side"], "pupil_r": pr / W * fc["side"],
        "iris_rgb": [float(c) for c in col],
        "almond_c": list(px2w(np.mean([p[0] for p in poly]), np.mean([p[1] for p in poly]))),
    }
    check[m & ~(iris | pupil)] = [0.2, 1.0, 0.2]
    check[iris] = [0.2, 0.4, 1.0]
    print(sfx, "iris_r", eyes[sfx]["iris_r"], "pupil_r", eyes[sfx]["pupil_r"], "col", col.round(3))

# ---------------------------------------------------------------- bocca
ipd_px = abs(blobs[1][0] - blobs[0][0])
erow = 0.5 * (blobs[0][1] + blobs[1][1])
c0, c1 = int(blobs[0][0] - 0.05 * ipd_px), int(blobs[1][0] + 0.05 * ipd_px)
r0, r1 = int(erow + 0.66 * ipd_px), int(erow + 1.12 * ipd_px)


def box_blur(a, rad, axis):
    k = np.ones(2 * rad + 1, np.float32) / (2 * rad + 1)
    return np.apply_along_axis(lambda v: np.convolve(np.pad(v, rad, mode="edge"), k, "valid"), axis, a)


if LIP_MODE == "dark":
    sig = L.copy()
else:                                   # "beard": passaggio dal labbro superiore chiaro a quello inferiore rosso
    sig = np.roll(L, -4, 0) - np.roll(L, 4, 0)
    red_below = (np.roll(S, -6, 0) > 0.5) & (np.roll(V, -6, 0) > 0.55)
    sig = np.where(red_below, sig, 0.3)
band = sig[r0:r1, :]
band = box_blur(band, 4, 1)
hp = band - box_blur(band, 18, 0) if LIP_MODE == "dark" else band
rows, depth = [], []
for c in range(c0, c1):
    v = hp[:, c]
    r = int(np.argmin(v))
    rows.append(r0 + r); depth.append(-v[r])
rows = np.array(rows, np.float64); depth = np.array(depth)
cols = np.arange(c0, c1)
mid = len(cols) // 2
d0 = np.median(depth[mid - 20: mid + 20])
# angoli: dove il solco sparisce (meno del 35% del centro), cercando dal centro verso l'esterno
li = mid
while li > 0 and depth[li] > 0.35 * d0 and abs(rows[li] - rows[li + 1 if li + 1 < len(rows) else li]) < 6:
    li -= 1
ri = mid
while ri < len(cols) - 1 and depth[ri] > 0.35 * d0 and abs(rows[ri] - rows[ri - 1]) < 6:
    ri += 1
sel = slice(li + 1, ri)
lc, lr = cols[sel], rows[sel]
# levigatura della linea
k = 9
lr_s = np.convolve(np.pad(lr, k, mode="edge"), np.ones(2 * k + 1) / (2 * k + 1), "valid")
lip = [list(px2w(c, r)) for c, r in zip(lc[::4], lr_s[::4])]
for c, r in zip(lc, lr_s):
    check[int(round(r)) - 1:int(round(r)) + 2, c] = [1, 0.1, 0.1]
print("mouth cols", lc[0], lc[-1], "width m", (lc[-1] - lc[0]) / W * fc["side"])

face = {"eyes": eyes, "lip": lip, "eye_row_z": px2w(0, erow)[1], "ipd": ipd_px / W * fc["side"]}
json.dump(face, open(os.path.join(OUTD, NAME + "_face.json"), "w"), indent=1)

out = bpy.data.images.new("chk", W, H)
o = np.concatenate([check, np.ones((H, W, 1), np.float32)], -1)[::-1]
out.pixels = o.ravel()
out.filepath_raw = os.path.join(OUTD, NAME + "_face_check.png"); out.file_format = "PNG"; out.save()
print("DONE")
