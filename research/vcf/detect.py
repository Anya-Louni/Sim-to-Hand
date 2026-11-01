"""Classical camera check with OpenCV: find each colored cube, fit its 3D pose, test the goal geometry.

No learning. Steps:
  1. HSV color masks per cube color, opened to drop the thin zone outlines (zone fills are too dark to pass).
  2. For each cube and each resting level (table, one cube up, two up), search x, y and yaw so the projected
     cube silhouette best overlaps the mask (IoU). Pixels of other cubes and the white robot are ignored,
     since they can hide part of the cube.
  3. Goals: on(a, b) needs a one level above b and within 3 cm sideways. in_zone needs the cube on the table
     inside the zone square. A cube the camera cannot find fails its goals.

The camera matrices come from the renderer (three.js, column-major), so projection is exact.
`--serve` reads one JSON request per line on stdin and writes one JSON answer per line.
"""
from __future__ import annotations

import base64
import json
import sys

import cv2
import numpy as np

HALF = 0.025
LEVELS = [HALF, 3 * HALF, 5 * HALF]
# OpenCV hue is 0..180.
HUES = {"red": [(0, 8), (165, 180)], "yellow": [(18, 35)], "green": [(40, 85)], "blue": [(95, 125)]}
MIN_AREA = 120


class Camera:
    def __init__(self, cam: dict):
        V = np.array(cam["view"], float).reshape(4, 4).T
        P = np.array(cam["proj"], float).reshape(4, 4).T
        self.M = P @ V
        self.W, self.H = cam["width"], cam["height"]
        self.Minv = np.linalg.inv(self.M)
        self.eye = np.linalg.inv(V)[:3, 3]

    def project(self, pts: np.ndarray) -> np.ndarray:
        h = np.c_[pts, np.ones(len(pts))] @ self.M.T
        ndc = h[:, :3] / h[:, 3:4]
        return np.c_[(ndc[:, 0] + 1) / 2 * self.W, (1 - ndc[:, 1]) / 2 * self.H]

    def ray_to_plane(self, u: float, v: float, z: float) -> np.ndarray:
        ndc = np.array([2 * u / self.W - 1, 1 - 2 * v / self.H])
        a = self.Minv @ np.array([*ndc, -1.0, 1.0])
        b = self.Minv @ np.array([*ndc, 1.0, 1.0])
        a, b = a[:3] / a[3], b[:3] / b[3]
        t = (z - a[2]) / (b[2] - a[2])
        return a + t * (b - a)


def decode(image_b64: str) -> np.ndarray:
    return cv2.imdecode(np.frombuffer(base64.b64decode(image_b64), np.uint8), cv2.IMREAD_COLOR)


def masks(img: np.ndarray) -> tuple[dict[str, np.ndarray], np.ndarray]:
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    bright = (s > 70) & (v > 110)
    k = np.ones((3, 3), np.uint8)
    out = {}
    for name, ranges in HUES.items():
        m = np.zeros(h.shape, bool)
        for lo, hi in ranges:
            m |= (h >= lo) & (h <= hi)
        m = cv2.morphologyEx((m & bright).astype(np.uint8), cv2.MORPH_OPEN, k, iterations=2)
        out[name] = m
    robot = ((s < 45) & (v > 120)).astype(np.uint8)
    return out, robot


def largest(mask: np.ndarray) -> np.ndarray | None:
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if n <= 1:
        return None
    i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    if stats[i, cv2.CC_STAT_AREA] < MIN_AREA:
        return None
    return (lab == i).astype(np.uint8)


def corners(x: float, y: float, z: float, yaw: float) -> np.ndarray:
    c, s = np.cos(yaw), np.sin(yaw)
    pts = []
    for dx in (-HALF, HALF):
        for dy in (-HALF, HALF):
            for dz in (-HALF, HALF):
                pts.append([x + c * dx - s * dy, y + s * dx + c * dy, z + dz])
    return np.array(pts)


