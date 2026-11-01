"""B2: can a language model read a touch trace? Text-only LLM judges the cheap-sensor trace of each sample.

  python -m vcf.trace_llm data/small groq/openai/gpt-oss-120b [--shots 0|1] [--budget N]

The trace is degraded exactly as in the evaluation (strength 1, seed 2) and printed at 10 Hz. --shots 1 adds one
labelled success/failure pair of the same task from the training seeds. Answers go to
<data>/trace_llm/<model>__<shots>shot.jsonl; calls are cached in cache/vlm like every VLM call. Resumable and
stops on a daily-quota answer.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from .sensors import degrade
from .vlm import RateLimited, provider

ROOT = Path(__file__).resolve().parents[1]

TASK_TEXT = {
    "stack": "The robot lowered a cube it holds onto a larger cube. Success: the held cube rests in contact on the larger cube. Failure: it stopped 0.5 to 2 mm above, never touching.",
    "grasp": "The robot closed its gripper on a cube. Success: the cube is between the fingers. Failure: the gripper closed 1 to 4 mm beside the cube.",
    "button": "The robot pressed a spring button with its closed fingertips. Success: pressed past the 4 mm click. Failure: pressed only 0.3 to 2.5 mm.",
    "peg": "The robot lowered a square peg it holds into a square hole. Success: fully seated at the bottom. Failure: resting on the rim.",
    "push": "The robot pushed a block toward a wall with its closed fingertips. Success: the block touches the wall. Failure: it stopped 0.5 to 3 mm short.",
}
CHANNELS = ("Columns: t (s); L and R = left and right fingertip contact switches (1 = touching; they flip at random "
            "2% of the time); effort = gripper motor effort in N (noisy); force = wrist force along the tool axis in N "
            "(noisy, with an unknown offset; compare changes, not absolute values).")


def trace_text(raw: np.ndarray, sid: str) -> str:
    h = hashlib.sha256(f"{sid}:2:{1.0:.4f}".encode()).digest()  # same noise draw as evaluate.py's test features
    x = degrade(raw, 1.0, np.random.default_rng(int.from_bytes(h[:4], "little")))
    t = raw[:, 0] - raw[0, 0]
    rows = ["t L R effort force"] + [f"{t[i]:.1f} {x[i, 0]:.0f} {x[i, 1]:.0f} {x[i, 2]:.1f} {x[i, 3]:.1f}" for i in range(0, len(x), 10)]
    return "\n".join(rows)


def prompt(task: str, trace: str, examples: list[tuple[str, int]]) -> str:
    p = f"{TASK_TEXT[task]}\nYou cannot see the scene. You only have the robot's cheap touch and force sensors during the attempt.\n{CHANNELS}\n"
    for k, (tr, label) in enumerate(examples):
        p += f"\nExample {k + 1} ({'success' if label else 'failure'}):\n{tr}\n"
    p += f"\nTrace to judge:\n{trace}\n\nDid the robot succeed?\n"
    return p + 'Reply with only JSON: {"success": true or false, "confidence": number from 0 to 1 that your answer is correct}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data", type=Path)
    ap.add_argument("model")
    ap.add_argument("--shots", type=int, default=0, choices=[0, 1])
    ap.add_argument("--budget", type=int, default=0)
    a = ap.parse_args()
    p = provider(a.model)
    samples = [json.loads(l) for l in open(a.data / "samples.jsonl")]
    traces = dict(np.load(a.data / "sensors.npz"))
    train = [json.loads(l) for l in open(ROOT / "data/sensor_train_s1/samples.jsonl")]
    train_tr = dict(np.load(ROOT / "data/sensor_train_s1/sensors.npz"))
    out = a.data / "trace_llm" / f"{p.id.replace('/', '__')}__{a.shots}shot.jsonl"
    out.parent.mkdir(exist_ok=True)
    done = {r["id"] for r in map(json.loads, open(out))} if out.exists() else set()
    f = open(out, "a")
    calls = 0
    for s in sorted(samples, key=lambda s: (s["index"], s["task"], s["intended"])):
        if s["id"] in done:
            continue
        if a.budget and calls >= a.budget:
            print(f"budget of {a.budget} calls used; rerun to continue")
            return
        ex = []
        if a.shots:
            pair = [t for t in train if t["task"] == s["task"] and t["index"] == 0]
            ex = [(trace_text(train_tr[t["id"]], t["id"]), t["label"]) for t in sorted(pair, key=lambda t: t["intended"], reverse=True)]
        try:
            calls += 1
            r = p.judge([], prompt(s["task"], trace_text(traces[s["id"]], s["id"]), ex))
        except RateLimited as e:
            print(f"daily quota reached: {str(e)[:160]}")
            return
        except Exception as e:
            print(f"error {s['id']}: {str(e)[:160]}")
            continue
        f.write(json.dumps({"id": s["id"], "model": p.id, "shots": a.shots, "success": r["success"], "confidence": r["confidence"], "label": s["label"], "raw": r["raw"][:300]}) + "\n")
        f.flush()
        print(s["id"], r["success"], "truth", s["label"], flush=True)


if __name__ == "__main__":
    main()
