"""Natura per il mondo Virentia (Inside Monichs): alberi, felci, fiori, erba, rocce, funghi luminosi, tronco caduto.

Uso:
  blender --background --factory-startup --python scripts/blender/build_nature.py [-- --no-render | --draft]

Uscita: Modelli/3D/natura/*.glb (Y in alto, metri, origine al centro della base), texture in natura/textures,
render di controllo in Modelli/3D/render/natura_*.png. Tutto procedurale e deterministico (semi fissi).
Palette (richiesta): verdi smeraldo #1f5c2a #2f7a2c #5aa646, luci #a8e08a; crema #ede2cd, oro rosa #f0b49b.
"""
import bpy, bmesh, math, os, sys, json
import numpy as np
from mathutils import Vector, Matrix, noise

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "Modelli", "3D", "natura")
TEX = os.path.join(OUT, "textures")
RENDERS = os.path.join(ROOT, "Modelli", "3D", "render")
for d in (OUT, TEX, RENDERS):
    os.makedirs(d, exist_ok=True)
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DO_RENDER = "--no-render" not in ARGS
DRAFT = "--draft" in ARGS
RES = 640 if DRAFT else 1500
SAMPLES = 24 if DRAFT else 128

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"

PAL = {"deep": (31, 92, 42), "mid": (47, 122, 44), "light": (90, 166, 70), "glow": (168, 224, 138),
       "cream": (237, 226, 205), "rose": (240, 180, 155), "warmwhite": (255, 244, 228), "gold": (214, 168, 112)}


def col(name):
    return np.array(PAL[name], float) / 255.0


# ======================================================================= texture (numpy)
def save_image(name, arr, fmt="PNG", non_color=False):
    """arr: HxWx3/4 in [0,1], riga 0 = basso (v=0). Valori sRGB per i colori."""
    h, w, ch = arr.shape
    img = bpy.data.images.new(name, w, h, alpha=(ch == 4))
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :ch] = np.clip(arr, 0, 1)
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = os.path.join(TEX, name + (".png" if fmt == "PNG" else ".jpg"))
    img.file_format = fmt
    try:
        img.save(quality=90)
    except TypeError:
        img.save()
    return img


def smooth(t):
    return t * t * (3 - 2 * t)


def pnoise(h, w, fy, fx, rng):
    """value noise periodica (tileabile)"""
    g = rng.random((fy, fx))
    y = np.arange(h) / h * fy; x = np.arange(w) / w * fx
    y0 = np.floor(y).astype(int); x0 = np.floor(x).astype(int)
    ty = smooth(y - y0)[:, None]; tx = smooth(x - x0)[None, :]
    y1 = (y0 + 1) % fy; x1 = (x0 + 1) % fx
    a = g[np.ix_(y0, x0)]; b = g[np.ix_(y0, x1)]; c = g[np.ix_(y1, x0)]; d = g[np.ix_(y1, x1)]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def pfbm(h, w, fy, fx, octaves, rng, gain=0.5):
    out = np.zeros((h, w)); amp = 1.0; tot = 0.0
    for _ in range(octaves):
        out += amp * pnoise(h, w, fy, fx, rng); tot += amp; amp *= gain; fy *= 2; fx *= 2
    return out / tot


