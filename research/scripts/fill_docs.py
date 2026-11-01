"""Write every result number into the READMEs and the report. Safe to rerun: it replaces generated text in place.

Markdown files hold generated text between <!-- BEGIN:name --> and <!-- END:name -->.
The report pulls generated sentences from report/tables/text_*.tex with \\input.
Sources: research/results/*, bench/results.json, bench/RESULTS.md, experiments/summary_*.csv, experiments/data/checkpoints.csv.
"""
from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # research/
REPO = ROOT.parent
sys.path.insert(0, str(ROOT))
from vcf.stats import half_up, wilson  # noqa: E402

TASKS = ["stack", "grasp", "button", "peg", "push"]


# ---------- formatting ----------
def pct(x):
    return "n/a" if x is None or x != x else f"{half_up(x, 0, 100)}%"


def num(x):
    return "n/a" if x is None or x != x else half_up(x, 2)


def ci_num(c):
    return f"[{half_up(c[0], 2)}, {half_up(c[1], 2)}]"


def ci_pct(c):
    return f"[{half_up(c[0], 0, 100)}, {half_up(c[1], 0, 100)}]"


def rate(k: int, n: int, frac=False) -> str:
    """'76% [66, 84]' with a Wilson interval; frac adds the counts."""
    p, lo, hi = wilson(k, n)
    return (f"{k}/{n} = " if frac else "") + f"{pct(p)} {ci_pct((lo, hi))}"


def ptxt(p: float) -> str:
    return "< 0.001" if p < 0.001 else f"= {half_up(p, 3)}"


def tex(s: str) -> str:
    return s.replace("%", "\\%").replace("_", "\\_")


def block(path: Path, name: str, content: str):
    text = path.read_text(encoding="utf-8")
    pat = re.compile(rf"(<!-- BEGIN:{name} -->\n).*?(<!-- END:{name} -->)", re.S)
    if not pat.search(text):
        raise SystemExit(f"{path.name}: missing block {name}")
    text = pat.sub(lambda m: m.group(1) + content.strip("\n") + "\n" + m.group(2), text)
    path.write_text(text, encoding="utf-8", newline="\n")


def tex_text(name: str, content: str):
    (ROOT / "report" / "tables" / f"text_{name}.tex").write_text(content.strip() + "\n", encoding="utf-8", newline="\n")


def load(name):
    return json.loads((ROOT / "results" / name / "metrics.json").read_text())


def read_csv(p: Path) -> list[dict]:
    return list(csv.DictReader(open(p, encoding="utf-8")))


