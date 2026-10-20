"""Texture dipinte (nessun pixel delle foto): pelle, sopracciglia, barba, labbra, ciglia, capelli.

Si lavora per texel: prima si "cuociono" in mappe float le coordinate canoniche (mm) e altri attributi dei vertici,
poi si dipinge in numpy in funzione della posizione sul viso medio (che la deformazione porta sui tratti reali).
"""
import math

import bpy
import numpy as np

import head_fit as H
import parts as PT

ENC = np.array([[-130.0, 260.0], [-260.0, 400.0], [-230.0, 290.0]])      # (min, ampiezza) per x, y, z canonici


# ---------------------------------------------------------------- cottura degli attributi in mappe
def bake_maps(ob, mesh, triples, res, margin=24):
    """triples: {nome_mappa: (N,3) array per vertice}. Restituisce {nome: (res,res,3)} (riga 0 = alto)."""
    out = {}
    for name, arr in triples.items():
        a = mesh.attributes.get("_bk") or mesh.attributes.new("_bk", "FLOAT_COLOR", "POINT")
        a.data.foreach_set("color", np.hstack([arr, np.ones((len(arr), 1))]).astype(np.float32).ravel())
        m = bpy.data.materials.new("_bk_" + name)
        if not m.node_tree:
            m.use_nodes = True
        N = m.node_tree.nodes; L = m.node_tree.links; N.clear()
        o = N.new("ShaderNodeOutputMaterial"); e = N.new("ShaderNodeEmission"); at = N.new("ShaderNodeAttribute")
        at.attribute_name = "_bk"
        L.new(at.outputs["Color"], e.inputs["Color"]); L.new(e.outputs[0], o.inputs["Surface"])
        img = bpy.data.images.new("_bk_" + name, res, res, alpha=False, float_buffer=True)
        img.colorspace_settings.name = "Non-Color"
        t = N.new("ShaderNodeTexImage"); t.image = img
        mesh.materials.clear(); mesh.materials.append(m); N.active = t
        for o_ in bpy.context.view_layer.objects:
            o_.select_set(False)
        bpy.context.view_layer.objects.active = ob; ob.select_set(True)
        bpy.ops.object.bake(type="EMIT", margin=margin, uv_layer="UVMap")
        px = np.empty(res * res * 4, np.float32); img.pixels.foreach_get(px)
        out[name] = px.reshape(res, res, 4)[::-1, :, :3].copy()
        bpy.data.images.remove(img); bpy.data.materials.remove(m)
    return out


def bake_ao(ob, mesh, res, samples=32):
    """occlusione ambientale della mesh (con gli altri oggetti in scena) in una mappa (res,res), riga 0 = alto"""
    m = bpy.data.materials.new("_ao")
    if not m.node_tree:
        m.use_nodes = True
    img = bpy.data.images.new("_ao", res, res, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    t = m.node_tree.nodes.new("ShaderNodeTexImage"); t.image = img
    keep = list(mesh.materials)
    mesh.materials.clear(); mesh.materials.append(m); m.node_tree.nodes.active = t
    for o_ in bpy.context.view_layer.objects:
        o_.select_set(False)
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    sc = bpy.context.scene
    old = sc.cycles.samples; sc.cycles.samples = samples
    if sc.world is None:
        sc.world = bpy.data.worlds.new("_ao_world")
    sc.world.light_settings.distance = 0.03
    bpy.ops.object.bake(type="AO", margin=24, uv_layer="UVMap")
    sc.cycles.samples = old
    px = np.empty(res * res * 4, np.float32); img.pixels.foreach_get(px)
    mesh.materials.clear()
    for k in keep:
        mesh.materials.append(k)
    out = px.reshape(res, res, 4)[::-1, :, 0].copy()
    bpy.data.images.remove(img); bpy.data.materials.remove(m)
    return out


def enc_canon(c):
    return (c - ENC[:, 0]) / ENC[:, 1]


def dec_canon(m):
    return m * ENC[:, 1] + ENC[:, 0]


# ---------------------------------------------------------------- rumore
def _hash(ix, iy, iz, seed):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    h = (h ^ (h >> 13)) * 1274126177
    return ((h ^ (h >> 16)) & 0xFFFF).astype(np.float64) / 65535.0


def vnoise(p, seed=0):
    """rumore a valori 3D, p (...,3) in unita' di cella; risultato in [0,1]"""
    f = np.floor(p); t = p - f
    t = t * t * (3 - 2 * t)
    i = f.astype(np.int64)
    out = 0.0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (t[..., 0] if dx else 1 - t[..., 0]) * (t[..., 1] if dy else 1 - t[..., 1]) * \
                    (t[..., 2] if dz else 1 - t[..., 2])
                out = out + w * _hash(i[..., 0] + dx, i[..., 1] + dy, i[..., 2] + dz, seed)
    return out


def fbm(p, octaves=4, seed=0):
    s = 0.0; a = 0.5; tot = 0.0
    for o in range(octaves):
        s = s + a * vnoise(p * (2 ** o), seed + o * 17)
        tot += a; a *= 0.5
    return s / tot


def ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def gauss(x, y, cx, cy, sx, sy):
    return np.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2))