def normal_map(hgt, strength):
    gx = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) / 2
    gy = (np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)) / 2
    n = np.dstack([-gx * strength, -gy * strength, np.ones_like(hgt)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def box_blur(img, r):
    out = img.astype(np.float64)
    for ax in (0, 1):
        pad = [(r + 1, r) if a == ax else (0, 0) for a in range(out.ndim)]
        cs = np.cumsum(np.pad(out, pad, mode="edge"), axis=ax)
        hi = [slice(None)] * out.ndim; lo = [slice(None)] * out.ndim
        hi[ax] = slice(2 * r + 1, None); lo[ax] = slice(0, -2 * r - 1)
        out = (cs[tuple(hi)] - cs[tuple(lo)]) / (2 * r + 1)
    return out


def bleed(rgba):
    """colore nei pixel trasparenti preso dai vicini (niente aloni scuri nei mipmap)"""
    a = rgba[..., 3:4]
    rgb = rgba[..., :3].copy()
    for r in (2, 6, 16, 48):
        num = box_blur(rgba[..., :3] * a, r); den = box_blur(a, r)
        fill = num / np.maximum(den, 1e-6)
        m = (a[..., 0] < 0.5) & (den[..., 0] > 1e-4) & (rgb.sum(2) == 0)
        rgb[m] = fill[m]
    rgb[rgb.sum(2) == 0] = rgba[..., :3][a[..., 0] > 0.5].mean(0) if (a > 0.5).any() else 0.3
    out = rgba.copy(); out[..., :3] = np.where(a > 0.5, rgba[..., :3], rgb)
    return out


def down2(acc):
    """riduzione 2x con media premoltiplicata (antialias dei bordi)"""
    h, w = acc.shape[0] // 2, acc.shape[1] // 2
    a = acc[..., 3:4]
    pm = (acc[..., :3] * a).reshape(h, 2, w, 2, 3).mean((1, 3))
    am = a.reshape(h, 2, w, 2, 1).mean((1, 3))
    rgb = pm / np.maximum(am, 1e-6)
    return np.concatenate([rgb, am], -1)


class Canvas:
    """tela RGBA in coordinate (x, y) con y verso l'alto; unita' = larghezza della tela"""

    def __init__(self, wpx, hpx):
        self.W, self.H = wpx, hpx
        self.a = np.zeros((hpx, wpx, 4))

    def fill(self, poly, colfun):
        xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
        x0 = max(int(min(xs) * self.W) - 1, 0); x1 = min(int(max(xs) * self.W) + 2, self.W)
        y0 = max(int(min(ys) * self.W) - 1, 0); y1 = min(int(max(ys) * self.W) + 2, self.H)
        if x1 <= x0 or y1 <= y0:
            return
        PX, PY = np.meshgrid((np.arange(x0, x1) + 0.5) / self.W, (np.arange(y0, y1) + 0.5) / self.W)
        inside = np.zeros(PX.shape, bool)
        n = len(poly)
        for i in range(n):
            ax, ay = poly[i]; bx, by = poly[(i + 1) % n]
            inside ^= ((ay > PY) != (by > PY)) & (PX < (bx - ax) * (PY - ay) / (by - ay + 1e-12) + ax)
        if not inside.any():
            return
        c = colfun(PX, PY)
        reg = self.a[y0:y1, x0:x1]
        reg[inside, :3] = np.clip(c[inside], 0, 1)
        reg[inside, 3] = 1.0

    def line(self, pts, w0, w1, color):
        """tratto spesso lungo una polilinea (larghezza da w0 a w1)"""
        n = len(pts)
        for i in range(n - 1):
            (ax, ay), (bx, by) = pts[i], pts[i + 1]
            wa = w0 + (w1 - w0) * i / (n - 1); wb = w0 + (w1 - w0) * (i + 1) / (n - 1)
            dx, dy = bx - ax, by - ay
            L = math.hypot(dx, dy) + 1e-9
            nx, ny = -dy / L, dx / L
            poly = [(ax + nx * wa / 2, ay + ny * wa / 2), (bx + nx * wb / 2, by + ny * wb / 2),
                    (bx - nx * wb / 2, by - ny * wb / 2), (ax - nx * wa / 2, ay - ny * wa / 2)]
            self.fill(poly, lambda X, Y: np.broadcast_to(np.array(color, float), X.shape + (3,)))

    def result(self):
        return self.a


def bezier(p0, p1, p2, n=24):
    out = []
    for i in range(n + 1):
        t = i / n
        out.append(((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
                    (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]))
    return out


def leaf_color(rng, accent_prob=0.0):
    r = rng.random()
    if r < accent_prob:
        return col("rose") * rng.uniform(0.85, 1.0) if rng.random() < 0.6 else col("cream") * rng.uniform(0.9, 1.0)
    t = rng.random()
    base = col("deep") * (1 - t) + col("light") * t if rng.random() < 0.6 else col("mid") * (1 - t) + col("glow") * t * 0.7 + col("mid") * t * 0.3
    return base * rng.uniform(0.92, 1.08)


def leaf_shader(P0, u, v, L, hwf, c0, vein_k=9):
    def f(X, Y):
        dx, dy = X - P0[0], Y - P0[1]
        s = np.clip((dx * u[0] + dy * u[1]) / L, 0, 1)
        tl = (dx * v[0] + dy * v[1]) / np.maximum(hwf(s), 1e-4)
        at = np.abs(tl)
        shade = 0.78 + 0.32 * s
        mid = np.exp(-(tl / 0.07) ** 2) * 0.22
        ve = np.exp(-(((s * vein_k - at * 1.3) % 1.0 - 0.5) / 0.09) ** 2) * 0.07 * (at < 0.92)
        edge = np.clip((at - 0.72) / 0.28, 0, 1) * 0.22
        c = c0[None, None, :] * (shade * (1 - edge))[..., None] + (mid + ve)[..., None] * np.array([0.75, 0.9, 0.6])
        return c
    return f


def ovate_leaf(cv, P0, ang, L, Wd, c0, serr=0.0, pointy=0.25):
    u = (math.cos(ang), math.sin(ang)); v = (-u[1], u[0])
    def hw(s):
        s = np.asarray(s, float)
        return Wd / 2 * np.sin(np.pi * s) ** 0.72 * (1 - pointy * s) * (1 + serr * np.sin(s * 46))
    ss = np.linspace(0, 1, 30)
    left = [(P0[0] + u[0] * s * L + v[0] * float(hw(s)), P0[1] + u[1] * s * L + v[1] * float(hw(s))) for s in ss]
    right = [(P0[0] + u[0] * s * L - v[0] * float(hw(s)), P0[1] + u[1] * s * L - v[1] * float(hw(s))) for s in ss[::-1]]
    cv.fill(left + right, leaf_shader(P0, u, v, L, hw, c0))


def palmate_leaf(cv, P0, ang, R, c0, lobes=7):
    pts = []
    for a in np.linspace(-np.pi, np.pi, 140, endpoint=False):
        lobe = np.abs(np.cos(lobes * a / 2.0 * (2.6 / np.pi) * np.pi / 2.6)) ** 2.5
        r = R * (0.42 + 0.58 * lobe) * (1 - 0.55 * (abs(a) / np.pi) ** 3)
        if abs(a) > np.pi * 0.86:
            r *= 0.35
        pts.append((P0[0] + r * math.cos(ang + a), P0[1] + r * math.sin(ang + a)))
    def f(X, Y):
        dx, dy = X - P0[0], Y - P0[1]
        rr = np.hypot(dx, dy) / R
        aa = np.arctan2(dy, dx) - ang
        aa = (aa + np.pi) % (2 * np.pi) - np.pi
        vein = np.abs(np.cos(lobes * aa / 2.0)) ** 40 * 0.25
        shade = 0.8 + 0.3 * rr
        edge = np.clip((rr - 0.75) / 0.3, 0, 1) * 0.15
        return c0[None, None, :] * (shade * (1 - edge))[..., None] + vein[..., None] * np.array([0.7, 0.85, 0.55])
    cv.fill(pts, f)


def spray_cell(kind, rng, wpx=1024):
    """un rametto con foglie in una cella quadrata (lato = 1 unita')"""
    cv = Canvas(wpx, wpx)
    base = (0.5 + rng.uniform(-0.04, 0.04), 0.02)
    tip = (0.5 + rng.uniform(-0.12, 0.12), 0.9)
    mid = (0.5 + rng.uniform(-0.15, 0.15), 0.5)
    twig = bezier(base, mid, tip, 30)
    cv.line(twig, 0.016, 0.004, (0.33, 0.27, 0.2))
    if kind == "faggio":
        n, Lr, Wf, serr, acc = int(rng.integers(10, 14)), (0.2, 0.3), 0.55, 0.025, 0.0
    elif kind == "acero":
        n, Lr, Wf, serr, acc = int(rng.integers(7, 10)), (0.13, 0.18), 0, 0, 0.08
    else:
        n, Lr, Wf, serr, acc = int(rng.integers(16, 21)), (0.11, 0.15), 0.72, 0.05, 0.0
    order = list(range(n))
    for i in order:
        t = 0.12 + 0.83 * i / max(n - 1, 1)
        k = int(t * (len(twig) - 1))
        p = twig[k]; q = twig[min(k + 1, len(twig) - 1)]
        da = math.atan2(q[1] - p[1], q[0] - p[0])
        side = 1 if i % 2 == 0 else -1
        ang = da + side * math.radians(rng.uniform(35, 65)) * (1 - 0.3 * t)
        c0 = leaf_color(rng, acc)
        pet = rng.uniform(0.015, 0.035)
        P0 = (p[0] + math.cos(ang) * pet, p[1] + math.sin(ang) * pet)
        cv.line([p, P0], 0.006, 0.004, (0.3, 0.33, 0.18))
        if kind == "acero":
            palmate_leaf(cv, (P0[0] + math.cos(ang) * 0.08, P0[1] + math.sin(ang) * 0.08), ang, rng.uniform(*Lr), c0)
        else:
            L = rng.uniform(*Lr) * (1.05 - 0.25 * t)
            ovate_leaf(cv, P0, ang, L, L * Wf, c0, serr, pointy=0.35 if kind == "betulla" else 0.25)
    # foglia apicale
    da = math.atan2(twig[-1][1] - twig[-3][1], twig[-1][0] - twig[-3][0])
    c0 = leaf_color(rng, acc)
    if kind == "acero":
        palmate_leaf(cv, (twig[-1][0] + math.cos(da) * 0.07, twig[-1][1] + math.sin(da) * 0.07), da, Lr[1], c0)
    else:
        L = Lr[1] * 0.9
        ovate_leaf(cv, twig[-1], da, L, L * Wf, c0, serr)
    return down2(cv.result())


def leaf_atlas(kind, seed):
    rng = np.random.default_rng(seed)
    out = np.zeros((1024, 1024, 4))
    for ci in range(4):
        cell = spray_cell(kind, rng)
        r, c = divmod(ci, 2)
        out[r * 512:(r + 1) * 512, c * 512:(c + 1) * 512] = cell
    return save_image(f"foglie_{kind}", bleed(out), "PNG")


def bark_texture(kind):
    n = 1024
    rng = np.random.default_rng({"faggio": 11, "acero": 12, "betulla": 13}[kind])
    if kind == "faggio":                      # grigio argento liscio, rughe orizzontali, licheni
        n1 = pfbm(n, n, 6, 3, 5, rng); wr = pfbm(n, n, 48, 3, 3, rng); lic = pfbm(n, n, 6, 6, 4, rng)
        c = np.array([0.62, 0.62, 0.59])[None, None, :] * (0.85 + 0.35 * (n1 - 0.5))[..., None] * (0.93 + 0.14 * (wr - 0.5))[..., None]
        li = np.clip((lic - 0.6) * 4, 0, 1)[..., None] * 0.45
        c = c * (1 - li) + np.array([0.56, 0.64, 0.5]) * li
        h = 0.6 * n1 + 0.4 * wr
        st = 3.0
    elif kind == "acero":                     # bruno caldo con fessure verticali
        fis = pfbm(n, n, 3, 20, 5, rng); fn = pfbm(n, n, 8, 8, 4, rng)
        ridge = 1 - np.abs(fis - 0.5) * 2
        c = np.array([0.42, 0.3, 0.22])[None, None, :] * (0.55 + 0.6 * ridge ** 1.5)[..., None] * (0.9 + 0.2 * fn)[..., None]
        h = ridge
        st = 6.0
    else:                                     # betulla: bianco argento, lenticelle orizzontali, macchie scure
        nb = pfbm(n, n, 4, 4, 5, rng); le = pfbm(n, n, 40, 5, 2, rng); pa = pfbm(n, n, 5, 3, 4, rng)
        lent = np.clip((le - 0.66) * 9, 0, 1); patch = np.clip((pa - 0.64) * 6, 0, 1)
        c = np.array([0.88, 0.87, 0.83])[None, None, :] * (0.9 + 0.12 * nb)[..., None]
        dark = np.array([0.17, 0.15, 0.14])
        c = c * (1 - lent[..., None] * 0.9) + dark * lent[..., None] * 0.9
        c = c * (1 - patch[..., None] * 0.6) + dark * patch[..., None] * 0.6
        h = 0.3 * nb - lent - 0.5 * patch
        st = 2.5
    return save_image(f"corteccia_{kind}", c, "JPEG"), save_image(f"corteccia_{kind}_normal", normal_map(h, st), "JPEG", True)


def fern_atlas():
    """due fronde (meta' sinistra e destra), ognuna 512 x 1024"""
    rng = np.random.default_rng(21)
    out = np.zeros((1024, 1024, 4))
    for vi in range(2):
        cv = Canvas(1024, 2048)                  # unita' = larghezza della cella; altezza 2
        tip = (0.5 + rng.uniform(-0.05, 0.05), 1.96)
        rach = bezier((0.5, 0.02), (0.5 + rng.uniform(-0.06, 0.06), 1.0), tip, 60)
        light = vi == 1
        cv.line(rach, 0.014, 0.004, (0.24, 0.42, 0.18))
        npairs = 24
        for k in range(npairs):
            y = 0.04 + 0.92 * k / npairs
            idx = int(y * (len(rach) - 1)); p = rach[idx]
            lp = 0.46 * (y + 0.08) ** 0.35 * (1 - y) ** 0.9 * 1.9
            for side in (1, -1):
                ang = math.pi / 2 - side * math.radians(rng.uniform(52, 66))
                u = (math.cos(ang), math.sin(ang)); v = (-u[1], u[0])
                wb = 0.05 * (1 - 0.5 * y)
                def hw(s, wb=wb):
                    s = np.asarray(s, float)
                    return wb * (1 - s) ** 0.8 * (0.75 + 0.45 * np.abs(np.sin(s * np.pi * 7)))
                ss = np.linspace(0, 1, 40)
                P0 = (p[0] + side * 0.004, p[1])
                left = [(P0[0] + u[0] * s * lp + v[0] * float(hw(s)), P0[1] + u[1] * s * lp + v[1] * float(hw(s))) for s in ss]
                right = [(P0[0] + u[0] * s * lp - v[0] * float(hw(s)), P0[1] + u[1] * s * lp - v[1] * float(hw(s))) for s in ss[::-1]]
                t = rng.random()
                c0 = (col("mid") * (1 - t) + col("light") * t) if not light else (col("light") * (1 - t) + col("glow") * t)
                c0 = c0 * (0.85 + 0.25 * y)
                cv.fill(left + right, leaf_shader(P0, u, v, lp, hw, c0, vein_k=14))
        cell = down2(cv.result())
        out[:, vi * 512:(vi + 1) * 512] = cell
    return save_image("fronde_felce", bleed(out), "PNG")


def grass_atlas():
    """celle: 0 erba, 1 erba con fiorellini, 2 cuscino di muschio fiorito, 3 trifoglio"""
    rng = np.random.default_rng(31)
    out = np.zeros((1024, 1024, 4))
    for ci in range(4):
        cv = Canvas(1024, 1024)
        if ci in (0, 1):
            for b in range(46):
                x0 = 0.5 + rng.normal(0, 0.08)
                lean = rng.normal(0, 0.18)
                L = rng.uniform(0.45, 0.95)
                p0 = (x0, 0.0); p2 = (x0 + lean * L, L); p1 = (x0 + lean * L * 0.2, L * 0.55)
                cl = bezier(p0, p1, p2, 16)
                t = rng.random()
                c0 = col("deep") * (1 - t) + col("light") * t
                w0 = rng.uniform(0.018, 0.032)
                for i in range(len(cl) - 1):
                    s = i / (len(cl) - 1)
                    cc = c0 * (0.8 + 0.4 * s) + col("glow") * 0.15 * s
                    cv.line([cl[i], cl[i + 1]], w0 * (1 - s) ** 0.9 + 0.002, w0 * (1 - (i + 1) / (len(cl) - 1)) ** 0.9 + 0.002, cc)
            if ci == 1:
                for f in range(9):
                    cx, cy = 0.5 + rng.normal(0, 0.13), rng.uniform(0.55, 0.9)
                    for pk in range(5):
                        a = pk * 2 * math.pi / 5
                        ovate_leaf(cv, (cx, cy), a, 0.03, 0.022, col("warmwhite") * rng.uniform(0.95, 1.0))
                    cv.fill([(cx + 0.008 * math.cos(a), cy + 0.008 * math.sin(a)) for a in np.linspace(0, 2 * np.pi, 10, endpoint=False)],
                            lambda X, Y: np.broadcast_to(col("gold"), X.shape + (3,)))
        elif ci == 2:
            # cuscino: tante foglioline in una macchia arrotondata + fiorellini crema
            for k in range(420):
                rr = np.sqrt(rng.random()) * 0.42
                a = rng.uniform(0, 2 * np.pi)
                cx, cy = 0.5 + rr * math.cos(a), 0.45 + rr * math.sin(a) * 0.85
                t = rng.random()
                c0 = col("mid") * (1 - t) + col("glow") * t * 0.8 + col("light") * t * 0.2
                ovate_leaf(cv, (cx, cy), rng.uniform(0, 2 * np.pi), rng.uniform(0.03, 0.05), 0.025, c0)
            for f in range(14):
                rr = np.sqrt(rng.random()) * 0.35; a = rng.uniform(0, 2 * np.pi)
                cx, cy = 0.5 + rr * math.cos(a), 0.45 + rr * math.sin(a) * 0.85
                for pk in range(5):
                    ovate_leaf(cv, (cx, cy), pk * 2 * math.pi / 5, 0.022, 0.016, col("cream"))
        else:
            for k in range(60):
                cx, cy = 0.5 + rng.normal(0, 0.16), 0.1 + rng.random() * 0.75
                cv.line([(cx, 0.0), (cx, cy)], 0.006, 0.004, (0.25, 0.45, 0.2))
                t = rng.random()
                c0 = col("mid") * (1 - t) + col("light") * t
                for lf in range(3):
                    a = math.pi / 2 + (lf - 1) * 2 * math.pi / 3
                    ovate_leaf(cv, (cx, cy), a, 0.06, 0.06, c0, 0.0, pointy=-0.2)
        r, c = divmod(ci, 2)
        out[r * 512:(r + 1) * 512, c * 512:(c + 1) * 512] = down2(cv.result())
    return save_image("erba", bleed(out), "PNG")


def stone_textures():
    n = 1024
    rng = np.random.default_rng(41)
    a = pfbm(n, n, 4, 4, 6, rng); b = pfbm(n, n, 16, 16, 3, rng); cr = pfbm(n, n, 6, 6, 5, rng)
    crack = np.clip(1 - np.abs(cr - 0.5) * 40, 0, 1)
    c = np.array([0.5, 0.49, 0.47])[None, None, :] * (0.75 + 0.45 * (a - 0.5) + 0.1 * (b - 0.5))[..., None]
    c = c * (1 - 0.35 * crack[..., None]) + np.array([0.6, 0.55, 0.48]) * 0.06
    h = a + 0.3 * b - 0.6 * crack
    rock = save_image("roccia", c, "JPEG"); rockn = save_image("roccia_normal", normal_map(h, 4.0), "JPEG", True)
    m1 = pfbm(512, 512, 8, 8, 5, rng); m2 = pfbm(512, 512, 64, 64, 2, rng)
    t = np.clip(m1 * 1.2 - 0.1, 0, 1)[..., None]
    mc = col("deep") * (1 - t) + col("light") * t
    mc = mc * (0.85 + 0.3 * m2[..., None])
    moss = save_image("muschio", mc, "JPEG"); mossn = save_image("muschio_normal", normal_map(m2 * 0.6 + m1, 3.0), "JPEG", True)
    rings = np.zeros((512, 512, 3))
    yy, xx = np.mgrid[0:512, 0:512] / 512.0 - 0.5
    rr = np.hypot(xx, yy)
    w = 0.5 + 0.5 * np.sin(rr * 160 + 3 * pfbm(512, 512, 6, 6, 3, rng))
    rings[:] = np.array([0.62, 0.48, 0.34]) * (0.75 + 0.25 * w)[..., None]
    wood = save_image("legno_sezione", rings, "JPEG")
    return rock, rockn, moss, mossn, wood


# ======================================================================= materiali
def mat_tex(name, img, nimg=None, rough=0.8, alpha=False, metal=0.0, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if img is not None:
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = img
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
        if alpha:
            rnd = nt.nodes.new("ShaderNodeMath"); rnd.operation = "ROUND"
            nt.links.new(t.outputs["Alpha"], rnd.inputs[0]); nt.links.new(rnd.outputs[0], b.inputs["Alpha"])
            m.use_backface_culling = False
            try:
                m.surface_render_method = "DITHERED"
            except Exception:
                pass
    if nimg is not None:
        tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = nimg
        tn.image.colorspace_settings.name = "Non-Color"
        nm = nt.nodes.new("ShaderNodeNormalMap"); nm.inputs["Strength"].default_value = 0.8
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"]); nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    if emission is not None:
        b.inputs["Emission Color"].default_value = (*emission, 1)
        b.inputs["Emission Strength"].default_value = strength
    return m


def mat_col(name, rgb, rough=0.55, emission=None, strength=0.0, double=True):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb_to_lin(rgb), 1)
    b.inputs["Roughness"].default_value = rough
    if emission is not None:
        b.inputs["Emission Color"].default_value = (*srgb_to_lin(emission), 1)
        b.inputs["Emission Strength"].default_value = strength
    m.use_backface_culling = not double
    m.diffuse_color = (*srgb_to_lin(rgb), 1)
    return m


def srgb_to_lin(c):
    c = np.asarray(c, float)
    return tuple(np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4))


# ======================================================================= geometria
def new_bm():
    bm = bmesh.new()
    return bm, bm.loops.layers.uv.new("UVMap")


def to_object(bm, name, mats, smooth=True, sharp_deg=50):
    if smooth:
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(sharp_deg):
                e.smooth = False
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    for m in (mats if isinstance(mats, (list, tuple)) else [mats]):
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


def tube(bm, uvl, pts, radii, sides, v_len=2.0, mat_index=0):
    """tubo con trasporto parallelo del riferimento; UV: u attorno, v lungo (ripetizione ogni v_len metri)"""
    n = len(pts)
    tans = []
    for i in range(n):
        a = pts[max(i - 1, 0)]; b = pts[min(i + 1, n - 1)]
        tans.append((b - a).normalized())
    ref = Vector((0, 0, 1)) if abs(tans[0].z) < 0.9 else Vector((1, 0, 0))
    nrm = (ref - tans[0] * ref.dot(tans[0])).normalized()
    rings = []; vs = []; cum = 0.0
    for i in range(n):
        t = tans[i]
        if i > 0:
            nrm = (nrm - t * nrm.dot(t)).normalized()
            cum += (pts[i] - pts[i - 1]).length
        b = t.cross(nrm)
        rings.append([bm.verts.new(pts[i] + (nrm * math.cos(2 * math.pi * j / sides) + b * math.sin(2 * math.pi * j / sides)) * radii[i])
                      for j in range(sides)])
        vs.append(cum / v_len)
    for i in range(n - 1):
        for j in range(sides):
            k = (j + 1) % sides
            f = bm.faces.new((rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j]))
            f.material_index = mat_index
            uvs = [(j / sides, vs[i]), ((j + 1) / sides, vs[i]), ((j + 1) / sides, vs[i + 1]), (j / sides, vs[i + 1])]
            for l, uv in zip(f.loops, uvs):
                l[uvl].uv = uv
    return rings


def card(bm, uvl, base, up, normal, w, h, cell, segs=1, bend=0.0, mat_index=0):
    """piano con texture: base = centro del lato inferiore; up = direzione della cella (v); bend = curvatura verso normal"""
    up = up.normalized()
    nrm = (normal - up * normal.dot(up)).normalized()
    side = up.cross(nrm).normalized()
    u0, v0, u1, v1 = cell
    rows = []
    for i in range(segs + 1):
        s = i / segs
        p = base + up * (h * s) + nrm * (bend * s * s)
        rows.append([bm.verts.new(p - side * (w / 2)), bm.verts.new(p + side * (w / 2))])
    for i in range(segs):
        f = bm.faces.new((rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]))
        f.material_index = mat_index
        s0, s1 = i / segs, (i + 1) / segs
        uvs = [(u0, v0 + (v1 - v0) * s0), (u1, v0 + (v1 - v0) * s0), (u1, v0 + (v1 - v0) * s1), (u0, v0 + (v1 - v0) * s1)]
        for l, uv in zip(f.loops, uvs):
            l[uvl].uv = uv


