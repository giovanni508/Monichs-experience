"""Controllo visivo di un fondatore montato: pose, espressioni, sguardo.

blender -b --python gen_render.py -- <nome> [sheet]
Esce Modelli/3D/fondatori/render/<nome>_gen_*.png e un foglio <nome>_gen_check.jpg.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Euler, Quaternion, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
NAME = argv[0]
OUT = r"C:\Users\UTENTE\Desktop\MNC GAME\Modelli\3D\fondatori" + (r"\v3" if "v3" in argv else "")
RD = os.path.join(OUT, "render")
os.makedirs(RD, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT, NAME + ".blend"))
sc = bpy.context.scene
arm = bpy.data.objects[NAME + "_rig"]
ob = bpy.data.objects[NAME]
keys = ob.data.shape_keys.key_blocks

sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x, sc.render.resolution_y = 700, 900
sc.view_settings.view_transform = "Standard"
sc.view_settings.look = "None"
w = bpy.data.worlds.new("w"); sc.world = w
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.57, 0.62, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.5


def light(name, loc, energy, size, color=(1, 1, 1)):
    L = bpy.data.lights.new(name, "AREA"); L.energy = energy; L.size = size; L.color = color
    o = bpy.data.objects.new(name, L); sc.collection.objects.link(o)
    o.location = Vector(loc)
    o.rotation_euler = (Vector((0, -0.05, 0.75)) - o.location).to_track_quat("-Z", "Y").to_euler()


light("key", (-0.9, -1.4, 1.5), 95, 0.5 if "v3" in argv else 1.2, (1.0, 0.96, 0.9))
light("fill", (1.2, -1.2, 0.9), 35, 1.5, (0.9, 0.95, 1.0))
light("rim", (0.4, 1.0, 1.6), 60, 1.0)

# banco: un piano all'altezza del contatto delle mani nella posa del racconto
bench = bpy.data.objects.new("bench", bpy.data.meshes.new("bench"))
import bmesh  # noqa: E402
bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.6); bm.to_mesh(bench.data); bm.free()
bench.location = (0, -0.45, 0.255); bench.scale = (2.2, 1.2, 1)
bm_mat = bpy.data.materials.new("bench"); bm_mat.use_nodes = True
bm_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.32, 0.22, 0.15, 1)
bench.data.materials.append(bm_mat)
sc.collection.objects.link(bench)

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam


def look(frm, to, lens):
    cam.location = Vector(frm)
    cam.rotation_euler = (Vector(to) - Vector(frm)).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens


def set_action(name, frame=1):
    arm.animation_data_create()
    arm.animation_data.action = bpy.data.actions[name] if name else None
    if name is None:
        for pb in arm.pose.bones:
            pb.rotation_quaternion = (1, 0, 0, 0)
    sc.frame_set(frame)


def keys_set(**kv):
    for k in keys:
        if k.name != "Basis":
            k.value = 0.0
    for k, v in kv.items():
        keys[k.replace("_", ".") if k.startswith("blink") else k].value = v


shots = []


def shot(tag):
    fp = os.path.join(RD, f"{NAME}_gen_{tag}.png")
    sc.render.filepath = fp
    bpy.ops.render.render(write_still=True)
    shots.append(fp)


eye_z = bpy.data.objects[NAME + "_eye.L"].matrix_world.translation.z
# 1 riposo (posa A), fronte
bench.hide_render = True
set_action(None); keys_set()
look((0, -2.6, 0.62), (0, 0, 0.58), 50); shot("rest_front")
# 2 posa del racconto, tre quarti
bench.hide_render = False
set_action("leanDown", 1); keys_set()
look((-1.1, -1.9, 1.05), (0, -0.15, 0.55), 50); shot("lean_tq")
bench.hide_render = True
look((0.0, -1.9, 0.30), (0, -0.1, 0.30), 50); shot("lean_front_low")
bench.hide_render = False
# 3 visitatore piccolo sul banco
look((0.0, -0.42, 0.268), (0, -0.05, 0.75), 24); shot("visitor")
# 4 contatto visivo finale: all'altezza degli occhi, 1.1 m, 50 gradi di campo
set_action("lookUp", 48); keys_set()
look((0.0, -1.2, eye_z + 0.02), (0, 0, eye_z - 0.03), 38.6); shot("eye_contact")
# primi piani del volto
set_action(None)
fz = eye_z - 0.05
for tag, kv in (("neutral", {}), ("blink", {"blink_L": 1, "blink_R": 1}), ("jaw", {"jawOpen": 1}),
                ("talkA", {"jawOpen": 0.5, "mouthA": 0.55}), ("talkO", {"jawOpen": 0.5, "mouthO": 0.55}),
                ("smile", {"smile": 1}), ("half_blink", {"blink_L": 0.5, "blink_R": 0.5})):
    keys_set(**kv)
    look((0.0, -0.75, fz + 0.01), (0, 0, fz), 85); shot("face_" + tag)
keys_set()
# sguardo: occhi a sinistra di 20 gradi
for sfx in ("L", "R"):
    arm.pose.bones[f"eye.{sfx}"].rotation_quaternion = Quaternion((0, 0, 1), math.radians(20))
look((-0.35, -0.68, fz + 0.01), (0, 0, fz), 85); shot("face_gaze")

if "sheet" in argv:
    ims = [bpy.data.images.load(f) for f in shots]
    Wd, Hd = 700, 900
    cols = 6
    rows = math.ceil(len(ims) / cols)
    sheet = np.ones((Hd * rows, Wd * cols, 4), np.float32)
    for k, im in enumerate(ims):
        a = np.array(im.pixels[:], np.float32).reshape(Hd, Wd, 4)
        r, c = divmod(k, cols)
        sheet[(rows - 1 - r) * Hd:(rows - r) * Hd, c * Wd:(c + 1) * Wd] = a
    out = bpy.data.images.new("sheet", Wd * cols, Hd * rows)
    out.pixels = sheet.ravel()
    out.filepath_raw = os.path.join(RD, f"{NAME}_gen_check.jpg"); out.file_format = "JPEG"; out.save()
print("DONE")
