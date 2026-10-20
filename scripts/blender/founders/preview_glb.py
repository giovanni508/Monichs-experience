"""Anteprima di un GLB generato: fronte, tre quarti, profilo, retro e primo piano del volto, in un foglio unico.

blender -b --python preview_glb.py -- <in.glb> <out.jpg> [titolo]
"""
import math
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
ROT = float(argv[2]) if len(argv) > 2 else 0.0          # rotazione attorno a Z per portare lo sguardo verso -Y
if ROT:
    for o in bpy.context.scene.objects:
        if o.parent is None:
            o.matrix_world = Matrix.Rotation(math.radians(ROT), 4, "Z") @ o.matrix_world
    bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
pts = []
tris = 0
for o in meshes:
    me = o.evaluated_get(dg).to_mesh()
    M = o.matrix_world
    pts += [M @ v.co for v in me.vertices]
    tris += sum(len(p.vertices) - 2 for p in me.polygons)
P = np.array([list(p) for p in pts])
lo, hi = P.min(0), P.max(0)
print("BOUNDS", lo.round(3).tolist(), hi.round(3).tolist(), "tris", tris)
ctr = Vector(((lo + hi) / 2).tolist())
H = float(hi[2] - lo[2])

sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x, sc.render.resolution_y = 640, 900
sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); sc.world = w
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.82, 0.82, 0.84, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.6


def light(name, loc, energy, size=2.0):
    L = bpy.data.lights.new(name, "AREA"); L.energy = energy; L.size = size
    o = bpy.data.objects.new(name, L); sc.collection.objects.link(o)
    o.location = ctr + Vector(loc) * H
    d = ctr - o.location
    o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


light("key", (-0.8, -1.2, 0.6), 70 * H * H)
light("fill", (1.0, -0.9, 0.2), 30 * H * H)
light("rim", (0.3, 1.2, 0.8), 40 * H * H)

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam)
sc.camera = cam
cam.data.type = "ORTHO"

shots = []
for i, (az, el, zoom, cz) in enumerate(((0, 0, 1.05, 0.5), (35, 5, 1.05, 0.5), (90, 0, 1.05, 0.5), (180, 0, 1.05, 0.5),
                                        (0, 0, 0.24, 0.88), (30, 0, 0.24, 0.88))):
    a = math.radians(az); e = math.radians(el)
    tgt = Vector((ctr.x, ctr.y, lo[2] + cz * H))
    d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    cam.location = tgt + d * H * 3
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    cam.data.ortho_scale = H * zoom
    fp = OUT.replace(".jpg", "_%d.png" % i)
    sc.render.filepath = fp
    bpy.ops.render.render(write_still=True)
    shots.append(fp)

# foglio unico
ims = [bpy.data.images.load(f) for f in shots]
W, Hh = 640, 900
sheet = np.ones((Hh, W * len(ims), 4), np.float32)
for k, im in enumerate(ims):
    a = np.array(im.pixels[:], np.float32).reshape(Hh, W, 4)
    sheet[:, k * W:(k + 1) * W] = a
out = bpy.data.images.new("sheet", W * len(ims), Hh)
out.pixels = sheet.ravel()
out.filepath_raw = OUT; out.file_format = "JPEG"; out.save()
print("SHEET", OUT)
