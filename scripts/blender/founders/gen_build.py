"""Fase 3 dei fondatori generati: decimazione, occhi veri, palpebre, bocca apribile, scheletro, pesi, shape key, clip, GLB.

blender -b --python gen_build.py -- <nome> [draft]
Legge <nome>_prep.blend, <nome>_body.json, <nome>_face.json (gen_prep.py, gen_face.py).
Esce Modelli/3D/fondatori/<nome>.blend e founder-<nome>.glb (contratto §4 di docs/specs/2026-10-07-laboratorio.md).
"""
import heapq
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rig as RG  # noqa: E402
import gen_tex as GT  # noqa: E402
import gen_hands as GH  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
NAME = argv[0]
DRAFT = "draft" in argv[1:]
GEN = r"C:\Users\UTENTE\Desktop\MNC GAME\Modelli\3D\fondatori\generati"
OUT = r"C:\Users\UTENTE\Desktop\MNC GAME\Modelli\3D\fondatori\v3"          # v3: fuori da public/ finche' Giovanni non approva
os.makedirs(OUT, exist_ok=True)
CFG = {
    # smile_open: quanto la shape key smile apre le labbra (Filippo sorride con i denti, Giovanni a bocca chiusa)
    # skin_gain: correzione del tono della pelle verso il riferimento di stile (sRGB, solo pixel di pelle)
    # brow_rgb: sopracciglia morbide (non nere); smile_open: apertura delle labbra nella chiave smileTeeth
    "filippo": {"targets": (17500, 17000, 10000, 1800), "smile_open": 0.85, "skin_gain": (1.0, 1.0, 1.0),
                "brow_rgb": (0.15, 0.095, 0.065), "beard": False, "iris_rgb": (0.36, 0.215, 0.115),
                "skin_target": (236, 176, 144),  # fronte del riferimento, saturazione -15%
                # mani costruite: lunghezza (piega del polso -> punta del medio); polsino: tipo, altezza, apertura
                # (dal giunto del polso verso il gomito), gioco attorno al polso
                "hand_len": 0.178, "cuff": ("shirt", 0.060, -0.020, 0.0075)},
    "giovanni": {"targets": (17500, 17000, 10000, 1800), "smile_open": 0.55, "skin_gain": (1.0, 1.0, 1.0),
                 "brow_rgb": (0.17, 0.105, 0.07), "beard": True, "iris_rgb": (0.29, 0.175, 0.10),
                 "skin_target": (235, 174, 148),
                 "hand_len": 0.162, "cuff": ("knit", 0.042, -0.016, 0.005)},
}[NAME]
TABLE_Z = 0.255

bpy.ops.wm.open_mainfile(filepath=os.path.join(GEN, NAME + "_prep.blend"))
body = json.load(open(os.path.join(GEN, NAME + "_body.json")))
face = json.load(open(os.path.join(GEN, NAME + "_face.json")))
J = {k: np.array(v) for k, v in body["J"].items()}
ob = bpy.data.objects[NAME]
me = ob.data
sc = bpy.context.scene

# macchie verdastre (difetti della texture generata, per esempio sui polpastrelli): riportate al tono vicino
_bi0 = [n.image for n in me.materials[0].node_tree.nodes if n.type == "TEX_IMAGE" and
        any(l.to_socket.name == "Base Color" for l in n.outputs[0].links)][0]
_a0 = np.empty(_bi0.size[0] * _bi0.size[1] * 4, np.float32); _bi0.pixels.foreach_get(_a0); _a0 = _a0.reshape(-1, 4)
_r, _gg, _b = _a0[:, 0], _a0[:, 1], _a0[:, 2]
_vv = _a0[:, :3].max(1); _ss = (_vv - _a0[:, :3].min(1)) / np.maximum(_vv, 1e-4)
_green = (_gg > _r * 1.01) & (_gg > _b) & (_ss > 0.08) & (_vv > 0.15)
_a0[_green, 1] = np.minimum(_gg[_green], _r[_green] * 0.82)
_bi0.pixels.foreach_set(_a0.ravel()); _bi0.update(); _bi0.pack()
print("greenish texels fixed", int(_green.sum()))
del _a0

# tono della pelle: piu' caldo dove serve (Giovanni: la texture generata e' rosata, il riferimento abbronzato)
if tuple(CFG["skin_gain"]) != (1.0, 1.0, 1.0):
    _bi = [n.image for n in me.materials[0].node_tree.nodes if n.type == "TEX_IMAGE" and
           any(l.to_socket.name == "Base Color" for l in n.outputs[0].links)][0]
    _a = np.empty(_bi.size[0] * _bi.size[1] * 4, np.float32); _bi.pixels.foreach_get(_a); _a = _a.reshape(-1, 4)
    _rgb = _a[:, :3]
    _v = _rgb.max(1); _s = (_v - _rgb.min(1)) / np.maximum(_v, 1e-4)
    _skin = (_rgb[:, 0] >= _rgb[:, 1]) & (_rgb[:, 1] >= _rgb[:, 2] * 0.9)
    _m = _skin * np.clip((_v - 0.40) / 0.15, 0, 1) * np.clip((_s - 0.12) / 0.08, 0, 1) * np.clip((0.55 - _s) / 0.1, 0, 1)
    _g = np.array(CFG["skin_gain"], np.float32)
    _a[:, :3] = np.clip(_rgb * (1 - _m[:, None]) + _rgb * _g[None] * _m[:, None], 0, 1)
    _bi.pixels.foreach_set(_a.ravel()); _bi.update(); _bi.pack()
    print("skin graded", int((_m > 0.5).sum()), "pixels")


def verts_np(m):
    a = np.empty(len(m.vertices) * 3, np.float32); m.vertices.foreach_get("co", a)
    return a.reshape(-1, 3).astype(np.float64)


def ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def inside_poly(xz, poly):
    """punti (N,2) dentro il poligono (M,2): conteggio degli attraversamenti"""
    x, z = xz[:, 0:1], xz[:, 1:2]
    a = poly; b = np.roll(poly, -1, 0)
    cond = (a[:, 1] > z) != (b[:, 1] > z)
    xi = a[:, 0] + (z - a[:, 1]) * (b[:, 0] - a[:, 0]) / np.where(np.abs(b[:, 1] - a[:, 1]) < 1e-12, 1e-12, b[:, 1] - a[:, 1])
    return (np.sum(cond & (x < xi), 1) % 2) == 1


def nearest_on_poly(p, poly):
    best, bd = None, 1e9
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        ab = b - a
        t = np.clip(np.dot(p - a, ab) / max(np.dot(ab, ab), 1e-12), 0, 1)
        q = a + t * ab
        d = np.linalg.norm(p - q)
        if d < bd:
            bd, best = d, q
    return best


# ---------------------------------------------------------------- superficie ad alta risoluzione (riferimento)
P_hi = verts_np(me)
bm_hi = bmesh.new(); bm_hi.from_mesh(me)
BVH_HI = BVHTree.FromBMesh(bm_hi)
N_hi = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get("normal", N_hi); N_hi = N_hi.reshape(-1, 3)


def front_hit(x, z, y0=-2.0):
    loc, n, i, d = BVH_HI.ray_cast(Vector((x, y0, z)), Vector((0, 1, 0)))
    return np.array(loc) if loc is not None else None


# ---------------------------------------------------------------- occhi: sfera dal guscio dell'occhio generato
EYES = {}
for sfx in ("L", "R"):
    e = face["eyes"][sfx]
    poly = np.array(e["outline"])
    ac = poly.mean(0)
    ahw, ahh = np.ptp(poly[:, 0]) / 2, np.ptp(poly[:, 1]) / 2
    shrink = ac + (poly - ac) * 0.8
    m = inside_poly(P_hi[:, [0, 2]], shrink) & (N_hi[:, 1] < -0.2)
    front = front_hit(ac[0], ac[1])
    m &= P_hi[:, 1] < front[1] + 0.3 * ahw
    Q = P_hi[m]
    A = np.c_[2 * Q, np.ones(len(Q))]
    sol = np.linalg.lstsq(A, (Q ** 2).sum(1), rcond=None)[0]
    C = sol[:3]; R = math.sqrt(sol[3] + C @ C)
    print(sfx, "eye fit R", round(R, 4), "C", C.round(4), "almond hw", round(ahw, 4), "n", len(Q))
    if not (0.7 * ahw < R < 1.6 * ahw):
        R = 1.05 * ahw
        C = front + np.array([0, R, 0])
        print(sfx, "  fallback R", R)
    EYES[sfx] = {"poly": poly, "ac": ac, "ahw": ahw, "ahh": ahh, "C": C, "R": R,
                 # occhi uguali: l'iride piu' grande delle due (il riflesso puo' spezzare l'anello di una), pupilla media
                 "iris_r": max(face["eyes"]["L"]["iris_r"], face["eyes"]["R"]["iris_r"]),
                 "pupil_r": 0.5 * (face["eyes"]["L"]["pupil_r"] + face["eyes"]["R"]["pupil_r"]),
                 "iris_rgb": list(CFG["iris_rgb"])}                  # marrone del riferimento (la texture le dava rosse)

# simmetria: il volto generato e' simmetrico; occhi e bocca si specchiano attorno al centro fra gli occhi
XC = 0.5 * (EYES["L"]["ac"][0] + EYES["R"]["ac"][0])
rL, rR = EYES["L"]["R"], EYES["R"]["R"]
bad = abs(rL - rR) / (0.5 * (rL + rR)) > 0.12 or any(not (0.7 * e["ahw"] < e["R"] < 1.6 * e["ahw"]) for e in EYES.values())
if bad:
    for e in EYES.values():
        fr = front_hit(e["ac"][0], e["ac"][1])
        e["R"] = 1.05 * 0.5 * (EYES["L"]["ahw"] + EYES["R"]["ahw"])
        e["C"] = fr + np.array([0, e["R"], 0])
    print("eyes: symmetric fallback R", round(EYES["L"]["R"], 4))
dxe = 0.5 * ((EYES["L"]["C"][0] - XC) - (EYES["R"]["C"][0] - XC))
ye = 0.5 * (EYES["L"]["C"][1] + EYES["R"]["C"][1]); ze = 0.5 * (EYES["L"]["C"][2] + EYES["R"]["C"][2])
Rm = 0.5 * (EYES["L"]["R"] + EYES["R"]["R"])
EYES["L"]["C"] = np.array([XC + dxe, ye, ze]); EYES["R"]["C"] = np.array([XC - dxe, ye, ze])
EYES["L"]["R"] = EYES["R"]["R"] = Rm

# bocca: linea delle labbra in 3D (simmetrica attorno a XC)
lip0 = np.array(face["lip"])
hw_l = 0.5 * (abs(lip0[0, 0] - XC) + abs(lip0[-1, 0] - XC))
xs_l = np.linspace(-hw_l, hw_l, 41)
o_l = np.argsort(lip0[:, 0])
zl_a = np.interp(XC + xs_l, lip0[o_l, 0], lip0[o_l, 1]); zl_b = np.interp(XC - xs_l, lip0[o_l, 0], lip0[o_l, 1])
lip = np.stack([XC + xs_l, 0.5 * (zl_a + zl_b)], 1)
lip3 = []
for x, z in lip:
    h = front_hit(x, z)
    if h is not None:
        lip3.append(h)
lip3 = np.array(lip3)
MW = (lip3[:, 0].max() - lip3[:, 0].min()) / 2          # mezza larghezza della bocca
MC = lip3[np.argmin(np.abs(lip3[:, 0] - lip3[:, 0].mean()))]
print("mouth half width", round(MW, 4), "center", MC.round(4))


def lip_z_at(x):
    return np.interp(x, lip[:, 0], lip[:, 1])


eye_z = 0.5 * (EYES["L"]["C"][2] + EYES["R"]["C"][2])
# profilo centrale: mento = punto piu' avanti sotto la bocca prima che il profilo rientri verso il collo
prof = []
for z in np.linspace(MC[2] - 0.01, J["neck_mid"][2] - 0.02, 80):
    h = front_hit(0.0, z)
    if h is not None:
        prof.append(h)
prof = np.array(prof)
k_ch = int(np.argmin(prof[:, 1]))
# punta del mento: il punto piu' basso ancora vicino al fronte del profilo (sotto, il profilo rientra verso il collo)
front_y = prof[k_ch, 1]
k_tip = max(i for i in range(k_ch, len(prof)) if prof[i, 1] - front_y < 0.35 * MW and
            all(prof[j, 1] - front_y < 0.35 * MW for j in range(k_ch, i + 1)))
chin = prof[k_tip]
under = prof[k_tip:]
k_u = next((i for i in range(len(under)) if under[i, 1] - chin[1] > 0.8 * MW), len(under) - 1)
chin_low = under[k_u]
head_vs = P_hi[(P_hi[:, 2] > MC[2]) & (P_hi[:, 2] < eye_z)]
y_back = float(np.percentile(head_vs[:, 1], 98))
TMJ = np.array([0.0, MC[1] + 0.62 * (y_back - MC[1]), MC[2] + 0.55 * (eye_z - MC[2])])
print("chin", chin.round(4), "chin_low", chin_low.round(4), "tmj", TMJ.round(4))

# ---------------------------------------------------------------- decimazione per zone
def tri_count():
    return sum(len(p.vertices) - 2 for p in me.polygons)


def face_centers():
    c = np.empty(len(me.polygons) * 3, np.float32); me.polygons.foreach_get("center", c)
    n = np.empty(len(me.polygons) * 3, np.float32); me.polygons.foreach_get("normal", n)
    return c.reshape(-1, 3), n.reshape(-1, 3)


def zones():
    c, n = face_centers()
    det = np.zeros(len(c), bool)
    for e in EYES.values():
        dx = (c[:, 0] - e["ac"][0]) / (1.6 * e["ahw"]); dz = (c[:, 2] - e["ac"][1]) / (2.6 * e["ahh"])
        det |= (dx * dx + dz * dz < 1) & (c[:, 1] < e["C"][1])
    dx = (c[:, 0] - MC[0]) / (1.45 * MW); dz = (c[:, 2] - MC[2]) / (0.95 * MW)
    det |= (dx * dx + dz * dz < 1) & (c[:, 1] < MC[1] + 0.5 * MW)
    head = (c[:, 2] > J["neck_mid"][2] - 0.07) & ~det                # testa, collo e colletto: piu' fitti
    hands = np.zeros(len(c), bool)
    for sfx_ in ("L", "R"):
        a_, b_ = J[f"wrist.{sfx_}"], J[f"tip.{sfx_}"]
        ab = b_ - a_
        t_ = np.clip(((c - a_) @ ab) / (ab @ ab), -0.15, 1.0)
        d_ = np.linalg.norm(c - (a_ + t_[:, None] * ab), axis=1)
        hands |= (d_ < 0.55 * np.linalg.norm(ab)) & ((c - a_) @ ab > -0.12 * (ab @ ab))
    # le mani generate non ci sono piu': qui resta cio' che sta sotto il banco (fianchi, cintura), che non si vede
    hands |= c[:, 2] < 0.12
    hands &= ~det & ~head
    bod = ~det & ~head & ~hands
    return {"body": bod, "head": head, "detail": det, "hands": hands}


