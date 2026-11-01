Test set: data\small (100 samples). Sensor classifiers trained on 600 samples from other seeds, noise strength 1.0.

| Judge | Kind | Coverage | Balanced acc. | False-success | False-failure | No answer | ECE |
|---|---|---|---|---|---|---|---|
| fusion: gemini/gemma-4-31b-it (single) + sensors | fusion | 83/100 | 0.870 | 0.075 | 0.186 | 0.000 | 0.102 |
| sensor_logreg | sensor | all | 0.860 | 0.140 | 0.140 | 0.000 | 0.056 |
| sensor_gboost | sensor | all | 0.860 | 0.120 | 0.160 | 0.000 | 0.101 |
| fusion: ollama/moondream:1.8b (single) + sensors | fusion | 100/100 | 0.860 | 0.080 | 0.200 | 0.000 | 0.096 |
| fusion: gemini/gemini-3.1-flash-lite (multi) + sensors | fusion | 57/100 | 0.859 | 0.103 | 0.179 | 0.000 | 0.120 |
| fusion: gemini/gemini-3.1-flash-lite (single) + sensors | fusion | 100/100 | 0.850 | 0.080 | 0.220 | 0.000 | 0.131 |
| fusion: ollama/qwen2.5vl:3b (single) + sensors | fusion | 100/100 | 0.850 | 0.100 | 0.200 | 0.000 | 0.099 |
| fusion: groq/qwen/qwen3.8-27b (single) + sensors | fusion | 93/100 | 0.838 | 0.106 | 0.217 | 0.000 | 0.109 |
| fusion: gemini/gemini-3.5-flash (single) + sensors | fusion | 41/100 | 0.781 | 0.238 | 0.200 | 0.000 | 0.176 |
| gemini/gemini-3.1-flash-lite (multi) | vlm | 57/100 | 0.651 | 0.448 | 0.250 | 0.000 | 0.351 |
| gemini/gemini-3.5-flash (single) | vlm | 41/100 | 0.613 | 0.524 | 0.250 | 0.000 | 0.343 |
| gemini/gemini-3.1-flash-lite (single) | vlm | 100/100 | 0.600 | 0.460 | 0.340 | 0.000 | 0.400 |
| groq/qwen/qwen3.8-27b (single) | vlm | 93/100 | 0.570 | 0.425 | 0.435 | 0.000 | 0.362 |
| gemini/gemma-4-31b-it (single) | vlm | 83/100 | 0.557 | 0.375 | 0.512 | 0.000 | 0.419 |
| gemini/gemma-4-31b-it (multi) | vlm | 9/100 | 0.550 | 0.400 | 0.500 | 0.000 | 0.428 |
| ollama/moondream:1.8b (single) | vlm | 100/100 | 0.500 | 1.000 | 0.000 | 0.000 | 0.228 |
| ollama/qwen2.5vl:3b (single) | vlm | 100/100 | 0.500 | 1.000 | 0.000 | 0.000 | 0.444 |

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
| stack | 0.500 | 1.000 |
| grasp | 1.000 | 0.000 |
| button | 0.500 | 0.800 |
| peg | 0.500 | 1.000 |
| push | 0.500 | 0.000 |

Sensor noise sweep (logistic regression, trained and tested at the same strength):

| Strength | Balanced acc. | False-success |
|---|---|---|
| 0 | 0.990 | 0.000 |
| 0.5 | 0.900 | 0.060 |
| 1 | 0.860 | 0.140 |
| 2 | 0.790 | 0.200 |
| 4 | 0.780 | 0.220 |
| 8 | 0.670 | 0.260 |
| 16 | 0.560 | 0.400 |
| 32 | 0.540 | 0.500 |
