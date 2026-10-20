"""Mani, polsi e polsini dei fondatori, costruiti (non generati).

Le mani generate avevano dita fuse (le "pinne" fra le dita), polpastrelli a salsicciotto e nessun dito separato da
animare. Qui la mano e' una gabbia di quad (palmo a griglia, dita ad anelli di 4 vertici, pollice dal lato del palmo,
polso ovale) suddivisa due volte: dita affusolate, polpastrello appiattito, nocche, raccordo pulito fra le dita.
I pesi si mettono sulla gabbia (la suddivisione li interpola): mano, tre ossa per dito, avambraccio sul polso.

Sistema locale della mano (mano destra canonica, destrorso): X verso le dita, Y verso il pollice, Z il dorso.
Nel mondo: colonne (asse della mano, direzione del pollice, dorso); per la sinistra la terna e' sinistrorsa e la
stessa gabbia esce gia' specchiata (si girano solo le facce).
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

FINGERS = ("index", "middle", "ring", "pinky")


def ss(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def _rot(v, axis, ang):
    """ruota v attorno ad axis (versori numpy)"""
    axis = axis / np.linalg.norm(axis)
    return v * math.cos(ang) + np.cross(axis, v) * math.sin(ang) + axis * (axis @ v) * (1 - math.cos(ang))


# ---------------------------------------------------------------- proporzioni (frazioni della lunghezza L della mano)
DEFAULT = {
    "palm_len": 0.54,                      # piega del polso -> nocca del medio
    "knuckle_w": 0.47,                     # larghezza del palmo alle nocche
    "wrist_w": 0.36, "wrist_t": 0.22,      # polso ovale (largo, spesso)
    "palm_t": 0.165,                       # spessore del palmo al centro
    # per dito: lunghezza (nocca -> punta), larghezza alla base, arretramento della nocca, apertura (gradi)
    "finger": {"index": (0.37, 0.106, 0.012, 4.0), "middle": (0.40, 0.111, 0.0, 0.5),
               "ring": (0.38, 0.104, 0.012, -3.5), "pinky": (0.31, 0.092, 0.05, -8.5)},
    "phal": (0.46, 0.30, 0.24),           # falangi
    "thumb": {"len": (0.15, 0.145, 0.12), "w": 0.138, "base_x": 0.17, "yaw": 24.0, "pitch": -6.0, "roll": -58.0},
    # riposo (posa A): dita appena piegate, il mignolo un po' di piu'
    "rest_curl": {"index": (7, 10, 6), "middle": (8, 12, 7), "ring": (10, 14, 8), "pinky": (13, 17, 9)},
    "thumb_curl": (0, 8, 10),
}


def finger_chain(P, f, L):
    """giunture (nocca, PIP, DIP, punta) di un dito nel sistema locale, con le pieghe di riposo; e la terna per anello"""
    length, wb, back, spread = P["finger"][f]
    i = FINGERS.index(f)
    kw = P["knuckle_w"] * L
    y = (0.375 - 0.25 * i) * kw                                    # indice verso il pollice (+Y)
    x = P["palm_len"] * L - back * L - 0.02 * L * abs(y / kw) * 2  # linea delle nocche ad arco
    z = 0.012 * L * (1 - abs(y / kw) * 2)                          # nocche centrali un po' piu' alte
    base = np.array([x, y, z])
    d = np.array([math.cos(math.radians(spread)), math.sin(math.radians(spread)), 0.0])
    lat = np.array([-d[1], d[0], 0.0])                             # verso il pollice
    curls = P["rest_curl"][f]
    pts = [base]
    dirs = []
    cur = d.copy()
    for k, frac in enumerate(P["phal"]):
        cur = _rot(cur, lat, -math.radians(curls[k]))             # flessione: la punta va verso il palmo (-Z)
        dirs.append(cur.copy())
        pts.append(pts[-1] + cur * length * L * frac)
    return np.array(pts), dirs, lat, wb * L


def thumb_chain(P, L, kw):
    T = P["thumb"]
    base = np.array([T["base_x"] * L, 0.5 * P["wrist_w"] * L + 0.25 * (kw * 0.5 - 0.5 * P["wrist_w"] * L), -0.010 * L])
    d = np.array([1.0, 0.0, 0.0])
    d = _rot(d, np.array([0, 0, 1.0]), math.radians(T["yaw"] * 0.45))   # metacarpo quasi lungo il palmo
    d = _rot(d, np.cross(d, np.array([0, 0, 1.0])), math.radians(T["pitch"]))  # verso il palmo
    lat = np.cross(np.array([0, 0, 1.0]), d); lat /= np.linalg.norm(lat)
    up = np.cross(d, lat)
    # rotazione del pollice su se stesso: l'unghia guarda di lato, verso le dita
    lat_r = _rot(lat, d, math.radians(T["roll"])); up_r = _rot(up, d, math.radians(T["roll"]))
    pts = [base]; dirs = []
    cur = d.copy()
    for k, ln in enumerate(T["len"]):
        if k == 1:                                                      # apertura alla nocca del pollice
            cur = _rot(cur, np.array([0, 0, 1.0]), math.radians(T["yaw"] * 0.75))
        cur = _rot(cur, lat_r, -math.radians(P["thumb_curl"][k]))
        dirs.append(cur.copy())
        pts.append(pts[-1] + cur * ln * L)
    return np.array(pts), dirs, lat_r, up_r, T["w"] * L


# ---------------------------------------------------------------- gabbia
def build_cage(L, P=None):
    """bmesh della gabbia (mano destra canonica) + giunture locali + pesi per vertice {osso: peso}"""
    P = P or DEFAULT
    bm = bmesh.new()
    W = {}                                    # vert -> {nome osso (senza lato): peso}
    kw = P["knuckle_w"] * L
    ww, wt = P["wrist_w"] * L, P["wrist_t"] * L
    pt = P["palm_t"] * L
    chains = {f: finger_chain(P, f, L) for f in FINGERS}
    tch = thumb_chain(P, L, kw)

    # --- palmo: 4 colonne (una per dito) x 3 file; ogni vertice in alto (dorso) e in basso (palmo)
    cols = 5
    rows_x = [0.0, 0.17 * L, 0.36 * L]        # piega del polso, meta', sotto le nocche (l'ultima fila e' la base delle dita)
    top, bot = {}, {}

    def palm_half_width(x):
        return 0.5 * (ww + (kw - ww) * float(ss(-0.05 * L, 0.42 * L, x)))

    for r, x in enumerate(rows_x):
        hw = palm_half_width(x)
        for c in range(cols):
            u = c / (cols - 1)                 # 0 = mignolo, 1 = indice
            y = (-1 + 2 * u) * hw
            arch = 1 - (2 * u - 1) ** 2        # dorso arcuato
            th = pt * (0.62 + 0.38 * arch) if r > 0 else wt * (0.70 + 0.30 * arch)
            # eminenza del pollice (lato +Y, file 0-1) e ipotenar (lato -Y)
            then = 0.06 * L * float(ss(0.55, 1.0, u)) * (1.0 if r < 2 else 0.4)
            hypo = 0.035 * L * float(ss(0.45, 0.0, u)) * (1.0 if r > 0 else 0.5)
            ztop = 0.5 * th + (0.01 * L if r == 2 else 0.0)
            zbot = -0.5 * th - then * 0.35 - hypo * 0.4
            top[(r, c)] = bm.verts.new((x, y, ztop))
            bot[(r, c)] = bm.verts.new((x, y, zbot))
    # base delle dita: per ogni dito un anello di 4 vertici, condivisi fra dita vicine
    # bordo frontale: 5 vertici in alto e 5 in basso, posti fra le dita (alle "valli")
    fbase_top, fbase_bot = {}, {}
    knuck = [chains[f][0][0] for f in FINGERS]    # nocche: indice, medio, anulare, mignolo
    ys_k = [k[1] for k in knuck]
    xs_k = [k[0] for k in knuck]
    edge_y = [ys_k[3] - 0.55 * P["finger"]["pinky"][1] * L] + \
             [0.5 * (ys_k[3 - i] + ys_k[2 - i]) for i in range(3)] + [ys_k[0] + 0.55 * P["finger"]["index"][1] * L]
    edge_x = [xs_k[3] - 0.03 * L] + [0.5 * (xs_k[3 - i] + xs_k[2 - i]) - 0.025 * L for i in range(3)] + [xs_k[0] - 0.035 * L]
    for c in range(cols):
        x = edge_x[c]; y = edge_y[c]
        u = c / (cols - 1)
        arch = 1 - (2 * u - 1) ** 2
        fbase_top[c] = bm.verts.new((x, y, 0.5 * pt * (0.70 + 0.30 * arch) + 0.012 * L))
        fbase_bot[c] = bm.verts.new((x + 0.02 * L, y, -0.5 * pt * (0.75 + 0.25 * arch)))
    for c in range(cols):
        top[(3, c)] = fbase_top[c]; bot[(3, c)] = fbase_bot[c]
    nrow = 4
    faces = []
    for r in range(nrow - 1):
        for c in range(cols - 1):
            faces.append(bm.faces.new((top[(r, c)], top[(r, c + 1)], top[(r + 1, c + 1)], top[(r + 1, c)])))
            faces.append(bm.faces.new((bot[(r, c)], bot[(r + 1, c)], bot[(r + 1, c + 1)], bot[(r, c + 1)])))
    # fianchi: lato mignolo (c=0) e lato pollice (c=4; la fila 0-1 diventa la base del pollice)
    side_faces = {}
    for r in range(nrow - 1):
        side_faces[("p", r)] = bm.faces.new((top[(r, 0)], top[(r + 1, 0)], bot[(r + 1, 0)], bot[(r, 0)]))
        side_faces[("t", r)] = bm.faces.new((top[(r, cols - 1)], bot[(r, cols - 1)], bot[(r + 1, cols - 1)], top[(r + 1, cols - 1)]))
    # facce frontali (una per dito): da qui escono le dita
    front = {}
    for i, f in enumerate(FINGERS):
        c0 = cols - 2 - i                      # indice tra le colonne 3-4, mignolo tra 0-1
        front[f] = bm.faces.new((top[(3, c0)], bot[(3, c0)], bot[(3, c0 + 1)], top[(3, c0 + 1)]))
    # retro: anello del polso (5 in alto + 5 in basso)
    wrist_ring = [top[(0, c)] for c in range(cols)] + [bot[(0, c)] for c in reversed(range(cols))]
    bm.normal_update()

    for (r, c), v in top.items():
        W[v] = {"hand": 1.0}
    for (r, c), v in bot.items():
        W[v] = {"hand": 1.0}
    for c in range(cols):                     # la base delle dita segue un po' le falangi vicine
        near = [f for i, f in enumerate(FINGERS) if (cols - 2 - i) in (c, c - 1)]
        for v in (fbase_top[c], fbase_bot[c]):
            W[v] = {"hand": 0.72}
            for f in near:
                W[v][f + ".01"] = 0.28 / len(near)

    # --- dita: anelli lungo la catena, terna locale (avanti, laterale, dorso)
    joints = {}
    for f in FINGERS:
        pts, dirs, lat, wbase = chains[f]
        joints[f] = pts
        face = front[f]
        # anelli: (segmento, t nel segmento, scala larghezza, scala spessore, pesi)
        rings = [(0, 0.10, 1.04, 0.90), (0, 0.55, 0.94, 0.84), (0, 0.95, 0.95, 0.84),
                 (1, 0.10, 0.92, 0.82), (1, 0.55, 0.84, 0.76), (1, 0.95, 0.85, 0.76), (2, 0.15, 0.82, 0.74),
                 (2, 0.62, 0.80, 0.72), (2, 0.97, 0.66, 0.60)]
        for (seg, t, sw, st) in rings:
            face = _extrude(bm, face)
            p = pts[seg] + (pts[seg + 1] - pts[seg]) * t
            fwd = dirs[seg]
            up = np.cross(fwd, lat); up /= np.linalg.norm(up)
            hw = 0.5 * wbase * sw; ht = 0.5 * wbase * 0.86 * st
            # polpastrello: nell'ultima falange il lato del palmo e' piu' pieno e piatto
            pad = (0.07 * wbase if seg == 2 else 0.0)
            # nocca (prima falange, alla base) e giunture: il dorso appena rialzato
            knuck = 0.10 * wbase if (seg == 0 and t < 0.2) else (0.06 * wbase if (seg == 1 and t < 0.2) else
                                                                 (0.04 * wbase if (seg == 2 and t < 0.2) else 0.0))
            # ordine dei vertici come la faccia frontale: (alto-mignolo, basso-mignolo, basso-indice, alto-indice)
            corners = [p - lat * hw + up * (ht + knuck), p - lat * hw - up * (ht + pad), p + lat * hw - up * (ht + pad),
                       p + lat * hw + up * (ht + knuck)]
            fv = list(face.verts)
            cur = np.array([list(v.co) for v in fv])
            for v, cpos in zip(fv, _match(cur, np.array(corners))):
                v.co = Vector(cpos)
            # pesi: raccordo alle giunture
            wts = _seg_weights(f, seg, t)
            for v in fv:
                W[v] = wts
        # punta: la faccia finale diventa una cupola dopo la suddivisione; la si accorcia un poco
        tipc = joints[f][3]
        nf = _extrude(bm, face)
        fwd = dirs[2]; up = np.cross(fwd, lat); up /= np.linalg.norm(up)
        c = tipc + fwd * 0.24 * wbase - up * 0.06 * wbase
        hw = 0.5 * wbase * 0.40; ht = 0.5 * wbase * 0.28
        corners = [c - lat * hw + up * ht, c - lat * hw - up * ht, c + lat * hw - up * ht, c + lat * hw + up * ht]
        cur = np.array([list(v.co) for v in nf.verts])
        for v, cpos in zip(list(nf.verts), _match(cur, np.array(corners))):
            v.co = Vector(cpos); W[v] = {f + ".03": 1.0}

    # --- pollice: dal fianco del palmo (fila 0-1, lato pollice)
    pts, dirs, lat_r, up_r, tw = tch
    joints["thumb"] = pts
    face = side_faces[("t", 1)]                    # a meta' palmo: lontano dall'anello del polso (niente angolo vivo)
    trings = [(0, 0.30, 1.38, 1.42), (0, 0.72, 1.12, 1.10), (1, 0.12, 0.98, 0.92), (1, 0.85, 0.90, 0.85),
              (2, 0.15, 0.88, 0.84), (2, 0.60, 0.84, 0.80), (2, 0.97, 0.70, 0.64)]
    for ri, (seg, t, sw, st) in enumerate(trings):
        face = _extrude(bm, face)
        p = pts[seg] + (pts[seg + 1] - pts[seg]) * t
        hw = 0.5 * tw * sw; ht = 0.5 * tw * 0.95 * st
        pad = (0.06 * tw if seg == 2 else 0.0)
        corners = [p - lat_r * hw + up_r * ht, p - lat_r * hw - up_r * (ht + pad), p + lat_r * hw - up_r * (ht + pad),
                   p + lat_r * hw + up_r * ht]
        cur = np.array([list(v.co) for v in face.verts])
        tgt = _match(cur, np.array(corners))
        if ri == 0:
            # primo anello = raccordo: a meta' fra la faccia del palmo (spinta in fuori) e la sezione del pollice
            tgt = [0.45 * np.array(c_) + 0.55 * (cv + np.array([0.0, 0.03 * L, -0.004 * L])) for c_, cv in zip(tgt, cur)]
        for v, cpos in zip(list(face.verts), tgt):
            v.co = Vector(cpos)
        wts = _seg_weights("thumb", seg, t)
        for v in face.verts:
            W[v] = wts
    nf = _extrude(bm, face)
    c = pts[3] + dirs[2] * 0.22 * tw - up_r * 0.05 * tw
    hw = 0.5 * tw * 0.40; ht = 0.5 * tw * 0.30
    corners = [c - lat_r * hw + up_r * ht, c - lat_r * hw - up_r * ht, c + lat_r * hw - up_r * ht, c + lat_r * hw + up_r * ht]
    cur = np.array([list(v.co) for v in nf.verts])
    for v, cpos in zip(list(nf.verts), _match(cur, np.array(corners))):
        v.co = Vector(cpos); W[v] = {"thumb.03": 1.0}
    # la base del pollice tira un poco il palmo
    for v in (top[(1, cols - 1)], bot[(1, cols - 1)], top[(2, cols - 1)], bot[(2, cols - 1)]):
        W[v] = {"hand": 0.8, "thumb.01": 0.2}

    # --- polso: anelli ovali verso l'avambraccio (dentro il polsino)
    ring = wrist_ring
    wrings = [(-0.035, 0.98, 0.98, {"hand": 0.85, "forearm": 0.15}),
              (-0.075, 0.96, 0.96, {"hand": 0.55, "forearm": 0.45}),
              (-0.15, 0.92, 0.92, {"hand": 0.15, "forearm": 0.85}),
              (-0.30, 0.88, 0.88, {"forearm": 1.0})]              # dentro il polsino: piu' stretto, non lo buca
    edges = [bm.edges.get((ring[i], ring[(i + 1) % len(ring)])) for i in range(len(ring))]
    prev = ring
    n = len(ring)
    for (xf, sw, st, wts) in wrings:
        ret = bmesh.ops.extrude_edge_only(bm, edges=edges)
        nv = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMVert)]
        ne = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMEdge) and all(v in nv for v in g.verts)]
        # nuovi vertici nello stesso ordine dell'anello precedente (ognuno collegato al suo)
        order = []
        for v in prev:
            for e in v.link_edges:
                o = e.other_vert(v)
                if o in nv and o not in order:
                    order.append(o); break
        for k, v in enumerate(order):
            ang = 2 * math.pi * k / n
            # anello ovale: angolo dal vertice originale (stessa posizione relativa)
            y0, z0 = prev[k].co.y, prev[k].co.z
            r0 = math.hypot(y0 / (0.5 * ww), z0 / (0.5 * wt)) or 1.0
            yy = 0.5 * ww * sw * (y0 / (0.5 * ww)) / r0
            zz = 0.5 * wt * st * (z0 / (0.5 * wt)) / r0
            v.co = Vector((xf * L, yy, zz))
            W[v] = dict(wts)
        # testa dell'ulna: sul dorso, lato mignolo, appena prima della piega
        if abs(xf + 0.075) < 1e-6:                     # nel tratto di polso fuori dal polsino
            for v in order:
                if v.co.y < -0.2 * ww and v.co.z > 0.0:
                    v.co.z += 0.016 * L; v.co.y -= 0.005 * L
        edges = ne
        prev = order
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])      # tutte verso l'esterno (le facce di partenza no)
    bm.normal_update()
    return bm, W, joints, tch


def _extrude(bm, face):
    """estrude una faccia e restituisce la nuova faccia di testa (quella con tutti i vertici nuovi)"""
    ret = bmesh.ops.extrude_face_region(bm, geom=[face])
    newv = {g for g in ret["geom"] if isinstance(g, bmesh.types.BMVert)}
    cap = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMFace) and all(v in newv for v in g.verts)][0]
    if face.is_valid:
        bmesh.ops.delete(bm, geom=[face], context="FACES_ONLY")
    return cap


def _match(cur, targets):
    """assegna gli angoli 'targets' (ordine ciclico) ai vertici 'cur' (ordine della faccia) scegliendo fra rotazioni e
    verso dell'anello quella con la distanza minore: l'ordine ciclico resta, l'anello non si incrocia mai"""
    c0 = cur.mean(0); t0 = targets.mean(0)
    cn = cur - c0; tn = targets - t0
    cn = cn / np.maximum(np.linalg.norm(cn, axis=1, keepdims=True), 1e-9)
    tn = tn / np.maximum(np.linalg.norm(tn, axis=1, keepdims=True), 1e-9)
    n = len(cur)
    best, best_e = None, 1e18
    for rev in (False, True):
        order = list(range(n))[::-1] if rev else list(range(n))
        for sh in range(n):
            idx = [order[(i + sh) % n] for i in range(n)]
            e = float(((cn - tn[idx]) ** 2).sum())
            if e < best_e:
                best_e, best = e, idx
    return [targets[j] for j in best]


