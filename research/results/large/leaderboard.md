Test set: data\large (400 samples). Sensor classifiers trained on 600 samples from other seeds, noise strength 1.0.

| Judge | Kind | Coverage | Balanced acc. | False-success | False-failure | No answer | ECE |
|---|---|---|---|---|---|---|---|
| sensor_gboost | sensor | all | 0.887 | 0.125 | 0.100 | 0.000 | 0.063 |
| sensor_logreg | sensor | all | 0.885 | 0.110 | 0.120 | 0.000 | 0.043 |
| fusion: gemini/gemini-3.1-flash-lite (single) + sensors | fusion | 150/400 | 0.880 | 0.107 | 0.133 | 0.000 | 0.055 |
| gemini/gemini-3.1-flash-lite (single) | vlm | 150/400 | 0.553 | 0.533 | 0.360 | 0.000 | 0.446 |
| ollama/moondream:1.8b (single) | vlm | 8/400 | 0.500 | 1.000 | 0.000 | 0.000 | 0.172 |

Balanced accuracy by task:

| Judge | stack | grasp | button | peg | push |
|---|---|---|---|---|---|
| sensor_gboost | 1.000 | 1.000 | 0.975 | 1.000 | 0.463 |
| sensor_logreg | 0.938 | 1.000 | 1.000 | 0.988 | 0.500 |
| fusion: gemini/gemini-3.1-flash-lite (single) + sensors | 0.967 | 1.000 | 0.933 | 1.000 | 0.500 |
| gemini/gemini-3.1-flash-lite (single) | 0.500 | 0.667 | 0.567 | 0.600 | 0.433 |
| ollama/moondream:1.8b (single) | - | 0.500 | 0.500 | 0.500 | 0.500 |

False-success rate by task:

| Judge | stack | grasp | button | peg | push |
|---|---|---|---|---|---|
| sensor_gboost | 0.000 | 0.000 | 0.050 | 0.000 | 0.575 |
| sensor_logreg | 0.025 | 0.000 | 0.000 | 0.025 | 0.500 |
| fusion: gemini/gemini-3.1-flash-lite (single) + sensors | 0.067 | 0.000 | 0.133 | 0.000 | 0.333 |
| gemini/gemini-3.1-flash-lite (single) | 1.000 | 0.600 | 0.733 | 0.067 | 0.267 |
| ollama/moondream:1.8b (single) | - | 1.000 | 1.000 | 1.000 | 1.000 |

Sensor classifier, leave one task out (logistic regression):

| Held-out task | Balanced acc. | False-success |
|---|---|---|
| stack | 0.500 | 1.000 |
| grasp | 1.000 | 0.000 |
| button | 0.662 | 0.675 |
| peg | 0.500 | 1.000 |
| push | 0.500 | 0.000 |

Sensor noise sweep (logistic regression, trained and tested at the same strength):

| Strength | Balanced acc. | False-success |
|---|---|---|
| 0 | 0.973 | 0.025 |
| 0.5 | 0.897 | 0.095 |
| 1 | 0.885 | 0.110 |
| 2 | 0.820 | 0.180 |
| 4 | 0.743 | 0.195 |
| 8 | 0.657 | 0.315 |
| 16 | 0.605 | 0.410 |
| 32 | 0.495 | 0.535 |
