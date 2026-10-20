"""Monichs Collezione Delta (ref. cassa 4029) - modelli 3D di Celeste, Sunset e Virentia.

Uso:
  blender --background --factory-startup --python scripts/blender/build_watches.py [-- --no-render | --draft]

Unita: millimetri (1 BU = 1 mm); nei .glb il nodo radice e' scalato a 0.001 (metri).
Assi: x verso ore 3 (corona), y verso ore 12, z verso il quadrante.

Fonti delle quote (vedi ASSETS.md, sezione 8):
- "4029 new band drawing-3.pdf" (bracciale ZS0187, vettoriale 1:1): maglie, lunetta, profilo laterale.
- "4029-MOS-SW200-VR13-EXPLOSION.pdf": cassa 41,1 x 44,0, spessore 11, corona 6, quadrante 29 (tavola 2:1),
  lancette 8,5/13/13 (tavola 4:1), fondelli (tavola 2:1), finiture.
- Modelli/Soldatini/*.png (85,6 px/mm): contorno reale della cassa, quadranti, indici, ora delle lancette.
Le texture dei quadranti e dei fondelli sono prodotte da scripts/blender/textures_src (vedi ASSETS.md).
"""
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "Modelli", "3D")
TEX = os.path.join(OUT, "textures")
RENDERS = os.path.join(OUT, "render")
os.makedirs(RENDERS, exist_ok=True)
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DO_RENDER = "--no-render" not in ARGS
DRAFT = "--draft" in ARGS
RES = 600 if DRAFT else 1400
SAMPLES = 24 if DRAFT else 160

# ------------------------------------------------------------------ quote cassa
CASE_TOP = 8.25          # piano satinato superiore
LUG_SLOPE_Y = 18.7       # inizio della pendenza delle anse
LUG_END = 22.0           # 44,0 mm da ansa ad ansa
LUG_END_Z = 5.15
DIAL_Z = 8.55
CRYSTAL_Z0 = 9.66
LUG_PIN = (20.4, 3.43)   # foro ansa (y, z)
# contorno esterno (sagoma della foto, mezza larghezza x per y >= 0)
OUTER = [(0, 20.57), (1, 20.56), (2, 20.5), (3, 20.43), (4, 20.33), (5, 20.2), (6, 20.03), (7, 19.84), (7.6, 19.64),
         (8, 19.39), (9, 18.47), (10, 17.65), (11, 16.92), (12, 16.25), (13, 15.64), (14, 15.08), (15, 14.54),
         (16, 14.08), (17, 13.68), (18, 13.3), (19, 12.94), (20, 12.56), (21, 12.16), (22, 11.75)]
# bordo del piano superiore (disegno bracciale, vista dall'alto)
TOPEDGE = [(0, 18.98), (1, 18.94), (2, 18.9), (3, 18.82), (4, 18.74), (5, 18.59), (6, 18.41), (7, 18.15), (7.5, 17.86),
           (8, 17.58), (9, 17.05), (10, 16.52), (11, 16.07), (12, 15.6), (13, 15.17), (14, 14.73), (15, 14.32),
           (16, 13.95), (17, 13.6), (18, 13.22), (18.7, 12.95)]
# spigolo inferiore dello smusso lucido del fianco (vista laterale ore 3)
FLANKTOP = [(0, 7.33), (5, 7.33), (7, 7.2), (9, 6.97), (10, 6.78), (12, 6.39), (14, 5.89), (15, 5.6), (16, 5.32),
            (17, 5.01), (18, 4.66), (19, 4.3), (20, 4.0), (22, 3.8)]


def interp(table, y):
    return float(np.interp(abs(y), [p[0] for p in table], [p[1] for p in table]))


def outer_x(y):
    return interp(OUTER, y)


def z_top(y):
    a = abs(y)
    if a <= LUG_SLOPE_Y:
        return CASE_TOP
    return CASE_TOP + (LUG_END_Z - CASE_TOP) * (a - LUG_SLOPE_Y) / (LUG_END - LUG_SLOPE_Y)


def top_x(y):
    a = abs(y)
    o = outer_x(a)
    if a <= LUG_SLOPE_Y:
        return min(interp(TOPEDGE, a), o - 0.6)
    return o - 0.35


def flank_z(y):
    return min(interp(FLANKTOP, y), z_top(y) - 0.35)


# ------------------------------------------------------------------ quadrante (tavola 2:1 + foto)
TRAP = dict(r0=10.38, r1=13.85, w0=1.48, w1=2.02)     # indici 12/3/6/9
BAR = dict(r0=10.45, r1=13.85, w0=1.05, w1=1.05)
PICTO_C, PICTO_H = (0.035, 7.0), 2.95
PICTO = [[(653.8, 483.4), (539.0, 713.0), (768.1, 712.7)],
         [(424.5, 483.7), (309.7, 713.2), (538.8, 713.0)],
         [(538.4, 598.4), (653.1, 368.9), (424.0, 369.1)]]
HANDS_ANG = dict(hour=303.5, minute=59.0, second=218.0)   # come nelle foto (10:09:36)

VARIANTS = {
    "celeste": dict(label="Celeste", ref="M-001", ipr=False, back="solid", dial_rough=0.3, dial_coat=0.12),
    "sunset": dict(label="Sunset", ref="M-002", ipr=False, back="solid", dial_rough=0.2, dial_coat=0.25),
    "virentia": dict(label="Virentia", ref="M-003", ipr=True, back="open", dial_rough=0.35, dial_coat=0.08),
}

# ------------------------------------------------------------------ scena
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 0.001
scene.unit_settings.length_unit = "MILLIMETERS"


# ------------------------------------------------------------------ materiali
def principled(name, color, metal=0.0, rough=0.5, brush=None, **kw):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    for k, v in kw.items():
        b.inputs[k].default_value = v
    if brush:
        # satinatura: anisotropia con tangente radiale attorno all'asse indicato
        b.inputs["Anisotropic"].default_value = 0.75
        tg = nt.nodes.new("ShaderNodeTangent")
        tg.direction_type = "RADIAL"
        tg.axis = brush
        nt.links.new(tg.outputs["Tangent"], b.inputs["Tangent"])
    m.diffuse_color = (*color, 1.0)
    m.metallic, m.roughness = metal, rough
    return m


STEEL = (0.80, 0.80, 0.81)
IPRG = (0.86, 0.50, 0.38)
MAT = {
    "brushed": principled("Acciaio satinato 12-6", STEEL, 1.0, 0.26, brush="X"),
    "circular": principled("Acciaio satinato circolare", STEEL, 1.0, 0.24, brush="Z"),
    "polish": principled("Acciaio lucido", STEEL, 1.0, 0.07),
    "sandblast": principled("Acciaio sabbiato", (0.62, 0.62, 0.63), 1.0, 0.55),
    "dark_satin": principled("Acciaio brunito interno", (0.35, 0.35, 0.36), 1.0, 0.45),
    "satin": principled("Acciaio satinato fine", STEEL, 1.0, 0.18),
    "ipr_polish": principled("Oro rosa IP lucido", IPRG, 1.0, 0.09),
    "ipr_brushed": principled("Oro rosa IP satinato", IPRG, 1.0, 0.26, brush="Z"),
    "glass": principled("Vetro zaffiro AR", (1, 1, 1), 0.0, 0.0,
                        **{"Transmission Weight": 1.0, "IOR": 1.5, "Specular IOR Level": 0.012}),
    "lume": principled("SuperLuminova BGW9", (0.93, 0.95, 0.93), 0.0, 0.45,
                       **{"Emission Color": (0.3, 0.75, 1.0, 1), "Emission Strength": 0.0}),
    "movement": principled("Movimento", (0.72, 0.73, 0.74), 1.0, 0.3, brush="Z"),
    "balance": principled("Bilanciere", (0.85, 0.72, 0.45), 1.0, 0.2),
    "ruby": principled("Rubino", (0.7, 0.02, 0.1), 0.0, 0.05, **{"Transmission Weight": 0.5, "IOR": 1.76}),
}


