# Changelog

## 1.1.0 (2026-11-01)

Statistics and reproducibility
- 95% intervals on every rate: Wilson for counts, a pair bootstrap for the research judges. Paired McNemar tests.
- One command rebuilds every table, figure and number in the READMEs and the report: `npm run results`.
  CI runs it with `--check` and fails if a committed result changes.
- TypeScript unit tests, Python tests, GitHub Actions CI. Per-sample research data is committed.
- VLM coverage policy: judges that answered under half a test set move to an appendix table; judges that give one
  answer 90% of the time are marked degenerate. `research/scripts/coverage_report.py`, `docs/RUNBOOK.md`.

New experiments
- 6-axis wrist force/torque sensor set and a single-axis vs 6-axis ablation (`research/results/ft_ablation.md`).
- Perceived-state mode: the robot aims at cube poses from the OpenCV detector instead of true poses. 320 episodes
  and perception error statistics (`experiments/RESULTS.md`, section 3). Dev-only toggle in the app.
- Harder benchmark suite: relational, reorder, impossible and distractor tasks with hand-written goals, and a
  structured refusal in the plan schema (`bench/RESULTS_HARD.md`).
- Active verification: a press probe that touches the result before the agent says done, and a router that runs
  sensors, then the camera, then the probe only when needed. 800 episodes (`experiments/RESULTS.md`, section 4;
  design in `docs/design/active_verification.md`). A "Touch check" toggle runs the probe in the live demo.
- Text LLMs reading touch traces (`research/results/trace_llm.md`) and a "Can you feel it?" trace game on the
  benchmark site.

Fixes
- The bench LLM cache key now includes the system prompts, so editing a prompt no longer replays old answers.
- Two citations in the report corrected (AHA and RoboFAC authors).
- CSVs and generated text are written with LF line endings on every OS.

## 1.0.0 (2026-11-01)

- Browser agent: LLM planner over five skills, MuJoCo WASM Franka Panda, three checks (simulator state, vision
  model, cheap touch and force sensors), replanning, chaos mode.
- 24-task seeded benchmark, 1,600 seeded trial episodes and 240 checkpoint minimal pairs.
- Research study "Vision Can't Feel": minimal pairs on five contact tasks, free VLM judges against a cheap-sensor
  classifier, fusion, a physical attacker, a report and a dataset on Hugging Face.

## 0.1.0 (2026-10-29)

- First public version of the agent and the 24-task benchmark.