def decimate(mask, ratio):
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.view_layer.objects:
        o.select_set(o == ob)
    me.polygons.foreach_set("select", mask)
    vs = np.zeros(len(me.vertices), bool)
    fv = np.empty(sum(len(p.vertices) for p in me.polygons), np.int32); me.polygons.foreach_get("vertices", fv)
    ls = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get("loop_total", ls)
    vs[fv[np.repeat(mask, ls)]] = True
    me.vertices.foreach_set("select", vs)
    ev = np.empty(len(me.edges) * 2, np.int32); me.edges.foreach_get("vertices", ev); ev = ev.reshape(-1, 2)
    me.edges.foreach_set("select", vs[ev[:, 0]] & vs[ev[:, 1]])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.decimate(ratio=float(ratio))
    bpy.ops.object.mode_set(mode="OBJECT")


# ---------------------------------------------------------------- polsi: via mani e polsini generati, manica infilata
_cuff_kind, _cuff_H, _cuff_end, _cuff_gap = CFG["cuff"]
HL = CFG["hand_len"]
ARMF, CUFF_AB, CLOTH = {}, {}, {}
_img0 = [n.image for n in me.materials[0].node_tree.nodes if n.type == "TEX_IMAGE" and
         any(l.to_socket.name == "Base Color" for l in n.outputs[0].links)][0]
_kill = []
for sfx_ in ("L", "R"):
    fr_ = GH.arm_frame(J, sfx_)
    ARMF[sfx_] = fr_
    A_ = 0.5 * GH.DEFAULT["wrist_w"] * HL + _cuff_gap
    B_ = 0.5 * GH.DEFAULT["wrist_t"] * HL + _cuff_gap
    CUFF_AB[sfx_] = (A_, B_)
    s_top = _cuff_end - _cuff_H
    Pc_ = verts_np(me)
    rel_ = Pc_ - fr_["wrist"]
    sv_ = rel_ @ fr_["af"]
    rv_ = np.linalg.norm(rel_ - np.outer(sv_, fr_["af"]), axis=1)
    near_ = np.where((sv_ > s_top - 0.06) & (sv_ < s_top - 0.01) & (rv_ < 0.12) & ((1 if sfx_ == "L" else -1) * Pc_[:, 0] > 0.04))[0]
    CLOTH[sfx_] = GH.sample_color(me, _img0, near_)
    kill_, rmed_ = GH.tuck_sleeve(me, fr_, sfx_, s_top, (A_, B_))
    _kill.append(kill_)
    print(sfx_, "sleeve tucked into the cuff: removed verts", len(kill_), "sleeve radius", round(rmed_, 4),
          "cloth", (CLOTH[sfx_] * 255).round().astype(int).tolist())
_bmk = bmesh.new(); _bmk.from_mesh(me); _bmk.verts.ensure_lookup_table()
bmesh.ops.delete(_bmk, geom=[_bmk.verts[int(i)] for i in np.concatenate(_kill)], context="VERTS")
_bmk.to_mesh(me); _bmk.free(); me.update()

tg = dict(zip(("body", "head", "detail", "hands"), CFG["targets"]))
for zn in ("body", "hands", "head", "detail"):
    z = zones()
    n = int(z[zn].sum())
    if n > tg[zn]:
        decimate(z[zn], tg[zn] / n)
    print("decimate", zn, n, "->", int(zones()[zn].sum()), "total", tri_count())

# ---------------------------------------------------------------- colori per vertice (sopracciglia) e mani costruite
_hi = BASE_IMG0 = [n.image for n in me.materials[0].node_tree.nodes if n.type == "TEX_IMAGE" and
                   any(l.to_socket.name == "Base Color" for l in n.outputs[0].links)][0]
_TW, _TH = _hi.size
_tx = np.empty(_TW * _TH * 4, np.float32); _hi.pixels.foreach_get(_tx); _tx = _tx.reshape(_TH, _TW, 4)
_uv = np.empty(len(me.loops) * 2, np.float32); me.uv_layers[0].data.foreach_get("uv", _uv); _uv = _uv.reshape(-1, 2)
_lv = np.empty(len(me.loops), np.int32); me.loops.foreach_get("vertex_index", _lv)
_vuv = np.zeros((len(me.vertices), 2), np.float32); _vuv[_lv] = _uv
_vc = _tx[np.clip((_vuv[:, 1] * _TH).astype(int), 0, _TH - 1), np.clip((_vuv[:, 0] * _TW).astype(int), 0, _TW - 1), :3]
del _tx
_vmax = _vc.max(1); _sat = (_vmax - _vc.min(1)) / np.maximum(_vmax, 1e-4)
_skin = (_sat > 0.2) & (_vmax > 0.35) & (_vc[:, 0] >= _vc[:, 1]) & (_vc[:, 1] >= _vc[:, 2] * 0.85)

HANDS, CUFFS, HJ, FBONES = {}, {}, {}, {}
for sfx_ in ("L", "R"):
    fr_ = ARMF[sfx_]
    origin_ = fr_["wrist"] + fr_["ah"] * 0.005                   # piega del polso, appena oltre il giunto
    hob, jw_, frames_ = GH.build_hand(f"{NAME}_hand.{sfx_}", origin_, fr_["ah"], fr_["thumb"], fr_["dorsal"], HL, sfx_,
                                      forearm_axis=fr_["af"])
    HANDS[sfx_] = hob; HJ[sfx_] = jw_
    FBONES.update(GH.finger_bones(jw_, frames_, sfx_))
    J[f"tip.{sfx_}"] = jw_["middle"][3].copy()                   # punta del medio a riposo
    J[f"mcp.{sfx_}"] = jw_["middle"][0].copy()
    CUFFS[sfx_] = GH.build_cuff(f"{NAME}_cuff.{sfx_}", _cuff_kind, fr_, _cuff_end, _cuff_H, CUFF_AB[sfx_], CLOTH[sfx_], sfx_)
    print(sfx_, "hand built: tris", sum(len(p.vertices) - 2 for p in hob.data.polygons),
          "cuff tris", sum(len(p.vertices) - 2 for p in CUFFS[sfx_].data.polygons))
# i due polsini usano gli stessi materiali (meno primitive e immagini nel GLB)
for _i, _m in enumerate(CUFFS["L"].data.materials):
    CUFFS["R"].data.materials[_i] = _m

# ---------------------------------------------------------------- volto: rilievi duri ammorbiditi
# Il modello generato ha le sopracciglia come blocchi in rilievo (il bordo prende luce: un alone chiaro), borse sotto
# gli occhi e pieghe dagli angoli della bocca verso il mento (bocca da marionetta). Smussatura laplaciana lungo la
# normale media della zona (la texture non scivola; sulle pareti di un gradino la normale locale e' di lato).
# Taubin (mu) conserva le forme larghe un centimetro: proprio il blocco delle sopracciglia; qui serve quella semplice.
def _lap(Q, ev_, deg_):
    """laplaciano uniforme (media dei vicini - punto), con bincount (veloce)"""
    S_ = np.stack([np.bincount(ev_[:, 0], weights=Q[ev_[:, 1], c], minlength=len(Q)) +
                   np.bincount(ev_[:, 1], weights=Q[ev_[:, 0], c], minlength=len(Q)) for c in range(3)], 1)
    return S_ / np.maximum(deg_, 1)[:, None] - Q


def thin_plate_fill(Pv, Nv, free, iters=4000, tol=1e-9, alpha=0.0):
    """i vertici liberi si spostano SOLO lungo la normale media (la texture non scivola) fino a minimizzare la curvatura
    (|K x|^2, K laplaciano del grafo); tutti gli altri restano fermi: i due anelli intorno fissano posizione e
    pendenza del bordo. alpha > 0 ancora la superficie alla forma originale (bi-armonico schermato): spariscono gli
    spigoli e i gradini stretti, resta il rilievo largo (un'arcata morbida invece di nessuna arcata).
    Gradiente coniugato sul solo spostamento scalare, prodotti sparsi con bincount."""
    ev_ = np.empty(len(me.edges) * 2, np.int32); me.edges.foreach_get("vertices", ev_); ev_ = ev_.reshape(-1, 2)
    deg_ = np.bincount(ev_.ravel(), minlength=len(Pv)).astype(np.float64)

    def K(X):
        A_ = np.stack([np.bincount(ev_[:, 0], weights=X[ev_[:, 1], c], minlength=len(X)) +
                       np.bincount(ev_[:, 1], weights=X[ev_[:, 0], c], minlength=len(X)) for c in range(X.shape[1])], 1)
        return deg_[:, None] * X - A_
    NB = Nv.copy()
    for _ in range(20):
        NB = NB + (K(NB) * -1 + deg_[:, None] * NB) / np.maximum(deg_, 1)[:, None]      # media con i vicini
        NB /= np.maximum(np.linalg.norm(NB, axis=1), 1e-9)[:, None]
    Nf = NB[free]

    def M(dv):
        X = np.zeros((len(Pv), 3)); X[free] = dv[:, None] * Nf
        return (K(K(X))[free] * Nf).sum(1) + alpha * dv
    b = -(K(K(Pv))[free] * Nf).sum(1)
    d = np.zeros(int(free.sum())); r = b.copy(); p = r.copy(); rs = r @ r; rs0 = rs
    for it in range(iters):
        Ap = M(p)
        a = rs / max(p @ Ap, 1e-30)
        d += a * p; r -= a * Ap
        rs_new = r @ r
        if rs_new < tol * tol * max(rs0, 1e-30):
            break
        p = r + (rs_new / max(rs, 1e-30)) * p; rs = rs_new
    out = Pv.copy(); out[free] += d[:, None] * Nf
    print("thin plate fill: free verts", int(free.sum()), "iterations", it + 1, "normal move mm", round(1000 * float(d.min()), 2),
          round(1000 * float(d.max()), 2))
    return out


def smooth_normal(Pv, Nv, w, iters=30, lam=0.5, mu=None, dmin=None, dmax=None, biharm=0):
    ev_ = np.empty(len(me.edges) * 2, np.int32); me.edges.foreach_get("vertices", ev_); ev_ = ev_.reshape(-1, 2)
    deg_ = np.bincount(ev_.ravel(), minlength=len(Pv)).astype(np.float64)
    act = w > 0
    Q = Pv.copy()
    for _ in range(iters):
        for f_ in ((lam, mu) if mu is not None else (lam,)):
            S_ = np.zeros_like(Q)
            np.add.at(S_, ev_[:, 0], Q[ev_[:, 1]]); np.add.at(S_, ev_[:, 1], Q[ev_[:, 0]])
            Lp = S_ / np.maximum(deg_, 1)[:, None] - Q
            Q[act] += f_ * w[act, None] * Lp[act]
    # raccordo anche nella pendenza (bi-laplaciano): niente spigolo dove la zona spianata incontra la pelle intorno
    for _ in range(biharm):
        L2 = _lap(_lap(Q, ev_, deg_), ev_, deg_)
        Q[act] -= 0.15 * w[act, None] * L2[act]
    NB = Nv.copy()
    for _ in range(10):
        S_ = np.zeros_like(NB)
        np.add.at(S_, ev_[:, 0], NB[ev_[:, 1]]); np.add.at(S_, ev_[:, 1], NB[ev_[:, 0]])
        NB = NB + S_
        NB /= np.maximum(np.linalg.norm(NB, axis=1), 1e-9)[:, None]
    dn = ((Q - Pv) * NB).sum(1)
    if dmin is not None or dmax is not None:
        dn = np.clip(dn, dmin if dmin is not None else -np.inf, dmax if dmax is not None else np.inf)
    return Pv + dn[:, None] * NB


PS = verts_np(me)
NS = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get("normal", NS); NS = NS.reshape(-1, 3).astype(np.float64)
xs_, ys_, zs_ = PS[:, 0], PS[:, 1], PS[:, 2]
w_sm = np.zeros(len(PS))
for e in EYES.values():
    acx, acz = e["ac"]; ahw, ahh = e["ahw"], e["ahh"]
    fr_ = ys_ < e["C"][1] + 0.8 * e["R"]
    # sopracciglio: il blocco in rilievo
    wb = (1 - ss(1.7 * ahw, 2.1 * ahw, np.abs(xs_ - acx))) * ss(acz + 0.7 * ahh, acz + 1.1 * ahh, zs_) * \
        (1 - ss(acz + 4.2 * ahh, acz + 5.0 * ahh, zs_))
    # sotto l'occhio: borsa e piega (lontano dal bordo della palpebra, che si aggancia dopo alla superficie originale)
    d_ = np.hypot((xs_ - acx) / ahw, (zs_ - acz) / ahh)
    we = ss(1.35, 1.8, d_) * (1 - ss(2.8, 3.6, d_)) * (1 - ss(acz - 0.5 * ahh, acz + 0.1 * ahh, zs_))
    w_sm = np.maximum(w_sm, 0.7 * we * fr_)
if not CFG["beard"]:
    lat_ = np.abs(xs_ - XC) / MW
    lo_ = 0.5 + 0.38 * ss(MC[2] - 0.35 * MW, MC[2] - 0.05 * MW, zs_)          # vicino agli angoli: solo fuori dalle labbra
    wm = ss(lo_, lo_ + 0.15, lat_) * (1 - ss(1.55, 1.85, lat_)) * ss(MC[2] - 1.7 * MW, MC[2] - 1.3 * MW, zs_) * \
        (1 - ss(MC[2] + 0.25 * MW, MC[2] + 0.50 * MW, zs_)) * (ys_ < MC[1] + 1.0 * MW)
    w_sm = np.maximum(w_sm, 0.8 * wm)
PS2 = smooth_normal(PS, NS, w_sm, iters=40)
print("face smoothing: verts", int((w_sm > 0).sum()), "max move mm", round(1000 * float(np.abs(PS2 - PS).max()), 2))
me.vertices.foreach_set("co", PS2.astype(np.float32).ravel())
me.update()

# ---------------------------------------------------------------- texture v3: pelle, AO, sopracciglia, capelli
for _img in list(bpy.data.images):
    if _img.size[0] > 2048:
        _img.scale(2048, 2048)
