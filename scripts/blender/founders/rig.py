"""Scheletro, pesi, shape key, clip e export glTF dei fondatori (contratto §4 di docs/specs/2026-10-07-laboratorio.md).

Ossa: spine, chest, neck, head, eye.L, eye.R, jaw, shoulder.L/R, upper_arm.L/R, forearm.L/R, hand.L/R.
Shape key: blink.L, blink.R, jawOpen, mouthA, mouthO, mouthE, mouthMBP, mouthFV, smile.
Clip: idle, leanDown, lookUp, explain, pointDown, nod (30 fps).
Posa di riposo: testa e occhi guardano verso -Y Blender (= +Z glTF); mani sul piano del banco.
"""
import math

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

import body as BD
import head_fit as H
import parts as PT

FPS = 30


def c2v(c):
    """direzione canonica (mm) -> vettore Blender (m)"""
    return np.stack([c[..., 0], -c[..., 2], c[..., 1]], -1) / 1000.0


# ---------------------------------------------------------------- scheletro
def build_armature(name, HO, eye_L, eye_R, xf=lambda p: p):
    """xf: trasformazione dello spazio testa (es. testa ingrandita nello stile animato)"""
    J = BD.J
    tmj = HO + xf(H.c2b((0, -28, -78))); chin = HO + xf(H.c2b((0, -105, 8)))
    pivot = HO + xf(H.c2b((0, -40, -80)))
    neck0 = Vector((0.0, -0.055, 0.585))
    bones = {
        "spine": (J["hips"], J["chest"], None),
        "chest": (J["chest"], neck0, "spine"),
        "neck": (neck0, pivot, "chest"),
        "head": (pivot, pivot + Vector((0, 0, 0.19)), "neck"),
        "eye.L": (Vector(eye_L), Vector(eye_L) + Vector((0, -0.022, 0)), "head"),
        "eye.R": (Vector(eye_R), Vector(eye_R) + Vector((0, -0.022, 0)), "head"),
        "jaw": (tmj, chin, "head"),
    }
    for s, sfx in ((1, "L"), (-1, "R")):
        bones[f"shoulder.{sfx}"] = (BD.side(J["clav"], s), BD.side(J["shoulder"], s), "chest")
        bones[f"upper_arm.{sfx}"] = (BD.side(J["shoulder"], s), BD.side(J["elbow"], s), f"shoulder.{sfx}")
        bones[f"forearm.{sfx}"] = (BD.side(J["elbow"], s), BD.side(J["wrist"], s), f"upper_arm.{sfx}")
        bones[f"hand.{sfx}"] = (BD.side(J["wrist"], s), BD.side(J["hand_end"], s), f"forearm.{sfx}")
    ad = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, ad)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    for o in bpy.context.view_layer.objects:
        o.select_set(o == arm)
    bpy.ops.object.mode_set(mode="EDIT")
    for nm, (h, t, par) in bones.items():
        eb = ad.edit_bones.new(nm)
        eb.head = h; eb.tail = t
        if nm.startswith(("eye", "spine", "chest", "neck", "head", "jaw")):
            eb.roll = 0.0
        else:
            eb.align_roll(Vector((0, 0, 1)))
    for nm, (h, t, par) in bones.items():
        if par:
            ad.edit_bones[nm].parent = ad.edit_bones[par]
            ad.edit_bones[nm].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm, {k: (Vector(v[0]), Vector(v[1])) for k, v in bones.items()}


# ---------------------------------------------------------------- pesi
def seg_dist(P, a, b):
    a = np.array(a); b = np.array(b)
    ab = b - a
    t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    return np.linalg.norm(P - (a + np.outer(t, ab)), axis=1)


def dist_weights(P, segs, names, power=4.0, eps=0.004):
    d = np.stack([seg_dist(P, *segs[n]) for n in names], 1)
    w = 1.0 / (d + eps) ** power
    return w / w.sum(1, keepdims=True)


def set_weights(ob, arm, names, W):
    for n in names:
        ob.vertex_groups.get(n) or ob.vertex_groups.new(name=n)
    for j, n in enumerate(names):
        g = ob.vertex_groups[n]
        idx = np.where(W[:, j] > 0.003)[0]
        for i in idx:
            g.add([int(i)], float(W[i, j]), "REPLACE")
    mod = ob.modifiers.new("Armature", "ARMATURE"); mod.object = arm
    ob.parent = arm