def _seg_weights(f, seg, t):
    b = [f + ".01", f + ".02", f + ".03"]
    parent = "hand"
    if seg == 0:
        if t < 0.3:
            return {parent: 0.55, b[0]: 0.45}
        if t > 0.85:
            return {b[0]: 0.75, b[1]: 0.25}
        return {b[0]: 1.0}
    if seg == 1:
        if t < 0.2:
            return {b[0]: 0.35, b[1]: 0.65}
        if t > 0.8:
            return {b[1]: 0.75, b[2]: 0.25}
        return {b[1]: 1.0}
    if t < 0.2:
        return {b[1]: 0.35, b[2]: 0.65}
    return {b[2]: 1.0}


# ---------------------------------------------------------------- oggetto mano
def build_hand(name, origin, axis, thumb_dir, dorsal, L, side, P=None, levels=2, max_tris=5400, forearm_axis=None):
    """mano nel mondo: origin = piega del polso, axis verso le dita, thumb_dir, dorsal; side 'L' o 'R'.
    Restituisce (oggetto, giunture nel mondo {dito: (4,3)}, terne {dito: (lat, up)})"""
    P = P or DEFAULT
    bm, W, joints, tch = build_cage(L, P)
    M = np.stack([axis, thumb_dir, dorsal], 1)
    O = np.array(origin)
    # il polso dentro il polsino segue l'avambraccio, non l'asse della mano (altrimenti buca il polsino)
    rot_ax, rot_ang = None, 0.0
    if forearm_axis is not None:
        fa = np.array(forearm_axis) / np.linalg.norm(forearm_axis)
        rot_ax = np.cross(axis, fa); sn = np.linalg.norm(rot_ax)
        if sn > 1e-6:
            rot_ax /= sn; rot_ang = math.atan2(sn, float(axis @ fa))
    for v in bm.verts:
        lc = np.array(v.co)
        p = M @ lc
        if rot_ax is not None and lc[0] < 0:
            p = _rot(p, rot_ax, rot_ang * float(ss(0.0, -0.10 * L, lc[0])))
        v.co = Vector(O + p)
    if np.linalg.det(M) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    vlist = list(bm.verts)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    # gruppi di vertici con i nomi delle ossa del lato
    groups = {}
    for i, v in enumerate(vlist):
        for bn, w in W.get(v, {"hand": 1.0}).items():
            full = bn + "." + side
            if full not in groups:
                groups[full] = ob.vertex_groups.new(name=full)
            groups[full].add([i], float(w), "REPLACE")
    for p in me.polygons:
        p.use_smooth = True
    mod = ob.modifiers.new("sub", "SUBSURF"); mod.levels = levels; mod.render_levels = levels
    mod.uv_smooth = "PRESERVE_BOUNDARIES"
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.view_layer.objects:
        o.select_set(o == ob)
    bpy.ops.object.modifier_apply(modifier="sub")
    ntri = sum(len(p.vertices) - 2 for p in me.polygons)
    if ntri > max_tris:                         # un poco meno fitta: i pesi si interpolano
        dm = ob.modifiers.new("dec", "DECIMATE"); dm.ratio = max_tris / ntri; dm.use_collapse_triangulate = False
        bpy.ops.object.modifier_apply(modifier="dec")
    jw = {k: np.array([O + M @ p for p in v]) for k, v in joints.items()}
    pts, dirs, lat_r, up_r, tw = tch
    frames = {"thumb": (M @ lat_r, M @ up_r)}
    for f in FINGERS:
        pts_f, dirs_f, lat, wb = finger_chain(P, f, L)
        up = np.cross(dirs_f[0], lat)
        frames[f] = (M @ lat, M @ (up / np.linalg.norm(up)))
    return ob, jw, frames


