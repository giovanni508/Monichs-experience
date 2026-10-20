"""Bocca apribile: taglio fra le labbra, risvolto interno, cavita' scura e arcate dentali (spazio canonico).

Strato 'mouth' sui vertici: 1 = labbro superiore (bordo), 2 = labbro inferiore (bordo), 3 = risvolto interno sup.,
4 = risvolto interno inf., 5 = denti sopra, 6 = denti sotto, 7 = cavita'.
"""
import math

import bmesh
import numpy as np
from mathutils import Vector

import head_fit as H
from parts import to_canon

SEAM_Y = -69.0


def cut_mouth(bm, mouth_x=25.0):
    ml = bm.verts.layers.int.get("mouth") or bm.verts.layers.int.new("mouth")
    region = [f for f in bm.faces if all(abs(to_canon(v.co)[0]) < mouth_x + 6 and -82 < to_canon(v.co)[1] < -56
                                         and to_canon(v.co)[2] > -25 for v in f.verts)]
    geom = list({e for f in region for e in f.edges}) + region + list({v for f in region for v in f.verts})
    bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-7, plane_co=H.c2b((0, SEAM_Y, 0)), plane_no=Vector((0, 0, 1)))
    z0 = SEAM_Y / 1000.0
    seam = [e for e in bm.edges if all(abs(v.co.z - z0) < 2e-6 for v in e.verts)
            and all(abs(to_canon(v.co)[0]) < mouth_x - 0.5 and to_canon(v.co)[2] > -25 for v in e.verts)]
    bmesh.ops.split_edges(bm, edges=seam)
    bm.verts.ensure_lookup_table()
    rim_up, rim_lo = [], []
    for v in bm.verts:
        if abs(v.co.z - z0) < 2e-6 and abs(to_canon(v.co)[0]) < mouth_x - 0.5 and to_canon(v.co)[2] > -25 and v.is_boundary:
            above = sum(f.calc_center_median().z > z0 for f in v.link_faces)
            if above == len(v.link_faces):
                v[ml] = 1; rim_up.append(v)
            elif above == 0:
                v[ml] = 2; rim_lo.append(v)
    # risvolto interno delle labbra: dal bordo verso l'interno e indietro
    for rim, flag, dy in ((rim_up, 3, 0.6), (rim_lo, 4, -0.6)):
        edges = list({e for v in rim for e in v.link_edges if e.is_boundary and all(w in rim for w in e.verts)})
        if not edges:
            continue
        ret = bmesh.ops.extrude_edge_only(bm, edges=edges)
        for g in ret["geom"]:
            if isinstance(g, bmesh.types.BMVert):
                x, y, z = to_canon(g.co)
                fade = 1 - (abs(x) / mouth_x) ** 4
                g.co = H.c2b((x * (1 - 0.04 * fade), y + dy * fade, z - 3.0 * fade))
                g[ml] = flag
    return ml


def _arc_band(bm, ml, flag, y_top, y_bot, z_front, half_w=19.0, depth_k=0.020, n=20, thick=1.6):
    """arcata dentale: fascia curva (parabola vista dall'alto) con un minimo spessore"""
    rows = []
    for yy, dz in ((y_top, 0.0), (y_bot, 0.0), (y_bot, -thick), (y_top, -thick)):
        row = []
        for i in range(n + 1):
            x = -half_w + 2 * half_w * i / n
            z = z_front - depth_k * x * x + dz
            row.append(bm.verts.new(H.c2b((x, yy, z))))
            row[-1][ml] = flag
        rows.append(row)
    for a in range(4):
        A, B = rows[a], rows[(a + 1) % 4]
        for i in range(n):
            bm.faces.new((A[i], A[i + 1], B[i + 1], B[i]))
    # spigoli dei denti: piccole tacche verticali (bordo inferiore ondulato per i superiori)
    return rows


def add_mouth_interior(bm, ml, mouth_x=25.0):
    # cavita': ellissoide schiacciato dietro le labbra
    res = bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=1.0)
    for v in res["verts"]:
        sx, sy, sz = v.co.x, v.co.z, -v.co.y
        v.co = H.c2b((sx * (mouth_x - 1), SEAM_Y - 2 + sy * 14.0, -18.0 + sz * 16.0))
        v[ml] = 7
    _arc_band(bm, ml, 5, SEAM_Y + 9.5, SEAM_Y - 0.2, 7.0)       # denti superiori
    _arc_band(bm, ml, 6, SEAM_Y - 0.6, SEAM_Y - 8.5, 5.6, half_w=17.0)   # denti inferiori
    bmesh.ops.recalc_face_normals(bm, faces=[f for f in bm.faces if all(v[ml] == 7 for v in f.verts)])