_x_ear = 0.85 * float(np.percentile(np.abs(P_hi[(P_hi[:, 2] > MC[2]) & (P_hi[:, 2] < eye_z)][:, 0]), 97))
_POS, _VALID, _AO = GT.bake_maps(ob, size=2048)
_LM = {
    "eyes": {k: {"ac": EYES[k]["ac"], "ahw": EYES[k]["ahw"], "ahh": EYES[k]["ahh"], "C": EYES[k]["C"], "R": EYES[k]["R"]}
             for k in EYES},
    "MC": MC, "MW": MW, "eye_z": eye_z, "neck_z": J["neck_mid"][2] - 0.03, "XC": XC, "x_ear": _x_ear,
    "beard": CFG["beard"], "brow_rgb": CFG["brow_rgb"], "skin_target": CFG["skin_target"],
    "normal_img": next((l.from_node.image for n in me.materials[0].node_tree.nodes if n.type == "NORMAL_MAP"
                        for l in n.inputs["Color"].links if l.from_node.type == "TEX_IMAGE"), None)}
_BR = GT.improve(_hi, _POS, _VALID, None, _LM, analyze_only=True)
# sopracciglia: il vecchio blocco in rilievo si spiana sulla fronte. Impronta = la zona cancellata sulla texture,
# riportata sui vertici con le UV; dentro, membrana laplaciana (su 1-1.5 cm la fronte e' quasi piana: freccia < 0.4 mm)
_er = np.zeros((_hi.size[1], _hi.size[0]), np.float32)
for _b in _BR.values():
    _er = np.maximum(_er, _b["erase"])
_uv = np.empty(len(me.loops) * 2, np.float32); me.uv_layers[0].data.foreach_get("uv", _uv); _uv = _uv.reshape(-1, 2)
_lv = np.empty(len(me.loops), np.int32); me.loops.foreach_get("vertex_index", _lv)
_wv = np.zeros(len(me.vertices))
_TH_, _TW_ = _er.shape
np.maximum.at(_wv, _lv, _er[np.clip((_uv[:, 1] * _TH_).astype(int), 0, _TH_ - 1), np.clip((_uv[:, 0] * _TW_).astype(int), 0, _TW_ - 1)])
_ev = np.empty(len(me.edges) * 2, np.int32); me.edges.foreach_get("vertices", _ev); _ev = _ev.reshape(-1, 2)
_w2 = _wv.copy()
for _k in (0.9, 0.65, 0.35):                                             # tre anelli di raccordo
    _w1 = _w2.copy()
    np.maximum.at(_w2, _ev[:, 0], _k * _w1[_ev[:, 1]]); np.maximum.at(_w2, _ev[:, 1], _k * _w1[_ev[:, 0]])
PS = verts_np(me)
NS = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get("normal", NS); NS = NS.reshape(-1, 3).astype(np.float64)
# il blocco geometrico e' piu' grande della macchia dipinta: si liscia tutta la fascia del sopracciglio (riquadro
# morbido per occhio), tranne i capelli (vertici scuri fuori dall'impronta del sopracciglio)
_hairlike = (_vmax < 0.30) & (_wv < 0.05)
_wb = np.zeros(len(PS))
for e in EYES.values():
    acx, acz = e["ac"]; ahw, ahh = e["ahw"], e["ahh"]
    _near = np.abs(PS[:, 0] - acx) < 2.2 * ahw
    _fp = (_w2 > 0.3) & _near
    _ztop = float(np.percentile(PS[_fp, 2], 99)) + 0.5 * ahh if _fp.sum() > 10 else acz + 3.4 * ahh   # sopra il blocco vero
    _sg = 1.0 if acx > XC else -1.0
    _u = _sg * (PS[:, 0] - acx)                                  # verso la tempia; verso il naso fino alla linea mediana
    _bx = ((_u < 1.65 * ahw) & (_sg * (PS[:, 0] - XC) > -0.002) & (PS[:, 2] > acz + 1.1 * ahh) & (PS[:, 2] < _ztop) &
           (PS[:, 1] < e["C"][1] + 1.0 * e["R"]))
    # capelli esclusi solo verso la tempia (al centro le pareti scure sono del vecchio blocco, non capelli)
    _bx &= ~(_hairlike & (np.abs(PS[:, 0] - acx) > 1.3 * ahw))
    _wb = np.maximum(_wb, _bx.astype(np.float64))
    print("brow band: top above eye centre", round((_ztop - acz) / ahh, 2), "x eye half-height")
_wb = np.maximum(_wb, np.clip(_w2, 0, 1) * ~_hairlike)
PS2 = thin_plate_fill(PS, NS, (_wb > 0.3), alpha=0.3)
print("brow block flattened: verts", int((_wb > 0.05).sum()), "max move mm", round(1000 * float(np.abs(PS2 - PS).max()), 2))
me.vertices.foreach_set("co", PS2.astype(np.float32).ravel())
me.update()
# posizioni e AO cotte sulla forma nuova, poi la texture (sopracciglia disegnate sulla fronte gia' piana)
_POS, _VALID, _AO = GT.bake_maps(ob, size=2048)
_LM["brow_prior_Hh"] = float(np.mean([b["Hh"] for b in _BR.values()]))
GT.improve(_hi, _POS, _VALID, _AO, _LM)
del _POS, _VALID, _AO
sc.render.engine = "BLENDER_EEVEE"

# ---------------------------------------------------------------- materiali aggiuntivi
def flat_mat(name, rgb, rough, metal=0.0, coat=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if coat:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = 0.03
    return m


BASE = me.materials[0]
MAT = {"lid": flat_mat("lid_line", (0.016, 0.011, 0.009), 1.0),
       "mouth": flat_mat("mouth_in", (0.11, 0.028, 0.026), 0.7),
       "teeth": flat_mat("teeth", (0.694, 0.646, 0.546), 0.45),             # avorio #d9d2c3
       "lip_in": flat_mat("lip_in", (0.30, 0.10, 0.09), 0.5),
       "mouth_deep": flat_mat("mouth_deep", (0.018, 0.006, 0.006), 0.9),
       # bordo della palpebra inferiore: pelle in ombra, non un anello scuro attorno all'occhio
       "lid_low": flat_mat("lid_low", (0.30, 0.15, 0.12), 1.0),
       "tongue": flat_mat("tongue", (0.50, 0.15, 0.15), 0.5),
       # caruncola: il tessuto rosato e umido dell'angolo interno dell'occhio
       "caruncle": flat_mat("caruncle", (0.52, 0.22, 0.20), 0.4)}
MAT["mouth"].use_backface_culling = True
MAT["lid"].node_tree.nodes["Principled BSDF"].inputs["Specular IOR Level"].default_value = 0.0                  # la cavita' si vede solo dall'interno (come in three.js)
MAT["mouth_deep"].use_backface_culling = True
MAT["tongue"].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.30, 0.085, 0.08, 1)
for k in ("lid", "mouth", "teeth", "lip_in", "lid_low", "tongue", "mouth_deep", "caruncle"):
    me.materials.append(MAT[k])
MI = {"lid": 1, "mouth": 2, "teeth": 3, "lip_in": 4, "lid_low": 5, "tongue": 6, "mouth_deep": 7, "caruncle": 8}
MAT["lid_low"].node_tree.nodes["Principled BSDF"].inputs["Specular IOR Level"].default_value = 0.0

bm = bmesh.new(); bm.from_mesh(me)
FL = bm.verts.layers.int.new("flag")        # 1/2 bordo palpebra sup/inf, 3 piega, 4 ciglia, 11/12 labbro sup/inf,
                                            # 13/14 risvolto, 15/16 denti sup/inf, 17 cavita'
EL = bm.verts.layers.int.new("eye")         # 1 = sinistro, -1 = destro
bvh_lo = None

# ---------------------------------------------------------------- occhi: foro, bordo, piega, ciglia
for sfx, sgn in (("L", 1), ("R", -1)):
    E = EYES[sfx]
    poly, C, R = E["poly"], E["C"], E["R"]
    bm.faces.ensure_lookup_table()
    dele = []
    for f in bm.faces:
        c = f.calc_center_median()
        if c.y > C[1] or f.normal.y > 0.3:
            continue
        if inside_poly(np.array([[c.x, c.z]]), poly)[0]:
            dele.append(f)
    bmesh.ops.delete(bm, geom=dele, context="FACES")
    # bordo: spigoli di contorno vicini all'occhio
    rim_e = [e for e in bm.edges if e.is_boundary and
             all(abs(v.co.x - E["ac"][0]) < 1.4 * E["ahw"] and abs(v.co.z - E["ac"][1]) < 1.8 * E["ahh"] for v in e.verts)]
    rim_v = list({v for e in rim_e for v in e.verts})
    # aggancio al contorno trovato sulla texture e alla superficie originale
    for v in rim_v:
        q = nearest_on_poly(np.array([v.co.x, v.co.z]), poly)
        h = front_hit(q[0], q[1])
        v.co = Vector((q[0], h[1] if h is not None else v.co.y, q[1]))
    # bulbo adattato al bordo della palpebra: centro sull'asse dello sguardo (x, z fissi), profondita' e raggio dal bordo
    rp = np.array([list(v.co) for v in rim_v])
    q_ = (rp[:, 0] - C[0]) ** 2 + (rp[:, 2] - C[2]) ** 2
    Am = np.c_[-2 * rp[:, 1], np.ones(len(rp))]
    sol_ = np.linalg.lstsq(Am, -(rp[:, 1] ** 2 + q_), rcond=None)[0]
    cy_, b_ = float(sol_[0]), float(sol_[1])
    R_fit = math.sqrt(max(cy_ * cy_ - b_, 1e-8))
    if 0.95 * E["ahw"] < R_fit < 1.6 * E["ahw"] and cy_ > float(rp[:, 1].mean()):
        C = np.array([C[0], cy_, C[2]]); R = R_fit
    else:
        R = 1.2 * E["ahw"]
        dd_ = np.sqrt(np.maximum(R * R - q_, 1e-8))
        C = np.array([C[0], float(np.median(rp[:, 1] + dd_)), C[2]])
    E["C"] = C; E["R"] = R
    print(sfx, "eyeball fitted to the lid rim: R", round(R, 4), "C", C.round(4))
    # il bordo della palpebra si appoggia sul bulbo (spostato lungo lo sguardo), la pelle vicina segue sfumando
    LID_GAP = 0.0004
    delta = {}
    skipped = []
    for v in rim_v:
        dx, dz = v.co.x - C[0], v.co.z - C[2]
        q = (R + LID_GAP) ** 2 - dx * dx - dz * dz
        if q <= 0:
            skipped.append(v)
            continue
        ny = C[1] - math.sqrt(q)
        dv = float(np.clip(ny - v.co.y, -0.006, 0.006))     # il bordo poggia sul bulbo: niente fessure
        delta[v] = dv
        v.co.y += dv
    # angoli oltre la sagoma del bulbo: profondita' dei vicini adattati (prima restava quella del modello: un cuneo)
    if skipped and delta:
        okv = list(delta.keys())
        okp = np.array([[v.co.x, v.co.z] for v in okv]); oky = np.array([v.co.y for v in okv])
        for v in skipped:
            d2 = np.hypot(okp[:, 0] - v.co.x, okp[:, 1] - v.co.z)
            nn = np.argsort(d2)[:3]
            ny = float(np.average(oky[nn], weights=1.0 / np.maximum(d2[nn], 1e-5)))
            dv = float(np.clip(ny - v.co.y, -0.006, 0.006))
            delta[v] = dv
            v.co.y += dv
        print(sfx, "rim corners outside the eyeball outline:", len(skipped))
    ring1 = {}
    for v, dv in delta.items():
        for e in v.link_edges:
            w = e.other_vert(v)
            if w not in delta and not w.is_boundary:
                ring1.setdefault(w, []).append(dv)
    ring2 = {}
    for w, dl in ring1.items():
        w.co.y += 0.62 * float(np.mean(dl))
        for e in w.link_edges:
            u = e.other_vert(w)
            if u not in delta and u not in ring1 and not u.is_boundary:
                ring2.setdefault(u, []).append(float(np.mean(dl)))
    ring3 = {}
    for u, dl in ring2.items():
        u.co.y += 0.32 * float(np.mean(dl))
        for e in u.link_edges:
            t3 = e.other_vert(u)
            if t3 not in delta and t3 not in ring1 and t3 not in ring2 and not t3.is_boundary:
                ring3.setdefault(t3, []).append(float(np.mean(dl)))
    for t3, dl in ring3.items():
        t3.co.y += 0.12 * float(np.mean(dl))
    print(sfx, "lid conform: max move mm", round(1000 * max((abs(d) for d in delta.values()), default=0), 2))
    # sopra/sotto: rispetto alla corda fra gli angoli dell'occhio
    xs = poly[:, 0]
    c_in, c_out = poly[np.argmin(sgn * xs)], poly[np.argmax(sgn * xs)]

    def chord_z(x):
        return np.interp(x, sorted([c_in[0], c_out[0]]), [c_in[1], c_out[1]] if c_in[0] < c_out[0] else [c_out[1], c_in[1]])
    for v in rim_v:
        v[FL] = 1 if v.co.z > chord_z(v.co.x) else 2
        v[EL] = sgn
    # piega verso l'interno, dietro la superficie del bulbo
    ret = bmesh.ops.extrude_edge_only(bm, edges=rim_e)
    for g in ret["geom"]:
        if isinstance(g, bmesh.types.BMVert):
            d = np.array(g.co) - C
            g.co = Vector(C + d / np.linalg.norm(d) * (R - 0.0012))      # piega corta: rientra subito sotto il bulbo
            g[FL] = 3; g[EL] = sgn
        elif isinstance(g, bmesh.types.BMFace):
            low_ = any(v[FL] == 2 for v in g.verts)
            g.material_index = MI["lid_low"] if low_ else MI["lid"]; g.smooth = True
    # ciglia: striscia scura sopra il bordo superiore (e sottile sotto quello inferiore)
    rv = sorted([v for v in rim_v if v[FL] == 1], key=lambda v: v.co.x)
    if len(rv) >= 5:
        pr = np.array([list(v.co) for v in rv])
        k_ = 3                                               # media mobile: niente frange
        prs = np.array([pr[max(0, i - k_):i + k_ + 1].mean(0) for i in range(len(pr))])
        prs[0], prs[-1] = pr[0], pr[-1]
        _span = prs[-1, 0] - prs[0, 0]                        # le ciglia non arrivano fino agli angoli (sporgevano a cuneo)
        xq = np.linspace(prs[0, 0] + 0.06 * _span, prs[-1, 0] - 0.06 * _span, 26)
        cur = np.stack([xq, np.interp(xq, prs[:, 0], prs[:, 1]), np.interp(xq, prs[:, 0], prs[:, 2])], 1)
        inner, outer = [], []
        for i, p_ in enumerate(cur):
            t = i / (len(cur) - 1)
            tt = t if sgn > 0 else 1 - t                      # 0 = angolo interno, 1 = esterno
            w = 0.085 * E["ahh"] * (math.sin(math.pi * min(max(tt, 0.03), 0.97)) ** 0.75) * (1 + 0.45 * tt)
            nrm = (p_ - C) / np.linalg.norm(p_ - C)
            upv = np.array([0, 0, 1.0]) - nrm * nrm[2]; upv /= np.linalg.norm(upv)
            a = bm.verts.new(Vector(p_ + nrm * 0.0004))
            b = bm.verts.new(Vector(p_ + upv * w + nrm * (0.0004 + 0.25 * w)))
            a[FL] = 4; b[FL] = 4; a[EL] = sgn; b[EL] = sgn
            inner.append(a); outer.append(b)
        for i in range(len(cur) - 1):
            f = bm.faces.new((inner[i], inner[i + 1], outer[i + 1], outer[i]))
            f.material_index = MI["lid"]; f.smooth = True
            if f.normal.y > 0:
                f.normal_flip()
    # caruncola sull'angolo interno: appoggiata al bulbo, copre la fessura fra piega e bulbo (i puntini chiari)
    dx_, dz_ = c_in[0] - C[0], c_in[1] - C[2]
    q_ = R * R - dx_ * dx_ - dz_ * dz_
    ps_ = np.array([c_in[0], C[1] - math.sqrt(max(q_, 1e-8)), c_in[1]])
    nrm_ = (ps_ - C) / np.linalg.norm(ps_ - C)
    inw_ = np.array([C[0] - c_in[0], 0.0, 0.0]); inw_ -= nrm_ * (inw_ @ nrm_); inw_ /= np.linalg.norm(inw_)
    ver_ = np.cross(nrm_, inw_); ver_ /= np.linalg.norm(ver_)
    cc_ = C + nrm_ * (R + 0.0003) + inw_ * (0.12 * E["ahw"])
    ret_ = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0)
    for v in ret_["verts"]:
        lx, ly, lz = v.co
        v.co = Vector(cc_ + inw_ * (lx * 0.11 * E["ahw"]) + ver_ * (ly * 0.17 * E["ahh"]) + nrm_ * (lz * 0.0008))
        v[FL] = 19; v[EL] = sgn
    for f in {f for v in ret_["verts"] for f in v.link_faces}:
        f.material_index = MI["caruncle"]; f.smooth = True
    print(sfx, "rim verts", len(rim_v), "eyeball R", round(R, 4))
