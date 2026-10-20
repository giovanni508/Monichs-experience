"""Camicia aperta al collo (Filippo): mappa delle pieghe, scollo a V, colletto, catenina con croce."""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from body import ring_loft, superellipse, to_mesh


def shirt_normal(size=512, seed=0):
    """mappa normale: trama del cotone + pieghe morbide"""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size] / size
    h = np.zeros((size, size))
    for k in range(10):
        a = rng.uniform(-0.6, 0.6) + math.pi / 2 * rng.integers(0, 2) * 0.3
        f = rng.integers(2, 6)
        h += np.sin((xx * math.cos(a) + yy * math.sin(a)) * f * 2 * math.pi + rng.uniform(0, 6.28)) / f
    h = h / np.abs(h).max() * 0.6
    h += 0.08 * (np.sin(xx * size * 0.9) * np.sin(yy * size * 0.9))
    gy, gx = np.gradient(h)
    k = 3.0
    nx, ny, nz = -gx * k * size / 64, gy * k * size / 64, np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l * 0.5 + 0.5, ny / l * 0.5 + 0.5, nz / l * 0.5 + 0.5], -1)


def assign_v_neck(ob, mat_index, v_bottom=0.475, top=0.60, half_top=0.058):
    """facce del davanti dentro lo scollo a V -> materiale pelle"""
    for p in ob.data.polygons:
        c = p.center
        if c.z < v_bottom or c.z > top + 0.02:
            continue
        zt = (c.z - v_bottom) / (top - v_bottom)
        if abs(c.x) < half_top * min(zt, 1.0) ** 0.9 and c.y < -0.06 - 0.02 * (1 - zt):
            p.material_index = mat_index


def build_shirt_collar(name, neck_c, z_base, rx, ry, h=0.036, gap_deg=34, n=44):
    """colletto aperto: fascia attorno a nuca e lati che si apre e si sdraia verso le punte davanti"""
    bm = bmesh.new()
    g = math.radians(gap_deg)
    phis = np.linspace(g, 2 * math.pi - g, n)
    rows = []
    for k_ in range(3):
        row = []
        for ph in phis:
            d = abs(ph - math.pi) / (math.pi - g)            # 0 dietro, 1 alle punte davanti
            out = Vector((math.sin(ph), -math.cos(ph), 0)).normalized()
            base = Vector((neck_c.x + rx * math.sin(ph), neck_c.y - ry * math.cos(ph), z_base + 0.010 * (1 - d)))
            if k_ == 0:
                p = base
            elif k_ == 1:
                p = base + Vector((0, 0, h * (1 - 0.55 * d ** 2) * 0.55)) + out * (0.004 + 0.012 * d ** 2)
            else:
                p = base + Vector((0, 0, h * (1 - 0.75 * d ** 2))) + out * (0.010 + 0.040 * d ** 2) \
                    - Vector((0, 0, 0.022 * d ** 3))
            row.append(bm.verts.new(p))
        rows.append(row)
    for A, B in zip(rows[:-1], rows[1:]):
        for j in range(n - 1):
            bm.faces.new((A[j], A[j + 1], B[j + 1], B[j]))
    return to_mesh(bm, name)


