Test set: data/small (100 samples). Sensor classifiers trained on 600 samples from other seeds, noise strength 1.0.

| Judge | Kind | Coverage | Balanced acc. | False-success | False-failure | No answer | ECE |
|---|---|---|---|---|---|---|---|
| fusion: gemini/gemma-4-31b-it (single) + sensors | fusion | 83/100 | 0.870 [0.79, 0.94] | 0.075 [0.00, 0.17] | 0.186 | 0.000 | 0.102 |
| sensor_logreg | sensor | all | 0.860 [0.78, 0.93] | 0.140 [0.06, 0.24] | 0.140 | 0.000 | 0.056 |
| sensor_gboost | sensor | all | 0.860 [0.78, 0.93] | 0.120 [0.04, 0.22] | 0.160 | 0.000 | 0.101 |
| fusion: ollama/moondream:1.8b (single) + sensors | fusion | 100/100 | 0.860 [0.79, 0.93] | 0.080 [0.02, 0.16] | 0.200 | 0.000 | 0.096 |
| fusion: gemini/gemini-3.1-flash-lite (multi) + sensors | fusion | 57/100 | 0.859 [0.76, 0.95] | 0.103 [0.00, 0.21] | 0.179 | 0.000 | 0.120 |
| fusion: gemini/gemini-3.1-flash-lite (single) + sensors | fusion | 100/100 | 0.850 [0.77, 0.92] | 0.080 [0.02, 0.16] | 0.220 | 0.000 | 0.131 |
| fusion: ollama/qwen2.5vl:3b (single) + sensors | fusion | 100/100 | 0.850 [0.77, 0.92] | 0.100 [0.02, 0.18] | 0.200 | 0.000 | 0.099 |
| fusion: groq/qwen/qwen3.8-27b (single) + sensors | fusion | 93/100 | 0.838 [0.75, 0.91] | 0.106 [0.02, 0.19] | 0.217 | 0.000 | 0.109 |
| gemini/gemini-3.1-flash-lite (multi) | vlm | 57/100 | 0.651 [0.55, 0.74] | 0.448 [0.28, 0.62] | 0.250 | 0.000 | 0.351 |
| gemini/gemini-3.1-flash-lite (single) | vlm | 100/100 | 0.600 [0.54, 0.66] | 0.460 [0.32, 0.60] | 0.340 | 0.000 | 0.400 |
| groq/qwen/qwen3.8-27b (single) | vlm | 93/100 | 0.570 [0.49, 0.65] | 0.426 [0.28, 0.57] | 0.435 | 0.000 | 0.362 |
| gemini/gemma-4-31b-it (single) | vlm | 83/100 | 0.557 [0.48, 0.64] | 0.375 [0.23, 0.53] | 0.512 | 0.000 | 0.419 |
| ollama/moondream:1.8b (single) | vlm (degenerate: says success on 100%) | 100/100 | 0.500 [0.50, 0.50] | 1.000 [1.00, 1.00] | 0.000 | 0.000 | 0.228 |
| ollama/qwen2.5vl:3b (single) | vlm (degenerate: says success on 100%) | 100/100 | 0.500 [0.50, 0.50] | 1.000 [1.00, 1.00] | 0.000 | 0.000 | 0.444 |

Appendix: judges that answered under 50% of this test set (quota cuts). Their numbers cover a different, smaller sample and are not comparable with the table above.

| Judge | Kind | Coverage | Balanced acc. | False-success | False-failure | No answer | ECE |
|---|---|---|---|---|---|---|---|
| fusion: gemini/gemini-3.5-flash (single) + sensors | fusion | 41/100 | 0.781 [0.65, 0.90] | 0.238 [0.10, 0.43] | 0.200 | 0.000 | 0.176 |
| gemini/gemini-3.5-flash (single) | vlm | 41/100 | 0.613 [0.48, 0.74] | 0.524 [0.29, 0.76] | 0.250 | 0.000 | 0.343 |
| gemini/gemma-4-31b-it (multi) | vlm | 9/100 | 0.550 [0.30, 0.80] | 0.400 [0.00, 0.80] | 0.500 | 0.000 | 0.428 |

Brackets: 95% bootstrap intervals, resampling minimal pairs (2,000 resamples, seed 0).

Paired test, each VLM vs sensor_logreg on the samples the VLM answered (McNemar; exact below 25 discordant samples):

| VLM | Shared samples | Only VLM right | Only sensors right | p | Test |
|---|---|---|---|---|---|
| gemini/gemini-3.1-flash-lite (multi) | 57 | 4 | 16 | 0.012 | exact |
| gemini/gemini-3.5-flash (single) | 41 | 3 | 12 | 0.035 | exact |
| gemini/gemini-3.1-flash-lite (single) | 100 | 8 | 34 | <0.001 | chi2_cc |
| groq/qwen/qwen3.8-27b (single) | 93 | 5 | 32 | <0.001 | chi2_cc |
| gemini/gemma-4-31b-it (single) | 83 | 7 | 33 | <0.001 | chi2_cc |
| gemini/gemma-4-31b-it (multi) | 9 | 1 | 3 | 0.625 | exact |
| ollama/moondream:1.8b (single) | 100 | 7 | 43 | <0.001 | chi2_cc |
| ollama/qwen2.5vl:3b (single) | 100 | 7 | 43 | <0.001 | chi2_cc |

Balanced accuracy by task:

| Judge | stack | grasp | button | peg | push |
|---|---|---|---|---|---|
| fusion: gemini/gemma-4-31b-it (single) + sensors | 0.944 | 1.000 | 0.938 | 0.950 | 0.417 |
| sensor_logreg | 1.000 | 1.000 | 0.950 | 0.950 | 0.400 |
| sensor_gboost | 1.000 | 1.000 | 0.950 | 0.950 | 0.400 |
| fusion: ollama/moondream:1.8b (single) + sensors | 0.950 | 1.000 | 0.950 | 0.950 | 0.450 |
| fusion: gemini/gemini-3.1-flash-lite (multi) + sensors | 0.800 | 1.000 | 1.000 | 1.000 | 0.417 |
| fusion: gemini/gemini-3.1-flash-lite (single) + sensors | 0.900 | 1.000 | 0.950 | 0.950 | 0.450 |
| fusion: ollama/qwen2.5vl:3b (single) + sensors | 0.950 | 1.000 | 0.950 | 0.950 | 0.400 |
| fusion: groq/qwen/qwen3.8-27b (single) + sensors | 0.833 | 1.000 | 0.950 | 0.944 | 0.444 |
| fusion: gemini/gemini-3.5-flash (single) + sensors | 0.750 | 1.000 | 0.900 | 0.875 | 0.375 |
| gemini/gemini-3.1-flash-lite (multi) | 0.600 | 1.000 | 0.583 | 0.583 | 0.500 |
| gemini/gemini-3.5-flash (single) | 0.500 | 0.875 | 0.675 | 0.500 | 0.500 |
| gemini/gemini-3.1-flash-lite (single) | 0.500 | 0.950 | 0.500 | 0.550 | 0.500 |
| groq/qwen/qwen3.8-27b (single) | 0.389 | 0.900 | 0.600 | 0.500 | 0.444 |
| gemini/gemma-4-31b-it (single) | 0.433 | 0.833 | 0.549 | 0.500 | 0.452 |
| gemini/gemma-4-31b-it (multi) | - | 1.000 | 0.500 | 0.500 | 0.500 |
| ollama/moondream:1.8b (single) | 0.500 | 0.500 | 0.500 | 0.500 | 0.500 |
| ollama/qwen2.5vl:3b (single) | 0.500 | 0.500 | 0.500 | 0.500 | 0.500 |

False-success rate by task:

| Judge | stack | grasp | button | peg | push |
|---|---|---|---|---|---|
| fusion: gemini/gemma-4-31b-it (single) + sensors | 0.000 | 0.000 | 0.125 | 0.100 | 0.167 |
| sensor_logreg | 0.000 | 0.000 | 0.100 | 0.100 | 0.500 |
| sensor_gboost | 0.000 | 0.000 | 0.100 | 0.100 | 0.400 |
| fusion: ollama/moondream:1.8b (single) + sensors | 0.000 | 0.000 | 0.100 | 0.100 | 0.200 |
| fusion: gemini/gemini-3.1-flash-lite (multi) + sensors | 0.400 | 0.000 | 0.000 | 0.000 | 0.167 |
| fusion: gemini/gemini-3.1-flash-lite (single) + sensors | 0.000 | 0.000 | 0.100 | 0.100 | 0.200 |
| fusion: ollama/qwen2.5vl:3b (single) + sensors | 0.000 | 0.000 | 0.100 | 0.100 | 0.300 |
| fusion: groq/qwen/qwen3.8-27b (single) + sensors | 0.111 | 0.000 | 0.100 | 0.111 | 0.222 |
| fusion: gemini/gemini-3.5-flash (single) + sensors | 0.500 | 0.000 | 0.200 | 0.250 | 0.250 |
| gemini/gemini-3.1-flash-lite (multi) | 0.800 | 0.000 | 0.500 | 0.000 | 1.000 |
| gemini/gemini-3.5-flash (single) | 1.000 | 0.250 | 0.400 | 0.250 | 0.750 |
| gemini/gemini-3.1-flash-lite (single) | 1.000 | 0.100 | 0.900 | 0.000 | 0.300 |
| groq/qwen/qwen3.8-27b (single) | 0.556 | 0.200 | 0.800 | 0.000 | 0.556 |
| gemini/gemma-4-31b-it (single) | 0.800 | 0.333 | 0.125 | 0.000 | 0.667 |
| gemini/gemma-4-31b-it (multi) | 1.000 | 0.000 | 0.000 | 0.000 | 1.000 |
| ollama/moondream:1.8b (single) | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |
| ollama/qwen2.5vl:3b (single) | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |

Sensor classifier, leave one task out (logistic regression):

| Held-out task | Balanced acc. | False-success |
|---|---|---|
| stack | 0.500 [0.50, 0.50] | 1.000 [1.00, 1.00] |
| grasp | 1.000 [1.00, 1.00] | 0.000 [0.00, 0.00] |
| button | 0.500 [0.35, 0.65] | 0.800 [0.50, 1.00] |
| peg | 0.500 [0.50, 0.50] | 1.000 [1.00, 1.00] |
| push | 0.500 [0.50, 0.50] | 0.000 [0.00, 0.00] |

Sensor noise sweep (logistic regression, trained and tested at the same strength):

| Strength | Balanced acc. | False-success |
|---|---|---|
| 0 | 0.990 [0.97, 1.00] | 0.000 [0.00, 0.00] |
| 0.5 | 0.900 [0.83, 0.96] | 0.060 [0.00, 0.14] |
| 1 | 0.860 [0.78, 0.93] | 0.140 [0.06, 0.24] |
| 2 | 0.790 [0.71, 0.87] | 0.200 [0.10, 0.32] |
| 4 | 0.780 [0.70, 0.85] | 0.220 [0.12, 0.34] |
| 8 | 0.670 [0.57, 0.76] | 0.260 [0.14, 0.38] |
| 16 | 0.560 [0.46, 0.66] | 0.400 [0.26, 0.54] |
| 32 | 0.540 [0.44, 0.63] | 0.500 [0.36, 0.62] |
