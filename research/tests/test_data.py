"""Committed dataset: every minimal pair has one success and one failure, labelled by the simulator rules.
Also regenerates one pair per task and checks the ground-truth rules give the committed labels."""
import json
from collections import defaultdict
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
SPLITS = ["small", "large", "sensor_train_s1", "sensor_train_s2"]
TASKS = ["stack", "grasp", "button", "peg", "push"]


def samples(split):
    return [json.loads(l) for l in open(ROOT / "data" / split / "samples.jsonl")]


@pytest.mark.parametrize("split", SPLITS)
def test_pairs_have_opposite_labels(split):
    pairs = defaultdict(list)
    for s in samples(split):
        pairs[s["pair"]].append(s)
    assert pairs
    for pid, ss in pairs.items():
        assert len(ss) == 2, pid
        by = {s["intended"]: s for s in ss}
        assert set(by) == {"success", "failure"}, pid
        assert by["success"]["label"] == 1 and by["failure"]["label"] == 0, pid
        assert by["success"]["task"] == by["failure"]["task"] and by["success"]["seed"] == by["failure"]["seed"]
        assert all(s["valid_pair"] for s in ss)


@pytest.mark.parametrize("split", SPLITS)
def test_every_sample_has_a_sensor_trace(split):
    traces = np.load(ROOT / "data" / split / "sensors.npz")
    for s in samples(split):
        t = traces[s["id"]]
        assert t.ndim == 2 and t.shape[0] > 10 and np.isfinite(t).all(), s["id"]


def test_balanced_tasks():
    for split in SPLITS:
        counts = defaultdict(int)
        for s in samples(split):
            counts[s["task"]] += 1
        assert sorted(counts) == sorted(TASKS)
        assert len(set(counts.values())) == 1, (split, dict(counts))


@pytest.mark.skipif(not (ROOT / "assets/menagerie_panda/panda.xml").exists(), reason="robot model not fetched (scripts/fetch_assets.py)")
def test_ground_truth_rules_reproduce_committed_labels(tmp_path):
    """Regenerate pair 0 of every task from seed 0 and compare with data/small: same labels, same rule readouts.

    Labels must match exactly. MuJoCo on Linux and Windows differs in the last digits, so the numbers inside
    the rule readout (forces in N, distances in mm) are compared to within 0.05."""
    import re

    from vcf.generate import run

    run(1, 0, tmp_path, TASKS, images=False)
    new = {s["id"]: s for s in map(json.loads, open(tmp_path / "samples.jsonl"))}
    old = {s["id"]: s for s in samples("small")}
    assert len(new) == 2 * len(TASKS)
    number = re.compile(r"-?\d+(?:\.\d+)?")
    for i, s in new.items():
        assert s["label"] == (1 if s["intended"] == "success" else 0), (i, s["rule"])
        assert s["label"] == old[i]["label"], i
        assert number.sub("#", s["rule"]) == number.sub("#", old[i]["rule"]), i
        a, b = [float(x) for x in number.findall(s["rule"])], [float(x) for x in number.findall(old[i]["rule"])]
        assert a == pytest.approx(b, abs=0.05), (i, s["rule"], old[i]["rule"])


@pytest.mark.parametrize("split", SPLITS)
def test_ft_traces_match_single_axis(split):
    """sensors_ft.npz holds the full wrist force/torque of the same attempts: fz is the committed single axis."""
    single = np.load(ROOT / "data" / split / "sensors.npz")
    ft = np.load(ROOT / "data" / split / "sensors_ft.npz")
    assert sorted(ft.files) == sorted(single.files)
    for k in single.files:
        assert ft[k].shape == (len(single[k]), 6), k
        assert np.array_equal(ft[k][:, 2], single[k][:, 4]), k