def image_material(name, img, nimg=None, rough=0.2, coat=0.0, metal=0.0, rough_img=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = img
    nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = 0.04
    if rough_img is not None:
        tr = nt.nodes.new("ShaderNodeTexImage"); tr.image = rough_img
        tr.image.colorspace_settings.name = "Non-Color"
        nt.links.new(tr.outputs["Color"], b.inputs["Roughness"])
    if nimg is not None:
        tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = nimg
        tn.image.colorspace_settings.name = "Non-Color"
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = 0.6
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    return m


def load_img(fn):
    return bpy.data.images.load(os.path.join(TEX, fn), check_existing=True)


def caseback_images(kind):
    """colore e rugosita' del fondello dalla maschera delle incisioni (dal disegno tecnico)"""
    key = f"caseback_{kind}_color"
    if key in bpy.data.images:
        return bpy.data.images[key], bpy.data.images[f"caseback_{kind}_rough"]
    mask = load_img(f"caseback_{kind}.png")
    w, h = mask.size
    px = np.empty(w * h * 4, np.float32); mask.pixels.foreach_get(px)
    m = px.reshape(h, w, 4)[..., 0]
    col = np.ones((h, w, 4), np.float32)
    v = 0.62 * (1 - m) + 0.28 * m
    col[..., 0] = v; col[..., 1] = v; col[..., 2] = v * 1.01
    rough = np.ones((h, w, 4), np.float32)
    rv = 0.28 * (1 - m) + 0.62 * m
    rough[..., 0] = rough[..., 1] = rough[..., 2] = rv
    out = []
    for nm, arr in ((key, col), (f"caseback_{kind}_rough", rough)):
        img = bpy.data.images.new(nm, w, h, alpha=False)
        if "rough" in nm:
            img.colorspace_settings.name = "Non-Color"
        img.pixels.foreach_set(arr.ravel())
        img.filepath_raw = os.path.join(TEX, nm + ".png"); img.file_format = "PNG"; img.save()
        out.append(img)
    return out


# ------------------------------------------------------------------ utilita' bmesh
def finish(bm, name, mats, coll, sharp_deg=35, smooth=True):
    if smooth:
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            if len(e.link_faces) != 2 or e.calc_face_angle(0) > math.radians(sharp_deg):
                e.smooth = False
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in (mats if isinstance(mats, (list, tuple)) else [mats]):
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def merge(tmp, bm, matrix=None, mat_index=None):
    if matrix is not None:
        bmesh.ops.transform(tmp, matrix=matrix, verts=tmp.verts[:])
    if mat_index is not None:
        for f in tmp.faces:
            f.material_index = mat_index
    if bm is None:
        return tmp
    me = bpy.data.meshes.new("_tmp")
    tmp.to_mesh(me); tmp.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    return bm


def poly_ccw(pts):
    a = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]))
    return pts if a > 0 else pts[::-1]


