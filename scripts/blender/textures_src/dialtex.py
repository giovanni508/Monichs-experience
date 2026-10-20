"""Estrae le texture dei quadranti dagli scontornati (Soldatini), centrate e in scala sugli indici.

Le lancette nelle immagini sono un livello composito comune ai tre file: la maschera viene ricavata
su Sunset (contrasto acciaio/arancio) e riusata in coordinate foto per Celeste e Virentia.
"""
import numpy as np, json, sys, os

D = os.path.dirname(os.path.abspath(__file__))
N = 3800; OX, OY = 1676, 1206
CX0, CY0, P0 = 3572.6 - OX, 3105.9 - OY, 85.27
T = 2048; HALF = 14.5
PXMM = T / (2 * HALF)
TRAP = dict(r0=10.33, r1=13.6, w0=1.48, w1=2.0)
BAR = dict(r0=10.34, r1=13.7, w0=1.05, w1=1.05)
PICTO = [[(653.8, 483.4), (539.0, 713.0), (768.1, 712.7)],
         [(424.5, 483.7), (309.7, 713.2), (538.8, 713.0)],
         [(538.4, 598.4), (653.1, 368.9), (424.0, 369.1)]]
lin = (np.arange(T) + 0.5) / T * 2 * HALF - HALF
X, Y = np.meshgrid(lin, lin[::-1])
R = np.hypot(X, Y)


def load(k):
    return np.fromfile(f"{D}/{k}_big.rgb", dtype=np.uint8).reshape(N, N, 3).astype(np.float32) / 255.0


