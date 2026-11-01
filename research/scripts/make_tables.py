"""Generate LaTeX tables and a numbers file for the report from results/*.json. No hand-typed numbers."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "report" / "tables"
TASKS = ["stack", "grasp", "button", "peg", "push"]


def esc(s: str) -> str:
    return s.replace("_", r"\_").replace("&", r"\&").replace("%", r"\%")


def f(x, pct=False):
    if x is None or x != x:
        return "--"
    return f"{100*x:.0f}\\%" if pct else f"{x:.2f}"


def leaderboard(name: str):
    p = ROOT / "results" / name / "metrics.json"
    if not p.exists():
        return
    r = json.loads(p.read_text())
    rows = sorted(r["judges"].items(), key=lambda kv: -(kv[1]["overall"]["balanced_accuracy"] or 0))
    t = ["\\begin{tabular}{lrrrrr}", "\\toprule", "Judge & Coverage & Bal. acc. & False-succ. & False-fail. & ECE \\\\", "\\midrule"]
    for k, j in rows:
        o = j["overall"]
        t.append(f"{esc(k)} & {j.get('coverage', 'all')} & {f(o['balanced_accuracy'])} & {f(o['false_success_rate'], True)} & {f(o['false_failure_rate'], True)} & {f(o.get('ece'))} \\\\")
    t += ["\\bottomrule", "\\end{tabular}"]
    (OUT / f"leaderboard_{name}.tex").write_text("\n".join(t))
    t = ["\\begin{tabular}{l" + "r" * len(TASKS) + "}", "\\toprule", "Judge & " + " & ".join(TASKS) + " \\\\", "\\midrule"]
    for k, j in rows:
        t.append(esc(k) + " & " + " & ".join(f(j["by_task"].get(x, {}).get("balanced_accuracy")) for x in TASKS) + " \\\\")
    t += ["\\bottomrule", "\\end{tabular}"]
    (OUT / f"by_task_{name}.tex").write_text("\n".join(t))
    t = ["\\begin{tabular}{lrr}", "\\toprule", "Noise strength & Bal. acc. & False-succ. \\\\", "\\midrule"]
    for s in r["noise_sweep_sensor_logreg"]:
        t.append(f"{s['strength']} & {f(s['balanced_accuracy'])} & {f(s['false_success_rate'], True)} \\\\")
    t += ["\\bottomrule", "\\end{tabular}"]
    (OUT / f"sweep_{name}.tex").write_text("\n".join(t))
    t = ["\\begin{tabular}{lrr}", "\\toprule", "Held-out task & Bal. acc. & False-succ. \\\\", "\\midrule"]
    for k, m in r["sensor_logreg_leave_one_task_out"].items():
        t.append(f"{k} & {f(m['balanced_accuracy'])} & {f(m['false_success_rate'], True)} \\\\")
    t += ["\\bottomrule", "\\end{tabular}"]
    (OUT / f"loto_{name}.tex").write_text("\n".join(t))


def attack():
    p = ROOT / "results" / "attack" / "summary.json"
    if not p.exists():
        return
    s = json.loads(p.read_text())
    models = sorted({r["model"] for r in s})
    t = ["\\begin{tabular}{l" + "r" * len(TASKS) + "}", "\\toprule", "Model & " + " & ".join(TASKS) + " \\\\", "\\midrule"]
    for m in models:
        cells = []
        for task in TASKS:
            rs = [max(r["mm_to_fool_ladder"], r["mm_to_fool_with_llm"]) for r in s if r["model"] == m and r["task"] == task]
            cells.append(f"{sum(rs)/len(rs):.1f}" if rs else "--")
        t.append(esc(m) + " & " + " & ".join(cells) + " \\\\")
    t += ["\\bottomrule", "\\end{tabular}"]
    (OUT / "attack.tex").write_text("\n".join(t))
    tp = ROOT / "results" / "attack" / "transfer.json"
    if tp.exists():
        tr = json.loads(tp.read_text())
        keys = sorted({k for r in tr for k in r if "/" in k}) + ["sensor_logreg_says_success"]
        t = ["\\begin{tabular}{lr}", "\\toprule", "Judge & Also says success \\\\", "\\midrule"]
        for k in keys:
            v = [r[k] for r in tr if r.get(k) is not None]
            t.append(f"{esc(k.replace('sensor_logreg_says_success', 'sensor classifier'))} & {sum(v)}/{len(v)} \\\\")
        t += ["\\bottomrule", "\\end{tabular}"]
        (OUT / "transfer.tex").write_text("\n".join(t))


def pixel_stats():
    rows = [json.loads(l) for l in open(ROOT / "data" / "large" / "samples.jsonl")] if (ROOT / "data/large/samples.jsonl").exists() else []
    t = ["\\begin{tabular}{lrrr}", "\\toprule", "Task & Pairs & Failure magnitude (mm) & Front pixel diff \\\\", "\\midrule"]
    for task in TASKS:
        rs = [r for r in rows if r["task"] == task and r["intended"] == "failure" and r["valid_pair"]]
        if rs:
            mags = sorted(r["mag_mm"] for r in rs)
            px = sorted(r["pair_pixel_diff"]["front"]["mean_abs"] for r in rs)
            t.append(f"{task} & {len(rs)} & {mags[0]:.1f}--{mags[-1]:.1f} & {px[len(px)//2]:.1f} (median) \\\\")
    t += ["\\bottomrule", "\\end{tabular}"]
    (OUT / "pairs.tex").write_text("\n".join(t))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for n in ("small", "large"):
        leaderboard(n)
    attack()
    pixel_stats()
    print("tables:", sorted(p.name for p in OUT.glob("*.tex")))
