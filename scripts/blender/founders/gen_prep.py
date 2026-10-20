"""Fase 1 dei fondatori generati (Tripo): import, saldatura, orientamento, scala, taglio al sedile, analisi del corpo.

blender -b --python gen_prep.py -- <nome> <in.glb> <rot_z_gradi>
Esce: Modelli/3D/fondatori/generati/<nome>_prep.blend, <nome>_body.json, <nome>_face_tex.png (vista frontale
del volto con i soli colori della texture, per trovare occhi e bocca).

Convenzioni come il resto della pipeline: 1 u = 1 m, origine al bacino sul piano del sedile, sguardo verso -Y Blender
(= +Z glTF), sinistra del soggetto = +X.
"""
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
NAME, SRC, ROT = argv[0], argv[1], float(argv[2])
OUTD = r"C:\Users\UTENTE\Desktop\MNC GAME\Modelli\3D\fondatori\generati"
SHOULDER_Z = 0.55          # altezza dell'articolazione della spalla sul piano del sedile (m), come la pipeline precedente

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
ob = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
for o in list(bpy.context.scene.objects):
    if o != ob and o.type != "MESH" and not o.children:
        bpy.data.objects.remove(o)
mw = Matrix.Rotation(math.radians(ROT), 4, "Z") @ ob.matrix_world
ob.parent = None
me = ob.data
me.transform(mw)
ob.matrix_world = Matrix.Identity(4)
ob.name = NAME
me.name = NAME

# saldatura dei vertici divisi dalle cuciture UV
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-6)
bm.to_mesh(me); bm.free()
print("verts after weld", len(me.vertices))

P = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get("co", P); P = P.reshape(-1, 3)
zmin, zmax = float(P[:, 2].min()), float(P[:, 2].max())
Hm = zmax - zmin


def slice_x(z0, dz):
    s = P[np.abs(P[:, 2] - z0) < dz]
    return s


# --- collo: sezione piu' stretta fra spalle e testa (nella parte alta)
zs = np.linspace(zmax - 0.40 * Hm, zmax - 0.10 * Hm, 120)
wid = []
for z in zs:
    s = slice_x(z, 0.002 * Hm)
    s = s[np.abs(s[:, 0]) < 0.12 * Hm]
    wid.append(s[:, 0].max() - s[:, 0].min() if len(s) > 10 else 9)
wid = np.array(wid)
neck_z = float(zs[np.argmin(wid)])
print("neck_z", neck_z, "neck width", wid.min())

# --- cavallo: raggio verso l'alto fra le gambe
from mathutils.bvhtree import BVHTree
bm = bmesh.new(); bm.from_mesh(me); bvh = BVHTree.FromBMesh(bm)
yc = float(np.median(P[np.abs(P[:, 2] - (zmin + 0.25 * Hm)) < 0.01 * Hm][:, 1]))
hits = []
for dy in np.linspace(-0.02, 0.02, 9) * Hm:
    loc, nrm, idx, dist = bvh.ray_cast(Vector((0, yc + dy, zmin - 0.01)), Vector((0, 0, 1)))
    if loc is not None:
        hits.append(loc.z)
crotch_z = float(min(hits)) if hits else zmin + 0.2 * Hm
print("crotch_z", crotch_z)

# --- braccia: per ogni fetta sotto il collo, il gruppo di vertici piu' esterno separato dal busto da un vuoto
arm = {}
# colore della texture per vertice (pelle = mani)
img = [n.image for m in me.materials for n in m.node_tree.nodes
       if n.type == "TEX_IMAGE" and any(l.to_socket.name == "Base Color" for l in n.outputs[0].links)][0]
TW, TH = img.size
tex = np.empty(TW * TH * 4, np.float32); img.pixels.foreach_get(tex); tex = tex.reshape(TH, TW, 4)
uv = np.empty(len(me.loops) * 2, np.float32); me.uv_layers[0].data.foreach_get("uv", uv); uv = uv.reshape(-1, 2)
lv = np.empty(len(me.loops), np.int32); me.loops.foreach_get("vertex_index", lv)
vuv = np.zeros((len(me.vertices), 2), np.float32); vuv[lv] = uv
ci = np.clip((vuv[:, 1] * TH).astype(int), 0, TH - 1); cj = np.clip((vuv[:, 0] * TW).astype(int), 0, TW - 1)
VC = tex[ci, cj, :3]
del tex
Vv = VC.max(1); Sv = (Vv - VC.min(1)) / np.maximum(Vv, 1e-4)
SKIN = (Sv > 0.33) & (Vv > 0.40) & (VC[:, 0] > VC[:, 1]) & (VC[:, 1] > VC[:, 2])