ATLAS4 = [(0.0, 0.0, 0.5, 0.5), (0.5, 0.0, 1.0, 0.5), (0.0, 0.5, 0.5, 1.0), (0.5, 0.5, 1.0, 1.0)]


def rand_unit(rng):
    v = Vector(rng.normal(0, 1, 3))
    return v.normalized()


# ----------------------------------------------------------------------- alberi
TREES = {
    "albero_a": dict(kind="faggio", H=17.5, R0=0.34, crown_lo=0.3, crown_r=4.6, n1=20, elev=(28, 52), sin_amp=0.35,
                     card=1.55, cards=5600, curv=0.05, droop=0.0, seed=101),
    "albero_b": dict(kind="acero", H=14.5, R0=0.3, crown_lo=0.22, crown_r=4.5, n1=17, elev=(12, 36), sin_amp=0.55,
                     card=1.6, cards=5400, curv=0.03, droop=0.0, seed=202),
    "albero_c": dict(kind="betulla", H=17.5, R0=0.24, crown_lo=0.34, crown_r=4.0, n1=26, elev=(40, 62), sin_amp=0.28,
                     card=1.2, cards=6000, curv=0.04, droop=0.09, seed=303),
}


def envelope(kind, u):
    """raggio relativo della chioma alla quota relativa u (0 = base chioma, 1 = cima)"""
    u = min(max(u, 0.0), 1.0)
    if kind == "faggio":
        return math.sin(math.pi * min(u * 1.1, 1.0)) ** 0.65
    if kind == "acero":
        return math.sin(math.pi * min(u * 1.05, 1.0)) ** 0.45
    return math.sin(math.pi * u) ** 0.85