# ---------- research study ----------
def research():
    L, S = load("large"), load("small")
    J = L["judges"]
    sensor, sensor_ci = J["sensor_logreg"]["overall"], J["sensor_logreg"]["ci"]
    # Coverage policy (evaluate.policy): cite the best main-table, non-degenerate VLM; if none qualifies,
    # the one that answered the most, with its coverage stated.
    from vcf.evaluate import policy

    vlms = sorted([(k, j) for k, j in J.items() if j["kind"] == "vlm"], key=lambda kv: -(kv[1]["overall"]["balanced_accuracy"] or 0))
    ok = [(k, j) for k, j in vlms if policy(j, L["n_test"])["main"] and not policy(j, L["n_test"])["degenerate"]]
    best_k, best = ok[0] if ok else max(vlms, key=lambda kv: int(kv[1]["coverage"].split("/")[0]))
    bva, bci = best["overall"]["balanced_accuracy"], best["ci"]
    mc = best["mcnemar_vs_sensor_logreg"]
    fusion = [(k, j) for k, j in J.items() if j["kind"] == "fusion"]
    sweep = L["noise_sweep_sensor_logreg"]
    # Where the sensor classifier meets the best VLM: first strength whose interval overlaps the VLM's,
    # and first strength whose point estimate drops below it.
    overlap = next((s["strength"] for s in sweep if s["ci"]["balanced_accuracy"][0] <= bci["balanced_accuracy"][1]), None)
    below = next((s["strength"] for s in sweep if s["balanced_accuracy"] < bva), None)
    push_s = J["sensor_logreg"]["by_task"]["push"]["balanced_accuracy"]
    att = json.loads((ROOT / "results/attack/summary.json").read_text())
    tr_path = ROOT / "results/attack/transfer.json"
    tr = json.loads(tr_path.read_text()) if tr_path.exists() else []
    models = sorted({r["model"] for r in att})
    mm = {m: [max(r["mm_to_fool_ladder"], r["mm_to_fool_with_llm"]) for r in att if r["model"] == m] for m in models}
    stack_fooled = [max(r["mm_to_fool_ladder"], r["mm_to_fool_with_llm"]) for r in att if r["task"] == "stack" and max(r["mm_to_fool_ladder"], r["mm_to_fool_with_llm"]) > 0]
    stack_ladder = [r["mm_to_fool_ladder"] for r in att if r["task"] == "stack" and r["mm_to_fool_ladder"] > 0]
    sens_fooled = [r["sensor_logreg_says_success"] for r in tr]
    small_vlms = sorted([(k, j) for k, j in S["judges"].items() if j["kind"] == "vlm"], key=lambda kv: -(kv[1]["overall"]["balanced_accuracy"] or 0))
    meet = (
        f"vision's interval overlaps the sensors' from noise strength {overlap}x the default and its point estimate is higher from {below}x"
        if overlap is not None and below is not None
        else "the sensors stay above vision across the tested noise range"
    )

    headline = (
        f"On {L['n_test']} simulated contact attempts ({L['n_test'] // 2} minimal pairs), the best free vision model we could run at scale, "
        f"{best_k} ({best['coverage']} answered), reached {pct(bva)} balanced accuracy (95% CI {ci_pct(bci['balanced_accuracy'])}) "
        f"and called {pct(best['overall']['false_success_rate'])} {ci_pct(bci['false_success_rate'])} of failures a success. "
        f"A logistic regression on three cheap, noisy sensor signals reached {pct(sensor['balanced_accuracy'])} {ci_pct(sensor_ci['balanced_accuracy'])} "
        f"with a {pct(sensor['false_success_rate'])} {ci_pct(sensor_ci['false_success_rate'])} false-success rate. "
        f"On the {mc['n_shared']} samples both answered, the sensors were right where the VLM was wrong {mc['only_b_correct']} times and the reverse {mc['only_a_correct']} times "
        f"(McNemar p {ptxt(mc['p'])}). "
        f"The sensors are not a full fix: on the push task they score {pct(push_s)}, they do not transfer to unseen tasks, and {meet}."
    )
    block(ROOT / "README.md", "headline", headline)

    lb = "| Judge | Kind | Coverage | Balanced acc. [95% CI] | False-success [95% CI] | ECE |\n|---|---|---|---|---|---|\n"
    for k, j in sorted(J.items(), key=lambda kv: -(kv[1]["overall"]["balanced_accuracy"] or 0)):
        o, c = j["overall"], j["ci"]
        lb += f"| {k} | {j['kind']} | {j.get('coverage', 'all')} | {num(o['balanced_accuracy'])} {ci_num(c['balanced_accuracy'])} | {pct(o['false_success_rate'])} {ci_pct(c['false_success_rate'])} | {num(o.get('ece'))} |\n"
    lb += f"\nScaled set, {L['n_test']} samples. Chance is 0.50. Intervals are pair bootstraps. Coverage below {L['n_test']} is due to free-tier daily quotas; metrics use answered samples only.\n\n"
    lb += f"Small set, all models ({S['n_test']} samples):\n\n| Judge | Coverage | Balanced acc. [95% CI] | False-success [95% CI] |\n|---|---|---|---|\n"
    for k, j in sorted(S["judges"].items(), key=lambda kv: -(kv[1]["overall"]["balanced_accuracy"] or 0)):
        o, c = j["overall"], j["ci"]
        lb += f"| {k} | {j.get('coverage', 'all')} | {num(o['balanced_accuracy'])} {ci_num(c['balanced_accuracy'])} | {pct(o['false_success_rate'])} {ci_pct(c['false_success_rate'])} |\n"
    lb += "\nMillimeters to fool (largest failure still judged a success, mean over scenes):\n\n| Model | " + " | ".join(TASKS) + " |\n|---|" + "---|" * len(TASKS) + "\n"
    for m in models:
        cells = []
        for t in TASKS:
            v = [max(r["mm_to_fool_ladder"], r["mm_to_fool_with_llm"]) for r in att if r["model"] == m and r["task"] == t]
            cells.append(f"{half_up(sum(v) / len(v), 1)}" if v else "-")
        lb += f"| {m} | " + " | ".join(cells) + " |\n"
    if tr:
        lb += f"\nOf {len(tr)} scenes that fooled a model, the sensor classifier also called {sum(sens_fooled)} a success.\n"
    block(ROOT / "README.md", "leaderboard", lb)

    fus = max(fusion, key=lambda kv: kv[1]["overall"]["balanced_accuracy"] or 0) if fusion else None
    tex_text(
        "abstract",
        f"On {L['n_test']} samples the best free VLM we could run at scale reached {tex(pct(bva))} balanced accuracy "
        f"(95\\% CI {tex(ci_pct(bci['balanced_accuracy']))}) with a {tex(pct(best['overall']['false_success_rate']))} false-success rate; "
        f"a logistic regression on the degraded sensors reached {tex(pct(sensor['balanced_accuracy']))} ({tex(ci_pct(sensor_ci['balanced_accuracy']))}) "
        f"with {tex(pct(sensor['false_success_rate']))}. Sensors fail where they cannot observe the contact (push, {tex(pct(push_s))}) and do not transfer across tasks. "
        "Some VLMs still call a failure a success at gaps of several millimeters. Free-tier quotas limited coverage for several models; we report it throughout.",
    )
    tex_text(
        "results",
        f"On the scaled set the sensor classifier beats every VLM we ran on balanced accuracy and false-success rate (Table~\\ref{{tab:large}}). "
        f"The best VLM is {tex(best_k)} at {num(bva)} {ci_num(bci['balanced_accuracy'])}; on the {mc['n_shared']} samples it answered, "
        f"a paired McNemar test against the sensor classifier gives $p {ptxt(mc['p'])}$ "
        f"({mc['only_b_correct']} samples only the sensors got right, {mc['only_a_correct']} only the VLM got right; Table~\\ref{{tab:mcnemar}}). "
        + (f"Fusing it with sensor features gives {num(fus[1]['overall']['balanced_accuracy'])} ({fus[1]['coverage']} samples). " if fus else "")
        + f"On the small set the best VLM is {tex(small_vlms[0][0])} at {num(small_vlms[0][1]['overall']['balanced_accuracy'])} with {small_vlms[0][1]['coverage']} answered; low-coverage rows are indicative only. "
        "Vision does best on grasp, where an empty gripper is visible, and worst where the failure is a sub-millimeter gap or a few millimeters of travel.",
    )
    tex_text(
        "sweep",
        f"Accuracy falls from {num(sweep[0]['balanced_accuracy'])} with ideal sensors to {num(sweep[2]['balanced_accuracy'])} at the default "
        f"and {num(sweep[-1]['balanced_accuracy'])} at strength {sweep[-1]['strength']}. "
        + (
            f"Its 95\\% interval first overlaps the best VLM's at strength {overlap}, and its point estimate falls below the VLM's at strength {below}."
            if overlap is not None and below is not None
            else "It stays above the best VLM across the tested range."
        ),
    )
    tex_text(
        "calib",
        f"VLMs report high confidence whether right or wrong, so their ECE is large ({tex(best_k)}: {num(best['overall'].get('ece'))}); "
        f"the sensor classifier's ECE is {num(sensor.get('ece'))}.",
    )
    tex_text(
        "attack",
        " ".join(f"{tex(m)}: fooled in {sum(v > 0 for v in mm[m])} of {len(mm[m])} scenes, up to {half_up(max(mm[m]), 1)}\\,mm." for m in models)
        + (f" The sensor classifier called {sum(sens_fooled)} of {len(tr)} fooling scenes a success." if tr else ""),
    )

    # Main README: short research summary.
    bench = json.loads((REPO / "bench/results.json").read_text())["conditions"]
    vc = sum(r["visionChecks"] for rows in bench.values() for r in rows)
    va = sum(r["visionAgreements"] for rows in bench.values() for r in rows)
    flash = next((j for k, j in J.items() if k == best_k), best)
    md = (
        f"The agent's vision check agreed with the simulator on {va} of {vc} checks above, because those failures were centimeters apart. "
        "[research/](research/) asks what happens at the millimeter scale where contact decides success. It builds minimal pairs in MuJoCo, "
        "the same scene captured as a success and as a failure a few millimeters off, across five contact tasks (stack, grasp, button, peg, push). "
        "It then compares free vision models with a tiny classifier on the same cheap sensors the agent uses.\n\n"
        f"| Judge ({L['n_test']} samples, {L['n_test'] // 2} pairs) | Balanced accuracy [95% CI] | Failures called a success [95% CI] |\n|---|---|---|\n"
        f"| Cheap-sensor classifier (logistic regression) | {num(sensor['balanced_accuracy'])} {ci_num(sensor_ci['balanced_accuracy'])} | {pct(sensor['false_success_rate'])} {ci_pct(sensor_ci['false_success_rate'])} |\n"
        f"| {best_k.split('/')[-1].split(' ')[0]}, image only ({flash['coverage']} answered, free quota) | {num(bva)} {ci_num(bci['balanced_accuracy'])} | {pct(flash['overall']['false_success_rate'])} {ci_pct(bci['false_success_rate'])} |\n\n"
        f"Intervals resample minimal pairs (2,000 bootstrap resamples). A paired McNemar test on the {mc['n_shared']} shared samples gives p {ptxt(mc['p'])}.\n\n"
        f"- Some vision models still call a stack a success with the cube hovering {half_up(min(stack_ladder), 0)} to {half_up(max(stack_fooled), 0)} mm above it.\n"
        f"- Sensors are not a full fix. A single-axis wrist force cannot feel a sideways push (the push task scores {num(push_s)}), "
        f"the classifier does not transfer to unseen tasks, and {meet}.\n"
        "- That is why the agent uses sensors for per-skill checks (grasp, slip, contact) rather than a learned success classifier, and keeps all three verdicts visible."
    )
    block(REPO / "README.md", "research", md)


