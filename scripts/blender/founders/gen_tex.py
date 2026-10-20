"""Texture dei fondatori v3 ("meno uncanny"): pelle beige opaca a zone, AO cotta, sopracciglia morbide,
attaccatura dei capelli pulita, cucitura dei baffi tolta.

Ogni texel sa dov'e' sul volto grazie a una mappa di posizione cotta in Blender (EMIT su immagine float),
e si scurisce nelle pieghe con una mappa AO cotta con Cycles. Tutto su texture a 2048 px.
"""
import bmesh
import bpy
import numpy as np
from mathutils.kdtree import KDTree


def ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def _img_np(img):
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def _blur(a, rad):
    """sfocatura a scatola separabile (rad in pixel), su array (H, W) o (H, W, C)"""
    if rad < 1:
        return a
    k = np.ones(2 * rad + 1, np.float32) / (2 * rad + 1)
    out = a
    for ax in (0, 1):
        pad = [(0, 0)] * out.ndim
        pad[ax] = (rad, rad)
        p = np.pad(out, pad, mode="edge")
        c = np.cumsum(p, axis=ax, dtype=np.float64)
        c = np.concatenate([np.zeros_like(np.take(c, [0], axis=ax)), c], axis=ax)
        n = out.shape[ax]
        hi = np.take(c, np.arange(2 * rad + 1, 2 * rad + 1 + n), axis=ax)
        lo = np.take(c, np.arange(0, n), axis=ax)
        out = ((hi - lo) / (2 * rad + 1)).astype(np.float32)
    return out


def _flood(seed, allowed, max_iter=6000):
    """riempimento per connessione (4 vicini) nello spazio della texture"""
    r = seed & allowed
    for _ in range(max_iter):
        d = r.copy()
        d[1:] |= r[:-1]; d[:-1] |= r[1:]; d[:, 1:] |= r[:, :-1]; d[:, :-1] |= r[:, 1:]
        d &= allowed
        if not (d & ~r).any():
            break
        r = d
    return r


def bake_maps(ob, size=2048, ao_distance=0.025, samples=48):
    """posizione (oggetto) e AO per texel, sulle UV della mesh. Restituisce (POS (H,W,3), VALID (H,W), AO (H,W))"""
    sc = bpy.context.scene
    me2 = ob.data.copy()
    ob2 = bpy.data.objects.new(ob.name + "_bake", me2)
    sc.collection.objects.link(ob2)
    bpy.context.view_layer.update()
    if me2.shape_keys:
        ob2.shape_key_clear()
    bm = bmesh.new(); bm.from_mesh(me2)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != 0], context="FACES")
    bm.to_mesh(me2); bm.free()
    P = np.empty(len(me2.vertices) * 3, np.float32); me2.vertices.foreach_get("co", P); P = P.reshape(-1, 3)
    mn, mx = P.min(0) - 1e-3, P.max(0) + 1e-3
    mat = bpy.data.materials.new("bake_pos"); mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sub = nt.nodes.new("ShaderNodeVectorMath"); sub.operation = "SUBTRACT"; sub.inputs[1].default_value = tuple(mn)
    mul = nt.nodes.new("ShaderNodeVectorMath"); mul.operation = "MULTIPLY"; mul.inputs[1].default_value = tuple(1 / (mx - mn))
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(tc.outputs["Object"], sub.inputs[0]); nt.links.new(sub.outputs[0], mul.inputs[0])
    nt.links.new(mul.outputs[0], em.inputs[0]); nt.links.new(em.outputs[0], nt.nodes["Material Output"].inputs[0])
    img_p = bpy.data.images.new("bake_pos", size, size, alpha=True, float_buffer=True)
    img_p.generated_color = (0, 0, 0, 0)
    tx = nt.nodes.new("ShaderNodeTexImage"); tx.image = img_p; nt.nodes.active = tx
    me2.materials.clear(); me2.materials.append(mat)
    for p in me2.polygons:
        p.material_index = 0
    for o in bpy.context.view_layer.objects:
        o.select_set(o == ob2)
    bpy.context.view_layer.objects.active = ob2
    hide = [o for o in sc.objects if o != ob2 and not o.hide_render]
    for o in hide:
        o.hide_render = True
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.render.bake.margin = 6
    sc.render.bake.use_clear = True
    bpy.ops.object.bake(type="EMIT")
    POSN = _img_np(img_p)
    VALID = POSN[..., 3] > 0.5
    POS = mn + POSN[..., :3] * (mx - mn)
    # AO
    img_a = bpy.data.images.new("bake_ao", size, size, alpha=False, float_buffer=True)
    tx.image = img_a
    if sc.world is None:
        sc.world = bpy.data.worlds.new("w")
    sc.world.light_settings.distance = ao_distance
    bpy.ops.object.bake(type="AO")
    AO = _img_np(img_a)[..., 0]
    for o in hide:
        o.hide_render = False
    bpy.data.objects.remove(ob2)
    bpy.data.images.remove(img_p); bpy.data.images.remove(img_a)
    print("baked maps: valid texels", int(VALID.sum()))
    return POS, VALID, AO


