"""Cheap-sensor model and features.

Raw trace columns (100 Hz): time, touch_left N, touch_right N, gripper actuator force N, wrist force along tool axis N.
`degrade` turns them into what low-cost hardware would report. `strength` scales every effect; 1.0 is the default
"cheap hardware" setting, 0 is ideal sensors.

Per unit strength:
  contact switches  threshold 0.3 N, 2% random flips, 30 ms latency
  gripper effort    proxy for motor current: noise 0.6 N, 10-bit ADC over +-40 N, drift up to 0.8 N per trace
  wrist force       single axis: noise 0.5 N, 8-bit ADC over +-30 N, offset up to 1.5 N, drift up to 1 N per trace
  all channels      2% dropped samples (sensor holds its last value), 20 ms latency
"""
from __future__ import annotations

import hashlib

import numpy as np

HZ = 100


def _quantize(x: np.ndarray, bits: int, span: float) -> np.ndarray:
    step = 2 * span / (2**bits)
    return np.clip(np.round(x / step) * step, -span, span)


def _delay(x: np.ndarray, n: int) -> np.ndarray:
    if n <= 0:
        return x
    return np.concatenate([np.repeat(x[:1], n, axis=0), x[:-n]])


def _dropouts(x: np.ndarray, p: float, rng) -> np.ndarray:
    x = x.copy()
    for i in np.flatnonzero(rng.random(len(x)) < p):
        if i > 0:
            x[i] = x[i - 1]
    return x


def degrade(raw: np.ndarray, strength: float, rng: np.random.Generator) -> np.ndarray:
    """Returns (T, 4): switch_left, switch_right (0/1), effort, wrist force."""
    s = strength
    n = len(raw)
    t = np.linspace(0, 1, n)
    sw = (raw[:, 1:3] > 0.3).astype(float)
    flips = rng.random(sw.shape) < 0.02 * s
    sw = np.abs(sw - flips)
    sw = _delay(sw, int(round(3 * s)))
    eff = raw[:, 3] + rng.normal(0, 0.6 * s, n) + rng.uniform(-0.8, 0.8) * s * t
    eff = _quantize(eff, 10, 40.0) if s > 0 else eff
    wf = raw[:, 4] + rng.uniform(-1.5, 1.5) * s + rng.normal(0, 0.5 * s, n) + rng.uniform(-1, 1) * s * t
    wf = _quantize(wf, 8, 30.0) if s > 0 else wf
    out = np.column_stack([sw, eff, wf])
    out = _delay(out, int(round(2 * s)))
    return _dropouts(out, 0.02 * s, rng) if s > 0 else out


FEATURES = [
    "switch_left_end", "switch_right_end", "switch_any_end", "switch_both_end", "switch_frac",
    "effort_end", "effort_change", "effort_max_abs",
    "force_end_minus_start", "force_max_minus_start", "force_min_minus_start", "force_end_std",
]


def features(x: np.ndarray) -> np.ndarray:
    end = x[-20:]
    start = x[:10]
    f0 = start[:, 3].mean()
    return np.array(
        [
            end[:, 0].mean(), end[:, 1].mean(), np.maximum(end[:, 0], end[:, 1]).mean(), np.minimum(end[:, 0], end[:, 1]).mean(),
            np.maximum(x[:, 0], x[:, 1]).mean(),
            end[:, 2].mean(), end[:, 2].mean() - start[:, 2].mean(), np.abs(x[:, 2]).max(),
            end[:, 3].mean() - f0, x[:, 3].max() - f0, x[:, 3].min() - f0, end[:, 3].std(),
        ]
    )


def feature_matrix(traces: dict[str, np.ndarray], ids: list[str], strength: float, seed: int = 0) -> np.ndarray:
    rows = []
    for k, i in enumerate(ids):
        h = hashlib.sha256(f"{i}:{seed}:{strength:.4f}".encode()).digest()
        rng = np.random.default_rng(int.from_bytes(h[:4], "little"))
        rows.append(features(degrade(traces[i], strength, rng)))
    return np.array(rows)
