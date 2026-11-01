"""Confidence intervals and paired tests used by every results table.

wilson        95% interval for a proportion k/n.
pair_bootstrap  percentile interval for balanced accuracy and false-success rate, resampling minimal pairs
                (not single samples), so the two halves of a pair stay together.
mcnemar       paired test of two judges on the samples both answered. Exact binomial when the
              discordant count is below 25, chi-square with continuity correction otherwise.
"""
from __future__ import annotations

import math

import numpy as np
from scipy import stats as sps

N_BOOT = 2000
SEED = 0


def half_up(x: float, digits: int = 0, scale: int = 1) -> str:
    """Round half away from zero on the decimal text of x (times scale), so 0.885 shows as 0.89, or as 89 with scale=100.
    Python's own formatting rounds half to even on the binary value, which made the same number print two ways."""
    from decimal import ROUND_HALF_UP, Decimal

    q = Decimal(1).scaleb(-digits)
    return str((Decimal(repr(float(x))) * scale).quantize(q, rounding=ROUND_HALF_UP))


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float, float]:
    if n == 0:
        return (float("nan"),) * 3
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return p, max(0.0, c - h), min(1.0, c + h)


def pair_bootstrap(y, pred, pairs, n_boot: int = N_BOOT, seed: int = SEED) -> dict:
    """y: 1 success / 0 failure. pred: 1, 0 or -1 (no answer, wrong either way). pairs: pair id per sample.

    Returns 95% percentile intervals for balanced accuracy and false-success rate."""
    y, pred, pairs = np.asarray(y), np.asarray(pred), np.asarray(pairs)
    ids, inv = np.unique(pairs, return_inverse=True)
    P = len(ids)
    # Per-pair counts: positives, true positives, negatives, true negatives, false successes.
    c = np.zeros((P, 5))
    np.add.at(c[:, 0], inv, y == 1)
    np.add.at(c[:, 1], inv, (y == 1) & (pred == 1))
    np.add.at(c[:, 2], inv, y == 0)
    np.add.at(c[:, 3], inv, (y == 0) & (pred == 0))
    np.add.at(c[:, 4], inv, (y == 0) & (pred == 1))
    rng = np.random.default_rng(seed)
    s = c[rng.integers(0, P, (n_boot, P))].sum(axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        bacc = (s[:, 1] / s[:, 0] + s[:, 3] / s[:, 2]) / 2
        fsr = s[:, 4] / s[:, 2]
    q = lambda a: [round(float(v), 4) for v in np.nanpercentile(a, [2.5, 97.5])] if np.isfinite(a).any() else [None, None]
    return {"balanced_accuracy": q(bacc), "false_success_rate": q(fsr), "n_pairs": int(P), "n_boot": n_boot, "seed": seed}


def mcnemar(correct_a, correct_b) -> dict:
    """Paired comparison of two judges' correctness on the same samples."""
    a, b = np.asarray(correct_a, bool), np.asarray(correct_b, bool)
    only_a = int(np.sum(a & ~b))
    only_b = int(np.sum(~a & b))
    n = only_a + only_b
    if n == 0:
        p, method = 1.0, "exact"
    elif n < 25:
        p, method = float(min(1.0, 2 * sps.binom.cdf(min(only_a, only_b), n, 0.5))), "exact"
    else:
        p, method = float(sps.chi2.sf((abs(only_a - only_b) - 1) ** 2 / n, 1)), "chi2_cc"
    return {"n_shared": int(len(a)), "only_a_correct": only_a, "only_b_correct": only_b, "p": p, "method": method}