# ---------- agent benchmark ----------
def benchmark():
    data = json.loads((REPO / "bench/results.json").read_text())
    all_ = data["conditions"]
    rows = all_["scripted"]
    kinds = {}
    for r in rows:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    intro = (
        f"{len(rows)} seeded tasks: " + ", ".join(f"{v} {k}" for k, v in kinds.items()) + ". Instructions use varied phrasing. "
        f"Each task runs in four conditions. Max {data['maxReplans']} replans."
    )
    block(REPO / "README.md", "bench_intro", intro)
    res = (REPO / "bench/RESULTS.md").read_text(encoding="utf-8")
    tables = res.split("\nVision disagreements")[0].strip()
    ok = lambda c: sum(r["success"] for r in all_.get(c, []))  # noqa: E731
    first = lambda c: sum(r["success"] and r["attempts"] == 1 for r in all_.get(c, []))  # noqa: E731
    n = lambda c: len(all_.get(c, []))  # noqa: E731
    fails = {c: sorted({r["kind"] for r in all_.get(c, []) if not r["success"]}) for c in all_}
    vc = sum(r["visionChecks"] for rows in all_.values() for r in rows)
    va = sum(r["visionAgreements"] for rows in all_.values() for r in rows)
    bullets = [
        f"- Without chaos: scripted {ok('scripted')}/{n('scripted')} ({first('scripted')} on the first attempt), LLM {ok('llm')}/{n('llm')} ({first('llm')} on the first attempt).",
        f"- With chaos: scripted {ok('scripted-chaos')}/{n('scripted-chaos')}, LLM {ok('llm-chaos')}/{n('llm-chaos')}. "
        f"Failed kinds: scripted {', '.join(fails.get('scripted-chaos', [])) or 'none'}; LLM {', '.join(fails.get('llm-chaos', [])) or 'none'}. "
        "The intervals overlap, so this benchmark does not separate the planners.",
        f"- The vision check agreed with sim state on {va} of {vc} checks. The camera is fixed and the failures here are centimeters apart, which is the easy case for vision.",
    ]
    block(REPO / "README.md", "bench", tables + "\n\n" + "\n".join(bullets))