# ogni bulbo segue il proprio bordo (con il raggio comune il bulbo piu' piccolo lascerebbe vedere la piega scura);
# l'iride ha la stessa misura assoluta nei due occhi

# ---------------------------------------------------------------- attorno agli occhi: pelle liscia che abbraccia il bulbo
# l'adattamento del bordo al bulbo e la decimazione lasciano pieghe stropicciate sulle palpebre: smussatura di Taubin
# con il bordo, la piega e le ciglia fermi; poi niente deve entrare nel bulbo
for sfx in ("L", "R"):
    E = EYES[sfx]; acx, acz = E["ac"]; ahw, ahh = E["ahw"], E["ahh"]
    C, R = E["C"], E["R"]
    reg = {}
    for v in bm.verts:
        if v[FL] != 0 or v.is_boundary or v.co.y > C[1] + 0.6 * R:
            continue
        d = math.hypot((v.co.x - acx) / ahw, (v.co.z - acz) / ahh)
        if d < 2.7:
            reg[v] = float(1 - ss(1.9, 2.7, d))
    vs_ = list(reg)
    nb_ = [[e.other_vert(v) for e in v.link_edges] for v in vs_]
    w_ = np.array([reg[v] for v in vs_])
    for _ in range(20):
        for f_ in (0.5,):
            cur = np.array([list(v.co) for v in vs_])
            avg = np.array([np.mean([list(u.co) for u in nb], 0) for nb in nb_])
            new = cur + f_ * w_[:, None] * (avg - cur)
            for v, p_ in zip(vs_, new):
                v.co = Vector(p_)
    pushed = 0
    for v in vs_:
        dv = np.array(v.co) - C
        r_ = np.linalg.norm(dv)
        if r_ < R + 0.0008:
            v.co = Vector(C + dv / r_ * (R + 0.0008)); pushed += 1
    print(sfx, "eye surroundings smoothed: verts", len(vs_), "pushed out of the eyeball", pushed)

# ---------------------------------------------------------------- bocca: taglio lungo la linea delle labbra
bm.verts.ensure_lookup_table(); bm.edges.ensure_lookup_table()
zone = [v for v in bm.verts if abs(v.co.x - MC[0]) < 1.3 * MW and abs(v.co.z - MC[2]) < 0.6 * MW
        and v.co.y < MC[1] + 0.3 * MW and v.normal.y < 0]
zset = set(zone)


def line_dist(p):
    return abs(p.z - lip_z_at(p.x))


xl, xr = XC - 0.90 * hw_l, XC + 0.90 * hw_l            # il taglio si ferma prima degli angoli: niente tacche
start = min(zone, key=lambda v: (v.co.x - xl) ** 2 + (v.co.z - lip_z_at(xl)) ** 2 + (v.co.y - MC[1]) ** 2 * 0.2)
goal = min(zone, key=lambda v: (v.co.x - xr) ** 2 + (v.co.z - lip_z_at(xr)) ** 2 + (v.co.y - MC[1]) ** 2 * 0.2)
dist = {start: 0.0}; prev = {}
pq = [(0.0, start.index, start)]
done = set()
while pq:
    d, _, v = heapq.heappop(pq)
    if v in done:
        continue
    done.add(v)
    if v == goal:
        break
    for e in v.link_edges:
        w = e.other_vert(v)
        if w not in zset or w in done:
            continue
        mid = (v.co + w.co) / 2
        cost = e.calc_length() * (1 + (line_dist(mid) / (0.025 * MW)) ** 2)
        nd = d + cost
        if nd < dist.get(w, 1e9):
            dist[w] = nd; prev[w] = (v, e); heapq.heappush(pq, (nd, w.index, w))
path_e, path_v = [], [goal]
v = goal
while v != start:
    v, e = prev[v]
    path_e.append(e); path_v.append(v)
for v in path_v:
    h = front_hit(v.co.x, lip_z_at(v.co.x))
    if h is not None and abs(v.co.x - xl) > 1e-4 and abs(v.co.x - xr) > 1e-4:
        v.co = Vector(h)
path_key = {(round(v.co.x, 6), round(v.co.y, 6), round(v.co.z, 6)) for v in path_v}
CORN = np.array([list(start.co), list(goal.co)])           # angoli della bocca (restano uniti)
bmesh.ops.split_edges(bm, edges=path_e)
bm.verts.ensure_lookup_table()
rim_up, rim_lo = [], []
groups = {}
for v in bm.verts:
    kk = (round(v.co.x, 6), round(v.co.y, 6), round(v.co.z, 6))
    if v.is_boundary and kk in path_key:
        groups.setdefault(kk, []).append(v)
for kk, vs in groups.items():
    if len(vs) != 2:                                     # angoli della bocca: restano uniti
        continue
    zc = [np.mean([f.calc_center_median().z for f in v.link_faces]) for v in vs]
    up_, lo_ = (vs[0], vs[1]) if zc[0] > zc[1] else (vs[1], vs[0])
    up_[FL] = 11; rim_up.append(up_)
    lo_[FL] = 12; rim_lo.append(lo_)
print("mouth path", len(path_e), "rims", len(rim_up), len(rim_lo))
# risvolto interno
for rim, flag, dz in ((rim_up, 13, 0.02), (rim_lo, 14, -0.02)):
    rs = set(rim)
    edges = list({e for v in rim for e in v.link_edges if e.is_boundary and all(w in rs for w in e.verts)
                  and all(abs(w.co.x - MC[0]) < 0.8 * MW for w in e.verts)})      # niente risvolto agli angoli
    if not edges:
        continue
    ret = bmesh.ops.extrude_edge_only(bm, edges=edges)
    for g in ret["geom"]:
        if isinstance(g, bmesh.types.BMVert):
            fade = max(0.3, 1 - (abs(g.co.x - MC[0]) / MW) ** 4)
            g.co = Vector((MC[0] + (g.co.x - MC[0]) * (1 - 0.05 * fade), g.co.y + 0.13 * MW * fade, g.co.z + dz * MW * fade))
            g[FL] = flag
        elif isinstance(g, bmesh.types.BMFace):
            g.smooth = True
            g.material_index = MI["lip_in"]


# interno: cavita' e arcate dentali (dentro la testa, dietro le labbra)
def ellipsoid(cx, cy, cz, rx, ry, rz, flag, mat, inward=True):
    res = bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=1.0)
    for v in res["verts"]:
        x, y, z = v.co
        v.co = Vector((cx + x * rx, cy + y * ry, cz + z * rz)); v[FL] = flag
    fs = list({f for v in res["verts"] for f in v.link_faces})
    for f in fs:
        f.material_index = mat; f.smooth = True
    if inward:
        bmesh.ops.reverse_faces(bm, faces=fs)


def arc_band(flag, z_top, z_bot, inset, half_w, n=30, thick=0.07):
    """arcata che segue la superficie del volto con un rientro costante: resta sempre dentro la testa"""
    rows = []
    yf = []
    for i in range(n + 1):
        x = -half_w + 2 * half_w * i / n
        hs = [front_hit(MC[0] + x, zz) for zz in (z_top, 0.5 * (z_top + z_bot), z_bot)]
        yf.append(max(h[1] for h in hs if h is not None) + inset)
    for kind, dy in (("top", 0.0), ("edge", 0.0), ("bot", 0.35 * thick * MW), ("edge", thick * MW), ("top", thick * MW)):
        row = []
        for i in range(n + 1):
            x = -half_w + 2 * half_w * i / n
            q = (abs(x) / half_w) ** 2
            y = yf[i] + dy + 0.10 * MW * (abs(x) / half_w) ** 3      # le estremita' piegano indietro
            # il bordo che si vede segue la curva del sorriso (sopra sale ai lati, sotto scende): niente gradini
            zt = z_top if flag == 15 else z_top - 0.5 * (z_top - z_bot) * q
            zb = z_bot + 0.5 * (z_top - z_bot) * q if flag == 15 else z_bot
            zz = {"top": zt, "bot": zb, "edge": zb + 0.12 * (zt - zb)}[kind] if flag == 15 else                 {"top": zb, "bot": zt, "edge": zt - 0.12 * (zt - zb)}[kind]
            v = bm.verts.new(Vector((MC[0] + x, y, zz))); v[FL] = flag
            row.append(v)
        rows.append(row)
    for a in range(len(rows)):
        A_, B_ = rows[a], rows[(a + 1) % len(rows)]
        for i in range(n):
            f = bm.faces.new((A_[i], A_[i + 1], B_[i + 1], B_[i]))
            f.material_index = MI["teeth"]; f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=list({f for r in rows for v in r for f in v.link_faces}))


ellipsoid(MC[0], MC[1] + 0.62 * MW, MC[2] - 0.05 * MW, 0.92 * MW, 0.55 * MW, 0.52 * MW, 17, MI["mouth"])
for f in bm.faces:                                         # in fondo, verso la gola, quasi nero
    if f.material_index == MI["mouth"] and f.calc_center_median().y > MC[1] + 0.50 * MW:
        f.material_index = MI["mouth_deep"]
ellipsoid(MC[0], MC[1] + 0.58 * MW, MC[2] - 0.34 * MW, 0.48 * MW, 0.40 * MW, 0.12 * MW, 18, MI["tongue"], inward=False)
arc_band(15, MC[2] + 0.30 * MW, MC[2] - 0.035 * MW, 0.22 * MW, 0.46 * MW)
arc_band(16, MC[2] - 0.06 * MW, MC[2] - 0.30 * MW, 0.31 * MW, 0.40 * MW)

# tutto l'interno della bocca resta dentro la testa (la superficie generata e' chiusa): raggi in tre direzioni
def inside_depth(p):
    dmin = 1e9
    for d in (Vector((0, -1, 0)), Vector((0, 0, -1)), Vector((math.copysign(1, p.x - MC[0]), 0, 0))):
        loc, n, i, dist = BVH_HI.ray_cast(p, d)
        if loc is None or n.dot(d) <= 0:
            return -1.0
        dmin = min(dmin, dist)
    return dmin


SAFE = Vector((MC[0], MC[1] + 0.95 * MW, MC[2] - 0.05 * MW))
moved = 0
for v in bm.verts:
    fl = v[FL]
    if fl not in (13, 14, 17, 18):
        continue
    margin = 0.0008 if fl in (13, 14) else 0.004
    if inside_depth(v.co) >= margin:
        continue
    a, b = 0.0, 1.0                                      # 0 = punto, 1 = centro sicuro
    p0 = v.co.copy()
    for _ in range(18):
        mid = 0.5 * (a + b)
        if inside_depth(p0.lerp(SAFE, mid)) >= margin:
            b = mid
        else:
            a = mid
    v.co = p0.lerp(SAFE, b); moved += 1
print("mouth interior verts pulled inside", moved, "safe depth", round(inside_depth(SAFE), 4))

bm.to_mesh(me); bm.free()
me.update()
print("tris after face work", tri_count())

# ---------------------------------------------------------------- bulbi oculari
BASE_IMG = [n.image for n in BASE.node_tree.nodes if n.type == "TEX_IMAGE" and
            any(l.to_socket.name == "Base Color" for l in n.outputs[0].links)][0]
_BW, _BH = BASE_IMG.size
_BTEX = np.empty(_BW * _BH * 4, np.float32); BASE_IMG.pixels.foreach_get(_BTEX); _BTEX = _BTEX.reshape(_BH, _BW, 4)
UVL_HI = bm_hi.loops.layers.uv.active
bm_hi.faces.ensure_lookup_table()


IRIS_SCALE = 1.08


def projected_eye(E, size):
    """colori dell'occhio generato visti di fronte, nel sistema UV planare del bulbo (None fuori dall'occhio)"""
    from mathutils.geometry import barycentric_transform  # noqa: F401
    C, R = E["C"], E["R"]
    out = np.zeros((size, size, 3), np.float32); ok = np.zeros((size, size), bool)
    poly = E["poly"]
    g = (np.arange(size) + 0.5) / size - 0.5
    XX = C[0] + g[None, :] * 2 * R / 0.98 / IRIS_SCALE + 0 * g[:, None]
    ZZ = C[2] + g[:, None] * 2 * R / 0.98 / IRIS_SCALE + 0 * g[None, :]
    ins = inside_poly(np.stack([XX.ravel(), ZZ.ravel()], 1), poly).reshape(size, size)
    ox_, oz_ = E["iris_c"][0] - C[0], E["iris_c"][1] - C[2]
    ins = inside_poly(np.stack([XX.ravel() + ox_, ZZ.ravel() + oz_], 1), poly).reshape(size, size)
    for j, i in zip(*np.nonzero(ins)):
        xx, zz = float(XX[j, i]) + ox_, float(ZZ[j, i]) + oz_
        if True:
            loc, nrm, fi, dist = BVH_HI.ray_cast(Vector((xx, C[1] - 3 * R, zz)), Vector((0, 1, 0)))
            if loc is None:
                continue
            f = bm_hi.faces[fi]
            vs = [l.vert.co for l in f.loops[:3]]
            uvs = [l[UVL_HI].uv for l in f.loops[:3]]
            w = _bary(loc, *vs)
            uu = w[0] * uvs[0].x + w[1] * uvs[1].x + w[2] * uvs[2].x
            vv = w[0] * uvs[0].y + w[1] * uvs[1].y + w[2] * uvs[2].y
            out[j, i] = _BTEX[min(int(vv * _BH), _BH - 1), min(int(uu * _BW), _BW - 1), :3]
            ok[j, i] = True
    return out, ok


