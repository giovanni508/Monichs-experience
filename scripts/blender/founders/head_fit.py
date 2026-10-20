"""Testa fotografica: testa anatomica media deformata sui punti del viso della foto, con la foto proiettata.

Sistema di riferimento canonico (mm): x verso la sinistra del soggetto, y in alto, z in avanti (verso il viso);
origine fra le pupille, al livello dei canti. In Blender: X = x, Y = -z (lo sguardo va verso -Y, cioe' +Z glTF), Z = y.
"""
import math
import numpy as np
import bmesh
import bpy
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

# ---------------------------------------------------------------- punti canonici (antropometria media maschile, mm)
_C = {
    "pupil": (31.5, 0, 2), "canthus_in": (16.5, -1, -3), "canthus_out": (46, 3, -10),
    "lid_up": (31, 5, 1), "lid_lo": (32, -5, 0),
    "brow_in": (14, 17, 8), "brow_peak": (34, 24, 2), "brow_out": (52, 16, -15),
    "alar": (16, -45, 8), "mouth": (25, -70, 4), "gonion": (50, -85, -70), "zygion": (66, -12, -45),
    "ear_top": (74, 14, -92), "ear_lobe": (70, -45, -86), "ear_back": (80, -12, -112), "tragus": (71, -16, -80),
    "temple": (62, 32, -38),
}
CANON = {}
for k, (x, y, z) in _C.items():
    CANON[k + ".L"] = (x, y, z)
    CANON[k + ".R"] = (-x, y, z)
CANON.update({
    "nasion": (0, 6, 7), "glabella": (0, 15, 9), "pronasale": (0, -38, 30), "subnasale": (0, -52, 17),
    "lip_up": (0, -62, 17), "lip_mid": (0, -69, 14), "lip_lo": (0, -78, 15),
    "pogonion": (0, -102, 10), "menton": (0, -118, -5), "forehead": (0, 50, 3),
})


def c2b(p):
    """canonico (mm) -> Blender (m)"""
    x, y, z = p
    return Vector((x / 1000.0, -z / 1000.0, y / 1000.0))


# ---------------------------------------------------------------- testa media procedurale
# sezioni orizzontali (mm). Ogni sezione e' l'unione morbida di due forme:
#  viso  = superellisse centrata in Zcf, semilarghezza Wf, fronte Zf (mediana senza naso), esponente nf
#  cranio/collo = ellisse centrata in Zcb, semilarghezza Wb, nuca Zb, fronte Zn (gola, nascosta dal viso in alto)
SECTIONS = np.array([
    #  y      Wf    Zf     Zcf   nf    Wb    Zb     Zcb    Zn
    [121.0,   12,  -70,   -82,  2.0,  14,  -100,   -85,  -70],
    [118.0,   28,  -48,   -85,  2.0,  32,  -118,   -88,  -55],
    [110.0,   44,  -26,   -85,  2.0,  50,  -142,   -92,  -50],
    [100.0,   55,  -13,   -85,  2.0,  62,  -160,   -95,  -50],
    [ 85.0,   64,   -4,   -85,  2.0,  71,  -173,   -98,  -52],
    [ 70.0,   68,  0.5,   -85,  2.0,  75,  -181,  -100,  -54],
    [ 50.0,   71,  3.5,   -85,  2.3,  77,  -186,  -100,  -55],
    [ 30.0,   72,  6.2,   -85,  2.3,  77,  -187,  -100,  -55],
    [ 15.0,   72,  6.0,   -82,  2.2,  76,  -185,  -100,  -55],
    [  0.0,   72,  2.0,   -78,  2.3,  74,  -178,  -100,  -55],
    [-15.0,   71,  4.0,   -76,  2.3,  72,  -168,  -100,  -55],
    [-30.0,   68,  7.0,   -74,  2.0,  69,  -154,   -98,  -55],
    [-45.0,   64, 10.0,   -72,  2.0,  65,  -138,   -95,  -55],
    [-60.0,   60, 14.0,   -72,  2.0,  61,  -124,   -90,  -50],
    [-70.0,   58, 14.0,   -72,  2.0,  59,  -117,   -88,  -48],
    [-80.0,   55, 12.0,   -72,  2.1,  56,  -112,   -85,  -45],
    [-90.0,   54,  8.0,   -70,  2.3,  55,  -110,   -80,  -38],
    [-102.0,  49,  8.0,   -66,  2.5,  55,  -108,   -76,  -32],
    [-112.0,  44,  2.0,   -62,  2.6,  55,  -107,   -72,  -30],
    [-118.0,  38, -5.0,   -60,  2.6,  56,  -106,   -70,  -29],
    [-123.0,  24, -18.,   -60,  2.3,  56,  -106,   -68,  -28],
    [-130.0,  12, -35.,   -60,  2.0,  56,  -106,   -67,  -27],
    [-150.0,   8, -40.,   -60,  2.0,  57,  -108,   -67,  -25],
    [-175.0,   8, -40.,   -60,  2.0,  59,  -112,   -67,  -20],
    [-205.0,   8, -40.,   -60,  2.0,  63,  -118,   -68,  -13],
    [-240.0,   8, -40.,   -60,  2.0,  70,  -126,   -70,   -5],
])
Y_TOP = 122.5


