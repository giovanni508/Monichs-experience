"""Incisioni dell'anello del fondello rifatte con un carattere vero (Montserrat Light), come nella foto Vi (4):
lettere col piede verso il centro e la testa verso il bordo esterno, lettura in senso orario guardando il fondello.

Posizione e ampiezza di ogni scritta vengono dalla maschera ricavata dal disegno tecnico (caseback_*_disegno.png),
che ha l'ordine giusto ma glifi impastati (S -> 8) e lettere girate verso il centro.
Uso: blender --background --factory-startup --python caseback_text.py
"""
import math
import os
import shutil

import bpy
import numpy as np
from mathutils import Vector

ROOT = r"C:\Users\UTENTE\Desktop\MNC GAME"
TEX = os.path.join(ROOT, "Modelli", "3D", "textures")
SRC = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(os.environ["LOCALAPPDATA"], "Microsoft", "Windows", "Fonts", "Montserrat-Light.ttf")
HALF = 18.6                     # la maschera copre [-HALF, HALF] mm in x (verso ore 3) e y (verso ore 12)
OUT_RES = 3072
BAND = (13.40, 14.68)           # fascia delle scritte (mm); il cerchio sottile esterno e' a 14,8 mm
CLEAN = (13.18, 14.68)          # fascia sostituita: toglie anche i resti tratteggiati del disegno a 13,3 mm
TEXTS = {90: "MONICHS", 180: "10 ATMOSPHERES", 270: "SWISS AUTOMATIC MOVEMENT", 0: "316L STAINLESS STEEL"}
PICTO = [[(653.8, 483.4), (539.0, 713.0), (768.1, 712.7)],
         [(424.5, 483.7), (309.7, 713.2), (538.8, 713.0)],
         [(538.4, 598.4), (653.1, 368.9), (424.0, 369.1)]]