def _bary(p, a, b, c):
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11 = v0.dot(v0), v0.dot(v1), v1.dot(v1)
    d20, d21 = v2.dot(v0), v2.dot(v1)
    den = d00 * d11 - d01 * d01
    if abs(den) < 1e-18:
        return (1.0, 0.0, 0.0)
    v_ = (d11 * d20 - d01 * d21) / den; w_ = (d00 * d21 - d01 * d20) / den
    return (1 - v_ - w_, v_, w_)


def eye_image(name, E, size=512):
    yy, xx = np.mgrid[0:size, 0:size]
    u = (xx + 0.5) / size - 0.5; v = (yy + 0.5) / size - 0.5
    # iride procedurale centrata dove era l'iride del disegno
    ou = 0.0; ov = 0.0                                  # iride al polo: a riposo lo sguardo e' dritto (+Z glTF)
    u = u - ou; v = v - ov
    r = np.hypot(u, v) * 2 / 0.98                         # 1 = raggio del bulbo (proiezione frontale)
    ang = np.arctan2(v, u)
    RI = min(E["iris_r"] * IRIS_SCALE / E["R"], 0.80); RP = 0.40 * RI
    lin = lambda c: np.where(np.array(c) <= 0.04045, np.array(c) / 12.92, ((np.array(c) + 0.055) / 1.055) ** 2.4)
    ic = np.array(E["iris_rgb"])
    sclera = lin((0.88, 0.855, 0.825))
    col = np.broadcast_to(sclera, (size, size, 3)).copy()
    col *= (1 - 0.24 * ss(RI * 1.05, 0.95, r))[..., None]          # bianco che si scurisce verso i bordi
    col = col * (1 - 0.15 * ss(RI * 1.1, 0.95, r))[..., None] + lin((0.85, 0.62, 0.58)) * (0.15 * ss(RI * 1.1, 0.95, r))[..., None]
    inner = lin(np.clip(ic * 1.3, 0, 1)); outer = lin(ic * 0.55)
    t = np.clip((r - RP) / max(RI - RP, 1e-3), 0, 1)
    fib = 0.5 + 0.5 * np.sin(ang * 64 + 2.0 * np.sin(ang * 7))          # fibre radiali regolari, pulite
    fib2 = 0.5 + 0.5 * np.sin(ang * 23 + 1.3)
    iris = inner * (1 - t[..., None] ** 0.8) + outer * (t[..., None] ** 0.8)
    coll = np.exp(-((t - 0.28) / 0.10) ** 2)[..., None] * 0.25          # collaretto piu' chiaro attorno alla pupilla
    iris = iris * (0.90 + 0.12 * fib + 0.06 * fib2)[..., None] + lin(np.clip(ic * 1.7, 0, 1)) * coll * 0.6
    mi = ss(RI + 0.012, RI - 0.012, r)[..., None]
    col = col * (1 - mi) + iris * mi
    ring = np.exp(-((r - RI + 0.02) / 0.025) ** 2)[..., None] * 0.85
    col = col * (1 - ring) + lin(ic * 0.18) * ring
    pm = ss(RP + 0.01, RP - 0.01, r)[..., None]
    col = col * (1 - pm) + np.array([0.003, 0.003, 0.003]) * pm
    # ombra della palpebra superiore sul bulbo (dall'alto), un velo morbido
    vz = (v + ov) * 2 / 0.98
    col = col * (1 - 0.32 * ss(0.30 * RI, 0.85 * RI + 0.25, vz))[..., None]
    srgb = np.where(col <= 0.0031308, col * 12.92, 1.055 * np.power(np.clip(col, 0, None), 1 / 2.4) - 0.055)
    E["_orm_rough"] = np.where(r < RI * 1.05, 0.14, 0.45)           # cornea lucida, sclera quasi opaca
    if not E.get("project", False):
        img = bpy.data.images.new(name, size, size, alpha=False)
        rgba = np.concatenate([srgb, np.ones((size, size, 1))], 2).astype(np.float32)
        img.pixels.foreach_set(rgba.ravel())
        img.pack()
        return img
    pc, pok = projected_eye(E, size)
    Vp = pc.max(-1); Sp = (Vp - pc.min(-1)) / np.maximum(Vp, 1e-4)
    in_iris = r < RI * 0.98
    glint = (Vp > 0.62) & (Sp < 0.35)                      # riflesso dipinto e il suo alone chiaro
    _vin = Vp[pok & in_iris]
    if _vin.size:
        glint |= in_iris & pok & (Vp > np.median(_vin) + 0.22)   # puntini chiari dell'alone, anche colorati
    lid_shadow = (r > RP * 1.25) & (Vp < 0.16) & (Sp < 0.45)   # ombra/contorno della palpebra sopra l'iride
    for _ in range(3):                                   # anche l'alone colorato attorno al riflesso
        glint = glint | np.roll(glint, 1, 0) | np.roll(glint, -1, 0) | np.roll(glint, 1, 1) | np.roll(glint, -1, 1)
    use = pok & in_iris & ~glint & ~lid_shadow
    # pulizia: niente pixel isolati (chiusura e apertura 3x3)
    def _dil(m):
        return m | np.roll(m, 1, 0) | np.roll(m, -1, 0) | np.roll(m, 1, 1) | np.roll(m, -1, 1)

    def _ero(m):
        return m & np.roll(m, 1, 0) & np.roll(m, -1, 0) & np.roll(m, 1, 1) & np.roll(m, -1, 1)
    use = _ero(_ero(_dil(_dil(use)))) & pok & in_iris        # chiusura: riempie i buchi piccoli
    use = _dil(_dil(_ero(_ero(use)))) & use                  # apertura: toglie le isole piccole
    # bordo morbido fra proiezione e procedurale
    um = use.astype(np.float32)
    for _ in range(4):
        um = 0.2 * (um + np.roll(um, 1, 0) + np.roll(um, -1, 0) + np.roll(um, 1, 1) + np.roll(um, -1, 1))
    um = np.where(use, um, 0.0)[..., None]
    srgb = srgb * (1 - um) + pc * um
    img = bpy.data.images.new(name, size, size, alpha=False)
    rgba = np.concatenate([srgb, np.ones((size, size, 1))], 2).astype(np.float32)
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


eyes_obj = {}
for sfx in ("L", "R"):
    E = EYES[sfx]
    R = E["R"]
    m = bpy.data.materials.new(f"eye_{sfx}")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    E["iris_c"] = face["eyes"][sfx]["iris_c"]
    tx = nt.nodes.new("ShaderNodeTexImage"); tx.image = eye_image(f"{NAME}_eye_{sfx}", E)
    nt.links.new(tx.outputs[0], bsdf.inputs["Base Color"])
    # rugosita' da texture (glTF metallicRoughness): cornea lucida, sclera quasi opaca; niente coat (riflesso duro)
    _sz = tx.image.size[0]
    _orm = np.zeros((_sz, _sz, 4), np.float32); _orm[..., 0] = 1.0; _orm[..., 1] = E["_orm_rough"]; _orm[..., 3] = 1.0
    _oi = bpy.data.images.new(f"{NAME}_eye_{sfx}_orm", _sz, _sz, alpha=False)
    _oi.pixels.foreach_set(_orm.ravel()); _oi.colorspace_settings.name = "Non-Color"; _oi.pack()
    tx2 = nt.nodes.new("ShaderNodeTexImage"); tx2.image = _oi
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tx2.outputs[0], sep.inputs[0]); nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    bsdf.inputs["Coat Weight"].default_value = 0.0
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=24, radius=R)
    for v in bm.verts:
        x, y, z = v.co
        v.co = Vector((x, -z, y))
    RI = E["iris_r"] * IRIS_SCALE
    icx, icz = 0.0, 0.0
    # niente cupola della cornea: sporgerebbe dalla palpebra chiusa (il riflesso lo da' la mappa di rugosita')
    em = bpy.data.meshes.new(f"eye.{sfx}")
    bm.to_mesh(em); bm.free()
    uvl = em.uv_layers.new(name="UVMap")
    for lp in em.loops:
        co = em.vertices[lp.vertex_index].co
        uvl.data[lp.index].uv = (0.5 + co.x / (2 * R) * 0.98, 0.5 + co.z / (2 * R) * 0.98)
    for p in em.polygons:
        p.use_smooth = True
    em.materials.append(m)
    eo = bpy.data.objects.new(f"{NAME}_eye.{sfx}", em)
    eo.location = Vector(E["C"])
    sc.collection.objects.link(eo)
    eyes_obj[sfx] = eo
bm_hi.free()

# ---------------------------------------------------------------- scheletro
s_head = 2 * MW / 0.05                                      # scala del volto rispetto a una bocca reale di 5 cm
pivot = np.array([0.0, J["neck_mid"][1] + 0.15 * (y_back - J["neck_mid"][1]), MC[2] - 0.05 * (eye_z - MC[2])])
bones = {
    "spine": (J["hips"], J["chest"], None),
    "chest": (J["chest"], J["neck0"], "spine"),
    "neck": (J["neck0"], pivot, "chest"),
    "head": (pivot, pivot + np.array([0, 0, 0.19 * s_head]), "neck"),
    "eye.L": (EYES["L"]["C"], EYES["L"]["C"] + np.array([0, -0.6 * EYES["L"]["R"], 0]), "head"),
    "eye.R": (EYES["R"]["C"], EYES["R"]["C"] + np.array([0, -0.6 * EYES["R"]["R"], 0]), "head"),
    "jaw": (TMJ, chin, "head"),
}
for s, sfx in ((1, "L"), (-1, "R")):
    sh = J[f"shoulder.{sfx}"]
    clav = np.array([s * 0.18 * abs(sh[0]), sh[1] - 0.02, J["neck0"][2] - 0.01])
    bones[f"shoulder.{sfx}"] = (clav, sh, "chest")
    bones[f"upper_arm.{sfx}"] = (sh, J[f"elbow.{sfx}"], f"shoulder.{sfx}")
    bones[f"forearm.{sfx}"] = (J[f"elbow.{sfx}"], J[f"wrist.{sfx}"], f"upper_arm.{sfx}")
    bones[f"hand.{sfx}"] = (J[f"wrist.{sfx}"], J[f"mcp.{sfx}"], f"forearm.{sfx}")
ad = bpy.data.armatures.new(NAME + "_rig")
arm = bpy.data.objects.new(NAME + "_rig", ad)
sc.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
for o in bpy.context.view_layer.objects:
    o.select_set(o == arm)
bpy.ops.object.mode_set(mode="EDIT")
for nm, (h, t, par) in bones.items():
    eb = ad.edit_bones.new(nm)
    eb.head = Vector(h); eb.tail = Vector(t)
    if nm.startswith(("eye", "spine", "chest", "neck", "head", "jaw")):
        eb.roll = 0.0
    else:
        eb.align_roll(Vector((0, -1, 0)))
for nm, (h, t, par) in bones.items():
    if par:
        ad.edit_bones[nm].parent = ad.edit_bones[par]
        ad.edit_bones[nm].use_connect = False
# dita: l'asse Z locale e' il dorso, la flessione e' attorno a X
for nm, (h, t, up) in FBONES.items():
    eb = ad.edit_bones.new(nm)
    eb.head = Vector(h); eb.tail = Vector(t)
    eb.align_roll(Vector(up))
for nm in FBONES:
    f_, k_, sd_ = nm.split(".")
    par = f"hand.{sd_}" if k_ == "01" else f"{f_}.0{int(k_) - 1}.{sd_}"
    ad.edit_bones[nm].parent = ad.edit_bones[par]
    ad.edit_bones[nm].use_connect = False
bpy.ops.object.mode_set(mode="OBJECT")
for pb in arm.pose.bones:
    pb.rotation_mode = "QUATERNION"
segs = {k: (Vector(v[0]), Vector(v[1])) for k, v in bones.items()}

# ---------------------------------------------------------------- pesi
P = verts_np(me)
FLAG = np.array([a.value for a in me.attributes["flag"].data], np.int32)
EYEA = np.array([a.value for a in me.attributes["eye"].data], np.int32)
# il modello generato e' fatto di molti pezzi (bottoni, colletto, cintura...): niente pesi "a calore".
# Busto e braccia si separano col vuoto sotto l'ascella; sopra, la spalla sfuma fra i due.
names = list(bones.keys())
heat_ok = False
W = np.zeros((len(P), len(names)))
dia_s = float(body["arm"]["L"]["dia"]) * float(body["scale"])
torso_n = ["spine", "chest", "neck", "shoulder.L", "shoulder.R"]
Wt = RG.dist_weights(P, segs, torso_n, power=3.0, eps=0.02)
armness = np.zeros(len(P))
for s, sfx in ((1, "L"), (-1, "R")):
    sh = J[f"shoulder.{sfx}"]
    armpit_s = (float(body["arm"][sfx]["armpit_z"]) - float(body["crotch_z"])) * float(body["scale"])
    # posizione del vuoto braccio-busto fetta per fetta
    zs_g = np.linspace(J[f"wrist.{sfx}"][2], armpit_s, 40)
    gx = []
    for zz in zs_g:
        sl = P[(np.abs(P[:, 2] - zz) < 0.004) & (s * P[:, 0] > 0.3 * abs(sh[0]))]
        xs_ = np.sort(s * sl[:, 0])
        g_ = np.diff(xs_)
        k_ = np.argmax(g_) if len(g_) else 0
        gx.append(0.5 * (xs_[k_] + xs_[k_ + 1]) if len(g_) and g_[k_] > 0.004 else np.nan)
    gx = np.array(gx)
    ok_ = ~np.isnan(gx)
    gx_at = lambda zz: np.interp(zz, zs_g[ok_], gx[ok_])
    below = P[:, 2] < armpit_s
    a_below = ss(-0.06 * dia_s, 0.06 * dia_s, s * P[:, 0] - gx_at(np.minimum(P[:, 2], armpit_s)))
    a_cap = ss(abs(sh[0]) - 0.65 * dia_s, abs(sh[0]) - 0.05 * dia_s, s * P[:, 0]) * \
        (1 - ss(sh[2] + 0.15 * dia_s, sh[2] + 0.65 * dia_s, P[:, 2]))
    a = np.where(below, a_below, a_cap) * (s * P[:, 0] > 0)
    # oltre il taglio della manica resta solo il fianco (la mano pendeva li' accanto): niente pesi del braccio
    s_w = (P - ARMF[sfx]["wrist"]) @ ARMF[sfx]["af"]
    a = a * (s_w < (_cuff_end - _cuff_H) + 0.012)
    armness = np.maximum(armness, a)
    an = [f"shoulder.{sfx}", f"upper_arm.{sfx}", f"forearm.{sfx}"]
    Wa = RG.dist_weights(P, segs, an, power=4.0, eps=0.006)
    side_m = (s * P[:, 0] > 0)
    for j, n in enumerate(an):
        W[side_m, names.index(n)] += (a * Wa[:, j])[side_m]
