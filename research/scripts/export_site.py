"""Export results and examples into site/data for the static website."""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import mujoco
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from vcf.generate import pair_seed  # noqa: E402
from vcf.model import compiled  # noqa: E402
from vcf.randomize import place_distractors, randomize  # noqa: E402
from vcf.evaluate import policy  # noqa: E402
from vcf.sensors import degrade  # noqa: E402
from vcf.tasks import TASK_CLASSES  # noqa: E402

SITE = ROOT.parent / "public" / "benchmark"
OUT = SITE / "data"
IMG = SITE / "img"
PANDA_BODIES = ["link0", "link1", "link2", "link3", "link4", "link5", "link6", "link7", "hand", "left_finger", "right_finger"]


def clean(x):
    """JSON for browsers: NaN and infinities become null."""
    if isinstance(x, float):
        return None if x != x or x in (float("inf"), float("-inf")) else x
    if isinstance(x, dict):
        return {k: clean(v) for k, v in x.items()}
    if isinstance(x, list):
        return [clean(v) for v in x]
    return x


def dump(path: Path, obj):
    path.write_text(json.dumps(clean(obj)))


def load_vlm(d: Path) -> dict:
    res: dict = {}
    for f in (d / "vlm").glob("*.jsonl"):
        for r in map(json.loads, open(f)):
            res.setdefault(r["id"], {})[f"{r['model']} ({r['mode']})"] = {"success": r["success"], "confidence": r["confidence"]}
    return res


def scene_pose(s: dict) -> dict:
    """Rebuild a sample's scene at capture time and export body and geom poses for the 3D viewer."""
    m = compiled(s["task"])
    task = TASK_CLASSES[s["task"]](m)
    rng = np.random.default_rng(pair_seed(s["task"], s["seed"], s["index"]))
    layout = task.reset(rng)
    randomize(m, rng, layout)
    task.reset(np.random.default_rng(0))
    L = s["layout"]
    for name in ("housing", "block"):
        b = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, name)
        if b >= 0:
            m.body_pos[b] = [L["cx"], L["cy"], 0]
            m.body_quat[b] = [np.cos(L["yaw"] / 2), 0, 0, np.sin(L["yaw"] / 2)] if name == "block" else [1, 0, 0, 0]
    w = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, "wall")
    if w >= 0:
        m.body_pos[w] = [0.62, L["cy"], 0]
    d = task.d
    d.qpos[:] = s["qpos"]
    place_distractors(m, d)
    mujoco.mj_forward(m, d)
    bodies = {}
    for n in PANDA_BODIES:
        i = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, n)
        bodies[n] = {"pos": d.xpos[i].round(5).tolist(), "quat": d.xquat[i].round(5).tolist()}
    geoms = []
    panda_ids = {mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, n) for n in PANDA_BODIES}
    for g in range(m.ngeom):
        if m.geom_bodyid[g] in panda_ids or d.geom_xpos[g][2] < -0.5:
            continue
        t = int(m.geom_type[g])
        if t not in (mujoco.mjtGeom.mjGEOM_BOX, mujoco.mjtGeom.mjGEOM_CYLINDER, mujoco.mjtGeom.mjGEOM_SPHERE):
            continue
        q = np.zeros(4)
        mujoco.mju_mat2Quat(q, d.geom_xmat[g])
        geoms.append({"type": {6: "box", 5: "cylinder", 2: "sphere"}[t], "size": m.geom_size[g].round(4).tolist(), "pos": d.geom_xpos[g].round(5).tolist(), "quat": q.round(5).tolist(), "rgba": m.geom_rgba[g].round(3).tolist()})
    return {"bodies": bodies, "geoms": geoms, "table_rgb": s["randomization"]["table_rgb"]}


