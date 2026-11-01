#!/bin/sh
# Rebuilds every result from scratch. Cached VLM answers in cache/ are reused; delete cache/ to re-query.
# Free-tier quotas mean a full fresh run takes several days of resumable runs (rerun this script; it skips finished work).
set -e
export PYTHONPATH=.
PY=${PY:-python}
$PY scripts/fetch_assets.py
$PY -m vcf.generate --pairs 10 --seed 0 --out data/small
$PY -m vcf.generate --pairs 40 --seed 3 --out data/large
$PY -m vcf.generate --pairs 30 --seed 1 --out data/sensor_train_s1 --no-images
$PY -m vcf.generate --pairs 30 --seed 2 --out data/sensor_train_s2 --no-images
for m in gemini/gemini-3.5-flash gemini/gemini-3.1-flash-lite gemini/gemma-4-31b-it groq/qwen/qwen3.8-27b; do
  $PY -m vcf.judge data/small $m --min-interval 4 || true
done
for m in ollama/moondream:1.8b ollama/qwen2.5vl:3b; do $PY -m vcf.judge data/small $m --views single || true; done
for m in gemini/gemini-3.1-flash-lite gemini/gemma-4-31b-it ollama/moondream:1.8b; do $PY -m vcf.judge data/large $m --views single --min-interval 4 || true; done
$PY -m vcf.evaluate --test data/small --out results/small
$PY -m vcf.evaluate --test data/large --out results/large
$PY -m vcf.attack --models gemini/gemini-3.1-flash-lite,ollama/moondream:1.8b --scenes 2 --llm-steps 4 --out results/attack
$PY scripts/export_site.py
