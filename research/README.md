# Research: Vision Can't Feel

The study behind the agent's sensor check. A benchmark of minimal pairs that tests whether free vision-language models can judge contact-dependent robot success, and how a tiny classifier on cheap, noisy sensors compares.

![Minimal pairs: same scene, success vs a failure a few millimeters off](docs/demo.gif)

**Website:** https://sim-to-hand.vercel.app/benchmark/ (play "Can you tell?", browse pairs, 3D scenes) · **Dataset:** https://huggingface.co/datasets/lilizzz4444/vision-cant-feel · **Report:** [report/report.pdf](report/report.pdf)

## Headline

<!-- BEGIN:headline -->
On 400 simulated contact attempts (200 minimal pairs), the best free vision model we could run at scale, gemini/gemini-3.1-flash-lite (single) (164/400 answered), reached 55% balanced accuracy (95% CI [50, 60]) and called 54% [43, 65] of failures a success. A logistic regression on three cheap, noisy sensor signals reached 89% [85, 92] with a 11% [7, 16] false-success rate. On the 164 samples both answered, the sensors were right where the VLM was wrong 65 times and the reverse 6 times (McNemar p < 0.001). The sensors are not a full fix: on the push task they score 50%, they do not transfer to unseen tasks, and vision's interval overlaps the sensors' from noise strength 16x the default and its point estimate is higher from 32x.
<!-- END:headline -->

## Leaderboard

<!-- BEGIN:leaderboard -->
| Judge | Kind | Coverage | Balanced acc. [95% CI] | False-success [95% CI] | ECE |
|---|---|---|---|---|---|
| sensor_gboost | sensor | all | 0.89 [0.85, 0.92] | 13% [8, 17] | 0.06 |
| sensor_logreg | sensor | all | 0.89 [0.85, 0.92] | 11% [7, 16] | 0.04 |
| fusion: gemini/gemini-3.1-flash-lite (single) + sensors | fusion | 164/400 | 0.88 [0.82, 0.93] | 10% [4, 17] | 0.05 |
| gemini/gemini-3.1-flash-lite (single) | vlm | 164/400 | 0.55 [0.50, 0.60] | 54% [43, 65] | 0.45 |
| ollama/moondream:1.8b (single) | vlm | 8/400 | 0.50 [0.50, 0.50] | 100% [100, 100] | 0.17 |

Scaled set, 400 samples. Chance is 0.50. Intervals are pair bootstraps. Coverage below 400 is due to free-tier daily quotas; metrics use answered samples only.

Small set, all models (100 samples):

| Judge | Coverage | Balanced acc. [95% CI] | False-success [95% CI] |
|---|---|---|---|
| fusion: gemini/gemma-4-31b-it (single) + sensors | 83/100 | 0.87 [0.79, 0.94] | 8% [0, 17] |
| sensor_logreg | all | 0.86 [0.78, 0.93] | 14% [6, 24] |
| sensor_gboost | all | 0.86 [0.78, 0.93] | 12% [4, 22] |
| fusion: ollama/moondream:1.8b (single) + sensors | 100/100 | 0.86 [0.79, 0.93] | 8% [2, 16] |
| fusion: gemini/gemini-3.1-flash-lite (multi) + sensors | 57/100 | 0.86 [0.76, 0.95] | 10% [0, 21] |
| fusion: gemini/gemini-3.1-flash-lite (single) + sensors | 100/100 | 0.85 [0.77, 0.92] | 8% [2, 16] |
| fusion: ollama/qwen2.5vl:3b (single) + sensors | 100/100 | 0.85 [0.77, 0.92] | 10% [2, 18] |
| fusion: groq/qwen/qwen3.8-27b (single) + sensors | 93/100 | 0.84 [0.75, 0.91] | 11% [2, 19] |
| fusion: gemini/gemini-3.5-flash (single) + sensors | 41/100 | 0.78 [0.65, 0.90] | 24% [10, 43] |
| gemini/gemini-3.1-flash-lite (multi) | 57/100 | 0.65 [0.55, 0.74] | 45% [28, 62] |
| gemini/gemini-3.5-flash (single) | 41/100 | 0.61 [0.48, 0.74] | 52% [29, 76] |
| gemini/gemini-3.1-flash-lite (single) | 100/100 | 0.60 [0.54, 0.66] | 46% [32, 60] |
| groq/qwen/qwen3.8-27b (single) | 93/100 | 0.57 [0.49, 0.65] | 43% [28, 57] |
| gemini/gemma-4-31b-it (single) | 83/100 | 0.56 [0.48, 0.64] | 38% [23, 53] |
| gemini/gemma-4-31b-it (multi) | 9/100 | 0.55 [0.30, 0.80] | 40% [0, 80] |
| ollama/moondream:1.8b (single) | 100/100 | 0.50 [0.50, 0.50] | 100% [100, 100] |
| ollama/qwen2.5vl:3b (single) | 100/100 | 0.50 [0.50, 0.50] | 100% [100, 100] |