for j, n in enumerate(torso_n):
    W[:, names.index(n)] += (1 - armness) * Wt[:, j]
print("armness: verts on arms", int((armness > 0.5).sum()))
# pesi levigati lungo la mesh: braccio e busto si raccordano senza triangoli strappati sotto l'ascella
EVw = np.empty(len(me.edges) * 2, np.int32); me.edges.foreach_get("vertices", EVw); EVw = EVw.reshape(-1, 2)
degw = np.bincount(EVw.ravel(), minlength=len(P)).astype(float)
for _ in range(14):
    acc = np.zeros_like(W)
    np.add.at(acc, EVw[:, 0], W[EVw[:, 1]]); np.add.at(acc, EVw[:, 1], W[EVw[:, 0]])
    W = np.where(degw[:, None] > 0, 0.5 * W + 0.5 * acc / np.maximum(degw, 1)[:, None], W)
# testa rigida sopra il perno, raccordo sul collo; mandibola dalla bocca
i_head, i_neck, i_jaw, i_chest = names.index("head"), names.index("neck"), names.index("jaw"), names.index("chest")
t_head = ss(pivot[2] - 0.06 * s_head, pivot[2] + 0.005, P[:, 2])
near_axis = np.hypot(P[:, 0], P[:, 1] - pivot[1]) < 0.16 * s_head
t_head = np.where(near_axis, t_head, 0.0)
is_face = (P[:, 2] > pivot[2]) & near_axis
t_head[is_face] = 1.0
W = W * (1 - t_head[:, None])
W[:, i_head] += t_head
for nm in ("eye.L", "eye.R", "jaw"):
    W[:, names.index(nm)] = 0
W = W / np.maximum(W.sum(1, keepdims=True), 1e-9)
for g in list(ob.vertex_groups):
    ob.vertex_groups.remove(g)
for n in names:
    ob.vertex_groups.new(name=n)
for j, n in enumerate(names):
    idx = np.where(W[:, j] > 0.003)[0]
    g = ob.vertex_groups[n]
    for i in idx:
        g.add([int(i)], float(W[i, j]), "REPLACE")
if not any(m.type == "ARMATURE" for m in ob.modifiers):
    mod = ob.modifiers.new("Armature", "ARMATURE"); mod.object = arm
ob.parent = arm
ob.matrix_parent_inverse = Matrix.Identity(4)
for sfx in ("L", "R"):
    eo = eyes_obj[sfx]
    mw = eo.matrix_world.copy()
    eo.parent = arm; eo.parent_type = "BONE"; eo.parent_bone = f"eye.{sfx}"
    bpy.context.view_layer.update()
    eo.matrix_world = mw

# ---------------------------------------------------------------- shape key
if not me.shape_keys:
    ob.shape_key_add(name="Basis", from_mix=False)


SMOOTH_KEYS = {"mouthA", "mouthO", "mouthE", "mouthMBP", "mouthFV", "smile", "smileTeeth", "jawOpen"}
_EVk = np.empty(len(me.edges) * 2, np.int32); me.edges.foreach_get("vertices", _EVk); _EVk = _EVk.reshape(-1, 2)


def _smooth_disp(D, region, iters=10):
    deg = np.bincount(_EVk.ravel(), minlength=len(D)).astype(float)
    for _ in range(iters):
        acc = np.zeros_like(D)
        np.add.at(acc, _EVk[:, 0], D[_EVk[:, 1]]); np.add.at(acc, _EVk[:, 1], D[_EVk[:, 0]])
        avg = acc / np.maximum(deg, 1)[:, None]
        D = np.where(region[:, None], 0.5 * D + 0.5 * avg, D)
    return D


def add_key(name, Pk):
    if name in SMOOTH_KEYS:
        reg = (np.abs(P0[:, 0] - MC[0]) < 1.8 * MW) & (np.abs(P0[:, 2] - MC[2]) < 1.3 * MW) & \
            ~np.isin(FLAG, (15, 16, 17, 18)) & (P0[:, 1] < MC[1] + 0.9 * MW)
        Pk = P0 + _smooth_disp(Pk - P0, reg)
    k = ob.shape_key_add(name=name, from_mix=False)
    k.data.foreach_set("co", Pk.astype(np.float32).ravel())
    k.value = 0.0
    k.slider_min = 0.0; k.slider_max = 1.0


def rot_x(Pp, c, ang):
    d = Pp - c
    ca, sa = np.cos(ang), np.sin(ang)
    out = d.copy()
    out[:, 1] = d[:, 1] * ca - d[:, 2] * sa
    out[:, 2] = d[:, 1] * sa + d[:, 2] * ca
    return c + out


P0 = P.copy()
x, y, z = P0[:, 0], P0[:, 1], P0[:, 2]
headzone = (z > J["neck_mid"][2] - 0.08 * s_head) & (np.hypot(x, y - pivot[1]) < 0.2 * s_head)

# palpebre: a riposo la superiore copre circa un quinto dell'iride, l'inferiore la sfiora (sguardo rilassato)
REST_LID = 0.17
UPPER_COVER, LOWER_TOUCH = 0.22, 0.95
BLINK = {}
P_rest = P0.copy()
for sfx, sgn, nm in (("L", 1, "blink.L"), ("R", -1, "blink.R")):
    E = EYES[sfx]; C = E["C"]; R = E["R"]
    elev = np.arctan2(z - C[2], -(y - C[1]))                # 0 = avanti, + = in alto
    near = headzone & (np.abs(x - E["ac"][0]) < 1.5 * E["ahw"]) & (z > E["ac"][1] - 2.2 * E["ahh"]) & \
        (z < E["ac"][1] + 3.2 * E["ahh"]) & (y < C[1] + 0.3 * R)
    up_r = (FLAG == 1) & (EYEA == sgn); lo_r = (FLAG == 2) & (EYEA == sgn)
    xu, au = x[up_r], elev[up_r]; xl_, al = x[lo_r], elev[lo_r]
    ou, ol = np.argsort(xu), np.argsort(xl_)
    th_u = np.interp(x, xu[ou], au[ou]); th_l = np.interp(x, xl_[ol], al[ol])
    close = np.clip(th_u - th_l, 0, 2.6)
    # ogni punto del bordo con la sua elevazione vera (verso gli angoli il bordo e' quasi verticale e
    # l'interpolazione lungo x mescolerebbe i vicini: restavano due cunei aperti a occhio chiuso)
    close_u = close.copy(); close_l = close.copy()
    close_u[up_r] = np.clip(elev[up_r] - th_l[up_r], 0, 2.6)
    close_l[lo_r] = np.clip(th_u[lo_r] - elev[lo_r], 0, 2.6)
    _iu = np.where(up_r)[0]; _il = np.where(lo_r)[0]
    for _f in (3, 4):                                       # piega e ciglia seguono il punto di bordo piu' vicino
        for _i in np.where((FLAG == _f) & (EYEA == sgn))[0]:
            du = np.hypot(x[_iu] - x[_i], z[_iu] - z[_i]); dl = np.hypot(x[_il] - x[_i], z[_il] - z[_i])
            if _f == 4 or du.min() <= dl.min():
                close_u[_i] = close_u[_iu[np.argmin(du)]]
            else:
                close_l[_i] = close_l[_il[np.argmin(dl)]]
    rim_zu = np.interp(x, xu[ou], z[up_r][ou]); rim_zl = np.interp(x, xl_[ol], z[lo_r][ol])
    own = (EYEA == sgn) & np.isin(FLAG, (1, 2, 3, 4))
    upper_side = np.where(FLAG == 1, True, np.where(FLAG == 2, False, np.where(FLAG == 4, True, z >= 0.5 * (rim_zu + rim_zl))))
    w_up = np.where(own & upper_side, 1.0,                                  # sfuma prima delle sopracciglia
                    np.where(near, (1 - ss(0.0, 1.1 * E["ahh"], z - rim_zu)) * (z >= rim_zu - 1e-4), 0.0))
    w_lo = np.where(own & ~upper_side, 1.0,
                    np.where(near, (1 - ss(0.0, 0.7 * E["ahh"], rim_zl - z)) * (z <= rim_zl + 1e-4), 0.0))
    w_up = np.where(near | own, w_up, 0); w_lo = np.where(near | own, w_lo, 0)
    w_up[FLAG == 19] = 0; w_lo[FLAG == 19] = 0

    _EVl = np.empty(len(me.edges) * 2, np.int32); me.edges.foreach_get("vertices", _EVl); _EVl = _EVl.reshape(-1, 2)

    def lid(a_up, a_lo, gap=0.0006):
        Pk = P0.copy()
        Pk = np.where(w_up[:, None] > 0, rot_x(Pk, C, a_up * close_u * w_up), Pk)     # angolo positivo = verso il basso
        Pk = np.where(w_lo[:, None] > 0, rot_x(Pk, C, a_lo * close_l * w_lo), Pk)
        mvk = ((w_up > 0) | (w_lo > 0)) & (FLAG != 3)
        # le facce sono piatte: una faccia lunga sopra il bulbo ci entra a meta' (freccia = L^2 / 8R)
        el = np.linalg.norm(Pk[_EVl[:, 0]] - Pk[_EVl[:, 1]], axis=1)
        sag = np.zeros(len(Pk))
        np.maximum.at(sag, _EVl[:, 0], el * el / (8 * R)); np.maximum.at(sag, _EVl[:, 1], el * el / (8 * R))
        need = R + gap + 1.4 * sag
        d = Pk - C; r = np.linalg.norm(d, axis=1)
        fix = mvk & (r < need)
        Pk[fix] = C + d[fix] / r[fix][:, None] * need[fix][:, None]
        return Pk
    mv = (w_up > 0) | (w_lo > 0)
    # la shape key interpola in linea retta: a meta' corsa la palpebra taglierebbe dentro il bulbo.
    # blinkHalf = meta' corsa vera (ruotata); il motore miscela riposo -> meta' -> chiuso, e la palpebra resta fuori
    BLINK[nm] = (mv, lid(0.84, -0.16, gap=0.0011))
    BLINK[nm.replace("blink", "blinkHalf")] = (mv, lid(0.42, -0.08, gap=0.0011))
    th_i = math.asin(min(0.95, E["iris_r"] * IRIS_SCALE / R))       # raggio angolare dell'iride sul bulbo
    xc_ = C[0]
    th_u0 = float(np.interp(xc_, xu[ou], au[ou])); th_l0 = float(np.interp(xc_, xl_[ol], al[ol]))
    cl0 = max(th_u0 - th_l0, 1e-3)
    a_up = max(0.0, (th_u0 - th_i * (1 - 2 * UPPER_COVER)) / cl0)     # frazione di chiusura per la superiore
    a_lo = -max(0.0, (-th_i * LOWER_TOUCH - th_l0) / cl0)              # la inferiore sale fino a sfiorare l'iride
    a_up = min(a_up, 0.45); a_lo = max(a_lo, -0.20)
    print(sfx, "rest lids: iris ang", round(math.degrees(th_i), 1), "upper rim", round(math.degrees(th_u0), 1),
          "lower rim", round(math.degrees(th_l0), 1), "-> close", round(a_up, 3), round(a_lo, 3))
    rest = lid(a_up, a_lo)
    P_rest[(w_up > 0) | (w_lo > 0)] = rest[(w_up > 0) | (w_lo > 0)]
# la nuova base: palpebre a riposo
P0 = P_rest
# angoli della bocca: levigatura locale della pelle (le pieghe generate diventano segni chiari quando la bocca si muove)
_EVc = np.empty(len(me.edges) * 2, np.int32); me.edges.foreach_get("vertices", _EVc); _EVc = _EVc.reshape(-1, 2)
_dcn = np.min(np.linalg.norm(P0[:, None, :] - CORN[None], axis=2), 1)
_wc = (1 - ss(0.10 * MW, 0.38 * MW, _dcn)) * ~np.isin(FLAG, (13, 14, 15, 16, 17))
_deg = np.bincount(_EVc.ravel(), minlength=len(P0)).astype(float)
_keys = {}
for i_ in np.where(_wc > 0)[0]:
    _keys.setdefault(tuple(np.round(P0[i_], 6)), []).append(i_)
for _ in range(12):
    acc = np.zeros_like(P0)
    np.add.at(acc, _EVc[:, 0], P0[_EVc[:, 1]]); np.add.at(acc, _EVc[:, 1], P0[_EVc[:, 0]])
    avg = acc / np.maximum(_deg, 1)[:, None]
    P0 = P0 + (avg - P0) * (0.5 * _wc)[:, None]
    for grp in _keys.values():                       # i due lati del taglio restano uniti a riposo
        if len(grp) > 1:
            P0[grp] = P0[grp].mean(0)
# labbra con volume: le fasce sopra e sotto la linea si gonfiano lungo la normale (prima erano un taglio sottile)
_N0 = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get("normal", _N0); _N0 = _N0.reshape(-1, 3)
_xa = np.abs(P0[:, 0] - MC[0]); _lz = lip_z_at(np.clip(P0[:, 0], lip[:, 0].min(), lip[:, 0].max()))
_dz = P0[:, 2] - _lz
_pu = np.where((_dz >= 0) & (_dz < 0.20 * MW), np.sin(np.pi * np.clip(_dz / (0.20 * MW), 0, 1)) ** 2, 0.0)
_pl = np.where((_dz < 0) & (_dz > -0.30 * MW), np.sin(np.pi * np.clip(-_dz / (0.30 * MW), 0, 1)) ** 2, 0.0)
_lat = 1 - ss(0.30 * MW, 0.92 * MW, _xa)
_lipm = (P0[:, 1] < MC[1] + 0.3 * MW) & ~np.isin(FLAG, (13, 14, 15, 16, 17, 18)) & (_N0[:, 1] < 0)
_amt = (0.030 * MW * _pu + 0.040 * MW * _pl) * _lat * _lipm
P0 = P0 + _N0 * _amt[:, None]
print("lip volume: max mm", round(1000 * float(_amt.max()), 2))
me.vertices.foreach_set("co", P0.astype(np.float32).ravel())
me.shape_keys.key_blocks["Basis"].data.foreach_set("co", P0.astype(np.float32).ravel())
for nm, (mv, Pc) in BLINK.items():
    Pk = P0.copy(); Pk[mv] = Pc[mv]
    add_key(nm, Pk)
x, y, z = P0[:, 0], P0[:, 1], P0[:, 2]