def build_tree(name, p, bark_mat, leaf_mat):
    rng = np.random.default_rng(p["seed"])
    H, R0 = p["H"], p["R0"]
    # tronco sinuoso con colletto
    ph1, ph2 = rng.uniform(0, 6.28, 2)
    tpts, trad = [], []
    for i in range(30):
        s = i / 29
        z = -0.05 + s * H
        amp = p["sin_amp"] * s ** 1.2
        x = amp * math.sin(2 * math.pi * s * 1.1 + ph1)
        y = amp * 0.7 * math.sin(2 * math.pi * s * 0.8 + ph2)
        tpts.append(Vector((x - p["sin_amp"] * 0 , y, z)))
        r = R0 * (1 - 0.88 * s ** 0.9) + 0.03
        r *= 1 + 0.55 * math.exp(-max(z, 0) / 0.5)
        trad.append(r)
    # ricentra la base
    off = Vector((tpts[0].x, tpts[0].y, 0))
    tpts = [q - off for q in tpts]

    def trunk_at(hz):
        s = min(max((hz + 0.05) / H, 0), 1) * 29
        i = min(int(s), 28); f = s - i
        return tpts[i].lerp(tpts[i + 1], f), trad[i] * (1 - f) + trad[i + 1] * f

    branches = []      # (pts, radii, level, length)
    lo = p["crown_lo"] * H
    n1 = p["n1"]
    for i in range(n1):
        u = (i + rng.uniform(0, 0.8)) / n1
        hz = lo + u * (H * 0.93 - lo)
        P0, rt = trunk_at(hz)
        phi = math.radians(i * 137.5 + rng.uniform(-15, 15))
        e = math.radians(p["elev"][0] + (p["elev"][1] - p["elev"][0]) * u + rng.uniform(-6, 6))
        uc = (hz - lo) / (H - lo)
        Lb = max(p["crown_r"] * envelope(p["kind"], uc + 0.12) / max(math.cos(e), 0.35), 0.8) * rng.uniform(0.85, 1.05)
        Lb = min(Lb, max((H - hz) / max(math.sin(e), 0.25), 1.0))     # la chioma non supera l'altezza H
        d = Vector((math.cos(phi) * math.cos(e), math.sin(phi) * math.cos(e), math.sin(e)))
        pts = [P0.copy()]; segs = 9
        for k in range(segs):
            t = (k + 1) / segs
            d = (d + Vector((0, 0, p["curv"])) - Vector((0, 0, p["droop"] * t * t * 2.2)) + rand_unit(rng) * 0.05).normalized()
            pts.append(pts[-1] + d * (Lb / segs))
        rb = max(rt * 0.5 * (Lb / p["crown_r"]) ** 0.4, 0.04)
        rad = [rb * (1 - 0.85 * (k / segs) ** 0.8) + 0.012 for k in range(segs + 1)]
        branches.append((pts, rad, 1, Lb))
        # secondari
        n2 = int(rng.integers(4, 7))
        for j in range(n2):
            t = 0.28 + 0.66 * (j + rng.uniform(0, 0.6)) / n2
            kf = t * segs; ki = min(int(kf), segs - 1); ff = kf - ki
            Q0 = pts[ki].lerp(pts[ki + 1], ff)
            pd = (pts[ki + 1] - pts[ki]).normalized()
            sideax = pd.cross(Vector((0, 0, 1)))
            if sideax.length < 1e-3:
                sideax = Vector((1, 0, 0))
            sideax.normalize()
            sgn = 1 if j % 2 == 0 else -1
            rotq = Matrix.Rotation(math.radians(rng.uniform(35, 55)) * sgn, 3, Vector((0, 0, 1)))
            d2 = (rotq @ pd + Vector((0, 0, 0.25 - p["droop"] * 2))).normalized()
            L2 = Lb * rng.uniform(0.32, 0.48) * (1 - 0.4 * t)
            q = [Q0.copy()]; s2 = 4
            for k in range(s2):
                tt = (k + 1) / s2
                d2 = (d2 + Vector((0, 0, p["curv"] * 0.6)) - Vector((0, 0, p["droop"] * tt * 2.5)) + rand_unit(rng) * 0.06).normalized()
                q.append(q[-1] + d2 * (L2 / s2))
            r2 = max(rad[ki] * 0.55, 0.018)
            branches.append((q, [r2 * (1 - 0.8 * k / s2) + 0.008 for k in range(s2 + 1)], 2, L2))
    # corteccia
    bm, uvl = new_bm()
    tube(bm, uvl, tpts, trad, 12, v_len=2.2)
    for pts, rad, lvl, L in branches:
        tube(bm, uvl, pts, rad, 6 if lvl == 1 else 4, v_len=2.2)
    bark = to_object(bm, "corteccia", bark_mat, smooth=True, sharp_deg=80)
    # foglie: rametti su piani lungo i rami (soprattutto nella parte esterna) -> chioma morbida a strati
    bm, uvl = new_bm()
    cand = []
    for pts, rad, lvl, L in branches:
        t0 = 0.35 if lvl == 2 else 0.55
        nseg = len(pts) - 1
        dens = (2.4 if lvl == 2 else 1.4) * L
        cnt = max(int(dens), 1)
        for k in range(cnt):
            t = t0 + (1 - t0) * (k + rng.uniform(0, 1)) / cnt
            kf = t * nseg; ki = min(int(kf), nseg - 1); ff = kf - ki
            P = pts[ki].lerp(pts[ki + 1], ff)
            dd = (pts[ki + 1] - pts[ki]).normalized()
            cand.append((P, dd))
    # scala al numero di piani voluto
    target = p["cards"]
    reps = max(1, int(round(target / max(len(cand), 1))))
    count = 0
    for rep in range(reps + 1):
        for P, dd in cand:
            if count >= target:
                break
            if rep == reps and rng.random() > (target - count) / max(len(cand), 1):
                continue
            out = Vector((P.x, P.y, 0))
            out = out.normalized() if out.length > 1e-3 else Vector((1, 0, 0))
            jitter = rand_unit(rng) * 0.45
            base = P + jitter * 0.6 * p["card"]
            up_dir = (dd * 0.55 + out * 0.45 + rand_unit(rng) * 0.35)
            if p["droop"] > 0:
                up_dir += Vector((0, 0, -0.55 * rng.random()))
            nrm = Vector((0, 0, 1)) * 0.7 + out * 0.3 + rand_unit(rng) * 0.4
            sz = p["card"] * rng.uniform(0.8, 1.2)
            card(bm, uvl, base, up_dir, nrm, sz, sz, ATLAS4[int(rng.integers(0, 4))], segs=1)
            count += 1
    leaves = to_object(bm, "foglie", leaf_mat, smooth=False)
    # normali delle foglie verso l'alto (illuminazione morbida della chioma)
    return [bark, leaves]


