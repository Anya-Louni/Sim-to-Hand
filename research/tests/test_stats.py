"""Statistics and metric functions on toy inputs with known answers."""
import math

import numpy as np
import pytest

from vcf.evaluate import ece, metrics
from vcf.stats import half_up, mcnemar, pair_bootstrap, wilson


def test_wilson_known_values():
    p, lo, hi = wilson(5, 10)
    assert p == 0.5
    assert lo == pytest.approx(0.2366, abs=1e-4)
    assert hi == pytest.approx(0.7634, abs=1e-4)
    p, lo, hi = wilson(0, 20)
    assert (p, lo) == (0.0, 0.0) and hi == pytest.approx(0.1611, abs=1e-4)
    assert all(math.isnan(x) for x in wilson(0, 0))


def _pairs(n):
    y = np.tile([1, 0], n)
    pairs = np.repeat(np.arange(n), 2)
    return y, pairs


def test_bootstrap_perfect_and_always_success():
    y, pairs = _pairs(30)
    perfect = pair_bootstrap(y, y, pairs)
    assert perfect["balanced_accuracy"] == [1.0, 1.0] and perfect["false_success_rate"] == [0.0, 0.0]
    yes = pair_bootstrap(y, np.ones_like(y), pairs)
    assert yes["balanced_accuracy"] == [0.5, 0.5] and yes["false_success_rate"] == [1.0, 1.0]
    assert perfect["n_pairs"] == 30


def test_bootstrap_is_seeded_and_brackets_the_estimate():
    rng = np.random.default_rng(1)
    y, pairs = _pairs(100)
    pred = np.where(rng.random(len(y)) < 0.8, y, 1 - y)
    a, b = pair_bootstrap(y, pred, pairs), pair_bootstrap(y, pred, pairs)
    assert a == b
    m = metrics(y, pred)
    assert a["balanced_accuracy"][0] <= m["balanced_accuracy"] <= a["balanced_accuracy"][1]


def test_bootstrap_counts_no_answer_as_wrong():
    y, pairs = _pairs(20)
    r = pair_bootstrap(y, np.full_like(y, -1), pairs)
    assert r["balanced_accuracy"] == [0.0, 0.0]
    assert r["false_success_rate"] == [0.0, 0.0]


def test_mcnemar_exact_and_chi2():
    a = np.array([False] * 10)
    b = np.array([True] * 10)
    r = mcnemar(a, b)
    assert r["method"] == "exact" and r["only_b_correct"] == 10
    assert r["p"] == pytest.approx(2 * 0.5**10)
    a = np.array([True] * 30 + [False] * 10 + [True] * 50)
    b = np.array([False] * 30 + [True] * 10 + [True] * 50)
    r = mcnemar(a, b)
    assert r["method"] == "chi2_cc" and r["n_shared"] == 90
    assert r["p"] == pytest.approx(0.002663, abs=1e-5)  # (|30-10|-1)^2/40 = 9.025, chi2 sf with 1 dof
    assert mcnemar(b, b)["p"] == 1.0


def test_half_up_rounding():
    assert half_up(0.885, 2) == "0.89"
    assert half_up(0.885, 0, 100) == "89"
    assert half_up(0.125, 2) == "0.13"
    assert half_up(0.5, 0) == "1"
    assert half_up(0.0, 2) == "0.00"


def test_metrics_toy():
    m = metrics(np.array([1, 1, 0, 0]), np.array([1, 0, 0, -1]))
    assert m["balanced_accuracy"] == 0.5
    assert m["false_success_rate"] == 0.0
    assert m["false_failure_rate"] == 0.5
    assert m["no_answer_rate"] == 0.25


def test_ece_toy():
    y = np.array([1, 0, 1, 0])
    assert ece(y, y.astype(float))[0] == 0.0
    assert ece(y, np.ones(4))[0] == 0.5


def test_ft_features_on_a_clean_step():
    """Force steps up along the tool axis halfway through: onset at half, direction +z, no torque."""
    from vcf.sensors import FT_FEATURES, ft_features

    x = np.zeros((100, 6))
    x[50:, 2] = 4.0
    f = dict(zip(FT_FEATURES, ft_features(x)))
    assert 0.45 < f["ft_onset_frac"] < 0.5
    assert f["ft_peak_change"] == pytest.approx(4.0)
    assert f["ft_peak_dir_z"] == pytest.approx(1.0, abs=1e-3)
    assert f["ft_end_lateral"] == pytest.approx(0.0) and f["ft_torque_peak"] == pytest.approx(0.0)