def _spline(xs, ys):
    """spline cubica naturale su griglia non uniforme -> funzione"""
    xs = np.asarray(xs, float); ys = np.asarray(ys, float)
    n = len(xs); h = np.diff(xs)
    A = np.zeros((n, n)); r = np.zeros(n)
    A[0, 0] = A[-1, -1] = 1
    for i in range(1, n - 1):
        A[i, i - 1] = h[i - 1]; A[i, i] = 2 * (h[i - 1] + h[i]); A[i, i + 1] = h[i]
        r[i] = 3 * ((ys[i + 1] - ys[i]) / h[i] - (ys[i] - ys[i - 1]) / h[i - 1])
    c = np.linalg.solve(A, r)
    b = (ys[1:] - ys[:-1]) / h - h * (2 * c[:-1] + c[1:]) / 3
    d = (c[1:] - c[:-1]) / (3 * h)
    def f(x):
        x = np.clip(np.asarray(x, float), xs[0], xs[-1])
        i = np.clip(np.searchsorted(xs, x) - 1, 0, n - 2)
        t = x - xs[i]
        return ys[i] + b[i] * t + c[i] * t * t + d[i] * t ** 3
    return f


def _g(x, y, cx, cy, sx, sy):
    return math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2))


NOSE_Y = [8, 6, -5, -15, -25, -33, -38, -42, -46, -50, -53, -56]
NOSE_H = [0, 3, 6.5, 10, 15, 20, 22.5, 21, 16, 9, 3, 0]
NOSE_W = [9, 9, 8, 8.5, 9.5, 11, 12.5, 14, 16, 15, 12, 10]


def face_features(x, y):
    """spostamento in avanti (mm) dei lineamenti sopra la base, in funzione di (x, y) canonici"""
    ax = abs(x)
    dz = 0.0
    # naso
    if NOSE_Y[-1] < y < NOSE_Y[0]:
        h = float(np.interp(-y, [-v for v in NOSE_Y], NOSE_H))
        w = float(np.interp(-y, [-v for v in NOSE_Y], NOSE_W))
        if ax < w:
            p = 1.3 if y > -30 else 1.8
            dz += h * (1 - (ax / w) ** 2) ** p
    dz += 3.5 * _g(ax, y, 14.5, -46, 5, 5)                                   # ali del naso
    # occhi: bulbo, solco palpebrale, borsa inferiore, canto interno
    dz += 6.0 * _g(ax, y, 31.5, -0.5, 11, 7.5)
    dz -= 5.0 * _g(ax, y, 17, 0, 5, 5)
    dz -= 4.0 * _g(ax, y, 32, 11.5, 14, 4.5)
    dz -= 2.0 * _g(ax, y, 30, -12, 12, 4)
    # arcata sopracciliare
    dz += 5.0 * math.exp(-((y - 19) / 6.0) ** 2) * math.exp(-(ax / 55.0) ** 4)
    # zigomi
    dz += 4.0 * _g(ax, y, 49, -17, 14, 12)
    # labbra, solco sotto il labbro, mento
    dz += 3.0 * math.exp(-((y + 63) / 4.0) ** 2) * math.exp(-(ax / 22.0) ** 4)
    dz += 3.5 * math.exp(-((y + 76) / 5.0) ** 2) * math.exp(-(ax / 20.0) ** 4)
    dz -= 1.5 * math.exp(-((y + 69) / 1.3) ** 2) * math.exp(-(ax / 25.0) ** 4)
    dz -= 3.0 * _g(ax, y, 0, -88, 22, 5)
    dz += 2.0 * _g(ax, y, 0, -102, 18, 8)
    return dz