# ----------------------------------------------------------------------- felci
def build_fern(name, variant, mat):
    rng = np.random.default_rng(500 + variant)
    bm, uvl = new_bm()
    if variant == 0:
        n, Lr, a_r, cell = 18, (1.25, 1.6), (8, 30), (0.0, 0.0, 0.5, 1.0)
    else:
        n, Lr, a_r, cell = 22, (0.95, 1.2), (24, 50), (0.5, 0.0, 1.0, 1.0)
    for i in range(n):
        phi = math.radians(i * 137.5 + rng.uniform(-10, 10))
        out = Vector((math.cos(phi), math.sin(phi), 0))
        tang = Vector((-math.sin(phi), math.cos(phi), 0))
        L = rng.uniform(*Lr)
        W = L * 0.5
        a = math.radians(rng.uniform(*a_r))
        segs = 10
        pts = []
        d = (Vector((0, 0, 1)) * math.cos(a) + out * math.sin(a)).normalized()
        P = out * 0.04
        for k in range(segs + 1):
            pts.append(P.copy())
            t = k / segs
            d = (d + out * 0.04 - Vector((0, 0, 0.085 * t))).normalized()
            P = P + d * (L / segs)
        rows = []
        for k, P in enumerate(pts):
            s = k / segs
            twist = tang * math.cos(0.3 * s) + Vector((0, 0, 1)) * math.sin(0.3 * s) * 0.2
            side = twist.normalized()
            rows.append([bm.verts.new(P - side * W / 2), bm.verts.new(P + side * W / 2)])
        u0, v0, u1, v1 = cell
        for k in range(segs):
            f = bm.faces.new((rows[k][0], rows[k][1], rows[k + 1][1], rows[k + 1][0]))
            s0, s1 = k / segs, (k + 1) / segs
            for l, uv in zip(f.loops, [(u0, s0), (u1, s0), (u1, s1), (u0, s1)]):
                l[uvl].uv = uv
    return [to_object(bm, "fronde", mat, smooth=True, sharp_deg=89)]


# ----------------------------------------------------------------------- fiori
def petal(bm, center, ang, elev, L, W, cup, mat_index, rot_twist=0.0):
    """petalo curvo: griglia 3 x 2, base al centro, orientato con azimut ang ed elevazione elev"""
    rows = []
    for i in range(4):
        s = i / 3
        w = W * math.sin(math.pi * (0.18 + 0.82 * s)) ** 0.6 * (1 - 0.25 * s)
        row = []
        for t in (-1, 0, 1):
            x = s * L
            y = t * w / 2
            z = cup * s * s + abs(t) * w * 0.25
            row.append(Vector((x, y, z)))
        rows.append(row)
    M = Matrix.Translation(center) @ Matrix.Rotation(ang, 4, "Z") @ Matrix.Rotation(-elev, 4, "Y")
    vr = [[bm.verts.new(M @ v) for v in row] for row in rows]
    for i in range(3):
        for j in range(2):
            f = bm.faces.new((vr[i][j], vr[i][j + 1], vr[i + 1][j + 1], vr[i + 1][j]))
            f.material_index = mat_index


