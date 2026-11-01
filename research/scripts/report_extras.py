"""LaTeX tables and number macros for the agent sections of the report (A5, A6, A7, B1-B3, trials).

  python scripts/report_extras.py

Reads experiments/summary_*.csv, bench/results_hard.json, results/ft_ablation.json, results/trace_llm.json.
Writes report/tables/agent_*.tex and report/tables/macros.tex. No hand-typed numbers.
"""
from __future__ import annotations

import csv
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent
sys.path.insert(0, str(ROOT))
from vcf.stats import half_up, wilson  # noqa: E402

OUT = ROOT / "report" / "tables"
BS = "\\"
END = " " + BS * 2
FAIL = {"none": "None", "slip": "Slip", "displace": "Target moved", "knock": "Knocked off", "chaos": "Chaos"}
FAILS = list(FAIL)
macros: dict[str, str] = {}


def rate(k: int, n: int) -> str:
    """'99 [93, 100]' in percent, Wilson interval."""
    if not n:
        return "--"
    _, lo, hi = wilson(k, n)
    return f"{half_up(k / n, 0, 100)} [{half_up(lo, 0, 100)}, {half_up(hi, 0, 100)}]"


def pct(k: int, n: int) -> str:
    return f"{half_up(k / n, 0, 100)}{BS}%"


def rows(p: Path) -> list[dict]:
    return list(csv.DictReader(open(p, encoding="utf-8"))) if p.exists() else []


def table(name: str, cols: str, head: list[str], body: list[list[str]]):
    t = [f"{BS}begin{{tabular}}{{{cols}}}", f"{BS}toprule", " & ".join(head) + END, f"{BS}midrule"]
    t += [" & ".join(r) + END for r in body]
    t += [f"{BS}bottomrule", f"{BS}end{{tabular}}"]
    (OUT / f"{name}.tex").write_text("\n".join(t) + "\n", encoding="utf-8", newline="\n")


def m(name: str, value: str):
    macros[name] = value


def trials():
    r = rows(REPO / "experiments/summary_trials.csv")
    if not r:
        return
    get = lambda f, d: next(x for x in r if x["failure"] == f and x["decider"] == d)  # noqa: E731
    dec = ["camera", "sensors", "combined", "oracle"]
    table("agent_trials", "lrrrr", ["Failure", "Camera", "Sensors", "Both", "Simulator"],
          [[FAIL[f]] + [rate(int(get(f, d)["success"]), int(get(f, d)["n"])) for d in dec] for f in FAILS])
    k = get("knock", "sensors")
    m("KnockSensorsFalse", f"{k['false_success']} of {k['n']}")
    both = [get(f, "combined") for f in FAILS]
    m("CombinedFalse", f"{sum(int(x['false_success']) for x in both)} of {sum(int(x['n']) for x in both)}")


def perceived():
    r = rows(REPO / "experiments/summary_perceived.csv")
    if not r:
        return
    lab = {"oracle": "Simulator", "sensors": "Sensors", "combined": "Both"}
    body = []
    for x in r:
        n = int(x["n"])
        p = float(x["p"])
        body.append([f"{lab[x['decider']]}, {FAIL[x['failure']].lower()}", str(n), rate(int(x["perceived_success"]), n), rate(int(x["sim_success"]), n),
                     f"{x['only_perceived']}/{x['only_sim']}, {'$<$0.001' if p < 0.001 else half_up(p, 3)}"])
    table("agent_perceived", "lrrrr", ["Decider, failure", "n", "Perceived", "True state", "McNemar"], body)
    s = json.loads((REPO / "experiments/summary_perception.json").read_text())
    m("PercMedian", half_up(s["median_mm"], 1))
    m("PercMean", half_up(s["mean_mm"], 1))
    m("PercWorstMax", half_up(s["worst_max_mm"], 0))
    m("PercLooks", str(s["attempts"]))


def probes():
    r = rows(REPO / "experiments/summary_probes.csv")
    if not r:
        return
    lab = {"sensors": "Sensors", "sensors+probe": "Sensors + probe", "combined": "Camera + sensors", "router": "Router"}
    body = []
    for d in lab:
        g = [x for x in r if x["strategy"] == d]
        n = sum(int(x["n"]) for x in g)
        if not n:
            continue
        w = lambda k: sum(float(x[k]) * int(x["n"]) for x in g) / n  # noqa: E731
        knock = next(x for x in g if x["failure"] == "knock")
        body.append([lab[d], rate(sum(int(x["success"]) for x in g), n), rate(sum(int(x["false_success"]) for x in g), n),
                     rate(int(knock["false_success"]), int(knock["n"])), half_up(w("sim_s"), 1), half_up(w("camera_per_ep"), 2), half_up(w("probes_per_ep"), 2)])
    table("agent_probes", "lrrrrrr", ["Strategy", "True success", "False success", "False, knocked", "Sim s", "Camera", "Probes"], body)
    for d, key in (("sensors+probe", "Probe"), ("sensors", "Sensors"), ("router", "Router"), ("combined", "Combined")):
        knock = next((x for x in r if x["strategy"] == d and x["failure"] == "knock"), None)
        if knock:
            m(f"Knock{key}False", f"{knock['false_success']} of {knock['n']}")
        g = [x for x in r if x["strategy"] == d]
        n = sum(int(x["n"]) for x in g)
        m(f"{key}Camera", half_up(sum(float(x["camera_per_ep"]) * int(x["n"]) for x in g) / n, 2))
        m(f"{key}SimS", half_up(sum(float(x["sim_s"]) * int(x["n"]) for x in g) / n, 1))