def build_template(n_around=112, step_face=2.5, step_other=5.0):
    """testa + collo come superficie a sezioni (un solo pezzo chiuso in alto, aperto alla base del collo).
    Vertici in mm canonici; restituisce bmesh in metri Blender + array delle coordinate canoniche."""
    S = SECTIONS
    ys = S[:, 0]
    F = [_spline(ys[::-1], S[::-1, k]) for k in range(1, S.shape[1])]
    levels = []
    y = 121.0
    while y > -240.0:
        levels.append(y)
        y -= step_face if -130 < y < 70 else step_other
    levels.append(-240.0)
    bm = bmesh.new()
    rings = []
    canon = []
    ang = 2 * np.pi * np.arange(n_around) / n_around       # 0 = avanti, verso +x (sinistra del soggetto)
    sa, ca = np.sin(ang), np.cos(ang)
    for y in levels:
        Wf, Zf, Zcf, nf, Wb, Zb, Zcb, Zn = (float(f(y)) for f in F)
        Df = max(Zf - Zcf, 1.0); Db = max(Zcb - Zb, 1.0); Dn = max(Zn - Zcb, 1.0)
        Zo = 0.5 * (Zcf + Zcb)
        def field(r):
            x = r * sa; z = Zo + r * ca
            dzf = z - Zcf
            f1 = (np.abs(x / Wf) ** nf + np.abs(dzf / np.where(dzf > 0, Df, 0.6 * Df)) ** nf) ** (1.0 / nf)
            dzb = z - Zcb
            f2 = np.sqrt((x / Wb) ** 2 + (dzb / np.where(dzb > 0, Dn, Db)) ** 2)
            return (np.maximum(f1, 1e-9) ** -16 + np.maximum(f2, 1e-9) ** -16) ** (-1.0 / 16)
        lo = np.zeros(n_around); hi = np.full(n_around, 400.0)
        for _ in range(40):
            mid = 0.5 * (lo + hi)
            inside = field(mid) < 1.0
            lo = np.where(inside, mid, lo); hi = np.where(inside, hi, mid)
        r = 0.5 * (lo + hi)
        xs_ = r * sa; zs_ = Zo + r * ca
        ring = []
        for x, z in zip(xs_, zs_):
            x = float(x); z = float(z)
            if z > Zcf:
                wfront = min(max((z - Zcf) / (0.55 * Df), 0.0), 1.0) ** 2
                z += face_features(x, y) * wfront
            canon.append((x, y, z))
            ring.append(bm.verts.new(c2b((x, y, z))))
        rings.append(ring)
    n = n_around
    for A, B in zip(rings[:-1], rings[1:]):
        for j in range(n):
            k = (j + 1) % n
            bm.faces.new((A[j], A[k], B[k], B[j]))
    top = bm.verts.new(c2b((0, Y_TOP, -82)))
    canon.append((0, Y_TOP, -82))
    for j in range(n):
        bm.faces.new((top, rings[0][(j + 1) % n], rings[0][j]))
    bm.verts.index_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.normal_update()
    return bm, np.array(canon), (len(levels), n)


# ---------------------------------------------------------------- orecchio procedurale
EAR_OUTLINE = [  # (p indietro, q in alto) mm rispetto al trago; giro: trago -> radice elice -> cima -> dietro -> lobo
    (0.0, 0.0), (1.0, 8.0), (2.5, 16.0), (5.5, 23.5), (11.0, 29.0), (18.0, 31.0), (25.0, 28.5), (30.0, 22.0),
    (32.5, 13.0), (32.0, 4.0), (30.5, -4.0), (27.5, -12.0), (23.0, -19.0), (17.5, -25.0), (11.5, -29.0),
    (6.5, -29.5), (3.5, -26.0), (2.0, -19.0), (1.0, -11.0), (0.2, -5.0)]