def stem(bm, base, top, r, mat_index, bend=Vector((0, 0, 0))):
    pts = []
    for i in range(5):
        t = i / 4
        pts.append(base.lerp(top, t) + bend * math.sin(math.pi * t))
    uvl = bm.loops.layers.uv.active
    tube(bm, uvl, pts, [r * (1 - 0.3 * i / 4) for i in range(5)], 4, mat_index=mat_index)


def build_flowers(name, variant, mats):
    """mats: petali, centri, steli"""
    rng = np.random.default_rng(700 + variant)
    bm, uvl = new_bm()
    if variant == 0:            # anemoni crema, 5-6 petali
        n = 7
        for i in range(n):
            a = rng.uniform(0, 2 * np.pi); r = rng.uniform(0, 0.09)
            base = Vector((r * math.cos(a), r * math.sin(a), 0))
            h = rng.uniform(0.24, 0.42)
            top = base + Vector((rng.normal(0, 0.04), rng.normal(0, 0.04), h))
            stem(bm, base, top, 0.004, 2, Vector((rng.normal(0, 0.02), rng.normal(0, 0.02), 0)))
            np_ = int(rng.integers(5, 7))
            tilt = Matrix.Rotation(rng.uniform(0, 0.4), 4, Vector((rng.normal(), rng.normal(), 0)).normalized())
            for k in range(np_):
                petal(bm, top, 2 * math.pi * k / np_ + rng.uniform(-0.1, 0.1), math.radians(rng.uniform(18, 30)),
                      0.035, 0.026, 0.008, 0)
            ctr = bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=4, radius=0.008)
            for v in ctr["verts"]:
                v.co = v.co * Vector((1, 1, 0.6)) + top + Vector((0, 0, 0.004))
            for f in {f for v in ctr["verts"] for f in v.link_faces}:
                f.material_index = 1
    elif variant == 1:          # campanule oro rosa, penduli
        for i in range(5):
            a = rng.uniform(0, 2 * np.pi); r = rng.uniform(0, 0.07)
            base = Vector((r * math.cos(a), r * math.sin(a), 0))
            h = rng.uniform(0.3, 0.48)
            top = base + Vector((rng.normal(0, 0.05), rng.normal(0, 0.05), h))
            stem(bm, base, top, 0.0045, 2, Vector((rng.normal(0, 0.03), rng.normal(0, 0.03), 0)))
            for b in range(int(rng.integers(2, 4))):
                t = 0.62 + 0.13 * b
                P = base.lerp(top, t) + Vector((rng.normal(0, 0.02), rng.normal(0, 0.02), 0))
                dirv = Vector((rng.normal(0, 1), rng.normal(0, 1), 0)).normalized()
                hang = P + dirv * 0.035
                stem(bm, P, hang + Vector((0, 0, 0.005)), 0.0025, 2)
                # campanula: tornio 8 lati
                prof = [(0.003, 0.0), (0.012, -0.006), (0.017, -0.02), (0.019, -0.033), (0.024, -0.04)]
                rings = []
                for rr_, zz in prof:
                    rings.append([bm.verts.new(hang + Vector((rr_ * math.cos(2 * math.pi * j / 8), rr_ * math.sin(2 * math.pi * j / 8), zz))) for j in range(8)])
                for ri in range(len(rings) - 1):
                    for j in range(8):
                        k = (j + 1) % 8
                        f = bm.faces.new((rings[ri][j], rings[ri][k], rings[ri + 1][k], rings[ri + 1][j]))
                        f.material_index = 0
    else:                       # ombrelle bianco caldo (fiorellini)
        for i in range(6):
            a = rng.uniform(0, 2 * np.pi); r = rng.uniform(0, 0.08)
            base = Vector((r * math.cos(a), r * math.sin(a), 0))
            h = rng.uniform(0.17, 0.3)
            top = base + Vector((rng.normal(0, 0.03), rng.normal(0, 0.03), h))
            stem(bm, base, top, 0.0035, 2)
            for f_ in range(12):
                aa = rng.uniform(0, 2 * np.pi); rr_ = math.sqrt(rng.random()) * 0.03
                fc = top + Vector((rr_ * math.cos(aa), rr_ * math.sin(aa), 0.012 - rr_ * 0.2))
                for k in range(5):
                    petal(bm, fc, 2 * math.pi * k / 5, math.radians(10), 0.008, 0.007, 0.0, 0) if False else None
                # fiorellino a 5 petali come disco stellato (5 triangoli)
                ctrv = bm.verts.new(fc + Vector((0, 0, 0.001)))
                ring = []
                for k in range(10):
                    rr2 = 0.0075 if k % 2 == 0 else 0.0035
                    ak = aa + 2 * math.pi * k / 10
                    ring.append(bm.verts.new(fc + Vector((rr2 * math.cos(ak), rr2 * math.sin(ak), 0))))
                for k in range(10):
                    f = bm.faces.new((ctrv, ring[k], ring[(k + 1) % 10]))
                    f.material_index = 0
    # foglie basali (piani verdi semplici)
    for k in range(8):
        a = 2 * math.pi * k / 8 + rng.uniform(-0.3, 0.3)
        d = Vector((math.cos(a), math.sin(a), 0))
        L = rng.uniform(0.08, 0.14)
        P0 = Vector((0, 0, 0.005)); tip = P0 + d * L + Vector((0, 0, L * 0.35))
        side = d.cross(Vector((0, 0, 1))).normalized()
        v = [bm.verts.new(P0), bm.verts.new(P0.lerp(tip, 0.5) + side * L * 0.22 + Vector((0, 0, 0.02))),
             bm.verts.new(tip), bm.verts.new(P0.lerp(tip, 0.5) - side * L * 0.22 + Vector((0, 0, 0.02)))]
        f = bm.faces.new(v); f.material_index = 3
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return [to_object(bm, "fiori", mats, smooth=True, sharp_deg=70)]


# ----------------------------------------------------------------------- erba e muschio
def build_grass(name, variant, mat):
    rng = np.random.default_rng(900 + variant)
    bm, uvl = new_bm()
    if variant == 0:            # ciuffo d'erba alto con qualche fiorellino
        for i in range(12):
            phi = math.radians(i * 30 + rng.uniform(-12, 12))
            out = Vector((math.cos(phi), math.sin(phi), 0))
            tang = Vector((-math.sin(phi), math.cos(phi), 0))
            h = rng.uniform(0.38, 0.55)
            base = out * rng.uniform(0.0, 0.06)
            cell = ATLAS4[1] if i % 4 == 0 else ATLAS4[0]
            card(bm, uvl, base, Vector((0, 0, 1)) + out * rng.uniform(0.1, 0.35), tang + out * rng.uniform(-0.3, 0.3),
                 rng.uniform(0.32, 0.45), h, cell, segs=3, bend=h * 0.25)
    else:                       # cuscino di muschio fiorito e trifoglio, basso
        for i in range(14):
            phi = math.radians(i * 137.5)
            out = Vector((math.cos(phi), math.sin(phi), 0))
            r = 0.05 + 0.2 * math.sqrt((i + 1) / 14)
            base = out * r * 0.5
            tilt = rng.uniform(0.5, 1.2)
            up = (out * math.cos(tilt) * 1.0 + Vector((0, 0, 1)) * math.sin(tilt) * 0.6)
            nrm = Vector((0, 0, 1)) - out * 0.3
            cell = ATLAS4[2] if i % 3 else ATLAS4[3]
            card(bm, uvl, base, up, nrm, rng.uniform(0.22, 0.32), rng.uniform(0.2, 0.3), cell, segs=2, bend=0.03)
    return [to_object(bm, "erba", mat, smooth=False)]