class Fitter:
    """IoU between a projected cube and a mask, inside a crop around the mask, ignoring occluder pixels."""

    def __init__(self, cam: Camera, mask: np.ndarray, occluders: np.ndarray):
        ys, xs = np.nonzero(mask)
        pad = 45
        self.x0, self.y0 = max(0, xs.min() - pad), max(0, ys.min() - pad)
        x1, y1 = min(cam.W, xs.max() + pad), min(cam.H, ys.max() + pad)
        self.mask = mask[self.y0 : y1, self.x0 : x1].astype(bool)
        self.valid = ~occluders[self.y0 : y1, self.x0 : x1].astype(bool) | self.mask
        self.cam = cam
        self.canvas = np.zeros(self.mask.shape, np.uint8)
        self.centroid = (xs.mean(), ys.mean())

    def score(self, x: float, y: float, z: float, yaw: float) -> float:
        p = self.cam.project(corners(x, y, z, yaw)) - [self.x0, self.y0]
        hull = cv2.convexHull(p.astype(np.float32)).astype(np.int32)
        self.canvas[:] = 0
        cv2.fillConvexPoly(self.canvas, hull, 1)
        pred = self.canvas.astype(bool) & self.valid
        inter = np.count_nonzero(pred & self.mask)
        union = np.count_nonzero(pred | self.mask)
        return inter / union if union else 0.0

    def fit(self, z: float, x0: float | None = None, y0: float | None = None, yaw0: float | None = None, xy_span: float = 0.012):
        if x0 is None:
            x0, y0, _ = self.cam.ray_to_plane(*self.centroid, z)
        best = (-1.0, x0, y0, 0.0)
        yaws = np.deg2rad(np.arange(0, 90, 6)) if yaw0 is None else [yaw0 + np.deg2rad(d) for d in range(-9, 10, 3)]
        for yw in yaws:
            sc = self.score(x0, y0, z, yw)
            if sc > best[0]:
                best = (sc, x0, y0, yw)
        for step, span in ((0.003, xy_span), (0.001, 0.003)):
            _, bx, by, byaw = best
            for dx in np.arange(-span, span + 1e-9, step):
                for dy in np.arange(-span, span + 1e-9, step):
                    sc = self.score(bx + dx, by + dy, z, byaw)
                    if sc > best[0]:
                        best = (sc, bx + dx, by + dy, byaw)
            _, bx, by, byaw = best
            for d in (-3, -2, -1, 1, 2, 3):
                yw = byaw + np.deg2rad(d)
                sc = self.score(bx, by, z, yw)
                if sc > best[0]:
                    best = (sc, bx, by, yw)
        return best


def find_cubes(img: np.ndarray, cam: Camera, names: list[str]) -> dict:
    ms, robot = masks(img)
    blobs = {n: largest(ms[n]) for n in names}
    out = {}
    for n in names:
        m = blobs[n]
        if m is None:
            out[n] = None
            continue
        occ = robot.copy()
        for o in names:
            if o != n and blobs[o] is not None:
                occ |= blobs[o]
        f = Fitter(cam, m, occ)
        out[n] = [f.fit(z) for z in LEVELS]
    return resolve(out, cam, blobs, robot)


def render_labels(cam: Camera, poses: dict, shape) -> np.ndarray:
    """Label image of all cubes drawn far to near, so nearer cubes hide farther ones. 0 is background."""
    lab = np.zeros(shape, np.uint8)
    order = sorted(poses.items(), key=lambda kv: -np.linalg.norm(np.array(kv[1][:3]) - cam.eye))
    for n, (x, y, z, yaw, idx) in order:
        hull = cv2.convexHull(cam.project(corners(x, y, z, yaw)).astype(np.float32)).astype(np.int32)
        cv2.fillConvexPoly(lab, hull, idx)
    return lab


