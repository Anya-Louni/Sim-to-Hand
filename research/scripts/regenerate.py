"""Rebuild every table, figure and generated doc number from committed data. No API calls.

  python research/scripts/regenerate.py           rebuild
  python research/scripts/regenerate.py --check   rebuild, then fail if any committed text result changed

Steps that need files kept out of git (rendered images) are skipped when those files are absent,
so CI runs everything that can run from the repo alone.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
RESEARCH = REPO / "research"
PY = sys.executable
TEXT = (".md", ".json", ".csv", ".tex")  # figures are checked by eye, since fonts differ across systems


def run(name: str, cmd: list[str], cwd: Path = REPO, env: dict | None = None):
    t = time.time()
    r = subprocess.run(cmd, cwd=cwd, env={**os.environ, **(env or {})}, capture_output=True, text=True)
    if r.returncode:
        print(r.stdout[-2000:], r.stderr[-2000:])
        raise SystemExit(f"FAILED: {name}")
    print(f"  ok   {name} ({time.time() - t:.1f}s)")


def skip(name: str, why: str):
    print(f"  skip {name}: {why}")


def main():
    t0 = time.time()
    node = shutil.which("node")
    if node:
        run("benchmark report", [node, "--experimental-strip-types", "--no-warnings", "scripts/bench-report.ts"])
    else:
        skip("benchmark report", "node not found")
    env = {"PYTHONPATH": str(RESEARCH)}
    for split in ("small", "large"):
        run(f"research leaderboard ({split})", [PY, "-m", "vcf.evaluate", "--test", f"data/{split}", "--out", f"results/{split}"], cwd=RESEARCH, env=env)
    run("6-axis wrist sensor ablation", [PY, "scripts/ft_ablation.py"], cwd=RESEARCH)
    run("report tables", [PY, "scripts/make_tables.py"], cwd=RESEARCH)
    if any((REPO / "experiments/images/checkpoints").glob("*.jpg")):
        run("OpenCV checkpoint verdicts", [PY, "research/scripts/judge_checkpoints.py"])
    else:
        skip("OpenCV checkpoint verdicts", "experiments/images not present (kept out of git); using committed CSV")
    run("experiment tables and figures", [PY, "research/scripts/analyze_experiments.py"])
    if any((RESEARCH / "data/large/images").glob("*")) and (RESEARCH / "assets/menagerie_panda/panda.xml").exists():
        run("website data", [PY, "scripts/export_site.py"], cwd=RESEARCH)
    else:
        skip("website data", "dataset images or robot assets not present")
    run("README and report numbers", [PY, "scripts/fill_docs.py"], cwd=RESEARCH)
    print(f"done in {time.time() - t0:.0f}s")

    if "--check" in sys.argv:
        # git diff compares normalized content, so line-ending differences do not count; new files count too.
        git = lambda *a: subprocess.run(["git", *a], cwd=REPO, capture_output=True, text=True).stdout.splitlines()  # noqa: E731
        changed = [p for p in git("diff", "--name-only") + git("ls-files", "--others", "--exclude-standard") if p.endswith(TEXT)]
        if changed:
            subprocess.run(["git", "--no-pager", "diff", "--", *changed], cwd=REPO)
            raise SystemExit("FAIL: regenerated results differ from the committed ones:\n  " + "\n  ".join(changed))
        print("check: committed results match")


if __name__ == "__main__":
    main()