def improve(base_img, POS, VALID, AO, L, analyze_only=False):
    """L: punti di riferimento del volto (metri, sistema del modello):
    eyes {L,R: ac(x,z), ahw, ahh, C}, MC, MW, eye_z, neck_z, XC, beard (bool), hair_rgb_hint"""
    H, W = base_img.size[1], base_img.size[0]
    A = _img_np(base_img)
    rgb = A[..., :3].copy()
    x, y, z = POS[..., 0], POS[..., 1], POS[..., 2]
    V = rgb.max(-1); S = (V - rgb.min(-1)) / np.maximum(V, 1e-4)
    lum = rgb @ np.array([0.30, 0.59, 0.11], np.float32)
    skin = VALID & (rgb[..., 0] >= rgb[..., 1]) & (rgb[..., 1] >= rgb[..., 2] * 0.85) & (S > 0.12) & (S < 0.62) & (V > 0.38)
    head = VALID & (z > L["neck_z"])
    MC, MW, ez = L["MC"], L["MW"], L["eye_z"]
    front = y < MC[1] + 1.2 * MW
    # --- sopracciglia ridisegnate (prima di toccare la pelle: si legge la forma originale).
    # Dall'originale si prendono solo posizione, arco e spessore; il disegno nuovo ha la testa tonda, la coda che si
    # assottiglia e il bordo morbido spezzato in peli. Il vecchio blocco si cancella tutto, coda compresa (prima
    # restava un pezzo fuori dalla zona frontale: un segno scuro sulla tempia). I capelli non si toccano: sono le
    # zone scure collegate alla massa dei capelli sopra la fronte.
    dark_all = VALID & (V < 0.33)
    top_brow = max(e["ac"][1] + 6.0 * e["ahh"] for e in L["eyes"].values())
    hair_conn = _flood(dark_all & (z > top_brow), dark_all)
    BR = {}
    brow_all = np.zeros((H, W), np.float32)
    for sfx, e in L["eyes"].items():
        sgn = 1 if sfx == "L" else -1
        acx, acz = e["ac"]; ahw, ahh = e["ahw"], e["ahh"]
        Cy, Re = e["C"][1], e["R"]
        zone = VALID & (np.abs(x - acx) < 2.1 * ahw) & (z > acz + 0.9 * ahh) & (z < acz + 4.6 * ahh) & \
            (y < Cy + 1.6 * Re) & ~hair_conn          # la coda gira verso la tempia (e dopo lo spianamento arretra)
        if zone.sum() < 50:
            continue
        zfit = zone & (y < Cy + 1.0 * Re)
        sk = zone & skin
        skin_med = np.median(rgb[sk], axis=0) if sk.sum() > 30 else np.array([0.8, 0.62, 0.52], np.float32)
        Vz = V[zfit]
        v_skin = float(np.percentile(Vz, 80)); v_dark = float(np.percentile(Vz, 6))
        dark = np.clip((v_skin - V) / max(v_skin - v_dark, 1e-3), 0, 1) * zone
        mb = _blur(dark, 2)
        u = sgn * (x - acx)                                      # lungo il sopracciglio: verso la tempia
        on = zfit & (mb > 0.5) & (y < Cy + 0.25 * Re)
        if on.sum() < 200:
            continue
        u0, u1 = float(np.percentile(u[on], 1.5)), float(np.percentile(u[on], 97.5))
        edges = np.linspace(u0, u1, 25)
        uc, cc, th, wt = [], [], [], []
        for i in range(24):
            zz = z[on & (u >= edges[i]) & (u < edges[i + 1])]
            if zz.size < 8:
                continue
            top, bot = np.percentile(zz, 92), np.percentile(zz, 8)
            uc.append(0.5 * (edges[i] + edges[i + 1])); cc.append(0.5 * (top + bot)); th.append(top - bot); wt.append(zz.size)
        uc, cc, th, wt = map(np.array, (uc, cc, th, wt))
        cf = np.polyfit(uc, cc, 2, w=np.sqrt(wt))
        res = np.abs(np.polyval(cf, uc) - cc)
        keep = res < max(2.5 * np.median(res), 1e-4)
        cf = np.polyfit(uc[keep], cc[keep], 2, w=np.sqrt(wt[keep]))     # arco senza i pezzi storti
        s_c = (uc - u0) / (u1 - u0)
        mid = (s_c > 0.12) & (s_c < 0.55)
        Hh = 0.5 * float(np.median(th[mid] if mid.sum() >= 3 else th)) * 0.95
        # in coordinate relative all'occhio (u gia' relativo; z - acz), per poterle mediare fra i due lati
        cf_rel = cf.copy(); cf_rel[-1] -= acz
        band = zone & (np.abs(z - np.polyval(cf, u)) < 2.4 * Hh / 0.95) & (u > u0 - 0.35 * ahw) & (u < u1 + 0.35 * ahw)
        band_s = np.clip(_blur(band.astype(np.float32), 6) * 1.5, 0, 1) * zone
        dark = dark * band_s                                  # solo il vecchio sopracciglio, non l'attaccatura
        BR[sfx] = dict(u0=u0 / ahw, u1=u1 / ahw, Hh=Hh / ahw, cf=cf_rel, ahw=ahw, zone=zone, dark=dark, sk=sk,
                       erase=np.clip(3.0 * _blur((dark > 0.12).astype(np.float32), 16), 0, 1) * band_s,
                       band=band_s, skin_med=skin_med)
    if len(BR) == 2:
        # i volti sono simmetrici: stessi parametri ai due lati; la coda piu' corta delle due (l'altra entra nei capelli)
        u0_s = float(np.mean([b["u0"] for b in BR.values()])); u1_s = min(min(b["u1"] for b in BR.values()), 3.1)
        Hh_s = float(np.mean([b["Hh"] for b in BR.values()]))
        # arco: media dei polinomi in unita' di occhio (u/ahw, z/ahw)
        cfs = []
        for b in BR.values():
            a2, a1, a0 = b["cf"]; k_ = b["ahw"]
            cfs.append(np.array([a2 * k_, a1, a0 / k_]))
        cf_s = np.mean(cfs, 0)
        for b in BR.values():
            k_ = b["ahw"]
            b.update(u0=u0_s, u1=u1_s, Hh=Hh_s, cf=np.array([cf_s[0] / k_, cf_s[1], cf_s[2] * k_]))
        print("brows symmetric: length", round(u1_s - u0_s, 2), "x eye half-width, half thickness", round(Hh_s, 3))
    if analyze_only:                       # solo l'impronta del vecchio sopracciglio (per spianare la geometria prima)
        return BR
    if L.get("brow_prior_Hh"):
        for b in BR.values():
            b["Hh"] = max(b["Hh"], L["brow_prior_Hh"])
    for sfx, b in BR.items():
        e = L["eyes"][sfx]
        sgn = 1 if sfx == "L" else -1
        acx, acz = e["ac"]; ahw, ahh = e["ahw"], e["ahh"]
        Cy, Re = e["C"][1], e["R"]
        zone, dark, sk, skin_med = b["zone"], b["dark"], b["sk"], b["skin_med"]
        u = sgn * (x - acx)
        u0, u1, Hh = b["u0"] * ahw, b["u1"] * ahw, b["Hh"] * ahw
        cf = b["cf"].copy(); cf[-1] += acz
        s = (u - u0) / (u1 - u0)                                  # 0 = testa (naso), 1 = coda (tempia)
        du = u - u0
        prof = (1 - 0.78 * ss(0.45, 1.0, s)) * (1 - ss(0.97, 1.06, s))
        cap = np.sqrt(np.clip(1 - ((Hh - du) / Hh) ** 2, 0, 1))         # testa tonda: mezzo cerchio
        half = Hh * prof * np.where(du < Hh, cap, 1.0) * (du > 0)
        dz = z - np.polyval(cf, u)
        dist = np.abs(dz)
        soft = 0.20 * Hh
        m = ss(half + 0.5 * soft, half - 0.5 * soft, dist) * (half > 0)
        # peli: tratti che alla testa salgono quasi dritti e verso la coda seguono il sopracciglio
        a = np.radians(68 - 52 * ss(0.0, 0.6, s))
        ph = (2 * np.pi / (0.22 * Hh)) * (-du * np.sin(a) + dz * np.cos(a))
        strokes = 0.5 + 0.5 * np.sin(ph + 1.7 * np.sin(0.37 * ph + du * (2 * np.pi / (1.3 * Hh))))
        ef = ss(0.45, 1.0, dist / np.maximum(half, 1e-6))              # 1 sul bordo
        m = m * (1 - 0.55 * ef * (1 - strokes) * (1 - 0.7 * ss(0.55, 1.0, s))) * (VALID & (y < Cy + 1.6 * Re) & (np.abs(x - acx) < 2.3 * ahw))
        brow_col = np.array(L.get("brow_rgb", (0.17, 0.11, 0.08)), np.float32)
        tone = (0.86 + 0.14 * (1 - strokes) + 0.18 * ef)[..., None]
        # cancellazione del vecchio: la pelle intorno riempie il buco (convoluzione normalizzata, non una toppa piatta)
        old = (dark > 0.12).astype(np.float32)
        old_d = np.clip(3.0 * _blur(old, 4), 0, 1) * b["band"]
        skw = (sk & (_blur(dark, 3) < 0.05) & (old_d < 0.05)).astype(np.float32)
        den = _blur(skw, 25)
        fill = _blur(rgb * skw[..., None], 25) / np.maximum(den[..., None], 1e-3)
        fill = np.where((den > 0.02)[..., None], fill, skin_med)
        dark_e = np.maximum(old_d, dark)
        BR[sfx]["erase"] = old_d
        base = np.where(zone[..., None], rgb * (1 - dark_e[..., None]) + fill * dark_e[..., None], rgb)
        rgb = base * (1 - m[..., None] * 0.96) + (brow_col * tone) * (m[..., None] * 0.96)
        brow_all = np.maximum(brow_all, m)
        print(sfx, "brow redrawn: texels", int((m > 0.5).sum()), "half thickness mm", round(1000 * Hh, 2),
              "length mm", round(1000 * (u1 - u0), 1))
    V = rgb.max(-1); S = (V - rgb.min(-1)) / np.maximum(V, 1e-4)
    lum = rgb @ np.array([0.30, 0.59, 0.11], np.float32)
    skin = VALID & (rgb[..., 0] >= rgb[..., 1]) & (rgb[..., 1] >= rgb[..., 2] * 0.85) & (S > 0.10) & (S < 0.62) & (V > 0.36)
    # --- attorno agli occhi: niente ombretto ne' occhiaie dipinte (la profondita' la danno geometria e luce).
    # Si schiarisce verso la pelle vicina solo cio' che e' piu' scuro; sopra, solo fino alla piega della palpebra.
    for e in L["eyes"].values():
        acx, acz = e["ac"]; ahw, ahh = e["ahw"], e["ahh"]
        d_e = np.sqrt(((x - acx) / ahw) ** 2 + ((z - acz) / ahh) ** 2)
        reg = VALID & (y < e["C"][1] + 0.6 * e["R"]) & (d_e < 2.8) & (z < acz + 1.2 * ahh)
        skw = (reg & skin & (d_e > 2.0)).astype(np.float32)
        den = _blur(skw, 40)
        fill = _blur(rgb * skw[..., None], 40) / np.maximum(den[..., None], 1e-3)
        wl = np.array([0.30, 0.59, 0.11], np.float32)
        lf, lr = fill @ wl, rgb @ wl
        darker = np.clip((lf - lr) / np.maximum(0.25 * lf, 1e-3), 0, 1)
        w_ = darker * (1 - ss(1.7, 2.6, d_e)) * reg * (den > 0.02) * 0.85
        rgb = rgb * (1 - w_[..., None]) + fill * w_[..., None]
        print("eye surroundings texture: texels lightened", int((w_ > 0.2).sum()))
    V = rgb.max(-1); S = (V - rgb.min(-1)) / np.maximum(V, 1e-4)
    lum = rgb @ np.array([0.30, 0.59, 0.11], np.float32)
    # --- capelli: macchie color pelle dentro i capelli e attaccatura morbida
    hair = VALID & (V < 0.32) & (z > ez + 0.2 * MW)
    hfrac = _blur(hair.astype(np.float32), 7)
    hair_col = _blur(rgb * hair[..., None], 7) / np.maximum(hfrac[..., None], 1e-3)
    spots = skin & (z > ez + 0.6 * MW) & (hfrac > 0.55)
    rgb = np.where(spots[..., None], hair_col, rgb)
    band = VALID & (z > ez + 0.6 * MW) & (hfrac > 0.3) & (hfrac < 0.55) & skin
    w_band = ss(0.3, 0.55, hfrac)[..., None] * 0.3
    rgb = np.where(band[..., None], rgb * (1 - w_band) + hair_col * w_band, rgb)
    print("hair spots fixed", int(spots.sum()), "hairline texels softened", int(band.sum()))
    # attaccatura: ciuffi scuri sottili dipinti sulla pelle e attaccati ai capelli (alla tempia sembravano crepe).
    # Apertura morfologica: resta la massa dei capelli, spariscono i filamenti circondati da pelle (non la barba,
    # non le sopracciglia nuove, non le ciocche dentro i capelli)
    hd = hair_conn & (V < 0.33)
    op = hd.copy()
    for _ in range(4):
        op = op & np.roll(op, 1, 0) & np.roll(op, -1, 0) & np.roll(op, 1, 1) & np.roll(op, -1, 1)
    for _ in range(5):
        op = op | np.roll(op, 1, 0) | np.roll(op, -1, 0) | np.roll(op, 1, 1) | np.roll(op, -1, 1)
    near_skin = _blur(skin.astype(np.float32), 6) > 0.30
    temple = np.zeros_like(hd)
    for e in L["eyes"].values():
        dx_ = np.abs(x - e["ac"][0]) / e["ahw"]
        temple |= (dx_ > 1.1) & (dx_ < 2.8) & (z > e["ac"][1] + 0.5 * e["ahh"]) & (z < e["ac"][1] + 5.5 * e["ahh"])
    thin = hd & ~op & near_skin & (brow_all < 0.05) & head & temple
    thin_w = np.clip(_blur(thin.astype(np.float32), 1) * 1.5, 0, 1) * (brow_all < 0.05)
    skw = (skin & ~_blur(thin.astype(np.float32), 3).astype(bool)).astype(np.float32)
    den = _blur(skw, 12)
    fill = _blur(rgb * skw[..., None], 12) / np.maximum(den[..., None], 1e-3)
    thin_w = thin_w * (den > 0.05)
    rgb = rgb * (1 - thin_w[..., None]) + fill * thin_w[..., None]
    print("hairline wisps removed", int(thin.sum()))
    # --- cucitura verticale al centro dei baffi (Giovanni): media dei colori a destra e a sinistra, in 3D
    if L.get("beard"):
        XC = L["XC"]
        seam = VALID & front & (np.abs(x - XC) < 0.10 * MW) & (z > MC[2] + 0.08 * MW) & (z < MC[2] + 0.95 * MW)
        if seam.sum():
            idx = np.flatnonzero(VALID & front & (np.abs(z - MC[2]) < 1.2 * MW) & (np.abs(x - XC) < 0.6 * MW))
            kd = KDTree(len(idx))
            Pf = POS.reshape(-1, 3); Cf = rgb.reshape(-1, 3)
            for n_, i in enumerate(idx):
                kd.insert(Pf[i], n_)
            kd.balance()
            out = rgb.reshape(-1, 3).copy()
            for i in np.flatnonzero(seam.ravel()):
                p = Pf[i]
                off = 0.16 * MW
                cols = []
                for dx in (-off, off):
                    q = (p[0] + dx, p[1], p[2])
                    for co, j, dist in kd.find_n(q, 4):
                        cols.append(Cf[idx[j]])
                if cols:
                    t_ = 1 - abs(p[0] - XC) / (0.10 * MW)
                    out[i] = Cf[i] * (1 - t_) + np.mean(cols, 0) * t_
            rgb = out.reshape(H, W, 3)
            print("moustache seam texels", int(seam.sum()))
    # --- pelle: beige caldo, meno saturo, un poco piu' chiara (sotto le luci calde della stanza usciva arancione)
    tint = np.array([1.0, 0.80, 0.665], np.float32)
    tint_l = float(tint @ np.array([0.30, 0.59, 0.11], np.float32))
    beige = lum[..., None] / tint_l * tint
    skin_soft = VALID & (rgb[..., 0] >= rgb[..., 1]) & (rgb[..., 1] >= rgb[..., 2] * 0.8) & (S > 0.10)
    wsk = skin_soft * ss(0.36, 0.45, V) * (1 - ss(0.68, 0.85, S))
    rgb = np.where(wsk[..., None] > 0, rgb * (1 - 0.45 * wsk[..., None]) + beige * (0.45 * wsk[..., None]), rgb)
    rgb = np.where(wsk[..., None] > 0, rgb * (1 + 0.03 * wsk[..., None]), rgb)
    # zone di colore: guance, naso, orecchie appena rosati; mascella un po' piu' fredda
    exL = L["eyes"]["L"]["ac"][0]
    rose = np.zeros((H, W), np.float32)
    zc = MC[2] + 0.55 * (ez - MC[2])
    for s_ in (1, -1):
        cx = L["XC"] + s_ * 1.18 * abs(exL - L["XC"])
        rose += np.exp(-(((x - cx) / (0.55 * abs(exL - L["XC"]))) ** 2 + ((z - zc) / (0.30 * (ez - MC[2]))) ** 2))
    nz = MC[2] + 0.62 * (ez - MC[2])
    rose += 0.35 * np.exp(-(((x - L["XC"]) / (0.30 * MW)) ** 2 + ((z - nz) / (0.25 * (ez - MC[2]))) ** 2)) * front
    ears = (np.abs(x - L["XC"]) > L["x_ear"] * 0.92) & (z > MC[2] - 0.2 * MW) & (z < ez + 0.6 * MW)
    rose += 0.7 * ears
    rose = np.clip(rose, 0, 1) * head * skin_soft
    rgb = rgb * (1 - 0.40 * rose[..., None]) + rgb * np.array([1.06, 0.92, 0.90], np.float32) * (0.40 * rose[..., None])
    jawz = head & front & (z < MC[2] - 0.25 * MW) & skin
    rgb = np.where(jawz[..., None], rgb * np.array([0.985, 0.995, 1.015], np.float32), rgb)
    # tono d'insieme: la fronte va al colore obiettivo (riferimento di stile meno saturo del 15%, chiaro come lui);
    # guadagno per canale sulla sola pelle, le variazioni (guance, naso, orecchie) restano
    if L.get("skin_target") is not None:
        fh = head & front & skin_soft & (z > ez + 0.5 * MW) & (np.abs(x - L["XC"]) < 0.8 * MW) & (wsk > 0.8)
        if fh.sum() > 200:
            cur = np.median(rgb[fh], axis=0)
            gain = np.clip(np.array(L["skin_target"], np.float32) / 255.0 / np.maximum(cur, 1e-3), 0.8, 1.35)
            rgb = rgb * (1 - wsk[..., None]) + np.clip(rgb * gain, 0, 1) * wsk[..., None]
            print("skin tone: forehead", (cur * 255).round().astype(int).tolist(), "gain", gain.round(3).tolist())
    # --- AO nelle pieghe (se gia' cotta; altrimenti apply_ao dopo aver spianato la geometria)
    if AO is not None:
        rgb = _ao_mul(rgb, AO, x, z, head, front, L)
    nimg = L.get("normal_img")
    if nimg is not None:
        if tuple(nimg.size) != (W, H):
            nimg.scale(W, H)
        Nm = _img_np(nimg)
        Vf = rgb.max(-1); Sf = (Vf - rgb.min(-1)) / np.maximum(Vf, 1e-4)
        skin_f = (rgb[..., 0] >= rgb[..., 1]) & (rgb[..., 1] >= rgb[..., 2] * 0.8) & (Vf > 0.45) & (Sf > 0.08)
        face_f = head & (np.abs(x - L["XC"]) < L["x_ear"] * 0.92) & (y < MC[1] + 2.6 * MW)
        keep = _blur((hair_conn & (np.abs(x - L["XC"]) > 0)).astype(np.float32), 3) > 0.3      # capelli: dettaglio vero
        flat = face_f & ~keep & skin_f
        for sfx_, b_ in BR.items():
            flat |= (b_["zone"] | (b_["erase"] > 0.02)) & face_f              # sopracciglia vecchie e nuove
        for e in L["eyes"].values():
            d_e = np.sqrt(((x - e["ac"][0]) / e["ahw"]) ** 2 + ((z - e["ac"][1]) / e["ahh"]) ** 2)
            flat |= (d_e < 3.0) & face_f & ~keep
        if L.get("beard"):
            flat &= ~((z < MC[2] + 0.95 * MW) & ~skin_f)                         # la barba tiene il suo rilievo
        wn = np.clip(_blur(flat.astype(np.float32), 4), 0, 1) * 0.92 * VALID
        n3 = Nm[..., :3] * 2 - 1
        n3 = n3 * (1 - wn[..., None]) + np.array([0, 0, 1.0], np.float32) * wn[..., None]
        n3 /= np.maximum(np.linalg.norm(n3, axis=-1, keepdims=True), 1e-6)
        Nm[..., :3] = n3 * 0.5 + 0.5
        nimg.pixels.foreach_set(Nm.ravel()); nimg.update(); nimg.pack()
        print("normal map flattened on the face: texels", int((wn > 0.5).sum()))
    A[..., :3] = np.clip(np.where(VALID[..., None], rgb, A[..., :3]), 0, 1)
    base_img.pixels.foreach_set(A.ravel())
    base_img.update()
    base_img.pack()
    print("texture v3 done")
    return BR


