"""Compare judges on a test set.

Usage: python -m vcf.evaluate --test data/small --train data/sensor_train_s1,data/sensor_train_s2 --out results/small

Judges: each VLM (single view, multi view), sensor classifiers (logistic regression, gradient boosting) trained on
separate seeds, and a fusion of VLM output with sensor features (5-fold cross-validation on the test set, grouped by pair).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .sensors import FEATURES, feature_matrix
from .stats import half_up, mcnemar, pair_bootstrap

TASKS = ["stack", "grasp", "button", "peg", "push"]


def load(dirs: list[Path]):
    samples, traces = [], {}
    for d in dirs:
        samples += [json.loads(l) for l in open(d / "samples.jsonl")]
        traces.update(dict(np.load(d / "sensors.npz")))
    return [s for s in samples if s["id"] in traces], traces


def metrics(y: np.ndarray, pred: np.ndarray, p_success: np.ndarray | None = None) -> dict:
    """pred: 1 success, 0 failure, -1 no answer (counted as wrong in both directions)."""
    y = np.asarray(y)
    pred = np.asarray(pred)
    pos, neg = y == 1, y == 0
    tpr = float(np.mean(pred[pos] == 1)) if pos.any() else float("nan")
    tnr = float(np.mean(pred[neg] == 0)) if neg.any() else float("nan")
    out = {
        "n": int(len(y)),
        "balanced_accuracy": round((tpr + tnr) / 2, 4),
        "false_success_rate": round(float(np.mean(pred[neg] == 1)), 4) if neg.any() else None,
        "false_failure_rate": round(float(np.mean(pred[pos] == 0)), 4) if pos.any() else None,
        "no_answer_rate": round(float(np.mean(pred == -1)), 4),
    }
    if p_success is not None:
        ok = ~np.isnan(p_success)
        if ok.any():
            out["ece"], out["reliability"] = ece(y[ok], p_success[ok])
    return out


def ece(y: np.ndarray, p: np.ndarray, bins: int = 10):
    edges = np.linspace(0, 1, bins + 1)
    total, rel = 0.0, []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (p >= lo) & (p < hi) if hi < 1 else (p >= lo) & (p <= hi)
        if m.any():
            total += m.mean() * abs(p[m].mean() - y[m].mean())
            rel.append({"bin": [round(lo, 2), round(hi, 2)], "n": int(m.sum()), "mean_p": round(float(p[m].mean()), 3), "frac_success": round(float(y[m].mean()), 3)})
    return round(float(total), 4), rel


def p_success(r: dict) -> float:
    if r["success"] is None:
        return np.nan
    c = r["confidence"] if r["confidence"] is not None else 1.0
    c = min(max(float(c), 0.0), 1.0)
    return c if r["success"] else 1 - c


def by_task(samples, y, pred, ps=None):
    res = {}
    for t in TASKS:
        m = np.array([s["task"] == t for s in samples])
        if m.any():
            res[t] = metrics(y[m], pred[m], None if ps is None else ps[m])
            res[t].pop("reliability", None)
    return res


def sensor_models():
    return {
        "sensor_logreg": make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, C=1.0)),
        "sensor_gboost": HistGradientBoostingClassifier(max_depth=3, max_iter=150, learning_rate=0.1),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", type=Path, default=Path("data/small"))
    ap.add_argument("--train", default="data/sensor_train_s1,data/sensor_train_s2")
    ap.add_argument("--out", type=Path, default=Path("results/small"))
    ap.add_argument("--strength", type=float, default=1.0)
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)

    test, test_tr = load([a.test])
    train, train_tr = load([Path(p) for p in a.train.split(",") if Path(p, "samples.jsonl").exists()])
    ids = [s["id"] for s in test]
    y = np.array([s["label"] for s in test])
    ytr = np.array([s["label"] for s in train])
    report: dict = {"test": a.test.as_posix(), "n_test": len(test), "n_train_sensor": len(train), "sensor_strength": a.strength, "judges": {}}
    pairs = np.array([s["pair"] for s in test])
    preds: dict[str, np.ndarray] = {}  # per-sample verdicts: 1, 0, -1 no answer, -2 not judged

    # --- Sensor classifiers -------------------------------------------------------------
    Xtr = feature_matrix(train_tr, [s["id"] for s in train], a.strength, seed=1)
    Xte = feature_matrix(test_tr, ids, a.strength, seed=2)
    sensor_p = {}
    for name, clf in sensor_models().items():
        clf.fit(Xtr, ytr)
        p = clf.predict_proba(Xte)[:, 1]
        sensor_p[name] = p
        pred = (p >= 0.5).astype(int)
        report["judges"][name] = {"overall": metrics(y, pred, p), "ci": pair_bootstrap(y, pred, pairs), "by_task": by_task(test, y, pred, p), "kind": "sensor"}
        preds[name] = pred

    # Leave-one-task-out: train on four tasks, test on the held-out one.
    loto = {}
    for t in TASKS:
        trm = np.array([s["task"] != t for s in train])
        tem = np.array([s["task"] == t for s in test])
        clf = sensor_models()["sensor_logreg"].fit(Xtr[trm], ytr[trm])
        p = clf.predict_proba(Xte[tem])[:, 1]
        pl = (p >= 0.5).astype(int)
        loto[t] = metrics(y[tem], pl)
        loto[t]["ci"] = pair_bootstrap(y[tem], pl, pairs[tem])
    report["sensor_logreg_leave_one_task_out"] = loto

    # --- VLM judges ---------------------------------------------------------------------
    vlm_rows: dict[str, dict[str, dict]] = {}
    for f in sorted((a.test / "vlm").glob("*.jsonl")):
        for r in map(json.loads, open(f)):
            vlm_rows.setdefault(f"{r['model']}|{r['mode']}", {})[r["id"]] = r
    for key, rows in vlm_rows.items():
        model, mode = key.split("|")
        have = [i for i in ids if i in rows]
        if len(have) < len(ids):
            # Report only complete runs on the full set; partial runs get a coverage note.
            pass
        m = np.array([i in rows for i in ids])
        pred = np.array([(-1 if rows[i]["success"] is None else int(rows[i]["success"])) if i in rows else -1 for i in ids])
        ps = np.array([p_success(rows[i]) if i in rows else np.nan for i in ids])
        answered = m & (pred != -1)
        report["judges"][f"{model} ({mode})"] = {
            "overall": metrics(y[m], pred[m], ps[m]),
            "ci": pair_bootstrap(y[m], pred[m], pairs[m]),
            # Paired test against the sensor classifier on the samples this model answered.
            "mcnemar_vs_sensor_logreg": mcnemar(pred[answered] == y[answered], preds["sensor_logreg"][answered] == y[answered]),
            "by_task": by_task([s for s, k in zip(test, m) if k], y[m], pred[m], ps[m]),
            "coverage": f"{int(m.sum())}/{len(ids)}",
            "kind": "vlm",
        }
        preds[f"{model} ({mode})"] = np.where(m, pred, -2)

        # Fusion: VLM p(success) + sensor features, cross-validated on answered test samples.
        ok = m & ~np.isnan(ps)
        if ok.sum() >= 40 and len(set(y[ok])) == 2:
            X = np.column_stack([Xte[ok], ps[ok]])
            groups = np.array([s["pair"] for s in test])[ok]
            pf = np.zeros(ok.sum())
            for tr, te in GroupKFold(n_splits=5).split(X, y[ok], groups):
                clf = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000)).fit(X[tr], y[ok][tr])
                pf[te] = clf.predict_proba(X[te])[:, 1]
            predf = (pf >= 0.5).astype(int)
            sub = [s for s, k in zip(test, ok) if k]
            report["judges"][f"fusion: {model} ({mode}) + sensors"] = {
                "overall": metrics(y[ok], predf, pf), "ci": pair_bootstrap(y[ok], predf, pairs[ok]), "by_task": by_task(sub, y[ok], predf, pf), "coverage": f"{int(ok.sum())}/{len(ids)}", "kind": "fusion",
            }
            full = np.full(len(ids), -2)
            full[ok] = predf
            preds[f"fusion: {model} ({mode}) + sensors"] = full

    # --- Robustness: sensor noise sweep -------------------------------------------------
    sweep = []
    for st in [0, 0.5, 1, 2, 4, 8, 16, 32]:
        Xa = feature_matrix(train_tr, [s["id"] for s in train], st, seed=1)
        Xb = feature_matrix(test_tr, ids, st, seed=2)
        clf = sensor_models()["sensor_logreg"].fit(Xa, ytr)
        pred = (clf.predict_proba(Xb)[:, 1] >= 0.5).astype(int)
        mm = metrics(y, pred)
        sweep.append({"strength": st, "balanced_accuracy": mm["balanced_accuracy"], "false_success_rate": mm["false_success_rate"], "ci": pair_bootstrap(y, pred, pairs)})
    report["noise_sweep_sensor_logreg"] = sweep

    (a.out / "metrics.json").write_text(json.dumps(report, indent=2), newline="\n")
    write_predictions(test, y, preds, a.out)
    write_tables(report, a.out)
    plot(report, a.out)
    print((a.out / "leaderboard.md").read_text())


def write_predictions(test, y, preds: dict, out: Path):
    """One row per test sample, one column per judge. Blank means the judge did not see the sample."""
    names = list(preds)
    lines = ["id,pair,task,label," + ",".join(f'"{n}"' for n in names)]
    for i, s in enumerate(test):
        cells = ["" if preds[n][i] == -2 else str(int(preds[n][i])) for n in names]
        lines.append(f"{s['id']},{s['pair']},{s['task']},{int(y[i])}," + ",".join(cells))
    (out / "predictions.csv").write_text("\n".join(lines) + "\n", newline="\n")


def _n(x) -> str:
    return "-" if x is None or x != x else half_up(x, 3)


def _ci(c) -> str:
    return "" if not c or c[0] is None else f"[{half_up(c[0], 2)}, {half_up(c[1], 2)}]"


def _p(p: float) -> str:
    return "<0.001" if p < 0.001 else f"{p:.3f}"


MIN_COVERAGE = 0.5  # judges that answered less of the test set go to the appendix table
DEGENERATE = 0.9  # a judge giving one answer on at least this share of its answers is flagged


def policy(j: dict, n_test: int) -> dict:
    """Coverage policy: share of the test set judged, whether that is enough for the main table, and whether the
    judge is degenerate (nearly always the same answer, so its accuracy says little)."""
    cov = j.get("coverage", f"{n_test}/{n_test}")
    k = int(cov.split("/")[0])
    o = j["overall"]
    # With balanced labels, saying "success" on share s of answers gives false-success + (1 - false-failure) = 2s.
    yes = ((o["false_success_rate"] or 0) + 1 - (o["false_failure_rate"] or 0)) / 2
    return {"coverage": k / n_test, "main": k / n_test >= MIN_COVERAGE, "degenerate": max(yes, 1 - yes) >= DEGENERATE and j["kind"] != "sensor", "says_success": yes}


def write_tables(r: dict, out: Path):
    rows = sorted(r["judges"].items(), key=lambda kv: -(kv[1]["overall"]["balanced_accuracy"] or 0))
    md = f"Test set: {r['test']} ({r['n_test']} samples). Sensor classifiers trained on {r['n_train_sensor']} samples from other seeds, noise strength {r['sensor_strength']}.\n\n"
    head = "| Judge | Kind | Coverage | Balanced acc. | False-success | False-failure | No answer | ECE |\n|---|---|---|---|---|---|---|---|\n"

    def line(name, j):
        o, ci, pol = j["overall"], j["ci"], policy(j, r["n_test"])
        kind = j["kind"] + (f" (degenerate: says success on {half_up(pol['says_success'], 0, 100)}%)" if pol["degenerate"] else "")
        return (f"| {name} | {kind} | {j.get('coverage', 'all')} | {_n(o['balanced_accuracy'])} {_ci(ci['balanced_accuracy'])} | "
                f"{_n(o['false_success_rate'])} {_ci(ci['false_success_rate'])} | {_n(o['false_failure_rate'])} | {_n(o['no_answer_rate'])} | {_n(o.get('ece'))} |\n")

    main = [(n, j) for n, j in rows if policy(j, r["n_test"])["main"]]
    rest = [(n, j) for n, j in rows if not policy(j, r["n_test"])["main"]]
    md += head + "".join(line(n, j) for n, j in main)
    if rest:
        md += f"\nAppendix: judges that answered under {int(MIN_COVERAGE * 100)}% of this test set (quota cuts). Their numbers cover a different, smaller sample and are not comparable with the table above.\n\n"
        md += head + "".join(line(n, j) for n, j in rest)
    md += "\nBrackets: 95% bootstrap intervals, resampling minimal pairs (2,000 resamples, seed 0).\n"
    md += "\nPaired test, each VLM vs sensor_logreg on the samples the VLM answered (McNemar; exact below 25 discordant samples):\n\n"
    md += "| VLM | Shared samples | Only VLM right | Only sensors right | p | Test |\n|---|---|---|---|---|---|\n"
    for name, j in rows:
        t = j.get("mcnemar_vs_sensor_logreg")
        if t:
            md += f"| {name} | {t['n_shared']} | {t['only_a_correct']} | {t['only_b_correct']} | {_p(t['p'])} | {t['method']} |\n"
    md += "\nBalanced accuracy by task:\n\n| Judge | " + " | ".join(TASKS) + " |\n|---|" + "---|" * len(TASKS) + "\n"
    for name, j in rows:
        md += f"| {name} | " + " | ".join(_n(j['by_task'][t]['balanced_accuracy']) if t in j["by_task"] else "-" for t in TASKS) + " |\n"
    md += "\nFalse-success rate by task:\n\n| Judge | " + " | ".join(TASKS) + " |\n|---|" + "---|" * len(TASKS) + "\n"
    for name, j in rows:
        md += f"| {name} | " + " | ".join(_n(j['by_task'][t]['false_success_rate']) if t in j["by_task"] else "-" for t in TASKS) + " |\n"
    md += "\nSensor classifier, leave one task out (logistic regression):\n\n| Held-out task | Balanced acc. | False-success |\n|---|---|---|\n"
    for t, m in r["sensor_logreg_leave_one_task_out"].items():
        md += f"| {t} | {_n(m['balanced_accuracy'])} {_ci(m['ci']['balanced_accuracy'])} | {_n(m['false_success_rate'])} {_ci(m['ci']['false_success_rate'])} |\n"
    md += "\nSensor noise sweep (logistic regression, trained and tested at the same strength):\n\n| Strength | Balanced acc. | False-success |\n|---|---|---|\n"
    for s in r["noise_sweep_sensor_logreg"]:
        md += f"| {s['strength']} | {_n(s['balanced_accuracy'])} {_ci(s['ci']['balanced_accuracy'])} | {_n(s['false_success_rate'])} {_ci(s['ci']['false_success_rate'])} |\n"
    (out / "leaderboard.md").write_text(md, newline="\n")


def plot(r: dict, out: Path):
    fig, ax = plt.subplots(figsize=(5, 5))
    ax.plot([0, 1], [0, 1], "k:", lw=1)
    for name, j in r["judges"].items():
        rel = j["overall"].get("reliability")
        if rel and (j["kind"] != "vlm" or "(single)" in name):
            ax.plot([b["mean_p"] for b in rel], [b["frac_success"] for b in rel], "o-", ms=3, label=f"{name} (ECE {j['overall']['ece']:.2f})")
    ax.set_xlabel("predicted P(success)")
    ax.set_ylabel("observed success rate")
    ax.legend(fontsize=6)
    fig.tight_layout()
    fig.savefig(out / "reliability.png", dpi=150)
    fig, ax = plt.subplots(figsize=(6, 4))
    sw = r["noise_sweep_sensor_logreg"]
    ax.semilogx([max(s["strength"], 0.25) for s in sw], [s["balanced_accuracy"] for s in sw], "o-", label="sensor classifier")
    full = [j for j in r["judges"].values() if j["kind"] == "vlm" and j["overall"]["n"] >= 0.8 * r["n_test"] and j["overall"]["balanced_accuracy"] == j["overall"]["balanced_accuracy"]]
    best = max(full, key=lambda j: j["overall"]["balanced_accuracy"], default=None)
    if best:
        ax.axhline(best["overall"]["balanced_accuracy"], color="r", ls="--", label="best VLM (>=80% coverage)")
    ax.axhline(0.5, color="gray", ls=":", label="chance")
    ax.set_xlabel("sensor noise strength (1 = cheap hardware default; leftmost point is 0)")
    ax.set_ylabel("balanced accuracy")
    ax.legend()
    fig.tight_layout()
    fig.savefig(out / "noise_sweep.png", dpi=150)


if __name__ == "__main__":
    main()
