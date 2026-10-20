"""Verifica di un GLB dei fondatori reimportato: contratto §4 (ossa, shape key, clip), triangoli, appoggio sul banco.

blender -b --python gen_verify.py -- <file.glb>
"""
import sys

import bpy
import numpy as np

SRC = sys.argv[sys.argv.index("--") + 1]
BONES = ["spine", "chest", "neck", "head", "eye.L", "eye.R", "jaw", "shoulder.L", "shoulder.R", "upper_arm.L",
         "upper_arm.R", "forearm.L", "forearm.R", "hand.L", "hand.R"]
# dita: tre ossa per dito, pollice compreso (aggiunta al contratto)
BONES += [f"{f}.0{k}.{s}" for s in ("L", "R") for f in ("thumb", "index", "middle", "ring", "pinky") for k in (1, 2, 3)]
KEYS = ["blink.L", "blink.R", "jawOpen", "mouthA", "mouthO", "mouthE", "mouthMBP", "mouthFV", "smile"]
CLIPS = ["idle", "leanDown", "lookUp", "explain", "pointDown", "nod"]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
bn = [b.name for b in arm.data.bones]
print("bones missing", [b for b in BONES if b not in bn], "extra", [b for b in bn if b not in BONES])
keys = set()
for o in meshes:
    if o.data.shape_keys:
        keys |= {k.name for k in o.data.shape_keys.key_blocks}
        print("mesh", o.name, "key values", {k.name: round(k.value, 3) for k in o.data.shape_keys.key_blocks if k.value})
print("keys missing", [k for k in KEYS if k not in keys])
acts = [a.name for a in bpy.data.actions]
print("clips", acts, "missing", [c for c in CLIPS if not any(a.startswith(c) for a in acts)])
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
print("tris", tris)
dg = bpy.context.evaluated_depsgraph_get()
# riposo: lo sguardo
hd = arm.pose.bones["head"]
print("rest eye L", [round(v, 3) for v in (arm.matrix_world @ arm.pose.bones["eye.L"].head)])
# posa del racconto, fotogramma 0
act = next(a for a in bpy.data.actions if a.name.startswith("leanDown"))
arm.animation_data_create()
arm.animation_data.action = act
if hasattr(arm.animation_data, "action_slot") and act.slots:
    arm.animation_data.action_slot = act.slots[0]
bpy.context.scene.frame_set(int(act.frame_range[0]))
dg = bpy.context.evaluated_depsgraph_get()
wz = []
for sfx in ("L", "R"):
    pb = arm.pose.bones[f"hand.{sfx}"]
    w = arm.matrix_world @ pb.head
    wz.append(w)
low = 9
body = next(o for o in meshes if o.data.shape_keys)
ev = body.evaluated_get(dg).to_mesh()
P = np.array([list(body.matrix_world @ v.co) for v in ev.vertices])
gi = {g.index: g.name for g in body.vertex_groups}
hw = np.zeros(len(P))
for v in body.data.vertices:
    for g in v.groups:
        if gi.get(g.group, "").startswith(("hand", "forearm")):
            hw[v.index] += g.weight
low = P[hw > 0.5][:, 2].min()
HANDB = ("hand", "thumb", "index", "middle", "ring", "pinky")
low_hand = P[np.array([any(gi.get(g.group, "").startswith(HANDB) and g.weight > 0.5 for g in v.groups) for v in body.data.vertices])][:, 2].min()
print("lowest hand point", round(low_hand, 4))
for sfx in ("L", "R"):
    tips = {}
    for f in ("thumb", "index", "middle", "ring", "pinky"):
        m = np.array([any(gi.get(g.group, "") in (f"{f}.03.{sfx}", f"{f}.02.{sfx}") and g.weight > 0.5 for g in v.groups)
                      for v in body.data.vertices])
        tips[f] = round(float(P[m][:, 2].min() - low_hand) * 1000, 1)
    print(sfx, "fingertips above the lowest point (mm)", tips)
# gesti: la mano non deve mai scendere sotto il piano dei polpastrelli di leanDown
hand_m = np.array([any(gi.get(g.group, "").startswith(HANDB) and g.weight > 0.5 for g in v.groups) for v in body.data.vertices])
for cn in ("pointDown", "explain"):
    act2 = next(a for a in bpy.data.actions if a.name.startswith(cn))
    arm.animation_data.action = act2
    if hasattr(arm.animation_data, "action_slot") and act2.slots:
        arm.animation_data.action_slot = act2.slots[0]
    worst = 9.0
    f0, f1 = int(act2.frame_range[0]), int(act2.frame_range[1])
    for fr in range(f0, f1 + 1, 2):
        bpy.context.scene.frame_set(fr)
        dg2 = bpy.context.evaluated_depsgraph_get()
        ev2 = body.evaluated_get(dg2).to_mesh()
        Pz = np.array([(body.matrix_world @ v.co).z for v in ev2.vertices])
        body.evaluated_get(dg2).to_mesh_clear()
        worst = min(worst, float(Pz[hand_m].min()))
    print(cn, "lowest hand point vs bench (mm)", round((worst - low_hand) * 1000, 1))
arm.animation_data.action = act
bpy.context.scene.frame_set(int(act.frame_range[0]))
print("leanDown wrists", [[round(c, 3) for c in w] for w in wz], "lowest hand/forearm point", round(low, 3),
      "wrist above lowest", round(np.mean([w.z for w in wz]) - low, 3))
print("VERIFY DONE")