def prism(pts, z0, z1, bevel=0.0, seg=2, bm=None, matrix=None, mat_index=None):
    tmp = bmesh.new()
    vs = [tmp.verts.new((x, y, z0)) for x, y in poly_ccw(list(pts))]
    f = tmp.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(tmp, geom=[f])
    bmesh.ops.translate(tmp, vec=(0, 0, z1 - z0), verts=[e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
    if bevel > 0:
        bmesh.ops.bevel(tmp, geom=tmp.edges[:], offset=bevel, segments=seg, profile=0.5, affect="EDGES", clamp_overlap=True)
    return merge(tmp, bm, matrix, mat_index)


def lathe(profile, n=192, bm=None, closed=True, mat_index=None, a0=0.0, a1=None):
    tmp = bmesh.new()
    full = a1 is None
    cnt = n if full else n + 1
    rings = []
    for r, z in profile:
        if r < 1e-6:
            rings.append([tmp.verts.new((0, 0, z))])
        else:
            ring = []
            for i in range(cnt):
                a = (2 * math.pi * i / n) if full else a0 + (a1 - a0) * i / n
                ring.append(tmp.verts.new((r * math.sin(a), r * math.cos(a), z)))
            rings.append(ring)
    pairs = list(zip(rings[:-1], rings[1:])) + ([(rings[-1], rings[0])] if closed else [])
    for A, B in pairs:
        for i in range(cnt if full else cnt - 1):
            j = (i + 1) % cnt
            q = []
            for v in (A[i % len(A)], A[j % len(A)], B[j % len(B)], B[i % len(B)]):
                if v not in q:
                    q.append(v)
            if len(q) >= 3:
                try:
                    tmp.faces.new(q)
                except ValueError:
                    pass
    if not full and closed:
        for ring_end in (0, cnt - 1):
            vs = [rg[min(ring_end, len(rg) - 1)] for rg in rings]
            uniq = []
            for v in vs:
                if v not in uniq:
                    uniq.append(v)
            if len(uniq) >= 3:
                try:
                    tmp.faces.new(uniq)
                except ValueError:
                    pass
    bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
    return merge(tmp, bm, None, mat_index)


def loft_rings(rings, bm, mats, cap_bottom=True):
    for k in range(len(rings) - 1):
        A, B = rings[k], rings[k + 1]
        n = len(A)
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((A[i], A[j], B[j], B[i]))
            f.material_index = mats[k]
    if cap_bottom:
        f = bm.faces.new(rings[0][::-1])
        f.material_index = mats[0]


def screw(bm, pos, normal, r=0.6, h=0.25, slot=True, mat_index=None):
    n = Vector(normal).normalized()
    q = Vector((0, 0, 1)).rotation_difference(n)
    M = Matrix.Translation(Vector(pos)) @ q.to_matrix().to_4x4()
    tmp = bmesh.new()
    prof = [(0, h), (r * 0.55, h * 0.95), (r * 0.9, h * 0.7), (r, h * 0.35), (r, 0), (0, 0)]
    lathe(prof, n=24, bm=tmp, closed=True)
    if slot:
        for v in tmp.verts:
            if abs(v.co.x) < r * 0.13 and v.co.z > h * 0.3:
                v.co.z = h * 0.3
    return merge(tmp, bm, M, mat_index)


def rot2(pts, deg_cw):
    a = math.radians(deg_cw)
    c, s = math.cos(a), math.sin(a)
    return [(x * c + y * s, -x * s + y * c) for x, y in pts]


def circle_pts(r, cx=0.0, cy=0.0, n=40):
    return [(cx + r * math.sin(2 * math.pi * i / n), cy + r * math.cos(2 * math.pi * i / n)) for i in range(n)]


def picto_tris(height, cx=0.0, cy=0.0):
    s = height / (713.2 - 368.9)
    return [[(cx + (x - 538.95) * s, cy - (y - 541.05) * s) for x, y in tri] for tri in PICTO]


def pyramid_tris(bm, tris, z0, h, apex_h=None, mat_index=None):
    """triangoli applicati sfaccettati (vertice centrale rialzato)"""
    for tri in tris:
        tmp = bmesh.new()
        cxy = (sum(p[0] for p in tri) / 3, sum(p[1] for p in tri) / 3)
        tri = poly_ccw(tri)
        base = [tmp.verts.new((x, y, z0)) for x, y in tri]
        topv = [tmp.verts.new((x + (cxy[0] - x) * 0.08, y + (cxy[1] - y) * 0.08, z0 + h)) for x, y in tri]
        apex = tmp.verts.new((cxy[0], cxy[1], z0 + (apex_h or h * 1.8)))
        tmp.faces.new(base[::-1])
        for i in range(3):
            j = (i + 1) % 3
            tmp.faces.new((base[i], base[j], topv[j], topv[i]))
            tmp.faces.new((topv[i], topv[j], apex))
        merge(tmp, bm, None, mat_index)


def ray_poly(poly, ang):
    """distanza dal centro al bordo di un poligono convesso lungo l'angolo (orario da ore 12)"""
    d = (math.sin(ang), math.cos(ang))
    best = None
    for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
        ex, ey = x1 - x0, y1 - y0
        den = d[0] * ey - d[1] * ex
        if abs(den) < 1e-12:
            continue
        t = (x0 * ey - y0 * ex) / den
        u = (x0 * d[1] - y0 * d[0]) / den
        if t > 0 and -1e-9 <= u <= 1 + 1e-9:
            best = t if best is None else min(best, t)
    return best


def octagon(ap, hx, hy):
    """ottagono del fondello: lati piani a +-ap, semi-lunghezze hx (lati 12/6) e hy (lati 3/9)"""
    return [(hx, ap), (ap, hy), (ap, -hy), (hx, -ap), (-hx, -ap), (-ap, -hy), (-ap, hy), (-hx, ap)]


# ------------------------------------------------------------------ cassa
def build_case(v, coll):
    ys = sorted(set([round(float(y), 3) for y in np.arange(-LUG_END, LUG_END + 1e-6, 0.25)] + [-LUG_SLOPE_Y, LUG_SLOPE_Y]))
    m_end = 21
    ny = len(ys)

    def stations(fx):
        pts = [(fx(y), y) for y in ys]                                   # lato ore 3, verso ore 12
        e = fx(LUG_END)
        pts += [(e * s, LUG_END) for s in np.linspace(1, -1, m_end)[1:-1]]
        pts += [(-fx(y), y) for y in ys[::-1]]                           # lato ore 9, verso ore 6
        e = fx(-LUG_END)
        pts += [(e * s, -LUG_END) for s in np.linspace(-1, 1, m_end)[1:-1]]
        return pts

    bm = bmesh.new()

    def ring(fx, fz):
        return [bm.verts.new((x, y, fz(y))) for x, y in stations(fx)]

    r0 = ring(lambda y: outer_x(y) - 1.0, lambda y: 1.2)
    r1 = ring(outer_x, lambda y: 2.0)
    r2 = ring(outer_x, flank_z)
    r3 = ring(top_x, z_top)
    # materiali: 0 satinato 12-6, 1 lucido, 2 fianco satinato orizzontale, 3 sabbiato
    loft_rings([r0, r1, r2, r3], bm, [1, 2, 1], cap_bottom=True)
    li = ny + m_end - 2            # inizio del lato ore 9
    right = [r3[i] for i in range(ny) if abs(ys[i]) <= LUG_SLOPE_Y + 1e-6]
    left = [r3[li + i] for i in range(ny) if abs(ys[::-1][i]) <= LUG_SLOPE_Y + 1e-6]
    f = bm.faces.new(right + left); f.material_index = 0
    rr = [r3[i] for i in range(ny) if ys[i] >= LUG_SLOPE_Y - 1e-6]
    ll = [r3[li + i] for i in range(ny) if ys[::-1][i] >= LUG_SLOPE_Y - 1e-6]
    f = bm.faces.new(rr + r3[ny:li] + ll); f.material_index = 0
    ll = [r3[li + i] for i in range(ny) if ys[::-1][i] <= -LUG_SLOPE_Y + 1e-6]
    rr = [r3[i] for i in range(ny) if ys[i] <= -LUG_SLOPE_Y + 1e-6]
    f = bm.faces.new(ll + r3[li + ny:] + rr); f.material_index = 0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    case = finish(bm, f"{v['key']}_cassa", [MAT["brushed"], MAT["polish"], MAT["circular"], MAT["sandblast"]], coll, sharp_deg=28)

    # tagli booleani: vano movimento, sedi delle anse, scanalature sabbiate dei fianchi
    cutters = [lathe([(0, 0.9), (13.6, 0.9), (13.6, 7.9), (0, 7.9)], n=96)]
    for sgn in (1, -1):
        cutters.append(prism([(-6.8, sgn * 20.45), (6.8, sgn * 20.45), (6.8, sgn * 23.5), (-6.8, sgn * 23.5)], 1.0, 9.5))
    for sx in (1, -1):
        for sy in (1, -1):
            sb = bmesh.new()
            rows = []
            for y in np.linspace(7.7, 16.0, 24):
                t = (y - 7.7) / (16.0 - 7.7)
                zb, zt = 3.05 + 0.30 * t, 5.35 - 1.10 * t
                xo = outer_x(y)
                rows.append([sb.verts.new((sx * (xo - 0.28), sy * y, zb)), sb.verts.new((sx * (xo + 1.5), sy * y, zb)),
                             sb.verts.new((sx * (xo + 1.5), sy * y, zt)), sb.verts.new((sx * (xo - 0.28), sy * y, zt))])
            for a, b in zip(rows[:-1], rows[1:]):
                for i in range(4):
                    j = (i + 1) % 4
                    sb.faces.new((a[i], a[j], b[j], b[i]))
            sb.faces.new(rows[0][::-1]); sb.faces.new(rows[-1])
            bmesh.ops.recalc_face_normals(sb, faces=sb.faces[:])
            for fc in sb.faces:
                fc.material_index = 3
            cutters.append(sb)
    for cbm in cutters:
        me = bpy.data.meshes.new("_cut")
        cbm.to_mesh(me); cbm.free()
        for mk in ("brushed", "polish", "circular", "sandblast"):
            me.materials.append(MAT[mk])
        ob = bpy.data.objects.new("_cut", me)
        coll.objects.link(ob)
        mod = case.modifiers.new("cut", "BOOLEAN")
        mod.operation, mod.object, mod.solver = "DIFFERENCE", ob, "EXACT"
        try:
            mod.material_mode = "TRANSFER"
        except Exception:
            pass
        bpy.context.view_layer.objects.active = case
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(ob)
    return case


def build_bezel(v, coll):
    """lunetta in due pezzi: anello interno satinato circolare + anello esterno lucido/IPRG, settori a ore 12/3/6/9"""
    TAB = 24.0
    C = lambda r: 10.06 - 0.343 * (r - 14.87)

    def is_tab(adeg):
        return abs((adeg + 45) % 90 - 45) < TAB

    angs = [(float(a), None) for a in np.arange(0, 360, 0.5)]
    for c in (0, 90, 180, 270):
        for b in (c - TAB, c + TAB):
            angs.append((b % 360, "edge"))
    angs.sort(key=lambda t: t[0])

    def profile(tab, idx):
        rb = 16.53 if tab else 17.83
        if idx == 0:
            return [(14.6, CASE_TOP), (rb, CASE_TOP), (rb, C(rb)), (14.87, C(14.87)), (14.6, 9.95)]
        return [(rb, CASE_TOP), (18.53, CASE_TOP), (18.53, 8.40), (rb, 9.04)]

    for part, idx in (("anello_interno", 0), ("anello_esterno", 1)):
        bm = bmesh.new()
        loops = []
        for a, kind in angs:
            ar = math.radians(a)
            tabs = [is_tab(a - 0.01), is_tab(a + 0.01)] if kind == "edge" else [is_tab(a)]
            for t in tabs:
                loops.append([bm.verts.new((r * math.sin(ar), r * math.cos(ar), z)) for r, z in profile(t, idx)])
        n = len(loops)
        for i in range(n):
            A, B = loops[i], loops[(i + 1) % n]
            k = len(A)
            for p in range(k):
                q = (p + 1) % k
                try:
                    bm.faces.new((A[p], A[q], B[q], B[p]))
                except ValueError:
                    pass
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
        bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        mat = MAT["circular"] if idx == 0 else (MAT["ipr_polish"] if v["ipr"] else MAT["polish"])
        finish(bm, f"{v['key']}_lunetta_{part}", mat, coll, sharp_deg=25)


def build_flange(v, coll):
    """smusso interno fra quadrante e vetro (foto: quadrante visibile fino a r 13,9)"""
    bm = lathe([(13.95, DIAL_Z + 0.02), (14.62, DIAL_Z + 0.02), (14.62, CRYSTAL_Z0 - 0.02), (14.25, CRYSTAL_Z0 - 0.05)], n=192)
    finish(bm, f"{v['key']}_rehaut", MAT["dark_satin"], coll, sharp_deg=30)


def build_crystal(v, coll):
    prof = [(0, CRYSTAL_Z0), (14.6, CRYSTAL_Z0), (14.6, 10.12), (14.48, 10.22)]
    for r in np.linspace(14.3, 0.0, 16):
        prof.append((float(r), 10.73 - r * r / (2 * 210.0)))
    ob = finish(lathe(prof, n=192), f"{v['key']}_vetro", MAT["glass"], coll, sharp_deg=40)
    ob.visible_shadow = False


def build_dial(v, coll):
    key = v["key"]
    img = load_img(f"{key}_dial.png"); nimg = load_img(f"{key}_dial_normal.png")
    dm = image_material(f"Quadrante {v['label']}", img, nimg, v["dial_rough"], v["dial_coat"])
    bm = bmesh.new()
    n = 256
    top = [bm.verts.new((14.5 * math.sin(2 * math.pi * i / n), 14.5 * math.cos(2 * math.pi * i / n), DIAL_Z)) for i in range(n)]
    bot = [bm.verts.new((p.co.x, p.co.y, DIAL_Z - 0.4)) for p in top]
    ft = bm.faces.new(top[::-1]); ft.normal_update()
    if ft.normal.z < 0:
        ft.normal_flip()
    uv = bm.loops.layers.uv.new("UVMap")
    for l in ft.loops:
        l[uv].uv = (l.vert.co.x / 29.0 + 0.5, l.vert.co.y / 29.0 + 0.5)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((top[i], top[j], bot[j], bot[i]))
    bm.faces.new(bot)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if f.calc_center_median().z > DIAL_Z - 0.01 and len(f.verts) > 4])
    finish(bm, f"{key}_quadrante", dm, coll, smooth=False)

    acc = MAT["ipr_polish"] if v["ipr"] else MAT["polish"]
    frames, lume = bmesh.new(), bmesh.new()
    for h in range(12):
        g = TRAP if h % 3 == 0 else BAR

        def quad(inset, r0, r1):
            w0 = g["w0"] - 2 * inset; w1 = g["w1"] - 2 * inset
            return poly_ccw(rot2([(-w0 / 2, r0), (w0 / 2, r0), (w1 / 2, r1), (-w1 / 2, r1)], h * 30))

        tmp = bmesh.new()
        base = [tmp.verts.new((x, y, DIAL_Z)) for x, y in quad(0, g["r0"], g["r1"])]
        topv = [tmp.verts.new((x, y, DIAL_Z + 0.42)) for x, y in quad(0.2, g["r0"] + 0.2, g["r1"] - 0.2)]
        tmp.faces.new(base[::-1])
        for i in range(4):
            j = (i + 1) % 4
            tmp.faces.new((base[i], base[j], topv[j], topv[i]))
        tmp.faces.new(topv)
        merge(tmp, frames)
        prism(quad(0.3, g["r0"] + 0.3, g["r1"] - 0.3), DIAL_Z + 0.35, DIAL_Z + 0.44, bm=lume)
    finish(frames, f"{key}_indici", acc, coll, sharp_deg=20)
    finish(lume, f"{key}_indici_luminova", MAT["lume"], coll)
    pic = bmesh.new()
    pyramid_tris(pic, picto_tris(PICTO_H, *PICTO_C), DIAL_Z, 0.12, apex_h=0.3)
    finish(pic, f"{key}_logo_applicato", acc, coll, sharp_deg=10)