def skin_all(arm, segs, parts):
    """parts: dict con gli oggetti; 'head_jaw' e 'head_neck' sono pesi gia' calcolati per la testa"""
    head = parts["head"]
    P = np.array([list(v.co) for v in head.data.vertices])
    wj, wn, wc = parts["head_jaw"], parts["head_neck"], parts["head_chest"]
    wh = np.clip(1 - wj - wn - wc, 0, 1)
    set_weights(head, arm, ["head", "jaw", "neck", "chest"], np.stack([wh, wj, wn, wc], 1))
    for ob in parts["rigid_head"]:
        n = len(ob.data.vertices)
        set_weights(ob, arm, ["head"], np.ones((n, 1)))
    torso = parts["torso"]
    P = np.array([list(v.co) for v in torso.data.vertices])
    names = ["spine", "chest", "neck", "shoulder.L", "shoulder.R"]
    W = dist_weights(P, segs, names, power=3.0, eps=0.02)
    set_weights(torso, arm, names, W)
    for ob in parts["collar"]:
        P = np.array([list(v.co) for v in ob.data.vertices])
        t = np.clip((P[:, 2] - 0.54) / 0.08, 0, 1)
        set_weights(ob, arm, ["chest", "neck"], np.stack([1 - t, t], 1))
    for ob, sfx in parts["sleeves"]:
        P = np.array([list(v.co) for v in ob.data.vertices])
        names = ["chest", f"shoulder.{sfx}", f"upper_arm.{sfx}", f"forearm.{sfx}", f"hand.{sfx}"]
        W = dist_weights(P, segs, names, power=5.0, eps=0.006)
        set_weights(ob, arm, names, W)
    for ob, sfx in parts["hands"]:
        set_weights(ob, arm, [f"hand.{sfx}"], np.ones((len(ob.data.vertices), 1)))
    for ob in parts["chest_rigid"]:
        P = np.array([list(v.co) for v in ob.data.vertices])
        t = np.clip((P[:, 2] - 0.53) / 0.05, 0, 1)
        set_weights(ob, arm, ["chest", "neck"], np.stack([1 - 0.6 * t, 0.6 * t], 1))
    for ob, bone in parts["eyes"]:
        mw = ob.matrix_world.copy()
        ob.parent = arm; ob.parent_type = "BONE"; ob.parent_bone = bone
        bpy.context.view_layer.update()
        ob.matrix_world = mw


# ---------------------------------------------------------------- shape key
def rot_x(P, c, ang):
    """rotazione attorno all'asse X passante per c, angolo per vertice"""
    d = P - c
    ca, sa = np.cos(ang), np.sin(ang)
    out = d.copy()
    out[:, 1] = d[:, 1] * ca - d[:, 2] * sa
    out[:, 2] = d[:, 1] * sa + d[:, 2] * ca
    return c + out


def ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def build_shape_keys(head, info):
    """info: canon (N,3 mm), LID, EYE_SIDE, MOUTH, eye_c (2,3 per L,R), tmj, mouth_x, is_head"""
    me = head.data
    P0 = np.array([list(v.co) for v in me.vertices])
    C = info["canon"]; x, y, z = C[:, 0], C[:, 1], C[:, 2]
    ax = np.abs(x)
    LID, ES, MO = info["LID"], info["EYE_SIDE"], info["MOUTH"]
    ish = info["is_head"]
    mx = info["mouth_x"]
    if not me.shape_keys:
        head.shape_key_add(name="Basis", from_mix=False)

    def add(name, P):
        k = head.shape_key_add(name=name, from_mix=False)
        k.data.foreach_set("co", P.astype(np.float32).ravel())
        k.value = 0.0                                    # in Blender 5.2 la chiave nuova non parte da zero
        k.slider_min = 0.0; k.slider_max = 1.0
        return k

    E = PT.EYE
    # --- palpebre
    for side, nm, k in ((1, "blink.L", 0), (-1, "blink.R", 1)):
        c = np.array(info["eye_c"][k]); R = info["r_eye"]
        t = np.clip((side * x - E["xi"]) / (E["xo"] - E["xi"]), 0, 1)
        yb = E["yi"] + (E["yo"] - E["yi"]) * t
        up = yb + E["up"] * np.sin(np.pi * t) ** 0.8
        lo = yb - E["lo"] * np.sin(np.pi * t) ** 0.9
        near = ish & (side * x > 8) & (side * x < 58) & (z > -40) & (y > -20) & (y < 30)
        rim_u = near & (((LID == 1) & (ES == side)) | ((LID == 3) & (ES == side) & (y >= yb)))
        rim_l = near & (((LID == 2) & (ES == side)) | ((LID == 3) & (ES == side) & (y < yb)))
        ang = lambda Q: np.arctan2(Q[:, 2] - c[2], -(Q[:, 1] - c[1]))
        # angolo di chiusura in funzione di x canonico: dal bordo superiore a quello inferiore
        xu, au = side * x[rim_u & (LID == 1)], ang(P0[rim_u & (LID == 1)])
        xl, al = side * x[rim_l & (LID == 2)], ang(P0[rim_l & (LID == 2)])
        ou, ol = np.argsort(xu), np.argsort(xl)
        close = np.interp(side * x, xu[ou], au[ou]) - np.interp(side * x, xl[ol], al[ol])
        close = np.clip(close, 0, 1.2) * 0.85
        w_up = np.where(rim_u, 1.0, near * (1 - ss(0.0, 11.0, y - up)) * (y >= up - 0.5))
        w_lo = np.where(rim_l, 1.0, near * (1 - ss(0.0, 6.0, lo - y)) * (y <= lo + 0.5))
        P = P0.copy()
        P = np.where(w_up[:, None] > 0, rot_x(P, c, close * w_up), P)
        P = np.where(w_lo[:, None] > 0, rot_x(P, c, -close * 0.18 * w_lo), P)
        # niente compenetrazione col bulbo
        mv = (w_up > 0) | (w_lo > 0)
        d = P - c; r = np.linalg.norm(d, axis=1)
        fix = mv & (r < R + 0.0004) & (LID != 3)
        P[fix] = c + d[fix] / r[fix][:, None] * (R + 0.0004)
        add(nm, P)
    # --- mandibola
    tmj = np.array(info["tmj"])
    yl = np.where(ax < mx, -69.0, -69.0 - (ax - mx) * 0.9)
    wj = ss(yl + 2.5, yl - 3.5, y) * ss(-100, -85, z) * (1 - ss(-125, -150, y)) * ish
    wj = np.where(np.isin(MO, (2, 4, 6)), 1.0, wj)
    wj = np.where(np.isin(MO, (1, 3, 5)), 0.0, wj)
    wj = np.where(MO == 7, 0.45 * (y < -69) + 0.15, wj)
    info["w_jaw"] = wj

    def jaw(a):
        return rot_x(P0, tmj, np.radians(a) * wj)

    lip = ish & (ax < mx + 7) & (y > -84) & (y < -55) & (z > -15)
    w_lip = np.where(lip, np.exp(-((y + 69) / 8.0) ** 2) * (1 - ss(mx - 2, mx + 7, ax)), 0.0)
    w_lip = np.where(np.isin(MO, (1, 2, 3, 4)), 1.0 * (ax < mx), w_lip)
    upper = (y > -69) | np.isin(MO, (1, 3, 5))
    corner = np.exp(-(((ax - mx) / 7.0) ** 2 + ((y + 70) / 7.0) ** 2)) * ish * (z > -30)
    sgn = np.sign(x)
    V = lambda dx, dy, dz: c2v(np.stack([dx, dy, dz], -1))     # spostamenti canonici (mm) -> Blender

    add("jawOpen", jaw(16.0))
    P = jaw(9.0) + V(0 * x, 1.2 * w_lip * upper, 0 * x)
    add("mouthA", P)
    P = jaw(6.0) + V(-sgn * ax * 0.28 * w_lip * (ax / mx).clip(0, 1), 0 * x, 3.0 * w_lip)
    add("mouthO", P)
    P = jaw(3.5) + V(sgn * 2.5 * corner + sgn * ax * 0.06 * w_lip, 0.8 * corner, -0.5 * corner)
    add("mouthE", P)
    P = P0 + V(0 * x, np.where(upper, -0.7, 0.9) * w_lip, -1.0 * w_lip)
    add("mouthMBP", P)
    lower_lip = w_lip * (~upper)
    P = jaw(1.5) + V(0 * x, 1.6 * lower_lip, -3.0 * lower_lip)
    add("mouthFV", P)
    cheek = np.exp(-(((ax - 40) / 15.0) ** 2 + ((y + 38) / 13.0) ** 2)) * ish * (z > -40)
    under_eye = np.exp(-(((ax - 31) / 11.0) ** 2 + ((y + 9) / 4.0) ** 2)) * ish * (z > -30) * (LID != 3)
    up_lip = w_lip * upper * (1 - corner)
    low_lip = w_lip * (~upper) * (1 - corner)
    corner = corner * (1 + info.get("smile_asym", 0.0) * sgn)        # sorriso un po' asimmetrico
    sk = info.get("hk", 1.0)                                         # millimetri del volto ingrandito
    so, su, sp, sl = (info.get(k, d) for k, d in (("smile_out", 6.5), ("smile_up", 7.5), ("smile_upper", 2.6),
                                                     ("smile_lower", 3.5)))
    P = P0 + V(sgn * so * corner * sk, (su * corner + 4.0 * cheek + 1.8 * under_eye + sp * up_lip - sl * low_lip) * sk,
               (-2.5 * corner + 2.5 * cheek) * sk)
    add("smile", P)
    return info


