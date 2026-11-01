"""Generate minimal pairs: same randomized scene, success attempt vs failure attempt.

Usage: python -m vcf.generate --pairs 10 --seed 0 --out data/small [--tasks stack,grasp] [--no-images]
       python -m vcf.generate --ft-only --out data/small    add sensors_ft.npz (6-axis wrist F/T) to an existing split

--ft-only replays every committed pair without rendering, writes only the 6-axis traces, and reports how far the
replayed single-axis traces are from the committed ones (a reproducibility check).
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
    tmp = path.with_name(path.stem + ".tmp.npz")
    np.savez_compressed(tmp, **arrays)
    os.replace(tmp, path)


def _load(path: Path) -> dict:
    if not path.exists():
        return {}
    with np.load(path) as z:
        return {k: z[k] for k in z.files}


def run(pairs: int, seed: int, out: Path, tasks: list[str], images: bool = True, ft_only: bool = False):
    out.mkdir(parents=True, exist_ok=True)
    if ft_only:
        images = False
        jobs = sorted({(s["task"], s["seed"], s["index"]) for s in map(json.loads, open(out / "samples.jsonl"))})
    else:
        (out / "images").mkdir(exist_ok=True)
        meta_f = open(out / "samples.jsonl", "a")
        jobs = [(name, seed, i) for name in tasks for i in range(pairs)]
    sensor_path, ft_path = out / "sensors.npz", out / "sensors_ft.npz"
    sensors, ft = _load(sensor_path), _load(ft_path)
    done = set(ft) if ft_only else ({json.loads(l)["id"] for l in open(out / "samples.jsonl")} if (out / "samples.jsonl").exists() else set())
    worst = 0.0
    labels = {r["id"]: r["label"] for r in map(json.loads, open(out / "samples.jsonl"))} if ft_only else {}
    models: dict = {}
    for n_job, (name, seed, i) in enumerate(jobs):
        if name not in models:
            model = compiled(name)
            models[name] = (model, TASK_CLASSES[name](model), mujoco.Renderer(model, RES, RES) if images else None)
        model, task, renderer = models[name]
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
            ft[sid] = att.sensors[:, 5:].astype(np.float32)
            if ft_only:
                worst = max(worst, float(np.abs(att.sensors[:, :5] - sensors[sid]).max()))
                assert att.label == labels[sid], (sid, att.rule)
                continue
            sensors[sid] = att.sensors[:, :5].astype(np.float32)
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
        if ft_only:
            if n_job % 20 == 19 or n_job == len(jobs) - 1:
                _save(ft_path, ft)
                print(f"{pid} ft traces {len(ft)}; largest single-axis replay difference so far {worst:.4f}", flush=True)
            continue
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
            _save(ft_path, ft)
        print(f"{pid} valid={valid} labels={recs[0]['label']}/{recs[1]['label']} mag={mag*1000:.2f}mm "
              f"front diff={diffs.get('front', {}).get('mean_abs', '-')} {time.time()-t0:.1f}s", flush=True)
    for _, _, renderer in models.values():
        if renderer is not None:
            renderer.close()
    if ft_only:
        _save(ft_path, ft)
        print(f"done: {len(ft)} ft traces, largest single-axis replay difference {worst:.4f}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", type=int, default=10)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", type=Path, default=Path("data/small"))
    ap.add_argument("--tasks", default=",".join(TASKS))
    ap.add_argument("--no-images", action="store_true")
    ap.add_argument("--ft-only", action="store_true")
    a = ap.parse_args()
    run(a.pairs, a.seed, a.out, a.tasks.split(","), images=not a.no_images, ft_only=a.ft_only)