def build_hands(v, coll):
    key = v["key"]
    acc = MAT["ipr_polish"] if v["ipr"] else MAT["polish"]

    def plank(hw, tail, body_end, tip, hub_r):
        """sagoma (x laterale, y lungo la lancetta): listello + mozzo + punta (tavola 4:1)"""
        cut = math.sqrt(max(hub_r ** 2 - hw ** 2, 0))
        a_s = math.asin(hw / hub_r)
        pts = [(-hw, -tail), (hw, -tail), (hw, -cut)]
        for i in range(1, 12):
            t = math.pi - a_s - (math.pi - 2 * a_s) * i / 12
            pts.append((hub_r * math.sin(t), hub_r * math.cos(t)))
        pts += [(hw, cut), (hw, body_end), (0, tip), (-hw, body_end), (-hw, cut)]
        for i in range(1, 12):
            t = -a_s - (math.pi - 2 * a_s) * i / 12
            pts.append((hub_r * math.sin(t), hub_r * math.cos(t)))
        pts += [(-hw, -cut)]
        return pts

    def faceted(bm, pts, z0, t, ridge, hw):
        """listello a due falde con costola centrale"""
        for side in (1, -1):
            half = []
            n = len(pts)
            for i in range(n):
                p, q = pts[i], pts[(i + 1) % n]
                pin, qin = p[0] * side >= -1e-9, q[0] * side >= -1e-9
                if pin:
                    half.append(p)
                if pin != qin:
                    t_ = p[0] / (p[0] - q[0])
                    half.append((0.0, p[1] + (q[1] - p[1]) * t_))
            clean = []
            for p in half:
                if not clean or abs(p[0] - clean[-1][0]) + abs(p[1] - clean[-1][1]) > 1e-6:
                    clean.append(p)
            if len(clean) < 3:
                continue
            tmp = prism(clean, z0, z0 + t)
            for vv in tmp.verts:
                if vv.co.z > z0 + t * 0.5:
                    vv.co.z = z0 + t + ridge * max(0.0, 1 - abs(vv.co.x) / hw)
            merge(tmp, bm)

    def place(bm, ang):
        bmesh.ops.transform(bm, matrix=Matrix.Rotation(-math.radians(ang), 4, "Z"), verts=bm.verts[:])

    # impilaggio: ore 8,98-9,20 | minuti 9,21-9,42 | secondi 9,43-9,51 | vetro da 9,66
    z_h, z_m, z_s = DIAL_Z + 0.43, DIAL_Z + 0.66, DIAL_Z + 0.88
    hb, hl = bmesh.new(), bmesh.new()
    faceted(hb, plank(1.05, 2.53, 7.54, 8.5, 1.52), z_h, 0.06, 0.16, 1.05)
    prism([(-0.6, 2.78), (0.6, 2.78), (0.6, 4.41), (-0.6, 4.41)], z_h + 0.19, z_h + 0.225, bm=hl)
    prism([(-0.6, 4.95), (0.6, 4.95), (0.6, 7.42), (0, 7.98), (-0.6, 7.42)], z_h + 0.19, z_h + 0.225, bm=hl)
    place(hb, HANDS_ANG["hour"]); place(hl, HANDS_ANG["hour"])
    mb, ml = bmesh.new(), bmesh.new()
    faceted(mb, plank(0.955, 2.53, 12.08, 13.04, 1.3), z_m, 0.06, 0.15, 0.955)
    prism([(-0.55, 2.63), (0.55, 2.63), (0.55, 5.8), (-0.55, 5.8)], z_m + 0.18, z_m + 0.215, bm=ml)
    prism([(-0.55, 6.36), (0.55, 6.36), (0.55, 11.88), (0, 12.46), (-0.55, 11.88)], z_m + 0.18, z_m + 0.215, bm=ml)
    place(mb, HANDS_ANG["minute"]); place(ml, HANDS_ANG["minute"])
    sb, sl = bmesh.new(), bmesh.new()
    prism([(-0.12, -2.87), (0.12, -2.87), (0.12, 8.8), (-0.12, 8.8)], z_s, z_s + 0.08, bm=sb)
    prism([(-0.1, 10.7), (0.1, 10.7), (0.06, 13.13), (-0.06, 13.13)], z_s, z_s + 0.08, bm=sb)
    prism([(-0.8, 8.8), (0.8, 8.8), (0, 10.73)], z_s, z_s + 0.08, bm=sb)
    prism(circle_pts(0.49, 0, -2.87), z_s, z_s + 0.08, bm=sb)
    prism(circle_pts(0.75), z_s, z_s + 0.1, bm=sb)
    prism([(-0.55, 9.0), (0.55, 9.0), (0, 10.4)], z_s + 0.08, z_s + 0.11, bm=sl)
    place(sb, HANDS_ANG["second"]); place(sl, HANDS_ANG["second"])
    cbm = bmesh.new()
    prism(circle_pts(0.93), DIAL_Z, z_h + 0.05, bm=cbm)
    prism(circle_pts(0.62), z_h, z_m + 0.05, bm=cbm)
    prism(circle_pts(0.42), z_m, z_s + 0.05, bm=cbm)
    prism(circle_pts(0.48), z_s + 0.1, z_s + 0.2, bevel=0.08, seg=2, bm=cbm)
    sat = MAT["ipr_brushed"] if v["ipr"] else MAT["satin"]
    for bm_, nm, mt in ((hb, "lancetta_ore", acc), (mb, "lancetta_minuti", acc), (sb, "lancetta_secondi", sat), (cbm, "cannoni", sat)):
        finish(bm_, f"{key}_{nm}", mt, coll, sharp_deg=15)
    lum = bmesh.new()
    for b_ in (hl, ml, sl):
        merge(b_, lum)
    finish(lum, f"{key}_lancette_luminova", MAT["lume"], coll)


