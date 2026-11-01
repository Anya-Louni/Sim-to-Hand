"""Generate minimal pairs: same randomized scene, success attempt vs failure attempt.

Usage: python -m vcf.generate --pairs 10 --seed 0 --out data/small [--tasks stack,grasp] [--no-images]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from pathlib import Path

import mujoco
import numpy as np
from PIL import Image

from .model import TASKS, compiled
from .randomize import VIEWS, place_distractors, randomize
from .tasks import TASK_CLASSES

RES = 512


def pair_seed(task: str, seed: int, i: int) -> int:
    return int.from_bytes(hashlib.sha256(f"{task}:{seed}:{i}".encode()).digest()[:4], "little")


def pixel_diff(a: np.ndarray, b: np.ndarray) -> dict:
    diff = np.abs(a.astype(np.int16) - b.astype(np.int16)).max(axis=2)
    return {"mean_abs": round(float(diff.mean()), 3), "frac_changed": round(float((diff > 10).mean()), 5)}


def _save(path: Path, arrays: dict):
    tmp = path.with_name("sensors.tmp.npz")
    np.savez_compressed(tmp, **arrays)
    os.replace(tmp, path)


def run(pairs: int, seed: int, out: Path, tasks: list[str], images: bool = True):
    out.mkdir(parents=True, exist_ok=True)
    (out / "images").mkdir(exist_ok=True)
    meta_f = open(out / "samples.jsonl", "a")
    sensors: dict[str, np.ndarray] = {}
    sensor_path = out / "sensors.npz"
    if sensor_path.exists():
        with np.load(sensor_path) as z:
            sensors.update({k: z[k] for k in z.files})
    done = set()
    if (out / "samples.jsonl").exists():
        for line in open(out / "samples.jsonl"):
            done.add(json.loads(line)["id"])
    for name in tasks:
        model = compiled(name)
        task = TASK_CLASSES[name](model)
        renderer = mujoco.Renderer(model, RES, RES) if images else None
        for i in range(pairs):
            pid = f"{name}-s{seed}-{i:04d}"
            if f"{pid}-failure" in done:
                continue
            t0 = time.time()
            ps = pair_seed(name, seed, i)
            rng = np.random.default_rng(ps)
            layout = task.reset(rng)
            params = randomize(model, rng, layout)
            lo, hi = task.fail_range
            mag = float(rng.uniform(lo, hi))
            frames = {}
            recs = []
            for variant in ("success", "failure"):
                task.reset(np.random.default_rng(0))
                place_distractors(model, task.d)

                def hook(t, variant=variant):
                    if renderer is None:
                        return {}
                    frames[variant] = {}
                    for v in VIEWS:
                        renderer.update_scene(t.d, camera=v)
                        frames[variant][v] = renderer.render().copy()
                    return {}

                task.capture_hook = hook
                att = task.attempt(layout, variant, mag, np.random.default_rng(ps + 1))
                sid = f"{pid}-{variant}"
                sensors[sid] = att.sensors.astype(np.float32)
                recs.append(
                    {
                        "id": sid,
                        "pair": pid,
                        "task": name,
                        "seed": seed,
                        "index": i,
                        "intended": variant,
                        "mag_mm": round(mag * 1000, 3),
                        "realized_mm": round(att.realized * 1000, 3),
                        "label": att.label,
                        "rule": att.rule,
                        "qpos": np.round(att.qpos, 5).tolist(),
                        "layout": {k: round(v, 4) for k, v in layout.items()},
                        "randomization": params,
                    }
                )
            # A pair is a valid minimal pair only if ground truth came out opposite.
            valid = recs[0]["label"] == 1 and recs[1]["label"] == 0
            diffs = {}
            if renderer is not None:
                for v in VIEWS:
                    diffs[v] = pixel_diff(frames["success"][v], frames["failure"][v])
                    for variant in ("success", "failure"):
                        Image.fromarray(frames[variant][v]).save(out / "images" / f"{pid}-{variant}-{v}.jpg", quality=95)
            for r in recs:
                r["valid_pair"] = valid
                r["pair_pixel_diff"] = diffs
                r["images"] = {v: f"images/{r['id']}-{v}.jpg" for v in VIEWS} if renderer is not None else {}
                meta_f.write(json.dumps(r) + "\n")
            meta_f.flush()
            if i % 10 == 9 or i == pairs - 1:
                _save(sensor_path, sensors)
            print(f"{pid} valid={valid} labels={recs[0]['label']}/{recs[1]['label']} mag={mag*1000:.2f}mm "
                  f"front diff={diffs.get('front', {}).get('mean_abs', '-')} {time.time()-t0:.1f}s", flush=True)
        if renderer is not None:
            renderer.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", type=int, default=10)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", type=Path, default=Path("data/small"))
    ap.add_argument("--tasks", default=",".join(TASKS))
    ap.add_argument("--no-images", action="store_true")
    a = ap.parse_args()
    run(a.pairs, a.seed, a.out, a.tasks.split(","), images=not a.no_images)
