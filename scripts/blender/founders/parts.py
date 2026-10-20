"""Parti della testa: infittimento locale, aperture degli occhi, bulbi oculari, utilita' per i capelli."""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

import head_fit as H


def to_canon(co):
    """Blender (m) -> canonico (mm)"""
    return (co[0] * 1000.0, co[2] * 1000.0, -co[1] * 1000.0)


def canon_array(verts):
    a = np.array([list(v.co) for v in verts])
    return np.stack([a[:, 0] * 1000.0, a[:, 2] * 1000.0, -a[:, 1] * 1000.0], 1)


# ---------------------------------------------------------------- infittimento di occhi e bocca
def refine(bm, boxes, cuts):
    """suddivide le facce interamente dentro una delle scatole canoniche (x, y, z min/max)"""
    def inside(v):
        x, y, z = to_canon(v.co)
        for (x0, x1, y0, y1, z0) in boxes:
            if x0 <= abs(x) <= x1 and y0 <= y <= y1 and z >= z0:
                return True
        return False
    flag = {v: inside(v) for v in bm.verts}
    faces = [f for f in bm.faces if all(flag[v] for v in f.verts)]
    edges = list({e for f in faces for e in f.edges})
    bmesh.ops.subdivide_edges(bm, edges=edges, cuts=cuts, use_grid_fill=True)
    bm.verts.index_update()


# ---------------------------------------------------------------- aperture degli occhi
EYE = dict(xi=16.5, yi=-1.0, xo=46.0, yo=3.0, up=4.6, lo=5.4)


def almond(side, n=120):
    """contorno dell'apertura palpebrale (canonico x, y), antiorario visto da davanti per side=+1"""
    t = np.linspace(0, 1, n)
    xs = EYE["xi"] + (EYE["xo"] - EYE["xi"]) * t
    yb = EYE["yi"] + (EYE["yo"] - EYE["yi"]) * t
    up = yb + EYE["up"] * np.sin(np.pi * t) ** 0.8
    lo = yb - EYE["lo"] * np.sin(np.pi * t) ** 0.9
    poly = np.concatenate([np.stack([xs, up], 1), np.stack([xs[::-1], lo[::-1]], 1)[1:-1]])
    poly[:, 0] *= side
    return poly


def point_in_poly(pts, poly):
    x, y = pts[:, 0], pts[:, 1]
    inside = np.zeros(len(pts), bool)
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]; xj, yj = poly[j]
        cond = ((yi > y) != (yj > y)) & (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi)
        inside ^= cond
        j = i
    return inside


def nearest_on_poly(p, poly):
    a = poly; b = np.roll(poly, -1, axis=0)
    ab = b - a
    t = np.clip(((p - a) * ab).sum(1) / (ab * ab).sum(1).clip(1e-12), 0, 1)
    q = a + ab * t[:, None]
    i = np.argmin(np.linalg.norm(q - p, axis=1))
    return q[i]


def cut_eye_holes(bm, depth=2.2):
    """toglie le facce dentro l'apertura, aggancia il bordo al contorno e lo ripiega verso l'interno
    (spessore della palpebra). Strato 'lid': 1 = palpebra superiore, 2 = inferiore, 3 = ripiego interno."""
    lid = bm.verts.layers.int.get("lid") or bm.verts.layers.int.new("lid")
    side_l = bm.verts.layers.int.get("eye_side") or bm.verts.layers.int.new("eye_side")
    for side in (1, -1):
        poly = almond(side)
        cen = poly.mean(0)
        dead = []
        for f in bm.faces:
            c = to_canon(f.calc_center_median())
            if c[2] > -30 and side * c[0] > 5 and point_in_poly(np.array([[c[0], c[1]]]), poly)[0]:
                dead.append(f)
        bmesh.ops.delete(bm, geom=dead, context="FACES")
        bnd_edges = [e for e in bm.edges if e.is_boundary and
                     all(side * to_canon(v.co)[0] > 5 and abs(to_canon(v.co)[1]) < 20 and to_canon(v.co)[2] > -30
                         for v in e.verts)]
        bverts = list({v for e in bnd_edges for v in e.verts})
        for v in bverts:
            x, y, z = to_canon(v.co)
            qx, qy = nearest_on_poly(np.array([x, y]), poly)
            v.co = H.c2b((qx, qy, z))
        bmesh.ops.remove_doubles(bm, verts=bverts, dist=0.00025)
        bnd_edges = [e for e in bm.edges if e.is_boundary and
                     all(side * to_canon(v.co)[0] > 5 and abs(to_canon(v.co)[1]) < 20 and to_canon(v.co)[2] > -30
                         for v in e.verts)]
        bverts = list({v for e in bnd_edges for v in e.verts})
        for v in bverts:
            x, y, z = to_canon(v.co)
            t = (abs(x) - EYE["xi"]) / (EYE["xo"] - EYE["xi"])
            yb = EYE["yi"] + (EYE["yo"] - EYE["yi"]) * t
            v[lid] = 1 if y >= yb else 2
            v[side_l] = side
        ret = bmesh.ops.extrude_edge_only(bm, edges=bnd_edges)
        new = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMVert)]
        for v in new:
            x, y, z = to_canon(v.co)
            d = np.array([x, y]) - cen
            d = d / max(np.linalg.norm(d), 1e-6)
            v.co = H.c2b((x - d[0] * 0.5, y - d[1] * 0.5, z - depth))
            v[lid] = 3; v[side_l] = side
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.verts.index_update()