EAR_CENTER = (14.0, 1.0)
EAR_ORIGIN = (71.0, -16.0, -80.0)      # trago dell'orecchio sinistro (canonico)
EAR_KEYS = {"tragus": 0, "ear_top": 5, "ear_back": 9, "ear_lobe": 15}


def _ear_outline(n):
    P = np.array(EAR_OUTLINE + [EAR_OUTLINE[0]])
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    t = np.linspace(0, s[-1], n, endpoint=False)
    return np.stack([np.interp(t, s, P[:, 0]), np.interp(t, s, P[:, 1])], 1), t / s[-1]


def ear_lateral(p, q, t):
    """sporgenza laterale (mm) della faccia esterna dell'orecchio"""
    base = -4.0 + 0.42 * p                         # lembo inclinato: si stacca dalla testa verso il retro
    lobe = min(max((-q - 16.0) / 8.0, 0.0), 1.0)   # sul lobo niente conca/antelice
    rel = 0.0
    if t < 0.55:
        rel -= 9.0 * (1 - (t / 0.55) ** 2) ** 1.4 * (1 - lobe)
    rel += 2.4 * math.exp(-((t - 0.64) / 0.08) ** 2) * (1 - lobe)
    rel -= 1.8 * math.exp(-((t - 0.81) / 0.05) ** 2) * (1 - lobe)
    rel += 3.0 * math.exp(-((t - 0.93) / 0.05) ** 2) * (1 - 0.6 * lobe)
    rel += 4.0 * math.exp(-(((p - 2.0) / 3.0) ** 2 + ((q + 2.0) / 4.0) ** 2))   # trago
    rel += 1.5 * lobe
    if t > 0.97:
        rel -= (t - 0.97) / 0.03 * 2.0
    return base + rel


def build_ear(side=1, n_ang=56, n_rad=14):
    """orecchio come guscio chiuso: faccia esterna con rilievi (conca, antelice, scafa, elice), dorso a 3 mm.
    side=+1 sinistro (+x), -1 destro. Restituisce (bmesh in m, coordinate canoniche, indici dei punti chiave)."""
    out, _ = _ear_outline(n_ang)
    cp, cq = EAR_CENTER
    ox, oy, oz = EAR_ORIGIN
    bm = bmesh.new()
    canon = []
    def add(p, q, x):
        c = (ox + x, oy + q, oz - p)
        if side < 0:
            c = (-c[0], c[1], c[2])
        canon.append(c)
        return bm.verts.new(c2b(c))
    front, back = [], []
    for i in range(1, n_rad + 1):
        t = i / n_rad
        rf, rb = [], []
        for j in range(n_ang):
            p = cp + (out[j, 0] - cp) * t; q = cq + (out[j, 1] - cq) * t
            x = ear_lateral(p, q, t)
            rf.append(add(p, q, x)); rb.append(add(p, q, x - 3.0))
        front.append(rf); back.append(rb)
    x0 = ear_lateral(cp, cq, 0.0)
    cf = add(cp, cq, x0); cb = add(cp, cq, x0 - 3.0)
    n = n_ang
    for j in range(n):
        k = (j + 1) % n
        bm.faces.new((cf, front[0][j], front[0][k]))
        bm.faces.new((cb, back[0][k], back[0][j]))
    for i in range(n_rad - 1):
        for j in range(n):
            k = (j + 1) % n
            bm.faces.new((front[i][j], front[i + 1][j], front[i + 1][k], front[i][k]))
            bm.faces.new((back[i][k], back[i + 1][k], back[i + 1][j], back[i][j]))
    for j in range(n):
        k = (j + 1) % n
        bm.faces.new((front[-1][j], back[-1][j], back[-1][k], front[-1][k]))
    bm.verts.index_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    idx0 = (n_rad - 1) * 2 * n_ang          # primo vertice dell'anello esterno (faccia frontale)
    keys = {}
    for name, oi in EAR_KEYS.items():
        j = int(np.argmin(np.linalg.norm(out - np.array(EAR_OUTLINE[oi]), axis=1)))
        keys[name] = idx0 + 2 * j
    return bm, np.array(canon), keys


