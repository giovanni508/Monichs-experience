"""Texture dei quadranti dagli scontornati: sfondo ricostruito + stampe originali sovrapposte.

- centro/scala comuni (le tre immagini condividono l'impianto): (3573.44, 3102.9), 85.615 px/mm
- lancette: maschera ricavata su Sunset e riusata (livello composito comune)
- interno: Celeste = cella periodica media del reticolo; Sunset/Virentia = bassa frequenza + dettaglio traslato
- anello minuti: sintesi periodica in coordinate polari (periodo 6 gradi)
- testi: pixel delle lettere dalla foto, sovrapposti con alfa morbido
"""
import numpy as np, json, os
from dialtex import (load, sample, dilate, pull_push, box_blur, index_mask, picto_mask, poly_mask,
                     X, Y, R, T, HALF, PXMM, OX, OY, P0)

D = os.path.dirname(os.path.abspath(__file__))
CX, CY, P = 3573.44 - OX, 3102.9 - OY, 85.615
RING0 = 12.62
ANG = np.degrees(np.arctan2(X, Y)) % 360.0


def zones():
    z = {}
    z["monichs"] = (np.abs(X) < 3.0) & (Y > 3.5) & (Y < 5.3)
    z["name"] = (np.abs(X) < 3.4) & (Y > -8.0) & (Y < -4.9)
    sw = (R > 12.85) & (R < 14.35) & (np.abs(((ANG - 180) + 180) % 360 - 180) < 24)
    z["swiss"] = sw
    return z


def sunset_hands(pb):
    """maschera geometrica delle lancette della foto (forme dal disegno, angoli misurati)"""
    hj = json.load(open(f"{D}/photo_hands.json"))
    px, py = hj["pivot"]
    def seg(ang, a, b, hw):
        t = np.radians(ang); ux, uy = np.sin(t), np.cos(t)
        u = (X - px) * ux + (Y - py) * uy; v = -(X - px) * uy + (Y - py) * ux
        return (u > a) & (u < b) & (np.abs(v) < hw)
    m = np.zeros(X.shape, bool)
    mg = 0.5
    m |= seg(hj["hour"], -2.53 - mg, 8.5 + mg, 1.05 + mg)
    m |= seg(hj["minute"], -2.53 - mg, 13.0 + mg, 0.96 + mg)
    m |= seg(hj["second"], -3.4 - mg, 13.13 + 0.3, 0.12 + 0.35)
    m |= seg(hj["second"], 6.6, 11.4, 0.8 + mg)
    t = np.radians(hj["second"])
    m |= np.hypot(X - (px - 2.87 * np.sin(t)), Y - (py - 2.87 * np.cos(t))) < 0.5 + mg
    m |= np.hypot(X - px, Y - py) < 1.6 + mg
    return m


def letters(col, zone, kind):
    """alfa delle lettere bianche nella zona"""
    mx = col.max(2); mn = col.min(2); sat = (mx - mn) / np.maximum(mx, 1e-3)
    lum = (col * [0.3, 0.59, 0.11]).sum(2)
    bg = box_blur(np.where(zone, lum, 0)[..., None], 25)[..., 0] / np.maximum(box_blur(zone.astype(np.float32)[..., None], 25)[..., 0], 1e-3)
    a = np.clip((lum - bg - 0.06) / 0.25, 0, 1) * np.clip((0.5 - sat) / 0.25, 0, 1)
    a = np.where(zone, a, 0)
    return np.clip(box_blur(a[..., None], 1)[..., 0] * 1.15, 0, 1)