def _ao_mul(rgb, AO, x, z, head, front, L):
    """AO nelle pieghe: orbite, sotto il naso, solchi, labbra, attaccatura, orecchie (leggera attorno agli occhi)"""
    ao = np.clip(AO, 0, 1)
    k_ao = np.where(head, 0.60, 0.35)
    for e in L["eyes"].values():
        d_e = np.sqrt(((x - e["ac"][0]) / e["ahw"]) ** 2 + ((z - e["ac"][1]) / e["ahh"]) ** 2)
        k_ao = k_ao * (1 - 0.65 * (1 - ss(1.6, 2.6, d_e)) * front)
    occ = (k_ao * (1 - ao))[..., None]
    return rgb * (1 - occ * np.array([0.78, 1.0, 1.10], np.float32))


def apply_ao(base_img, POS, VALID, AO, L):
    A = _img_np(base_img)
    x, y, z = POS[..., 0], POS[..., 1], POS[..., 2]
    head = VALID & (z > L["neck_z"])
    front = y < L["MC"][1] + 1.2 * L["MW"]
    rgb = _ao_mul(A[..., :3].copy(), AO, x, z, head, front, L)
    A[..., :3] = np.clip(np.where(VALID[..., None], rgb, A[..., :3]), 0, 1)
    base_img.pixels.foreach_set(A.ravel())
    base_img.update()
    base_img.pack()
    print("AO applied")