Millimeters to fool (largest failure still judged a success, mean over scenes):

| Model | stack | grasp | button | peg | push |
|---|---|---|---|---|---|
| gemini/gemini-3.1-flash-lite | 11.3 | 0.0 | - | - | - |
| ollama/moondream:1.8b | 16.0 | 16.0 | 3.7 | 16.0 | 16.0 |

Of 115 scenes that fooled a model, the sensor classifier also called 6 a success.
<!-- END:leaderboard -->

Notes: the Flash-Lite attack covered only stack and grasp before its daily quota ran out (`-` = not run). Moondream and Qwen2.5-VL 3B answered "success" to every image, which is why they sit at exactly 0.50 with a 100% false-success rate. Their fusion rows are high because the fusion model leans on the sensor features.


Full tables, per-task breakdowns, calibration and noise sweeps: [results/large/leaderboard.md](results/large/leaderboard.md) and [results/small/leaderboard.md](results/small/leaderboard.md).

## What this is

- **Five contact tasks** in MuJoCo with a Franka Panda: stack (touching vs hovering), grasp (closed on vs beside), button (pressed past the click vs not), peg (seated vs on the rim), push (against the wall vs short of it).
- **Minimal pairs**: the same randomized scene captured as a success and as a failure a few millimeters off. Pixel differences between the pair are recorded.
- **Ground truth** from explicit contact and geometry rules on simulator state, after a 2 second stability hold.
- **Cheap sensors**: fingertip contact switch, gripper effort (a motor-current proxy), single-axis wrist force, degraded with noise, 8 to 10 bit quantization, drift, latency and dropouts. Strength is a parameter.
- **Judges**: free VLMs (Gemini and Gemma through AI Studio, Qwen through Groq, Qwen2.5-VL and Moondream locally through Ollama), single and multi-view; sensor-only logistic regression and gradient boosting; and a fusion of both.
- **Attacker**: finds the largest physical failure, in millimeters, that a VLM still calls a success, then checks whether those scenes fool other models and the sensor classifier.

## Architecture

```mermaid
flowchart LR
  S[Seed] --> R[Domain randomization<br/>light, colors, cameras, distractors]
  R --> P[MuJoCo Panda<br/>IK + guarded moves]
  P -->|success attempt| C1[Capture: 3 views + 100 Hz sensors + state]
  P -->|failure attempt, same scene| C2[Capture]
  C1 & C2 --> GT[Ground truth<br/>contact rules + 2 s stability hold]
  C1 & C2 --> V[VLM judges<br/>cached by model, image hash, prompt]
  C1 & C2 --> N[Cheap-sensor degradation] --> K[Tiny classifiers]
  V & K --> F[Fusion]
  GT & V & K & F --> E[Metrics: balanced acc., false-success, ECE]
  P --> A[Attacker: ladder, bisection, LLM-proposed mutations] --> V
```

## Reproduce

```bash
cd research
pip install -r requirements.txt
cp .env.example .env    # add free GEMINI_API_KEY and GROQ_API_KEY; install Ollama for local models
sh reproduce.sh
```

`reproduce.sh` fetches the robot model, regenerates every dataset split from its seed, runs every judge, evaluates, runs the attacker and exports the website data. Model answers are cached in `cache/`, so reruns cost nothing. A fresh run spans several days on free tiers: rerun the script and it continues where it stopped.

## Limitations

- Simulation only. Nothing is validated on hardware, and simulated touch and force are cleaner than real sensors even after degradation.
- Failures are synthetic, from five tasks designed for this study. The sensor classifiers do not transfer to unseen tasks (leave-one-task-out is near chance).
- The single-axis wrist force cannot see a sideways push, so the sensor classifier is weak on the push task.
- Minimal pairs are hard by construction. VLM accuracy here says little about natural failure distributions.
- Free-tier quotas limited how many samples some models judged. Every table shows coverage, and metrics use only answered samples.
- Local models ran on 384 px images on a CPU laptop.
- VLM confidence is self-reported text, not a probability.
- The vision-side finding is not new: FailBench reported VLMs near chance on contact-rich tasks in real data. See [RELATED_WORK.md](RELATED_WORK.md).

## License

Code: MIT. Dataset: CC BY 4.0. Robot model: MuJoCo Menagerie Franka Panda (Apache-2.0).