def build_crown(v, coll):
    key = v["key"]
    x0, x1, zc = 20.2, 22.25, 4.09
    nt_, nsl = 40, 7
    bm = bmesh.new()
    rings = []
    for k in range(nsl):
        x = x0 + (x1 - 0.25 - x0) * k / (nsl - 1)
        tw = math.radians(28) * k / (nsl - 1)          # zigrinatura elicoidale
        ring = []
        for i in range(nt_):
            a = 2 * math.pi * i / nt_ + tw
            r = 3.4 if i % 2 == 0 else 3.08
            ring.append(bm.verts.new((x, r * math.cos(a), zc + r * math.sin(a))))
        rings.append(ring)
    cap = [bm.verts.new((x1, 2.95 * math.cos(2 * math.pi * i / nt_), zc + 2.95 * math.sin(2 * math.pi * i / nt_))) for i in range(nt_)]
    rings.append(cap)
    for A, B in zip(rings[:-1], rings[1:]):
        for i in range(nt_):
            j = (i + 1) % nt_
            bm.faces.new((A[i], A[j], B[j], B[i]))
    bm.faces.new(cap); bm.faces.new(rings[0][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    finish(bm, f"{key}_corona", MAT["circular"], coll, sharp_deg=50)
    pic = bmesh.new()
    pyramid_tris(pic, picto_tris(2.9), 0.0, 0.06, apex_h=0.12)
    M = Matrix.Translation((x1, 0, zc)) @ Matrix.Rotation(math.radians(90), 4, "Y") @ Matrix.Rotation(math.radians(-90), 4, "Z")
    bmesh.ops.transform(pic, matrix=M, verts=pic.verts[:])
    finish(pic, f"{key}_corona_logo", MAT["sandblast"], coll, sharp_deg=10)


def build_screws(v, coll):
    key = v["key"]
    bm = bmesh.new()
    for sx in (1, -1):
        for sy in (1, -1):
            for y, z, r, inset in ((5.8, 4.52, 0.82, 0.0), (16.8, 3.28, 0.72, 0.3)):
                x = outer_x(y)
                dx = (outer_x(y + 0.05) - outer_x(y - 0.05)) / 0.1
                nrm = Vector((sx * 1.0, -sy * dx, 0)).normalized()
                screw(bm, Vector((sx * x, sy * y, z)) - nrm * (0.05 + inset), nrm, r=r, h=0.22)
            y = LUG_PIN[0]
            screw(bm, (sx * (outer_x(y) - 0.02), sy * y, LUG_PIN[1]), (sx, 0, 0), r=0.6, h=0.12, slot=False)
    for x, y in ((0, 17.2), (0, -17.2), (13.6, 10.9), (-13.6, 10.9), (13.6, -10.9), (-13.6, -10.9)):
        screw(bm, (x, y, 0.42), (0, 0, -1), r=0.75, h=0.2)
    finish(bm, f"{key}_viti", MAT["polish"], coll, sharp_deg=40)


def build_caseback(v, coll):
    key = v["key"]
    outer = octagon(18.25, 11.47, 5.7)
    inner = octagon(15.5, 9.9, 5.2)
    open_ = v["back"] == "open"
    col_img, rough_img = caseback_images("open" if open_ else "solid")
    cmat = image_material(f"Fondello {v['label']}", col_img, None, 0.3, 0.0, 1.0, rough_img)
    angs = [2 * math.pi * i / 256 for i in range(256)]
    for poly in (outer, inner):
        for x, y in poly:
            angs.append(math.atan2(x, y) % (2 * math.pi))
    angs = sorted(set(round(a, 6) for a in angs))
    m = len(angs)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")

    def ringv(poly, z):
        return [bm.verts.new((ray_poly(poly, a) * math.sin(a), ray_poly(poly, a) * math.cos(a), z)) for a in angs]

    rin, rout, rtop = ringv(inner, 0.0), ringv(outer, 0.85), ringv(outer, 1.25)
    for A, B in ((rin, rout), (rout, rtop)):
        for i in range(m):
            j = (i + 1) % m
            f = bm.faces.new((A[i], A[j], B[j], B[i])); f.material_index = 1
    if open_:
        rc = [bm.verts.new((12.27 * math.sin(a), 12.27 * math.cos(a), 0.0)) for a in angs]
        rc2 = [bm.verts.new((12.27 * math.sin(a), 12.27 * math.cos(a), 1.25)) for a in angs]
        for i in range(m):
            j = (i + 1) % m
            f = bm.faces.new((rc[i], rc[j], rin[j], rin[i])); f.material_index = 0
            f = bm.faces.new((rc2[i], rc2[j], rc[j], rc[i])); f.material_index = 1
            f = bm.faces.new((rtop[i], rtop[j], rc2[j], rc2[i])); f.material_index = 1   # anello superiore con finestra
    else:
        f = bm.faces.new(rtop); f.material_index = 1
        f = bm.faces.new(rin[::-1]); f.material_index = 0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for f in bm.faces:
        for l in f.loops:
            l[uv].uv = (l.vert.co.x / 37.2 + 0.5, l.vert.co.y / 37.2 + 0.5)
    finish(bm, f"{key}_fondello", [cmat, MAT["polish"]], coll, sharp_deg=25)
    if open_:
        gob = finish(lathe([(0, 0.15), (12.4, 0.15), (12.4, 1.0), (0, 1.0)], n=128), f"{key}_fondello_zaffiro", MAT["glass"], coll, sharp_deg=40)
        gob.visible_shadow = False
        build_movement(v, coll)


def build_movement(v, coll):
    """SW200 visto dal fondello in zaffiro: foto Vi (4) raddrizzata (ellisse della finestra -> cerchio)
    su un disco alla quota del rotore, piu' la platina dietro."""
    key = v["key"]
    img = load_img("virentia_movement.png")
    mm = image_material("Movimento (foto Vi 4)", img, None, 0.45, 0.0, 0.0)
    bm = bmesh.new()
    n = 192
    ring = [bm.verts.new((12.35 * math.sin(2 * math.pi * i / n), 12.35 * math.cos(2 * math.pi * i / n), 1.55)) for i in range(n)]
    f = bm.faces.new(ring)
    f.normal_update()
    if f.normal.z > 0:
        f.normal_flip()          # rivolto verso il fondello
    uv = bm.loops.layers.uv.new("UVMap")
    for l in f.loops:
        l[uv].uv = (l.vert.co.x / 24.8 + 0.5, l.vert.co.y / 24.8 + 0.5)
    bmesh.ops.triangulate(bm, faces=[f])
    finish(bm, f"{key}_movimento", mm, coll, smooth=False)
    plate = lathe([(0, 1.6), (12.9, 1.6), (12.9, 4.2), (0, 4.2)], n=96)
    finish(plate, f"{key}_movimento_platina", MAT["movement"], coll, sharp_deg=30)


# ------------------------------------------------------------------ bracciale (disegno ZS0187)
OUTER_LINKS = [  # larghezze lato cassa/lato chiusura, recesso trapezio (largo, stretto, profondita'), recesso rett., spessore
    dict(w0=24.00, w1=22.24, ta=13.62, tb=10.50, td=2.6, rr=12.90, t=3.3),
    dict(w0=22.20, w1=20.73, ta=12.85, tb=9.85, td=2.5, rr=11.90, t=3.2),
    dict(w0=20.70, w1=19.52, ta=11.85, tb=8.85, td=2.5, rr=11.10, t=3.2),
    dict(w0=19.50, w1=18.61, ta=11.05, tb=8.05, td=2.5, rr=10.10, t=3.2),
    dict(w0=18.59, w1=18.00, ta=10.05, tb=7.05, td=2.5, rr=9.10, t=3.2),
]
REMOVABLE = dict(w0=18.0, w1=18.0, ta=9.05, tb=6.05, td=2.5, rr=9.10, t=3.2)
TAIL = dict(w0=18.0, w1=18.0, ta=9.05, tb=6.05, td=2.5, rr=0.0, t=3.2)
CENTERS = [12.80, 11.80, 11.00, 10.00, 9.00]
N_REMOVABLE = 2   # maglie amovibili per lato (il disegno ne prevede 4: 2 tolte per un polso medio)
PIVOT_H = 1.5
CLASP = 22.0


def arc_top(tmp, L, t, R):
    """curvatura superiore (R15 esterne, R10 centrali): fette trasversali e abbassamento delle estremita'"""
    for k in range(1, 6):
        u = L * k / 6
        bmesh.ops.bisect_plane(tmp, geom=tmp.verts[:] + tmp.edges[:] + tmp.faces[:], plane_co=(0, u, 0), plane_no=(0, 1, 0))
    for vv in tmp.verts:
        if vv.co.z > t * 0.55:
            du = vv.co.y - L / 2
            vv.co.z -= du * du / (2 * R)


def outer_link_bm(d):
    """maglia esterna: y locale lungo il bracciale (0 lato cassa -> 7,5 lato chiusura), x trasversale"""
    L = 7.5
    w0, w1 = d["w0"] / 2, d["w1"] / 2
    pts = [(0, -w0), (L, -w1)]
    if d["rr"] > 0:
        pts += [(L, -d["rr"] / 2), (L - 3.0, -d["rr"] / 2), (L - 3.0, d["rr"] / 2), (L, d["rr"] / 2)]
    pts += [(L, w1), (0, w0), (0, d["ta"] / 2), (d["td"], d["tb"] / 2), (d["td"], -d["tb"] / 2), (0, -d["ta"] / 2)]
    tmp = prism([(w, u) for u, w in pts], 0.0, d["t"], bevel=0.32, seg=2)
    arc_top(tmp, L, d["t"], 15.0)
    return tmp


def center_link_bm(wc, L=5.5, rect=3.0, t=3.5, narrow=None):
    nw = (wc - 3.0) if narrow is None else narrow
    pts = [(0, -wc / 2), (rect, -wc / 2), (L, -nw / 2), (L, nw / 2), (rect, wc / 2), (0, wc / 2)]
    tmp = prism([(w, u) for u, w in pts], 0.0, t, bevel=0.4, seg=3)
    arc_top(tmp, L, t, 10.0)
    return tmp


def ellipse_pts(a, b, zc, n=40000):
    ts = np.linspace(0, 2 * math.pi, n)
    return np.stack([a * np.sin(ts), zc + b * np.cos(ts)], 1)   # t=0 in alto, poi verso +y e in basso


def chain_pivots(segs, pts, start):
    i = int(np.argmin(np.linalg.norm(pts[: len(pts) // 2] - np.array(start), axis=1)))
    piv = [np.array(start, float)]
    for L in segs:
        while i < len(pts) - 1 and np.linalg.norm(pts[i] - piv[-1]) < L:
            i += 1
        p0, p1 = pts[i - 1], pts[i]
        lo, hi = 0.0, 1.0
        for _ in range(30):
            mid = (lo + hi) / 2
            if np.linalg.norm(p0 + (p1 - p0) * mid - piv[-1]) < L:
                lo = mid
            else:
                hi = mid
        piv.append(p0 + (p1 - p0) * lo)
    return piv


def frame(p, q, side):
    """origine p, asse locale y lungo p->q (piano y-z del mondo), z verso l'esterno dell'anello"""
    d = Vector((0, side * (q[0] - p[0]), (q[1] - p[1]))).normalized()
    X = Vector((side, 0, 0))
    Z = X.cross(d)
    M = Matrix((X, d, Z)).transposed().to_4x4()
    M.translation = Vector((0, side * p[0], p[1]))
    return M


def build_bracelet(v, coll):
    key = v["key"]
    seq_outer = OUTER_LINKS + [REMOVABLE] * N_REMOVABLE + [TAIL]
    seq_center = CENTERS + [9.0] * N_REMOVABLE
    segs = [3.0]
    for k in range(len(seq_outer)):
        segs.append(4.5)
        if k < len(seq_center):
            segs.append(3.2)

    def solve(a):
        b = a * 0.83
        zc = LUG_PIN[1] - b * math.sqrt(max(1 - (LUG_PIN[0] / a) ** 2, 1e-6))
        return a, b, zc, chain_pivots(segs, ellipse_pts(a, b, zc), LUG_PIN)

    lo_s, hi_s = 21.0, 50.0
    for _ in range(40):
        a, b, zc, piv = solve((lo_s + hi_s) / 2)
        end = piv[-1]
        # catena troppo lunga per l'ellisse (capi oltre il punto in cui resta CLASP mm): allarga l'ellisse
        if end[0] < CLASP / 2 and end[1] < zc:
            lo_s = a
        else:
            hi_s = a
    a, b, zc, piv = solve((lo_s + hi_s) / 2)
    bo, bc = bmesh.new(), bmesh.new()
    for side in (1, -1):
        M = frame(piv[0], piv[1], side)
        head = center_link_bm(13.45, L=5.79, rect=3.29, t=4.6, narrow=10.45)
        bmesh.ops.translate(head, vec=(0, -1.6, -PIVOT_H), verts=head.verts[:])
        merge(head, bc, M)
        k = 1
        for i, d in enumerate(seq_outer):
            M = frame(piv[k], piv[k + 1], side)
            ol = outer_link_bm(d)
            bmesh.ops.translate(ol, vec=(0, -1.5, -PIVOT_H), verts=ol.verts[:])
            merge(ol, bo, M)
            k += 1
            if i < len(seq_center):
                M = frame(piv[k], piv[k + 1], side)
                cl = center_link_bm(seq_center[i])
                bmesh.ops.translate(cl, vec=(0, -1.5, -PIVOT_H - 0.15), verts=cl.verts[:])
                merge(cl, bc, M)
                k += 1
    for b_ in (bo, bc):
        bmesh.ops.recalc_face_normals(b_, faces=b_.faces[:])
    finish(bo, f"{key}_bracciale_maglie_esterne", MAT["brushed"], coll, sharp_deg=30)
    finish(bc, f"{key}_bracciale_maglie_centrali", MAT["ipr_polish"] if v["ipr"] else MAT["polish"], coll, sharp_deg=30)

    # chiusura deployante a doppio pulsante: coperchio curvo fra i due capi
    end = piv[-1]
    half = abs(end[0]) + 1.5
    ys = np.linspace(-half, half, 17)
    rows = [(float(y), zc - b * math.sqrt(max(1 - (y / a) ** 2, 0))) for y in ys]
    cl = bmesh.new()
    for (y0, z0_), (y1, z1_) in zip(rows[:-1], rows[1:]):
        L = math.hypot(y1 - y0, z1_ - z0_)
        prism([(-9.3, -0.02), (9.3, -0.02), (9.3, L + 0.02), (-9.3, L + 0.02)], -1.6, 1.6, bm=cl, matrix=frame((y0, z0_), (y1, z1_), 1))
    bmesh.ops.remove_doubles(cl, verts=cl.verts[:], dist=0.05)
    finish(cl, f"{key}_chiusura", MAT["brushed"], coll, sharp_deg=30)
    pl = bmesh.new()
    prism([(-4.75, -4.75), (4.75, -4.75), (4.75, 4.75), (-4.75, 4.75)], 0.0, 0.12, bevel=0.05, seg=1, bm=pl)
    pyramid_tris(pl, picto_tris(3.2), 0.12, 0.03, apex_h=0.05)
    bmesh.ops.transform(pl, matrix=Matrix.Translation((0, 0, zc - b - 1.6)) @ Matrix.Rotation(math.pi, 4, "X"), verts=pl.verts[:])
    finish(pl, f"{key}_chiusura_logo", MAT["ipr_polish"] if v["ipr"] else MAT["polish"], coll, sharp_deg=10)
    pbm = bmesh.new()
    for sx in (1, -1):
        for yy in (-7.5, 7.5):
            zz = zc - b * math.sqrt(max(1 - (yy / a) ** 2, 0))
            t = lathe([(0, 0), (1.1, 0), (1.1, 0.7), (0.8, 0.95), (0, 0.95)], n=24)
            merge(t, pbm, Matrix.Translation((sx * 9.25, yy, zz)) @ Matrix.Rotation(math.radians(90 * sx), 4, "Y"))
    finish(pbm, f"{key}_chiusura_pulsanti", MAT["polish"], coll, sharp_deg=40)
    return dict(a=round(a, 2), b=round(b, 2), zc=round(zc, 2), estremo=[round(float(c), 2) for c in end])


# ------------------------------------------------------------------ orologio completo
def build_watch(key):
    v = dict(VARIANTS[key], key=key)
    coll = bpy.data.collections.new(v["label"])
    scene.collection.children.link(coll)
    build_case(v, coll)
    build_bezel(v, coll)
    build_crystal(v, coll)
    build_flange(v, coll)
    build_dial(v, coll)
    build_hands(v, coll)
    build_crown(v, coll)
    build_screws(v, coll)
    build_caseback(v, coll)
    info = build_bracelet(v, coll)
    root = bpy.data.objects.new(v["label"], None)
    root.empty_display_type = "PLAIN_AXES"; root.empty_display_size = 25
    coll.objects.link(root)
    for ob in coll.objects:
        if ob is not root:
            ob.parent = root
    print(key, "bracciale", info)
    return root, coll


roots = {k: build_watch(k) for k in VARIANTS}
for me in list(bpy.data.meshes):
    if me.users == 0:
        bpy.data.meshes.remove(me)

for key, (root, coll) in roots.items():
    bpy.ops.object.select_all(action="DESELECT")
    for ob in coll.objects:
        ob.select_set(True)
    root.scale = (0.001, 0.001, 0.001); root.location = (0, 0, 0)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, f"{key}.glb"), export_format="GLB", use_selection=True,
                              export_yup=True, export_image_format="JPEG", export_image_quality=90)
    root.scale = (1, 1, 1)
for i, key in enumerate(VARIANTS):
    roots[key][0].location = ((i - 1) * 70.0, 0, 0)

# ------------------------------------------------------------------ luci e render
world = bpy.data.worlds.new("Studio")
scene.world = world
world.use_nodes = True
wn = world.node_tree
# ambiente da still life: cupola chiara in alto (con pannello nero sopra l'obiettivo), strisce chiare ai lati,
# fondale scuro davanti e dietro (il vetro non riflette bianco nelle viste di tre quarti)
tc = wn.nodes.new("ShaderNodeTexCoord")
sep = wn.nodes.new("ShaderNodeSeparateXYZ")
wn.links.new(tc.outputs["Generated"], sep.inputs["Vector"])


def ramp(inp, stops):
    r_ = wn.nodes.new("ShaderNodeValToRGB")
    els = r_.color_ramp.elements
    els[0].position, els[0].color = stops[0][0], (stops[0][1],) * 3 + (1,)
    els[1].position, els[1].color = stops[-1][0], (stops[-1][1],) * 3 + (1,)
    for pos, val in stops[1:-1]:
        e_ = els.new(pos); e_.color = (val,) * 3 + (1,)
    wn.links.new(inp, r_.inputs["Fac"])
    return r_.outputs["Color"]


def math_node(op, a, b=None):
    m_ = wn.nodes.new("ShaderNodeMath"); m_.operation = op
    if isinstance(a, float):
        m_.inputs[0].default_value = a
    else:
        wn.links.new(a, m_.inputs[0])
    if b is not None:
        if isinstance(b, float):
            m_.inputs[1].default_value = b
        else:
            wn.links.new(b, m_.inputs[1])
    return m_.outputs[0]


zf = math_node("MULTIPLY_ADD", sep.outputs["Z"], 0.5); wn.nodes[-1].inputs[2].default_value = 0.5
top = ramp(zf, [(0.82, 0.0), (0.9, 0.9), (0.965, 0.75), (0.982, 0.0)])
band = ramp(zf, [(0.35, 0.0), (0.5, 0.35), (0.6, 1.0), (0.9, 1.0)])
side = ramp(math_node("ABSOLUTE", sep.outputs["X"]), [(0.3, 0.0), (0.62, 1.0)])
sideband = math_node("MULTIPLY", math_node("MULTIPLY", side, band), 0.95)
bright = math_node("MAXIMUM", top, sideband)
base = math_node("ADD", math_node("MULTIPLY", bright, 1.0), 0.015)
bg = wn.nodes["Background"]; bg.inputs["Strength"].default_value = 1.0
wn.links.new(base, bg.inputs["Color"])


def area(name, loc, size, radiance, size_y=None, color=(1, 1, 1)):
    """softbox invisibile alla camera; scena in mm: potenza ricavata dalla radianza"""
    ld = bpy.data.lights.new(name, "AREA")
    ld.shape = "RECTANGLE"; ld.size = size; ld.size_y = size_y or size
    ld.energy = radiance * math.pi * size * (size_y or size)
    ld.color = color
    ob = bpy.data.objects.new(name, ld)
    scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    ob.visible_camera = False
    return ob


area("Softbox alto 12", (0, 175, 300), 240, 1.2)
area("Softbox alto 6", (0, -175, 300), 240, 1.0)
area("Striscia sinistra", (-230, -30, 110), 260, 1.6, 70)
area("Striscia destra", (230, 60, 90), 260, 1.4, 70, (0.92, 0.95, 1.0))
area("Frontale basso", (0, -260, 40), 220, 1.6, 90)
area("Chiave tre quarti", (-160, -200, 160), 160, 1.4, 100)
area("Controluce", (120, 240, 120), 200, 1.2, 80, (0.9, 0.94, 1.0))
area("Softbox basso", (0, 0, -320), 320, 0.7)
area("Striscia bassa sinistra", (-220, 40, -160), 220, 1.6, 70)
area("Striscia bassa destra", (220, -40, -160), 220, 1.6, 70)

cam_d = bpy.data.cameras.new("Cam"); cam_d.clip_start = 1; cam_d.clip_end = 5000
cam = bpy.data.objects.new("Camera", cam_d); scene.collection.objects.link(cam); scene.camera = cam
r = scene.render
r.engine = "CYCLES"; r.film_transparent = True
r.image_settings.file_format = "PNG"; r.image_settings.color_mode = "RGBA"
scene.cycles.samples = SAMPLES; scene.cycles.use_denoising = True
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for dt in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = dt; prefs.get_devices()
            if any(d.type == dt for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == dt
                scene.cycles.device = "GPU"
                break
        except TypeError:
            continue
except Exception as e:
    print("GPU non disponibile:", e)
scene.view_settings.view_transform = "AgX"
try:
    scene.view_settings.look = "AgX - Punchy"
except TypeError:
    pass


def shoot(path, loc, target, up="Y", lens=100, ortho=None, res=None):
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", up).to_euler()
    if ortho:
        cam_d.type = "ORTHO"; cam_d.ortho_scale = ortho
    else:
        cam_d.type = "PERSP"; cam_d.lens = lens
    r.resolution_x, r.resolution_y = res or (RES, RES)
    r.filepath = path
    bpy.ops.render.render(write_still=True)


def set_viewport():
    """vista 3D salvata: anteprima materiali, inquadratura sui tre orologi (scena in mm)"""
    from mathutils import Quaternion
    for scr in bpy.data.screens:
        for area_ in scr.areas:
            if area_.type == "VIEW_3D":
                sp = area_.spaces[0]
                sp.shading.type = "MATERIAL"
                sp.clip_start, sp.clip_end = 0.1, 20000
                r3 = sp.region_3d
                r3.view_location = Vector((0, 0, -10))
                r3.view_distance = 230
                r3.view_rotation = Quaternion((0.8, 0.45, 0.17, 0.35)).normalized()
                r3.view_perspective = "PERSP"


set_viewport()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "monichs_delta.blend"))
if DO_RENDER:
    for key in VARIANTS:
        for k2, (root, coll) in roots.items():
            coll.hide_render = k2 != key
        ox = roots[key][0].location.x
        # confronto con gli scontornati: stessa inquadratura ortogonale (84,34 mm di campo, 85,27 px/mm a 7192 px)
        shoot(os.path.join(RENDERS, f"{key}_confronto_fronte.png"), (ox + 0.274, -5.75, 300), (ox + 0.274, -5.75, 0),
              ortho=84.34, res=(900, 900) if DRAFT else (1798, 1798))
        shoot(os.path.join(RENDERS, f"{key}_tre_quarti.png"), (ox + 75, -130, 95), (ox, 0, -4), lens=80)
        # vista come la foto Ce (1): dal lato ore 6, circa 27 gradi sopra il piano del quadrante
        el = math.radians(27); dist = 230
        shoot(os.path.join(RENDERS, f"{key}_eroe.png"), (ox, -dist * math.cos(el), 6 + dist * math.sin(el)), (ox, -3, 4),
              lens=105, res=(int(RES * 1.45), RES))
        # fondello: bracciale nascosto (nelle foto del fondello il bracciale e' aperto)
        hid = [ob for ob in roots[key][1].objects if ("bracciale" in ob.name or "chiusura" in ob.name)]
        for ob in hid:
            ob.hide_render = True
        shoot(os.path.join(RENDERS, f"{key}_fondello.png"), (ox, 0, -260), (ox, 0, 0), lens=100)
        for ob in hid:
            ob.hide_render = False
        shoot(os.path.join(RENDERS, f"{key}_profilo.png"), (ox + 200, -10, 4), (ox, 0, -10), up="Z", lens=90)
    for k2, (root, coll) in roots.items():
        coll.hide_render = False
    shoot(os.path.join(RENDERS, "trio.png"), (30, -280, 185), (0, -4, -12), lens=50, res=(int(RES * 1.6), RES))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "monichs_delta.blend"))
print("FATTO", OUT)
