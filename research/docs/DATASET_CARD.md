---
license: cc-by-4.0
task_categories:
- image-classification
- robotics
tags:
- robotics
- failure-detection
- vision-language-models
- tactile
- simulation
- mujoco
pretty_name: Vision Can't Feel
size_categories:
- n<1K
---

# Vision Can't Feel

Minimal pairs of simulated robot attempts for testing whether a judge can tell success from failure on contact-dependent tasks. Each pair is one randomized MuJoCo scene captured twice: once as a success, once as a failure that differs by a few millimeters.

## Contents

| Split | Samples | Images | Use |
|---|---|---|---|
| `small` | 100 (50 pairs) | 3 views each | All VLM judges, single and multi-view |
| `large` | 400 (200 pairs) | 3 views each | Main comparison |
| `sensor_train` | 600 (300 pairs) | none | Training the sensor classifiers |

Each sample (`samples.jsonl`) has: `id`, `pair`, `task`, `seed`, `intended` (what the generator aimed for), `label` (ground truth, 1 = success), `rule` (the check that produced the label), `mag_mm` (controlled failure magnitude), `realized_mm` (measured at capture), `qpos` (full simulator state at capture), `layout`, `randomization` (lighting, colors, cameras, distractors), `valid_pair`, `pair_pixel_diff`, and `images`.

`sensors.npz` maps each sample id to a raw 100 Hz trace with columns: time (s), left fingertip touch (N), right fingertip touch (N), gripper actuator force (N), wrist force along the tool axis (N). The cheap-sensor degradation in `vcf/sensors.py` is applied at evaluation time, so you can choose the noise level.

`sensors_ft.npz` holds the full 6-axis wrist force/torque of the same attempts, same ids and same time steps: fx, fy, fz (N), tx, ty, tz (N m) in the wrist frame. Its fz column equals the single wrist-force column above. It was added later by replaying every committed pair (`python -m vcf.generate --ft-only`); the replayed single-axis traces matched the committed ones exactly.

`vlm/*.jsonl` holds every model answer: verdict, self-reported confidence, and the raw text.

## Tasks and ground truth

| Task | Success | Matched failure | Rule (after a 2 s hold with controls frozen) |
|---|---|---|---|
| stack | held cube touching the base | hovering 0.5 to 2 mm above | contact force > 0.05 N, offset < 12 mm |
| grasp | closed on the cube | closed 1 to 4 mm beside it | lift test: cube rises with the gripper |
| button | pressed past the 4 mm click | pressed 0.3 to 2.5 mm | cap displacement >= 4 mm |
| peg | seated in the hole | on the rim, 0.5 to 4 mm past the clearance | bottom within 1.5 mm of the floor and touching it |
| push | block against the wall | 0.5 to 3 mm short | block-wall contact force > 0.05 N |

## Limitations

Simulation only. Failures are synthetic and drawn from five designed tasks. Simulated touch and force are cleaner than real sensors even after degradation. Confidence values from models are self-reported text.

## Versions

- 1.0: samples, images, single-axis traces, VLM answers.
- 1.1: adds `sensors_ft.npz` (6-axis wrist force/torque). Nothing else changed.

## Citation

See `CITATION.cff` in the code repository.

## License

CC BY 4.0. The robot model comes from MuJoCo Menagerie (Apache-2.0). Code that generated this data: https://github.com/Anya-Louni/sim-to-hand/tree/main/research (MIT).
