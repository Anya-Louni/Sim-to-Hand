# Status audit

Date: 2026-11-01. Commit audited: `fd3364e`. Machine: Windows 11, Node 22.17, Python 3.13.1.

## Summary

Everything that exists runs, and every committed result I could regenerate came back identical. The main gaps are missing pieces, not broken ones:

- There are no unit tests and no CI.
- The research per-sample data is not in git.
- Several README numbers are typed by hand.
- The LLM benchmark rows are stale.
- The research tables have no confidence intervals.

## What runs

| Check | Result | Time |
|---|---|---|
| `npm install` | OK, 0 vulnerabilities | |
| `npm run test:sim` | 9/9 pass (3 seeds x stack, tower, sort; success path only) | about 30 s |
| `npm run build` | OK. One warning: MuJoCo imports Node's `module`, externalized by Vite. Harmless. | 2 s |
| Fresh venv from `research/requirements.txt` (Python 3.13) | Installs. mujoco 3.17.0, numpy 2.5.4, scikit-learn 1.9.1, OpenCV 5.0.0 | about 3 min |
| `research/scripts/analyze_experiments.py` | Regenerates `experiments/RESULTS.md`, summaries and 5 figures. **No diff.** | 4 s |
| `research/scripts/make_tables.py` | Regenerates 11 report tables. **No diff.** | 0.3 s |
| `python -m vcf.evaluate` (small and large, from local raw data) | Regenerates `metrics.json` and `leaderboard.md`. **No diff.** | 23 s |
| `research/scripts/export_site.py` | Regenerates `public/benchmark/data`. **No diff.** | |
| `research/scripts/fill_docs.py` | **Does not regenerate.** It replaces one-time placeholders (`HEADLINE`, `LEADERBOARD`, ...) that were already filled, so a rerun changes nothing and proves nothing. (Correction: the first version of this audit called this "no diff".) On Windows it also rewrites `research/README.md` with CRLF line endings. | |
| `research/scripts/judge_checkpoints.py` (OpenCV) | Regenerates `checkpoints_camera.csv`. **No diff.** | 68 s |
| `python -m vcf.generate --pairs 1 --seed 0` | 10/10 samples identical to `data/small` (labels and sensor traces) | 15 s |
| `npm run bench -- scripted,scripted-chaos` | Same outcome, attempts and sensor agreement on all 48 episodes as the committed rows. `results.json` gains new log fields; I restored the committed file. | 2.5 min |
| `latexmk` on `research/report/report.tex` (MiKTeX) | Builds, 4 pages, no errors or undefined references | |
| Keys in the production bundle | None found in `dist/` | |

Not run in this audit:

- `npm run bench` LLM rows, `scripts/plan-test.ts` and `probe_models.py`, because they use API quota.
- The full 1,600-episode trials, because they take 30 minutes. They were run once in the last pass.
- The full dataset regeneration.

## What fails

Nothing failed. No command errored, and no regenerated file differed from the committed one.

## Reproducibility gaps

1. **Research raw data is not in git.**
   - `research/data/` is gitignored. It holds `samples.jsonl`, `sensors.npz`, VLM answers and images (62 MB locally).
   - The lowest committed level is `results/*/metrics.json`, which has aggregates only.
   - Per-sample VLM answers and sensor features are needed for bootstrap CIs and McNemar tests (A1). They are only on this laptop and possibly on the Hugging Face dataset (I did not check what the HF copy contains).
   - Everything except images is 3.5 MB.
2. **Checkpoint images are not in git.**
   - `experiments/images/` is gitignored, so `judge_checkpoints.py` only runs where the images exist.
   - The CSV verdicts are committed, so `analyze_experiments.py` still runs everywhere.
3. **There is no single entry point.**
   - Regenerating everything takes 6 separate commands across two languages.
4. **Tests and CI are missing.**
   - `test:sim` covers the success path of 3 task types only.
   - There are no tests for schema validation, goal predicates, the sensor model, failures, or any Python code.
   - There is no `.github/` folder.
