import numpy as np, json, math
e = json.load(open("C:/Users/UTENTE/AppData/Local/Temp/claude/C--Users-UTENTE-Desktop-MNC-GAME/f6e2a322-e58c-420b-8033-60d0bd307ab5/scratchpad/vi4_ellipse.json"))
W, H = 4400, 4000; OX, OY = e["OX"], e["OY"]
im = np.fromfile("C:/Users/UTENTE/AppData/Local/Temp/claude/C--Users-UTENTE-Desktop-MNC-GAME/f6e2a322-e58c-420b-8033-60d0bd307ab5/scratchpad/vi4.rgb", dtype=np.uint8).reshape(H, W, 3).astype(np.float32) / 255
c = np.array([e["x0"], e["y0"]]); ax = np.array(e["axes"]); ev = np.array(e["evec"])
def norm_angle(px, py):
    q = (np.array([px - OX, py - OY]) - c) @ ev / ax
    return math.degrees(math.atan2(q[1], q[0])), np.linalg.norm(q)
# punti di riferimento (foto piena): MONICHS (ore 12), 10 ATMOSPHERES (ore 9 in vista fondello), 316L (ore 3)
marks = {"MONICHS": (6040, 6320, 90), "10ATM": (3760, 5720, 180 - 30), "316L": (5000, 8360, -40)}
for k, (px, py, va) in marks.items():
    a, r = norm_angle(px, py)
    print(k, "angolo normalizzato", round(a, 1), "raggio rel", round(r, 2), "angolo vista atteso", va)
marks2 = {"MONICHS": ((1205, 310), 90), "10ATM": ((645, 180), 180), "SWISS": ((430, 610), 270), "316L": ((950, 790), 0)}
ks = []
for k, ((cxp, cyp), va) in marks2.items():
    a, r = norm_angle(1200 + cxp * 4, 5000 + cyp * 4)
    kk = (a + va + 180) % 360 - 180
    ks.append(kk)
    print(k, round(a, 1), "r", round(r, 2), "offset", round(kk, 1))
ks = np.array(ks)
off = math.degrees(math.atan2(np.sin(np.radians(ks)).mean(), np.cos(np.radians(ks)).mean()))
print("offset medio", round(off, 1))
# texture del movimento in coordinate mondo (x verso ore 3, y verso ore 12), vista dal fondello: u = -x
T = 1536; HALF = 12.4
lin = (np.arange(T) + 0.5) / T * 2 * HALF - HALF
Xw, Yw = np.meshgrid(lin, lin[::-1])
u, v = -Xw, Yw
th_v = np.arctan2(v, u); rr = np.hypot(u, v) / 14.94
th_n = -th_v + np.radians(off)
q = np.stack([np.cos(th_n) * rr, np.sin(th_n) * rr], -1) * ax
p = q @ ev.T + c
px, py = p[..., 0], p[..., 1]
x0 = np.clip(np.floor(px).astype(int), 0, W - 2); y0 = np.clip(np.floor(py).astype(int), 0, H - 2)
fx = (px - x0)[..., None]; fy = (py - y0)[..., None]
col = (im[y0, x0] * (1 - fx) + im[y0, x0 + 1] * fx) * (1 - fy) + (im[y0 + 1, x0] * (1 - fx) + im[y0 + 1, x0 + 1] * fx) * fy
(np.clip(col, 0, 1) * 255).astype(np.uint8).tofile("C:/Users/UTENTE/AppData/Local/Temp/claude/C--Users-UTENTE-Desktop-MNC-GAME/f6e2a322-e58c-420b-8033-60d0bd307ab5/scratchpad/movement.rgb")