def ft():
    p = ROOT / "results/ft_ablation.json"
    if not p.exists():
        return
    r = json.loads(p.read_text())["large"]
    s1, s6 = r["sets"]["single"], r["sets"]["ft6"]
    ba = lambda j: half_up(j["overall"]["balanced_accuracy"], 2) + f" [{half_up(j['ci']['balanced_accuracy'][0], 2)}, {half_up(j['ci']['balanced_accuracy'][1], 2)}]"  # noqa: E731
    body = [[name.replace("sensor_", "").replace("logreg", "log. reg.").replace("gboost", "boosted trees"), ba(s1["judges"][name]), ba(s6["judges"][name]),
             f"{r['mcnemar_ft6_vs_single'][name]['only_a_correct']}/{r['mcnemar_ft6_vs_single'][name]['only_b_correct']}"] for name in s1["judges"]]
    for t in ["stack", "grasp", "button", "peg", "push"]:
        body.append([f"held out: {t}", half_up(s1["loto"][t]["balanced_accuracy"], 2), half_up(s6["loto"][t]["balanced_accuracy"], 2), ""])
    table("agent_ft", "lrrr", ["Classifier", "Single axis", "6-axis F/T", "McNemar"], body)
    m("FtSingle", half_up(s1["judges"]["sensor_logreg"]["overall"]["balanced_accuracy"], 2))
    m("FtSix", half_up(s6["judges"]["sensor_logreg"]["overall"]["balanced_accuracy"], 2))
    pv = r["mcnemar_ft6_vs_single"]["sensor_logreg"]["p"]
    m("FtP", "$<$0.001" if pv < 0.001 else half_up(pv, 3))
    pv = json.loads(p.read_text())["small"]["mcnemar_ft6_vs_single"]["sensor_logreg"]["p"]
    m("FtSmallP", "$<$0.001" if pv < 0.001 else half_up(pv, 3))


def trace():
    p = ROOT / "results/trace_llm.json"
    if not p.exists():
        return
    r = json.loads(p.read_text())
    body = []
    for name, j in r.items():
        o, c, t = j["overall"], j["ci"], j["mcnemar"]["sensor_logreg"]
        body.append([name.replace("groq/openai/", ""), str(j["n"]), half_up(o["balanced_accuracy"], 2) + f" [{half_up(c['balanced_accuracy'][0], 2)}, {half_up(c['balanced_accuracy'][1], 2)}]",
                     half_up(o["false_success_rate"], 2), f"{t['only_a_correct']}/{t['only_b_correct']}, {'$<$0.001' if t['p'] < 0.001 else half_up(t['p'], 3)}"])
    table("agent_trace", "lrrrr", ["Reader", "n", "Balanced acc.", "False succ.", "vs sensor clf."], body)


def hard():
    p = REPO / "bench/results_hard.json"
    if not p.exists():
        return
    allc = json.loads(p.read_text())["conditions"]
    fams = ["relational", "reorder", "impossible", "distractor"]
    ok = lambda x: bool(x.get("refused")) if x.get("impossible") else x["success"]  # noqa: E731
    body = []
    for c in ["scripted", "scripted-chaos", "llm", "llm-chaos"]:
        rs = allc.get(c)
        if not rs:
            continue
        body.append([c] + [f"{sum(ok(x) for x in rs if x['kind'] == f)}/{sum(x['kind'] == f for x in rs)}" for f in fams] + [rate(sum(ok(x) for x in rs), len(rs))])
    table("agent_hard", "lrrrrr", ["Condition"] + [f.capitalize() for f in fams] + ["Correct"], body)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for fn in (trials, perceived, probes, ft, trace, hard):
        fn()
    (OUT / "macros.tex").write_text("".join(f"{BS}newcommand{{{BS}{k}}}{{{v}}}\n" for k, v in sorted(macros.items())), encoding="utf-8", newline="\n")
    print(f"wrote {len(macros)} macros and the agent tables")


if __name__ == "__main__":
    main()