# ---------- 1,600-episode experiment and checkpoints ----------
def experiments():
    S = {(r["failure"], r["decider"]): r for r in read_csv(REPO / "experiments/summary_trials.csv")}
    trials = read_csv(REPO / "experiments/data/trials.csv")
    tasks = len({t["id"] for t in trials})
    conds = len({(t["decider"], t["failure"]) for t in trials})
    deciders = len({t["decider"] for t in trials})
    failures = len({t["failure"] for t in trials})
    maxr = max(int(t["attempts"]) for t in trials) - 1
    block(
        REPO / "README.md",
        "trials_intro",
        f"The 24-task benchmark is small, so I ran a controlled experiment: {tasks} generated tasks (`generateTasks(20, 1000)`), the scripted planner "
        f"(no LLM calls, so runs are free and repeatable), and up to {maxr} replans. Each task ran under {conds} conditions: {deciders} decision rules "
        f"times {failures} failure types. Every episode and every attempt is saved to CSV. Every rate below has a 95% Wilson confidence interval.",
    )
    I = lambda f, d: int(S[(f, d)]["n"])  # noqa: E731, E741
    succ = lambda f, d: rate(int(S[(f, d)]["success"]), I(f, d))  # noqa: E731
    labels = {"none": "None", "slip": "Slip while carrying", "displace": "Target moved", "knock": "Knocked after release", "chaos": "Random chaos"}
    t = "| Failure | Camera only | Sensors only | Camera + sensors | Simulator |\n|---|---|---|---|---|\n"
    for f in ["none", "slip", "displace", "knock", "chaos"]:
        extra = ", stack and tower only" if f == "displace" else ""
        cells = []
        for d in ["camera", "sensors", "combined", "oracle"]:
            c = succ(f, d)
            fs = int(S[(f, d)]["false_success"])
            if fs == I(f, d):
                c = f"**{c}, all {fs} falsely declared done**"
            cells.append(c)
        t += f"| {labels[f]} ({I(f, 'camera')}{extra}) | " + " | ".join(cells) + " |\n"
    g = lambda f, d, k: S[(f, d)][k]  # noqa: E731
    comb_n = sum(int(g(f, "combined", "n")) for f in labels)
    comb_fs = sum(int(g(f, "combined", "false_success")) for f in labels)

    def overlaps(f):
        a = wilson(int(g(f, "combined", "success")), int(g(f, "combined", "n")))
        b = wilson(int(g(f, "oracle", "success")), int(g(f, "oracle", "n")))
        return a[1] <= b[2] and b[1] <= a[2]

    all_overlap = all(overlaps(f) for f in labels)
    t += (
        "\nThe table shows the true success rate. Takeaways:\n\n"
        f"- **Sensors catch failures during the task.** A dropped cube is noticed {half_up(float(g('slip', 'sensors', 'mean_detect_s')), 1)} s into the attempt, "
        f"vs {half_up(float(g('slip', 'camera', 'mean_detect_s')), 1)} s for the camera-only agent, which only looks at the end. "
        f"Without touch, the open-loop robot also gets stuck more often: it recovered from {rate(int(g('slip', 'camera', 'recovered')), int(g('slip', 'camera', 'first_failures')))} of real slips "
        f"vs {rate(int(g('slip', 'sensors', 'recovered')), int(g('slip', 'sensors', 'first_failures')))} with sensors.\n"
        f"- **The camera catches what sensors cannot feel.** After a release, the hand feels nothing, so sensors alone declared "
        f"{g('knock', 'sensors', 'false_success')} of {g('knock', 'sensors', 'n')} knocked-off episodes a success.\n"
        f"- **Camera + sensors never stopped early on a failure.** It had {comb_fs} false successes in {comb_n} episodes "
        f"({rate(comb_fs, comb_n)}), and "
        + ("its true success overlapped the simulator reference within 95% intervals in every failure type. " if all_overlap else "its true success differs from the simulator reference in at least one failure type. ")
        + f"The cost is extra replans when the camera rejects a good attempt: {half_up(float(g('slip', 'combined', 'mean_attempts')), 1)} attempts on average "
        f"vs {half_up(float(g('slip', 'sensors', 'mean_attempts')), 1)} for sensors alone on slips."
    )
    block(REPO / "README.md", "trials", t)

    C = {(r["kind"], r["verifier"]): r for r in read_csv(REPO / "experiments/summary_checkpoints.csv")}
    cps = read_csv(REPO / "experiments/data/checkpoints.csv")
    hov = [float(r["gapMm"]) for r in cps if r["kind"] == "contact" and r["truth"] == "false" and float(r["gapMm"]) > 1]
    per = len([r for r in cps if r["kind"] == "contact"])
    vlm = next(v for (k, v) in C if k == "contact" and v.startswith("vlm:"))
    acc = lambda k, v: rate(int(C[(k, v)]["correct"]), int(C[(k, v)]["n"]))  # noqa: E731
    fsr = lambda k, v: rate(int(C[(k, v)]["false_success"]), int(C[(k, v)]["n_failure"]))  # noqa: E731
    best = max(["camera", vlm, "sensors", "combined"], key=lambda v: float(C[("contact", v)]["correct"]))
    t = (
        f"Minimal pairs from the agent's own robot and cubes: {per} per type, half success and half failure by construction.\n\n"
        f"| Checkpoint | Camera (OpenCV) | Vision-language model ({vlm.split(':')[1]}) | Sensors | Camera + sensors |\n|---|---|---|---|---|\n"
        f"| **Contact:** held cube touching vs hovering {half_up(min(hov), 1)} to {half_up(max(hov), 1)} mm | "
        + " | ".join((f"**{acc('contact', v)}**" if v == best else acc("contact", v)) for v in ["camera", vlm, "sensors", "combined"])
        + " |\n| **Placement:** cube stays on top vs tips off after release | "
        + " | ".join(acc("place", v) for v in ["camera", vlm, "sensors", "combined"])
        + " |\n\nAccuracy with 95% Wilson intervals; chance is 50%.\n\n"
        f"- Millimeter contact is hard for both camera methods. They pass {fsr('contact', 'camera')} (OpenCV) and {fsr('contact', vlm)} (VLM) of the hovering cases as touching. "
        f"The wrist force sensor is right on {acc('contact', 'sensors')} of contact checkpoints.\n"
        f"- The opposite holds after the hand lets go: sensors pass {fsr('place', 'sensors')} of tipped cubes as placed, the camera {fsr('place', 'camera')}.\n"
        f"- Combining them keeps false successes at {fsr('contact', 'combined')} (contact) and {fsr('place', 'combined')} (placement)."
    )
    block(REPO / "README.md", "checkpoints", t)


