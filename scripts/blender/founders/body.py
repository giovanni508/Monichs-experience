"""Busto seduto, leggermente chinato, avambracci e mani sul piano del banco.

Coordinate Blender (m): origine al centro del bacino sul piano del sedile, Z in alto, -Y avanti (= +Z glTF).
Il piano del banco e' a TABLE_Z sopra il sedile; il bordo del banco a TABLE_Y.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

TABLE_Z = 0.255
TABLE_Y = -0.20
HEAD_ORIGIN = Vector((0.0, -0.105, 0.785))      # punto fra le pupille della testa (spazio testa -> corpo)

# giunture della posa di riposo (meta' destra = x negativo; la sinistra e' speculare)
J = {
    "hips": Vector((0.0, 0.0, 0.08)),
    "chest": Vector((0.0, -0.035, 0.34)),
    "neck": Vector((0.0, -0.078, 0.585)),
    "head": Vector((0.0, -0.092, 0.70)),
    "head_top": Vector((0.0, -0.095, 0.90)),
    "clav": Vector((0.028, -0.075, 0.565)),
    "shoulder": Vector((0.192, -0.055, 0.540)),
    "elbow": Vector((0.225, -0.215, 0.292)),
    "wrist": Vector((0.150, -0.455, 0.290)),
    "hand_end": Vector((0.105, -0.640, 0.272)),
}


def side(v, s):
    return Vector((v.x * s, v.y, v.z))


# ---------------------------------------------------------------- utilita' geometriche
def frames_along(points):
    """tangenti e normali con trasporto parallelo"""
    P = [Vector(p) for p in points]
    T = []
    for i in range(len(P)):
        a = P[max(i - 1, 0)]; b = P[min(i + 1, len(P) - 1)]
        T.append((b - a).normalized())
    up = Vector((0, 0, 1)) if abs(T[0].z) < 0.9 else Vector((0, 1, 0))
    N = [(up - T[0] * up.dot(T[0])).normalized()]
    for i in range(1, len(P)):
        n = N[-1] - T[i] * N[-1].dot(T[i])
        N.append(n.normalized())
    B = [t.cross(n) for t, n in zip(T, N)]
    return P, T, N, B


def ring_loft(bm, centers, shapes, n, cap0=True, cap1=True, ref_up=None):
    """shapes[i](angoli) -> (x_locale, y_locale) in m; ritorna lista degli anelli di vertici"""
    P, T, N, B = frames_along(centers)
    if ref_up is not None:                         # orienta il "su" locale verso un vettore fisso
        N = [(ref_up - t * ref_up.dot(t)).normalized() for t in T]
        B = [t.cross(nn) for t, nn in zip(T, N)]
    ang = np.linspace(0, 2 * math.pi, n, endpoint=False)
    rings = []
    for p, nn, bb, sh in zip(P, N, B, shapes):
        xs, ys = sh(ang)
        rings.append([bm.verts.new(p + bb * float(x) + nn * float(y)) for x, y in zip(xs, ys)])
    for A, Bv in zip(rings[:-1], rings[1:]):
        for j in range(n):
            k = (j + 1) % n
            bm.faces.new((A[j], A[k], Bv[k], Bv[j]))
    if cap0:
        c = bm.verts.new(sum((v.co for v in rings[0]), Vector()) / n)
        for j in range(n):
            bm.faces.new((c, rings[0][(j + 1) % n], rings[0][j]))
    if cap1:
        c = bm.verts.new(sum((v.co for v in rings[-1]), Vector()) / n)
        for j in range(n):
            bm.faces.new((c, rings[-1][j], rings[-1][(j + 1) % n]))
    return rings


def superellipse(w, df, db, nexp=2.4, shift=0.0):
    """sezione: semilarghezza w (x), profondita' davanti df e dietro db (y locale: + = avanti)"""
    def f(a):
        s, c = np.sin(a), np.cos(a)
        d = np.where(c >= 0, df, db)
        r = (np.abs(s / w) ** nexp + np.abs(c / d) ** nexp) ** (-1 / nexp)
        return r * s, r * c + shift
    return f