# ----------------------------------------------------------------------- rocce
def build_rock(name, variant, mats):
    rng = np.random.default_rng(1100 + variant)
    bm, uvl = new_bm()
    specs = [((2.6, 2.1, 2.1), Vector((0, 0, 0)), 4)] if variant == 0 else \
            [((1.7, 1.4, 1.6), Vector((0, 0, 0)), 4), ((0.9, 0.8, 0.8), Vector((1.15, 0.4, 0)), 3),
             ((0.7, 0.6, 0.6), Vector((-0.85, 0.75, 0)), 3)]
    for (sx, sy, sz), off, sub in specs:
        res = bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=0.5)
        seed = Vector(rng.uniform(-50, 50, 3))
        for v in res["verts"]:
            p = v.co.copy()
            d = noise.fractal(p * 1.6 + seed, 0.7, 2.2, 5)
            d2 = noise.noise(p * 5.0 + seed)
            v.co = p * (1 + 0.28 * d + 0.05 * d2)
            v.co.x *= sx; v.co.y *= sy; v.co.z *= sz
            if v.co.z < -0.1 * sz:
                v.co.z = -0.1 * sz + (v.co.z + 0.1 * sz) * 0.15
            v.co += off
    zmin = min(v.co.z for v in bm.verts)
    for v in bm.verts:
        v.co.z -= zmin
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for f in bm.faces:
        c = f.calc_center_median()
        n_ = f.normal
        moss = n_.z + 0.35 * noise.noise(c * 1.3 + Vector((7, 3, 1))) > 0.55
        f.material_index = 1 if moss else 0
        ax = max(range(3), key=lambda k: abs(n_[k]))
        for l in f.loops:
            co = l.vert.co
            uv = (co.y, co.z) if ax == 0 else ((co.x, co.z) if ax == 1 else (co.x, co.y))
            l[uvl].uv = (uv[0] / 1.2, uv[1] / 1.2)
    return [to_object(bm, "roccia", mats, smooth=True, sharp_deg=70)]


# ----------------------------------------------------------------------- extra
def build_mushrooms(mats):
    rng = np.random.default_rng(1300)
    bm, uvl = new_bm()
    for i in range(7):
        a = rng.uniform(0, 2 * np.pi); r = rng.uniform(0, 0.14)
        base = Vector((r * math.cos(a), r * math.sin(a), 0))
        h = rng.uniform(0.08, 0.26); rc = h * rng.uniform(0.28, 0.42)
        lean = Vector((rng.normal(0, 0.03), rng.normal(0, 0.03), 0))
        top = base + Vector((0, 0, h)) + lean
        tube(bm, uvl, [base, base.lerp(top, 0.5) + lean * 0.3, top], [rc * 0.22, rc * 0.17, rc * 0.15], 8, mat_index=1)
        prof = [(0.0, rc * 0.62), (rc * 0.45, rc * 0.55), (rc * 0.8, rc * 0.34), (rc, rc * 0.08), (rc * 0.92, 0.0), (rc * 0.2, rc * 0.04)]
        rings = []
        for rr_, zz in prof:
            if rr_ < 1e-6:
                rings.append([bm.verts.new(top + Vector((0, 0, zz)))])
            else:
                rings.append([bm.verts.new(top + Vector((rr_ * math.cos(2 * math.pi * j / 14), rr_ * math.sin(2 * math.pi * j / 14), zz))) for j in range(14)])
        for ri in range(len(rings) - 1):
            A, B = rings[ri], rings[ri + 1]
            for j in range(14):
                k = (j + 1) % 14
                q = [A[j % len(A)], A[k % len(A)], B[k], B[j]]
                uq = []
                for v in q:
                    if v not in uq:
                        uq.append(v)
                f = bm.faces.new(uq)
                f.material_index = 0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return [to_object(bm, "funghi", mats, smooth=True, sharp_deg=75)]


def build_log(mats):
    """tronco caduto lungo x, con muschio sul dorso e sezioni del legno alle estremita'"""
    rng = np.random.default_rng(1400)
    bm, uvl = new_bm()
    L, R = 3.6, 0.34
    pts = [Vector((-L / 2 + L * i / 12, 0.08 * math.sin(i / 12 * 3.0), R * 0.9 + 0.04 * math.sin(i / 12 * 2.0))) for i in range(13)]
    rad = [R * (1 - 0.18 * i / 12) for i in range(13)]
    rings = tube(bm, uvl, pts, rad, 14, v_len=2.2, mat_index=0)
    for ring in rings:
        for v in ring:
            v.co += (v.co - Vector((v.co.x, 0, 0))).normalized() * 0.0 + Vector(rng.normal(0, 0.012, 3))
    for ring, sgn in ((rings[0], -1), (rings[-1], 1)):
        c = sum((v.co for v in ring), Vector()) / len(ring)
        cv = bm.verts.new(c + Vector((sgn * 0.02, 0, 0)))
        for j in range(len(ring)):
            k = (j + 1) % len(ring)
            f = bm.faces.new((cv, ring[j], ring[k]) if sgn > 0 else (cv, ring[k], ring[j]))
            f.material_index = 2
            for l in f.loops:
                d = l.vert.co - c
                l[uvl].uv = (0.5 + d.y / (2 * R) * 0.9, 0.5 + d.z / (2 * R) * 0.9)
    # moncone di ramo
    tube(bm, uvl, [Vector((0.4, 0.15, 0.55)), Vector((0.55, 0.45, 0.85)), Vector((0.6, 0.6, 1.0))], [0.08, 0.05, 0.03], 7, mat_index=0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for f in bm.faces:
        if f.material_index == 0 and f.normal.z > 0.45 + 0.3 * noise.noise(f.calc_center_median() * 2.0):
            f.material_index = 1
    zmin = min(v.co.z for v in bm.verts)
    for v in bm.verts:
        v.co.z -= zmin
    return [to_object(bm, "tronco", mats, smooth=True, sharp_deg=60)]


# ======================================================================= costruzione ed esportazione
report = {}
built = {}


def export(asset, objs):
    tris = 0
    for ob in objs:
        ob.data.calc_loop_triangles()
        tris += len(ob.data.loop_triangles)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, asset + ".glb"), export_format="GLB", use_selection=True,
                              export_yup=True, export_apply=True, export_image_format="AUTO")
    dims = Vector((0, 0, 0))
    mins = Vector((1e9, 1e9, 1e9)); maxs = Vector((-1e9, -1e9, -1e9))
    for ob in objs:
        for v in ob.data.vertices:
            for k in range(3):
                mins[k] = min(mins[k], v.co[k]); maxs[k] = max(maxs[k], v.co[k])
    dims = maxs - mins
    report[asset] = dict(triangoli=tris, larghezza_x=round(dims.x, 2), profondita_y=round(dims.y, 2), altezza=round(dims.z, 2),
                         mesh=[ob.name for ob in objs], materiali=sorted({m.name for ob in objs for m in ob.data.materials}))
    # rinomina per liberare i nomi al prossimo elemento
    for ob in objs:
        ob.name = f"{asset}_{ob.name}"
        ob.data.name = ob.name
    for m in {m for ob in objs for m in ob.data.materials}:
        m.name = f"{asset}_{m.name}"
    built[asset] = objs
    print(asset, report[asset])


# alberi
for asset, p in TREES.items():
    ci, ni = bark_texture(p["kind"])
    atlas = leaf_atlas(p["kind"], p["seed"])
    bark = mat_tex("corteccia", ci, ni, rough=0.85)
    leaf = mat_tex("foglie", atlas, None, rough=0.6, alpha=True)
    export(asset, build_tree(asset, p, bark, leaf))

# felci
fern_img = fern_atlas()
for v, asset in enumerate(("felce_a", "felce_b")):
    export(asset, build_fern(asset, v, mat_tex("fronde", fern_img, None, rough=0.6, alpha=True)))

# fiori
FLOWER_COL = [("cream", "gold"), ("rose", "rose"), ("warmwhite", "gold")]
for v, asset in enumerate(("fiori_a", "fiori_b", "fiori_c")):
    pc, cc = FLOWER_COL[v]
    mats = [mat_col("petali", col(pc), 0.45), mat_col("centri", col(cc), 0.5), mat_col("steli", np.array([0.28, 0.48, 0.22]), 0.6),
            mat_col("foglie", col("mid"), 0.6)]
    export(asset, build_flowers(asset, v, mats))

# erba e muschio
grass_img = grass_atlas()
for v, asset in enumerate(("erba_a", "erba_b")):
    export(asset, build_grass(asset, v, mat_tex("erba", grass_img, None, rough=0.65, alpha=True)))

