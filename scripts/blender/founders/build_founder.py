"""Fondatori Monichs: testa fotografica da un solo ritratto (Giovanni.png / Filippo.png).

Uso:  blender --background --factory-startup --python build_founder.py -- giovanni [--draft]

Testa media (head_fit) -> punti misurati nella foto -> camera della foto (rotazione da scansione) ->
deformazione TPS (+ contorno del viso) -> orecchie adattate come pezzo rigido -> aperture degli occhi e bulbi ->
volume dei capelli dal contorno della foto -> texture proiettate (lato nascosto a specchio) -> confronti.
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
import head_fit as H
import parts as PT
import paint as PA
import body as BD
import shirt as SH
import mouth as MO
import rig as RG
importlib.reload(H); importlib.reload(PT); importlib.reload(PA); importlib.reload(BD); importlib.reload(SH); importlib.reload(MO); importlib.reload(RG)

ROOT = r"C:\Users\UTENTE\Desktop\MNC GAME"
OUT = os.path.join(ROOT, "Modelli", "3D", "fondatori")
TEX = os.path.join(OUT, "textures")
RENDER = os.path.join(OUT, "render")
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["giovanni"]
WHO = argv[0]
DRAFT = "--draft" in argv

# ---------------------------------------------------------------- misure sulla foto (pixel dell'originale 3600x3600)
# .R = destra del soggetto (a sinistra nell'immagine)
PEOPLE = {
    "giovanni": dict(
        photo=os.path.join(ROOT, "Modelli", "Fondatori", "Giovanni.png"),
        size=3600, f=8500.0,
        # rotazione della testa rispetto alla camera, da scansione: punti 12-18 gradi, contorno guancia 17-19, orecchio 25-27
        yaw=19.0, far_side=1,
        crop=(1250, 550, 1200, 1550),
        pts={
            "pupil.R": (1832, 1325), "canthus_out.R": (1760, 1315), "canthus_in.R": (1932, 1350),
            "lid_up.R": (1840, 1300), "lid_lo.R": (1850, 1345),
            "pupil.L": (2145, 1397), "canthus_in.L": (2080, 1385), "canthus_out.L": (2230, 1420),
            "lid_up.L": (2150, 1372), "lid_lo.L": (2160, 1425),
            "brow_out.R": (1710, 1240), "brow_peak.R": (1865, 1215), "brow_in.R": (2005, 1257),
            "brow_in.L": (2100, 1275), "brow_peak.L": (2190, 1267), "brow_out.L": (2275, 1335),
            "nasion": (2015, 1320), "pronasale": (2014, 1539), "subnasale": (1967, 1593), "alar.R": (1900, 1560),
            "mouth.R": (1767, 1700), "mouth.L": (2083, 1750),
            "lip_up": (1920, 1670), "lip_mid": (1920, 1720), "lip_lo": (1933, 1780),
            "pogonion": (1987, 1927), "menton": (1953, 2027), "gonion.R": (1553, 1824),
            "ear_top.R": (1394, 1228), "ear_lobe.R": (1454, 1603), "ear_back.R": (1320, 1340), "tragus.R": (1465, 1410),
        },
        # contorno del viso sul lato lontano (guancia sinistra contro lo sfondo)
        contour_far=[(2270, 1253), (2253, 1486), (2235, 1650), (2171, 1801), (2066, 1883)],
        # contorno inferiore della mandibola sul lato vicino e sotto il mento
        contour_jaw=[(1444, 1655), (1500, 1730), (1550, 1786), (1612, 1842), (1675, 1905), (1725, 1942),
                     (1787, 1967), (1850, 1992), (1912, 2011), (1975, 2017)],
        clothes=dict(name="dolcevita", color=(0.052, 0.046, 0.043), rough=0.85, sheen=0.15, ribs=30, nstrength=0.7),
        skin=(0.80, 0.60, 0.52), hair=(0.11, 0.07, 0.05), sclera=(0.72, 0.63, 0.59),
        hair_region=(1450, 690, 820, 300), skin_patch=(1900, 1040, 260, 140), lip_patch=(1880, 1745, 90, 25),
        paint=dict(brow_in=(14.0, 17.0), brow_peak=(34.0, 24.0), brow_out=(52.0, 16.0),
                   brow_half=[5.2, 4.7, 3.7, 2.5, 1.3], brow_density=1.0, brow=(0.085, 0.055, 0.04),
                   beard=1.0, beard_rgb=(0.045, 0.031, 0.024), beard_max=0.93, lash=(0.04, 0.03, 0.025), mouth_x=25.0,
                   lip_line=0.0, lip_skin=0.55, cheek_red=0.25, sideburn=0.8,
                   beard_x=[24, 30, 38, 48, 58, 66, 74], beard_y=[-68, -62, -54, -44, -33, -24, -18],
                   skin=(0.80, 0.61, 0.51), hair_rgb=(0.115, 0.072, 0.05), hair_hi=(0.24, 0.155, 0.10),
                   crown=(0.0, 110.0, -105.0), comb=(0.0, 0.35, 1.0), strand_w=0.35, strand_l=7.0,
                   curl=0.8, curl_l=10.0, clump=7.0,
                   cards=560, card_len=0.032, card_w=0.024, card_lift=0.45, card_curl=1.3, card_twist=0.6,
                   fringe=8, fringe_x=(-22.0, 12.0), card_room=0.007,
                   biscuit=(0.90, 0.83, 0.73), biscuit_eye=(0.94, 0.90, 0.83), umber=(0.13, 0.088, 0.062),
                   umber_light=(0.32, 0.23, 0.16), glaze=0.9, lash_glaze=0.55, groove_w=0.9, groove_l=9.0,
                   lobe=0.004, lobe_l=13.0, beard_relief=0.0007, brow_relief=0.0008, smile_asym=0.35,
                   lock_w=6.0, lock_l=22.0, lock_amp=0.003, locks=80, lock_min_y=35.0, lock_len=0.036,
                   lock_wid=0.020, lock_th=0.014, lock_lift=0.45, lock_curl=2.4, base_smile=0.45, lock_around=8, lock_taper=0.45,
                   skin_toon=(0.96, 0.66, 0.50), lip_toon=(0.80, 0.46, 0.42), stubble=(0.17, 0.11, 0.075),
                   stubble_max=0.78, hair_toon=(0.19, 0.12, 0.08), hair_toon_hi=(0.50, 0.33, 0.21),
                   iris_in=(0.62, 0.36, 0.14), iris_out=(0.30, 0.15, 0.06), eye_scale=1.42, eye_scale_y=2.2, eye_fall=0.06, eye_smooth=10,
                   iris_frac=0.60, pupil_frac=0.22, brow_half_toon=[7.0, 6.6, 5.6, 4.0, 2.0], nose_back=0.004, cheek_puff=0.003, sym=1.0, smooth=8, head_scale=1.38, face_widen=0.09, jaw_short=0.82,
                   nose_bulb=0.0018, top_boost=0.008),
        style="cartoon",
        hair_lum=0.33,
    ),
    "filippo": dict(
        photo=os.path.join(ROOT, "Modelli", "Fondatori", "Filippo.png"),
        size=3600, f=8500.0,
        yaw=None, far_side=-1,
        crop=(1300, 300, 1150, 1450),
        # bocca e mento riportati dal sorriso aperto della foto a bocca chiusa (il sorriso e' una shape key)
        pts={
            "pupil.L": (1988, 1010), "canthus_in.L": (1928, 1019), "canthus_out.L": (2062, 1009),
            "lid_up.L": (1981, 990), "lid_lo.L": (1988, 1035),
            "pupil.R": (1654, 1046), "canthus_in.R": (1712, 1052), "canthus_out.R": (1581, 1060),
            "lid_up.R": (1656, 1022), "lid_lo.R": (1656, 1075),
            "brow_in.L": (1862, 931), "brow_peak.L": (1988, 900), "brow_out.L": (2119, 937),
            "brow_in.R": (1725, 937), "brow_peak.R": (1619, 931), "brow_out.R": (1519, 981),
            "nasion": (1806, 1000), "pronasale": (1806, 1187), "subnasale": (1831, 1225),
            "alar.L": (1900, 1200), "alar.R": (1725, 1206),
            "mouth.R": (1692, 1388), "mouth.L": (2000, 1360),
            "lip_up": (1843, 1352), "lip_mid": (1843, 1372), "lip_lo": (1843, 1400),
            "pogonion": (1843, 1546), "menton": (1857, 1603),
            "ear_top.L": (2306, 981), "ear_back.L": (2350, 1100), "ear_lobe.L": (2287, 1300), "tragus.L": (2269, 1150),
        },
        contour_far=[(1481, 1100), (1500, 1225), (1529, 1379), (1579, 1470), (1636, 1545)],
        contour_jaw=[(1771, 1610), (1857, 1603), (1957, 1610), (2029, 1600), (2100, 1560), (2157, 1505)],
        contour_near=[(2250, 1312), (2225, 1425), (2162, 1512)],
        clothes=dict(name="camicia", color=(0.93, 0.93, 0.94), rough=0.72, sheen=0.1, nstrength=0.35),
        skin=(0.84, 0.66, 0.58), hair=(0.06, 0.045, 0.04), sclera=(0.74, 0.65, 0.61), iris=(0.16, 0.085, 0.05),
        hair_region=(1500, 430, 700, 170), skin_patch=(1700, 700, 300, 150), lip_patch=(1790, 1425, 110, 18),
        hair_lum=0.30,
        paint=dict(brow_in=(14.0, 17.0), brow_peak=(34.0, 24.0), brow_out=(52.0, 16.0),
                   brow_half=[5.0, 4.6, 3.6, 2.4, 1.2], brow_density=1.0, brow=(0.05, 0.036, 0.03),
                   beard=0.0, shadow=0.10, lash=(0.035, 0.028, 0.025), mouth_x=24.0,
                   lip_line=0.0, lip_skin=0.45, cheek_red=0.30,
                   skin=(0.82, 0.62, 0.50), hair_rgb=(0.085, 0.06, 0.045), hair_hi=(0.19, 0.13, 0.09), card_min_y=50.0,
                   crown=(0.0, 112.0, -110.0), comb=(0.0, 0.55, 1.0), strand_w=0.30, strand_l=9.0,
                   curl=0.15, curl_l=14.0, clump=6.0,
                   cards=420, card_len=0.026, card_w=0.020, card_lift=0.55, card_curl=0.6, card_twist=0.3,
                   fringe=0, card_room=0.006,
                   biscuit=(0.90, 0.83, 0.73), biscuit_eye=(0.94, 0.90, 0.83), umber=(0.11, 0.08, 0.06),
                   umber_light=(0.28, 0.20, 0.15), glaze=0.92, lash_glaze=0.55, groove_w=0.8, groove_l=14.0,
                   lobe=0.0015, lobe_l=10.0, beard_relief=0.0, brow_relief=0.0008, smile_asym=0.0,
                   lock_w=9.0, lock_l=30.0, lock_amp=0.003, locks=0, lock_min_y=58.0, lock_len=0.032,
                   lock_wid=0.017, lock_th=0.0065, lock_lift=0.55, lock_curl=0.15, base_smile=1.0,
                   skin_toon=(0.96, 0.65, 0.48), lip_toon=(0.82, 0.46, 0.42), stubble=(0.2, 0.14, 0.1),
                   hair_toon=(0.10, 0.068, 0.05), hair_toon_hi=(0.32, 0.22, 0.15),
                   iris_in=(0.60, 0.34, 0.13), iris_out=(0.28, 0.14, 0.06), eye_scale=1.42, eye_scale_y=2.25, eye_fall=0.06, eye_smooth=10,
                   iris_frac=0.60, pupil_frac=0.22, brow_half_toon=[7.2, 6.8, 5.8, 4.2, 2.0], nose_back=0.005, cheek_puff=0.006, sym=1.0, smooth=8, head_scale=1.38, face_widen=0.11, jaw_short=0.8,
                   nose_bulb=0.0022, top_boost=0.009, smile_out=7.0, smile_up=8.0, smile_upper=4.8, smile_lower=7.0, side_trim=0.55, edge_soft=7.0),
        style="cartoon",
    ),
}
P_ = PEOPLE[WHO]
MODE = P_.get("style", "realistico")
SIZE = P_["size"]; FPX = P_["f"]; CX = CY = SIZE / 2.0
WEIGHT = {"gonion": 0.1, "brow": 0.4, "mouth": 0.5, "lid": 0.6}


def lm_weight(name):
    for k, w in WEIGHT.items():
        if name.startswith(k):
            return w
    return 1.0


def new_mat(name):
    m = bpy.data.materials.new(name)
    if not m.node_tree:
        m.use_nodes = True
    return m


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- scena pulita, foto in memoria
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
os.makedirs(TEX, exist_ok=True); os.makedirs(RENDER, exist_ok=True)
photo = bpy.data.images.load(P_["photo"]); photo.colorspace_settings.name = "sRGB"
_px = np.empty(SIZE * SIZE * 4, np.float32); photo.pixels.foreach_get(_px)
PX = _px.reshape(SIZE, SIZE, 4)[::-1].copy(); del _px          # riga 0 = alto, valori sRGB
small = PX[::4, ::4]
BG = ((small[..., :3].max(2) - small[..., :3].min(2)) < 0.05) & (small[..., :3].mean(2) > 0.55) | (small[..., 3] < 0.5)
BG_WIDE = BG.copy()
for _ in range(3):
    b2 = BG_WIDE.copy()
    b2[1:] |= BG_WIDE[:-1]; b2[:-1] |= BG_WIDE[1:]; b2[:, 1:] |= BG_WIDE[:, :-1]; b2[:, :-1] |= BG_WIDE[:, 1:]
    BG_WIDE = b2


def sample_mask(mask, pq):
    qi = np.clip((pq / 4).astype(int), 0, SIZE // 4 - 1)
    inside = (pq[:, 0] >= 0) & (pq[:, 0] < SIZE) & (pq[:, 1] >= 0) & (pq[:, 1] < SIZE)
    return np.where(inside, mask[qi[:, 1], qi[:, 0]], True)


def sample_px(pq):
    qi = np.clip(pq.astype(int), 0, SIZE - 1)
    return PX[qi[:, 1], qi[:, 0], :3]


def patch_image(name, box):
    x0, y0, w, h = box
    a = PX[y0:y0 + h, x0:x0 + w].copy()[::-1]
    a[..., 3] = 1.0
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.colorspace_settings.name = "sRGB"
    img.pixels.foreach_set(a.ravel())
    return img


# ---------------------------------------------------------------- 1. testa media e punti sorgente
bm, _, _ = H.build_template(n_around=100)
bvh0 = BVHTree.FromBMesh(bm)
face_names = [n for n in P_["pts"] if n.split(".")[0] not in H.EAR_KEYS]
src_face = {}
for n in face_names:
    s = H.surface_point(bvh0, n)
    if s is None:
        print("punto non trovato sul modello:", n)
    else:
        src_face[n] = s
face_names = list(src_face)

# infittimento di occhi e bocca, aperture palpebrali (tutto nello spazio canonico)
PT.refine(bm, [(8, 56, -16, 16, -30)], cuts=2)
PT.refine(bm, [(0, 38, -86, -56, -20)], cuts=1)
PT.cut_eye_holes(bm)
_ml = MO.cut_mouth(bm, P_["paint"]["mouth_x"])
MO.add_mouth_interior(bm, _ml, P_["paint"]["mouth_x"])
bm.verts.ensure_lookup_table()
MOUTH = np.array([v[_ml] for v in bm.verts])
lid_l = bm.verts.layers.int["lid"]; side_l = bm.verts.layers.int["eye_side"]
LID = np.array([v[lid_l] for v in bm.verts]); EYE_SIDE = np.array([v[side_l] for v in bm.verts])
canon_head = PT.canon_array(bm.verts)
bmL, _, keysL = H.build_ear(+1)
bmR, _, keysR = H.build_ear(-1)
NH = len(bm.verts); NE = len(bmL.verts)
allv = np.vstack([np.array([list(v.co) for v in b.verts]) for b in (bm, bmL, bmR)])
canon_all = np.vstack([canon_head, PT.canon_array(bmL.verts), PT.canon_array(bmR.verts)])
NV = len(allv)
LID = np.concatenate([LID, np.zeros(2 * NE, int)]); EYE_SIDE = np.concatenate([EYE_SIDE, np.zeros(2 * NE, int)])
MOUTH = np.concatenate([MOUTH, np.zeros(2 * NE, int)])
IS_HEAD = np.arange(NV) < NH

# corrispondenze a specchio (x -> -x) nello spazio canonico
kd = KDTree(NV)
for i, c in enumerate(canon_all):
    kd.insert(c, i)
kd.balance()
partner = np.array([kd.find((-c[0], c[1], c[2]))[1] for c in canon_all])
partner[NH:NH + NE] = np.arange(NH + NE, NH + 2 * NE)
partner[NH + NE:] = np.arange(NH, NH + NE)

# ---------------------------------------------------------------- mesh unica (testa + orecchie)
def make_mesh(verts, name):
    comb = bmesh.new()
    me_tmp = bpy.data.meshes.new("_t")
    for b in (bm, bmL, bmR):
        b.to_mesh(me_tmp); comb.from_mesh(me_tmp)
    bpy.data.meshes.remove(me_tmp)
    comb.verts.ensure_lookup_table()
    for v, co in zip(comb.verts, verts):
        v.co = Vector(co)
    me = bpy.data.meshes.new(name)
    comb.to_mesh(me); comb.free()
    for p in me.polygons:
        p.use_smooth = True
    me.update()
    return me


# ---------------------------------------------------------------- 2. camera della foto
src = np.array([src_face[n] for n in face_names])
uv = np.array([P_["pts"][n] for n in face_names], float)
w = np.array([lm_weight(n) for n in face_names])
if P_["yaw"] is None:
    _me = make_mesh(allv, "_y"); _N = np.array([list(v.normal) for v in _me.vertices]); bpy.data.meshes.remove(_me)
    _FS = P_["far_side"]
    _cand = IS_HEAD & (canon_all[:, 0] * _FS > 10) & (canon_all[:, 2] > -75) & (canon_all[:, 1] > -110) & (canon_all[:, 1] < 40)
    best_ = None
    for yaw_ in range(-40, 41, 3):
        p_, e_ = H.solve_camera_fixed_yaw(src, uv, w, FPX, CX, CY, float(yaw_))
        pq_, _ = H.project(allv, p_, FPX, CX, CY)
        vw = p_[3:6] - allv; vw /= np.linalg.norm(vw, axis=1)[:, None]
        sil = _cand & (np.abs((_N * vw).sum(1)) < 0.2)
        ec = []
        for (u_, v_) in P_["contour_far"][:3]:
            band = sil & (np.abs(pq_[:, 1] - v_) < 12)
            if band.any():
                ec.append((pq_[band, 0] * _FS).max() - u_ * _FS)
        ecr = math.sqrt(np.mean(np.square(ec))) if ec else 99.0
        cost = e_ ** 2 + ecr ** 2
        print(f"   yaw {yaw_:4d}: punti {e_:5.1f} px  contorno {ecr:5.1f} px")
        if best_ is None or cost < best_[0]:
            best_ = (cost, yaw_)
    P_["yaw"] = float(best_[1])
    print("rotazione scelta:", P_["yaw"])
params, err = H.solve_camera_fixed_yaw(src, uv, w, FPX, CX, CY, P_["yaw"])
cam_pos = params[3:6]
q, _ = H.project(src, params, FPX, CX, CY)
print(f"camera: errore medio {err:.1f} px  posizione {np.round(cam_pos, 3)}  yaw {H.yaw_of(params):.1f}")
dst = H.image_plane_targets(src, uv, params, FPX, CX, CY)
for i, n_ in enumerate(face_names):
    if n_.startswith("gonion"):
        dst[i] = H.head_plane_target(src[i], uv[i], params, FPX, CX, CY)

# ancore: nuca, sommita', base del collo restano quelle medie
anchors = [(0, 40, -186), (55, 40, -160), (-55, 40, -160), (0, 100, -150), (60, 0, -150), (-60, 0, -150),
           (0, 122.5, -82), (0, -60, -125), (45, -60, -110), (-45, -60, -110)]
for a in range(0, 360, 30):
    t = math.radians(a)
    anchors.append((60 * math.sin(t), -240, -66 + 55 * math.cos(t)))
anc = np.array([allv[int(np.argmin(np.linalg.norm(canon_head - np.array(a), axis=1)))] for a in anchors])

STAGES = []                                   # deformazioni in sequenza (per i punti aggiunti dopo, es. occhi)


def warp_pts(p):
    for S_, D_ in STAGES:
        p = H.tps_warp(S_, D_, p)
    return p


SRC = np.vstack([src, anc]); DST = np.vstack([dst, anc])
STAGES.append((SRC, DST))
warped = H.tps_warp(SRC, DST, allv)


# contorno lontano: il bordo del viso deve combaciare con la foto
PIN = DST.copy()
for it in range(2):
    me = make_mesh(warped, "_c")
    nrm = np.array([list(v.normal) for v in me.vertices]); bpy.data.meshes.remove(me)
    view = cam_pos - warped; view /= np.linalg.norm(view, axis=1)[:, None]
    facing = (nrm * view).sum(1)
    pq, _ = H.project(warped, params, FPX, CX, CY)
    cs, cdst = [], []
    FS = P_["far_side"]
    cand = IS_HEAD & (canon_all[:, 0] * FS > 10) & (canon_all[:, 2] > -75) & (np.abs(facing) < 0.25)
    cand_n = IS_HEAD & (canon_all[:, 0] * FS < -10) & (canon_all[:, 2] > -75) & (np.abs(facing) < 0.25)
    for (u, v), side_ in [(q_, 1) for q_ in P_["contour_far"]] + [(q_, -1) for q_ in P_.get("contour_near", [])]:
        band = (cand if side_ > 0 else cand_n) & (np.abs(pq[:, 1] - v) < 12)
        if not band.any():
            continue
        i = np.where(band)[0][np.argmax(pq[band, 0] * FS * side_)]
        if np.linalg.norm(PIN - warped[i], axis=1).min() < 0.002:
            continue
        cs.append(warped[i])
        cdst.append(H.image_plane_targets(warped[i:i + 1], np.array([[u, pq[i, 1]]]), params, FPX, CX, CY)[0])
        print(f"   contorno giro {it} v={v}: u modello {pq[i, 0]:.0f} -> foto {u}")
    candj = IS_HEAD & ~((np.abs(canon_all[:, 0]) < 32) & (canon_all[:, 1] > -92)) & (canon_all[:, 1] < -50) & (canon_all[:, 1] > -140) & (canon_all[:, 2] > -95) & (np.abs(facing) < 0.25)
    for (u, v) in P_.get("contour_jaw", []):
        if not candj.any():
            break
        dd = np.linalg.norm(pq[candj] - np.array([u, v]), axis=1)
        i = np.where(candj)[0][np.argmin(dd)]
        candj[i] = False                               # un vertice, un solo vincolo
        if dd.min() > 95 or np.linalg.norm(PIN - warped[i], axis=1).min() < 0.002:
            continue
        cs.append(warped[i])
        cdst.append(H.image_plane_targets(warped[i:i + 1], np.array([[u, v]], float), params, FPX, CX, CY)[0])
        print(f"   mandibola giro {it}: ({pq[i, 0]:.0f},{pq[i, 1]:.0f}) -> ({u},{v})")
    if not cs:
        break
    S2, D2 = np.vstack([PIN, cs]), np.vstack([PIN, cdst])
    STAGES.append((S2, D2))
    warped = H.tps_warp(S2, D2, warped)
    PIN = D2

# ---------------------------------------------------------------- cavita' e denti dentro la testa dopo la deformazione
def _inside(bvh, pts, dirs=((0, -1, 0), (0, 1, 0), (1, 0, 0), (-1, 0, 0), (0, 0, -1))):
    """dentro se in tutte le direzioni il raggio incontra la pelle"""
    ok = np.ones(len(pts), bool)
    for d in dirs:
        dv = Vector(d)
        for i, p in enumerate(pts):
            if ok[i] and bvh.ray_cast(Vector(p), dv, 0.3)[0] is None:
                ok[i] = False
    return ok


_skin = make_mesh(warped, "_s")
_bms = bmesh.new(); _bms.from_mesh(_skin); _bms.verts.ensure_lookup_table()
_inner = set(np.where(MOUTH[:len(_bms.verts)] >= 3)[0].tolist())
bmesh.ops.delete(_bms, geom=[f for f in _bms.faces if any(v.index in _inner for v in f.verts)], context="FACES")
_bvh = BVHTree.FromBMesh(_bms); _bms.free(); bpy.data.meshes.remove(_skin)
_mi = np.where(MOUTH >= 5)[0]
_cen = warped[MOUTH == 7].mean(0)
_out = ~_inside(_bvh, warped[_mi])
for _ in range(12):
    if not _out.any():
        break
    warped[_mi[_out]] = _cen + (warped[_mi[_out]] - _cen) * 0.9
    _out = ~_inside(_bvh, warped[_mi])
print(f"bocca interna: {len(_mi)} vertici, ancora fuori {int(_out.sum())}")

# ---------------------------------------------------------------- 3. orecchie: apertura, rotazione e scala sui punti della foto
ear_names = [n for n in P_["pts"] if n.split(".")[0] in H.EAR_KEYS]
ear_side = -1 if ear_names[0].endswith(".R") else 1
e_keys, e_off = (keysR, NH + NE) if ear_side < 0 else (keysL, NH)
kidx = [e_keys[n.split(".")[0]] for n in ear_names]
pivR = warped[NH + NE + keysR["tragus"]].copy(); pivL = warped[NH + keysL["tragus"]].copy()
ear_prm, ear_res = PT.fit_ear(warped[e_off + np.array(kidx)], np.array([P_["pts"][n] for n in ear_names], float),
                              pivR if ear_side < 0 else pivL, ear_side, params, FPX, CX, CY)
print(f"orecchio: apertura {math.degrees(ear_prm[0]):.1f} gradi, rotazione {math.degrees(ear_prm[1]):.1f}, "
      f"scala {ear_prm[2]:.3f}, spostamento {ear_prm[3]*1000:.1f}/{ear_prm[4]*1000:.1f} mm; residui px "
      + " ".join(f"{n.split('.')[0]}:{r:.0f}" for n, r in zip(ear_names, ear_res)))
warped[NH + NE:] = PT.ear_transform(warped[NH + NE:], pivR, -1, ear_prm)
warped[NH:NH + NE] = PT.ear_transform(warped[NH:NH + NE], pivL, 1, ear_prm)

# ---------------------------------------------------------------- stile animato: viso simmetrico e liscio, occhi grandi
if MODE == "cartoon":
    _cp = P_["paint"]
    _tm = make_mesh(warped, "_s0"); _E = PT.edge_array(_tm); bpy.data.meshes.remove(_tm)
    _mir = warped[partner] * np.array([-1.0, 1.0, 1.0])
    _sym = _cp.get("sym", 1.0)
    warped[IS_HEAD] = warped[IS_HEAD] * (1 - _sym) + 0.5 * (warped[IS_HEAD] + _mir[IS_HEAD]) * _sym
    _fix = ~IS_HEAD | (LID > 0) | (MOUTH > 0)
    for _ in range(_cp.get("smooth", 6)):
        for _lam in (0.5, -0.53):                      # Taubin: liscia senza restringere
            _acc = np.zeros_like(warped); _cnt = np.zeros(NV)
            np.add.at(_acc, _E[:, 0], warped[_E[:, 1]]); np.add.at(_cnt, _E[:, 0], 1)
            np.add.at(_acc, _E[:, 1], warped[_E[:, 0]]); np.add.at(_cnt, _E[:, 1], 1)
            _avg = _acc / np.maximum(_cnt, 1)[:, None]
            _mv = ~_fix & (_cnt > 0)
            warped[_mv] += _lam * (_avg[_mv] - warped[_mv])
    _s = _cp.get("eye_scale", 1.0); _sy = _cp.get("eye_scale_y", _s)
    _rimL = (LID == 1) | (LID == 2)
    def _eye_box(tag):
        for sd in (1, -1):
            r_ = warped[_rimL & (EYE_SIDE == sd)]
            print(f"   occhio {sd:+d} {tag}: largo {np.ptp(r_[:, 0]) * 1000:.1f} mm, alto {np.ptp(r_[:, 2]) * 1000:.1f} mm")
    _eye_box("prima")
    for _c in warp_pts(np.array([list(H.c2b(c)) for c in ((31.5, -0.5, -10.2), (-31.5, -0.5, -10.2))])):
        _d = np.linalg.norm(warped - _c, axis=1)
        _w = smoothstep(_cp.get("eye_fall", 0.040), 0.018, _d) * IS_HEAD
        _k = np.stack([1 + (_s - 1) * _w, 1 + (_s - 1) * _w, 1 + (_sy - 1) * _w], 1)     # X, profondita', alto
        warped = _c + (warped - _c) * _k
    for _ in range(_cp.get("eye_smooth", 4)):              # raccorda la zona degli occhi ingranditi
        for _lam in (0.5, -0.53):
            _acc = np.zeros_like(warped); _cnt = np.zeros(NV)
            np.add.at(_acc, _E[:, 0], warped[_E[:, 1]]); np.add.at(_cnt, _E[:, 0], 1)
            np.add.at(_acc, _E[:, 1], warped[_E[:, 0]]); np.add.at(_cnt, _E[:, 1], 1)
            _avg = _acc / np.maximum(_cnt, 1)[:, None]
            _mv = ~_fix & (_cnt > 0)
            warped[_mv] += _lam * (_avg[_mv] - warped[_mv])
    _eye_box("dopo")
    _cx, _cy0, _cz = canon_all[:, 0], canon_all[:, 1], canon_all[:, 2]
    _fr = IS_HEAD.astype(float)
    warped[:, 0] *= 1 + _cp.get("face_widen", 0.0) * _fr
    _jk = _cp.get("jaw_short", 1.0)
    warped[:, 2] += IS_HEAD * (_jk - 1) * np.clip(_cy0 + 45.0, -95.0, 0.0) / 1000.0
    _tm = make_mesh(warped, "_s1"); _nr = np.array([list(v.normal) for v in _tm.vertices]); bpy.data.meshes.remove(_tm)
    _ax = np.abs(canon_all[:, 0]); _cy = canon_all[:, 1]
    _ch = np.exp(-(((_ax - 42) / 15.0) ** 2 + ((_cy + 32) / 15.0) ** 2)) * IS_HEAD * (canon_all[:, 2] > -60) * (MOUTH == 0)
    warped = warped + _nr * (_cp.get("cheek_puff", 0.0) * _ch)[:, None]
    _nz = np.exp(-((_ax / 10.0) ** 2 + ((_cy + 30) / 15.0) ** 2)) * IS_HEAD * (canon_all[:, 2] > -5) * (MOUTH == 0)
    warped[:, 1] += _cp.get("nose_back", 0.0) * _nz                 # +Y = verso la nuca: naso meno sporgente
    _nb = np.exp(-((_ax / 8.0) ** 2 + ((_cy + 37) / 7.0) ** 2)) * IS_HEAD * (canon_all[:, 2] > 0) * (MOUTH == 0)
    warped = warped + _nr * (_cp.get("nose_bulb", 0.0) * _nb)[:, None]
    print(f"stile animato: viso simmetrico e lisciato, occhi x{_s:.2f}, guance +{_cp.get('cheek_puff', 0) * 1000:.1f} mm")

# ---------------------------------------------------------------- bulbi oculari e bordo delle palpebre appoggiato sul bulbo
eye_c_canon = np.array([[31.5, -0.5, -10.2], [-31.5, -0.5, -10.2]])
eye_c = warp_pts(np.array([list(H.c2b(c)) for c in eye_c_canon]))
R_EYE = 0.012 * (P_["paint"].get("eye_scale", 1.0) * 1.04 if MODE == "cartoon" else 1.0)
_tmp = make_mesh(warped, "_e"); EDGES = PT.edge_array(_tmp); bpy.data.meshes.remove(_tmp)
for k, side, pname in ((0, 1, "pupil.L"), (1, -1, "pupil.R")):
    # guarda in camera nella foto: centro del bulbo sul raggio camera -> pupilla
    sel_rim = ((LID == 1) | (LID == 2)) & (EYE_SIDE == side)
    if MODE == "cartoon":
        _rc = warped[sel_rim].mean(0)
        c = np.array([_rc[0], eye_c[k][1], _rc[2]]); ray = np.array([0.0, 1.0, 0.0])
    else:
        c = H.image_plane_targets(eye_c[k][None], np.array([P_["pts"][pname]], float), params, FPX, CX, CY)[0]
        ray = (c - cam_pos) / np.linalg.norm(c - cam_pos)
    sel_fold = (LID == 3) & (EYE_SIDE == side)
    rim = warped[sel_rim]
    for _ in range(12):
        rel = rim - c
        off_axis = np.linalg.norm(rel - np.outer(rel @ ray, ray), axis=1)
        d = np.linalg.norm(rel, axis=1) - R_EYE
        near_ax = off_axis < 0.0095
        c = c - ray * np.median(d[near_ax] if near_ax.sum() > 4 else d) / 0.85
    eye_c[k] = c
    d0 = np.linalg.norm(warped[sel_rim] - c, axis=1) - R_EYE
    disp = np.zeros_like(warped)
    if MODE == "cartoon":
        _v = warped[sel_rim] - c
        disp[sel_rim] = c + _v / np.linalg.norm(_v, axis=1)[:, None] * (R_EYE + 0.0003) - warped[sel_rim]
    else:
        disp[sel_rim] = PT.view_ray_conform(warped[sel_rim], c, R_EYE + 0.0003, cam_pos) - warped[sel_rim]
    v = warped[sel_fold] - c
    disp[sel_fold] = c + v / np.linalg.norm(v, axis=1)[:, None] * (R_EYE - 0.0008) - warped[sel_fold]
    region = IS_HEAD & (np.linalg.norm(warped - c, axis=1) < R_EYE + 0.010)
    fixed = ~region | sel_rim | sel_fold
    for ax in range(3):
        disp[:, ax] = PT.diffuse(disp[:, ax], fixed, EDGES, IS_HEAD, iters=250)
    warped += disp
    near = region & ~sel_rim & ~sel_fold
    dd = np.linalg.norm(warped - c, axis=1)
    pushed = near & (dd < R_EYE + 0.0006)
    warped[pushed] = c + (warped[pushed] - c) / dd[pushed][:, None] * (R_EYE + 0.0006)
    print(f"occhio {'sinistro' if side > 0 else 'destro'}: centro {np.round(c * 1000, 1)} mm; bordo palpebra prima "
          f"{np.round(np.percentile(d0 * 1000, [5, 50, 95]), 1)} mm dal bulbo, ora 0.3; pelle spinta fuori {int(pushed.sum())}")

STYLE = MODE in ("scultura", "cartoon")              # capelli pieni, attaccatura netta, niente card
SCULPT = MODE == "scultura"
TOON = MODE == "cartoon"
if STYLE:
    # barba e sopracciglia scolpite: la superficie si alza di qualche millimetro, con bordi morbidi
    _cp = P_["paint"]
    _tm = make_mesh(warped, "_n"); _nr = np.array([list(v.normal) for v in _tm.vertices]); bpy.data.meshes.remove(_tm)
    _x, _y, _z = canon_all[:, 0], canon_all[:, 1], canon_all[:, 2]
    _free = IS_HEAD & (MOUTH == 0) & (LID == 0)
    relief = np.zeros(NV)
    if _cp.get("beard", 0) > 0 and _cp.get("beard_relief", 0) > 0:
        _bd = PA.beard_density(_x, _y, _z, _cp) * _cp["beard"]
        _lump = PA.fbm(canon_all / 6.0, 2, 77) - 0.5
        relief += (_cp["beard_relief"] * PA.ss(0.12, 0.55, _bd) * (1 + 0.35 * _lump))
    if _cp.get("brow_relief", 0) > 0:
        _bm = np.zeros(NV)
        for _sd in (1, -1):
            _yc, _hf, _ins, _ = PA.brow_curve(_x, _sd, _cp)
            _bm = np.maximum(_bm, PA.ss(_hf + 1.2, _hf - 0.6, np.abs(_y - _yc)) * _ins * (_sd * _x > 0) * (_z > -40))
        relief += _cp["brow_relief"] * _bm
    relief *= _free
    warped = warped + _nr * relief[:, None]
    print(f"rilievi scolpiti: barba max {relief.max() * 1000:.1f} mm")

# ---------------------------------------------------------------- oggetto testa
me = make_mesh(warped, f"{WHO}_testa")
head = bpy.data.objects.new(f"{WHO}_testa", me)
scene.collection.objects.link(head)
nrm = np.array([list(v.normal) for v in me.vertices])
loops_v = np.zeros(len(me.loops), int); me.loops.foreach_get("vertex_index", loops_v)
cx_, cy_, cz_ = canon_all[:, 0], canon_all[:, 1], canon_all[:, 2]
POLE = int(np.argmax(np.where(IS_HEAD, cy_, -1e9)))


def cyl_uv(vi, y0, y1, v0, v1):
    u = 0.5 + np.arctan2(cx_[vi], cz_[vi] + 80.0) / (2 * math.pi)
    vv = v0 + (np.clip(cy_[vi], y0, y1) - y0) / (y1 - y0) * (v1 - v0)
    pole = vi == POLE
    if (~pole).any() and u[~pole].max() - u[~pole].min() > 0.5:
        u = np.where(u < 0.5, u + 1.0, u)
    if pole.any() and (~pole).any():
        u[pole] = u[~pole].mean()
    return u, vv


# UV finali: cilindro sulla testa, isole per le orecchie in alto
V_HEAD = 0.86
uvf = np.zeros((len(me.loops), 2))
for poly in me.polygons:
    li = list(poly.loop_indices); vi = loops_v[li]
    if vi[0] < NH and (MOUTH[vi] >= 5).all():
        uvf[li, 0], uvf[li, 1] = 0.985, 0.985
    elif vi[0] < NH:
        uvf[li, 0], uvf[li, 1] = cyl_uv(vi, -240.0, 122.5, 0.0, V_HEAD)
    else:
        right = vi[0] >= NH + NE
        local = vi - (NH + NE if right else NH)
        front = (local % 2 == 0).all()
        p = -(cz_[vi] - H.EAR_ORIGIN[2]); qq = cy_[vi] - H.EAR_ORIGIN[1]
        uvf[li, 0] = 0.02 + (0.10 if right else 0.0) + (0.0 if front else 0.20) + p * 0.0021
        uvf[li, 1] = V_HEAD + 0.005 + (qq + 31.0) * 0.0021
me.uv_layers.new(name="UVMap").data.foreach_set("uv", uvf.ravel())

# ---------------------------------------------------------------- bulbi oculari
iris = []
for nm in ("pupil.R", "pupil.L"):
    u0, v0 = P_["pts"][nm]
    yy, xx = np.mgrid[-30:31, -30:31]
    rr = np.hypot(xx, yy)
    ring = PX[v0 + yy[(rr > 11) & (rr < 25)], u0 + xx[(rr > 11) & (rr < 25)], :3]
    ring = ring[ring.mean(1) < 0.5]
    iris.append(np.median(ring, 0))
iris_rgb = np.array(P_["iris"]) if "iris" in P_ else np.mean(iris, 0) * 1.25
print("iride (sRGB):", np.round(iris_rgb, 3))
if MODE == "cartoon":
    eye_img = PA.eye_texture_cartoon(f"{WHO}_occhio", P_["paint"], R_EYE * 1000)
elif MODE == "scultura":
    eye_img = PA.eye_texture_porcelain(f"{WHO}_occhio", P_["paint"])
else:
    eye_img = PT.eye_texture(f"{WHO}_occhio", iris_rgb, P_["sclera"])
eye_img.filepath_raw = os.path.join(TEX, f"{WHO}_occhio.jpg"); eye_img.file_format = "JPEG"; eye_img.save(quality=92)
mat_eye = new_mat(f"{WHO}_occhio")
nt = mat_eye.node_tree
b_ = nt.nodes["Principled BSDF"]
ti = nt.nodes.new("ShaderNodeTexImage"); ti.image = eye_img
nt.links.new(ti.outputs["Color"], b_.inputs["Base Color"])
b_.inputs["Roughness"].default_value = 0.25
b_.inputs["Coat Weight"].default_value = 1.0
b_.inputs["Coat Roughness"].default_value = 0.03
mat_pupil = None
if MODE == "cartoon":
    b_.inputs["Roughness"].default_value = 0.3; b_.inputs["Coat Weight"].default_value = 1.0
    b_.inputs["Coat Roughness"].default_value = 0.02
if MODE == "scultura":
    b_.inputs["Roughness"].default_value = 0.6; b_.inputs["Coat Weight"].default_value = 0.0
    mat_pupil = new_mat(f"{WHO}_pupilla")
    _pb = mat_pupil.node_tree.nodes["Principled BSDF"]
    _pb.inputs["Base Color"].default_value = (0.012, 0.009, 0.008, 1); _pb.inputs["Roughness"].default_value = 0.35
    _pb.inputs["Coat Weight"].default_value = 1.0; _pb.inputs["Coat Roughness"].default_value = 0.04
eyes = [PT.build_eyeball(f"{WHO}_occhio_{'L' if s > 0 else 'R'}", eye_c[k], R_EYE, mat_eye,
                         seg=40 if mat_pupil else 32, rings=28 if mat_pupil else 24, pupil_mat=mat_pupil)
        for k, s in enumerate((1, -1))]

# ---------------------------------------------------------------- visibilita' dalla camera della foto
def visibility(points, normals, occluders):
    bpy.context.view_layer.update()
    bmo = bmesh.new()
    for o in occluders:
        tmp = o.data.copy(); tmp.transform(o.matrix_world); bmo.from_mesh(tmp); bpy.data.meshes.remove(tmp)
    bvh = BVHTree.FromBMesh(bmo); bmo.free()
    view = cam_pos - points; dist = np.linalg.norm(view, axis=1); view = view / dist[:, None]
    fac = (normals * view).sum(1)
    vis = np.zeros(len(points))
    for i in np.where(fac > 0.05)[0]:
        o = Vector(points[i] + normals[i] * 2e-4 + view[i] * 2e-4)
        vis[i] = 0.0 if bvh.ray_cast(o, Vector(view[i]), float(dist[i]))[0] is not None else 1.0
    return fac, vis


facing, vis = visibility(warped, nrm, [head] + eyes)
pq, _ = H.project(warped, params, FPX, CX, CY)
w_photo = smoothstep(0.12, 0.42, facing) * vis * (~sample_mask(BG_WIDE, pq))
w_mirror = w_photo[partner] * (1.0 - w_photo) ** 2

# ---------------------------------------------------------------- 4. capelli: zona, spessore dal contorno, guscio
scalp_cand = IS_HEAD & (((cy_ > 30) & (cz_ > -60)) | ((cy_ > 8) & (cz_ <= -60) & (cz_ > -112)) | ((cz_ <= -112) & (cy_ > -72)))
lum = sample_px(pq) @ np.array([0.299, 0.587, 0.114])
seen = w_photo > 0.3
hair = scalp_cand & np.where(seen, lum < P_["hair_lum"], True)
hair = scalp_cand & np.where(~seen & seen[partner], hair[partner], hair)
for _ in range(3):                                   # pulizia: maggioranza dei vicini
    s = np.zeros(NV); c = np.zeros(NV)
    np.add.at(s, EDGES[:, 0], hair[EDGES[:, 1]]); np.add.at(c, EDGES[:, 0], 1)
    np.add.at(s, EDGES[:, 1], hair[EDGES[:, 0]]); np.add.at(c, EDGES[:, 1], 1)
    hair = scalp_cand & (s / np.maximum(c, 1) > 0.5) | (hair & (s / np.maximum(c, 1) > 0.34))
hair &= scalp_cand
phi = np.degrees(np.arctan2(cx_, cz_ + 80.0))
frontside = IS_HEAD & (cz_ > -95) & (cy_ > -25)
bins = np.arange(-110.0, 111.0, 3.0)
hl = np.full(len(bins), np.nan)
for i_, b_ in enumerate(bins):
    m_ = hair & frontside & (np.abs(phi - b_) < 3.0)
    if m_.sum() >= 3:
        hl[i_] = np.percentile(cy_[m_], 5)
ok_ = ~np.isnan(hl)
hl = np.interp(bins, bins[ok_], hl[ok_])
for _ in range(3):
    hl = np.convolve(np.pad(hl, 2, mode="edge"), np.array([1, 4, 6, 4, 1]) / 16.0, mode="valid")
if MODE == "cartoon":                                    # linea pulita da film d'animazione
    _sel = np.abs(bins) <= 95
    hl = np.polyval(np.polyfit(bins[_sel], hl[_sel], 4), bins)
DH = np.where(frontside, cy_ - np.interp(phi, bins, hl), -30.0)     # mm sopra l'attaccatura (sotto = negativo)
hair = hair | (frontside & (DH > (-2.6 if MODE in ("scultura", "cartoon") else -5.0)) & (cy_ > -10))
if MODE in ("scultura", "cartoon"):
    hair &= ~(frontside & (DH < -2.6))
print("attaccatura (y canonico ogni 15 gradi):", np.round(np.interp(np.arange(-90, 91, 15), bins, hl), 0).tolist())
nbr_out = np.zeros(NV, bool)
np.logical_or.at(nbr_out, EDGES[:, 0], ~hair[EDGES[:, 1]]); np.logical_or.at(nbr_out, EDGES[:, 1], ~hair[EDGES[:, 0]])
border = hair & nbr_out
# spessore: dove il cranio e' di profilo per la camera, si avanza lungo la normale finche' la foto e' "soggetto"
T = np.zeros(NV); meas = np.zeros(NV, bool)
march = hair & (np.abs(facing) < 0.3) & ((cy_ > 25) | (cz_ < -110))
idx = np.where(march)[0]
alive = np.ones(len(idx), bool); last = np.zeros(len(idx))
for t in np.arange(0.0, 0.09, 0.0015):
    pp, _ = H.project(warped[idx] + nrm[idx] * t, params, FPX, CX, CY)
    alive &= ~sample_mask(BG, pp)
    last = np.where(alive, t, last)
T[idx] = last; meas[idx] = True
print(f"capelli: {int(hair.sum())} vertici, misurati sul contorno {int(meas.sum())}, spessore mediano "
      f"{np.median(last) * 1000:.1f} mm, max {last.max() * 1000:.1f} mm")
mi = meas & ~meas[partner]
T[partner[mi]] = T[mi]; meas[partner[mi]] = True
fixed = meas | border
T[border] = 0.0008
back_prior = hair & ~meas & (cz_ < -150)
T[back_prior] = 0.012; fixed |= back_prior
T = PT.diffuse(T, fixed, EDGES, hair, iters=600)
T = PT.diffuse(T, border, EDGES, hair, iters=8)           # ammorbidisce i valori misurati
T = np.clip(T, 0.0005, 0.08)
n_s = PT.smooth_vectors(nrm, EDGES, hair, iters=4)
rng = np.random.default_rng(3)
noise = np.zeros(NV)
for _ in range(7):
    d = rng.normal(size=3); d /= np.linalg.norm(d)
    lam = rng.uniform(0.022, 0.045)
    noise += np.sin(warped @ d * 2 * math.pi / lam + rng.uniform(0, 6.28))
noise *= 0.0035 / 7 ** 0.5 * np.clip(T / 0.015, 0, 1)
if STYLE:
    _el = np.linalg.norm(warped[EDGES[:, 0]] - warped[EDGES[:, 1]], axis=1)
    dist_b = np.where(border, 0.0, 1.0)
    _ok = hair[EDGES[:, 0]] & hair[EDGES[:, 1]]
    for _ in range(60):
        _nd = dist_b.copy()
        np.minimum.at(_nd, EDGES[_ok, 0], dist_b[EDGES[_ok, 1]] + _el[_ok])
        np.minimum.at(_nd, EDGES[_ok, 1], dist_b[EDGES[_ok, 0]] + _el[_ok])
        dist_b = _nd
    w_edge = np.where(frontside, smoothstep(-0.5, 3.0, DH), smoothstep(0.0, 0.006, dist_b))
    _cp = P_["paint"]
    _rid = PA.lock_ridges(canon_all, _cp, 1.0, 51)
    lobes = ((_rid - 0.5) * _cp["lock_amp"] + (PA.fbm(canon_all / _cp["lobe_l"], 3, 31) - 0.5) * 2 * _cp["lobe"])         * smoothstep(0.006, 0.02, T)
    w_edge = np.where(frontside, smoothstep(0.0, _cp.get("edge_soft", 3.5), DH), w_edge)
    T = T * (1 - _cp.get("side_trim", 0.0) * (1 - smoothstep(35.0, 80.0, cy_)))      # lati corti
    _boost = _cp.get("top_boost", 0.0) * smoothstep(60.0, 105.0, cy_) * (0.6 + 0.4 * smoothstep(-110.0, -40.0, cz_))
    T_SHELL = (T + lobes + _boost) * w_edge - 0.0004 * (1 - w_edge)
    base_pos = warped.copy()
    _snap = hair & frontside & border & (DH < 0)
    _acc = np.zeros_like(warped); _cnt = np.zeros(NV)
    for a_, b_ in ((EDGES[:, 0], EDGES[:, 1]), (EDGES[:, 1], EDGES[:, 0])):
        m_ = _snap[a_] & (DH[b_] > 0)
        t_ = (-DH[a_[m_]] / (DH[b_[m_]] - DH[a_[m_]]))[:, None]
        np.add.at(_acc, a_[m_], warped[a_[m_]] + t_ * (warped[b_[m_]] - warped[a_[m_]]))
        np.add.at(_cnt, a_[m_], 1)
    _ok2 = _cnt > 0
    base_pos[_ok2] = _acc[_ok2] / _cnt[_ok2][:, None]
    T_SHELL[_ok2] = -0.0003
    shell_pos = base_pos + n_s * T_SHELL[:, None]
    print(f"attaccatura: {int(_ok2.sum())} vertici del bordo agganciati alla curva")
else:
    T_SHELL = T - P_["paint"].get("card_room", 0.007) * smoothstep(0.008, 0.018, T)
    shell_pos = warped + n_s * (T_SHELL + noise)[:, None]

# guscio: copia delle facce della zona capelli
hv = np.where(hair)[0]
remap = -np.ones(NV, int); remap[hv] = np.arange(len(hv))
hfaces = [list(loops_v[list(p.loop_indices)]) for p in me.polygons if hair[loops_v[list(p.loop_indices)]].all()]
me_h = bpy.data.meshes.new(f"{WHO}_capelli")
me_h.from_pydata([tuple(p) for p in shell_pos[hv]], [], [[int(remap[i]) for i in f] for f in hfaces])
for p in me_h.polygons:
    p.use_smooth = True
me_h.update()
hair_ob = bpy.data.objects.new(f"{WHO}_capelli", me_h)
scene.collection.objects.link(hair_ob)
h_loops = np.zeros(len(me_h.loops), int); me_h.loops.foreach_get("vertex_index", h_loops)
uvh = np.zeros((len(me_h.loops), 2))
for poly in me_h.polygons:
    li = list(poly.loop_indices); vi = hv[h_loops[li]]
    uvh[li, 0], uvh[li, 1] = cyl_uv(vi, -90.0, 125.0, 0.0, 1.0)
me_h.uv_layers.new(name="UVMap").data.foreach_set("uv", uvh.ravel())
h_nrm = np.array([list(v.normal) for v in me_h.vertices])
h_fac, h_vis = visibility(shell_pos[hv], h_nrm, [head, hair_ob])
h_pq, _ = H.project(shell_pos[hv], params, FPX, CX, CY)
h_lum = sample_px(h_pq) @ np.array([0.299, 0.587, 0.114])
h_wp = smoothstep(0.1, 0.4, h_fac) * h_vis * (~sample_mask(BG_WIDE, h_pq)) * smoothstep(0.42, 0.30, h_lum)
h_partner = np.where(hair[partner[hv]], remap[partner[hv]], np.arange(len(hv)))
h_wm = h_wp[h_partner] * (1 - h_wp) ** 2


# ---------------------------------------------------------------- 5. texture dipinte (le foto danno solo i colori di riferimento)
def set_attr(mesh, name, arr, kind="FLOAT"):
    a = mesh.attributes.new(name, kind, "POINT")
    a.data.foreach_set("value" if kind == "FLOAT" else "color", np.asarray(arr, np.float32).ravel())


scene.render.engine = "CYCLES"
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
scene.cycles.samples = 1
TEXRES = 1024 if DRAFT else 2048
LUMW = np.array([0.299, 0.587, 0.114])


def photo_median(box, cond):
    x0, y0, w_, h_ = box
    a = PX[y0:y0 + h_, x0:x0 + w_, :3].reshape(-1, 3)
    return np.median(a[cond(a @ LUMW)], 0)


ref = dict(skin=photo_median(P_["skin_patch"], lambda l: l > 0.40),
           hair=photo_median(P_["hair_region"], lambda l: l < 0.30),
           lip=photo_median(P_["lip_patch"], lambda l: l > 0.25))
print("colori di riferimento (sRGB):", {k: np.round(v, 3).tolist() for k, v in ref.items()})
cfg = dict(P_["paint"])
cfg.setdefault("skin", tuple(np.clip(ref["skin"] * cfg.pop("skin_gain", 1.0), 0, 1)))
cfg.setdefault("lip", tuple(np.clip(ref["lip"] * cfg.pop("lip_gain", 1.0), 0, 1)))
cfg.setdefault("hair_rgb", tuple(np.clip(ref["hair"] * cfg.pop("hair_gain", 1.3), 0, 1)))
cfg.setdefault("cheek", tuple(np.clip(np.array(cfg["skin"]) * np.array([1.0, 0.82, 0.80]), 0, 1)))
cfg.setdefault("hair_hi", tuple(np.clip(np.array(cfg["hair_rgb"]) * np.array([2.0, 1.8, 1.6]), 0, 1)))

# pelle: mappe delle coordinate canoniche -> pittura
# capelli: distanza dal bordo della calotta (mm) per la frangia
he = PT.edge_array(me_h)
elen = np.linalg.norm(shell_pos[hv][he[:, 0]] - shell_pos[hv][he[:, 1]], axis=1)
deg = {}
for poly in me_h.polygons:
    for ek in poly.edge_keys:
        deg[ek] = deg.get(ek, 0) + 1
bnd = np.zeros(len(hv), bool)
for (a_, b_), c_ in deg.items():
    if c_ == 1:
        bnd[a_] = bnd[b_] = True
dist = np.where(bnd, 0.0, 1.0)
for _ in range(80):
    nd = dist.copy()
    np.minimum.at(nd, he[:, 0], dist[he[:, 1]] + elen); np.minimum.at(nd, he[:, 1], dist[he[:, 0]] + elen)
    dist = nd
cards_ob = None
if not STYLE:
    # card: ciocche che escono dalla calotta seguendo la direzione dei capelli (piu' fitte dove i capelli sono alti)
    CP = P_["paint"]
    rng_c = np.random.default_rng(11)
    hT = T[hv]
    okr = (hT > 0.005) & (dist > 0.004) & (canon_all[hv][:, 1] > CP.get("card_min_y", -999.0))
    prob = np.where(okr, hT, 0.0); prob /= prob.sum()
    ncard = CP.get("cards", 380) // (2 if DRAFT else 1)
    ridx = rng_c.choice(len(hv), size=ncard, replace=True, p=prob)
    def flow_b(cc):
        f = PA.flow_field(cc, cfg)
        return np.stack([f[:, 0], -f[:, 2], f[:, 1]], 1)
    Vc, Fc, UVc = PT.build_cards(shell_pos[hv][ridx], n_s[hv][ridx], flow_b(canon_all[hv][ridx]), rng_c,
                                 CP["card_len"], CP["card_w"], CP["card_lift"], CP["card_curl"], CP["card_twist"])
    # frangia: ciocche appena dietro l'attaccatura che ricadono sulla fronte
    _fx = CP.get("fringe_x", (-40.0, 40.0))
    fr = np.where((canon_all[hv][:, 2] > -45) & (DH[hv] > 1) & (DH[hv] < 14) &
                  (canon_all[hv][:, 0] > _fx[0]) & (canon_all[hv][:, 0] < _fx[1]))[0]
    if len(fr) and CP.get("fringe", 0):
        fsel = rng_c.choice(fr, size=CP["fringe"], replace=True)
        ff = np.stack([np.sign(canon_all[hv][fsel, 0]) * 0.25, -np.ones(len(fsel)), 0.6 * np.ones(len(fsel))], 1)
        ff /= np.linalg.norm(ff, axis=1)[:, None]
        V2, F2, UV2 = PT.build_cards(shell_pos[hv][fsel], n_s[hv][fsel], np.stack([ff[:, 0], -ff[:, 2], ff[:, 1]], 1), rng_c,
                                     CP["card_len"] * 0.9, CP["card_w"] * 0.8, 0.15, CP["card_curl"] * 1.4, CP["card_twist"])
        F2 = [tuple(i + len(Vc) for i in f) for f in F2]
        Vc = np.vstack([Vc, V2]); Fc = Fc + F2; UVc = UVc + UV2
    me_c = bpy.data.meshes.new(f"{WHO}_ciocche")
    me_c.from_pydata([tuple(v) for v in Vc], [], Fc)
    c_loops = np.zeros(len(me_c.loops), int); me_c.loops.foreach_get("vertex_index", c_loops)
    me_c.uv_layers.new(name="UVMap").data.foreach_set("uv", np.array(UVc)[c_loops].ravel())
    for p in me_c.polygons:
        p.use_smooth = True
    cards_ob = bpy.data.objects.new(f"{WHO}_ciocche", me_c)
    scene.collection.objects.link(cards_ob)
    print(f"card: {len(Fc)} nastri da {len(Vc)} vertici")
    atlas_rgb, atlas_a = PA.card_atlas(cfg, size=1024)
    card_img = PT.to_image(f"{WHO}_ciocche", atlas_rgb, atlas_a)
    card_img.filepath_raw = os.path.join(TEX, f"{WHO}_ciocche.png"); card_img.file_format = "PNG"; card_img.save()


if STYLE:
    # cuoio capelluto nascosto sotto la calotta: via (budget dei triangoli)
    _bmh = bmesh.new(); _bmh.from_mesh(me); _bmh.verts.ensure_lookup_table()
    _deep = set(np.where(hair & (T_SHELL > 0.002))[0].tolist())
    _dead = [f for f in _bmh.faces if all(v.index in _deep for v in f.verts)]
    bmesh.ops.delete(_bmh, geom=_dead, context="FACES_ONLY")
    _bmh.to_mesh(me); _bmh.free(); me.update()
    loops_v = np.zeros(len(me.loops), int); me.loops.foreach_get("vertex_index", loops_v)
    print(f"cuoio capelluto tolto: {len(_dead)} facce")
    # ciocche scolpite sulla calotta, nella direzione della pettinatura
    CP = P_["paint"]
if STYLE and P_["paint"].get("locks", 0) > 0:
    rng_c = np.random.default_rng(11)
    _ch = canon_all[hv]
    _okr = (T[hv] > 0.008) & (_ch[:, 1] > CP.get("lock_min_y", 30.0)) & \
        np.where(frontside[hv], DH[hv] > 5.0, dist_b[hv] > 0.008)
    _pr = np.where(_okr, T[hv], 0.0); _pr /= _pr.sum()
    _ri = rng_c.choice(len(hv), size=max(CP.get("locks", 110), 1), replace=False, p=_pr)
    _fl = PA.flow_field(_ch[_ri], cfg)
    Vc, Fc, UVc = PT.build_locks(shell_pos[hv][_ri], n_s[hv][_ri], np.stack([_fl[:, 0], -_fl[:, 2], _fl[:, 1]], 1),
                                 rng_c, CP["lock_len"], CP["lock_wid"], CP["lock_th"], CP["lock_lift"], CP["lock_curl"],
                                 around=CP.get("lock_around", 6), taper=CP.get("lock_taper", 0.82))
    me_c = bpy.data.meshes.new(f"{WHO}_ciocche")
    me_c.from_pydata([tuple(v) for v in Vc], [], Fc)
    c_loops = np.zeros(len(me_c.loops), int); me_c.loops.foreach_get("vertex_index", c_loops)
    me_c.uv_layers.new(name="UVMap").data.foreach_set("uv", np.array(UVc)[c_loops].ravel())
    for p_ in me_c.polygons:
        p_.use_smooth = True
    cards_ob = bpy.data.objects.new(f"{WHO}_ciocche", me_c)
    scene.collection.objects.link(cards_ob)
    _lc, _ln = PT.lock_texture(*((cfg["hair_toon"], cfg["hair_toon_hi"]) if TOON else (cfg["umber"], cfg["umber_light"])))
    lock_img = PT.to_image(f"{WHO}_ciocche", _lc)
    lock_img.filepath_raw = os.path.join(TEX, f"{WHO}_ciocche.jpg"); lock_img.file_format = "JPEG"; lock_img.save(quality=92)
    lock_nrm = PT.to_image(f"{WHO}_ciocche_normal", _ln); lock_nrm.colorspace_settings.name = "Non-Color"
    lock_nrm.filepath_raw = os.path.join(TEX, f"{WHO}_ciocche_normal.png"); lock_nrm.file_format = "PNG"; lock_nrm.save()
    print(f"ciocche scolpite: {CP.get('locks', 110)} ({len(Fc)} facce)")

# pelle: occlusione ambientale (con capelli e occhi) + coordinate canoniche -> pittura
head_maps = PA.bake_maps(head, me, {"canon": PA.enc_canon(canon_all),
                                    "scalp": np.stack([hair.astype(float), np.clip((DH + 20) / 40, 0, 1), np.zeros(NV)], 1)}, TEXRES)
head_maps["ao"] = PA.bake_ao(head, me, TEXRES, samples=16 if DRAFT else 64)
if STYLE:
    _alb, _hgt = (PA.paint_cartoon if TOON else PA.paint_biscuit)(head_maps, cfg)
    head_tex = PT.to_image(f"{WHO}_testa", _alb)
    head_nrm = PA.bake_normal(head, me, _hgt, TEXRES, strength=0.5 if TOON else 0.9, name=f"{WHO}_testa_normal")
    head_nrm.filepath_raw = os.path.join(TEX, f"{WHO}_testa_normal.png"); head_nrm.file_format = "PNG"; head_nrm.save()
else:
    head_tex = PT.to_image(f"{WHO}_testa", PA.paint_skin(head_maps, cfg))
head_tex.filepath_raw = os.path.join(TEX, f"{WHO}_testa.jpg"); head_tex.file_format = "JPEG"; head_tex.save(quality=92)

HAIRRES = 1024
hair_maps = PA.bake_maps(hair_ob, me_h, {"canon": PA.enc_canon(canon_all[hv]),
                                          "extra": np.stack([T[hv] / 0.04, np.clip(dist * 1000 / 20.0, 0, 1),
                                                             np.clip((DH[hv] + 20) / 40, 0, 1)], 1)}, HAIRRES)
if STYLE:
    hair_maps["ao"] = PA.bake_ao(hair_ob, me_h, HAIRRES, samples=16 if DRAFT else 48)
    hrgb, _hh = (PA.paint_hair_cartoon if TOON else PA.paint_hair_sculpt)(hair_maps, cfg)
    hair_rgba = PT.to_image(f"{WHO}_capelli", hrgb)
    hair_nrm = PA.bake_normal(hair_ob, me_h, _hh, HAIRRES, strength=1.0, name=f"{WHO}_capelli_normal")
    hair_nrm.filepath_raw = os.path.join(TEX, f"{WHO}_capelli_normal.png"); hair_nrm.file_format = "PNG"; hair_nrm.save()
else:
    hrgb, halpha = PA.paint_hair(hair_maps, cfg)
    hair_rgba = PT.to_image(f"{WHO}_capelli", hrgb, halpha)
hair_rgba.filepath_raw = os.path.join(TEX, f"{WHO}_capelli.png"); hair_rgba.file_format = "PNG"; hair_rgba.save()


# ---------------------------------------------------------------- materiali finali
def pbr(name, img, rough, sss=0.0, spec=0.4, alpha=False):
    m = new_mat(name)
    N = m.node_tree.nodes; L = m.node_tree.links
    b = N["Principled BSDF"]
    t = N.new("ShaderNodeTexImage"); t.image = img; t.interpolation = "Cubic"
    L.new(t.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    b.inputs["Specular IOR Level"].default_value = spec
    if sss:
        b.inputs["Subsurface Weight"].default_value = sss
        b.inputs["Subsurface Radius"].default_value = (1.0, 0.35, 0.2)
        b.inputs["Subsurface Scale"].default_value = 0.004
    if alpha:
        rd = N.new("ShaderNodeMath"); rd.operation = "ROUND"
        L.new(t.outputs["Alpha"], rd.inputs[0]); L.new(rd.outputs[0], b.inputs["Alpha"])
    return m


def add_normal(m, img, strength=1.0):
    N = m.node_tree.nodes; L = m.node_tree.links
    t = N.new("ShaderNodeTexImage"); t.image = img; t.interpolation = "Linear"
    nm = N.new("ShaderNodeNormalMap"); nm.inputs["Strength"].default_value = strength
    L.new(t.outputs["Color"], nm.inputs["Color"]); L.new(nm.outputs["Normal"], N["Principled BSDF"].inputs["Normal"])


if TOON:
    mat_skin = pbr(f"{WHO}_pelle", head_tex, 0.48, sss=0.22, spec=0.4)
    add_normal(mat_skin, head_nrm, 0.6)
    mat_hair = pbr(f"{WHO}_capelli", hair_rgba, 0.42, spec=0.5)
    add_normal(mat_hair, hair_nrm)
    if cards_ob is not None:
        mat_card = pbr(f"{WHO}_ciocche", lock_img, 0.42, spec=0.5)
        add_normal(mat_card, lock_nrm, 0.8)
elif STYLE:
    mat_skin = pbr(f"{WHO}_biscuit", head_tex, 0.62, spec=0.35)
    add_normal(mat_skin, head_nrm)
    mat_hair = pbr(f"{WHO}_capelli", hair_rgba, 0.7, spec=0.3)
    add_normal(mat_hair, hair_nrm)
    mat_card = pbr(f"{WHO}_ciocche", lock_img, 0.68, spec=0.3)
    add_normal(mat_card, lock_nrm, 0.8)
else:
    mat_skin = pbr(f"{WHO}_pelle", head_tex, 0.5, sss=0.15, spec=0.4)
    mat_hair = pbr(f"{WHO}_capelli", hair_rgba, 0.75, spec=0.25, alpha=True)
    mat_card = pbr(f"{WHO}_ciocche", card_img, 0.7, spec=0.25, alpha=True)
    for m_ in (mat_hair, mat_card):
        m_.use_backface_culling = False
me.materials.clear(); me.materials.append(mat_skin)
mat_teeth = new_mat(f"{WHO}_denti")
mat_teeth.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.86, 0.84, 0.80, 1) if TOON else ((0.82, 0.78, 0.70, 1) if STYLE else (0.78, 0.74, 0.66, 1))
mat_teeth.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.3
mat_mouth = new_mat(f"{WHO}_bocca")
mat_mouth.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.09, 0.025, 0.025, 1)
mat_mouth.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.6
me.materials.append(mat_teeth); me.materials.append(mat_mouth)
for poly in me.polygons:
    fl = MOUTH[loops_v[list(poly.loop_indices)]]
    if (fl == 7).all():
        poly.material_index = 2
    elif ((fl == 5) | (fl == 6)).all():
        poly.material_index = 1
me_h.materials.clear(); me_h.materials.append(mat_hair)
if cards_ob is not None:
    me_c.materials.clear(); me_c.materials.append(mat_card)


# ---------------------------------------------------------------- 6. busto, braccia, mani, abiti
HO = BD.HEAD_ORIGIN
HK = P_["paint"].get("head_scale", 1.0) if MODE == "cartoon" else 1.0
HPIV = Vector((0.0, 0.050, -0.118))                     # sotto il mento, nello spazio testa: resta fermo


def head_xf(p):
    return HPIV + (Vector(p) - HPIV) * HK


if HK != 1.0:
    _T = Matrix.Translation(HPIV) @ Matrix.Scale(HK, 4) @ Matrix.Translation(-HPIV)
    for ob_ in [o for o in (head, hair_ob, cards_ob) if o is not None]:
        ob_.data.transform(_T)
    for e_ in eyes:
        e_.location = head_xf(e_.location); e_.scale = (HK, HK, HK)
    print(f"testa ingrandita x{HK:.2f} rispetto al busto")
for ob_ in [o for o in (head, hair_ob, cards_ob) if o is not None] + eyes:
    ob_.location = ob_.location + HO
bpy.context.view_layer.update()
CL = P_["clothes"]


def cloth_material(name, color_lin, rough, sheen, normal_img=None, nstrength=0.5):
    m = new_mat(name)
    N = m.node_tree.nodes; L = m.node_tree.links
    b = N["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color_lin, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Sheen Weight"].default_value = sheen
    # tinta dello sheen dal colore del tessuto: con il bianco di default in three.js il dolcevita nero diventa grigio
    b.inputs["Sheen Tint"].default_value = (*(np.array(color_lin) * 0.9 + 0.01), 1)
    b.inputs["Specular IOR Level"].default_value = 0.3
    if CL.get("coat"):
        b.inputs["Coat Weight"].default_value = CL["coat"]; b.inputs["Coat Roughness"].default_value = CL["coat_rough"]
    if normal_img is not None:
        t = N.new("ShaderNodeTexImage"); t.image = normal_img; t.interpolation = "Linear"
        uvn = N.new("ShaderNodeUVMap"); uvn.uv_map = "UVMap"
        mp = N.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (5.0, 5.0, 1.0)
        L.new(uvn.outputs[0], mp.inputs[0]); L.new(mp.outputs[0], t.inputs[0])
        nm = N.new("ShaderNodeNormalMap"); nm.inputs["Strength"].default_value = nstrength
        L.new(t.outputs["Color"], nm.inputs["Color"]); L.new(nm.outputs["Normal"], b.inputs["Normal"])
    m.use_backface_culling = False
    return m


if CL["name"] == "dolcevita":
    cloth_rgb, _ = BD.knit_normal(512 if DRAFT else 1024, ribs=CL.get("ribs", 24))
else:
    cloth_rgb = SH.shirt_normal(512 if DRAFT else 1024)
knit_img = PT.to_image(f"{WHO}_tessuto_normal", cloth_rgb)
knit_img.colorspace_settings.name = "Non-Color"
knit_img.filepath_raw = os.path.join(TEX, f"{WHO}_tessuto_normal.jpg"); knit_img.file_format = "JPEG"; knit_img.save(quality=92)
mat_cloth = cloth_material(f"{WHO}_{CL['name']}", PA.srgb_to_lin(np.array(CL["color"])), CL["rough"], CL["sheen"],
                           knit_img, CL.get("nstrength", 0.5))
mat_hand = new_mat(f"{WHO}_mani")
_b = mat_hand.node_tree.nodes["Principled BSDF"]
_b.inputs["Base Color"].default_value = ((*PA.srgb_to_lin(np.array(cfg["skin_toon"]) * np.array([1.0, 0.97, 0.96])), 1) if TOON else
                                         (*PA.srgb_to_lin(np.array(cfg["biscuit"]) * 0.97), 1) if STYLE else
                                         (*PA.srgb_to_lin(np.array(cfg["skin"]) * np.array([1.0, 0.97, 0.97])), 1))
_b.inputs["Roughness"].default_value = 0.5 if TOON else (0.62 if STYLE else 0.5)
_b.inputs["Subsurface Weight"].default_value = 0.2 if TOON else (0.0 if STYLE else 0.15)
_b.inputs["Subsurface Radius"].default_value = (1.0, 0.35, 0.2)
_b.inputs["Subsurface Scale"].default_value = 0.004
mat_nail = new_mat(f"{WHO}_unghie")
_b = mat_nail.node_tree.nodes["Principled BSDF"]
_b.inputs["Base Color"].default_value = ((*PA.srgb_to_lin(np.array([0.94, 0.78, 0.72])), 1) if TOON else
                                         (*PA.srgb_to_lin(np.array(cfg["biscuit"])), 1) if STYLE else
                                         (*PA.srgb_to_lin(np.array([0.86, 0.68, 0.64])), 1))
_b.inputs["Roughness"].default_value = 0.3 if TOON else (0.45 if STYLE else 0.3)

torso, _, _ = BD.build_torso(f"{WHO}_busto")
BD.cyl_uv(torso, (0.0, -0.04, 0.0))
body_parts = [torso]
for s_ in (1, -1):
    arm, nl, nr = BD.build_arm(f"{WHO}_manica_{'L' if s_ > 0 else 'R'}", s_)
    BD.tube_uv(arm, nr, nl, u_rep=3.0, v_rep=8.0)
    body_parts.append(arm)
neck_c = Vector((0.0, HO.y + head_xf((0.0, 0.0665, -0.2)).y, 0.0))
for ob_ in body_parts:
    ob_.data.materials.append(mat_cloth)
extras = []
if CL["name"] == "dolcevita":
    collar, _, _ = BD.build_turtleneck_collar(f"{WHO}_collo_maglia", neck_c, 0.530, 0.68, 0.066 * HK, 0.054 * HK, tilt=0.026)
else:
    tmaps = PA.bake_maps(torso, torso.data, {"pos": (np.array([list(v.co) for v in torso.data.vertices]) + 0.5)},
                         1024, margin=8)
    shirt_rgb = SH.paint_shirt(tmaps["pos"] - 0.5, CL["color"],
                               cfg["skin_toon"] if TOON else (cfg["biscuit"] if STYLE else cfg["skin"]))
    shirt_img = PT.to_image(f"{WHO}_camicia", shirt_rgb)
    shirt_img.filepath_raw = os.path.join(TEX, f"{WHO}_camicia.jpg"); shirt_img.file_format = "JPEG"; shirt_img.save(quality=92)
    mat_torso = cloth_material(f"{WHO}_camicia_busto", PA.srgb_to_lin(np.array(CL["color"])), CL["rough"], CL["sheen"],
                               knit_img, CL.get("nstrength", 0.5))
    _t = mat_torso.node_tree.nodes.new("ShaderNodeTexImage"); _t.image = shirt_img
    mat_torso.node_tree.links.new(_t.outputs["Color"], mat_torso.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
    if SCULPT:                                           # niente smalto sulla pelle dello scollo
        cm = PT.to_image(f"{WHO}_camicia_smalto", np.repeat((1 - SH.paint_shirt.v_mask)[..., None], 3, 2))
        cm.colorspace_settings.name = "Non-Color"
        cm.filepath_raw = os.path.join(TEX, f"{WHO}_camicia_smalto.png"); cm.file_format = "PNG"; cm.save()
        _n = mat_torso.node_tree.nodes; _l = mat_torso.node_tree.links
        _tc = _n.new("ShaderNodeTexImage"); _tc.image = cm
        _sp = _n.new("ShaderNodeSeparateColor")
        _l.new(_tc.outputs["Color"], _sp.inputs[0]); _l.new(_sp.outputs[0], _n["Principled BSDF"].inputs["Coat Weight"])
    torso.data.materials.clear(); torso.data.materials.append(mat_torso)
    collar = SH.build_shirt_collar(f"{WHO}_colletto", neck_c, 0.596, 0.064 * HK, 0.054 * HK, h=0.040)
BD.cyl_uv(collar, (0.0, neck_c.y, 0.0))
collar.data.materials.append(mat_cloth)
body_parts.append(collar)
if CL["name"] != "dolcevita":
    bpy.context.view_layer.update()
    chain, cross = SH.build_chain(f"{WHO}_catenina", f"{WHO}_croce", [torso, head], neck_c, 0.062 * HK, 0.052 * HK, 0.585, 0.49)
    mat_silver = new_mat(f"{WHO}_argento")
    _b = mat_silver.node_tree.nodes["Principled BSDF"]
    _b.inputs["Base Color"].default_value = ((*PA.srgb_to_lin(np.array([0.913, 0.671, 0.561])), 1) if SCULPT
                                             else (0.85, 0.85, 0.87, 1))
    _b.inputs["Roughness"].default_value = 0.18 if TOON else 0.25
    _b.inputs["Metallic"].default_value = 1.0
    _b.inputs["Roughness"].default_value = 0.25
    for o_ in (chain, cross):
        o_.data.materials.append(mat_silver)
    extras += [chain, cross]
hands = []
for s_ in (1, -1):
    hd, nl_ = BD.build_hand(f"{WHO}_mano_{'L' if s_ > 0 else 'R'}", s_, f"{WHO}_unghie_{'L' if s_ > 0 else 'R'}")
    hd.data.materials.append(mat_hand); nl_.data.materials.append(mat_nail)
    hands += [hd, nl_]
hands += extras
tri = 0
for ob_ in [o for o in (head, hair_ob, cards_ob) if o is not None] + eyes + body_parts + hands:
    tri += sum(len(p.vertices) - 2 for p in ob_.data.polygons)
print(f"triangoli totali: {tri}" + ("  OLTRE IL BUDGET DI 60k" if tri > 60000 else "  (budget 60k)"))

# banco (solo per i render, non si esporta)
bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, BD.TABLE_Y - 0.5, BD.TABLE_Z))
table = bpy.context.active_object; table.name = "banco_render"
table.scale = (1.6, 1.0, 1.0)
mt = new_mat("banco_render"); mt.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.05, 0.07, 0.12, 1)
mt.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.6
table.data.materials.append(mt)


# ---------------------------------------------------------------- 7. scheletro, pesi, shape key, clip
for ob_ in [o for o in (head, hair_ob, cards_ob) if o is not None]:
    ob_.data.transform(Matrix.Translation(ob_.location)); ob_.location = (0, 0, 0)
bpy.context.view_layer.update()
eyeL = [e for e in eyes if e.name.endswith("_L")][0]; eyeR = [e for e in eyes if e.name.endswith("_R")][0]
arm, segs = RG.build_armature(f"{WHO}_rig", HO, eyeL.location.copy(), eyeR.location.copy(), xf=head_xf)
info = dict(canon=canon_all, LID=LID, EYE_SIDE=EYE_SIDE, MOUTH=MOUTH, r_eye=R_EYE * HK,
            eye_c=[np.array(eyeL.location), np.array(eyeR.location)],
            tmj=np.array(HO + head_xf(H.c2b((0, -28, -78)))), mouth_x=P_["paint"]["mouth_x"], is_head=IS_HEAD,
            hk=HK, **{k: P_["paint"][k] for k in ("smile_out", "smile_up", "smile_upper", "smile_lower") if k in P_["paint"]},
            smile_asym=P_["paint"].get("smile_asym", 0.0))
info = RG.build_shape_keys(head, info)
w_chest = smoothstep(-205.0, -238.0, cy_) * IS_HEAD
w_neck = smoothstep(-135.0, -185.0, cy_) * IS_HEAD * (1 - w_chest)
w_jaw = info["w_jaw"] * (1 - w_neck - w_chest)
sleeves = [(body_parts[1], "L"), (body_parts[2], "R")]
hand_objs = [(o, "L" if o.name.endswith("_L") else "R") for o in hands if o.name.rsplit("_", 1)[-1] in ("L", "R")]
RG.skin_all(arm, segs, dict(head=head, head_jaw=w_jaw, head_neck=w_neck, head_chest=w_chest, rigid_head=[o for o in (hair_ob, cards_ob) if o is not None],
                            torso=torso, collar=[collar], sleeves=sleeves, hands=hand_objs, chest_rigid=extras,
                            eyes=[(eyeL, "eye.L"), (eyeR, "eye.R")]))
wrist_rest = {"L": BD.side(BD.J["wrist"], 1), "R": BD.side(BD.J["wrist"], -1)}
clips = {a.name: a for a in RG.build_clips(arm, wrist_rest, seed=1 if WHO == "giovanni" else 2)}
print("clip:", {k: int(v.frame_range[1]) for k, v in clips.items()})
EXPORT = [o for o in (arm, head, hair_ob, cards_ob, eyeL, eyeR) if o is not None] + body_parts + hands


# ---------------------------------------------------------------- render di confronto
scene.view_settings.view_transform = "Standard"
scene.cycles.samples = 32 if DRAFT else 128
scene.cycles.use_denoising = True
scene.cycles.transparent_max_bounces = 64
world = bpy.data.worlds.new("studio"); scene.world = world
if not world.node_tree:
    world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.55, 0.55, 0.56, 1); bg.inputs[1].default_value = 0.35


def area(name, loc, size, power):
    ld = bpy.data.lights.new(name, "AREA"); ld.size = size; ld.energy = power
    lo = bpy.data.objects.new(name, ld); scene.collection.objects.link(lo)
    lo.location = HO + Vector(loc)
    lo.rotation_euler = (-Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    lo.visible_camera = False


if TOON:
    # luce da studio morbida come nei riferimenti: chiave calda da sinistra, riempimento, controluce; fondo grigio chiaro
    bg.inputs[0].default_value = (0.62, 0.62, 0.64, 1); bg.inputs[1].default_value = 0.55
    for nm_, loc_, size_, pw_, col_ in (("chiave", (-0.9, -1.0, 0.6), 1.0, 30, (1.0, 0.86, 0.72)),
                                        ("riempimento", (1.1, -0.8, 0.2), 1.4, 12, (0.85, 0.90, 1.0)),
                                        ("controluce", (0.4, 1.0, 0.8), 0.8, 8, (1.0, 0.92, 0.85))):
        area(nm_, loc_, size_, pw_)
        bpy.data.lights[nm_].color = col_
elif STYLE:
    # luce del laboratorio: lampada calda in alto a sinistra davanti, riempimento freddo da destra dietro,
    # luce morbida e calda frontale sui volti, fondo scuro
    bg.inputs[0].default_value = (0.012, 0.012, 0.016, 1); bg.inputs[1].default_value = 1.0
    for nm_, loc_, size_, pw_, col_ in (("lampada", (-0.8, -0.9, 0.85), 0.35, 28, (1.0, 0.78, 0.55)),
                                        ("riempimento", (1.0, 0.7, 0.35), 1.0, 9, (0.70, 0.82, 1.0)),
                                        ("fronte", (0.1, -1.5, 0.05), 1.6, 4, (1.0, 0.90, 0.80))):
        area(nm_, loc_, size_, pw_)
        bpy.data.lights[nm_].color = col_
else:
    area("key", (-1.2, -1.4, 0.6), 1.2, 34)
    area("fill", (1.3, -1.0, 0.2), 1.5, 12)
    area("rim", (0.3, 1.2, 0.8), 0.8, 15)

cd = bpy.data.cameras.new("foto"); cd.sensor_fit = "HORIZONTAL"; cd.sensor_width = 36.0; cd.clip_start = 0.01
cam = bpy.data.objects.new("foto", cd); scene.collection.objects.link(cam); scene.camera = cam
r = scene.render
r.image_settings.file_format = "PNG"; r.film_transparent = False


def render_photo_view(path):
    _M = H.camera_matrix_world(params); _M.translation = head_xf(_M.translation)
    cam.matrix_world = Matrix.Translation(HO) @ _M
    for bn in ("eye.L", "eye.R"):                 # nella foto guarda in camera (ossa degli occhi)
        pb = arm.pose.bones[bn]
        Rb = pb.bone.matrix_local.to_quaternion()
        qw = Vector((0, -1, 0)).rotation_difference(head_xf(cam_pos) + HO - pb.bone.head_local)
        pb.rotation_quaternion = Rb.inverted() @ qw @ Rb
    cd.lens = FPX / SIZE * 36.0
    r.resolution_x = r.resolution_y = SIZE; r.resolution_percentage = 100
    x0, y0, ww, hh = P_["crop"]
    r.use_border = True; r.use_crop_to_border = True
    r.border_min_x = x0 / SIZE; r.border_max_x = (x0 + ww) / SIZE
    r.border_min_y = 1 - (y0 + hh) / SIZE; r.border_max_y = 1 - y0 / SIZE
    r.filepath = path
    bpy.ops.render.render(write_still=True)


def render_orbit(path, yaw, pitch=0.0, res=800, tgt=None, dist=1.6, lens=135, aspect=1.2):
    r.use_border = False
    for bn in ("eye.L", "eye.R"):
        arm.pose.bones[bn].rotation_quaternion = (1, 0, 0, 0)
    r.resolution_x = res; r.resolution_y = int(res * aspect); r.resolution_percentage = 100
    cd.lens = lens
    tgt = HO + Vector((0, 0.04, 0.0)) if tgt is None else Vector(tgt)
    a, b = math.radians(yaw), math.radians(pitch)
    cam.location = tgt + Vector((math.sin(a) * math.cos(b), -math.cos(a) * math.cos(b), math.sin(b))) * dist
    cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()
    r.filepath = path
    bpy.ops.render.render(write_still=True)


tag = os.path.join(RENDER, WHO)
if STYLE:                                                # espressione di base nei render (in esportazione resta 0)
    head.data.shape_keys.key_blocks["smile"].value = P_["paint"].get("base_smile", 0.0)
render_photo_view(tag + "_foto_luce.png")
for nm, yaw in (("fronte", 0), ("tq_sx", 35), ("tq_dx", -35), ("profilo", -90), ("retro", 180)):
    render_orbit(f"{tag}_{nm}.png", yaw)
for nm, yaw in (("stile_fronte", 0), ("stile_tq", 22)):     # ritratto come i riferimenti di stile
    render_orbit(f"{tag}_{nm}.png", yaw, 0, res=900, tgt=HO + Vector((0, 0.02, -0.07)), dist=1.3, lens=85, aspect=1.49)
for nm, yaw, pitch in (("busto_fronte", 0, 12), ("busto_tq", 32, 14)):
    render_orbit(f"{tag}_{nm}.png", yaw, pitch, res=900, tgt=(0, -0.22, 0.48), dist=2.3, lens=50, aspect=0.9)
sk = head.data.shape_keys.key_blocks
if WHO == "filippo":
    sk["smile"].value = 1.0
    render_photo_view(tag + "_foto_sorriso.png")
    sk["smile"].value = 0.0
for nm, act, fr in (("leanDown", clips["leanDown"], 1), ("lookUp", clips["lookUp"], int(clips["lookUp"].frame_range[1])),
                    ("explain", clips["explain"], 46), ("pointDown", clips["pointDown"], 40)):
    RG.pose_from_clip(arm, act, fr)
    render_orbit(f"{tag}_posa_{nm}.png", 28, 14, res=900, tgt=(0, -0.22, 0.48), dist=2.3, lens=50, aspect=0.9)
arm.animation_data.action = None; RG.reset_pose(arm); bpy.context.view_layer.update()
for nm in ("blink.L", "jawOpen", "mouthO", "smile"):
    for k in sk:
        k.value = 0.0
    sk[nm].value = 1.0
    render_orbit(f"{tag}_sk_{nm}.png", 12, 0, res=500, tgt=HO + Vector((0, 0, -0.04)), dist=1.0, lens=135, aspect=1.0)
for k in sk:
    k.value = 0.0
table.hide_render = True
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f"{WHO}.blend"))
# si esporta accanto ai sorgenti; in public/assets/models/ si copia solo dopo l'ok di Giovanni (spec §4)
GLB = os.path.join(OUT, f"founder-{WHO}.glb")
if not DRAFT:
    RG.export_glb(GLB, EXPORT)
    print("GLB:", GLB, round(os.path.getsize(GLB) / 1e6, 2), "MB")
    import json
    rep = dict(file=os.path.relpath(GLB, ROOT).replace("\\", "/"), mb=round(os.path.getsize(GLB) / 1e6, 2),
               triangoli=tri, ossa=[b.name for b in arm.data.bones],
               shape_key=[k.name for k in head.data.shape_keys.key_blocks][1:],
               clip={k: round((v.frame_range[1] - 1) / RG.FPS, 2) for k, v in clips.items()},
               fps=RG.FPS, banco_quota_m=BD.TABLE_Z, polsi_riposo={k: [round(c, 4) for c in v] for k, v in wrist_rest.items()},
               occhi_m=[[round(c, 4) for c in eyeL.matrix_world.translation], [round(c, 4) for c in eyeR.matrix_world.translation]],
               rotazione_testa_foto_gradi=P_["yaw"])
    with open(os.path.join(OUT, f"{WHO}_report.json"), "w", encoding="utf-8") as fh:
        json.dump(rep, fh, indent=2, ensure_ascii=False)
np.savez(os.path.join(OUT, f"{WHO}_fit.npz"), params=params, warped=warped, canon=canon_all, partner=partner,
         nh=NH, ne=NE, lid=LID, eye_side=EYE_SIDE, eye_c=eye_c, hair=hair, T=T)
print("FATTO")