5. Local tooling files were not ignored. They are now listed in `.git/info/exclude`, which is local and not committed.
6. `fill_docs.py` uses `write_text` without `newline`, so on Windows it writes CRLF and git sees a change. CI on Linux would not see it, but a local check would.
7. `results-llm-before-sensors.json` and the LLM rows in `bench/results.json` come from the older executor. The scripted rows come from the current one.

## Claims the code or data do not back up, or that disagree

| # | Where | Issue |
|---|---|---|
| 1 | `README.md` | Three tables are typed by hand: the benchmark table, the 1,600-episode summary and the research table. Today they match their sources, but no script produces them. |
| 2 | `README.md` vs `research/README.md` | `sensor_logreg` balanced accuracy is 0.885. The main README and report tables show 0.89. The research README headline says 88%, because Python rounds 88.5 to the even 88. One number is printed two ways. |
| 3 | `README.md` benchmark | `llm` and `llm-chaos` show "not run" for sensor agreement, and their success numbers come from the older executor (A3). |
| 4 | `research/README.md` large leaderboard | Moondream at 8/400 coverage sits in the main ranking. On the small set, Moondream and Qwen2.5-VL 3B answer "success" every time but are ranked with everyone else (A4 policy). |
| 5 | `research/README.md` attack table | Flash-Lite covers stack and grasp only, 2 scenes each. This is disclosed, but it is thin. |
| 6 | `report.tex` noise paragraph | "It drops to the best VLM's level at strength 32": at 32 it is 0.49, below the VLM's 0.55. It crosses the VLM's level between 16 and 32. |
| 7 | `server/handler.ts` | The rate-limit message says "add your own key in Settings". The button is labelled "Keys". |
| 8 | `README.md` "What it does" | Correct for the live demo (simulator decides success). The new decision rules exist only in the experiment harness, not in the UI. |
| 9 | Report length and scope | 4 pages, covering the original study only. It does not mention the agent experiments, OpenCV, or the 1,600 episodes. |

Checked and backed:

- Chaos parameters, sensor degradation numbers, grasp effort and contact thresholds, and benchmark task counts (9/6/4/5) match the code.
- The attack range of 7 to 16 mm (ladder minimum 7.0 mm for Flash-Lite) and the 6 of 115 transfer count match the data.
- Keys stay server side. The README experiment tables match `experiments/RESULTS.md`.

## Facts that differ from the brief

- **Repo size.** Tracked files total 5.3 MB and `.git` is 15 MB, not 28 MB.
  - Benchmark images are 2.45 MB.
  - The 85 attack images are stored twice (`research/results/attack/images` and `public/benchmark/img/attack`).
  - The largest single files are `docs/demo.gif` (2.1 MB) and two identical copies of `report.pdf`.
- **Benchmark failures.** The `llm-chaos` log shows the LLM placing a cube into `green_zone` during a tower task. So the planner can make plan-level mistakes, and A6 should surface them.

## Observations for Part A

- **A1:** all statistics can be computed from local raw data. CI needs the per-sample files, which are 3.5 MB without images.
- **A2:** each stage reruns in under 1.5 minutes, so the 5-minute budget is realistic. The OpenCV step is the exception: it needs the checkpoint images, so CI should start from the committed CSVs.
- **A7:** single-axis force is hard-coded as `forceTool = sensordata[wrist + 2]` in TS and `FEATURES` in `vcf/sensors.py`. The MuJoCo `force` sensor already gives 3 axes; torque needs a separate `torque` sensor in both models.

## Decisions I need before Part A

1. **Per-sample research data for CI.** Pick one:
   - (a) Commit `samples.jsonl`, `sensors.npz` and the VLM answer files (3.5 MB, no images). This is simplest and makes CI self-contained.
   - (b) Have CI download them from Hugging Face. This keeps git small but makes CI depend on the network.
   - I recommend (a).
2. **Report figures that need data.** `make_tables.py` `pixel_stats` reads `data/large/samples.jsonl`. With (a), this works in CI too.
3. **Duplicate attack images.** Should I stop committing the copy in `research/results/attack/images` and keep only the website copy? That saves about 1 MB. Moving all images to Hugging Face (A8) would save about 2.5 MB more. Given the real size, I lean toward not moving them, but it is your call.