# rocce
rock, rockn, moss, mossn, wood = stone_textures()
for v, asset in enumerate(("roccia_a", "roccia_b")):
    export(asset, build_rock(asset, v, [mat_tex("roccia", rock, rockn, rough=0.85), mat_tex("muschio", moss, mossn, rough=0.95)]))

# extra
export("funghi_luminosi", build_mushrooms([mat_col("cappelli", col("cream"), 0.4, emission=col("rose"), strength=1.5),
                                           mat_col("gambi", np.array([0.93, 0.9, 0.84]), 0.5, emission=col("cream"), strength=0.4)]))
fbark, fbarkn = bpy.data.images["corteccia_faggio"], bpy.data.images["corteccia_faggio_normal"]
export("tronco_caduto", build_log([mat_tex("corteccia", fbark, fbarkn, rough=0.85), mat_tex("muschio", moss, mossn, rough=0.95),
                                   mat_tex("legno", wood, None, rough=0.8)]))

json.dump(report, open(os.path.join(OUT, "report.json"), "w"), indent=1, ensure_ascii=False)

# ======================================================================= render di controllo
world = bpy.data.worlds.new("Cielo"); scene.world = world; world.use_nodes = True
wn = world.node_tree
tc = wn.nodes.new("ShaderNodeTexCoord"); sep = wn.nodes.new("ShaderNodeSeparateXYZ")
wn.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
ramp = wn.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = 0.45; ramp.color_ramp.elements[0].color = (0.62, 0.72, 0.6, 1)
ramp.color_ramp.elements[1].position = 1.0; ramp.color_ramp.elements[1].color = (0.42, 0.62, 0.66, 1)
e = ramp.color_ramp.elements.new(0.52); e.color = (0.93, 0.9, 0.78, 1)
mz = wn.nodes.new("ShaderNodeMath"); mz.operation = "MULTIPLY_ADD"; mz.inputs[1].default_value = 0.5; mz.inputs[2].default_value = 0.5
wn.links.new(sep.outputs["Z"], mz.inputs[0]); wn.links.new(mz.outputs[0], ramp.inputs["Fac"])
bg = wn.nodes["Background"]; bg.inputs["Strength"].default_value = 1.1
wn.links.new(ramp.outputs["Color"], bg.inputs["Color"])
sun_d = bpy.data.lights.new("Sole", "SUN"); sun_d.energy = 3.2; sun_d.angle = math.radians(6); sun_d.color = (1.0, 0.93, 0.82)
sun = bpy.data.objects.new("Sole", sun_d); scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(48), math.radians(12), math.radians(-35))

ground_mat = mat_tex("terreno_render", moss, None, rough=1.0)
gbm, guvl = new_bm()
gv = [gbm.verts.new(v) for v in ((-200, -200, 0), (200, -200, 0), (200, 200, 0), (-200, 200, 0))]
gf = gbm.faces.new(gv)
for l in gf.loops:
    l[guvl].uv = (l.vert.co.x / 3, l.vert.co.y / 3)
ground = to_object(gbm, "terreno_render", ground_mat, smooth=False)

cam_d = bpy.data.cameras.new("Cam"); cam_d.clip_start = 0.01; cam_d.clip_end = 2000
cam = bpy.data.objects.new("Camera", cam_d); scene.collection.objects.link(cam); scene.camera = cam
r = scene.render
r.engine = "CYCLES"; r.film_transparent = False
r.image_settings.file_format = "PNG"
scene.cycles.samples = SAMPLES; scene.cycles.use_denoising = True
scene.cycles.transparent_max_bounces = 128   # molti piani alpha sovrapposti (erba, felci, chiome)
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
except Exception as ex:
    print("GPU non disponibile:", ex)
scene.view_settings.view_transform = "AgX"


def place(asset, loc, rot=0.0):
    for ob in built[asset]:
        ob.location = loc; ob.rotation_euler = (0, 0, rot)


def show_only(assets):
    keep = {ob.name for a in assets for ob in built[a]}
    for objs in built.values():
        for ob in objs:
            ob.hide_render = ob.name not in keep


def shoot(path, loc, target, lens=35, res=None):
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cam_d.lens = lens
    r.resolution_x, r.resolution_y = res or (int(RES * 1.5), RES)
    r.filepath = path
    bpy.ops.render.render(write_still=True)


bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "natura.blend"))
if DO_RENDER:
    for i, a in enumerate(("albero_a", "albero_b", "albero_c")):
        place(a, ((i - 1) * 15.0, 0, 0))
    show_only(["albero_a", "albero_b", "albero_c"])
    shoot(os.path.join(RENDERS, "natura_alberi.png"), (0, -52, 8), (0, 0, 9), lens=32)
    for i, a in enumerate(("felce_a", "felce_b")):
        place(a, ((i - 0.5) * 2.0, 0, 0))
    show_only(["felce_a", "felce_b"])
    shoot(os.path.join(RENDERS, "natura_felci.png"), (0, -4.2, 1.6), (0, 0, 0.45), lens=40)
    for i, a in enumerate(("fiori_a", "fiori_b", "fiori_c")):
        place(a, ((i - 1) * 0.55, 0, 0))
    show_only(["fiori_a", "fiori_b", "fiori_c"])
    shoot(os.path.join(RENDERS, "natura_fiori.png"), (0, -1.5, 0.55), (0, 0, 0.18), lens=45)
    for i, a in enumerate(("erba_a", "erba_b")):
        place(a, ((i - 0.5) * 0.9, 0, 0))
    show_only(["erba_a", "erba_b"])
    shoot(os.path.join(RENDERS, "natura_erba.png"), (0, -1.6, 0.7), (0, 0, 0.15), lens=45)
    place("roccia_a", (-1.8, 0, 0)); place("roccia_b", (1.8, 0, 0))
    show_only(["roccia_a", "roccia_b"])
    shoot(os.path.join(RENDERS, "natura_rocce.png"), (0, -7.5, 2.6), (0, 0, 0.6), lens=40)
    place("funghi_luminosi", (-1.2, 0, 0)); place("tronco_caduto", (1.2, 0.3, 0), 0.3)
    show_only(["funghi_luminosi", "tronco_caduto"])
    shoot(os.path.join(RENDERS, "natura_extra.png"), (0, -5.0, 1.8), (0, 0, 0.35), lens=40)
    # viale: due file di alberi ai lati di un sentiero, sottobosco ai margini (istanze collegate)
    show_only([])
    vcoll = bpy.data.collections.new("Viale"); scene.collection.children.link(vcoll)
    rng = np.random.default_rng(7)
    seq = ["albero_a", "albero_b", "albero_c"]
    def inst(asset, loc, rot):
        for ob in built[asset]:
            o2 = ob.copy(); o2.hide_render = False
            o2.location = loc; o2.rotation_euler = (0, 0, rot)
            vcoll.objects.link(o2)
    for k in range(7):
        y = 6 + k * 9.0
        for side in (-1, 1):
            inst(seq[(k + (side > 0)) % 3], (side * rng.uniform(5.0, 6.2), y + rng.uniform(-1.5, 1.5), 0), rng.uniform(0, 6.28))
            inst("felce_a" if k % 2 else "felce_b", (side * rng.uniform(3.2, 4.2), y + rng.uniform(-3, 3), 0), rng.uniform(0, 6.28))
            inst(("fiori_a", "fiori_b", "fiori_c")[k % 3], (side * rng.uniform(2.2, 2.9), y + rng.uniform(-3, 3), 0), rng.uniform(0, 6.28))
            inst("erba_a" if k % 2 == 0 else "erba_b", (side * rng.uniform(2.0, 3.5), y + rng.uniform(-4, 4), 0), rng.uniform(0, 6.28))
            if k % 3 == 1:
                inst("roccia_a" if side < 0 else "roccia_b", (side * rng.uniform(7.0, 8.5), y + 2, 0), rng.uniform(0, 6.28))
        if k == 2:
            inst("funghi_luminosi", (2.6, y + 1.0, 0), 0)
            inst("tronco_caduto", (-4.0, y - 2.0, 0), 1.2)
    shoot(os.path.join(RENDERS, "natura_viale.png"), (0.3, -2.0, 1.7), (0, 30, 4.5), lens=24)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "natura.blend"))
print("FATTO natura")