# ---------------------------------------------------------------- pose e clip
def ik_arm(arm, sfx, wrist_target, hand_rot=None, pole=None):
    """IK analitica a due ossa: il polso va su wrist_target, il gomito verso 'pole'; mano con rotazione assoluta"""
    pb = arm.pose.bones
    ua, fa, hd = pb[f"upper_arm.{sfx}"], pb[f"forearm.{sfx}"], pb[f"hand.{sfx}"]
    bpy.context.view_layer.update()
    S = ua.head.copy()
    L1 = (ua.bone.tail_local - ua.bone.head_local).length
    L2 = (fa.bone.tail_local - fa.bone.head_local).length
    W = Vector(wrist_target)
    d = min((W - S).length, L1 + L2 - 1e-4)
    u = (W - S).normalized()
    W = S + u * d
    a = (L1 * L1 - L2 * L2 + d * d) / (2 * d)
    h = math.sqrt(max(L1 * L1 - a * a, 0.0))
    s = 1 if sfx == "L" else -1
    pv = Vector(pole) if pole is not None else Vector((s * 0.6, 0.35, -0.75))
    p = (pv - u * pv.dot(u)).normalized()
    E = S + u * a + p * h

    def aim(pbone, head_pos, dirv):
        rest = pbone.bone.matrix_local.to_3x3()
        cur_y = rest.col[1].normalized()
        q = cur_y.rotation_difference(dirv.normalized())
        M = (q.to_matrix() @ rest).to_4x4()
        M.translation = head_pos
        pbone.matrix = M
        bpy.context.view_layer.update()

    aim(ua, S, E - S)
    aim(fa, E, W - E)
    rest_h = hd.bone.matrix_local.to_3x3()
    rot = (hand_rot.to_matrix() if hand_rot is not None else Matrix.Identity(3)) @ rest_h
    M = rot.to_4x4(); M.translation = W
    hd.matrix = M
    bpy.context.view_layer.update()


def set_rot(arm, name, ax_deg):
    """rotazione locale (gradi) attorno a X, Y, Z locali dell'osso"""
    rx, ry, rz = (math.radians(a) for a in ax_deg)
    arm.pose.bones[name].rotation_quaternion = (Quaternion((1, 0, 0), rx) @ Quaternion((0, 1, 0), ry)
                                                @ Quaternion((0, 0, 1), rz))


def reset_pose(arm):
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)