def resolve(fits: dict, cam: Camera, blobs: dict, robot: np.ndarray) -> dict:
    """Choose a level for every visible cube at once. Each physically possible combination (table cubes do not
    overlap, every raised cube has a cube one level below it) is drawn as a whole scene with occlusion and
    compared with the observed color masks; the best match wins."""
    from itertools import product

    seen = [n for n, f in fits.items() if f is not None]
    idx = {n: i + 1 for i, n in enumerate(seen)}
    obs = np.zeros(robot.shape, np.uint8)
    for n in seen:
        obs[blobs[n].astype(bool)] = idx[n]
    valid = ~robot.astype(bool) | (obs > 0)
    ys, xs = np.nonzero(obs)
    pad = 60
    y0, y1 = max(0, ys.min() - pad), min(obs.shape[0], ys.max() + pad)
    x0, x1 = max(0, xs.min() - pad), min(obs.shape[1], xs.max() + pad)
    obs_c, valid_c = obs[y0:y1, x0:x1], valid[y0:y1, x0:x1]

    best, best_score = None, -1.0
    for levels in product(range(len(LEVELS)), repeat=len(seen)):
        pose = {n: (k, *fits[n][k]) for n, k in zip(seen, levels)}
        ok = True
        for n, (k, s, x, y, yaw) in pose.items():
            others = [(k2, x2, y2) for m, (k2, s2, x2, y2, yw2) in pose.items() if m != n]
            if k == 0 and any(k2 == 0 and np.hypot(x - x2, y - y2) < 0.045 for k2, x2, y2 in others):
                ok = False
            if k > 0 and not any(k2 == k - 1 and np.hypot(x - x2, y - y2) < 0.035 for k2, x2, y2 in others):
                ok = False
        if not ok:
            continue
        lab = render_labels(cam, {n: (x, y, LEVELS[k], yaw, idx[n]) for n, (k, s, x, y, yaw) in pose.items()}, obs.shape)[y0:y1, x0:x1]
        ious = []
        for n in seen:
            pr, ob = (lab == idx[n]) & valid_c, obs_c == idx[n]
            u = np.count_nonzero(pr | ob)
            ious.append(np.count_nonzero(pr & ob) / u if u else 0.0)
        score = float(np.mean(ious))
        if score > best_score:
            best, best_score = pose, score
    if best is None:  # nothing consistent: fall back to each cube's own best level
        best = {n: max(((k, *f) for k, f in enumerate(fits[n])), key=lambda t: t[1]) for n in seen}
    out: dict = {n: None for n in fits}
    for n, (k, s, x, y, yaw) in best.items():
        out[n] = {"level": k, "x": float(x), "y": float(y), "z": LEVELS[k], "yaw": float(yaw), "iou": round(float(s), 3), "scene": round(best_score, 3)}
    return out


def check_goals(req: dict) -> dict:
    img = decode(req["image"])
    cam = Camera(req["cam"])
    cubes = find_cubes(img, cam, req["cubes"])
    zones = {z["name"]: z for z in req.get("zones", [])}
    fails = []
    for g in req["goal"]:
        a = cubes.get(g["a"])
        if a is None:
            fails.append(f"camera cannot find the {g['a']} cube")
            continue
        if g["pred"] == "on":
            b = cubes.get(g["b"])
            if b is None:
                fails.append(f"camera cannot find the {g['b']} cube")
                continue
            d = np.hypot(a["x"] - b["x"], a["y"] - b["y"])
            if a["level"] != b["level"] + 1 or d > 0.03:
                fails.append(f"camera sees {g['a']} at level {a['level']}, {g['b']} at level {b['level']}, {d * 100:.1f} cm apart")
        else:
            z = zones[g["zone"]]
            if a["level"] != 0 or abs(a["x"] - z["x"]) > z["half"] or abs(a["y"] - z["y"]) > z["half"]:
                fails.append(f"camera sees {g['a']} outside {g['zone']}")
    return {"ok": not fails, "detail": "; ".join(fails) or "camera sees every goal met", "cubes": cubes}


def contact_gap(img: np.ndarray, cam: Camera, a: str, b: str, names: list[str]) -> dict:
    """For a cube held over another: fit the lower cube on the table, then the held cube's height above it.

    Returns the estimated gap in mm (negative values mean the fit put it slightly inside)."""
    ms, robot = masks(img)
    blobs = {n: largest(ms[n]) for n in names}
    if blobs[a] is None or blobs[b] is None:
        return {"gapMm": None, "detail": "cube not found"}
    occ_b = robot | blobs[a]
    fb = Fitter(cam, blobs[b], occ_b)
    sb, bx, by, byaw = fb.fit(HALF)
    # The held cube is above the lower one, so the lower one never hides it: only the robot counts as an occluder.
    fa = Fitter(cam, blobs[a], robot)
    best = (-1.0, 0.0)
    xy = (bx, by, byaw)
    for g in np.arange(-3.0, 10.01, 0.5):
        z = 3 * HALF + g / 1000
        s, x, y, yw = fa.fit(z, xy[0], xy[1], xy[2], xy_span=0.006)
        if s > best[0]:
            best = (s, g)
    return {"gapMm": float(best[1]), "iou": round(float(best[0]), 3)}


def serve():
    for line in sys.stdin:
        try:
            out = check_goals(json.loads(line))
            out.pop("cubes", None)
        except Exception as e:  # keep the run going; an unreadable image is a failed check
            out = {"ok": False, "detail": f"camera check error: {e}"}
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    if "--serve" in sys.argv:
        serve()