# ---------------------------------------------------------------- bulbo oculare
def eye_texture(name, iris_rgb, sclera_rgb, size=512, r_eye=12.0):
    """texture planare dell'emisfero frontale: pupilla, iride a raggi, anello limbare, sclera"""
    yy, xx = np.mgrid[0:size, 0:size]
    u = (xx + 0.5) / size - 0.5; v = (yy + 0.5) / size - 0.5
    r = np.hypot(u, v) * 2 * r_eye / 0.98          # mm sulla proiezione
    ang = np.arctan2(v, u)
    rng = np.random.default_rng(7)
    streak = np.zeros_like(r)
    for k in range(40):
        f = rng.integers(20, 90); ph = rng.uniform(0, 2 * np.pi)
        streak += np.sin(ang * f + ph) * rng.uniform(0.2, 1.0)
    streak = streak / np.abs(streak).max()
    iris = np.array(iris_rgb)[None, None, :] * (1.0 + 0.22 * streak[..., None])
    iris *= (0.75 + 0.35 * np.clip((r - 2.2) / 3.5, 0, 1))[..., None]        # piu' chiara verso l'esterno
    sclera = np.array(sclera_rgb)[None, None, :] * (1.0 - 0.18 * np.clip((r - 7.0) / 5.0, 0, 1))[..., None]
    col = sclera.copy()
    m_iris = smooth(5.9, 6.3, r, inv=True)
    col = col * (1 - m_iris[..., None]) + iris * m_iris[..., None]
    limb = np.exp(-((r - 5.85) / 0.35) ** 2)
    col *= (1 - 0.55 * limb)[..., None]
    pup = smooth(1.9, 2.15, r, inv=True)
    col = col * (1 - pup[..., None]) + np.array([0.01, 0.01, 0.012]) * pup[..., None]
    img = bpy.data.images.new(name, size, size, alpha=False)
    img.colorspace_settings.name = "sRGB"
    rgba = np.concatenate([np.clip(col, 0, 1), np.ones((size, size, 1))], 2).astype(np.float32)
    img.pixels.foreach_set(rgba.ravel())
    return img


def smooth(a, b, x, inv=False):
    t = np.clip((x - a) / (b - a), 0, 1)
    t = t * t * (3 - 2 * t)
    return 1 - t if inv else t


def build_eyeball(name, center, radius, mat, seg=32, rings=24, pupil_mat=None, pupil_r=0.0022):
    """sfera con il polo davanti (-Y Blender), cornea leggermente sporgente, UV planare frontale"""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=radius)
    for v in bm.verts:                                   # polo da +Z a -Y
        x, y, z = v.co
        v.co = Vector((x, -z, y))
    for v in bm.verts:
        x, y, z = v.co
        rr = math.hypot(x, z)
        if y < 0 and rr < 0.0062:
            v.co.y -= 0.0008 * (1 - (rr / 0.0062) ** 2)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    uvl = me.uv_layers.new(name="UVMap")
    for loop in me.loops:
        co = me.vertices[loop.vertex_index].co
        uvl.data[loop.index].uv = (0.5 + co.x / (2 * radius) * 0.98, 0.5 + co.z / (2 * radius) * 0.98)
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat)
    if pupil_mat is not None:                           # pupilla: zona smaltata scura davanti al bulbo
        me.materials.append(pupil_mat)
        for p in me.polygons:
            c = p.center
            if c.y < 0 and math.hypot(c.x, c.z) < pupil_r:
                p.material_index = 1
    ob = bpy.data.objects.new(name, me)
    ob.location = Vector(center)
    bpy.context.scene.collection.objects.link(ob)
    return ob