def load_mask(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[::-1, :, 0].copy()          # riga 0 = ore 12


def grids(n):
    lin = (np.arange(n) + 0.5) / n * 2 * HALF - HALF
    X, Y = np.meshgrid(lin, lin[::-1])
    return X, Y


def clusters(mask):
    """scritte nella fascia: angolo (vista dal fondello, antiorario da destra) d'inizio e fine, raggi"""
    n = mask.shape[0]
    X, Y = grids(n)
    R = np.hypot(X, Y)
    on = (mask > 0.5) & (R > BAND[0]) & (R < BAND[1])
    u, v = -X[on], Y[on]                                    # vista dal fondello: u = -x
    ang = (np.degrees(np.arctan2(v, u)) + 360) % 360
    rr = R[on]
    hist = np.zeros(720, bool); hist[(ang * 2).astype(int) % 720] = True
    # gruppi separati da almeno 5 gradi vuoti (circolare)
    start = np.argmin(hist)
    order = np.roll(np.arange(720), -start)
    groups, cur, gap = [], [], 0
    for i in order:
        if hist[i]:
            cur.append(i); gap = 0
        else:
            gap += 1
            if cur and gap >= 10:
                groups.append(cur); cur = []
    if cur:
        groups.append(cur)
    out = []
    for g in groups:
        a0, a1 = g[0] / 2.0, (g[-1] + 1) / 2.0
        if a1 < a0:
            a1 += 360
        sel = ((ang - a0) % 360) <= (a1 - a0)
        out.append(dict(a0=a0, a1=a1, c=(a0 + (a1 - a0) / 2) % 360, rmin=float(np.percentile(rr[sel], 2)),
                        rmax=float(np.percentile(rr[sel], 98))))
    return out


def text_mesh(s, size, spacing=1.0):
    cu = bpy.data.curves.new("t", "FONT")
    cu.body = s
    cu.font = bpy.data.fonts.load(FONT, check_existing=True)
    cu.size = size
    cu.space_character = spacing
    ob = bpy.data.objects.new("t", cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob); bpy.data.curves.remove(cu)
    return me


def picto_mesh(height):
    me = bpy.data.meshes.new("logo")
    s = height / (713.2 - 368.9)
    verts, faces = [], []
    for tri in PICTO:
        b = len(verts)
        verts += [((x - 309.7) * s, -(y - 713.2) * s, 0.0) for x, y in tri]
        faces.append((b, b + 1, b + 2))
    me.from_pydata(verts, [], faces)
    return me


def arc_object(name, s, cl, cap, logo=False):
    """scritta piegata sull'arco: piede sul raggio interno, testa verso l'esterno, lettura oraria"""
    r_base = cl["rmin"] + 0.02
    span = math.radians((cl["a1"] - cl["a0"]))
    r_mid = r_base + cap / 2
    target = span * r_mid
    size = cap / 0.70                                     # Montserrat: altezza maiuscole circa 0,70 em
    logo_h = cap * 1.05
    logo_w = logo_h * (768.1 - 309.7) / (713.2 - 368.9) if logo else 0.0
    gap = cap * 0.9 if logo else 0.0
    spacing = 1.0
    for _ in range(5):                                    # spaziatura che riempie l'arco del disegno
        me = text_mesh(s, size, spacing)
        xs = np.array([v.co.x for v in me.vertices])
        bpy.data.meshes.remove(me)
        err = target - (xs.max() - xs.min() + logo_w + gap)
        if abs(err) < 0.01 * target:
            break
        spacing += err / max(len(s) - 1, 1) / (size * 0.62)
    me = text_mesh(s, size, spacing)
    xs = np.array([v.co.x for v in me.vertices])
    verts = []
    faces = []
    off = 0.0
    if logo:
        lm = picto_mesh(logo_h)
        for p in lm.polygons:
            faces.append([len(verts) + i for i in range(len(p.vertices))])
            verts += [tuple(lm.vertices[i].co) for i in p.vertices]
        bpy.data.meshes.remove(lm)
        off = logo_w + gap
    x0 = xs.min()
    base = len(verts)
    verts += [(v.co.x - x0 + off, v.co.y, 0.0) for v in me.vertices]
    faces += [[base + i for i in p.vertices] for p in me.polygons]
    bpy.data.meshes.remove(me)
    total = max(v[0] for v in verts)
    phi_start = math.radians(cl["c"]) + (total / 2) / r_mid
    out = []
    for x, y, _ in verts:
        phi = phi_start - x / r_mid
        r = r_base + y
        u, v = r * math.cos(phi), r * math.sin(phi)
        out.append((-u, v, 0.0))                          # vista dal fondello -> mondo (x = -u)
    me2 = bpy.data.meshes.new(name)
    me2.from_pydata(out, [], faces)
    ob = bpy.data.objects.new(name, me2)
    bpy.context.scene.collection.objects.link(ob)
    print(f"  {s!r}: centro {cl['c']:.1f} gradi, arco {cl['a1'] - cl['a0']:.1f} gradi, maiuscole {cap:.2f} mm, "
          f"piede r={r_base:.2f} mm, spaziatura {spacing:.2f}")
    return ob


def render_mask(objs, path):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "FLAT"; sc.display.shading.color_type = "SINGLE"
    sc.display.shading.single_color = (1, 1, 1)
    sc.display.render_aa = "32"
    sc.view_settings.view_transform = "Standard"
    if sc.world is None:
        sc.world = bpy.data.worlds.new("w")
    sc.world.color = (0, 0, 0)
    sc.render.film_transparent = False
    sc.render.resolution_x = sc.render.resolution_y = OUT_RES; sc.render.resolution_percentage = 100
    cd = bpy.data.cameras.new("c"); cd.type = "ORTHO"; cd.ortho_scale = 2 * HALF
    cam = bpy.data.objects.new("c", cd); sc.collection.objects.link(cam); sc.camera = cam
    cam.location = (0, 0, 50)
    for o in sc.collection.objects:
        if o.type == "MESH":
            o.hide_render = o not in objs
    sc.render.filepath = path
    sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "BW"
    bpy.ops.render.render(write_still=True)
    m = load_mask(path)
    bpy.data.objects.remove(cam)
    return m


bpy.ops.wm.read_factory_settings(use_empty=True)
for kind in ("open", "solid"):
    orig = os.path.join(SRC, f"caseback_{kind}_disegno.png")
    if not os.path.exists(orig):
        shutil.copy(os.path.join(TEX, f"caseback_{kind}.png"), orig)    # conserva la maschera dal disegno
    old = load_mask(orig)
    cls = clusters(old)
    print(kind, "scritte trovate:", [(round(c["c"]), round(c["a1"] - c["a0"])) for c in cls])
    objs = []
    groups = {ang: [] for ang in TEXTS}
    for c in cls:                                         # ogni gruppo alla scritta piu' vicina, poi si uniscono
        groups[min(TEXTS, key=lambda ang: abs(((c["c"] - ang + 180) % 360) - 180))].append(c)
    for ang, s in TEXTS.items():
        g = groups[ang]
        lo = min(((c["a0"] - ang + 180) % 360) - 180 for c in g) + ang
        hi = max(((c["a1"] - ang + 180) % 360) - 180 for c in g) + ang
        cl = dict(a0=lo, a1=hi, c=(lo + hi) / 2, rmin=min(c["rmin"] for c in g), rmax=max(c["rmax"] for c in g))
        cl["rmin"] = 13.55                                 # stesso piede e stessa altezza per tutte, come nella foto
        cap = 0.88
        objs.append(arc_object(f"{kind}_{s}", s, cl, cap, logo=(s == "MONICHS")))
    tmp = os.path.join(SRC, f"_testo_{kind}.png")
    new = render_mask(objs, tmp)
    os.remove(tmp)
    for o in objs:
        bpy.data.objects.remove(o)
    # maschera finale: fuori dalla fascia resta il disegno (cerchi, montagne), dentro la fascia il testo nuovo
    if kind == "solid":                                   # Celeste e Sunset: il fondello pieno non si vede da vicino
        n = old.shape[0]; f = OUT_RES // n
        new = new.reshape(n, f, n, f).mean((1, 3))
    res = new.shape[0]
    k = res // old.shape[0]
    up = np.kron(old, np.ones((k, k)))
    X, Y = grids(res)
    R = np.hypot(X, Y)
    band = (R > CLEAN[0]) & (R < CLEAN[1])
    final = np.where(band, new, up)
    # cerchio sottile oltre le scritte: continuo come nella foto (nella maschera del disegno era tratteggiato)
    circ = np.clip(1 - np.abs(R - 14.80) / 0.045, 0, 1)
    final = np.where((R > 14.70) & (R < 14.90), circ, final)
    img = bpy.data.images.new(f"caseback_{kind}", res, res, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    rgba = np.repeat(final[::-1, :, None], 4, 2).astype(np.float32); rgba[..., 3] = 1
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = os.path.join(TEX, f"caseback_{kind}.png"); img.file_format = "PNG"; img.save()
    print("salvata", img.filepath_raw)