def srgb_to_lin(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def mix(a, b, t):
    return a * (1 - t[..., None]) + b * t[..., None]


# ---------------------------------------------------------------- pelle del viso
def brow_curve(x, side, P):
    """y della linea mediana del sopracciglio e semispessore (mm) in funzione di |x|"""
    xi, yi = P["brow_in"]; xp, yp = P["brow_peak"]; xo, yo = P["brow_out"]
    ax = side * x
    y = np.where(ax < xp, yi + (yp - yi) * np.sin(np.clip((ax - xi) / (xp - xi), 0, 1) * np.pi / 2),
                 yp + (yo - yp) * (1 - np.cos(np.clip((ax - xp) / (xo - xp), 0, 1) * np.pi / 2)))
    t = np.clip((ax - xi) / (xo - xi), 0, 1)
    half = np.interp(t, [0, 0.15, 0.5, 0.85, 1], P["brow_half"])
    inside = (ax > xi - 1.5) & (ax < xo + 1.0)
    return y, half, inside, t


def paint_skin(maps, cfg, seed=1):
    """cfg: colori sRGB (skin, cheek, lip, brow, beard, lash) e parametri di forma. Restituisce sRGB (res,res,3)."""
    c = dec_canon(maps["canon"])
    x, y, z = c[..., 0], c[..., 1], c[..., 2]
    ax = np.abs(x)
    front = ss(-70, -35, z)
    skin = srgb_to_lin(cfg["skin"])
    base = np.broadcast_to(skin, c.shape).copy()
    # variazioni di colore: guance, naso, orecchie piu' rosse; occhiaie; fronte piu' chiara; collo e nuca piu' chiari
    red = srgb_to_lin(cfg["cheek"])
    crd = cfg.get("cheek_red", 0.45)
    rd = crd * gauss(ax, y, 44, -28, 16, 14) * front + 0.30 * gauss(ax, y, 0, -38, 12, 14) * front
    rd += 0.40 * ss(64, 72, ax) * ss(-120, -95, z) * (z < -60)
    rd += 0.15 * gauss(ax, y, 0, -102, 20, 10) * front
    base = mix(base, np.broadcast_to(red, c.shape), np.clip(rd, 0, 0.6))
    under = gauss(ax, y, 30, -11, 13, 4.5) * front
    base *= (1 - 0.10 * under)[..., None] * np.array([1.0, 0.97, 1.02])
    base *= (1 + 0.05 * gauss(ax, y, 0, 45, 40, 25) * front)[..., None]
    if "ao" in maps:
        ao = maps["ao"]
        base *= (0.45 + 0.55 * ao)[..., None] * np.array([1.0, 0.96, 0.95]) ** (1 - ao)[..., None]
    # rumore: macchie larghe e pori
    p = c / 9.0
    base *= (0.96 + 0.08 * fbm(p, 3, seed))[..., None]
    pores = vnoise(c / 0.45, seed + 5)
    base *= (0.985 + 0.03 * pores)[..., None]
    # labbra
    lip_up = cfg["lip_line"]
    mx = cfg["mouth_x"]
    tx = np.clip(ax / mx, 0, 1)
    seam = -69.0 + 1.0 * tx ** 2
    top = -64.6 - 0.8 * np.cos(np.clip(ax / 6.5, 0, 1) * np.pi) * (ax < 6.5) - 3.8 * tx ** 2.2 + 0 * lip_up
    bot = -76.8 + 6.8 * tx ** 1.8
    in_up = ss(top + 0.7, top - 0.7, y) * ss(seam - 0.5, seam + 0.3, y)
    in_lo = ss(bot - 0.7, bot + 0.7, y) * ss(seam + 0.5, seam - 0.3, y)
    lipm = np.clip(in_up + in_lo, 0, 1) * ss(mx + 1.5, mx - 2.0, ax) * front
    lipc = srgb_to_lin(cfg["lip"])
    lipc = mix(np.broadcast_to(lipc, c.shape), base, np.full(x.shape, cfg.get("lip_skin", 0.3)))
    lipm = lipm * ss(0.0, 1.0, lipm) ** 0.5
    base = mix(base, lipc * (0.95 + 0.1 * vnoise(c / np.array([0.4, 1.6, 0.4]), seed + 9))[..., None], lipm * 0.9)
    base *= (1 - 0.45 * np.exp(-((y - seam) / 0.6) ** 2) * ss(mx + 1, mx - 3, ax) * front)[..., None]
    # barba / ombra di barba
    if cfg.get("beard", 0) > 0:
        bd = beard_density(x, y, z, cfg) * cfg["beard"]
        brk = fbm(c / 3.0, 3, seed + 12)
        bd = bd * ss(0.18, 0.45, bd + 0.35 * (brk - 0.5))              # bordo irregolare
        dots = ss(0.42, 0.62, vnoise(c / 0.28, seed + 11))
        fine = vnoise(c / np.array([0.12, 0.5, 0.12]), seed + 14)
        cov = np.clip(bd * (0.68 + 0.28 * dots + 0.12 * fine), 0, 1)
        beardc = srgb_to_lin(cfg["beard_rgb"])
        base = mix(base, np.broadcast_to(beardc, c.shape), cov * cfg.get("beard_max", 0.9))
    if cfg.get("shadow", 0) > 0:                      # rasato: solo ombra bluastra
        bd = beard_density(x, y, z, cfg)
        base *= (1 - cfg["shadow"] * bd * (0.7 + 0.3 * vnoise(c / 0.5, seed + 13)))[..., None] * np.array([0.98, 0.99, 1.02])
    # sopracciglia a peli
    browc = srgb_to_lin(cfg["brow"])
    bm = np.zeros(x.shape)
    for side in (1, -1):
        yc, half, inside, t = brow_curve(x, side, cfg)
        d = np.abs(y - yc)
        m = ss(half + 0.8, half - 0.6, d) * inside * front * (side * x > 0)
        m *= ss(-1.5, 1.5, side * x - cfg["brow_in"][0] + 1.5) * ss(1.0, -1.5, side * x - cfg["brow_out"][0])
        # peli: rumore allungato lungo il sopracciglio, inclinato verso l'esterno e in alto all'inizio
        ang = np.where(t < 0.25, 1.1, 0.25) * side
        u = (x * np.cos(ang) + y * np.sin(ang)) / 1.6
        v = (-x * np.sin(ang) + y * np.cos(ang)) / 0.28
        strands = ss(0.35, 0.7, vnoise(np.stack([u, v, z / 3.0], -1), seed + 21 + (side > 0)))
        bm = np.maximum(bm, m * (0.55 + 0.45 * strands))
    base = mix(base, np.broadcast_to(browc, c.shape), np.clip(bm * cfg["brow_density"], 0, 0.95))
    # ciglia (linea scura sul bordo delle palpebre) e interno rosato, dal contorno dell'apertura
    E = PT.EYE
    lashc = np.broadcast_to(srgb_to_lin(cfg["lash"]), c.shape)
    innerc = np.broadcast_to(srgb_to_lin(cfg.get("inner_lid", (0.62, 0.36, 0.34))), c.shape)
    for side in (1, -1):
        t = (side * x - E["xi"]) / (E["xo"] - E["xi"])
        tc = np.clip(t, 0, 1)
        on = (side * x > 0) & (t > -0.08) & (t < 1.08) & (z > -40) & (np.abs(y) < 16)
        yb = E["yi"] + (E["yo"] - E["yi"]) * tc
        up = yb + E["up"] * np.sin(np.pi * tc) ** 0.8
        lo = yb - E["lo"] * np.sin(np.pi * tc) ** 0.9
        du = y - up; dl = lo - y
        fade = np.sin(np.pi * tc) ** 0.35
        lash = (np.exp(-(np.clip(du, 0, None) / cfg.get("lash_w", 0.9)) ** 2) * (du > -0.4) * 0.9 +
                np.exp(-(np.clip(dl, 0, None) / 0.5) ** 2) * (dl > -0.4) * 0.35) * fade * on
        base = mix(base, lashc, np.clip(lash, 0, 0.92))
        inner = on & (du < -0.4) & (dl < -0.4)
        base = mix(base, innerc, inner.astype(float))
    # cuoio capelluto sotto i capelli
    if "scalp" in maps:
        sc = maps["scalp"][..., 0]
        dhm = maps["scalp"][..., 1] * 40.0 - 20.0
        sc = np.where((z > -95) & (y > -25), ss(-2.5, 3.0, dhm + 2.0 * (fbm(c / 2.0, 2, seed + 30) - 0.5)), sc)
        base = mix(base, np.broadcast_to(srgb_to_lin(cfg["hair_rgb"]) * 0.7, c.shape), np.clip(sc, 0, 1) * 0.92)
    return lin_to_srgb(base)


def beard_density(x, y, z, cfg):
    """zona barba: baffi, mento, guance sotto la linea zigomo-angolo bocca, mandibola; bordi morbidi"""
    ax = np.abs(x)
    # linea delle guance: dalla basetta (davanti all'orecchio) all'angolo della bocca
    yl = np.interp(ax, cfg.get("beard_x", [26, 32, 40, 50, 60, 68, 80]), cfg.get("beard_y", [-66, -60, -52, -40, -26, -12, -4]))
    cheek = ss(yl + 3.5, yl - 3.5, y) * ss(-100, -86, z) * cfg.get("beard_cheek", 0.85)
    mx = cfg["mouth_x"]
    top_m = -53.5 - 2.0 * ss(8, mx, ax)
    bot_m = -60.5 - 5.5 * ss(10, mx + 2, ax) ** 1.5
    must = ss(top_m + 1.2, top_m - 1.2, y) * ss(bot_m - 0.8, bot_m + 0.8, y) * ss(mx + 4, mx, ax)
    corner = gauss(ax, y, mx + 2, -72, 5, 7)
    chin = ss(-79.5, -83.0, y) * ss(-160, -145, y)
    soul = gauss(ax, y, 0, -81, 7, 3) * 1.0
    lips = ss(-60.5, -62.5, y) * ss(-80.5, -78.5, y) * ss(mx + 1.5, mx - 1.5, ax)
    sb = cfg.get("sideburn", 0.0) * ss(62, 66, ax) * ss(80, 75, ax) * ss(-96, -90, z) * ss(-70, -76, z) * ss(18, 8, y)
    d = np.clip(np.maximum.reduce([cheek, must, chin, soul, corner, sb]), 0, 1) * (1 - lips)
    d *= ss(-180, -150, y)
    return d


# ---------------------------------------------------------------- capelli
def flow_field(c, cfg):
    """direzione delle ciocche nello spazio canonico (unitaria)"""
    crown = np.array(cfg["crown"])
    d = c - crown
    d[..., 1] *= 0.35
    d = d / np.linalg.norm(d, axis=-1, keepdims=True).clip(1e-6)
    fwd = np.array(cfg.get("comb", (0.0, -0.2, 1.0)))
    fwd = fwd / np.linalg.norm(fwd)
    top = ss(40, 85, c[..., 1])[..., None]
    f = d * (1 - top * 0.6) + fwd * top * 0.6
    return f / np.linalg.norm(f, axis=-1, keepdims=True).clip(1e-6)


def paint_hair(maps, cfg, seed=3):
    """colore (sRGB) e alfa della calotta dei capelli"""
    c = dec_canon(maps["canon"])
    f = flow_field(c, cfg)
    along = (c * f).sum(-1)
    q = c / cfg["strand_w"] - f * (along / cfg["strand_w"] - along / cfg["strand_l"])[..., None]
    wav = cfg.get("curl", 0.0)
    if wav:
        q[..., 0] += wav * np.sin(along / cfg["curl_l"] * 2 * np.pi)
        q[..., 2] += wav * np.cos(along / cfg["curl_l"] * 2 * np.pi)
    s1 = vnoise(q, seed); s2 = vnoise(q * 2.3 + 7, seed + 1)
    clump = fbm(c / cfg["clump"], 3, seed + 2)
    hairc = srgb_to_lin(cfg["hair_rgb"])
    hi = srgb_to_lin(cfg["hair_hi"])
    t = np.clip(0.55 * s1 + 0.25 * s2 + 0.35 * (clump - 0.5), 0, 1)
    col = mix(np.broadcast_to(hairc * 0.65, c.shape), np.broadcast_to(hi, c.shape), t ** 1.6)
    thick = maps["extra"][..., 0]                 # spessore normalizzato: radici e bordi piu' scuri
    col *= (0.7 + 0.3 * ss(0.0, 0.35, thick))[..., None]
    edge = maps["extra"][..., 1] * 20.0           # mm dal bordo della calotta
    dh = maps["extra"][..., 2] * 40.0 - 20.0      # mm sopra l'attaccatura (davanti e ai lati)
    brk = vnoise(q * 0.5, seed + 5)
    front = c[..., 2] > -95
    lim = np.where(front, dh, edge)
    alpha = ss(-0.5, 3.0, lim + 3.5 * (brk - 0.5) + 2.5 * (s1 - 0.5))
    return lin_to_srgb(col), alpha


def card_atlas(cfg, size=1024, cols=4, rows=2, seed=7):
    """atlante RGBA di ciocche: ogni riquadro e' un ciuffo che parte largo dalla radice (in alto) e si assottiglia,
    pieno di fili paralleli alla sua linea centrale, ondulato se i capelli sono ricci"""
    rng = np.random.default_rng(seed)
    img = np.zeros((size, size, 4))
    cw, ch = size // cols, size // rows
    hairc = srgb_to_lin(cfg["hair_rgb"]); hi = srgb_to_lin(cfg["hair_hi"])
    yy, xx = np.mgrid[0:ch, 0:cw].astype(float)
    t = yy / ch
    curl = cfg.get("curl", 0.0)
    for r in range(rows):
        for k in range(cols):
            amp = cw * rng.uniform(0.04, 0.10) * (0.4 + curl)
            lam = rng.uniform(0.45, 0.9)
            ph = rng.uniform(0, 6.28)
            xc = cw / 2 + amp * np.sin(t / lam * 2 * np.pi + ph) * t
            w = cw * rng.uniform(0.34, 0.44) * (1 - t ** 1.6) * (0.9 + 0.1 * np.sin(t * 9 + ph)) + 1.0
            rel = (xx - xc) / w
            n2 = vnoise(np.stack([xx / cw * 6, yy / ch * 2, np.full(xx.shape, r * 7.0 + k)], -1), seed + r * 9 + k)
            stripe = 0.5 + 0.5 * np.sin(rel * 21 * np.pi + 5.0 * n2)
            core = ss(0.75, 0.35, np.abs(rel))
            edge = ss(1.05, 0.7, np.abs(rel)) * ss(0.45, 0.7, stripe)          # sul bordo restano fili separati
            lock = np.maximum(core, edge)
            tip = ss(1.0, 0.72, t + 0.25 * (n2 - 0.5) + 0.12 * np.abs(rel) * stripe)
            alpha = lock * tip * (0.7 + 0.3 * ss(0.2, 0.8, stripe))
            alpha = np.clip(alpha * 1.25, 0, 1)
            shade = 0.55 + 0.45 * stripe ** 2
            col = hairc[None, None, :] * (0.75 + 0.5 * n2[..., None]) * (1 - 0.35 * (t < 0.12)[..., None])
            col = col * (1 - shade[..., None] * 0.5) + hi[None, None, :] * shade[..., None] * 0.5
            img[r * ch:(r + 1) * ch, k * cw:(k + 1) * cw, :3] = col
            img[r * ch:(r + 1) * ch, k * cw:(k + 1) * cw, 3] = alpha
    return lin_to_srgb(img[..., :3]), img[..., 3]


# ================================================================ stile scultoreo: porcellana biscuit e smalti
def bake_normal(ob, mesh, height, res, strength=1.0, distance=0.0006, name="_nrm"):
    """mappa normale (spazio tangente) da una mappa d'altezza (res,res) in [0,1], riga 0 = alto"""
    himg = bpy.data.images.new(name + "_h", res, res, alpha=False, float_buffer=True)
    himg.colorspace_settings.name = "Non-Color"
    rgba = np.repeat(np.clip(height, 0, 1)[::-1, :, None], 4, 2).astype(np.float32); rgba[..., 3] = 1
    himg.pixels.foreach_set(rgba.ravel())
    m = bpy.data.materials.new("_bkn")
    if not m.node_tree:
        m.use_nodes = True
    N = m.node_tree.nodes; L = m.node_tree.links
    b = N["Principled BSDF"]
    t = N.new("ShaderNodeTexImage"); t.image = himg; t.interpolation = "Cubic"
    bp = N.new("ShaderNodeBump"); bp.inputs["Strength"].default_value = strength
    bp.inputs["Distance"].default_value = distance
    L.new(t.outputs["Color"], bp.inputs["Height"]); L.new(bp.outputs["Normal"], b.inputs["Normal"])
    out = bpy.data.images.new(name, res, res, alpha=False)
    out.colorspace_settings.name = "Non-Color"
    tt = N.new("ShaderNodeTexImage"); tt.image = out
    keep = list(mesh.materials)
    mesh.materials.clear(); mesh.materials.append(m); N.active = tt
    for o_ in bpy.context.view_layer.objects:
        o_.select_set(False)
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    sc = bpy.context.scene
    old = sc.cycles.samples; sc.cycles.samples = 1
    bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", margin=16, uv_layer="UVMap")
    sc.cycles.samples = old
    mesh.materials.clear()
    for k in keep:
        mesh.materials.append(k)
    bpy.data.images.remove(himg); bpy.data.materials.remove(m)
    return out


def _strokes(c, direction, width, length, seed, wav=0.0, wav_l=10.0):
    """solchi di stecca: rumore allungato lungo 'direction' (campo (...,3) unitario), valori in [0,1]"""
    along = (c * direction).sum(-1)
    q = c / width - direction * (along / width - along / length)[..., None]
    if wav:
        q[..., 0] += wav * np.sin(along / wav_l * 2 * np.pi)
        q[..., 2] += wav * np.cos(along / wav_l * 2 * np.pi)
    return 0.6 * vnoise(q, seed) + 0.4 * vnoise(q * 2.1 + 3.0, seed + 1)


def paint_biscuit(maps, cfg, seed=1):
    """incarnato in biscuit: avorio caldo opaco con occlusione; barba, sopracciglia e attaccatura con velatura
    terra d'ombra e solchi di stecca. Restituisce (sRGB, altezza in [0,1])"""
    c = dec_canon(maps["canon"])
    x, y, z = c[..., 0], c[..., 1], c[..., 2]
    ax = np.abs(x)
    front = ss(-70, -35, z)
    ivory = srgb_to_lin(cfg["biscuit"])
    base = np.broadcast_to(ivory, c.shape).copy()
    base *= (1 + 0.02 * (fbm(c / 25.0, 2, seed) - 0.5))[..., None]          # appena un respiro di materia
    mx = cfg["mouth_x"]
    lips = np.exp(-((y + 69) / 5.5) ** 2) * ss(mx + 2, mx - 3, ax) * front
    base = mix(base, base * np.array([1.0, 0.93, 0.90]), np.clip(lips, 0, 1) * 0.8)
    height = np.full(x.shape, 0.5)
    umber = srgb_to_lin(cfg["umber"])
    umber_l = srgb_to_lin(cfg.get("umber_light", tuple(np.array(cfg["umber"]) * 1.6)))
    glaze = np.zeros(x.shape)
    if cfg.get("beard", 0) > 0:
        bd = beard_density(x, y, z, cfg) * cfg["beard"]
        bd = bd * ss(0.15, 0.45, bd + 0.3 * (fbm(c / 3.5, 3, seed + 12) - 0.5))
        bd = np.clip(bd * 1.15, 0, 1)
        dirb = np.broadcast_to(np.array([0.0, -1.0, 0.25]) / np.linalg.norm([0.0, -1.0, 0.25]), c.shape)
        st = _strokes(c, dirb, 0.55, 3.5, seed + 40)
        height = np.where(bd > 0.05, 0.5 + (st - 0.5) * 0.9 * bd, height)
        glaze = np.maximum(glaze, bd * (0.75 + 0.25 * (1 - st)))
    bm = np.zeros(x.shape)
    for side in (1, -1):
        yc, half, inside, t = brow_curve(x, side, cfg)
        m = ss(half + 0.7, half - 0.5, np.abs(y - yc)) * inside * front * (side * x > 0)
        bm = np.maximum(bm, m)
    dir_br = np.stack([np.sign(x) * 0.95, np.full(x.shape, 0.3), np.zeros(x.shape)], -1)
    dir_br /= np.linalg.norm(dir_br, axis=-1, keepdims=True)
    stb = _strokes(c, dir_br, 0.45, 3.0, seed + 41)
    height = np.where(bm > 0.05, 0.5 + (stb - 0.5) * 0.8 * bm, height)
    glaze = np.maximum(glaze, bm * (0.8 + 0.2 * (1 - stb)))
    if "scalp" in maps:
        sc_ = maps["scalp"][..., 0]
        dhm = maps["scalp"][..., 1] * 40.0 - 20.0
        sc_ = np.where((z > -95) & (y > -25), ss(-1.0, 1.5, dhm), sc_)
        glaze = np.maximum(glaze, sc_)
    gcol = mix(np.broadcast_to(umber, c.shape), np.broadcast_to(umber_l, c.shape), np.clip((height - 0.5) * 2.2 + 0.4, 0, 1))
    base = mix(base, gcol, np.clip(glaze, 0, 1) * cfg.get("glaze", 0.88))
    E = PT.EYE
    for side in (1, -1):
        t = (side * x - E["xi"]) / (E["xo"] - E["xi"])
        tc = np.clip(t, 0, 1)
        on = (side * x > 0) & (t > -0.05) & (t < 1.05) & (z > -40) & (np.abs(y) < 16)
        yb = E["yi"] + (E["yo"] - E["yi"]) * tc
        up = yb + E["up"] * np.sin(np.pi * tc) ** 0.8
        du = y - up
        lash = np.exp(-(np.clip(du, 0, None) / 0.6) ** 2) * (du > -0.4) * np.sin(np.pi * tc) ** 0.35 * on
        base = mix(base, np.broadcast_to(umber, c.shape), np.clip(lash * cfg.get("lash_glaze", 0.6), 0, 1))
        inner = on & (du < -0.4) & (y > yb - E["lo"] * np.sin(np.pi * tc) ** 0.9 + 0.4)
        base = mix(base, base * 0.82, inner.astype(float))
    if "ao" in maps:
        ao = maps["ao"]
        base *= (0.42 + 0.58 * ao)[..., None]
    return lin_to_srgb(base), height


def lock_ridges(c, cfg, scale=1.0, seed=51):
    """ciocche scolpite: rumore 'a cresta' allungato lungo la pettinatura (1 = cresta, 0 = solco)"""
    f = flow_field(c, cfg)
    along = (c * f).sum(-1)
    w = cfg["lock_w"] * scale; l = cfg["lock_l"] * scale
    q = c / w - f * (along / w - along / l)[..., None]
    if cfg.get("curl", 0.0):
        q[..., 0] += cfg["curl"] * 0.8 * np.sin(along / cfg.get("curl_l", 10.0) * 2 * np.pi)
    return 1 - np.abs(2 * vnoise(q, seed) - 1)


def paint_hair_sculpt(maps, cfg, seed=3):
    """capelli scolpiti: velatura terra d'ombra, piu' scura nei solchi e piu' chiara sulle creste"""
    c = dec_canon(maps["canon"])
    big = lock_ridges(c, cfg, 1.0, 51)                 # le stesse ciocche della geometria
    mid = lock_ridges(c, cfg, 0.45, 52)
    fine = _strokes(c, flow_field(c, cfg), cfg.get("groove_w", 0.9), cfg.get("groove_l", 9.0), seed)
    height = np.clip(0.18 + 0.42 * big ** 0.6 + 0.28 * mid ** 0.8 + 0.12 * fine, 0, 1)
    umber = srgb_to_lin(cfg["umber"]); umber_l = srgb_to_lin(cfg.get("umber_light", tuple(np.array(cfg["umber"]) * 1.6)))
    col = mix(np.broadcast_to(umber * 0.8, c.shape), np.broadcast_to(umber_l, c.shape), np.clip(height * 1.3 - 0.35, 0, 1))
    if "ao" in maps:
        col *= (0.5 + 0.5 * maps["ao"])[..., None]
    return lin_to_srgb(col), height


def eye_texture_porcelain(name, cfg, size=512, r_eye=12.0):
    """bulbo in biscuit: iride incisa (anello limbare e raggi velati), pupilla a parte (smalto)"""
    yy, xx = np.mgrid[0:size, 0:size]
    u = (xx + 0.5) / size - 0.5; v = (yy + 0.5) / size - 0.5
    r = np.hypot(u, v) * 2 * r_eye / 0.98
    ang = np.arctan2(v, u)
    ivory = srgb_to_lin(cfg["biscuit_eye"]); umber = srgb_to_lin(cfg["umber"])
    col = np.broadcast_to(ivory, (size, size, 3)).copy()
    rays = 0.5 + 0.5 * np.sin(ang * 36 + 2.0 * np.sin(ang * 7))
    iris = ss(6.0, 5.6, r) * ss(2.0, 2.4, r)
    col = mix(col, np.broadcast_to(umber, col.shape), iris * (0.42 + 0.28 * rays ** 2))
    limb = np.exp(-((r - 5.85) / 0.38) ** 2)
    col = mix(col, np.broadcast_to(umber * 0.6, col.shape), np.clip(limb * 0.95, 0, 1))
    col *= (1.0 - 0.15 * ss(7.0, 11.0, r))[..., None]
    img = bpy.data.images.new(name, size, size, alpha=False)
    img.colorspace_settings.name = "sRGB"
    rgba = np.concatenate([lin_to_srgb(col), np.ones((size, size, 1))], 2)[::-1].astype(np.float32)
    img.pixels.foreach_set(rgba.ravel())
    return img


# ================================================================ stile 3D animato (tipo Pixar)
def paint_cartoon(maps, cfg, seed=1):
    """pelle liscia e calda: rossore leggero su guance, naso e orecchie; labbra; sopracciglia piene;
    ciglia marcate; barba corta sfumata. Restituisce (sRGB, altezza in [0,1])"""
    c = dec_canon(maps["canon"])
    x, y, z = c[..., 0], c[..., 1], c[..., 2]
    ax = np.abs(x)
    front = ss(-70, -35, z)
    cfg = dict(cfg, brow_half=cfg.get("brow_half_toon", cfg["brow_half"]))
    skin = srgb_to_lin(cfg["skin_toon"])
    base = np.broadcast_to(skin, c.shape).copy()
    base *= (1 + 0.025 * (fbm(c / 30.0, 2, seed) - 0.5))[..., None]
    blush = srgb_to_lin(cfg.get("blush", (0.93, 0.55, 0.50)))
    rd = (cfg.get("cheek_red", 0.25) * gauss(ax, y, 40, -28, 16, 13) * front
          + 0.22 * gauss(ax, y, 0, -36, 10, 10) * front
          + 0.30 * ss(64, 72, ax) * ss(-120, -95, z) * (z < -60))
    base = mix(base, np.broadcast_to(blush, c.shape), np.clip(rd, 0, 0.5))
    base *= (1 - 0.06 * gauss(ax, y, 30, -11, 12, 4))[..., None]                 # occhiaia appena accennata
    height = np.full(x.shape, 0.5)
    # labbra
    mx = cfg["mouth_x"]
    tx = np.clip(ax / mx, 0, 1)
    seam = -69.0 + 1.0 * tx ** 2
    top = -64.2 - 0.9 * np.cos(np.clip(ax / 6.5, 0, 1) * np.pi) * (ax < 6.5) - 3.8 * tx ** 2.2
    bot = -77.0 + 7.0 * tx ** 1.8
    in_up = ss(top + 0.9, top - 0.9, y) * ss(seam - 0.4, seam + 0.2, y)
    in_lo = ss(bot - 0.9, bot + 0.9, y) * ss(seam + 0.4, seam - 0.2, y)
    lipm = np.clip(in_up + in_lo, 0, 1) * ss(mx + 1.5, mx - 2.5, ax) * front
    base = mix(base, np.broadcast_to(srgb_to_lin(cfg["lip_toon"]), c.shape), lipm * 0.85)
    # barba corta sfumata (puntini fitti, piu' scura su baffi e pizzetto)
    if cfg.get("beard", 0) > 0:
        bd = beard_density(x, y, z, cfg) * cfg["beard"]
        bd = bd * ss(0.10, 0.50, bd + 0.25 * (fbm(c / 3.0, 3, seed + 12) - 0.5))
        dark = ss(-50, -56, y) * ss(-64, -60, y) * ss(mx + 3, mx - 2, ax) + ss(-79, -84, y) * ss(22, 14, ax)
        dots = ss(0.40, 0.62, vnoise(c / 0.30, seed + 11))
        cov = np.clip(bd * (0.45 + 0.35 * dots + 0.25 * np.clip(dark, 0, 1)), 0, 1)
        base = mix(base, np.broadcast_to(srgb_to_lin(cfg["stubble"]), c.shape), cov * cfg.get("stubble_max", 0.85))
        height = np.where(bd > 0.05, 0.5 + (dots - 0.5) * 0.25 * bd, height)
    # sopracciglia piene, bordo morbido, peli accennati
    browc = srgb_to_lin(cfg["brow"])
    bm = np.zeros(x.shape)
    for side in (1, -1):
        yc, half, inside, t = brow_curve(x, side, cfg)
        m = ss(half + 0.8, half - 0.4, np.abs(y - yc)) * inside * front * (side * x > 0)
        m *= ss(-1.5, 1.5, side * x - cfg["brow_in"][0] + 1.5) * ss(1.0, -1.5, side * x - cfg["brow_out"][0])
        ang = np.where(t < 0.25, 1.0, 0.2) * side
        u = (x * np.cos(ang) + y * np.sin(ang)) / 1.8
        v = (-x * np.sin(ang) + y * np.cos(ang)) / 0.35
        strands = vnoise(np.stack([u, v, z / 3.0], -1), seed + 21 + (side > 0))
        bm = np.maximum(bm, m * (0.82 + 0.18 * strands))
        height = np.where(m > 0.05, 0.5 + (strands - 0.5) * 0.3 * m + 0.15 * m, height)
    base = mix(base, np.broadcast_to(browc, c.shape), np.clip(bm, 0, 0.97))
    # ciglia marcate sul bordo superiore, piu' leggere sotto; interno delle palpebre rosato
    E = PT.EYE
    lashc = np.broadcast_to(srgb_to_lin(cfg["lash"]), c.shape)
    for side in (1, -1):
        t = (side * x - E["xi"]) / (E["xo"] - E["xi"])
        tc = np.clip(t, 0, 1)
        on = (side * x > 0) & (t > -0.08) & (t < 1.12) & (z > -40) & (np.abs(y) < 16)
        yb = E["yi"] + (E["yo"] - E["yi"]) * tc
        up = yb + E["up"] * np.sin(np.pi * tc) ** 0.8
        lo = yb - E["lo"] * np.sin(np.pi * tc) ** 0.9
        du = y - up; dl = lo - y
        wing = 1.0 + 0.8 * ss(0.75, 1.1, t)                       # leggero allungamento verso l'esterno
        lash = (np.exp(-(np.clip(du, 0, None) / (1.1 * wing)) ** 2) * (du > -0.4) * 0.95 +
                np.exp(-(np.clip(dl, 0, None) / 0.45) ** 2) * (dl > -0.4) * 0.25) * np.sin(np.pi * tc) ** 0.25 * on
        base = mix(base, lashc, np.clip(lash, 0, 0.95))
        inner = on & (du < -0.4) & (dl < -0.4)
        base = mix(base, np.broadcast_to(srgb_to_lin((0.80, 0.50, 0.48)), c.shape), inner.astype(float))
    if "scalp" in maps:
        sc_ = maps["scalp"][..., 0]
        dhm = maps["scalp"][..., 1] * 40.0 - 20.0
        sc_ = np.where((z > -95) & (y > -25), ss(-1.0, 1.5, dhm), sc_)
        base = mix(base, np.broadcast_to(srgb_to_lin(cfg["hair_toon"]), c.shape), np.clip(sc_, 0, 1) * 0.9)
    if "ao" in maps:
        base *= (0.72 + 0.28 * maps["ao"])[..., None]
    return lin_to_srgb(base), height


def paint_hair_cartoon(maps, cfg, seed=3):
    """capelli da film d'animazione: ciocche nette, riflessi caldi sulle creste, solchi scuri"""
    c = dec_canon(maps["canon"])
    big = lock_ridges(c, cfg, 1.0, 51)
    mid = lock_ridges(c, cfg, 0.5, 52)
    fine = _strokes(c, flow_field(c, cfg), 0.5, 12.0, seed)
    height = np.clip(0.15 + 0.45 * big ** 0.5 + 0.25 * mid ** 0.7 + 0.15 * fine, 0, 1)
    dark = srgb_to_lin(cfg["hair_toon"]); hi = srgb_to_lin(cfg["hair_toon_hi"])
    col = mix(np.broadcast_to(dark * 0.75, c.shape), np.broadcast_to(hi, c.shape), np.clip(height * 1.25 - 0.45, 0, 1) ** 1.4)
    if "ao" in maps:
        col *= (0.55 + 0.45 * maps["ao"])[..., None]
    return lin_to_srgb(col), height


def eye_texture_cartoon(name, cfg, r_eye, size=1024):
    """occhio da film d'animazione: iride grande ambrata con fibre radiali, anello scuro, pupilla nera"""
    yy, xx = np.mgrid[0:size, 0:size]
    u = (xx + 0.5) / size - 0.5; v = (yy + 0.5) / size - 0.5
    r = np.hypot(u, v) * 2 * r_eye / 0.98
    ang = np.arctan2(v, u)
    R_IRIS = cfg.get("iris_frac", 0.5) * r_eye; R_PUP = cfg.get("pupil_frac", 0.2) * r_eye
    sclera = srgb_to_lin(cfg.get("sclera_toon", (0.96, 0.94, 0.91)))
    col = np.broadcast_to(sclera, (size, size, 3)).copy()
    col *= (1.0 - 0.10 * ss(R_IRIS + 2, r_eye * 0.95, r))[..., None]
    col = mix(col, np.broadcast_to(srgb_to_lin((0.95, 0.78, 0.76)), col.shape), 0.25 * ss(R_IRIS + 4, r_eye * 0.95, r))
    inner = srgb_to_lin(cfg.get("iris_in", (0.62, 0.36, 0.14))); outer = srgb_to_lin(cfg.get("iris_out", (0.30, 0.15, 0.06)))
    t = np.clip((r - R_PUP) / (R_IRIS - R_PUP), 0, 1)
    fib = 0.5 + 0.5 * np.sin(ang * 48 + 3 * np.sin(ang * 9) + r * 0.6)
    iris = mix(np.broadcast_to(inner, col.shape), np.broadcast_to(outer, col.shape), t ** 0.8)
    iris *= (0.85 + 0.3 * fib)[..., None]
    m_i = ss(R_IRIS + 0.15, R_IRIS - 0.15, r)
    col = mix(col, iris, m_i)
    col = mix(col, np.broadcast_to(outer * 0.35, col.shape), np.exp(-((r - R_IRIS + 0.25) / 0.35) ** 2) * 0.9)
    pup = ss(R_PUP + 0.12, R_PUP - 0.12, r)
    col = mix(col, np.broadcast_to(np.array([0.004, 0.003, 0.003]), col.shape), pup)
    img = bpy.data.images.new(name, size, size, alpha=False)
    img.colorspace_settings.name = "sRGB"
    rgba = np.concatenate([lin_to_srgb(col), np.ones((size, size, 1))], 2)[::-1].astype(np.float32)
    img.pixels.foreach_set(rgba.ravel())
    return img
