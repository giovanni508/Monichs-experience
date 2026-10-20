"""Rotore Monichs (massa oscillante SW200, oro rosa IP) - modello 3D.

Uso:
  blender --background --factory-startup --python scripts/blender/build_rotor.py [-- --no-render | --draft]

Fonti (Modelli/ROTORE): schizzo "MNC_Dw_Rotor 2 (2).png" (forma, razze, sezione a gradini) e foto
"MNC_I25_Ed_Vi (7).png" (rotore sollevato). Quote in pianta misurate sulla foto Vi (4) raddrizzata
(Modelli/3D/textures/virentia_movement.png, 62 px/mm): raggio esterno 12,0, fascia da 9,4, mozzo 4,0,
cuscinetto 2,05, razze d'estremita' 1,4, razza centrale 4,0 -> 5,0, pittogramma a r 7,5, MONICHS a r 9,1.

Assi: z verso il fondello (faccia incisa), razza centrale lungo -y, taglio diametrale lungo x. Unita' mm.
"""
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "Modelli", "3D")
RENDERS = os.path.join(OUT, "render")
os.makedirs(RENDERS, exist_ok=True)
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DO_RENDER = "--no-render" not in ARGS
DRAFT = "--draft" in ARGS
RES = 700 if DRAFT else 1600
SAMPLES = 32 if DRAFT else 200
FONT_TEXT = os.path.join(HERE, "fonts", "Montserrat-Medium.otf")
FONT_LOGO = os.path.join(HERE, "fonts", "Foslin-Bold.otf")

# ------------------------------------------------------------------ quote (mm)
R_OUT = 12.1         # bordo esterno della fascia
R_BAND = 9.5         # bordo interno della fascia (finestre)
R_RIM = 10.7         # inizio del bordo pesante sotto
R_HUB = 4.04         # disco del mozzo
# finestra destra (sinistra simmetrica), punti misurati sulla foto Vi (4) raddrizzata, griglia 1 mm:
WIN_A = (3.87, -2.05)    # lato mozzo, bordo della razza d'estremita'
WIN_E = (9.45, -1.63)    # direzione del bordo della razza d'estremita' verso la fascia
WIN_C = (3.81, -8.67)    # razza centrale, sulla fascia
WIN_D = (1.60, -3.98)    # razza centrale, lato mozzo
FILLET = 0.35
T_PLATE = 0.55       # spessore piastra (razze, mozzo)
T_BAND = 1.0         # fascia
T_RIM = 1.5          # bordo pesante
R_BEAR = 2.74        # cuscinetto (anello d'acciaio dentellato)
PICTO = [[(653.8, 483.4), (539.0, 713.0), (768.1, 712.7)],
         [(424.5, 483.7), (309.7, 713.2), (538.8, 713.0)],
         [(538.4, 598.4), (653.1, 368.9), (424.0, 369.1)]]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 0.001
scene.unit_settings.length_unit = "MILLIMETERS"
coll = bpy.data.collections.new("Rotore")
scene.collection.children.link(coll)