def body_y(z):
    s = P[(np.abs(P[:, 2] - z) < 0.002 * Hm) & (np.abs(P[:, 0]) < 0.08 * Hm)]
    return float(np.median(s[:, 1])) if len(s) else yc


for s, sfx in ((1, "L"), (-1, "R")):
    cents = []
    gaps = []
    for z in np.linspace(neck_z - 0.02 * Hm, crotch_z, 260):
        sl = slice_x(z, 0.0012 * Hm)
        sl = sl[s * sl[:, 0] > 0]
        x = np.sort(sl[:, 0] * s)
        if len(x) < 20:
            gaps.append(False); cents.append(None); continue
        g = np.diff(x)
        k = np.where(g > 0.004 * Hm)[0]
        ok = False
        if len(k):
            k = k[-1]
            outer = sl[(s * sl[:, 0]) > x[k] + 1e-6]
            if len(outer) >= 10 and np.ptp(outer[:, 0]) < 0.15 * Hm:
                ok = True
                cents.append([float(np.mean(outer[:, 0])), float(np.mean(outer[:, 1])), float(z),
                              float(np.ptp(outer[:, 0])), int(len(outer))])
        if not ok:
            cents.append(None)
        gaps.append(ok)
    # ascella: il primo livello da cui partono almeno 6 fette consecutive con il vuoto braccio-busto
    zl = np.linspace(neck_z - 0.02 * Hm, crotch_z, 260)
    ia = next(i for i in range(len(gaps) - 6) if all(gaps[i:i + 6]))
    C = np.array([c for c in cents[ia:] if c is not None])
    armpit = float(zl[ia])
    # pelle del braccio = mano
    side_arm = (s * P[:, 0] > np.abs(C[:, 0]).min() - 0.5 * C[:, 3].max()) & (P[:, 2] < armpit)
    hand = side_arm & SKIN
    wrist_z = float(np.percentile(P[hand][:, 2], 97))
    tip = P[hand][np.argmin(P[hand][:, 2])]
    # asse del braccio dai centri delle fette fra ascella e polso
    A = C[(C[:, 2] > wrist_z + 0.02 * Hm)]
    up = A[A[:, 2] > armpit - 0.12 * Hm]
    dia = float(np.median(up[:, 3]))
    c0 = A[:, :3].mean(0)
    u, sv, vt = np.linalg.svd(A[:, :3] - c0)
    d = vt[0] * np.sign(vt[0][2])                     # verso l'alto
    # sommita' della spalla sopra l'asse del braccio; l'articolazione e' mezzo spessore piu' in basso
    def ax_at(z):
        return c0 + d * (z - c0[2]) / d[2]
    qa = ax_at(armpit)
    xj = qa[0] - s * 0.15 * dia
    cap = P[(P[:, 2] > armpit) & (P[:, 2] < neck_z)]
    m = (np.abs(cap[:, 0] - xj) < 0.1 * dia) & (np.abs(cap[:, 1] - qa[1]) < 0.5 * dia)
    top = float(cap[m][:, 2].max())
    sh_z = top - 0.5 * dia
    shoulder = np.array([xj, qa[1], sh_z])
    print(sfx, "shoulder top", round(top, 3))
    wl = A[np.argmin(np.abs(A[:, 2] - (wrist_z + 0.01 * Hm)))]
    wrist = np.array([wl[0], wl[1], wrist_z])
    elbow = shoulder + 0.53 * (wrist - shoulder)
    # gomito sul percorso reale dei centri (il braccio puo' essere un po' piegato)
    ie = np.argmin(np.abs(A[:, 2] - elbow[2]))
    elbow = np.array([A[ie, 0], A[ie, 1], elbow[2]])
    arm[sfx] = {"armpit_z": armpit, "dia": dia, "shoulder": shoulder.tolist(), "elbow": elbow.tolist(),
                "wrist": wrist.tolist(), "tip": [float(v) for v in tip]}
    print(sfx, "armpit", round(armpit, 3), "dia", round(dia, 3), "shoulder", shoulder.round(3), "wrist", wrist.round(3),
          "tip", tip.round(3))

body = {"zmin": zmin, "zmax": zmax, "neck_z": neck_z, "crotch_z": crotch_z, "yc": yc, "arm": arm, "Hm": Hm}