def fill_interior(col, mask, mode, tz):
    known = ~mask & (R < RING0 - 0.1)
    low = pull_push(col, known)
    if mode == "periodic":
        a1 = np.array([1.245, 0.013]) * P0 / P; a2 = np.array([0.611, 1.103]) * P0 / P
        Minv = np.linalg.inv(np.c_[a1, a2])
        sfr = (Minv[0, 0] * X + Minv[0, 1] * Y) % 1.0; tfr = (Minv[1, 0] * X + Minv[1, 1] * Y) % 1.0
        rb = int(1.25 * PXMM)
        K = known & ~tz
        lumc = (col * [0.3, 0.59, 0.11]).sum(2)
        Kf = K.astype(np.float32)[..., None]
        cell = box_blur((lumc[..., None] * Kf), rb)[..., 0] / np.maximum(box_blur(Kf, rb)[..., 0], 1e-3)
        wide = box_blur((lumc[..., None] * Kf), 4 * rb)[..., 0] / np.maximum(box_blur(Kf, 4 * rb)[..., 0], 1e-3)
        shade = cell / np.maximum(wide, 1e-3)
        K2 = K & (shade > 0.9) & ~dilate(mask, int(0.6 * PXMM))
        K2f = K2.astype(np.float32)[..., None]
        cover = box_blur(K2f, rb)[..., 0]
        lowc = box_blur(col * K2f, rb) / np.maximum(box_blur(K2f, rb), 1e-3)
        # illuminazione liscia: polinomio di 4 grado, robusto (scarta le ombre)
        ok = (cover > 0.35) & (R < 12.4)
        sub = np.zeros_like(ok); sub[::6, ::6] = True
        sel = ok & sub
        xs, ys = X[sel] / 12.0, Y[sel] / 12.0
        def feats(x, y):
            return np.stack([x ** i * y ** j for i in range(5) for j in range(5 - i)], -1)
        Fm = feats(xs, ys); vals = lowc[sel]
        w = np.ones(len(xs), bool)
        for it in range(6):
            coef = np.linalg.lstsq(Fm[w], vals[w], rcond=None)[0]
            pred = Fm @ coef
            lum_r = (vals * [0.3, 0.59, 0.11]).sum(1) / np.maximum((pred * [0.3, 0.59, 0.11]).sum(1), 1e-3)
            w = lum_r > 0.94
        lowf = np.clip(feats(X / 12.0, Y / 12.0) @ coef, 0, 1)
        Bt = 128
        bi = (sfr * Bt).astype(int) % Bt; bj = (tfr * Bt).astype(int) % Bt
        rel = col - lowf
        flat = (bi * Bt + bj)[K2]
        cnt = np.bincount(flat, minlength=Bt * Bt)
        tile = np.stack([np.bincount(flat, weights=rel[..., c][K2], minlength=Bt * Bt) for c in range(3)], 1)
        tile = (tile / np.maximum(cnt, 1)[:, None]).reshape(Bt, Bt, 3)
        return np.clip(lowf + tile[bi, bj], 0, 1)
    # dettaglio traslato
    kb = box_blur(known.astype(np.float32)[..., None], 6)
    blur = box_blur(col * known[..., None], 6) / np.maximum(kb, 1e-3)
    det = np.where(known[..., None], col - blur, 0)
    out = col.copy(); got = ~mask
    out[mask] = low[mask]
    srcok = known & ~tz
    for dx, dy in [(2.7, 0.9), (-2.7, -0.9), (0.9, 2.9), (-0.9, -2.9), (4.4, -1.8), (-4.4, 1.8), (6.1, 0.3), (-6.1, -0.3), (1.3, -5.2), (-1.3, 5.2)]:
        sx = int(round(dx * PXMM)); sy = int(round(-dy * PXMM))
        ok = np.roll(np.roll(srcok, sy, 0), sx, 1); src = np.roll(np.roll(det, sy, 0), sx, 1)
        take = ~got & ok
        out[take] = low[take] + src[take]; got |= take
    return out


def polar_ring(col, mask):
    """anello minuti sintetizzato in coordinate polari: periodo 6 gradi"""
    nr, nt = 220, 7200
    rr = np.linspace(RING0 - 0.15, HALF + 0.05, nr)
    tt = np.linspace(0, 360, nt, endpoint=False)
    RR, TT = np.meshgrid(rr, tt, indexing="ij")
    px = CX + RR * np.sin(np.radians(TT)) * P; py = CY - RR * np.cos(np.radians(TT)) * P
    pol = sample(LOADED, px, py)
    # maschera in polare
    mx_ = ((RR * np.sin(np.radians(TT)) + HALF) / (2 * HALF) * T).astype(int).clip(0, T - 1)
    my_ = ((HALF - RR * np.cos(np.radians(TT))) / (2 * HALF) * T).astype(int).clip(0, T - 1)
    pm = mask[my_, mx_]
    # esclusione extra attorno agli indici (ombre sull'anello) e zona SWISS MADE
    hour_d = np.abs(((TT + 15) % 30) - 15)                   # distanza angolare dall'ora piu' vicina
    pm |= hour_d < np.degrees(2.2 / 13.5)
    pm |= (np.abs(TT - 180) < 24)
    known = ~pm & (RR < 14.2)
    # illuminazione: media su finestre di 12 gradi (2 periodi) per ogni raggio
    w = 240
    def tblur(a):
        c = np.cumsum(np.concatenate([a[:, -w:], a, a[:, :w]], 1), 1)
        return (c[:, 2 * w:] - c[:, :-2 * w]) / (2 * w)
    kf = known.astype(np.float32)
    L = np.stack([tblur(pol[..., c] * kf) for c in range(3)], -1) / np.maximum(tblur(kf), 1e-3)[..., None]
    # dove mancano dati, interpola lungo l'angolo con finestra piu' larga
    cov = tblur(kf)
    w2 = 720
    def tblur2(a):
        c = np.cumsum(np.concatenate([a[:, -w2:], a, a[:, :w2]], 1), 1)
        return (c[:, 2 * w2:] - c[:, :-2 * w2]) / (2 * w2)
    L2 = np.stack([tblur2(pol[..., c] * kf) for c in range(3)], -1) / np.maximum(tblur2(kf), 1e-3)[..., None]
    L = np.where((cov > 0.25)[..., None], L, L2)
    cov2 = tblur2(kf)
    full = (pol * kf[..., None]).sum(1) / np.maximum(kf.sum(1), 1)[:, None]
    L = np.where(((cov > 0.25) | (cov2 > 0.1))[..., None], L, full[:, None, :])
    # righe senza dati (oltre il bordo visibile): copia la riga valida piu' vicina
    rowok = kf.sum(1) > 50
    last = np.where(rowok)[0]
    for i in range(len(rr)):
        if not rowok[i]:
            j = last[np.argmin(np.abs(last - i))]
            L[i] = L[j]
    rel = pol / np.maximum(L, 1e-3)
    per = 120                                                # 6 gradi = 120 campioni
    ph = np.arange(nt) % per
    tile = np.zeros((nr, per, 3)); cnt = np.zeros((nr, per))
    for p_ in range(per):
        cols = (ph == p_)
        kk = known[:, cols]
        tile[:, p_] = (rel[:, cols] * kk[..., None]).sum(1) / np.maximum(kk.sum(1), 1)[:, None]
        cnt[:, p_] = kk.sum(1)
    tile = np.where((cnt > 0)[..., None], tile, 1.0)
    syn = L * tile[:, ph]
    # oltre 14.2 (sotto la lunetta) prolunga il valore a 14.15
    edge = np.searchsorted(rr, 14.15)
    syn[edge:] = syn[edge - 1:edge]
    # ritorno in cartesiane
    ri = ((R - rr[0]) / (rr[1] - rr[0])).clip(0, nr - 1.001)
    ti = (ANG / 360 * nt) % nt
    r0 = ri.astype(int); fr = (ri - r0)[..., None]
    t0 = ti.astype(int) % nt; t1 = (t0 + 1) % nt; ft = (ti - np.floor(ti))[..., None]
    v = (syn[r0, t0] * (1 - ft) + syn[r0, t1] * ft) * (1 - fr) + (syn[np.minimum(r0 + 1, nr - 1), t0] * (1 - ft) + syn[np.minimum(r0 + 1, nr - 1), t1] * ft) * fr
    return v