def build_chain(name, cross_name, body_objs, neck_c, rx, ry, z_neck, z_bottom, n=90):
    """catenina: giro attorno al collo, poggiata sul petto fino allo scollo, con croce"""
    bmb = bmesh.new()
    for o in body_objs:
        tmp = o.data.copy(); tmp.transform(o.matrix_world); bmb.from_mesh(tmp); bpy.data.meshes.remove(tmp)
    bvh = BVHTree.FromBMesh(bmb); bmb.free()
    pts = []
    for i in range(n + 1):
        t = -1 + 2 * i / n                                    # -1 / +1 dietro, 0 davanti
        ph = math.pi * (1 - abs(t))
        s = 1 if t >= 0 else -1
        fr = (1 + math.cos(ph)) / 2                           # 1 davanti, 0 dietro
        z = z_neck - (z_neck - z_bottom) * fr ** 1.6
        p = Vector((neck_c.x + s * rx * math.sin(ph) * (1 - 0.5 * fr), neck_c.y - ry * math.cos(ph), z))
        if fr > 0.4:                                          # davanti: appoggia su pelle e camicia
            hit = bvh.ray_cast(p + Vector((0, -0.2, 0)), Vector((0, 1, 0)), 0.4)
            if hit[0] is not None:
                p = hit[0] + hit[1].normalized() * 0.0012
        pts.append(p)
    bm = bmesh.new()
    ring_loft(bm, pts, [superellipse(0.0006, 0.0006, 0.0006, 2.0)] * len(pts), 6, cap0=False, cap1=False)
    chain = to_mesh(bm, name)
    low = pts[n // 2]
    hit = bvh.ray_cast(low + Vector((0, -0.2, -0.013)), Vector((0, 1, 0)), 0.4)
    if hit[0] is not None:
        c = hit[0] + hit[1].normalized() * 0.002; nrm = hit[1].normalized()
    else:
        c = low + Vector((0, 0, -0.013)); nrm = Vector((0, -1, 0))
    up = Vector((0, 0, 1)); up = (up - nrm * up.dot(nrm)).normalized(); rt = up.cross(nrm).normalized()
    bmc = bmesh.new()
    for (w_, h_, oz) in ((0.0035, 0.020, -0.002), (0.012, 0.0035, 0.003)):
        ctr = c + up * oz
        M = Matrix(((rt.x * w_, up.x * h_, nrm.x * 0.0015, ctr.x), (rt.y * w_, up.y * h_, nrm.y * 0.0015, ctr.y),
                    (rt.z * w_, up.z * h_, nrm.z * 0.0015, ctr.z), (0, 0, 0, 1)))
        bmesh.ops.create_cube(bmc, size=1.0, matrix=M)
    cross = to_mesh(bmc, cross_name, smooth=False)
    return chain, cross


def paint_shirt(pos, shirt_srgb, skin_srgb, v_bottom=0.462, top=0.60, half_top=0.060):
    """texture del busto della camicia da mappa delle posizioni: scollo a V (pelle), bordi, abbottonatura"""
    x, y, z = pos[..., 0], pos[..., 1], pos[..., 2]
    zt = np.clip((z - v_bottom) / (top - v_bottom), 0, 1)
    half = half_top * zt ** 0.9
    front = y < -0.03
    dx = np.abs(x) - half                      # <0 dentro lo scollo
    inside = front & (z > v_bottom) & (dx < 0)
    col = np.broadcast_to(np.array(shirt_srgb, float), pos.shape).copy()
    # bordo dei lembi: ombra sottile e risvolto piu' chiaro
    edge = front & (z > v_bottom - 0.004) & (dx >= 0) & (dx < 0.004)
    col[edge] *= 0.86
    # abbottonatura sotto lo scollo
    plk = front & (z < v_bottom) & (np.abs(x) < 0.016)
    col[plk & (np.abs(np.abs(x) - 0.016) < 0.0012)] *= 0.85
    for zb in np.arange(v_bottom - 0.03, 0.0, -0.09):
        btn = front & (np.hypot(x, (z - zb)) < 0.0055)
        col[btn] = np.array([0.93, 0.92, 0.90])
        col[front & (np.abs(np.hypot(x, z - zb) - 0.0055) < 0.0008)] *= 0.8
    # piega sotto il petto e ai fianchi: leggere ombre
    col *= (1 - 0.06 * np.exp(-((z - 0.36) / 0.03) ** 2) * front)[..., None]
    sk = np.array(skin_srgb, float)
    shade = 0.85 + 0.15 * np.clip((z - v_bottom) / 0.12, 0, 1)        # in fondo allo scollo piu' in ombra
    col[inside] = sk * shade[inside][:, None]
    paint_shirt.v_mask = inside.astype(float)
    return col