# ------------------------------------------------------------------ materiali
def principled(name, color, metal=1.0, rough=0.3, brush=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if brush:
        b.inputs["Anisotropic"].default_value = 0.7
        tg = nt.nodes.new("ShaderNodeTangent"); tg.direction_type = "RADIAL"; tg.axis = brush
        nt.links.new(tg.outputs["Tangent"], b.inputs["Tangent"])
    m.diffuse_color = (*color, 1.0)
    m.metallic, m.roughness = metal, rough
    return m


IPRG = (0.86, 0.50, 0.38)
STEEL = (0.80, 0.80, 0.81)
MAT = {
    "ipr": principled("Oro rosa IP satinato circolare", IPRG, 1.0, 0.27, brush="Z"),
    "ipr_pol": principled("Oro rosa IP lucido", IPRG, 1.0, 0.1),
    "ipr_eng": principled("Oro rosa IP inciso", (0.80, 0.47, 0.36), 1.0, 0.6),
    "steel": principled("Acciaio lucido", STEEL, 1.0, 0.08),
    "steel_sat": principled("Acciaio satinato", STEEL, 1.0, 0.25, brush="Z"),
    "ruby": principled("Rubino", (0.7, 0.02, 0.1), 0.0, 0.05),
}


# ------------------------------------------------------------------ utilita'
def finish(bm, name, mats, sharp_deg=30, smooth=True):
    if smooth:
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            if len(e.link_faces) != 2 or e.calc_face_angle(0) > math.radians(sharp_deg):
                e.smooth = False
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    for m in (mats if isinstance(mats, (list, tuple)) else [mats]):
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def merge(tmp, bm, matrix=None):
    if matrix is not None:
        bmesh.ops.transform(tmp, matrix=matrix, verts=tmp.verts[:])
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


def prism(pts, z0, z1, bm=None, bevel_vertical=0.0, bevel_top=0.0):
    tmp = bmesh.new()
    vs = [tmp.verts.new((x, y, z0)) for x, y in poly_ccw(list(pts))]
    f = tmp.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(tmp, geom=[f])
    bmesh.ops.translate(tmp, vec=(0, 0, z1 - z0), verts=[e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
    if bevel_vertical > 0:
        ev = [e for e in tmp.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-6]
        # solo spigoli vivi (angolo fra le facce laterali)
        ev = [e for e in ev if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(25)]
        if ev:
            bmesh.ops.bevel(tmp, geom=ev, offset=bevel_vertical, segments=4, profile=0.5, affect="EDGES", clamp_overlap=True)
    if bevel_top > 0:
        et = [e for e in tmp.edges if abs(e.verts[0].co.z - z1) < 1e-6 and abs(e.verts[1].co.z - z1) < 1e-6
              and len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(45)]
        if et:
            bmesh.ops.bevel(tmp, geom=et, offset=bevel_top, segments=2, profile=0.5, affect="EDGES", clamp_overlap=True)
    return merge(tmp, bm)


def lathe(profile, n=128, bm=None):
    tmp = bmesh.new()
    rings = []
    for r, z in profile:
        if r < 1e-6:
            rings.append([tmp.verts.new((0, 0, z))])
        else:
            rings.append([tmp.verts.new((r * math.sin(2 * math.pi * i / n), r * math.cos(2 * math.pi * i / n), z)) for i in range(n)])
    for A, B in list(zip(rings[:-1], rings[1:])) + [(rings[-1], rings[0])]:
        for i in range(n):
            j = (i + 1) % n
            q = []
            for v in (A[i % len(A)], A[j % len(A)], B[j % len(B)], B[i % len(B)]):
                if v not in q:
                    q.append(v)
            if len(q) >= 3:
                try:
                    tmp.faces.new(q)
                except ValueError:
                    pass
    bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
    return merge(tmp, bm)


def arc(r, a0, a1, n):
    """punti su arco; angoli in gradi, orari da +y (ore 12)"""
    return [(r * math.sin(math.radians(a0 + (a1 - a0) * i / n)), r * math.cos(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def text_mesh(body, font_path, height, thick, spacing=1.0):
    font = bpy.data.fonts.load(font_path, check_existing=True)
    cap = _cap_height(font)
    cu = bpy.data.curves.new("_t", "FONT"); cu.body = body; cu.font = font; cu.size = 1.0
    cu.extrude = 0.05; cu.resolution_u = 5; cu.space_character = spacing
    ob = bpy.data.objects.new("_t", cu); scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob); bpy.data.curves.remove(cu)
    bm = bmesh.new(); bm.from_mesh(me); bpy.data.meshes.remove(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)     # salda le pareti ai tappi (solido chiuso)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    co = np.array([v.co[:] for v in bm.verts])
    s = height / cap
    cx = (co[:, 0].min() + co[:, 0].max()) / 2
    z0, z1 = co[:, 2].min(), co[:, 2].max()
    for v in bm.verts:
        x, y, z = v.co
        v.co = ((x - cx) * s, (y - cap / 2) * s, (z - z0) / (z1 - z0) * thick)
    return bm


_CAPS = {}


def _cap_height(font):
    if font.name not in _CAPS:
        cu = bpy.data.curves.new("_c", "FONT"); cu.body = "H"; cu.font = font; cu.size = 1.0
        ob = bpy.data.objects.new("_c", cu); scene.collection.objects.link(ob)
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        ys = [v.co.y for v in me.vertices]
        _CAPS[font.name] = max(ys) - min(ys)
        bpy.data.objects.remove(ob); bpy.data.curves.remove(cu); bpy.data.meshes.remove(me)
    return _CAPS[font.name]


def boolean(target, cutter_bm, op="DIFFERENCE", cutter_mat=None):
    me = bpy.data.meshes.new("_cut")
    cutter_bm.to_mesh(me); cutter_bm.free()
    for m in target.data.materials:
        me.materials.append(m)
    ob = bpy.data.objects.new("_cut", me)
    coll.objects.link(ob)
    if cutter_mat is not None:
        idx = list(target.data.materials).index(cutter_mat)
        for p in me.polygons:
            p.material_index = idx
    mod = target.modifiers.new("b", "BOOLEAN")
    mod.operation, mod.object, mod.solver = op, ob, "EXACT"
    mod.use_hole_tolerant = True
    mod.use_self = True
    try:
        mod.material_mode = "TRANSFER"
    except Exception:
        pass
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(ob)


# ------------------------------------------------------------------ geometria
def outline():
    """mezzo disco (fascia verso -y) + disco del mozzo completo; angoli orari da +y"""
    pts = arc(R_OUT, 90, 270, 140)                   # da destra, attraverso il basso, a sinistra
    pts += [(-R_HUB, 0.0)]
    pts += arc(R_HUB, 270, 450, 60)[1:-1]            # mozzo: sopra il taglio diametrale
    pts += [(R_HUB, 0.0)]
    return pts


def window(side):
    """finestra fra la razza d'estremita' e la razza centrale (side +1 destra, -1 sinistra)"""
    ax, ay = WIN_A
    dx, dy = WIN_E[0] - ax, WIN_E[1] - ay
    # intersezione del bordo della razza d'estremita' con l'arco r = R_BAND
    a = dx * dx + dy * dy; b = 2 * (ax * dx + ay * dy); c = ax * ax + ay * ay - R_BAND ** 2
    t = (-b + math.sqrt(b * b - 4 * a * c)) / (2 * a)
    B = (ax + dx * t, ay + dy * t)
    aB = math.degrees(math.atan2(B[0], B[1])); aC = math.degrees(math.atan2(WIN_C[0], WIN_C[1]))
    pts = [WIN_A] + arc(R_BAND, aB, aC, 48) + [WIN_D]
    if side < 0:
        pts = [(-x, y) for x, y in pts]
    return pts


def build():
    # piastra + fascia + bordo pesante (faccia superiore piana a z=0, gradini sotto)
    body = prism(outline(), -T_PLATE, 0.0, bevel_top=0.12)
    ob = finish(body, "rotore_piastra", [MAT["ipr"], MAT["ipr_pol"], MAT["ipr_eng"]], sharp_deg=28)
    # gradini sotto la fascia (sezione dello schizzo): oggetti separati, impilati senza sovrapposizioni
    band = arc(R_OUT, 90, 270, 120) + arc(R_BAND, 270, 90, 100)
    finish(prism(band, -T_BAND, -T_PLATE), "rotore_fascia", MAT["ipr"], sharp_deg=28)
    rim = arc(R_OUT, 90, 270, 120) + arc(R_RIM, 270, 90, 100)
    finish(prism(rim, -T_RIM, -T_BAND, bevel_vertical=0.0), "rotore_massa", MAT["ipr"], sharp_deg=28)
    # finestre con angoli raccordati
    for side in (1, -1):
        boolean(ob, prism(window(side), -T_PLATE - 0.5, 0.5, bevel_vertical=FILLET))
    # sede del cuscinetto
    boolean(ob, lathe([(0, -T_PLATE - 0.5), (R_BEAR, -T_PLATE - 0.5), (R_BEAR, 0.5), (0, 0.5)], n=96))
    # incisioni: scritta lungo la fascia, pittogramma e MONICHS sulla razza centrale
    eng = bmesh.new()
    t = text_mesh("TWENTY - SIX 26 JEWELS SWISS MADE", FONT_TEXT, 0.6, 0.12, 1.15)
    R, phc = 10.8, 193.5
    for v in t.verts:
        u, w, z = v.co
        phi = math.radians(phc) - u / R
        r = R - w
        v.co = (r * math.sin(phi), r * math.cos(phi), z - 0.06)
    merge(t, eng)
    s = 2.4 / (713.2 - 368.9)
    for tri in PICTO:
        poly = [((x - 538.95) * s, -7.75 - (y - 541.05) * s) for x, y in tri]
        prism(poly, -0.06, 0.06, bm=eng)
    t = text_mesh("MONICHS", FONT_LOGO, 0.6, 0.12, 1.25)
    bmesh.ops.translate(t, vec=(0, -9.6, -0.06), verts=t.verts[:])
    merge(t, eng)
    boolean(ob, eng, cutter_mat=MAT["ipr_eng"])
    # dopo i booleani: normali piatte (facce piane con fori -> niente artefatti di sfumatura)
    for poly in ob.data.polygons:
        poly.use_smooth = False
    # cuscinetto: anello d'acciaio dentellato (r 1,75-2,74), anello rosa (1,2-1,75), centro in acciaio con vite
    bm = bmesh.new()
    nt = 72
    outer = [(2.74 if i % 2 == 0 else 2.62) for i in range(nt)]
    pts = [(outer[i] * math.sin(2 * math.pi * i / nt), outer[i] * math.cos(2 * math.pi * i / nt)) for i in range(nt)]
    prism(pts, -T_PLATE - 0.1, 0.06, bm=bm)
    finish(bm, "cuscinetto_anello", MAT["steel"], sharp_deg=60)
    ring = lathe([(1.75, -0.1), (1.75, 0.12), (1.2, 0.12), (1.2, -0.1)], n=96)
    finish(ring, "cuscinetto_anello_rosa", MAT["ipr_pol"], sharp_deg=35)
    scr = lathe([(0, 0.34), (0.45, 0.32), (0.85, 0.24), (1.2, 0.14), (1.2, -0.1), (0, -0.1)], n=64)
    for v in scr.verts:
        if abs(v.co.x) < 0.12 and v.co.z > 0.14:
            v.co.z = 0.14
    finish(scr, "cuscinetto_vite", MAT["steel"], sharp_deg=40)
    return ob


rotor = build()
root = bpy.data.objects.new("Rotore Monichs", None)
coll.objects.link(root)
for ob in coll.objects:
    if ob is not root:
        ob.parent = root
for me in list(bpy.data.meshes):
    if me.users == 0:
        bpy.data.meshes.remove(me)

bpy.ops.object.select_all(action="DESELECT")
for ob in coll.objects:
    ob.select_set(True)
root.scale = (0.001,) * 3
bpy.context.view_layer.objects.active = root
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "rotore.glb"), export_format="GLB", use_selection=True, export_yup=True)
root.scale = (1, 1, 1)

# ------------------------------------------------------------------ luci e render (stessa tenda dei modelli orologio)
world = bpy.data.worlds.new("Studio"); scene.world = world; world.use_nodes = True
wn = world.node_tree
tc = wn.nodes.new("ShaderNodeTexCoord"); sep = wn.nodes.new("ShaderNodeSeparateXYZ")
wn.links.new(tc.outputs["Generated"], sep.inputs["Vector"])


def ramp(inp, stops):
    r_ = wn.nodes.new("ShaderNodeValToRGB"); els = r_.color_ramp.elements
    els[0].position, els[0].color = stops[0][0], (stops[0][1],) * 3 + (1,)
    els[1].position, els[1].color = stops[-1][0], (stops[-1][1],) * 3 + (1,)
    for pos, val in stops[1:-1]:
        e_ = els.new(pos); e_.color = (val,) * 3 + (1,)
    wn.links.new(inp, r_.inputs["Fac"])
    return r_.outputs["Color"]


def mnode(op, a, b=None, c=None):
    m_ = wn.nodes.new("ShaderNodeMath"); m_.operation = op
    for i, x in enumerate((a, b, c)):
        if x is None:
            continue
        if isinstance(x, float):
            m_.inputs[i].default_value = x
        else:
            wn.links.new(x, m_.inputs[i])
    return m_.outputs[0]


zf = mnode("MULTIPLY_ADD", sep.outputs["Z"], 0.5, 0.5)
top = ramp(zf, [(0.82, 0.0), (0.9, 0.9), (0.965, 0.75), (0.982, 0.0)])
band_ = ramp(zf, [(0.35, 0.0), (0.5, 0.35), (0.6, 1.0), (0.9, 1.0)])
side = ramp(mnode("ABSOLUTE", sep.outputs["X"]), [(0.3, 0.0), (0.62, 1.0)])
bright = mnode("MAXIMUM", top, mnode("MULTIPLY", mnode("MULTIPLY", side, band_), 0.95))
bg = wn.nodes["Background"]; bg.inputs["Strength"].default_value = 1.0
wn.links.new(mnode("ADD", bright, 0.015), bg.inputs["Color"])


def area(name, loc, size, radiance, size_y=None, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, "AREA"); ld.shape = "RECTANGLE"; ld.size = size; ld.size_y = size_y or size
    ld.energy = radiance * math.pi * size * (size_y or size); ld.color = color
    ob = bpy.data.objects.new(name, ld); scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    ob.visible_camera = False


area("Chiave", (-120, -140, 160), 120, 3.2, 80)
area("Striscia destra", (180, 40, 90), 200, 2.6, 60, (1.0, 0.97, 0.92))
area("Controluce", (40, 200, 120), 160, 2.2, 60)
area("Basso", (0, 0, -200), 200, 1.4)
area("Frontale", (0, -220, 60), 180, 1.6, 70)
area("Softbox alto", (-30, -60, 220), 180, 2.0, 140, (1.0, 0.95, 0.88))

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


def shoot(path, loc, target, lens=100, ortho=None, res=None, up="Y"):
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", up).to_euler()
    if ortho:
        cam_d.type = "ORTHO"; cam_d.ortho_scale = ortho
    else:
        cam_d.type = "PERSP"; cam_d.lens = lens
    r.resolution_x, r.resolution_y = res or (RES, RES)
    r.filepath = path
    bpy.ops.render.render(write_still=True)


for scr_ in bpy.data.screens:
    for area_ in scr_.areas:
        if area_.type == "VIEW_3D":
            sp = area_.spaces[0]; sp.shading.type = "MATERIAL"; sp.clip_start, sp.clip_end = 0.05, 5000
            sp.region_3d.view_location = Vector((0, -3, 0)); sp.region_3d.view_distance = 60
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "rotore.blend"))
if DO_RENDER:
    shoot(os.path.join(RENDERS, "rotore_alto.png"), (0, -3, 120), (0, -3, 0), ortho=28.0)
    # come la foto Vi (4): razza centrale a 130 gradi (orari da ore 12)
    root.rotation_euler = (0, 0, math.radians(50))
    shoot(os.path.join(RENDERS, "rotore_confronto_vi4.png"), (0, 0, 120), (0, 0, 0), ortho=28.0)
    root.rotation_euler = (0, 0, 0)
    shoot(os.path.join(RENDERS, "rotore_tre_quarti.png"), (28, -70, 45), (0, -3, -0.5), lens=90, res=(int(RES * 1.4), RES))
    shoot(os.path.join(RENDERS, "rotore_sotto.png"), (-20, -60, -50), (0, -3, -0.7), lens=90, res=(int(RES * 1.4), RES))
print("FATTO rotore")
