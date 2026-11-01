"""Judge every checkpoint image with the OpenCV camera check and, optionally, a vision-language model.

  python research/scripts/judge_checkpoints.py                       OpenCV only
  python research/scripts/judge_checkpoints.py gemini/gemini-3.1-flash-lite

Writes experiments/data/checkpoints_camera.csv and experiments/data/checkpoints_vlm_<model>.csv.
VLM answers are cached on disk (research/cache/vlm), so a rerun never repeats a call.
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research"))
from vcf.detect import Camera, check_goals, contact_gap  # noqa: E402

DATA = ROOT / "experiments" / "data"
CONTACT_MM = 1.0  # camera says "touching" when the estimated gap is below this

PROMPTS = {
    "contact": "The robot holds the {a} cube above the {b} cube and is lowering it. Success means the {a} cube is touching the top of the {b} cube, resting in contact, not hovering above it even by a millimeter.",
    "place": "The robot was asked to stack the {a} cube on the {b} cube and has let go. Success means the {a} cube is resting on top of the {b} cube.",
}


def rows():
    return list(csv.DictReader(open(DATA / "checkpoints.csv", encoding="utf-8")))


def camera():
    out = DATA / "checkpoints_camera.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "camera", "estGapMm", "detail"])
        for r in rows():
            meta = json.loads(r["meta"])
            cam = Camera(meta["cam"])
            if r["kind"] == "contact":
                g = contact_gap(cv2.imread(str(ROOT / r["image"])), cam, r["a"], r["b"], meta["cubes"])
                ok = g["gapMm"] is not None and g["gapMm"] < CONTACT_MM
                w.writerow([r["id"], ok, g["gapMm"], f"estimated gap {g['gapMm']} mm"])
            else:
                import base64

                img = base64.b64encode((ROOT / r["image"]).read_bytes()).decode()
                res = check_goals({"image": img, "cam": meta["cam"], "cubes": meta["cubes"], "goal": [{"pred": "on", "a": r["a"], "b": r["b"]}]})
                w.writerow([r["id"], res["ok"], "", res["detail"]])
            print(r["id"], "truth", r["truth"])
    print("wrote", out)


def vlm(spec: str):
    from vcf.vlm import RateLimited, provider

    p = provider(spec)
    out = DATA / f"checkpoints_vlm_{p.model}.csv"
    done = set()
    if out.exists():
        done = {r["id"] for r in csv.DictReader(open(out, encoding="utf-8"))}
    new = not out.exists()
    f = open(out, "a", newline="", encoding="utf-8")
    w = csv.writer(f)
    if new:
        w.writerow(["id", "vlm", "confidence", "raw"])
    # Alternate kinds and labels so a quota cut leaves balanced coverage.
    order = sorted(rows(), key=lambda r: (int(r["seed"]) % 1000, r["kind"]))
    for r in order:
        if r["id"] in done:
            continue
        prompt = PROMPTS[r["kind"]].format(a=r["a"], b=r["b"]) + (
            '\nLook at this camera image. Did the robot succeed?\nReply with only JSON: {"success": true or false, "confidence": number from 0 to 1 that your answer is correct}'
        )
        try:
            res = p.judge([(ROOT / r["image"]).read_bytes()], prompt)
        except RateLimited as e:
            print("daily quota reached:", str(e)[:160])
            break
        except Exception as e:
            print("error", r["id"], str(e)[:160])
            continue
        w.writerow([r["id"], res["success"], res["confidence"], (res["raw"] or "")[:300]])
        f.flush()
        print(r["id"], "vlm", res["success"], "truth", r["truth"])


if __name__ == "__main__":
    if len(sys.argv) > 1:
        vlm(sys.argv[1])
    else:
        camera()