# mandibola
xa = np.abs(x - MC[0])
x_ear = 0.85 * float(np.percentile(np.abs(P_hi[(P_hi[:, 2] > MC[2]) & (P_hi[:, 2] < eye_z)][:, 0]), 97))
lz = lip_z_at(np.clip(x, lip[:, 0].min(), lip[:, 0].max()))
zj = np.where(xa < MW, lz, lz + (xa - MW) * 0.3)          # oltre gli angoli la linea sale piano verso la mascella
# lato della fessura per topologia: distanza lungo la mesh dal bordo inferiore e da quello superiore
# (il taglio segue gli spigoli a zig-zag: l'altezza da sola sbaglia vicino alla linea delle labbra)
EV = np.empty(len(me.edges) * 2, np.int32); me.edges.foreach_get("vertices", EV); EV = EV.reshape(-1, 2)
mz = (np.abs(x - MC[0]) < 1.7 * MW) & (np.abs(z - MC[2]) < 1.2 * MW) & (y < MC[1] + 0.8 * MW) & ~np.isin(FLAG, (15, 16, 17, 18))
adj = {}
for a_, b_ in EV:
    if mz[a_] and mz[b_]:
        L_ = float(np.linalg.norm(P0[a_] - P0[b_]))
        adj.setdefault(a_, []).append((b_, L_)); adj.setdefault(b_, []).append((a_, L_))


def geo(src):
    dd = np.full(len(P0), np.inf)
    pq = [(0.0, int(i)) for i in src]
    for _, i in pq:
        dd[i] = 0.0
    heapq.heapify(pq)
    while pq:
        d_, i = heapq.heappop(pq)
        if d_ > dd[i]:
            continue
        for j, L_ in adj.get(i, ()):
            if d_ + L_ < dd[j]:
                dd[j] = d_ + L_; heapq.heappush(pq, (d_ + L_, j))
    return dd


d_lo = geo(np.where(np.isin(FLAG, (12, 14)))[0]); d_up = geo(np.where(np.isin(FLAG, (11, 13)))[0])
near_slit = mz & (xa < 0.95 * MW) & (np.abs(z - lz) < 0.3 * MW)
LOWER = mz & np.where(near_slit, d_lo < d_up, z < zj)
UPPER_S = mz & ~LOWER
# il labbro inferiore si apre a limone: pieno al centro, poco agli angoli; il mento piu' sotto segue tutto
taper = np.clip(1 - (xa / MW) ** 2, 0, 1) ** 0.5 * 0.85 + 0.15
w_low = taper + (1 - taper) * ss(0.0, (0.35 + 0.9 * np.clip(xa / MW, 0, 1.3) ** 2) * MW, d_lo)
w_fast = np.where(mz, LOWER * w_low, ss(zj + 0.0005, zj - 0.004 * s_head, z))
w_slow = ss(zj + 0.004 * s_head, zj - 0.016 * s_head, z)     # guance: sfumato
bl = ss(0.9 * MW, 1.6 * MW, xa)
wj = (w_fast * (1 - bl) + w_slow * bl) * (1 - ss(TMJ[1] - 0.01 * s_head, TMJ[1] + 0.03 * s_head, y))
wj *= ss(chin_low[2] - 0.035 * s_head, chin_low[2] + 0.005, z) * headzone
# angoli della bocca fermi: la pelle vicina segue sempre meno (niente lembi tirati dall'angolo)
dc = np.min(np.linalg.norm(P0[:, None, :] - CORN[None], axis=2), 1)
cf = ss(0.0, 0.55 * MW, dc)
wj *= np.where(mz | (dc < 0.5 * MW), cf, 1.0)
wj = np.where(np.isin(FLAG, (12, 14)), taper * cf, wj)
wj = np.where(np.isin(FLAG, (16, 18)), 1.0, wj)
wj = np.where(np.isin(FLAG, (11, 13, 15)), 0.0, wj)
wj = np.where(FLAG == 17, 0.45 * (z < MC[2]) + 0.1, wj)
wj = np.where(np.isin(FLAG, (1, 2, 3, 4)), 0.0, wj)
# levigatura dei pesi sulla pelle della bocca (i bordi delle labbra restano fissi): niente grinze agli angoli
fixed = np.isin(FLAG, (11, 12, 13, 14, 15, 16, 17)) | ~mz
nb_i = np.array([i for i in adj for _ in adj[i]]); nb_j = np.array([j for i in adj for j, _ in adj[i]])
deg = np.bincount(nb_i, minlength=len(wj)).astype(float)
for _ in range(8):
    acc = np.bincount(nb_i, weights=wj[nb_j], minlength=len(wj))
    avg = np.where(deg > 0, acc / np.maximum(deg, 1), wj)
    wj = np.where(fixed, wj, 0.5 * wj + 0.5 * avg)


# gradi di rotazione della mandibola per chiave (la testa animata e' grande: angoli piu' piccoli della versione realistica)
JAW_DEG = {"jawOpen": 7.0, "mouthA": 4.5, "mouthO": 3.5, "mouthE": 2.0, "mouthFV": 1.0}


def jaw(a):
    """il mento scende senza arretrare (la sola rotazione attorno all'articolazione lo tira indietro: schiaccianoci)"""
    Pr = rot_x(P0, TMJ, np.radians(a) * wj)
    Pr[:, 1] = P0[:, 1] + 0.35 * (Pr[:, 1] - P0[:, 1])
    return Pr


V = lambda dx, dy, dz: np.stack([dx, dy, dz], -1)
mk = MW / 0.025                                            # millimetri della pipeline precedente -> metri qui
lipz = (np.abs(x - MC[0]) < MW + 0.3 * MW) & (np.abs(z - lz) < 0.6 * MW) & (y < MC[1] + 0.35 * MW) & headzone
w_lip = np.where(lipz, np.exp(-((z - lz) / (0.32 * MW)) ** 2) * (1 - ss(MW * 0.9, MW * 1.25, xa)), 0.0)
w_lip = np.where(np.isin(FLAG, (11, 12, 13, 14)), 1.0 * (xa < MW), w_lip)
w_lip = w_lip * cf                                          # agli angoli le labbra non si separano (niente lembi)
upper = np.where(mz, UPPER_S, z > lz) | np.isin(FLAG, (11, 13, 15))
corner = np.exp(-(((xa - MW) / (0.28 * MW)) ** 2 + ((z - lz) / (0.28 * MW)) ** 2)) * headzone * (y < MC[1] + 0.4 * MW)
sgn_x = np.sign(x - MC[0])
mm_ = 0.001 * mk
add_key("jawOpen", jaw(JAW_DEG["jawOpen"]))
gx = np.exp(-(xa / (0.62 * MW)) ** 2)                       # piu' al centro che agli angoli: aperture tonde
add_key("mouthA", jaw(JAW_DEG["mouthA"]) + V(-sgn_x * xa * 0.07 * w_lip, 0 * x,
                                             (1.7 * upper - 1.1 * (~upper)) * mm_ * w_lip * gx))
add_key("mouthO", jaw(JAW_DEG["mouthO"]) + V(-sgn_x * xa * 0.38 * w_lip * np.clip(xa / MW, 0, 1), -3.4 * mm_ * w_lip,
                                             (0.7 * upper - 0.7 * (~upper)) * mm_ * w_lip * gx))
add_key("mouthE", jaw(JAW_DEG["mouthE"]) + V(sgn_x * 2.5 * mm_ * corner + sgn_x * xa * 0.06 * w_lip, 0.5 * mm_ * corner, 0.8 * mm_ * corner))
add_key("mouthMBP", P0 + V(0 * x, 1.0 * mm_ * w_lip, np.where(upper, -0.7, 0.9) * mm_ * w_lip))
lower_lip = w_lip * (~upper)
add_key("mouthFV", jaw(JAW_DEG["mouthFV"]) + V(0 * x, 3.0 * mm_ * lower_lip, 1.6 * mm_ * lower_lip))
cheek = np.exp(-(((xa - 1.6 * MW) / (0.6 * MW)) ** 2 + ((z - (MC[2] + 0.75 * MW)) / (0.5 * MW)) ** 2)) * headzone * (y < MC[1] + 0.6 * MW)
cheek *= ~np.isin(FLAG, (1, 2, 3, 4, 19))
up_lip = w_lip * upper * (1 - corner); low_lip = w_lip * (~upper) * (1 - corner)
so_ = CFG["smile_open"]
# smile: a labbra chiuse (mentre ascoltano); smileTeeth: lo stesso con le labbra che si aprono sui denti (il "Grazie")
add_key("smile", P0 + V(sgn_x * 6.0 * mm_ * corner, (2.5 * corner - 2.5 * cheek) * mm_,
                        (7.0 * corner + 3.6 * cheek + 0.25 * up_lip) * mm_))
add_key("smileTeeth", P0 + V(sgn_x * 6.5 * mm_ * corner, (2.5 * corner - 2.5 * cheek) * mm_,
                             (7.5 * corner + 4.0 * cheek + so_ * (2.6 * up_lip - 3.5 * low_lip)) * mm_))
# sopracciglia su (espressivita': ascolto, sorpresa)
bw = np.zeros(len(P0))
for e_ in EYES.values():
    acx_, acz_ = e_["ac"]
    bw = np.maximum(bw, np.exp(-((x - acx_) / (1.7 * e_["ahw"])) ** 2) * ss(acz_ + 0.9 * e_["ahh"], acz_ + 2.0 * e_["ahh"], z)
                    * (1 - ss(acz_ + 3.8 * e_["ahh"], acz_ + 6.0 * e_["ahh"], z)))
bw *= headzone * (y < eye_z * 0 + EYES["L"]["C"][1]) * ~np.isin(FLAG, (1, 2, 3, 4, 19))
add_key("browUp", P0 + V(0 * x, 0 * x, 0.14 * EYES["L"]["ahh"] * bw))
print("shape keys", [k.name for k in me.shape_keys.key_blocks])

# ---------------------------------------------------------------- mani: texture, poi unite al corpo
for o in bpy.context.view_layer.objects:
    o.select_set(o in (HANDS["L"], HANDS["R"]))
bpy.context.view_layer.objects.active = HANDS["L"]
bpy.ops.object.join()
HOB = HANDS["L"]; HOB.name = NAME + "_hands"
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004)
bpy.ops.object.mode_set(mode="OBJECT")
HMAT = GH.hand_material(NAME + "_hands")
HOB.data.materials.append(HMAT)
_hb = dict(FBONES)
for sfx_ in ("L", "R"):
    _hb[f"hand.{sfx_}"] = (J[f"wrist.{sfx_}"], J[f"mcp.{sfx_}"], ARMF[sfx_]["dorsal"])
_himg, _horm = GH.paint_hands(HOB, _hb, np.array(CFG["skin_target"], np.float32) / 255.0,
                              lambda o_, size: GT.bake_maps(o_, size=size, ao_distance=0.012), size=2048,
                              name=NAME + "_hands")
GH.set_hand_images(HMAT, _himg, _horm)
sc.render.engine = "BLENDER_EEVEE"
# unione: mani e polsini dentro la mesh del fondatore (stessa pelle armata, i pesi passano per nome)
_mat_names_hand = {HMAT.name}
_mat_names_cuff = {m.name for c in CUFFS.values() for m in c.data.materials}
for o in bpy.context.view_layer.objects:
    o.select_set(o in (ob, HOB, CUFFS["L"], CUFFS["R"]))
bpy.context.view_layer.objects.active = ob
bpy.ops.object.join()
me = ob.data
_pm = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get("material_index", _pm)
_mi_hand = [i for i, m in enumerate(me.materials) if m and m.name in _mat_names_hand]
_mi_cuff = [i for i, m in enumerate(me.materials) if m and m.name in _mat_names_cuff]
_fv = np.empty(sum(len(p.vertices) for p in me.polygons), np.int32); me.polygons.foreach_get("vertices", _fv)
_ft = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get("loop_total", _ft)
IS_HAND = np.zeros(len(me.vertices), bool); IS_CUFF = np.zeros(len(me.vertices), bool)
IS_HAND[_fv[np.repeat(np.isin(_pm, _mi_hand), _ft)]] = True
IS_CUFF[_fv[np.repeat(np.isin(_pm, _mi_cuff), _ft)]] = True


def vgroup_weights(names_):
    """pesi per vertice dei gruppi richiesti (solo i vertici delle mani)"""
    gi = {ob.vertex_groups[n].index: n for n in names_ if n in ob.vertex_groups}
    out = {n: np.zeros(len(me.vertices)) for n in names_}
    for i in np.where(IS_HAND)[0]:
        for g in me.vertices[int(i)].groups:
            if g.group in gi:
                out[gi[g.group]][i] = g.weight
    return out


# maniche (avambraccio) del corpo: non devono affondare nel banco
_gfa = {ob.vertex_groups[f"forearm.{sd}"].index for sd in ("L", "R") if f"forearm.{sd}" in ob.vertex_groups}
IS_FORE = np.zeros(len(me.vertices), bool)
for v in me.vertices:
    if not IS_HAND[v.index] and not IS_CUFF[v.index] and any(g.group in _gfa and g.weight > 0.5 for g in v.groups):
        IS_FORE[v.index] = True
_wn = [f"hand.{sd}" for sd in ("L", "R")] + [f"{f}.0{k}.{sd}" for sd in ("L", "R") for f in ("thumb",) + GH.FINGERS for k in (2, 3)]
WH = vgroup_weights(_wn)
print("hands and cuffs joined: hand verts", int(IS_HAND.sum()), "cuff verts", int(IS_CUFF.sum()), "total tris", tri_count())

# il segno della flessione: le dita devono andare verso il palmo
for sfx_ in ("L", "R"):
    RG.reset_pose(arm)
    GH.FLEX_SIGN[sfx_] = -1.0
    GH.pose_finger(arm, sfx_, "index", 40.0)
    bpy.context.view_layer.update()
    tip_ = np.array(arm.matrix_world @ arm.pose.bones[f"index.03.{sfx_}"].tail)
    h0, t0, up0 = FBONES[f"index.03.{sfx_}"]
    if (tip_ - t0) @ FBONES[f"index.01.{sfx_}"][2] > 0:
        GH.FLEX_SIGN[sfx_] = 1.0
    RG.reset_pose(arm)
print("flex sign", GH.FLEX_SIGN)