def finger_bones(jw, frames, side):
    """ossa delle dita: {nome: (testa, coda, dorso)} nel mondo"""
    out = {}
    for f in ("thumb",) + FINGERS:
        pts = jw[f]
        lat, up = frames[f]
        for k in range(3):
            h, t = pts[k], pts[k + 1]
            d = (t - h) / np.linalg.norm(t - h)
            u = up - d * (up @ d); u /= np.linalg.norm(u)
            out[f"{f}.0{k + 1}.{side}"] = (h, t, u)
    return out


# ---------------------------------------------------------------- manica: tagliata e infilata nel polsino
def arm_frame(J, side, thumb_hint=np.array([0, -1.0, 0])):
    """terna del polso nella posa A: asse dell'avambraccio, asse della mano, pollice, dorso"""
    s = 1 if side == "L" else -1
    E, Wr, T = (np.array(J[f"{k}.{side}"]) for k in ("elbow", "wrist", "tip"))
    af = (Wr - E) / np.linalg.norm(Wr - E)
    ah = (T - Wr) / np.linalg.norm(T - Wr)
    d = np.array([s * 1.0, 0, 0]); d = d - ah * (d @ ah); d /= np.linalg.norm(d)
    t = thumb_hint - ah * (thumb_hint @ ah) - d * (thumb_hint @ d); t /= np.linalg.norm(t)
    # sezione del polsino: perpendicolare all'avambraccio
    e1 = t - af * (t @ af); e1 /= np.linalg.norm(e1)
    e2 = np.cross(af, e1)
    if e2 @ d < 0:
        e2 = -e2
    return {"af": af, "ah": ah, "thumb": t, "dorsal": d, "e1": e1, "e2": e2, "wrist": Wr, "elbow": E}


