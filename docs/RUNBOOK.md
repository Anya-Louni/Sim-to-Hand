# Runbook

How to rebuild every number, run the experiments that use free API quota, and publish the data. Everything
here runs on a laptop CPU (tested on an i7 with 16 GB RAM, no GPU) and uses free tiers only.

## Setup

```bash
npm ci
python -m venv research/.venv
research/.venv/Scripts/pip install -r research/requirements.txt   # bin/pip on Linux and macOS
research/.venv/Scripts/python research/scripts/fetch_assets.py
```

API keys go in `.env` (git-ignored): `GEMINI_API_KEY` (Google AI Studio) and `GROQ_API_KEY`. Nothing in this
runbook needs a paid key.

## Rebuild every result (no API calls)

```bash
npm run results            # research/scripts/regenerate.py: tables, figures, README and report numbers
npm run results -- --check # same, then fail if any committed text result changed (this is what CI runs)
npm test                   # TypeScript unit tests
npm run test:sim           # 9 scripted episodes in the browser simulator
research/.venv/Scripts/python -m pytest research
```

Steps that need files kept out of git (rendered images) are skipped when the files are absent.

## Experiments without API calls

| Command | Writes | Time on the test laptop |
|---|---|---|
| `npm run trials -- trials 20` | `experiments/data/trials.csv`, `attempts.csv` (1,600 episodes) | about 30 min |
| `npm run trials -- perceived 20` | `perceived_*.csv` (320 episodes, A5) | about 10 min |
| `npm run trials -- probes 20` | `probe_*.csv` (800 episodes, B1 and B3) | about 30 min |
| `npm run trials -- checkpoints 60` | `checkpoints.csv` and images | about 10 min |
| `python -m vcf.generate --ft-only --out data/<split>` | `sensors_ft.npz` (A7) | about 1 min per 100 samples |
| `npm run bench -- scripted,scripted-chaos` | `bench/results.json` | about 2 min |

All runs resume: rows already in a CSV are skipped. Do not run two `vcf.generate` processes at once; they share
one generated robot file.

## Experiments that use free API quota

Before each run, estimate the calls and check the day's quota. Free-tier limits seen while building this
(they change; check the provider pages):

| Model | Used for | Free calls per day, roughly |
|---|---|---|
| gemini-3.1-flash-lite | bench planner and judge, VLM judge | 250 to 300 |
| gemini-3.5-flash-lite | bench fallback | 250 to 300 |
| gemini-3.5-flash | VLM judge (small set only) | about 20 |
| groq openai/gpt-oss-120b | bench planner fallback (text only) | see Groq console |
| groq qwen vision | VLM judge | about 50 images |

Call estimates:

- `npm run bench -- llm,llm-chaos` (main suite, 24 tasks): one plan call per attempt (two if the first answer
  fails the schema) plus one vision call per attempt. About 2.5 calls per task, about 120 for both conditions.
- `SUITE=hard npm run bench -- llm,llm-chaos` (20 tasks): about 100. Refusals cost one call.
- `python -m vcf.judge data/large <model> --views single`: one call per sample not yet judged.
  `python research/scripts/coverage_report.py` prints the number left per model.

Every bench answer is cached in `bench/llm-cache`, keyed by the request and the system prompts, so a rerun is
free and a run cut by quota resumes where it stopped. VLM judge runs stop on the first daily-quota answer
(HTTP 429) or after `--budget N` new calls, and continue on the next run:

```bash
cd research
.venv/Scripts/python -m vcf.judge data/large gemini/gemini-3.1-flash-lite --views single --min-interval 4 --budget 200
.venv/Scripts/python scripts/coverage_report.py
```

Check which models answer today before planning a run (prints status only, never keys):

```bash
research/.venv/Scripts/python research/scripts/probe_models.py
```

### Coverage policy

A VLM that answered under 50% of a test set goes to the appendix table of that leaderboard, since its numbers
cover a different, smaller sample. A judge that gives the same answer on 90% or more of its answers is marked
degenerate: its balanced accuracy is near 0.5 by construction. `results/coverage.md` lists both per model.

## Publish the dataset

The dataset lives on Hugging Face (`research/scripts/upload_dataset.py`, uses the cached `huggingface-cli login`).

To get a DOI from Zenodo:

1. Sign in to zenodo.org with GitHub and turn on the repository under Account, GitHub.
2. Make a GitHub release (for example `v1.1.0`). Zenodo archives the release and mints a DOI.
3. Add the DOI to `CITATION.cff` (`doi:`) and to the dataset card, then commit.

Zenodo keeps a copy of the repository at that release, including the committed traces and CSVs. The rendered
images are not in git, so they stay on Hugging Face only.

## Proposal, not done: move the attack images to Hugging Face

`research/results/attack/images` (87 files, 3.2 MB) is the only image set committed to git, and the same images
are already uploaded to the Hugging Face dataset under `attack/`. Moving them would mean: delete them from git,
fetch them in `fetch_assets.py` when the website build needs them, and keep `summary.json` and `transfer.json`
in git. That saves 3 MB per clone, but the report and website would need a network fetch to rebuild. It also
does not shrink history unless the history is rewritten, which I would not do without a separate decision.