def small_img(src: Path, dst: Path, side: int = 400):
    im = Image.open(src)
    im.thumbnail((side, side))
    im.save(dst, quality=85)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    IMG.mkdir(parents=True, exist_ok=True)
    data_dir = ROOT / "data" / "small"
    samples = [json.loads(l) for l in open(data_dir / "samples.jsonl")]
    with np.load(data_dir / "sensors.npz") as z:
        traces = {k: z[k] for k in z.files}
    vlm = load_vlm(data_dir)
    trace_llm: dict = {}  # B2: text LLMs reading the sensor trace
    for f in sorted((data_dir / "trace_llm").glob("*.jsonl")):
        for r in map(json.loads, open(f)):
            trace_llm.setdefault(r["id"], {})[f"{r['model']} ({r['shots']}-shot)"] = {"success": r["success"], "confidence": r["confidence"]}

    # Leaderboards.
    boards = {}
    for name in ("small", "large"):
        p = ROOT / "results" / name / "metrics.json"
        if p.exists():
            r = json.loads(p.read_text())
            boards[name] = {
                "n_test": r["n_test"],
                "rows": [{"judge": k, "kind": j["kind"], "coverage": j.get("coverage", "all"), **{x: j["overall"].get(x) for x in ("balanced_accuracy", "false_success_rate", "false_failure_rate", "ece", "n")},
                          "appendix": not policy(j, r["n_test"])["main"], "degenerate": policy(j, r["n_test"])["degenerate"],
                          "by_task": {t: v["balanced_accuracy"] for t, v in j["by_task"].items()}} for k, j in r["judges"].items()],
                "noise_sweep": r["noise_sweep_sensor_logreg"],
                "loto": r["sensor_logreg_leave_one_task_out"],
            }
    dump(OUT / "leaderboard.json", boards)

    # Pairs for the gallery and the game.
    pairs = {}
    for s in samples:
        if s["valid_pair"]:
            pairs.setdefault(s["pair"], {})[s["intended"]] = s
    items = []
    for pid, pr in sorted(pairs.items()):
        if len(pr) < 2:
            continue
        item = {"pair": pid, "task": pr["success"]["task"], "mag_mm": pr["failure"]["mag_mm"], "pixel_diff": pr["success"]["pair_pixel_diff"], "sides": {}}
        for v in ("success", "failure"):
            s = pr[v]
            for view in ("front", "left", "right"):
                small_img(data_dir / s["images"][view], IMG / f"{s['id']}-{view}.jpg")
            x = degrade(traces[s["id"]].astype(float), 1.0, np.random.default_rng(7))
            item["sides"][v] = {
                "id": s["id"], "label": s["label"], "rule": s["rule"], "realized_mm": s["realized_mm"],
                "vlm": vlm.get(s["id"], {}),
                "trace_llm": trace_llm.get(s["id"], {}),
                "sensors": {"switch": np.maximum(x[:, 0], x[:, 1])[::2].round(0).tolist(), "effort": x[::2, 2].round(2).tolist(), "force": x[::2, 3].round(2).tolist()},
            }
        items.append(item)
    dump(OUT / "pairs.json", items)

    # 3D scenes: one pair per task.
    scenes = []
    for task in ("stack", "grasp", "button", "peg", "push"):
        it = next((i for i in items if i["task"] == task), None)
        if it:
            sm = {s["id"]: s for s in samples}
            scenes.append({"task": task, "pair": it["pair"], "success": scene_pose(sm[it["sides"]["success"]["id"]]), "failure": scene_pose(sm[it["sides"]["failure"]["id"]])})
    dump(OUT / "scenes.json", scenes)

    # Attack results.
    att = ROOT / "results" / "attack"
    if (att / "summary.json").exists():
        out = {"summary": json.loads((att / "summary.json").read_text())}
        if (att / "transfer.json").exists():
            out["transfer"] = json.loads((att / "transfer.json").read_text())
        dump(OUT / "attack.json", out)
        (IMG / "attack").mkdir(exist_ok=True)
        for f in (att / "images").glob("*.jpg"):
            small_img(f, IMG / "attack" / f.name)

    # Panda meshes for the 3D viewer (decimated Menagerie model, Apache-2.0).
    src = ROOT.parent / "sim-to-hand" / "public" / "models"
    if (src / "panda_visual.bin").exists():
        shutil.copy(src / "panda_visual.bin", SITE / "panda_visual.bin")
        shutil.copy(src / "LICENSE-panda.txt", SITE / "LICENSE-panda.txt")
    print("exported", len(items), "pairs,", len(scenes), "scenes")


if __name__ == "__main__":
    main()