def sample(im, px, py):
    x0 = np.clip(np.floor(px).astype(int), 0, N - 2); y0 = np.clip(np.floor(py).astype(int), 0, N - 2)
    fx = (px - x0); fy = (py - y0)
    if im.ndim == 3:
        fx = fx[..., None]; fy = fy[..., None]
    a = im[y0, x0]; b = im[y0, x0 + 1]; c = im[y0 + 1, x0]; d = im[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fit_index_ring(im):
    return 3573.44 - OX, 3102.9 - OY, 85.615, 11
    mx = im.max(2); mn = im.min(2)
    wm = (mn > 0.72) & ((mx - mn) < 0.2)          # lume bianco
    cx, cy, P = CX0, CY0, P0
    for it in range(5):
        cents = []
        for h in range(12):
            a = np.radians(30 * h)
            ux, uy = np.sin(a), -np.cos(a); tx, ty = np.cos(a), np.sin(a)
            Rr, Tt = np.meshgrid(np.arange(10.6, 13.3, 0.02), np.arange(-0.4, 0.4, 0.02))
            px = cx + (ux * Rr + tx * Tt) * P; py = cy + (uy * Rr + ty * Tt) * P
            v = wm[py.round().astype(int), px.round().astype(int)]
            if v.sum() > 50:
                cents.append((px[v].mean(), py[v].mean()))
        C = np.array(cents)
        A = np.c_[2 * C[:, 0], 2 * C[:, 1], np.ones(len(C))]
        s = np.linalg.lstsq(A, (C ** 2).sum(1), rcond=None)[0]
        d = np.sqrt(((C - s[:2]) ** 2).sum(1))
        keep = np.abs(d - np.median(d)) < 5
        s = np.linalg.lstsq(A[keep], (C[keep] ** 2).sum(1), rcond=None)[0]
        cx, cy = s[0], s[1]; P = np.sqrt(s[2] + cx ** 2 + cy ** 2) / 11.95
    return cx, cy, P, int(keep.sum())


def poly_mask(px, py, poly):
    inside = np.zeros(px.shape, bool)
    for i in range(len(poly)):
        x0, y0 = poly[i]; x1, y1 = poly[(i + 1) % len(poly)]
        inside ^= ((y0 > py) != (y1 > py)) & (px < (x1 - x0) * (py - y0) / (y1 - y0 + 1e-12) + x0)
    return inside


def dilate(m, n):
    out = m.copy()
    for _ in range(n):
        o = out.copy()
        o[1:] |= out[:-1]; o[:-1] |= out[1:]; o[:, 1:] |= out[:, :-1]; o[:, :-1] |= out[:, 1:]
        out = o
    return out


def up2(a, shape):
    """ingrandimento x2 bilineare (separabile)"""
    def up_axis(v, ax, n):
        p = np.concatenate([np.take(v, [0], ax), v, np.take(v, [-1], ax)], ax)
        L = np.take(p, range(0, p.shape[ax] - 2), ax); C = np.take(p, range(1, p.shape[ax] - 1), ax)
        Rr = np.take(p, range(2, p.shape[ax]), ax)
        e = 0.75 * C + 0.25 * L; o = 0.75 * C + 0.25 * Rr
        st = np.stack([e, o], ax + 1)
        sh = list(v.shape); sh[ax] *= 2
        return np.take(st.reshape(sh), range(n), ax)
    return up_axis(up_axis(a, 0, shape[0]), 1, shape[1])


def pull_push(img, known):
    w = known.astype(np.float32)
    levels = [(img * w[..., None], w)]
    while levels[-1][1].shape[0] > 8:
        c, ww = levels[-1]
        h2, w2 = c.shape[0] // 2, c.shape[1] // 2
        c2 = c[:h2 * 2, :w2 * 2].reshape(h2, 2, w2, 2, 3).sum((1, 3))
        ww2 = ww[:h2 * 2, :w2 * 2].reshape(h2, 2, w2, 2).sum((1, 3))
        levels.append((c2, ww2))
    c, ww = levels[-1]
    est = c / np.maximum(ww, 1e-6)[..., None]
    for c, ww in reversed(levels[:-1]):
        up = up2(est, c.shape[:2])
        wn = np.clip(ww, 0, 1)[..., None]
        est = (c / np.maximum(ww, 1e-6)[..., None]) * wn + up * (1 - wn)
    return est


def box_blur(img, r):
    out = img.astype(np.float32)
    for ax in (0, 1):
        pad = [(r + 1, r) if a == ax else (0, 0) for a in range(out.ndim)]
        cs = np.cumsum(np.pad(out, pad, mode="edge"), axis=ax)
        hi = [slice(None)] * out.ndim; lo = [slice(None)] * out.ndim
        hi[ax] = slice(2 * r + 1, None); lo[ax] = slice(0, -2 * r - 1)
        out = (cs[tuple(hi)] - cs[tuple(lo)]) / (2 * r + 1)
    return out


def text_zones():
    t = np.zeros((T, T), bool)
    t |= (np.abs(X) < 3.0) & (Y > 3.5) & (Y < 5.75)          # MONICHS
    t |= (np.abs(X) < 3.4) & (Y > -8.0) & (Y < -4.9)         # nome + AUTOMATIC
    return t


def sunset_hands():
    im = load("Sunset")
    cx, cy, P, _ = fit_index_ring(im)
    col = sample(im, cx + X * P, cy - Y * P)
    mx = col.max(2); mn = col.min(2); sat = (mx - mn) / np.maximum(mx, 1e-3)
    hands = (sat < 0.45) & (R < 13.4) & ~text_zones() & ~((R > 12.6) & (np.abs(Y) > 0) & False)
    # escludi indici e pittogramma (gestiti a parte) per avere solo lancette
    hands &= ~index_mask(0.45) & ~((np.abs(X) < 2.6) & (Y > 5.4) & (Y < 9.4))
    hands = dilate(hands, int(0.32 * PXMM))
    # pittogramma: bbox del bianco sopra MONICHS
    pic = (sat < 0.35) & (np.abs(X) < 2.6) & (Y > 5.4) & (Y < 9.4)
    ys, xs = Y[pic], X[pic]
    pb = (float(xs.min()), float(xs.max()), float(ys.min()), float(ys.max()))
    return hands, (cx, cy, P), pb


def index_mask(grow):
    m = np.zeros((T, T), bool)
    for h in range(12):
        g = TRAP if h % 3 == 0 else BAR
        a = np.radians(30 * h)
        U = X * np.sin(a) + Y * np.cos(a); Tt = X * np.cos(a) - Y * np.sin(a)
        wl = g["w0"] + (g["w1"] - g["w0"]) * (U - g["r0"]) / (g["r1"] - g["r0"])
        m |= (U > g["r0"] - grow) & (U < g["r1"] + grow) & (np.abs(Tt) < wl / 2 + grow)
    return m


def picto_mask(pb, grow):
    x0, x1, y0, y1 = pb
    s = (y1 - y0) / (713.2 - 368.9)
    cxp, cyp = (x0 + x1) / 2, (y0 + y1) / 2
    m = np.zeros((T, T), bool)
    for tri in PICTO:
        poly = [(cxp + (x - 538.95) * s, cyp - (y - 541.05) * s) for x, y in tri]
        m |= poly_mask(X, Y, poly)
    return dilate(m, int(grow * PXMM))


def build(k, offsets, H, sun_map, pb, mode):
    im = load(k)
    cx, cy, P, nk = fit_index_ring(im)
    col = sample(im, cx + X * P, cy - Y * P)
    # lancette: maschera di Sunset riportata in coordinate di questo file
    scx, scy, sP = sun_map
    px = cx + X * P; py = cy - Y * P
    Xs = (px - scx) / sP; Ys = (scy - py) / sP
    ix = np.clip(((Xs + HALF) / (2 * HALF) * T).astype(int), 0, T - 1)
    iy = np.clip(((HALF - Ys) / (2 * HALF) * T).astype(int), 0, T - 1)
    hands = H[iy, ix]
    g = 0.55 if mode == 'plain' else 0.4
    mask = (dilate(hands, int(0.12 * PXMM)) if mode == 'plain' else hands) | index_mask(g) | picto_mask(pb, 0.3) | (R < 1.7)
    tz0 = text_zones()
    # ombre: zone piu' scure del fondo locale vicino a lancette e indici
    lum = (col * [0.3, 0.59, 0.11]).sum(2)
    for it in range(2 if mode == 'shadow' else 0):
        kn = ~mask & (R < 14.15)
        lowl = box_blur((lum * kn)[..., None], 40)[..., 0] / np.maximum(box_blur(kn.astype(np.float32)[..., None], 40)[..., 0], 1e-3)
        ratio = box_blur(lum[..., None], 4)[..., 0] / np.maximum(lowl, 1e-3)
        near = dilate(mask, int(1.3 * PXMM))
        sh = (ratio < 0.88) & near & ~mask & (R < 14.1)
        mask |= dilate(sh, int(0.12 * PXMM))
    mask &= ~(tz0 & ~index_mask(0.4) & ~picto_mask(pb, 0.3))
    ring = R > 12.62
    known = ~mask & (R < 14.15)
    tz = text_zones()

    low = pull_push(col, known)
    kb = box_blur(known.astype(np.float32)[..., None], 6)
    blur = box_blur(col * known[..., None], 6) / np.maximum(kb, 1e-3)
    detail = np.where(known[..., None], col - blur, 0)
    fill = np.zeros_like(col); got = np.zeros((T, T), bool)
    # interno: traslazioni (da sorgenti interne, senza testi)
    src_ok_all = known & ~tz & ~ring
    for dx, dy in offsets:
        sx = int(round(dx * P0 / P * PXMM)); sy = int(round(-dy * P0 / P * PXMM))
        src_ok = np.roll(np.roll(src_ok_all, sy, 0), sx, 1)
        src = np.roll(np.roll(detail, sy, 0), sx, 1)
        take = mask & ~ring & ~got & src_ok
        fill[take] = src[take]; got |= take
    # anello minuti: rotazioni di multipli di 6 gradi
    ang = np.arctan2(X, Y); rr = R
    for dd in (6, -6, 12, -12, 18, -18):
        a2 = ang + np.radians(dd)
        Xr = rr * np.sin(a2); Yr = rr * np.cos(a2)
        jx = np.clip(((Xr + HALF) / (2 * HALF) * T).astype(int), 0, T - 1)
        jy = np.clip(((HALF - Yr) / (2 * HALF) * T).astype(int), 0, T - 1)
        take = mask & ring & ~got & known[jy, jx]
        fill[take] = (col[jy, jx] - low[jy, jx])[take]; got |= take
    out = col.copy()
    sel = mask | (R >= 14.15)
    out[sel] = (low + fill)[sel]
    if mode == "periodic":
        a1 = np.array([1.245, 0.013]) * P0 / P; a2 = np.array([0.611, 1.103]) * P0 / P
        Minv = np.linalg.inv(np.c_[a1, a2])
        sfr = (Minv[0, 0] * X + Minv[0, 1] * Y) % 1.0; tfr = (Minv[1, 0] * X + Minv[1, 1] * Y) % 1.0
        lumc = (col * [0.3, 0.59, 0.11]).sum(2)
        Kp = known & ~tz & (R < 12.3)
        rb = int(1.25 * PXMM)
        lowc = box_blur(col * Kp[..., None], rb) / np.maximum(box_blur(Kp.astype(np.float32)[..., None], rb), 1e-3)
        # scarta pixel in ombra (rispetto al fondo locale)
        rat = box_blur(lumc[..., None], 3)[..., 0] / np.maximum((lowc * [0.3, 0.59, 0.11]).sum(2), 1e-3)
        Kp2 = Kp & (rat > 0.82) & ~dilate(mask, int(0.25 * PXMM))
        lowc = box_blur(col * Kp2[..., None], rb) / np.maximum(box_blur(Kp2.astype(np.float32)[..., None], rb), 1e-3)
        cover = box_blur(Kp2.astype(np.float32)[..., None], rb)[..., 0]
        lowf = pull_push(lowc, cover > 0.35)
        Bt = 128
        bi = (sfr * Bt).astype(int) % Bt; bj = (tfr * Bt).astype(int) % Bt
        rel = col / np.maximum(lowf, 1e-3)
        sums = np.zeros((Bt * Bt, 3)); cnt = np.zeros(Bt * Bt)
        flat = (bi * Bt + bj)[Kp2]
        for c in range(3):
            sums[:, c] = np.bincount(flat, weights=rel[..., c][Kp2], minlength=Bt * Bt)
        cnt = np.bincount(flat, minlength=Bt * Bt)
        tile = (sums / np.maximum(cnt, 1)[:, None]).reshape(Bt, Bt, 3)
        synth = lowf * tile[bi, bj]
        inner = (R < 12.62) & ~(dilate(tz, int(0.05 * PXMM)) & ~mask)
        # sfumatura ai bordi dei testi
        wgt = box_blur(inner.astype(np.float32)[..., None], 6)[..., 0]
        wgt = np.where(R < 12.5, wgt, inner.astype(np.float32))
        out = out * (1 - wgt[..., None]) + synth * wgt[..., None]
        print("  celle per bin (media)", round(cnt.mean(), 1), "vuoti", int((cnt == 0).sum()))
    out = np.clip(out, 0, 1)
    lum = (out * [0.3, 0.59, 0.11]).sum(2)
    hp = lum - box_blur(lum[..., None], 10)[..., 0]
    gy, gx = np.gradient(hp)
    nrm = np.dstack([-gx * 6, gy * 6, np.ones_like(hp)])
    nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    (out * 255).round().astype(np.uint8).tofile(f"{D}/{k}_dial.rgb")
    ((nrm * 0.5 + 0.5) * 255).round().astype(np.uint8).tofile(f"{D}/{k}_dial_n.rgb")
    (mask * 255).astype(np.uint8).tofile(f"{D}/{k}_mask.gray")
    return dict(cx=float(cx + OX), cy=float(cy + OY), P=float(P), kept=nk)


if __name__ == "__main__":
    H, sun_map, pb = sunset_hands()
    print("pittogramma bbox (mm)", [round(v, 2) for v in pb])
    lat = json.load(open(f"{D}/lattice.json"))
    offs = {"Celeste": lat,
            "Sunset": [(2.3, 0.4), (-2.3, -0.4), (0.4, 2.6), (-0.4, -2.6), (4.1, 1.2), (-4.1, -1.2), (6.0, 0.5), (-6.0, -0.5)],
            "Virentia": [(2.7, 0.9), (-2.7, -0.9), (0.9, 2.9), (-0.9, -2.9), (4.4, -1.8), (-4.4, 1.8), (6.1, 0.3), (-6.1, -0.3)]}
    info = {"picto_bbox": pb}
    for k in ["Celeste", "Sunset", "Virentia"]:
        info[k] = build(k, offs[k], H, sun_map, pb, {'Celeste': 'periodic', 'Sunset': 'shadow', 'Virentia': 'plain'}[k])
        print(k, info[k])
    json.dump(info, open(f"{D}/dialinfo.json", "w"), indent=1)
