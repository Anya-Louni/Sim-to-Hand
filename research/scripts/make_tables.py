"""Generate LaTeX tables for the report from results/*.json and data/large/samples.jsonl. No hand-typed numbers."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from vcf.stats import half_up  # noqa: E402

OUT = ROOT / "report" / "tables"
TASKS = ["stack", "grasp", "button", "peg", "push"]
BS = "\\"
END = " " + BS * 2  # LaTeX row end


def esc(s: str) -> str:
    return s.replace("_", BS + "_").replace("&", BS + "&").replace("%", BS + "%")


def f(x, pct=False):
    if x is None or x != x:
        return "--"
    return f"{half_up(x, 0, 100)}{BS}%" if pct else half_up(x, 2)


def ci(c, pct=False):
    """Interval in brackets after a value, e.g. ' [0.85, 0.92]' or ' [7, 16]' for percentages."""
    if not c or c[0] is None:
        return ""
    if pct:
        return f" [{half_up(c[0], 0, 100)}, {half_up(c[1], 0, 100)}]"
    return f" [{half_up(c[0], 2)}, {half_up(c[1], 2)}]"


def pval(p: float) -> str:
    return "$<$0.001" if p < 0.001 else f"{half_up(p, 3)}"


def table(cols: str, header: str, rows: list[str]) -> str:
    return "\n".join([BS + "begin{tabular}{" + cols + "}", BS + "toprule", header + END, BS + "midrule", *rows, BS + "bottomrule", BS + "end{tabular}"])


def write(name: str, text: str):
    (OUT / name).write_text(text, newline="\n")


def leaderboard(name: str):
    p = ROOT / "results" / name / "metrics.json"
    if not p.exists():
        return
    r = json.loads(p.read_text())
    rows = sorted(r["judges"].items(), key=lambda kv: -(kv[1]["overall"]["balanced_accuracy"] or 0))
    lines = []
    for k, j in rows:
        o, c = j["overall"], j.get("ci", {})
        lines.append(
            f"{esc(k)} & {j.get('coverage', 'all')} & {f(o['balanced_accuracy'])}{ci(c.get('balanced_accuracy'))} & "
            f"{f(o['false_success_rate'], True)}{ci(c.get('false_success_rate'), True)} & {f(o['false_failure_rate'], True)} & {f(o.get('ece'))}" + END
        )
    write(f"leaderboard_{name}.tex", table("lrrrrr", f"Judge & Coverage & Bal. acc. [95{BS}% CI] & False-succ. [95{BS}% CI] & False-fail. & ECE", lines))

    lines = [esc(k) + " & " + " & ".join(f(j["by_task"].get(x, {}).get("balanced_accuracy")) for x in TASKS) + END for k, j in rows]
    write(f"by_task_{name}.tex", table("l" + "r" * len(TASKS), "Judge & " + " & ".join(TASKS), lines))

    lines = [
        f"{s['strength']} & {f(s['balanced_accuracy'])}{ci(s['ci']['balanced_accuracy'])} & {f(s['false_success_rate'], True)}{ci(s['ci']['false_success_rate'], True)}" + END
        for s in r["noise_sweep_sensor_logreg"]
    ]
    write(f"sweep_{name}.tex", table("lrr", "Noise strength & Bal. acc. & False-succ.", lines))

    lines = [
        f"{k} & {f(m['balanced_accuracy'])}{ci(m['ci']['balanced_accuracy'])} & {f(m['false_success_rate'], True)}{ci(m['ci']['false_success_rate'], True)}" + END
        for k, m in r["sensor_logreg_leave_one_task_out"].items()
    ]
    write(f"loto_{name}.tex", table("lrr", "Held-out task & Bal. acc. & False-succ.", lines))

    lines = []
    for k, j in rows:
        m = j.get("mcnemar_vs_sensor_logreg")
        if m:
            lines.append(f"{esc(k)} & {m['n_shared']} & {m['only_a_correct']} & {m['only_b_correct']} & {pval(m['p'])} & {esc(m['method'])}" + END)
    write(f"mcnemar_{name}.tex", table("lrrrrl", "VLM & Shared & Only VLM right & Only sensors right & $p$ & Test", lines))


def attack():
    p = ROOT / "results" / "attack" / "summary.json"
    if not p.exists():
        return
    s = json.loads(p.read_text())
    models = sorted({r["model"] for r in s})
    lines = []
    for m in models:
        cells = []
        for task in TASKS:
            rs = [max(r["mm_to_fool_ladder"], r["mm_to_fool_with_llm"]) for r in s if r["model"] == m and r["task"] == task]
            cells.append(f"{half_up(sum(rs) / len(rs), 1)}" if rs else "--")
        lines.append(esc(m) + " & " + " & ".join(cells) + END)
    write("attack.tex", table("l" + "r" * len(TASKS), "Model & " + " & ".join(TASKS), lines))
    tp = ROOT / "results" / "attack" / "transfer.json"
    if tp.exists():
        tr = json.loads(tp.read_text())
        keys = sorted({k for r in tr for k in r if "/" in k}) + ["sensor_logreg_says_success"]
        lines = []
        for k in keys:
            v = [r[k] for r in tr if r.get(k) is not None]
            lines.append(f"{esc(k.replace('sensor_logreg_says_success', 'sensor classifier'))} & {sum(v)}/{len(v)}" + END)
        write("transfer.tex", table("lr", "Judge & Also says success", lines))


def pixel_stats():
    path = ROOT / "data" / "large" / "samples.jsonl"
    rows = [json.loads(l) for l in open(path)] if path.exists() else []
    lines = []
    for task in TASKS:
        rs = [r for r in rows if r["task"] == task and r["intended"] == "failure" and r["valid_pair"]]
        if rs:
            mags = sorted(r["mag_mm"] for r in rs)
            px = sorted(r["pair_pixel_diff"]["front"]["mean_abs"] for r in rs)
            lines.append(f"{task} & {len(rs)} & {half_up(mags[0], 1)}--{half_up(mags[-1], 1)} & {half_up(px[len(px) // 2], 1)} (median)" + END)
    write("pairs.tex", table("lrrr", "Task & Pairs & Failure magnitude (mm) & Front pixel diff", lines))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for n in ("small", "large"):
        leaderboard(n)
    attack()
    pixel_stats()
    print("tables:", sorted(p.name for p in OUT.glob("*.tex")))