def tuck_sleeve(me, fr, side, s_top, inner_ab, gather=7, depth=0.075):
    """taglia la manica oltre la cima del polsino e la stringe dentro (arricciata) nell'ultimo tratto.
    s: distanza lungo l'avambraccio dal polso (negativa verso il gomito). Restituisce gli indici da cancellare."""
    sgn = 1 if side == "L" else -1
    P = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get("co", P); P = P.reshape(-1, 3).astype(float)
    Wr, af, e1, e2 = fr["wrist"], fr["af"], fr["e1"], fr["e2"]
    rel = P - Wr
    s = rel @ af
    c1 = rel @ e1; c2 = rel @ e2
    rad = np.hypot(c1, c2)
    arm = (rad < 0.13) & (sgn * P[:, 0] > 0.04) & (s > s_top - depth - 0.06)
    kill = arm & (s > s_top + 0.010)
    # nella posa A la mano pende accanto al fianco: si taglia solo fuori dal vuoto fra fianco e braccio, quota per quota
    sx = sgn * P[:, 0]
    zk = P[kill, 2]
    if len(zk):
        keep = np.zeros(len(P), bool)
        for zb in np.arange(zk.min() - 0.002, zk.max() + 0.004, 0.004):
            sl = (np.abs(P[:, 2] - zb) < 0.002) & (sx > 0.02)
            if sl.sum() < 4:
                continue
            tz = (zb - Wr[2]) / af[2] if abs(af[2]) > 1e-6 else 0.0
            ax_x = sgn * (Wr + af * tz)[0]                     # l'asse del braccio a questa quota
            xs = np.sort(sx[sl])
            g = np.diff(xs)
            ok = (xs[1:] >= ax_x - 0.05) & (xs[:-1] <= ax_x - 0.05) & (g > 0.006)
            if not ok.any():
                continue                                       # nessun fianco accanto: e' tutto braccio
            k = int(np.argmax(np.where(ok, g, -1)))
            bound = 0.5 * (xs[k] + xs[k + 1])
            keep |= kill & (np.abs(P[:, 2] - zb) < 0.002) & (sx < bound)
        kill &= ~keep
        print(side, "sleeve cut: kept body verts next to the hand", int(keep.sum()))
    zone = arm & ~kill & (s > s_top - depth)
    # raggio medio della manica a ogni quota (per scalare senza perdere le pieghe)
    bins = np.linspace(s_top - depth, s_top + 0.010, 12)
    rbar = []
    for b in bins:
        m_ = zone & (np.abs(s - b) < 0.006)
        rbar.append(np.median(rad[m_]) if m_.sum() > 5 else np.nan)
    rbar = np.array(rbar)
    ok = ~np.isnan(rbar)
    rb = np.interp(s, bins[ok], rbar[ok])
    A, B = inner_ab
    ang = np.arctan2(c2 / B, c1 / A)
    r_target = 0.93 * A * B / np.sqrt((B * np.cos(ang)) ** 2 + (A * np.sin(ang)) ** 2)
    w = ss(s_top - depth, s_top + 0.004, s)
    # stringe verso l'ellisse interna del polsino, con le pieghe dell'arricciatura
    k = (1 - w) + w * (r_target / np.maximum(rb, 1e-4))
    phase = 0.7 if side == "L" else 2.1
    k = k * (1 + 0.07 * w * (1 - w) * 4 * np.cos(gather * np.arctan2(c2, c1) + phase))
    newc1 = c1 * k; newc2 = c2 * k
    # un poco di sacco sopra il polsino: la manica scende e si gonfia appena prima di entrare
    bulge = 0.12 * np.exp(-((s - (s_top - 0.35 * depth)) / (0.25 * depth)) ** 2)
    newc1 = newc1 * (1 + bulge * zone); newc2 = newc2 * (1 + bulge * zone)
    Pn = P.copy()
    Pn[zone] = (Wr + np.outer(s, af) + np.outer(newc1, e1) + np.outer(newc2, e2))[zone]
    me.vertices.foreach_set("co", Pn.astype(np.float32).ravel())
    me.update()
    return np.where(kill)[0], float(np.nanmedian(rbar))