# ---------------------------------------------------------------- camera della foto (PnP)
def rodrigues(r):
    th = np.linalg.norm(r)
    if th < 1e-12:
        return np.eye(3)
    k = r / th
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + math.sin(th) * K + (1 - math.cos(th)) * K @ K


def project(P, params, f, cx, cy):
    """P: Nx3 mondo (m). params: rvec(3) mondo->camera, posizione camera(3). Camera Blender: guarda -Z."""
    R = rodrigues(params[:3])
    Pc = (P - params[3:6]) @ R.T
    u = cx + f * Pc[:, 0] / (-Pc[:, 2])
    v = cy - f * Pc[:, 1] / (-Pc[:, 2])
    return np.stack([u, v], 1), Pc


def solve_camera(P, uv, w, f, cx, cy, init):
    p = np.array(init, float)
    sw = np.repeat(np.sqrt(w), 2)
    def res(p):
        q, _ = project(P, p, f, cx, cy)
        return (q - uv).ravel() * sw
    lam = 1e-2
    r = res(p)
    for _ in range(300):
        J = np.zeros((len(r), 6))
        for k in range(6):
            dp = np.zeros(6); dp[k] = 1e-6
            J[:, k] = (res(p + dp) - r) / 1e-6
        A = J.T @ J; g = J.T @ r
        step = np.linalg.solve(A + lam * np.diag(np.diag(A) + 1e-9), -g)
        rn = res(p + step)
        if (rn ** 2).sum() < (r ** 2).sum():
            p, r = p + step, rn; lam *= 0.4
            if np.linalg.norm(step) < 1e-12:
                break
        else:
            lam *= 5
            if lam > 1e12:
                break
    return p, math.sqrt((r ** 2).sum() / w.sum() / 2)


def look_params(pos, target=(0, 0, 0)):
    pos = Vector(pos)
    M = (Vector(target) - pos).to_track_quat("-Z", "Y").to_matrix()   # camera -> mondo
    q = M.transposed().to_quaternion()
    ax, an = q.to_axis_angle()
    return list(np.array(ax) * an) + list(pos)


def solve_photo_camera(P, uv, w, f, cx, cy):
    best = None
    for yaw in range(-75, 80, 15):
        for pitch in (-15, 0, 15):
            for dist in (0.8, 1.5, 2.5):
                a, b = math.radians(yaw), math.radians(pitch)
                pos = (dist * math.sin(a) * math.cos(b), -dist * math.cos(a) * math.cos(b), dist * math.sin(b))
                p, err = solve_camera(P, uv, w, f, cx, cy, look_params(pos))
                _, Pc = project(P, p, f, cx, cy)
                if (Pc[:, 2] >= 0).any():
                    continue
                if best is None or err < best[1]:
                    best = (p, err)
    return best


def camera_matrix_world(params):
    R = rodrigues(params[:3])
    M = Matrix(R.T.tolist()).to_4x4()
    M.translation = Vector(params[3:6])
    return M


def image_plane_targets(P, uv, params, f, cx, cy):
    """sposta i punti P nel piano immagine (profondita' invariata) fino a proiettarsi su uv"""
    _, Pc = project(P, params, f, cx, cy)
    R = rodrigues(params[:3])
    z = -Pc[:, 2]
    pc = np.stack([(uv[:, 0] - cx) * z / f, -(uv[:, 1] - cy) * z / f, -z], 1)
    return pc @ R + params[3:6]


