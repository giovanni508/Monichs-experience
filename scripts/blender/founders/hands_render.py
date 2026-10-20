"""Controllo visivo delle mani costruite: arrivo del visitatore, primi piani, polsini, gesti.

blender -b --python hands_render.py -- <nome> [v3]
Esce Modelli/3D/fondatori/v3/render/<nome>_mani_*.png e il foglio <nome>_mani_check.jpg.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
NAME = argv[0]
OUT = r"C:\Users\UTENTE\Desktop\MNC GAME\Modelli\3D\fondatori\v3"
RD = os.path.join(OUT, "render")
bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT, NAME + ".blend"))
sc = bpy.context.scene
arm = bpy.data.objects[NAME + "_rig"]
ob = bpy.data.objects[NAME]
sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x, sc.render.resolution_y = 900, 640
sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.57, 0.62, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.5


def light(name, loc, energy, size, color=(1, 1, 1), tgt=(0, -0.3, 0.3)):
    L = bpy.data.lights.new(name, "AREA"); L.energy = energy; L.size = size; L.color = color
    o = bpy.data.objects.new(name, L); sc.collection.objects.link(o)
    o.location = Vector(loc)
    o.rotation_euler = (Vector(tgt) - o.location).to_track_quat("-Z", "Y").to_euler()


light("key", (-0.7, -1.2, 1.3), 45, 0.6, (1.0, 0.96, 0.9))
light("fill", (1.0, -1.0, 0.7), 18, 1.2, (0.9, 0.95, 1.0))
light("rim", (0.3, 0.8, 1.2), 35, 1.0)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.clip_start = 0.004


def set_action(name, frame):
    arm.animation_data_create()
    arm.animation_data.action = bpy.data.actions[name]
    sc.frame_set(frame)
    bpy.context.view_layer.update()


def posed():
    dg = bpy.context.evaluated_depsgraph_get()
    em = ob.evaluated_get(dg).to_mesh()
    Q = np.empty(len(em.vertices) * 3, np.float32); em.vertices.foreach_get("co", Q)
    ob.evaluated_get(dg).to_mesh_clear()
    return Q.reshape(-1, 3)


def bone_head(n):
    return np.array(arm.matrix_world @ arm.pose.bones[n].head)


# banco alla quota del punto piu' basso delle mani
set_action("leanDown", 1)
Q = posed()
hand_mi = [i for i, m in enumerate(ob.data.materials) if m and m.name.endswith("_hands")]
pm = np.empty(len(ob.data.polygons), np.int32); ob.data.polygons.foreach_get("material_index", pm)
fv = np.empty(sum(len(p.vertices) for p in ob.data.polygons), np.int32); ob.data.polygons.foreach_get("vertices", fv)
ft = np.empty(len(ob.data.polygons), np.int32); ob.data.polygons.foreach_get("loop_total", ft)
is_hand = np.zeros(len(ob.data.vertices), bool); is_hand[fv[np.repeat(np.isin(pm, hand_mi), ft)]] = True
zb = float(Q[is_hand][:, 2].min())
import bmesh  # noqa: E402
bench = bpy.data.objects.new("bench", bpy.data.meshes.new("bench"))
bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.6); bm.to_mesh(bench.data); bm.free()
bench.location = (0, -0.45, zb); bench.scale = (2.2, 1.2, 1)
bm_mat = bpy.data.materials.new("bench"); bm_mat.use_nodes = True
bm_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.20, 0.13, 0.08, 1)
bm_mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.7
bench.data.materials.append(bm_mat)
sc.collection.objects.link(bench)
print("bench z", round(zb, 4))

shots = []


def look(frm, to, lens):
    cam.location = Vector(frm)
    cam.rotation_euler = (Vector(to) - Vector(frm)).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens


def shot(tag):
    fp = os.path.join(RD, f"{NAME}_mani_{tag}.png")
    sc.render.filepath = fp
    bpy.ops.render.render(write_still=True)
    shots.append(fp)


hR = bone_head("hand.R"); hL = bone_head("hand.L")
mR = bone_head("middle.01.R"); mL = bone_head("middle.01.L")
cR = 0.5 * (hR + mR); cL = 0.5 * (hL + mL)
mid = 0.5 * (cR + cL)
# 1 arrivo del visitatore: all'altezza del banco, 35 cm davanti
look((mid[0], mid[1] - 0.42, zb + 0.03), (mid[0], mid[1], zb + 0.03), 24); shot("arrivo")
# 2 mano destra da vicino (visitatore a 18 cm)
look((cR[0] - 0.05, cR[1] - 0.20, zb + 0.025), (cR[0], cR[1], zb + 0.02), 28); shot("destra_vicino")
# 3 mano sinistra di tre quarti dall'alto
look((cL[0] + 0.12, cL[1] - 0.22, zb + 0.16), (cL[0], cL[1], zb + 0.015), 35); shot("sinistra_alto")
# 4 polsino e polso di lato, all'altezza del banco
fR = bone_head("forearm.R")
look((hR[0] - 0.20, hR[1] - 0.04, zb + 0.035), (hR[0], hR[1] - 0.01, zb + 0.03), 40); shot("polso_destro")
# 5 punte dal basso (come il visitatore piccolo)
look((cR[0], cR[1] - 0.16, zb + 0.004), (cR[0], cR[1] + 0.05, zb + 0.02), 22); shot("dita_basso")
# 5b le stesse in creta (forma senza texture)
if "clay" in argv:
    clay = bpy.data.materials.new("clay"); clay.use_nodes = True
    clay.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.45, 0.42, 0.40, 1)
    _mats = list(ob.data.materials)
    for i_ in hand_mi:
        ob.data.materials[i_] = clay
    look((cR[0] - 0.05, cR[1] - 0.20, zb + 0.025), (cR[0], cR[1], zb + 0.02), 28); shot("destra_vicino_creta")
    look((cR[0], cR[1] - 0.16, zb + 0.004), (cR[0], cR[1] + 0.05, zb + 0.02), 22); shot("dita_basso_creta")
    for i_ in hand_mi:
        ob.data.materials[i_] = _mats[i_]
# 5c pollici da vicino
tL = bone_head("thumb.02.L"); tR = bone_head("thumb.02.R")
look((tL[0] - 0.16, tL[1] - 0.16, tL[2] + 0.10), (tL[0], tL[1], tL[2] - 0.01), 45); shot("pollice_sinistro")
look((tR[0] + 0.16, tR[1] - 0.16, tR[2] + 0.10), (tR[0], tR[1], tR[2] - 0.01), 45); shot("pollice_destro")
# 6 gesti a meta' clip
set_action("pointDown", 40)
hR = bone_head("hand.R"); mR = bone_head("middle.01.R")
c = 0.5 * (hR + mR)
look((c[0] - 0.10, c[1] - 0.30, c[2] + 0.06), (c[0], c[1], c[2] - 0.02), 32); shot("indica")
look((c[0] - 0.30, c[1] - 0.05, c[2] + 0.02), (c[0], c[1] - 0.04, c[2] - 0.03), 35); shot("indica_lato")
set_action("explain", 45)
hR = bone_head("hand.R"); mR = bone_head("middle.01.R")
c = 0.5 * (hR + mR)
look((c[0] - 0.05, c[1] - 0.40, c[2] + 0.05), (c[0], c[1], c[2]), 30); shot("spiega")

ims = [bpy.data.images.load(f) for f in shots]
Wd, Hd = sc.render.resolution_x, sc.render.resolution_y
cols = 4
rows = math.ceil(len(ims) / cols)
sheet = np.ones((Hd * rows, Wd * cols, 4), np.float32)
for k, im in enumerate(ims):
    a = np.array(im.pixels[:], np.float32).reshape(Hd, Wd, 4)
    r, c_ = divmod(k, cols)
    sheet[(rows - 1 - r) * Hd:(rows - r) * Hd, c_ * Wd:(c_ + 1) * Wd] = a
out = bpy.data.images.new("sheet", Wd * cols, Hd * rows)
out.pixels = sheet.ravel()
out.filepath_raw = os.path.join(RD, f"{NAME}_mani_check.jpg"); out.file_format = "JPEG"; out.save()
print("DONE")