def to_mesh(bm, name, smooth=True):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def cyl_uv(ob, axis_center, scale_v=1.0, seam_back=True):
    """UV cilindriche attorno all'asse verticale (u = angolo, v = altezza) - per maglia e camicia"""
    me = ob.data
    lv = np.zeros(len(me.loops), int); me.loops.foreach_get("vertex_index", lv)
    co = np.array([list(v.co) for v in me.vertices])
    rel = co - np.array(axis_center)
    u = 0.5 + np.arctan2(rel[:, 0], -rel[:, 1]) / (2 * math.pi)
    v = co[:, 2] * scale_v
    uv = np.zeros((len(me.loops), 2))
    for poly in me.polygons:
        li = list(poly.loop_indices); vi = lv[li]
        uu = u[vi].copy()
        if uu.max() - uu.min() > 0.5:
            uu = np.where(uu < 0.5, uu + 1, uu)
        uv[li, 0] = uu; uv[li, 1] = v[vi] * 1.3
    me.uv_layers.new(name="UVMap").data.foreach_set("uv", uv.ravel())


def tube_uv(ob, n_ring, n_len, u_rep=2.0, v_rep=4.0):
    """UV per tubi costruiti ad anelli: u attorno, v lungo"""
    me = ob.data
    lv = np.zeros(len(me.loops), int); me.loops.foreach_get("vertex_index", lv)
    uv = np.zeros((len(me.loops), 2))
    for poly in me.polygons:
        li = list(poly.loop_indices); vi = lv[li]
        ring = np.minimum(vi // n_ring, n_len - 1); j = vi % n_ring
        uu = j / n_ring
        if uu.max() - uu.min() > 0.5:
            uu = np.where(uu < 0.5, uu + 1, uu)
        uv[li, 0] = uu * u_rep; uv[li, 1] = ring / max(n_len - 1, 1) * v_rep
    me.uv_layers.new(name="UVMap").data.foreach_set("uv", uv.ravel())


# ---------------------------------------------------------------- torso
def torso_spine(n=34):
    """curva dal bacino alla base del collo, chinata in avanti"""
    pts = []
    h, c, nk = J["hips"], J["chest"], J["neck"]
    for i in range(n):
        t = i / (n - 1)
        a = h.lerp(c, t / 0.55) if t < 0.55 else c.lerp(nk, (t - 0.55) / 0.45)
        pts.append(a)
    # liscia la curva
    for _ in range(4):
        pts = [pts[0]] + [(pts[i - 1] + pts[i] * 2 + pts[i + 1]) / 4 for i in range(1, len(pts) - 1)] + [pts[-1]]
    return pts


TORSO = np.array([
    # t     W      Df     Db    n
    [0.00, 0.168, 0.095, 0.100, 2.3],
    [0.12, 0.164, 0.095, 0.095, 2.3],
    [0.30, 0.150, 0.098, 0.088, 2.4],
    [0.48, 0.156, 0.108, 0.092, 2.5],
    [0.64, 0.170, 0.118, 0.098, 2.6],
    [0.78, 0.188, 0.117, 0.104, 2.7],
    [0.86, 0.202, 0.110, 0.104, 2.9],
    [0.92, 0.196, 0.095, 0.095, 2.8],
    [0.955, 0.160, 0.082, 0.082, 2.5],
    [0.98, 0.112, 0.070, 0.070, 2.2],
    [1.00, 0.070, 0.060, 0.062, 2.0],
])


def build_torso(name, n=56, thick=0.0):
    bm = bmesh.new()
    pts = torso_spine()
    shapes = []
    for i in range(len(pts)):
        t = i / (len(pts) - 1)
        W, Df, Db, ne = (float(np.interp(t, TORSO[:, 0], TORSO[:, k])) for k in range(1, 5))
        shapes.append(superellipse(W + thick, Df + thick, Db + thick, ne))
    ring_loft(bm, pts, shapes, n, cap0=True, cap1=True, ref_up=Vector((0, -1, 0)))
    return to_mesh(bm, name), len(pts), n


# ---------------------------------------------------------------- braccia (maniche)
def arm_path(s, n=26):
    sh, el, wr = side(J["shoulder"], s), side(J["elbow"], s), side(J["wrist"], s)
    start = side(Vector((0.115, -0.058, 0.515)), s)
    pts = []
    for i in range(n):
        t = i / (n - 1)
        if t < 0.08:
            pts.append(start.lerp(sh, t / 0.08))
        elif t < 0.55:
            pts.append(sh.lerp(el, (t - 0.08) / 0.47))
        else:
            pts.append(el.lerp(wr, (t - 0.55) / 0.45))
    for _ in range(3):                                   # gomito arrotondato
        pts = [pts[0]] + [(pts[i - 1] + pts[i] * 2 + pts[i + 1]) / 4 for i in range(1, len(pts) - 1)] + [pts[-1]]
    return pts


ARM_R = np.array([[0.00, 0.066], [0.08, 0.064], [0.20, 0.055], [0.40, 0.047], [0.55, 0.043],
                  [0.70, 0.044], [0.88, 0.037], [1.00, 0.031]])


def build_arm(name, s, n=28, extra=0.0, flat_bottom=True):
    pts = arm_path(s)
    bm = bmesh.new()
    shapes = []
    for i in range(len(pts)):
        t = i / (len(pts) - 1)
        r = float(np.interp(t, ARM_R[:, 0], ARM_R[:, 1])) + extra
        rx, ry = r, r * (0.82 if t > 0.55 else 0.95)      # avambraccio piu' piatto
        shapes.append(superellipse(rx, ry, ry, 2.2))
    rings = ring_loft(bm, pts, shapes, n, cap0=False, cap1=False, ref_up=Vector((0, 0, 1)))
    if flat_bottom:                                       # appoggio sul banco: niente sotto il piano
        for ring in rings:
            for v in ring:
                if v.co.z < TABLE_Z + 0.001:
                    v.co.z = TABLE_Z + 0.001 + (v.co.z - TABLE_Z) * 0.15
    return to_mesh(bm, name), len(pts), n


# ---------------------------------------------------------------- mani
FINGERS = [  # (offset laterale dal centro del palmo, lunghezze falangi, raggio, apertura gradi)
    (-0.030, (0.044, 0.026, 0.021), 0.0090, -6),     # indice (verso il pollice)
    (-0.010, (0.048, 0.030, 0.022), 0.0092, -1),     # medio
    (0.010, (0.045, 0.028, 0.021), 0.0087, 4),       # anulare
    (0.028, (0.036, 0.021, 0.019), 0.0076, 10),      # mignolo
]


def _finger(bm, nails, start, d0, up, lens, pitches, rad, base_z, nseg=4):
    """dito ad arco: ogni falange scende di 'pitches' gradi rispetto all'orizzontale; unghia curva sul dorso"""
    side_v = d0.cross(up).normalized()
    chain = [start.copy()]
    p = start.copy()
    for L, a in zip(lens, pitches):
        dirv = (d0 * math.cos(math.radians(a)) + up * math.sin(math.radians(a))).normalized()
        p = p + dirv * L
        chain.append(p.copy())
    lift = max(0.0, base_z + rad * 0.92 - chain[-1].z)      # il polpastrello appoggia sul banco
    for q in chain[1:]:
        q.z += lift * 0.9
    dense = []
    for i in range(len(chain) - 1):
        for k in range(nseg):
            dense.append(chain[i].lerp(chain[i + 1], k / nseg))
    dense.append(chain[-1])
    shp = []
    for i in range(len(dense)):
        t = i / (len(dense) - 1)
        r = rad * (1.0 - 0.22 * t)
        k_bump = 1.0 + 0.06 * math.exp(-((t - 1 / 3) / 0.06) ** 2) + 0.05 * math.exp(-((t - 2 / 3) / 0.06) ** 2)
        shp.append(superellipse(r * k_bump, r * 0.92 * k_bump, r * 0.80, 2.2))
    ring_loft(bm, dense, shp, 12, cap0=True, cap1=True, ref_up=up)
    # unghia: placca curva sul dorso della falange distale (3 x 3 vertici)
    a, b = chain[-2], chain[-1]
    dn = (b - a).normalized()
    sv = dn.cross(up).normalized()
    un = sv.cross(dn).normalized()
    if un.z < 0:
        un = -un
    L = lens[-1] * 0.62; r_t = rad * 0.80
    c = b - dn * (L * 0.55 + r_t * 0.15)
    grid = []
    for v_ in (-0.5, 0.0, 0.5):
        row = []
        for u_ in (-1.0, 0.0, 1.0):
            ang = u_ * 0.95
            q = c + dn * (L * v_) + sv * (math.sin(ang) * r_t * 1.02) + un * (math.cos(ang) * r_t * 1.02 + 0.0002)
            row.append(nails.verts.new(q))
        grid.append(row)
    for i in range(2):
        for j in range(2):
            nails.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
    return chain


def build_hand(name, s, nails_name):
    """mano destra (s=-1) o sinistra (s=+1) appoggiata col palmo sul banco: dorso convesso, nocche,
    dita ad arco col polpastrello sul piano, pollice accostato all'indice"""
    wr, he = side(J["wrist"], s), side(J["hand_end"], s)
    fwd = (he - wr); fwd.z = 0; fwd.normalize()
    up = Vector((0, 0, 1))
    lat = fwd.cross(up).normalized() * (-s)          # verso il mignolo (esterno)
    base_z = TABLE_Z + 0.001
    bm = bmesh.new()
    nails = bmesh.new()
    palm_len = 0.095
    pts, shapes = [], []
    for i in range(12):
        t = -0.25 + 1.25 * i / 11                      # parte un poco dentro la manica (polso)
        c = wr + fwd * (palm_len * t) + lat * (0.004 * max(t, 0))
        thick = 0.031 - 0.005 * max(t, 0) + 0.004 * max(-t, 0)
        w = (0.026 + 0.019 * min(max(t, 0) / 0.6, 1.0)) if t >= 0 else 0.026 + 0.004 * t
        pts.append(Vector((c.x, c.y, base_z + thick * 0.5)))
        shapes.append(superellipse(w, thick * 0.62, thick * 0.42, 2.6))
    ring_loft(bm, pts, shapes, 22, cap0=True, cap1=True, ref_up=up)
    knuckle = wr + fwd * palm_len + lat * 0.004
    for (off, lens, rad, spread) in FINGERS:
        a = math.radians(spread) * (-s)
        d = (fwd * math.cos(a) - lat * math.sin(a)).normalized()
        k = knuckle + lat * off - fwd * 0.006
        k.z = base_z + 0.023
        # nocca: piccolo rilievo sul dorso
        bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=5, radius=rad * 0.95,
                                  matrix=Matrix.Translation(k + up * 0.0015 - fwd * 0.002))
        _finger(bm, nails, k, d, up, lens, (-10, -15, -6), rad, base_z)
    # pollice: dal lato interno vicino al polso, accostato all'indice e un po' ruotato verso il basso
    t0 = wr + fwd * 0.026 - lat * 0.024
    t0.z = base_z + 0.015
    tdir = (fwd * 0.84 - lat * 0.54).normalized()
    _finger(bm, nails, t0, tdir, up, (0.036, 0.029, 0.023), (-12, -14, -8), 0.0108, base_z)
    hand = to_mesh(bm, name)
    nob = to_mesh(nails, nails_name)
    return hand, nob