def sample_color(me, img, idx):
    """colore mediano (sRGB della texture) dei vertici idx"""
    TW, TH = img.size
    tx = np.empty(TW * TH * 4, np.float32); img.pixels.foreach_get(tx); tx = tx.reshape(TH, TW, 4)
    uv = np.empty(len(me.loops) * 2, np.float32); me.uv_layers[0].data.foreach_get("uv", uv); uv = uv.reshape(-1, 2)
    lv = np.empty(len(me.loops), np.int32); me.loops.foreach_get("vertex_index", lv)
    vuv = np.zeros((len(me.vertices), 2), np.float32); vuv[lv] = uv
    c = tx[np.clip((vuv[idx, 1] * TH).astype(int), 0, TH - 1), np.clip((vuv[idx, 0] * TW).astype(int), 0, TW - 1), :3]
    return np.median(c, 0)


# ---------------------------------------------------------------- polsini
def _lin(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _img(name, arr):
    H, W = arr.shape[:2]
    im = bpy.data.images.new(name, W, H, alpha=False)
    rgba = np.concatenate([arr[..., :3], np.ones((H, W, 1), np.float32)], 2).astype(np.float32)
    im.pixels.foreach_set(rgba.ravel()); im.pack()
    return im


def _tex_mat(name, img, rough):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    tx = nt.nodes.new("ShaderNodeTexImage"); tx.image = img
    nt.links.new(tx.outputs[0], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = 0.3
    return m


def build_cuff(name, kind, fr, s_end, H, inner_ab, cloth_rgb, side):
    """polsino attorno al polso: kind 'shirt' (camicia: bottone, sormonto, cuciture) o 'knit' (maglia: coste).
    s_end: quota dell'apertura (dal polso, negativa verso il gomito); H altezza; inner_ab semiassi interni."""
    Wr, af, e1, e2 = fr["wrist"], fr["af"], fr["e1"], fr["e2"]
    A, B = inner_ab
    th = 0.0032 if kind == "shirt" else 0.0045
    N = 48 if kind == "shirt" else 56
    # sormonto della camicia: lato del mignolo (opposto al pollice), verso il dorso
    phi_p = math.atan2(0.55, -0.83)
    ribs = 28

    def rad_out(phi):
        if kind == "knit":
            return th + 0.0011 * math.cos(ribs * phi)
        d = (phi - phi_p) % (2 * math.pi)
        return th + (0.0014 if d < math.radians(75) else 0.0)

    phis = list(np.linspace(0, 2 * math.pi, N, endpoint=False))
    if kind == "shirt":
        phis += [phi_p - 0.012, phi_p + 0.012]
        phis = sorted(p % (2 * math.pi) for p in phis)
    phis = np.array(phis)
    n = len(phis)

    def ring(s_rel, kind_r, extra=0.0):
        pts = []
        for p in phis:
            if kind_r == "out":
                dr = rad_out(p) + extra
            elif kind_r == "in":
                dr = extra
            else:
                dr = 0.5 * rad_out(p) + extra
            a_, b_ = A + dr, B + dr
            pts.append(Wr + af * (s_end - s_rel) + e1 * (a_ * math.cos(p)) + e2 * (b_ * math.sin(p)))
        return pts

    # profilo (s_rel: 0 = apertura verso la mano, H = cima verso il gomito): interno dall'alto, bordo, esterno, cima
    rim = 0.0022 if kind == "shirt" else 0.0035
    prof = [("in", H - 0.004, 0.0), ("in", 0.6 * H, 0.0), ("in", 0.25 * H, 0.0), ("in", 0.004, 0.0),
            ("mid", -rim * 0.15, 0.0), ("out", 0.004, 0.0), ("out", 0.012, 0.0), ("out", 0.33 * H, 0.0),
            ("out", 0.66 * H, 0.0), ("out", H - 0.010, 0.0), ("out", H - 0.003, 0.0), ("mid", H + rim * 0.10, 0.0)]
    if kind == "knit":
        prof = [("in", H - 0.004, 0.0), ("in", 0.5 * H, 0.0), ("in", 0.004, 0.0), ("mid", -rim * 0.25, 0.0005),
                ("out", 0.004, 0.0004), ("out", 0.25 * H, 0.0), ("out", 0.5 * H, 0.0), ("out", 0.75 * H, 0.0),
                ("out", H - 0.004, 0.0), ("mid", H + rim * 0.1, 0.0)]
    bm = bmesh.new()
    rings = []
    vmap = []
    for kr, srel, ex in prof:
        rings.append([bm.verts.new(Vector(p)) for p in ring(srel, kr, ex)])
        vmap.append((kr, srel))
    uvl = bm.loops.layers.uv.new("UVMap")
    nr = len(rings)

    def vcoord(kr, srel):                     # esterno 0.05..0.70, interno 0.75..0.98 (scuro)
        if kr == "out":
            return 0.05 + 0.65 * (srel / H)
        if kr == "in":
            return 0.98 - 0.23 * (srel / H)
        return 0.02 if srel < H * 0.5 else 0.72
    for k in range(nr - 1):
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
            for lp, (kk, ii) in zip(f.loops, ((k, i), (k, j), (k + 1, j), (k + 1, i))):
                u = phis[ii] / (2 * math.pi)
                if j == 0 and ii == 0:
                    u = 1.0
                lp[uvl].uv = (u, vcoord(*vmap[kk]))
    for i in range(n):                         # chiusura del bordo superiore verso l'interno
        j = (i + 1) % n
        f = bm.faces.new((rings[nr - 1][i], rings[nr - 1][j], rings[0][j], rings[0][i]))
        for lp in f.loops:
            lp[uvl].uv = (0.5, 0.74)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    n_body = len(bm.faces)
    # niente vista dentro la manica: anello scuro fra polsino e polso, a mezza altezza
    inner_ring = ring(0.55 * H, "in", -0.0005)
    wrist_ring = [Wr + af * (s_end - 0.55 * H) + e1 * (0.70 * A * math.cos(p)) + e2 * (0.70 * B * math.sin(p)) for p in phis]
    va = [bm.verts.new(Vector(p)) for p in inner_ring]; vb = [bm.verts.new(Vector(p)) for p in wrist_ring]
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new((va[i], va[j], vb[j], vb[i]))
        for lp in f.loops:
            lp[uvl].uv = (0.5, 0.99)
    n_dark = len(bm.faces) - n_body
    nb = 0
    if kind == "shirt":
        # bottone sul sormonto, verso l'apertura
        pb = (phi_p + math.radians(38)) % (2 * math.pi)
        s_b = 0.36 * H
        rad_dir = e1 * (A * math.cos(pb)) + e2 * (B * math.sin(pb)); rad_dir /= np.linalg.norm(rad_dir)
        cpos = Wr + af * (s_end - s_b) + e1 * ((A + th + 0.0014) * math.cos(pb)) + e2 * ((B + th + 0.0014) * math.sin(pb))
        tan1 = af; tan2 = np.cross(rad_dir, af)
        R_b, h_b = 0.0062, 0.0021
        f0 = len(bm.faces)
        ret = bmesh.ops.create_circle(bm, cap_ends=True, segments=16, radius=R_b)
        top_c = list(ret["verts"])
        for v in top_c:
            xx, yy = v.co.x, v.co.y
            v.co = Vector(cpos + rad_dir * h_b + tan1 * xx + tan2 * yy)
        bfaces = list({f for v in top_c for f in v.link_faces})
        ret2 = bmesh.ops.extrude_face_region(bm, geom=bfaces)
        nv = [g for g in ret2["geom"] if isinstance(g, bmesh.types.BMVert)]
        for v in nv:
            v.co = Vector(np.array(v.co) - rad_dir * h_b)
        bt_faces = list({f for v in top_c + nv for f in v.link_faces})
        bmesh.ops.recalc_face_normals(bm, faces=bt_faces)
        for f in bt_faces:
            for lp in f.loops:
                co = np.array(lp.vert.co) - cpos
                lp[uvl].uv = (0.5 + (co @ tan1) / (2.2 * R_b), 0.5 + (co @ tan2) / (2.2 * R_b))
        bm.faces.ensure_lookup_table()
        nb = len(bm.faces) - f0
    bm.faces.ensure_lookup_table()
    # indici dei materiali: prima di scrivere la mesh (l'ordine delle facce si conserva)
    for i, f in enumerate(bm.faces):
        f.material_index = 0 if i < n_body else (1 if i < n_body + n_dark else 2)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    # stoffa con cuciture e ombra interna dipinte
    cl = np.array(cloth_rgb, np.float32)
    Wt, Ht = 512, 256
    U, Vv = np.meshgrid((np.arange(Wt) + 0.5) / Wt, (np.arange(Ht) + 0.5) / Ht)
    tex = np.broadcast_to(cl, (Ht, Wt, 3)).copy()
    outer = (Vv >= 0.04) & (Vv <= 0.71)
    inner = Vv >= 0.74
    tex[inner] *= 0.42
    srel = (Vv - 0.05) / 0.65 * H
    if kind == "shirt":
        circ = math.pi * (A + B)
        for s0 in (0.0045, H - 0.0045):                     # cuciture a punto: trattini
            line = outer & (np.abs(srel - s0) < 0.00045) & (((U * circ) / 0.0026) % 1.0 < 0.62)
            tex[line] *= 0.80
        pe = phi_p / (2 * math.pi)
        tex[outer & (np.abs(U - pe) < 0.004)] *= 0.70        # ombra sul bordo del sormonto
        st = outer & (np.abs(U - (pe + 0.012)) < 0.0012) & (((srel / 0.0026) % 1.0) < 0.62)
        tex[st] *= 0.82
        edge_dark = 1 - 0.06 * ss(0.012, 0.0, srel) - 0.06 * ss(H - 0.012, H, srel)
        tex[outer] *= edge_dark[outer][..., None]
    else:
        rib = 0.5 + 0.5 * np.cos(ribs * U * 2 * math.pi)
        tex[outer] *= (0.80 + 0.20 * rib[outer])[..., None]
        knit = 0.5 + 0.5 * np.sin(U * 2 * math.pi * ribs * 2) * np.sin(srel / 0.0022 * math.pi)
        tex[outer] *= (0.95 + 0.05 * knit[outer])[..., None]
    tex = np.clip(tex, 0, 1)
    me.materials.append(_tex_mat(name + "_cloth", _img(name + "_tex", tex), 0.85 if kind == "shirt" else 0.95))
    m_dark = bpy.data.materials.new(name + "_dark"); m_dark.use_nodes = True
    m_dark.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*(_lin(cl) * 0.06), 1)
    m_dark.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
    me.materials.append(m_dark)
    if nb:
        bt = np.ones((64, 64, 3), np.float32) * np.array([0.93, 0.92, 0.88], np.float32)
        yy, xx = np.mgrid[0:64, 0:64]
        r_ = np.hypot(xx - 31.5, yy - 31.5) / 32
        bt *= (1 - 0.18 * ss(0.72, 0.95, r_))[..., None]     # bordo rialzato
        for hx, hy in ((-7, -7), (7, -7), (-7, 7), (7, 7)):
            bt[np.hypot(xx - 31.5 - hx, yy - 31.5 - hy) < 3.2] *= 0.35
        me.materials.append(_tex_mat(name + "_button", _img(name + "_btn", bt), 0.35))
    g = ob.vertex_groups.new(name=f"forearm.{side}")
    g.add(list(range(len(me.vertices))), 1.0, "REPLACE")
    return ob


# ---------------------------------------------------------------- texture della mano
def paint_hands(tmp_obj, bones, skin_rgb, bake_fn, size=2048, name="hands"):
    """una texture per le due mani di un fondatore. tmp_obj: le due mani unite (UV gia' fatte, un materiale);
    bones: {nome: (testa, coda, dorso)} nel mondo; skin_rgb: tono della pelle (sRGB) calibrato come il viso."""
    POS, VALID, AO = bake_fn(tmp_obj, size=size)
    Hs, Ws = VALID.shape
    sk = np.array(skin_rgb, np.float32)
    rgb = np.broadcast_to(sk, (Hs, Ws, 3)).copy()
    rough = np.full((Hs, Ws), 0.62, np.float32)
    flat = POS.reshape(-1, 3)
    best_d = np.full(len(flat), 1e9); best_k = np.full(len(flat), -1); best_t = np.zeros(len(flat))
    best_c = np.zeros((len(flat), 3))
    names = list(bones.keys())
    for k, nm in enumerate(names):
        h, t, u = bones[nm]
        ab = t - h; L2 = ab @ ab
        tt = np.clip(((flat - h) @ ab) / L2, -0.3, 1.3)
        cp = h + np.outer(np.clip(tt, 0, 1), ab)
        d = np.linalg.norm(flat - cp, axis=1)
        better = d < best_d
        best_d[better] = d[better]; best_k[better] = k; best_t[better] = tt[better]
        best_c[better] = (flat - (h + np.outer(tt, ab)))[better]
    best_k = best_k.reshape(Hs, Ws); best_t = best_t.reshape(Hs, Ws); best_c = best_c.reshape(Hs, Ws, 3)
    ang = np.zeros((Hs, Ws)); dors = np.zeros((Hs, Ws))
    for k, nm in enumerate(names):
        h, t, u = bones[nm]
        ab = (t - h) / np.linalg.norm(t - h); lat = np.cross(ab, u)
        sel = best_k == k
        c = best_c[sel]
        ang[sel] = np.degrees(np.arctan2(c @ lat, c @ u))
        dors[sel] = (c @ u) / np.maximum(np.linalg.norm(c, axis=1), 1e-6)
    # dorso un po' piu' scuro, palmo piu' chiaro e rosato
    dw = ss(-0.25, 0.35, dors)[..., None]
    rgb *= (1 - dw) * np.array([1.03, 0.995, 0.985], np.float32) + dw * np.array([0.955, 0.94, 0.93], np.float32)
    # unghie: ultima falange, sul dorso, cuticola ad arco
    nail = np.zeros((Hs, Ws), np.float32); cut = np.zeros((Hs, Ws), np.float32); free = np.zeros((Hs, Ws), np.float32)
    for k, nm in enumerate(names):
        if nm.split(".")[1] != "03":
            continue
        sel = best_k == k
        a = np.abs(ang[sel]); t = best_t[sel]
        amax = 50.0
        t0 = 0.36 + 0.10 * (a / amax) ** 2
        inside = ss(amax + 4, amax - 4, a) * ss(t0 - 0.015, t0 + 0.015, t) * ss(1.06, 0.98, t)
        nail[sel] = inside
        cut[sel] = np.exp(-((t - t0) / 0.024) ** 2) * ss(amax + 6, amax - 10, a) + \
            0.7 * np.exp(-((a - amax) / 5.0) ** 2) * ss(t0 - 0.02, t0 + 0.05, t) * ss(1.02, 0.9, t)
        free[sel] = inside * ss(0.90, 0.97, t)
    # unghia: rosata e un filo piu' chiara, bordo libero quasi bianco, contorno (cuticola e pieghe ai lati) segnato
    nail_col = np.clip(sk * np.array([1.02, 0.97, 1.02], np.float32) + np.array([0.04, 0.05, 0.08], np.float32), 0, 1)
    rgb = rgb * (1 - 0.85 * nail[..., None]) + nail_col * (0.85 * nail[..., None])
    rgb = rgb * (1 - 0.55 * free[..., None]) + np.array([0.98, 0.95, 0.92], np.float32) * (0.55 * free[..., None])
    cc = np.clip(cut, 0, 1)[..., None]
    rgb = rgb * (1 - 0.26 * cc) * (1 - cc * np.array([0.0, 0.04, 0.05], np.float32))
    rough = rough * (1 - nail) + 0.34 * nail
    # nocche e pieghe alle giunture: sul dorso velo rosato e pieghette, sul palmo una riga sottile
    for k, nm in enumerate(names):
        if len(nm.split(".")) < 3:
            continue
        f, seg = nm.split(".")[0], int(nm.split(".")[1])
        if f == "thumb" and seg == 1:
            continue
        sel = best_k == k
        t = best_t[sel]; a = ang[sel]
        jt = np.exp(-(t / 0.09) ** 2) * (t > -0.08)
        dorsal = ss(70, 25, np.abs(a)); palmar = ss(110, 155, np.abs(a))
        rose = jt * dorsal * ss(60, 15, np.abs(a)) * (0.05 if seg == 1 else 0.045)
        rgb[sel] *= (1 - rose[:, None] * np.array([0.0, 0.45, 0.55], np.float32))
        if seg >= 2:
            wr = np.zeros_like(t)
            for off in (-0.045, 0.0, 0.045):
                wr += np.exp(-((t - off - 0.004 * (a / 30) ** 2) / 0.0075) ** 2)
            rgb[sel] *= (1 - 0.06 * np.clip(wr, 0, 1) * dorsal * ss(45, 20, np.abs(a)))[:, None]
        pl = np.exp(-((t - 0.02) / 0.022) ** 2) * palmar
        rgb[sel] *= (1 - 0.10 * pl)[:, None]
    # AO cotta: fra le dita, nelle pieghe (calda)
    occ = (0.38 * (1 - np.clip(AO, 0, 1)))[..., None]
    rgb = np.clip(rgb * (1 - occ * np.array([0.78, 1.0, 1.10], np.float32)), 0, 1)
    img = _img(name + "_color", rgb)
    orm = np.zeros((Hs, Ws, 3), np.float32); orm[..., 0] = 1.0; orm[..., 1] = rough
    oi = _img(name + "_orm", orm); oi.colorspace_settings.name = "Non-Color"
    oi.scale(Ws // 2, Hs // 2); oi.pack()                     # la rugosita' non chiede dettaglio
    print("hands texture painted: nail texels", int((nail > 0.5).sum()))
    return img, oi


def hand_material(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["Roughness"].default_value = 0.62
    return m


def set_hand_images(m, img, orm):
    nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    tx = nt.nodes.new("ShaderNodeTexImage"); tx.image = img
    nt.links.new(tx.outputs[0], b.inputs["Base Color"])
    t2 = nt.nodes.new("ShaderNodeTexImage"); t2.image = orm
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(t2.outputs[0], sep.inputs[0]); nt.links.new(sep.outputs["Green"], b.inputs["Roughness"])


# ---------------------------------------------------------------- pose delle dita
CURL_SPLIT = {"index": (0.40, 0.38, 0.22), "middle": (0.40, 0.38, 0.22), "ring": (0.40, 0.38, 0.22),
              "pinky": (0.42, 0.36, 0.22), "thumb": (0.25, 0.40, 0.35)}
FLEX_SIGN = {}                                  # segno della flessione per lato (misurato al montaggio)


def pose_finger(arm, side, f, curl, spread=0.0, split=None):
    """curl: flessione totale (gradi) distribuita sulle tre ossa; spread: apertura laterale della prima (gradi).
    Nelle ossa delle dita l'asse Z locale e' il dorso: flettere = ruotare attorno a X verso il palmo."""
    from mathutils import Quaternion
    sp = split or CURL_SPLIT[f]
    sg = FLEX_SIGN.get(side, -1.0)
    for k in range(3):
        pb = arm.pose.bones[f"{f}.0{k + 1}.{side}"]
        q = Quaternion((1, 0, 0), math.radians(sg * curl * sp[k]))
        if k == 0 and spread:
            q = Quaternion((0, 0, 1), math.radians(spread)) @ q
        pb.rotation_quaternion = q