def ease(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


LEAN = {"spine": 5.0, "chest": 6.0, "neck": 10.0, "head": 12.0}
UPRIGHT = {"spine": -1.0, "chest": -2.0, "neck": -2.0, "head": -3.0}


def make_clip(arm, name, frames, body_fn, wrist_rest, loop=False, finger_fn=None):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    bones = [pb.name for pb in arm.pose.bones]
    for f in range(frames + 1):
        t = f / frames
        reset_pose(arm)
        targets = body_fn(arm, t)                   # imposta spine/chest/neck/head, restituisce bersagli dei polsi
        for sfx in ("L", "R"):
            tgt, hrot = targets.get(sfx, (wrist_rest[sfx], None))
            ik_arm(arm, sfx, tgt, hrot)
        if finger_fn is not None:
            finger_fn(arm, name, t, targets)
        for nm in bones:
            arm.pose.bones[nm].keyframe_insert("rotation_quaternion", frame=f + 1)
    arm.animation_data.action = None
    reset_pose(arm)
    return act


def build_clips(arm, wrist_rest, seed=0, finger_fn=None):
    rng = np.random.default_rng(seed)
    ph = rng.uniform(0, 6.28, 4)

    def spine_set(arm, w):
        for nm, a in w.items():
            set_rot(arm, nm, (a[0], a[1], a[2]) if isinstance(a, tuple) else (a, 0, 0))

    def lean(k=1.0):
        return {n: LEAN[n] * k for n in LEAN}

    # idle: respiro e micro-movimenti (strato additivo, 4 s)
    def idle(arm, t):
        b = math.sin(2 * math.pi * t)
        spine_set(arm, {"spine": (0.4 * b, 0, 0), "chest": (-1.1 * b, 0, 0),
                        "neck": (0.5 * math.sin(2 * math.pi * t + ph[0]), 0.6 * math.sin(2 * math.pi * t + ph[1]), 0),
                        "head": (0.7 * math.sin(4 * math.pi * t + ph[2]), 0.8 * math.sin(2 * math.pi * t + ph[3]), 0)})
        return {}

    def lean_down(arm, t):
        b = math.sin(2 * math.pi * t)
        w = lean()
        w = {"spine": (w["spine"] + 0.3 * b, 0, 0), "chest": (w["chest"] - 0.8 * b, 0, 0),
             "neck": (w["neck"], 0.8 * math.sin(2 * math.pi * t + ph[0]), 0),
             "head": (w["head"] + 0.6 * math.sin(4 * math.pi * t), 0.6 * math.sin(2 * math.pi * t + ph[1]), 0)}
        spine_set(arm, w)
        return {}

    def look_up(arm, t):
        e = ease(t)
        spine_set(arm, {n: (LEAN[n] * (1 - e) + UPRIGHT[n] * e, 0, 0) for n in LEAN})
        return {}

    def explain(arm, t):
        spine_set(arm, {n: (LEAN[n] * 0.85, 0, 0) for n in LEAN})
        env = ease(t / 0.25) * (1 - ease((t - 0.75) / 0.25))
        wr = wrist_rest["R"]
        tgt = wr + Vector((0.06, -0.02, 0.17)) * env + Vector((0.025 * math.sin(t * 2 * math.pi * 2.5), 0,
                                                                 0.02 * math.sin(t * 2 * math.pi * 5))) * env
        hrot = Quaternion((0, 1, 0), math.radians(70) * env) @ Quaternion((1, 0, 0), math.radians(-25) * env)
        set_rot(arm, "head", (LEAN["head"] * 0.85, 4 * env, 0))
        return {"R": (tgt, hrot)}

    def point_down(arm, t):
        env = ease(t / 0.3) * (1 - ease((t - 0.7) / 0.3))
        spine_set(arm, {n: (LEAN[n] + 3 * env, 0, 0) for n in LEAN})
        wr = wrist_rest["R"]
        tgt = wr + Vector((0.04, -0.15, 0.06)) * env
        hrot = Quaternion((1, 0, 0), math.radians(38) * env)          # la mano scende: l'indice punta al banco
        return {"R": (tgt, hrot)}

    def nod(arm, t):
        a = 8 * math.sin(math.pi * min(t / 0.45, 1)) + 5 * math.sin(math.pi * max(min((t - 0.45) / 0.45, 1), 0))
        spine_set(arm, {"spine": (LEAN["spine"], 0, 0), "chest": (LEAN["chest"], 0, 0),
                        "neck": (LEAN["neck"] + 0.3 * a, 0, 0), "head": (LEAN["head"] + 0.7 * a, 0, 0)})
        return {}

    clips = [("idle", 4.0, idle), ("leanDown", 4.0, lean_down), ("lookUp", 1.6, look_up),
             ("explain", 3.0, explain), ("pointDown", 2.6, point_down), ("nod", 1.6, nod)]
    return [make_clip(arm, nm, int(round(sec * FPS)), fn, wrist_rest, finger_fn=finger_fn) for nm, sec, fn in clips]


def pose_from_clip(arm, act, frame):
    arm.animation_data_create()
    arm.animation_data.action = act
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()


# ---------------------------------------------------------------- export
def export_glb(path, objs):
    for o in bpy.context.view_layer.objects:
        o.select_set(o in objs)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
        export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True,
        export_skins=True, export_morph=True, export_morph_normal=False, export_materials="EXPORT",
        export_image_format="AUTO", export_def_bones=False, export_extras=False)