# ---------------------------------------------------------------- utilita' su grafo della mesh
def edge_array(me):
    e = np.zeros(len(me.edges) * 2, int)
    me.edges.foreach_get("vertices", e)
    return e.reshape(-1, 2)


def diffuse(values, fixed, edges, active, iters=400):
    """Laplaciano: i vertici non fissati prendono la media dei vicini (solo dentro 'active')"""
    v = values.copy()
    m = active[edges[:, 0]] & active[edges[:, 1]]
    a, b = edges[m, 0], edges[m, 1]
    for _ in range(iters):
        s = np.zeros_like(v); c = np.zeros_like(v)
        np.add.at(s, a, v[b]); np.add.at(c, a, 1)
        np.add.at(s, b, v[a]); np.add.at(c, b, 1)
        upd = active & ~fixed & (c > 0)
        v[upd] = s[upd] / c[upd]
    return v


def smooth_vectors(vec, edges, active, iters=3):
    v = vec.copy()
    m = active[edges[:, 0]] & active[edges[:, 1]]
    a, b = edges[m, 0], edges[m, 1]
    for _ in range(iters):
        s = v.copy(); c = np.ones(len(v))
        np.add.at(s, a, v[b]); np.add.at(c, a, 1)
        np.add.at(s, b, v[a]); np.add.at(c, b, 1)
        v = np.where(active[:, None], s / c[:, None], v)
    return v / np.linalg.norm(v, axis=1).clip(1e-9)[:, None]


# ---------------------------------------------------------------- orecchio: apertura, rotazione, scala
def ear_transform(P, pivot, side, prm):
    """prm = (apertura, rotazione nel piano, scala, su, indietro) - side=-1 orecchio destro (verso -X)"""
    a, b, s, dy, dz = prm
    d = P - pivot
    lat, up, back = side * d[:, 0], d[:, 2], d[:, 1]
    up, back = up * math.cos(b) - back * math.sin(b), up * math.sin(b) + back * math.cos(b)
    lat, up, back = lat * s, up * s, back * s
    lat, back = lat * math.cos(a) + back * math.sin(a), -lat * math.sin(a) + back * math.cos(a)
    up = up + dy; back = back + dz
    return pivot + np.stack([side * lat, back, up], 1)


def fit_ear(P_keys, uv, pivot, side, params, f, cx, cy):
    """adatta l'orecchio ai punti della foto: minimi quadrati con LM, scala e rotazione regolarizzate"""
    x = np.array([math.radians(20), 0.0, 1.0, 0.0, 0.0])
    def res(x):
        q, _ = H.project(ear_transform(P_keys, pivot, side, x), params, f, cx, cy)
        reg = [(x[2] - 1.0) / 0.08 * 12, math.degrees(x[1]) / 25.0 * 6,
               max(0.0, math.degrees(x[0]) - 50) * 3, max(0.0, -math.degrees(x[0]) - 5) * 3,
               x[3] * 1000 * 3.0, x[4] * 1000 * 3.0]
        return np.concatenate([(q - uv).ravel(), reg])
    lam = 1e-2; r = res(x)
    for _ in range(200):
        J = np.zeros((len(r), 5))
        for k in range(5):
            dx = np.zeros(5); dx[k] = 1e-6
            J[:, k] = (res(x + dx) - r) / 1e-6
        A = J.T @ J; g = J.T @ r
        st = np.linalg.solve(A + lam * np.diag(np.diag(A) + 1e-9), -g)
        rn = res(x + st)
        if (rn ** 2).sum() < (r ** 2).sum():
            x, r = x + st, rn; lam *= 0.4
        else:
            lam *= 5
            if lam > 1e10:
                break
    q, _ = H.project(ear_transform(P_keys, pivot, side, x), params, f, cx, cy)
    return x, np.linalg.norm(q - uv, axis=1)