# ---------------------------------------------------------------- collo alto del dolcevita
def build_turtleneck_collar(name, neck_c, z0, z1, r0x, r0y, roll=0.012, n=48, rows=14, tilt=0.0, flare=0.45):
    """tubo attorno al collo: dalla base (z0) alla piega (z1), poi risvolto verso il basso"""
    bm = bmesh.new()
    rings = []
    ang = np.linspace(0, 2 * math.pi, n, endpoint=False)
    prof = []
    for i in range(rows):
        t = i / (rows - 1)
        z = z0 + (z1 - z0) * t
        g = 1.0 + 0.05 * math.sin(t * math.pi) + flare * max(0.0, 1 - t / 0.35) ** 2
        prof.append((z, g, 0.0))
    for i in range(1, 7):                           # risvolto
        a = i / 6 * math.pi
        z = z1 - roll * (1 - math.cos(a)) * 0.9
        prof.append((z, 1.0 + roll / r0x * math.sin(a) * 1.3, 0.0))
    for z, g, _ in prof:
        rx, ry = r0x * g, r0y * g
        tz = (z - z0) / max(z1 - z0, 1e-6)
        rings.append([bm.verts.new((neck_c.x + rx * math.sin(a), neck_c.y - ry * math.cos(a),
                                    z - tilt * math.cos(a) * min(tz, 1.0))) for a in ang])
    for A, B in zip(rings[:-1], rings[1:]):
        for j in range(n):
            k = (j + 1) % n
            bm.faces.new((A[j], A[k], B[k], B[j]))
    ob = to_mesh(bm, name)
    return ob, len(prof), n


# ---------------------------------------------------------------- texture della maglia
def knit_normal(size=512, ribs=24, seed=0):
    """mappa normale tangente (sRGB-lineare) a coste verticali con punto maglia"""
    yy, xx = np.mgrid[0:size, 0:size] / size
    h = 0.5 + 0.5 * np.sin(xx * ribs * 2 * np.pi)                       # coste
    st = 0.5 + 0.5 * np.sin(yy * ribs * 3 * 2 * np.pi + np.sin(xx * ribs * 2 * np.pi) * 1.2)
    h = h * 0.75 + st * 0.25 * h
    gy, gx = np.gradient(h)
    k = 6.0
    nx, ny, nz = -gx * k * size / 64, gy * k * size / 64, np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([nx / l * 0.5 + 0.5, ny / l * 0.5 + 0.5, nz / l * 0.5 + 0.5], -1)
    return rgb, h