# ---------- A5, A6, A7, B1-B3: newer experiments ----------
def agent_extras():
    R = REPO / "README.md"
    # A6: hard suite.
    hp = REPO / "bench/results_hard.json"
    if hp.exists():
        allc = json.loads(hp.read_text())["conditions"]
        ok = lambda x: bool(x.get("refused")) if x.get("impossible") else x["success"]  # noqa: E731
        fams = ["relational", "reorder", "impossible", "distractor"]
        t = "| Condition | " + " | ".join(fams) + " | Correct [95% CI] | Refused a possible task | Tried an impossible task |\n|---|---|---|---|---|---|---|---|\n"
        for c in ["scripted", "scripted-chaos", "llm", "llm-chaos"]:
            rs = allc.get(c)
            if not rs:
                continue
            poss, imp = [x for x in rs if not x.get("impossible")], [x for x in rs if x.get("impossible")]
            t += (f"| {c} | " + " | ".join(f"{sum(ok(x) for x in rs if x['kind'] == f)}/{sum(x['kind'] == f for x in rs)}" for f in fams)
                  + f" | {rate(sum(ok(x) for x in rs), len(rs), True)} | {sum(bool(x.get('refused')) for x in poss)}/{len(poss)} | {sum(not x.get('refused') for x in imp)}/{len(imp)} |\n")
        t += ("\nThe scripted rows plan from the hand-written goal, so they read the answer key: they refuse impossible tasks because "
              "the goal is empty, and they never plan an unstack. They pass reorder tasks that start stacked only when the first "
              "grasp lifts the whole stack, the placement feels no contact, the top cube falls off, and the retry works.")
        block(R, "hard", t)

    # A5: perceived state.
    pr = read_csv(REPO / "experiments/summary_perceived.csv")
    if pr:
        s = json.loads((REPO / "experiments/summary_perception.json").read_text())
        lab = {"oracle": "Simulator", "sensors": "Sensors only", "combined": "Camera + sensors"}
        fl = {"none": "no failure", "chaos": "random chaos"}
        t = "| Decider | Failure | True success, perceived state | True success, true state | McNemar p |\n|---|---|---|---|---|\n"
        for x in pr:
            n = int(x["n"])
            t += f"| {lab[x['decider']]} | {fl.get(x['failure'], x['failure'])} | {rate(int(x['perceived_success']), n)} | {rate(int(x['sim_success']), n)} | {ptxt(float(x['p'])).lstrip('= ')} |\n"
        t += (f"\nCamera position error over {s['attempts']} looks: median {half_up(s['median_mm'], 1)} mm, mean {half_up(s['mean_mm'], 1)} mm, "
              f"worst cube in a look up to {half_up(s['worst_max_mm'], 0)} mm. Looks where a cube was not found: {s['attempts_with_missing']}.")
        block(R, "perceived", t)

    # B1, B3: probes and router.
    pb = read_csv(REPO / "experiments/summary_probes.csv")
    if pb:
        lab = {"sensors": "Sensors only", "sensors+probe": "Sensors + press probe", "combined": "Camera + sensors", "router": "Router"}
        t = "| Strategy | True success | False success | False success, knocked after release | Sim s / episode | Camera checks / episode | Probes / episode |\n|---|---|---|---|---|---|---|\n"
        for d in lab:
            g = [x for x in pb if x["strategy"] == d]
            n = sum(int(x["n"]) for x in g)
            if not n:
                continue
            w = lambda k: sum(float(x[k]) * int(x["n"]) for x in g) / n  # noqa: E731
            kn = next(x for x in g if x["failure"] == "knock")
            t += (f"| {lab[d]} | {rate(sum(int(x['success']) for x in g), n)} | {rate(sum(int(x['false_success']) for x in g), n)} | "
                  f"{rate(int(kn['false_success']), int(kn['n']))} | {half_up(w('sim_s'), 1)} | {half_up(w('camera_per_ep'), 2)} | {half_up(w('probes_per_ep'), 2)} |\n")
        t += f"\nAll five failure types pooled ({sum(int(x['n']) for x in pb if x['strategy'] == 'router')} episodes per strategy). Per failure type: [experiments/RESULTS.md](experiments/RESULTS.md), section 4."
        block(R, "probes", t)

    # A7: 6-axis wrist sensor.
    fp = ROOT / "results/ft_ablation.json"
    if fp.exists():
        r = json.loads(fp.read_text())
        t = "| Test set | Classifier | Single axis [95% CI] | 6-axis F/T [95% CI] | McNemar (6-axis better / single better, p) |\n|---|---|---|---|---|\n"
        for split in ("small", "large"):
            for name in ("sensor_logreg", "sensor_gboost"):
                a, b = r[split]["sets"]["single"]["judges"][name], r[split]["sets"]["ft6"]["judges"][name]
                mc = r[split]["mcnemar_ft6_vs_single"][name]
                t += (f"| {split} ({r[split]['n_test']}) | {name} | {num(a['overall']['balanced_accuracy'])} {ci_num(a['ci']['balanced_accuracy'])} | "
                      f"{num(b['overall']['balanced_accuracy'])} {ci_num(b['ci']['balanced_accuracy'])} | {mc['only_a_correct']} / {mc['only_b_correct']}, p {ptxt(mc['p']).lstrip('= ')} |\n")
        L = r["large"]["sets"]
        held = ", ".join(f"{t_} {num(L['single']['loto'][t_]['balanced_accuracy'])} to {num(L['ft6']['loto'][t_]['balanced_accuracy'])}" for t_ in TASKS)
        sw = list(zip(L["single"]["sweep"], L["ft6"]["sweep"]))
        gone = next((a["strength"] for a, b in sw if a["strength"] > 1 and b["ci"]["balanced_accuracy"][0] <= a["ci"]["balanced_accuracy"][1]), None)
        t += (f"\nHeld-out task (large set, logistic regression), single axis to 6-axis: {held}. "
              + (f"The 6-axis advantage is gone from noise strength {gone}x: the intervals overlap from there on." if gone else "")
              + " Full tables: [research/results/ft_ablation.md](research/results/ft_ablation.md).")
        block(R, "ft", t)

    # B2: LLMs reading traces.
    tp = ROOT / "results/trace_llm.json"
    if tp.exists():
        r = json.loads(tp.read_text())
        t = "| Reader (small set) | Answered | Balanced acc. [95% CI] | False-success [95% CI] | vs sensor classifier (only LLM / only classifier right, p) |\n|---|---|---|---|---|\n"
        for name, j in r.items():
            mc = j["mcnemar"]["sensor_logreg"]
            t += (f"| {name} | {j['n']} | {num(j['overall']['balanced_accuracy'])} {ci_num(j['ci']['balanced_accuracy'])} | "
                  f"{pct(j['overall']['false_success_rate'])} {ci_pct(j['ci']['false_success_rate'])} | {mc['only_a_correct']} / {mc['only_b_correct']}, p {ptxt(mc['p']).lstrip('= ')} |\n")
        block(R, "trace_llm", t)


if __name__ == "__main__":
    research()
    benchmark()
    experiments()
    agent_extras()
    print("filled README.md, research/README.md, report/tables/text_*.tex")