# ---------------------------------------------------------------- deformazione TPS
def tps_warp(src, dst, pts, reg=1e-9):
    """thin plate spline 3D (kernel r) da src->dst applicata a pts (m)"""
    n = len(src)
    d = np.linalg.norm(src[:, None, :] - src[None, :, :], axis=2)
    A = np.zeros((n + 4, n + 4))
    A[:n, :n] = d + reg * np.eye(n)
    Pm = np.hstack([np.ones((n, 1)), src])
    A[:n, n:] = Pm; A[n:, :n] = Pm.T
    B = np.zeros((n + 4, 3)); B[:n] = dst - src
    W = np.linalg.lstsq(A, B, rcond=None)[0]
    out = pts.copy()
    for s in range(0, len(pts), 4000):
        q = pts[s:s + 4000]
        dq = np.linalg.norm(q[:, None, :] - src[None, :, :], axis=2)
        out[s:s + 4000] = q + dq @ W[:n] + np.hstack([np.ones((len(q), 1)), q]) @ W[n:]
    return out


def surface_point(bvh, name):
    """punto della superficie del modello medio corrispondente a un punto canonico (raggio frontale o laterale)"""
    x, y, z = CANON[name]
    if abs(x) > 58 or name.startswith("gonion"):
        s = 1 if x > 0 else -1
        hit = bvh.ray_cast(c2b((x + s * 150, y, z)), Vector((-s, 0, 0)))
    else:
        hit = bvh.ray_cast(c2b((x, y, 200)), Vector((0, 1, 0)))
    return None if hit[0] is None else np.array(hit[0])


def yaw_of(params):
    """rotazione orizzontale della camera attorno alla testa (gradi, + = camera alla destra del soggetto)"""
    c = params[3:6]
    return math.degrees(math.atan2(-c[0], -c[1]))


def solve_camera_fixed_yaw(P, uv, w, f, cx, cy, yaw_t, dist=1.5):
    """come solve_photo_camera ma con la rotazione orizzontale imposta (vincolo forte)"""
    sw = np.repeat(np.sqrt(w), 2)
    def res(p):
        q, _ = project(P, p, f, cx, cy)
        return np.concatenate([(q - uv).ravel() * sw, [200.0 * (yaw_of(p) - yaw_t)]])
    best = None
    for pitch in (-25, -12, 0, 12):
        a, b = math.radians(yaw_t), math.radians(pitch)
        pos = (dist * math.sin(a) * math.cos(b), -dist * math.cos(a) * math.cos(b), dist * math.sin(b))
        p = np.array(look_params(pos), float)
        lam = 1e-2; r = res(p)
        for _ in range(300):
            J = np.zeros((len(r), 6))
            for k in range(6):
                dp = np.zeros(6); dp[k] = 1e-6
                J[:, k] = (res(p + dp) - r) / 1e-6
            A = J.T @ J; g = J.T @ r
            st = np.linalg.solve(A + lam * np.diag(np.diag(A) + 1e-9), -g)
            rn = res(p + st)
            if (rn ** 2).sum() < (r ** 2).sum():
                p, r = p + st, rn; lam *= 0.4
                if np.linalg.norm(st) < 1e-12:
                    break
            else:
                lam *= 5
                if lam > 1e12:
                    break
        _, Pc = project(P, p, f, cx, cy)
        if (Pc[:, 2] >= 0).any():
            continue
        if best is None or (r ** 2).sum() < best[1]:
            best = (p, (r ** 2).sum())
    p = best[0]
    q, _ = project(P, p, f, cx, cy)
    err = math.sqrt(((np.linalg.norm(q - uv, axis=1) ** 2) * w).sum() / w.sum())
    return p, err


def head_plane_target(S, uv, params, f, cx, cy):
    """spostamento di S solo in altezza e profondita' della testa (larghezza invariata) per proiettarsi su uv:
    per orecchie e mandibola, dove l'errore viene dalla posizione avanti/indietro e non dalla larghezza"""
    axes = np.array([[0.0, 0.0, 1.0], [0.0, -1.0, 0.0]])     # su, avanti (Blender)
    ab = np.zeros(2)
    for _ in range(20):
        q, _ = project((S + ab @ axes)[None], params, f, cx, cy)
        r = q[0] - uv
        J = np.zeros((2, 2))
        for k in range(2):
            d = np.zeros(2); d[k] = 1e-5
            qk, _ = project((S + (ab + d) @ axes)[None], params, f, cx, cy)
            J[:, k] = (qk[0] - q[0]) / 1e-5
        ab -= np.linalg.solve(J, r)
        if np.linalg.norm(r) < 0.05:
            break
    return S + ab @ axes