def build(k, mode, H, pb):
    global LOADED
    im = load(k); LOADED = im
    col = sample(im, CX + X * P, CY - Y * P)
    z = zones(); tz = z["monichs"] | z["name"]
    mask = H | index_mask(0.8) | picto_mask(pb, 0.45) | (R < 2.0)
    if mode != "periodic":
        lum = (col * [0.3, 0.59, 0.11]).sum(2)
        for it in range(2):
            kn = ~mask & (R < RING0)
            lowl = box_blur((lum * kn)[..., None], 40)[..., 0] / np.maximum(box_blur(kn.astype(np.float32)[..., None], 40)[..., 0], 1e-3)
            ratio = box_blur(lum[..., None], 5)[..., 0] / np.maximum(lowl, 1e-3)
            sh = (ratio < (0.86 if mode == "shadow" else 0.7)) & dilate(mask, int(1.2 * PXMM)) & ~mask & (R < RING0)
            mask |= dilate(sh, int(0.15 * PXMM))
    inner = fill_interior(col, mask & ~tz | (mask & tz & dilate(index_mask(0.8) | picto_mask(pb, 0.45), 2)), mode, tz)
    if mode == "periodic":
        base = inner
    else:
        base = inner
    # testi interni: dove la zona testo era mascherata solo da ombre, ripristina la foto
    ring = polar_ring(col, mask)
    wr = np.clip((R - RING0 + 0.06) / 0.12, 0, 1)[..., None]
    out = base * (1 - wr) + ring * wr
    # stampe originali sovrapposte
    for name in ("monichs", "name", "swiss"):
        a = letters(col, z[name] & ~dilate(index_mask(0.15), 1) & ~H, name)[..., None]
        out = out * (1 - a) + col * a
    out = np.clip(out, 0, 1)
    lum = (out * [0.3, 0.59, 0.11]).sum(2)
    hp = lum - box_blur(lum[..., None], 10)[..., 0]
    gy, gx = np.gradient(hp)
    nrm = np.dstack([-gx * 6, gy * 6, np.ones_like(hp)])
    nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    (out * 255).round().astype(np.uint8).tofile(f"{D}/{k}_dial.rgb")
    ((nrm * 0.5 + 0.5) * 255).round().astype(np.uint8).tofile(f"{D}/{k}_dial_n.rgb")


if __name__ == "__main__":
    pb = (-1.99, 2.06, 5.52, 8.49)
    H = sunset_hands(pb)
    for k, mode in (("Celeste", "periodic"), ("Sunset", "shadow"), ("Virentia", "plain")):
        build(k, mode, H, pb)
        print("ok", k)
    json.dump(dict(cx=CX + OX, cy=CY + OY, P=P, picto_bbox=pb), open(f"{D}/dialinfo.json", "w"))