# ---------------------------------------------------------------- trama senza ripetizioni da pezzi della foto
def quilt(src, valid, out=512, patch=96, n=600, seed=0):
    """src: HxWx3 (sRGB), valid: HxW bool. Ricompone 'out' x 'out' (bordi che si ripetono) incollando pezzi
    validi con bordi sfumati, senza specchiature."""
    rng = np.random.default_rng(seed)
    Hh, Ww = valid.shape
    # pezzi interamente validi (immagine integrale)
    ii = np.pad(np.cumsum(np.cumsum(valid.astype(np.int64), 0), 1), ((1, 0), (1, 0)))
    ys, xs = np.mgrid[0:Hh - patch, 0:Ww - patch]
    cnt = ii[ys + patch, xs + patch] - ii[ys, xs + patch] - ii[ys + patch, xs] + ii[ys, xs]
    cy, cx = np.where(cnt >= patch * patch * 0.97)
    if len(cy) == 0:
        raise RuntimeError("nessun pezzo valido per la trama")
    t = np.linspace(0, np.pi, patch)
    win = np.outer(np.sin(t), np.sin(t)) ** 0.6
    canvas = np.zeros((out, out, 3)); filled = np.zeros((out, out))
    for _ in range(n):
        k = rng.integers(len(cy))
        p = src[cy[k]:cy[k] + patch, cx[k]:cx[k] + patch]
        dy, dx = rng.integers(0, out, 2)
        ry = (dy + np.arange(patch)) % out; rx = (dx + np.arange(patch)) % out
        a = win.copy()
        cur = canvas[np.ix_(ry, rx)]; fl = filled[np.ix_(ry, rx)]
        a = np.where(fl < 0.01, 1.0, a)
        canvas[np.ix_(ry, rx)] = cur * (1 - a[..., None]) + p * a[..., None]
        filled[np.ix_(ry, rx)] = np.maximum(fl, a)
    return canvas


def to_image(name, rgb, alpha=None):
    h, w = rgb.shape[:2]
    a = np.ones((h, w, 1)) if alpha is None else alpha[..., None]
    img = bpy.data.images.new(name, w, h, alpha=alpha is not None)
    img.colorspace_settings.name = "sRGB"
    img.pixels.foreach_set(np.concatenate([np.clip(rgb, 0, 1), a], 2)[::-1].astype(np.float32).ravel())
    return img


def view_ray_conform(P, c, rad, cam):
    """sposta i punti lungo il raggio verso la camera fino alla sfera (c, rad): nella foto non si muovono.
    Se il raggio non tocca la sfera (angoli della fessura, oltre il bulbo) il punto resta dov'e'."""
    out = P.copy()
    for i, p in enumerate(P):
        v = cam - p; v /= np.linalg.norm(v)
        oc = p - c
        b = 2 * (v @ oc); cc = oc @ oc - rad * rad
        disc = b * b - 4 * cc
        if disc >= 0:
            ts = np.array([(-b - math.sqrt(disc)) / 2, (-b + math.sqrt(disc)) / 2])
            t = ts[np.argmin(np.abs(ts))]
            if abs(t) < 0.008:
                out[i] = p + v * t
    return out


# ---------------------------------------------------------------- card di capelli
def build_cards(roots, normals, flows, rng, length, width, lift, curl, twist, cols=4, rows=2, seg=3, embed=0.0015):
    """nastri (seg segmenti) che partono sotto la calotta, seguono la direzione delle ciocche e si sollevano.
    Restituisce vertici, facce, uv (per angolo di faccia)."""
    V, F, UV = [], [], []
    for r, n, f in zip(roots, normals, flows):
        t = f - n * (f @ n); t /= max(np.linalg.norm(t), 1e-9)
        sdir = np.cross(n, t)
        L = length * rng.uniform(0.7, 1.25); W = width * rng.uniform(0.75, 1.25)
        l0 = lift * rng.uniform(0.6, 1.4); cl = -abs(curl) * rng.uniform(0.5, 1.5) * (1 if rng.random() < 0.8 else -0.6)
        tw = twist * rng.uniform(-1, 1)
        tile = rng.integers(cols * rows); tc, tr = tile % cols, tile // cols
        u0, u1 = tc / cols, (tc + 1) / cols
        v_top, v_bot = 1 - tr / rows, 1 - (tr + 1) / rows
        base = len(V)
        p = r - n * embed
        d = t.copy(); side = sdir.copy()
        for k in range(seg + 1):
            a = k / seg
            w = W * (1 - 0.35 * a)
            V.append(p - side * w / 2); V.append(p + side * w / 2)
            UV.append((u0 + 0.02, v_top - (v_top - v_bot) * a)); UV.append((u1 - 0.02, v_top - (v_top - v_bot) * a))
            ang = l0 * (1 - a) + cl * a                      # si solleva alla radice, poi si arriccia
            d = d * math.cos(ang / seg) + n * math.sin(ang / seg)
            d /= np.linalg.norm(d)
            side = side * math.cos(tw / seg) + np.cross(d, side) * math.sin(tw / seg)
            side -= d * (side @ d); side /= max(np.linalg.norm(side), 1e-9)
            p = p + d * (L / seg)
        for k in range(seg):
            i = base + 2 * k
            F.append((i, i + 1, i + 3, i + 2))
    return np.array(V), F, UV


