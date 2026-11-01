"""Run one VLM over a dataset, single view and/or multi-view. Results go to <data>/vlm/<model>.jsonl.

Usage: python -m vcf.judge data/small gemini/gemini-3.5-flash [--views single,multi] [--min-interval 0]
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from .randomize import VIEWS
from .vlm import RateLimited, prompt_for, provider


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data", type=Path)
    ap.add_argument("model")
    ap.add_argument("--views", default="single,multi")
    ap.add_argument("--min-interval", type=float, default=0.0, help="seconds between uncached calls")
    a = ap.parse_args()
    p = provider(a.model)
    samples = [json.loads(l) for l in open(a.data / "samples.jsonl")]
    out_dir = a.data / "vlm"
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / f"{p.id.replace('/', '__').replace(':', '_')}.jsonl"
    done = set()
    if out_path.exists():
        done = {(r["id"], r["mode"]) for r in map(json.loads, open(out_path))}
    f = open(out_path, "a")
    last = 0.0
    # Interleave so a quota cut leaves balanced coverage across tasks.
    order = sorted(samples, key=lambda s: (s["index"], s["task"], s["intended"]))
    for mode in a.views.split(","):
        views = ["front"] if mode == "single" else list(VIEWS)
        for s in order:
            if (s["id"], mode) in done:
                continue
            images = [(a.data / s["images"][v]).read_bytes() for v in views]
            prompt = prompt_for(s["task"], len(views))
            wait = a.min_interval - (time.time() - last)
            if wait > 0:
                time.sleep(wait)
            try:
                t0 = time.time()
                r = p.judge(images, prompt)
                if r.get("latency_s") and time.time() - t0 > 0.5:
                    last = time.time()
            except RateLimited as e:
                print(f"daily quota reached for {p.id}: {str(e)[:160]}", flush=True)
                return
            except Exception as e:  # keep going; the cache makes reruns cheap
                print(f"error {s['id']} {mode}: {str(e)[:200]}", flush=True)
                continue
            rec = {"id": s["id"], "mode": mode, "model": p.id, "success": r["success"], "confidence": r["confidence"], "label": s["label"], "raw": r["raw"][:400]}
            f.write(json.dumps(rec) + "\n")
            f.flush()
            print(f"{p.id} {mode} {s['id']} -> {r['success']} ({r['confidence']}) truth={s['label']}", flush=True)


if __name__ == "__main__":
    main()