# ---------------------------------------------------------------- clip: polsi sul banco, palmi in giu'
wrist_rest = {}
hand_base = {}
for s, sfx in ((1, "L"), (-1, "R")):
    S = J[f"shoulder.{sfx}"]; Eb = J[f"elbow.{sfx}"]; Wr = J[f"wrist.{sfx}"]; T = J[f"tip.{sfx}"]
    L1 = np.linalg.norm(Eb - S); L2 = np.linalg.norm(Wr - Eb)
    z_w = TABLE_Z + 0.035
    z_e = max(S[2] - 0.93 * L1, z_w + 0.05)
    drop = S[2] - z_e
    fwd = math.sqrt(max(L1 * L1 - drop * drop - 0.03 ** 2, 0.0))
    E_t = np.array([S[0] - s * 0.02, S[1] - fwd, z_e])            # gomiti stretti: i due fondatori siedono vicini
    dz = z_e - z_w
    hor = math.sqrt(max(L2 * L2 - dz * dz, 0.0)) * 0.97
    W_t = E_t + np.array([-s * 0.36 * hor, -0.933 * hor, -dz])
    wrist_rest[sfx] = Vector(W_t)
    print(sfx, "L1", round(L1, 3), "L2", round(L2, 3), "wrist target", W_t.round(3))

_ik = RG.ik_arm


def ik_palm(arm_, sfx, tgt, hrot=None, pole=None):
    q = hand_base[sfx] if hrot is None else (hrot @ hand_base[sfx])
    if pole is None:                                    # gomito indietro e in basso, poco in fuori
        pole = Vector(((0.2 if sfx == "L" else -0.2), 0.55, -0.8))
    _ik(arm_, sfx, tgt, q, pole)
    # meta' della rotazione della mano attorno all'avambraccio passa all'avambraccio: il polso non si strizza
    fa = arm_.pose.bones[f"forearm.{sfx}"]; hd = arm_.pose.bones[f"hand.{sfx}"]
    Mh = hd.matrix.copy()
    rel = (fa.matrix.to_3x3().inverted() @ Mh.to_3x3()).to_quaternion()
    rel0 = (fa.bone.matrix_local.to_3x3().inverted() @ hd.bone.matrix_local.to_3x3()).to_quaternion()
    d = rel @ rel0.inverted()
    tw = 2 * math.atan2(d.y, d.w)
    if tw > math.pi:
        tw -= 2 * math.pi
    if tw < -math.pi:
        tw += 2 * math.pi
    fa.matrix = fa.matrix @ Matrix.Rotation(0.5 * tw, 4, "Y")
    bpy.context.view_layer.update()
    hd.matrix = Mh
    bpy.context.view_layer.update()


RG.ik_arm = ik_palm
RG.LEAN.update({"spine": 4.0, "chest": 5.0, "neck": 5.0, "head": 6.0})


def set_tilt(sfx_, tz):
    s_ = 1 if sfx_ == "L" else -1
    Wr_, T_ = J[f"wrist.{sfx_}"], J[f"tip.{sfx_}"]
    y0 = (T_ - Wr_) / np.linalg.norm(T_ - Wr_)
    n0 = np.array([-s_, 0.0, 0.0]); n0 = n0 - y0 * (n0 @ y0); n0 /= np.linalg.norm(n0)
    y1 = np.array([-s_ * 0.18, -1.0, tz]); y1 /= np.linalg.norm(y1)
    n1 = np.array([0, 0, -1.0]); n1 = n1 - y1 * (n1 @ y1); n1 /= np.linalg.norm(n1)
    F0 = np.stack([y0, n0, np.cross(y0, n0)], 1); F1 = np.stack([y1, n1, np.cross(y1, n1)], 1)
    hand_base[sfx_] = Matrix((F1 @ F0.T).tolist()).to_quaternion()


# dita sul banco: le due mani non uguali (aperture e ripartizione della piega diverse)
BENCH = {"L": {"thumb": [20.0, 0.0], "index": [40.0, 3.0], "middle": [40.0, 0.0], "ring": [42.0, -2.5], "pinky": [46.0, -6.0]},
         "R": {"thumb": [24.0, 0.0], "index": [38.0, 1.5], "middle": [40.0, 0.5], "ring": [44.0, -3.5], "pinky": [50.0, -7.5]}}
SPLIT = {"L": {"index": (0.42, 0.36, 0.22), "middle": (0.40, 0.38, 0.22), "ring": (0.38, 0.40, 0.22), "pinky": (0.40, 0.38, 0.22)},
         "R": {"index": (0.38, 0.40, 0.22), "middle": (0.42, 0.36, 0.22), "ring": (0.40, 0.38, 0.22), "pinky": (0.44, 0.36, 0.20)}}


def apply_fingers(arm_, pose_, sides=("L", "R")):
    for sd in sides:
        for f, (c, sp) in pose_[sd].items():
            GH.pose_finger(arm_, sd, f, c, sp, SPLIT[sd].get(f))


def lean_pose():
    RG.reset_pose(arm)
    for nm_, a_ in RG.LEAN.items():
        RG.set_rot(arm, nm_, (a_, 0, 0))
    for sfx_ in ("L", "R"):
        ik_palm(arm, sfx_, wrist_rest[sfx_])
    apply_fingers(arm, BENCH)
    bpy.context.view_layer.update()


def posed_verts():
    dg = bpy.context.evaluated_depsgraph_get()
    em_ = ob.evaluated_get(dg).to_mesh()
    Q = np.empty(len(em_.vertices) * 3, np.float32); em_.vertices.foreach_get("co", Q); Q = Q.reshape(-1, 3)
    ob.evaluated_get(dg).to_mesh_clear()
    return Q


def lows(sfx_):
    """quote (rispetto al polso): polsino, palmo, punta di ogni dito"""
    Q = posed_verts()
    wz = (arm.matrix_world @ arm.pose.bones[f"hand.{sfx_}"].head).z
    s_ = 1 if sfx_ == "L" else -1
    side_m = (s_ * Q[:, 0] > 0)
    out = {"cuff": Q[IS_CUFF & side_m][:, 2].min() - wz, "fore": Q[IS_FORE & side_m][:, 2].min() - wz,
           "palm": Q[IS_HAND & side_m & (WH[f"hand.{sfx_}"] > 0.6)][:, 2].min() - wz}
    for f in ("thumb",) + GH.FINGERS:
        m_ = IS_HAND & side_m & ((WH[f"{f}.03.{sfx_}"] > 0.5) | (WH[f"{f}.02.{sfx_}"] > 0.5))
        out[f] = Q[m_][:, 2].min() - wz
    return out


for sfx_ in ("L", "R"):
    set_tilt(sfx_, -0.1)
lean_pose()
_lo = {sd: lows(sd) for sd in ("L", "R")}
# il gioco appoggia il banco al punto piu' basso delle mani: i polsini restano 4 mm sopra, uguali ai due lati
TARGET_OFF = max(0.035, -_lo["L"]["cuff"] + 0.004, -_lo["R"]["cuff"] + 0.004,
                 -_lo["L"]["fore"] + 0.004, -_lo["R"]["fore"] + 0.004)
print("bench under wrist", round(TARGET_OFF, 4), "cuffs", round(-_lo["L"]["cuff"], 4), round(-_lo["R"]["cuff"], 4),
      "sleeves", round(-_lo["L"]["fore"], 4), round(-_lo["R"]["fore"], 4))
tilt = {}


def knuckle_h(sfx_):
    """quota media delle nocche (rispetto al polso)"""
    wz = (arm.matrix_world @ arm.pose.bones[f"hand.{sfx_}"].head).z
    return float(np.mean([(arm.matrix_world @ arm.pose.bones[f"{f}.01.{sfx_}"].head).z for f in GH.FINGERS])) - wz


KNUCKLE_H = {"L": 0.168 * HL, "R": 0.150 * HL}   # mano a tenda: nocche alte, dita piegate fino al banco (mani diverse)
for sfx_ in ("L", "R"):
    lo_t, hi_t = -0.9, 0.6
    for _ in range(10):
        mid_t = 0.5 * (lo_t + hi_t)
        set_tilt(sfx_, mid_t); lean_pose()
        if knuckle_h(sfx_) < -TARGET_OFF + KNUCKLE_H[sfx_]:
            lo_t = mid_t                       # nocche troppo basse: mano piu' su
        else:
            hi_t = mid_t
    tilt[sfx_] = 0.5 * (lo_t + hi_t); set_tilt(sfx_, tilt[sfx_])
    # ogni dito si piega finche' il polpastrello tocca il banco
    for f in ("index", "middle", "ring", "pinky", "thumb"):
        goal = -TARGET_OFF + (0.0015 if f == "thumb" else 0.0)
        lo_c, hi_c = (-10.0, 150.0) if f != "thumb" else (-30.0, 90.0)
        for _ in range(10):
            mid_c = 0.5 * (lo_c + hi_c)
            BENCH[sfx_][f][0] = mid_c; lean_pose()
            if lows(sfx_)[f] > goal:
                lo_c = mid_c                   # non arriva: piu' piega
            else:
                hi_c = mid_c
        BENCH[sfx_][f][0] = 0.5 * (lo_c + hi_c)
lean_pose()
OFFS = {sd: {k: round(-v, 4) for k, v in lows(sd).items()} for sd in ("L", "R")}
RG.reset_pose(arm)
print("hand tilt", {k: round(v, 3) for k, v in tilt.items()}, "under wrist", OFFS)
print("bench fingers", {sd: {f: [round(c, 1), sp] for f, (c, sp) in BENCH[sd].items()} for sd in BENCH})

# gesti della mano destra: indice che indica (le altre chiuse), mano aperta che spiega
POINT = {"thumb": [45.0, 0.0], "index": [6.0, 0.0], "middle": [165.0, 0.0], "ring": [175.0, 0.0], "pinky": [180.0, 0.0]}
OPEN = {"thumb": [8.0, 0.0], "index": [12.0, 6.0], "middle": [16.0, 1.0], "ring": [22.0, -4.0], "pinky": [30.0, -9.0]}


BENCH_Z = float(np.mean([wrist_rest[sd].z for sd in ("L", "R")])) - TARGET_OFF     # piano dei polpastrelli in leanDown


def finger_fn(arm_, clip, t, targets=None):
    pose_ = {sd: {f: list(v) for f, v in BENCH[sd].items()} for sd in ("L", "R")}
    env = 0.0
    if clip == "explain":
        env = RG.ease(t / 0.25) * (1 - RG.ease((t - 0.75) / 0.25)); tgt_ = OPEN
    elif clip == "pointDown":
        env = RG.ease(t / 0.3) * (1 - RG.ease((t - 0.7) / 0.3)); tgt_ = POINT
    if env > 0:
        for f in pose_["R"]:
            c0, s0 = pose_["R"][f]
            pose_["R"][f] = [c0 + (tgt_[f][0] - c0) * env, s0 + (tgt_[f][1] - s0) * env]
    apply_fingers(arm_, pose_)
    # nei gesti la mano destra non entra mai nel banco: se scende sotto, il polso sale (l'indice che indica lo tocca)
    if env > 0 and targets and "R" in targets:
        tgt, hrot = targets["R"]
        tgt = Vector(tgt)
        goal = BENCH_Z + (0.0004 if clip == "pointDown" else 0.003)
        for _ in range(5):
            act_ = arm_.animation_data.action if arm_.animation_data else None
            if act_ is not None:
                arm_.animation_data.action = None
            bpy.context.view_layer.update()
            Q = posed_verts()
            if act_ is not None:
                arm_.animation_data.action = act_
            low = float(Q[IS_HAND & (Q[:, 0] < 0)][:, 2].min())
            if low >= goal - 0.0003:
                break
            tgt = tgt + Vector((0.0, 0.0, goal - low + 0.0003))
            ik_palm(arm_, "R", tgt, hrot)
            apply_fingers(arm_, pose_)


clips = RG.build_clips(arm, wrist_rest, seed=3 if NAME == "giovanni" else 7, finger_fn=finger_fn)

# ---------------------------------------------------------------- pelle opaca: rugosita' minima 0.55, niente metallo
for nd in BASE.node_tree.nodes:
    if nd.type == "TEX_IMAGE" and "ORM" in nd.image.name:
        im = nd.image
        a = np.empty(im.size[0] * im.size[1] * 4, np.float32); im.pixels.foreach_get(a); a = a.reshape(-1, 4)
        a[:, 1] = np.clip(a[:, 1], 0.56, 0.72); a[:, 2] = 0.0
        # capelli, sopracciglia e barba opachi (il lucido della pelle li faceva grigi)
        _bw, _bh = BASE_IMG.size
        _bt = np.empty(_bw * _bh * 4, np.float32); BASE_IMG.pixels.foreach_get(_bt); _bt = _bt.reshape(_bh, _bw, 4)
        _iw, _ih = im.size
        _Vb = _bt[..., :3].max(-1)[(np.arange(_ih) * _bh // _ih)][:, (np.arange(_iw) * _bw // _iw)].ravel()
        _wd = ss(0.34, 0.22, _Vb)
        a[:, 1] = a[:, 1] * (1 - _wd) + 0.85 * _wd
        im.pixels.foreach_set(a.ravel()); im.update(); im.pack()

_bs = BASE.node_tree.nodes.get("Principled BSDF")
if _bs is not None:
    for l in list(_bs.inputs["Metallic"].links):
        BASE.node_tree.links.remove(l)
    _bs.inputs["Metallic"].default_value = 0.0

# ---------------------------------------------------------------- texture piu' leggere per il gioco
for img in list(bpy.data.images):
    if img.size[0] > 2048:
        img.scale(2048, 2048)
    # rugosita' e normal map del corpo: 1024 bastano (la normal map e' piatta sul volto)
    if img.size[0] > 1024 and ("ORM" in img.name or "Normal" in img.name):
        img.scale(1024, 1024); img.pack()
for o in (ob, *eyes_obj.values()):
    for p in o.data.polygons:
        p.use_smooth = True
    if o.data.has_custom_normals:
        bpy.context.view_layer.objects.active = o
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    for a_ in ("sharp_face", "sharp_edge"):
        if a_ in o.data.attributes:
            o.data.attributes.remove(o.data.attributes[a_])

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, NAME + ".blend"))
rep = {"tris": int(tri_count() + sum(len(p.vertices) - 2 for e in eyes_obj.values() for p in e.data.polygons)),
       "eye_R": {k: float(EYES[k]["R"]) for k in EYES}, "mouth_half_width": float(MW), "heat": heat_ok,
       "wrist_rest": {k: [float(c) for c in v] for k, v in wrist_rest.items()}, "jaw_deg": JAW_DEG}
print("REPORT", rep)
if not DRAFT:
    objs = [arm, ob, *eyes_obj.values()]
    for o in bpy.context.view_layer.objects:
        o.select_set(o in objs)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, f"founder-{NAME}.glb"), export_format="GLB", use_selection=True, export_yup=True,
        export_apply=False, export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True,
        export_skins=True, export_morph=True, export_morph_normal=False, export_materials="EXPORT",
        export_image_format="JPEG", export_jpeg_quality=80, export_def_bones=False, export_extras=False,
        export_try_sparse_sk=True, export_try_omit_sparse_sk=True, export_optimize_animation_size=True,
        export_optimize_animation_keep_anim_armature=True)
json.dump(rep, open(os.path.join(OUT, NAME + "_gen_report.json"), "w"), indent=1)
print("DONE")
