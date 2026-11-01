"""Seeded domain randomization: lighting, table tint, object colors, camera poses, distractors."""
from __future__ import annotations

import mujoco
import numpy as np

from .model import MAX_DISTRACTORS

VIEWS = ("front", "left", "right")
OBJECT_GEOMS = ("obj", "base", "cap", "housing", "floor", "wall_n", "wall_s", "wall_e", "wall_w", "wall")
PALETTE = np.array(
    [[0.85, 0.2, 0.2], [0.2, 0.45, 0.9], [0.2, 0.7, 0.35], [0.95, 0.75, 0.15], [0.6, 0.3, 0.8], [0.95, 0.5, 0.15], [0.15, 0.7, 0.75], [0.9, 0.9, 0.9], [0.25, 0.25, 0.28]]
)


def look_at_quat(eye: np.ndarray, target: np.ndarray) -> np.ndarray:
    f = target - eye
    f /= np.linalg.norm(f)
    x = np.cross(f, [0, 0, 1.0])
    x /= np.linalg.norm(x)
    y = np.cross(x, f)
    R = np.stack([x, y, -f], axis=1)
    q = np.zeros(4)
    mujoco.mju_mat2Quat(q, R.flatten())
    return q


def _seg_dist(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> float:
    """Distance from point p to segment ab (used to keep distractors out of camera sight lines)."""
    t = np.clip(np.dot(p - a, b - a) / np.dot(b - a, b - a), 0, 1)
    return float(np.linalg.norm(p - (a + t * (b - a))))


def _id(m, kind, name):
    return mujoco.mj_name2id(m, kind, name)


def randomize(m: mujoco.MjModel, rng: np.random.Generator, layout: dict) -> dict:
    """Mutates model fields in place and returns the parameters used."""
    p: dict = {}
    c = np.array([layout["cx"], layout["cy"], 0.03])

    # Lighting.
    key, fill = _id(m, mujoco.mjtObj.mjOBJ_LIGHT, "key"), _id(m, mujoco.mjtObj.mjOBJ_LIGHT, "fill")
    m.light_pos[key] = c + [rng.uniform(-0.6, 0.8), rng.uniform(-0.8, 0.8), rng.uniform(0.9, 1.8)]
    m.light_dir[key] = (c - m.light_pos[key]) / np.linalg.norm(c - m.light_pos[key])
    warm = rng.uniform(-0.12, 0.12)
    m.light_diffuse[key] = np.clip(rng.uniform(0.5, 1.0) * np.array([1 + warm, 1, 1 - warm]), 0, 1)
    m.light_diffuse[fill] = rng.uniform(0.1, 0.45)
    p["light"] = {"key_pos": m.light_pos[key].round(3).tolist(), "key_diffuse": m.light_diffuse[key].round(3).tolist()}

    # Table tint and object colors.
    mat = _id(m, mujoco.mjtObj.mjOBJ_MATERIAL, "table")
    tint = 0.55 * rng.uniform(0.45, 1.0, 3) + 0.45 * rng.uniform(0.45, 0.9)
    m.mat_rgba[mat, :3] = tint
    p["table_rgb"] = tint.round(3).tolist()
    colors = rng.permutation(len(PALETTE))
    for k, g in enumerate(OBJECT_GEOMS):
        gid = _id(m, mujoco.mjtObj.mjOBJ_GEOM, g)
        if gid >= 0:
            # Fixture walls share one color so the hole block reads as one object.
            idx = colors[-1] if g.startswith("wall") or g == "floor" else colors[k % (len(colors) - 1)]
            m.geom_rgba[gid, :3] = PALETTE[idx] * rng.uniform(0.85, 1.0)
    # Cameras: three views around the workspace, jittered.
    # front: raised oblique overview. left/right: low profile views across the contact point.
    bases = {"front": [0.36, 0.14, 0.24], "left": [0.03, -0.4, 0.07], "right": [0.06, 0.4, 0.1]}
    p["cameras"] = {}
    for v in VIEWS:
        cid = _id(m, mujoco.mjtObj.mjOBJ_CAMERA, v)
        eye = c + np.array(bases[v]) + rng.uniform(-1, 1, 3) * [0.04, 0.04, 0.025]
        tgt = c + np.array([0, 0, 0.01]) + rng.uniform(-1, 1, 3) * [0.01, 0.01, 0.008]
        m.cam_pos[cid] = eye
        m.cam_quat[cid] = look_at_quat(eye, tgt)
        m.cam_fovy[cid] = rng.uniform(36, 44)
        p["cameras"][v] = {"eye": eye.round(4).tolist(), "target": tgt.round(4).tolist(), "fovy": round(float(m.cam_fovy[cid]), 2)}

    # Distractors on the table, kept clear of the task area.
    k = int(rng.integers(0, MAX_DISTRACTORS + 1))
    p["distractors"] = []
    for i in range(MAX_DISTRACTORS):
        bid = _id(m, mujoco.mjtObj.mjOBJ_BODY, f"distractor{i}")
        gid = _id(m, mujoco.mjtObj.mjOBJ_GEOM, f"distractor{i}")
        mid = m.body_mocapid[bid]
        if i >= k:
            m.body_pos[bid] = [0, 0, -1]
            continue
        eyes = [np.array(cam["eye"][:2]) for cam in p["cameras"].values()]
        for _ in range(200):
            xy = np.array([rng.uniform(0.3, 0.75), rng.uniform(-0.3, 0.3)])
            if np.linalg.norm(xy - c[:2]) > 0.14 and xy[0] > 0.28 and all(_seg_dist(xy, e, c[:2]) > 0.07 for e in eyes):
                break
        size = rng.uniform(0.01, 0.025, 3)
        m.geom_size[gid] = size
        m.geom_type[gid] = [mujoco.mjtGeom.mjGEOM_BOX, mujoco.mjtGeom.mjGEOM_CYLINDER, mujoco.mjtGeom.mjGEOM_SPHERE][rng.integers(3)]
        m.geom_rgba[gid, :3] = PALETTE[rng.integers(len(PALETTE))]
        m.body_pos[bid] = [xy[0], xy[1], size[2]]
        p["distractors"].append({"xy": xy.round(3).tolist(), "size": size.round(3).tolist()})
    return p


def place_distractors(m: mujoco.MjModel, d: mujoco.MjData):
    """Mocap bodies take their pose from data; copy the model defaults in after a reset."""
    for i in range(MAX_DISTRACTORS):
        bid = _id(m, mujoco.mjtObj.mjOBJ_BODY, f"distractor{i}")
        mid = m.body_mocapid[bid]
        d.mocap_pos[mid] = m.body_pos[bid]