# --- scala e origine: articolazione della spalla all'altezza SHOULDER_Z sul sedile
shoulder_raw = 0.5 * (arm["L"]["shoulder"][2] + arm["R"]["shoulder"][2])
scale = SHOULDER_Z / (shoulder_raw - crotch_z)


def to_model(p):
    return [float((p[0]) * scale), float((p[1] - yc) * scale), float((p[2] - crotch_z) * scale)]


J = {}
for sfx in ("L", "R"):
    for k in ("shoulder", "elbow", "wrist", "tip"):
        J[f"{k}.{sfx}"] = to_model(arm[sfx][k])
for nm, zr in (("hips", 0.08 / SHOULDER_Z), ("chest", 0.34 / SHOULDER_Z)):
    zz = crotch_z + zr * (shoulder_raw - crotch_z)
    J[nm] = to_model([0.0, body_y(zz), zz])
zz = shoulder_raw + 0.4 * (neck_z - shoulder_raw)
J["neck0"] = to_model([0.0, body_y(zz), zz])
J["neck_mid"] = to_model([0.0, body_y(neck_z), neck_z])
body["J"] = J
T = Matrix.Diagonal((scale, scale, scale, 1)) @ Matrix.Translation((0, -yc, -crotch_z))
me.transform(T)
body["scale"] = scale
body["T"] = [list(r) for r in T]
print("scale", scale)

# taglio sotto il sedile (le gambe del modello in piedi bucherebbero la seduta)
# solo le gambe: sotto il sedile e fra le braccia (le mani in posa A scendono sotto il cavallo e restano)
inner = min(abs(J["wrist.L"][0]), abs(J["wrist.R"][0])) - 0.5 * scale * arm["L"]["dia"]
bm = bmesh.new(); bm.from_mesh(me)
cut = [v for v in bm.verts if v.co.z < -0.005 and abs(v.co.x) < inner]
bmesh.ops.delete(bm, geom=cut, context="VERTS")
bm.to_mesh(me); bm.free()
print("verts after cut", len(me.vertices), "polys", len(me.polygons))

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUTD, NAME + "_prep.blend"))
json.dump(body, open(os.path.join(OUTD, NAME + "_body.json"), "w"), indent=1)

# --- vista frontale del volto con i soli colori della texture (Workbench, luce piatta)
P = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get("co", P); P = P.reshape(-1, 3)
nz = (body["neck_z"] - crotch_z) * scale
head = P[P[:, 2] > nz]
hx0, hx1 = head[:, 0].min(), head[:, 0].max(); hz0, hz1 = nz, head[:, 2].max()
sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "FLAT"
sc.display.shading.color_type = "TEXTURE"
sc.view_settings.view_transform = "Standard"
R = 1600
sc.render.resolution_x = sc.render.resolution_y = R
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"
side = max(hx1 - hx0, hz1 - hz0) * 1.02
cx, cz = (hx0 + hx1) / 2, (hz0 + hz1) / 2
cam.location = (cx, -2.0, cz); cam.rotation_euler = (math.radians(90), 0, 0)
cam.data.ortho_scale = side; cam.data.clip_end = 10
sc.render.filepath = os.path.join(OUTD, NAME + "_face_tex.png")
bpy.ops.render.render(write_still=True)
body["face_cam"] = {"cx": float(cx), "cz": float(cz), "side": float(side), "res": R}

# corpo intero con le articolazioni trovate (controllo)
zt = float(P[:, 2].max()); zb = float(P[:, 2].min())
side = max(float(np.ptp(P[:, 0])), zt - zb) * 1.04
cam.location = (0, -2.0, (zt + zb) / 2); cam.data.ortho_scale = side
sc.render.resolution_x = sc.render.resolution_y = 1000
fp = os.path.join(OUTD, NAME + "_body_check.png")
sc.render.filepath = fp
bpy.ops.render.render(write_still=True)
chk = bpy.data.images.load(fp)
Wc = chk.size[0]
a = np.array(chk.pixels[:], np.float32).reshape(Wc, Wc, 4)
for nm, p in J.items():
    c = int((p[0] / side + 0.5) * Wc); r = int((p[2] - (zt + zb) / 2) / side * Wc + Wc / 2)
    if 5 <= r < Wc - 6 and 5 <= c < Wc - 6:
        a[r - 5:r + 6, c - 5:c + 6, :3] = (1, 0.1, 0.1) if "." in nm else (0.1, 0.4, 1)
chk.pixels = a.ravel(); chk.save()
json.dump(body, open(os.path.join(OUTD, NAME + "_body.json"), "w"), indent=1)
print("DONE")