# ---------------------------------------------------------------- ciocche scolpite (volumi pieni, niente alfa)
def build_locks(roots, normals, flows, rng, length, width, thick, lift, curl, rings=6, around=6, embed=0.0025,
                taper=0.82):
    """ciocche come nastri spessi e affusolati: partono dentro la calotta, seguono la pettinatura,
    si sollevano appena e si piegano in punta. UV: u attorno, v lungo (stessa mappa per tutte)."""
    V, F, UV = [], [], []
    for r, n, f in zip(roots, normals, flows):
        n = n / max(np.linalg.norm(n), 1e-9)
        d = f - n * (f @ n); d /= max(np.linalg.norm(d), 1e-9)
        L = length * rng.uniform(0.7, 1.3); W = width * rng.uniform(0.8, 1.2); Th = thick * rng.uniform(0.8, 1.2)
        l0 = lift * rng.uniform(0.5, 1.5)
        cl = curl * rng.uniform(0.6, 1.4) * rng.choice([-1.0, 1.0])
        p = r - n * embed
        up = n.copy()
        base = len(V)
        for k in range(rings + 1):
            a = k / rings
            side = np.cross(up, d); side /= max(np.linalg.norm(side), 1e-9)
            hw = W / 2 * (1 - taper * a ** 1.3); ht = Th / 2 * (1 - taper * 0.9 * a)
            for j in range(around):
                t = 2 * math.pi * j / around
                V.append(p + side * math.cos(t) * hw + up * math.sin(t) * ht)
                UV.append((j / around, a))
            # avanza: si solleva all'inizio, poi torna verso la calotta e si arriccia di lato
            ang_up = l0 * (1 - 2.2 * a)
            d = d * math.cos(ang_up / rings) + up * math.sin(ang_up / rings)
            d = d * math.cos(cl / rings) + side * math.sin(cl / rings)
            d /= np.linalg.norm(d)
            up = up - d * (up @ d); up /= max(np.linalg.norm(up), 1e-9)
            p = p + d * (L / rings)
        tip = len(V); V.append(p); UV.append((0.5, 1.0))
        for k in range(rings):
            for j in range(around):
                j2 = (j + 1) % around
                i0 = base + k * around
                F.append((i0 + j, i0 + j2, i0 + around + j2, i0 + around + j))
        last = base + rings * around
        for j in range(around):
            F.append((last + j, last + (j + 1) % around, tip))
    return np.array(V), F, UV


def lock_texture(umber, umber_light, size=256, grooves=4):
    """colore e mappa normale (spazio tangente) di una ciocca: solchi di stecca lungo la ciocca"""
    vv, uu = np.mgrid[0:size * 2, 0:size] / np.array([size * 2, size])[:, None, None]
    h = np.abs(np.sin(np.pi * uu * grooves)) ** 0.6
    h = h * (0.85 + 0.15 * np.sin(vv * 9 + uu * 3))
    col = np.array(umber)[None, None, :] * (1 - h[..., None]) + np.array(umber_light)[None, None, :] * h[..., None]
    col *= (0.75 + 0.25 * np.clip((1 - vv) * 3, 0, 1))[..., None]    # radice in ombra (v = 0 in basso)
    gy, gx = np.gradient(h)
    k = 2.5
    nx, ny = -gx * k * size / 16, gy * k * size / 16
    l = np.sqrt(nx * nx + ny * ny + 1)
    nrm = np.stack([nx / l * 0.5 + 0.5, ny / l * 0.5 + 0.5, 1 / l * 0.5 + 0.5], -1)
    return col, nrm
