"""Cheap-sensor model and features.

Raw trace columns (100 Hz): time, touch_left N, touch_right N, gripper actuator force N, wrist force along tool axis N.
`degrade` turns them into what low-cost hardware would report. `strength` scales every effect; 1.0 is the default
"cheap hardware" setting, 0 is ideal sensors.

Per unit strength:
  contact switches  threshold 0.3 N, 2% random flips, 30 ms latency
  gripper effort    proxy for motor current: noise 0.6 N, 10-bit ADC over +-40 N, drift up to 0.8 N per trace
  wrist force       single axis: noise 0.5 N, 8-bit ADC over +-30 N, offset up to 1.5 N, drift up to 1 N per trace
  all channels      2% dropped samples (sensor holds its last value), 20 ms latency

Optional 6-axis wrist force/torque (sensor_set="ft6", traces in sensors_ft.npz: fx fy fz N, tx ty tz N m, wrist frame).
Each force axis gets the single-axis force model above. Each torque axis is scaled to the same relative precision:
noise 0.02 N m, 8-bit ADC over +-3 N m, offset up to 0.1 N m, drift up to 0.07 N m per trace.
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


def degrade_ft(ft: np.ndarray, strength: float, rng: np.random.Generator) -> np.ndarray:
    """(T, 6) wrist force/torque -> (T, 6) as a cheap 6-axis sensor would report it."""
    s = strength
    n = len(ft)
    t = np.linspace(0, 1, n)[:, None]
    noise = np.array([0.5] * 3 + [0.02] * 3)
    span = np.array([30.0] * 3 + [3.0] * 3)
    offset = np.array([1.5] * 3 + [0.1] * 3)
    drift = np.array([1.0] * 3 + [0.07] * 3)
    x = ft + rng.uniform(-1, 1, 6) * offset * s + rng.normal(0, 1, (n, 6)) * noise * s + rng.uniform(-1, 1, 6) * drift * s * t
    if s > 0:
        x = np.column_stack([_quantize(x[:, k], 8, span[k]) for k in range(6)])
    x = _delay(x, int(round(2 * s)))
    return _dropouts(x, 0.02 * s, rng) if s > 0 else x


ONSET_N = 1.5  # smoothed force change that counts as contact onset


def ft_features(x: np.ndarray) -> np.ndarray:
    """Task-agnostic summary of a 6-axis trace: when contact starts, how hard, from which direction, how steady."""
    k5 = np.ones(5) / 5  # 50 ms moving average, so three noisy axes do not cross the onset threshold on noise alone
    x = np.column_stack([np.convolve(np.pad(x[:, c], 2, mode="edge"), k5, mode="valid") for c in range(6)])
    f, tq = x[:, :3], x[:, 3:]
    df, dt = f - f[:10].mean(0), tq - tq[:10].mean(0)
    mag = np.linalg.norm(df, axis=1)
    hit = np.flatnonzero(mag > ONSET_N)
    onset = hit[0] if len(hit) else len(x)
    k = int(mag.argmax())
    after = mag[onset:]
    end = df[-20:].mean(0)
    return np.array(
        [
            onset / len(x),  # contact onset time, as a fraction of the attempt
            mag.max(),  # peak force change vs baseline
            df[k, 2] / (mag[k] + 1e-6),  # direction of the peak change vs the approach axis (tool z)
            after.std() if len(after) > 1 else 0.0,  # stability after onset
            np.linalg.norm(end), end[2], np.linalg.norm(end[:2]),  # where the force settles: size, along, across
            np.linalg.norm(dt[-20:].mean(0)), np.linalg.norm(dt, axis=1).max(),  # torque change at the end and at its peak
        ]
    )


FT_FEATURES = ["ft_onset_frac", "ft_peak_change", "ft_peak_dir_z", "ft_after_onset_std", "ft_end_mag", "ft_end_z", "ft_end_lateral", "ft_torque_end", "ft_torque_peak"]


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


def feature_names(sensor_set: str = "single") -> list[str]:
    return FEATURES if sensor_set == "single" else FEATURES[:8] + FT_FEATURES


def feature_matrix(traces: dict[str, np.ndarray], ids: list[str], strength: float, seed: int = 0,
                   sensor_set: str = "single", ft: dict[str, np.ndarray] | None = None) -> np.ndarray:
    """sensor_set "single": switches, effort, one wrist force axis. "ft6": the same switches and effort (same noise
    draws), with the single wrist axis replaced by a 6-axis force/torque sensor."""
    rows = []
    for i in ids:
        h = hashlib.sha256(f"{i}:{seed}:{strength:.4f}".encode()).digest()
        rng = np.random.default_rng(int.from_bytes(h[:4], "little"))
        base = features(degrade(traces[i], strength, rng))
        rows.append(base if sensor_set == "single" else np.concatenate([base[:8], ft_features(degrade_ft(ft[i], strength, rng))]))
    return np.array(rows)
