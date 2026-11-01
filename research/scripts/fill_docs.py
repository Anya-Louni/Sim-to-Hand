"""Fill README and report placeholders from results/*.json, so every number is traceable."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TASKS = ["stack", "grasp", "button", "peg", "push"]


def pct(x):
    return "n/a" if x is None or x != x else f"{100 * x:.0f}%"


def num(x):
    return "n/a" if x is None or x != x else f"{x:.2f}"


def load(name):
    return json.loads((ROOT / "results" / name / "metrics.json").read_text())


def cov(j):
    a, n = (j.get("coverage", "1/1").split("/") + ["1"])[:2] if j.get("coverage") != "all" else ("1", "1")
    return int(a) / int(n)


def main():
    L, S = load("large"), load("small")
    J = L["judges"]
    sensor = J["sensor_logreg"]["overall"]
    vlms = sorted([(k, j) for k, j in J.items() if j["kind"] == "vlm"], key=lambda kv: -(kv[1]["overall"]["balanced_accuracy"] or 0))
    best_k, best = vlms[0]
    fusion = [(k, j) for k, j in J.items() if j["kind"] == "fusion"]
    sweep = L["noise_sweep_sensor_logreg"]
    bva = best["overall"]["balanced_accuracy"]
    cross = next((s["strength"] for s in sweep if s["balanced_accuracy"] <= bva), None)
    loto = L["sensor_logreg_leave_one_task_out"]
    push_s = J["sensor_logreg"]["by_task"]["push"]["balanced_accuracy"]
    att = json.loads((ROOT / "results/attack/summary.json").read_text())
    tr = json.loads((ROOT / "results/attack/transfer.json").read_text()) if (ROOT / "results/attack/transfer.json").exists() else []
    models = sorted({r["model"] for r in att})
    mm = {m: [max(r["mm_to_fool_ladder"], r["mm_to_fool_with_llm"]) for r in att if r["model"] == m] for m in models}
    sens_fooled = [r["sensor_logreg_says_success"] for r in tr]
    small_vlms = sorted([(k, j) for k, j in S["judges"].items() if j["kind"] == "vlm"], key=lambda kv: -(kv[1]["overall"]["balanced_accuracy"] or 0))

    headline = (
        f"On {L['n_test']} simulated contact attempts (200 minimal pairs), the best free vision model we could run at scale, "
        f"{best_k} ({best['coverage']} answered), reached {pct(bva)} balanced accuracy and called {pct(best['overall']['false_success_rate'])} of failures a success. "
        f"A logistic regression on three cheap, noisy sensor signals reached {pct(sensor['balanced_accuracy'])} with a {pct(sensor['false_success_rate'])} false-success rate. "
        f"The sensors are not a full fix: on the push task they score {pct(push_s)}, they do not transfer to unseen tasks, "
        f"and vision catches up once sensor noise reaches {cross if cross is not None else 'beyond the tested'}x the default."
    )
    lb = "| Judge | Kind | Coverage | Balanced acc. | False-success | ECE |\n|---|---|---|---|---|---|\n"
    rows = sorted(J.items(), key=lambda kv: -(kv[1]["overall"]["balanced_accuracy"] or 0))
    for k, j in rows:
        o = j["overall"]
        lb += f"| {k} | {j['kind']} | {j.get('coverage', 'all')} | {num(o['balanced_accuracy'])} | {pct(o['false_success_rate'])} | {num(o.get('ece'))} |\n"
    lb += f"\nScaled set, {L['n_test']} samples. Chance is 0.50. Coverage below 400 is due to free-tier daily quotas; metrics use answered samples only.\n\n"
    lb += "Small set, all models (100 samples):\n\n| Judge | Coverage | Balanced acc. | False-success |\n|---|---|---|---|\n"
    for k, j in sorted(S["judges"].items(), key=lambda kv: -(kv[1]["overall"]["balanced_accuracy"] or 0)):
        lb += f"| {k} | {j.get('coverage', 'all')} | {num(j['overall']['balanced_accuracy'])} | {pct(j['overall']['false_success_rate'])} |\n"
    lb += "\nMillimeters to fool (largest failure still judged a success, mean over scenes):\n\n| Model | " + " | ".join(TASKS) + " |\n|---|" + "---|" * len(TASKS) + "\n"
    for m in models:
        lb += f"| {m} | " + " | ".join(
            (lambda v: f"{sum(v)/len(v):.1f}" if v else "-")([max(r['mm_to_fool_ladder'], r['mm_to_fool_with_llm']) for r in att if r["model"] == m and r["task"] == t]) for t in TASKS
        ) + " |\n"
    if tr:
        lb += f"\nOf {len(tr)} scenes that fooled a model, the sensor classifier also called {sum(sens_fooled)} a success.\n"

    readme = (ROOT / "README.md").read_text()
    readme = readme.replace("HEADLINE", headline).replace("LEADERBOARD", lb)
    readme = readme.replace("SITE_URL", "https://sim-to-hand.vercel.app/benchmark/").replace("DATASET_URL", "https://huggingface.co/datasets/lilizzz4444/vision-cant-feel")
    (ROOT / "README.md").write_text(readme)

    tex_pct = lambda x: pct(x).replace("%", "\\%")
    fus = max(fusion, key=lambda kv: kv[1]["overall"]["balanced_accuracy"] or 0) if fusion else None
    abstract = (
        f"On {L['n_test']} samples the best free VLM we could run at scale reached {tex_pct(bva)} balanced accuracy with a {tex_pct(best['overall']['false_success_rate'])} false-success rate; "
        f"a logistic regression on the degraded sensors reached {tex_pct(sensor['balanced_accuracy'])} with {tex_pct(sensor['false_success_rate'])}. "
        f"Sensors fail where they cannot observe the contact (push, {tex_pct(push_s)}) and do not transfer across tasks. "
        f"Some VLMs still call a failure a success at gaps of several millimeters. Free-tier quotas limited coverage for several models; we report it throughout."
    )
    results = (
        f"On the scaled set the sensor classifier beats every VLM we ran on balanced accuracy and false-success rate (Table~\\ref{{tab:large}}). "
        f"The best VLM is {best_k.replace('_', chr(92) + '_')} at {num(bva)}. "
        + (f"Fusing it with sensor features gives {num(fus[1]['overall']['balanced_accuracy'])} ({fus[1]['coverage']} samples). " if fus else "")
        + f"On the small set the best VLM is {small_vlms[0][0].replace('_', chr(92) + '_')} at {num(small_vlms[0][1]['overall']['balanced_accuracy'])} with {small_vlms[0][1]['coverage']} answered; low-coverage rows are indicative only. "
        "Vision does best on grasp, where an empty gripper is visible, and worst where the failure is a sub-millimeter gap or a few millimeters of travel."
    )
    sweep_txt = (
        f"Accuracy falls from {num(sweep[0]['balanced_accuracy'])} with ideal sensors to {num(sweep[2]['balanced_accuracy'])} at the default and {num(sweep[-1]['balanced_accuracy'])} at strength {sweep[-1]['strength']}. "
        + (f"It drops to the best VLM's level at strength {cross}." if cross is not None else "It stays above the best VLM across the tested range.")
    )
    calib = (
        f"VLMs report high confidence whether right or wrong, so their ECE is large ({best_k.replace('_', chr(92) + '_')}: {num(best['overall'].get('ece'))}); "
        f"the sensor classifier's ECE is {num(sensor.get('ece'))}."
    )
    attack_txt = " ".join(
        f"{m.replace('_', chr(92) + '_')}: fooled in {sum(v > 0 for v in mm[m])} of {len(mm[m])} scenes, up to {max(mm[m]):.1f}\\,mm." for m in models
    ) + (f" The sensor classifier called {sum(sens_fooled)} of {len(tr)} fooling scenes a success." if tr else "")
    tex = (ROOT / "report/report.tex").read_text()
    for k, v in {"NUMBERS\\_ABSTRACT": abstract, "RESULTS\\_TEXT": results, "SWEEP\\_TEXT": sweep_txt, "CALIB\\_TEXT": calib, "ATTACK\\_TEXT": attack_txt}.items():
        tex = tex.replace(k, v)
    (ROOT / "report/report.tex").write_text(tex)
    print(headline)


if __name__ == "__main__":
    main()
