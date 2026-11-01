Test set: data/large (400 samples). Sensor classifiers trained on 600 samples from other seeds, noise strength 1.0.

| Judge | Kind | Coverage | Balanced acc. | False-success | False-failure | No answer | ECE |
|---|---|---|---|---|---|---|---|
| sensor_gboost | sensor | all | 0.888 [0.85, 0.92] | 0.125 [0.08, 0.17] | 0.100 | 0.000 | 0.063 |
| sensor_logreg | sensor | all | 0.885 [0.85, 0.92] | 0.110 [0.07, 0.16] | 0.120 | 0.000 | 0.043 |

Appendix: judges that answered under 50% of this test set (quota cuts). Their numbers cover a different, smaller sample and are not comparable with the table above.

| Judge | Kind | Coverage | Balanced acc. | False-success | False-failure | No answer | ECE |
|---|---|---|---|---|---|---|---|
| fusion: gemini/gemini-3.1-flash-lite (single) + sensors | fusion | 164/400 | 0.878 [0.82, 0.93] | 0.098 [0.04, 0.17] | 0.146 | 0.000 | 0.053 |
| gemini/gemini-3.1-flash-lite (single) | vlm | 164/400 | 0.549 [0.50, 0.60] | 0.537 [0.43, 0.65] | 0.366 | 0.000 | 0.450 |
| ollama/moondream:1.8b (single) | vlm (degenerate: says success on 100%) | 8/400 | 0.500 [0.50, 0.50] | 1.000 [1.00, 1.00] | 0.000 | 0.000 | 0.173 |

Brackets: 95% bootstrap intervals, resampling minimal pairs (2,000 resamples, seed 0).

Paired test, each VLM vs sensor_logreg on the samples the VLM answered (McNemar; exact below 25 discordant samples):

| VLM | Shared samples | Only VLM right | Only sensors right | p | Test |
|---|---|---|---|---|---|
| gemini/gemini-3.1-flash-lite (single) | 164 | 6 | 65 | <0.001 | chi2_cc |
| ollama/moondream:1.8b (single) | 8 | 0 | 3 | 0.250 | exact |

Balanced accuracy by task:

| Judge | stack | grasp | button | peg | push |
|---|---|---|---|---|---|
| sensor_gboost | 1.000 | 1.000 | 0.975 | 1.000 | 0.463 |
| sensor_logreg | 0.938 | 1.000 | 1.000 | 0.988 | 0.500 |
| fusion: gemini/gemini-3.1-flash-lite (single) + sensors | 0.969 | 1.000 | 0.941 | 1.000 | 0.469 |
| gemini/gemini-3.1-flash-lite (single) | 0.469 | 0.677 | 0.588 | 0.594 | 0.406 |
| ollama/moondream:1.8b (single) | - | 0.500 | 0.500 | 0.500 | 0.500 |

False-success rate by task:

| Judge | stack | grasp | button | peg | push |
|---|---|---|---|---|---|
| sensor_gboost | 0.000 | 0.000 | 0.050 | 0.000 | 0.575 |
| sensor_logreg | 0.025 | 0.000 | 0.000 | 0.025 | 0.500 |
| fusion: gemini/gemini-3.1-flash-lite (single) + sensors | 0.063 | 0.000 | 0.118 | 0.000 | 0.313 |
| gemini/gemini-3.1-flash-lite (single) | 1.000 | 0.588 | 0.706 | 0.063 | 0.313 |
| ollama/moondream:1.8b (single) | - | 1.000 | 1.000 | 1.000 | 1.000 |

Sensor classifier, leave one task out (logistic regression):

| Held-out task | Balanced acc. | False-success |
|---|---|---|
| stack | 0.500 [0.50, 0.50] | 1.000 [1.00, 1.00] |
| grasp | 1.000 [1.00, 1.00] | 0.000 [0.00, 0.00] |
| button | 0.663 [0.59, 0.74] | 0.675 [0.53, 0.83] |
| peg | 0.500 [0.50, 0.50] | 1.000 [1.00, 1.00] |
| push | 0.500 [0.50, 0.50] | 0.000 [0.00, 0.00] |

Sensor noise sweep (logistic regression, trained and tested at the same strength):

| Strength | Balanced acc. | False-success |
|---|---|---|
| 0 | 0.973 [0.96, 0.99] | 0.025 [0.01, 0.05] |
| 0.5 | 0.898 [0.87, 0.93] | 0.095 [0.06, 0.14] |
| 1 | 0.885 [0.85, 0.92] | 0.110 [0.07, 0.16] |
| 2 | 0.820 [0.78, 0.86] | 0.180 [0.13, 0.24] |
| 4 | 0.743 [0.70, 0.78] | 0.195 [0.14, 0.25] |
| 8 | 0.658 [0.61, 0.71] | 0.315 [0.25, 0.38] |
| 16 | 0.605 [0.56, 0.65] | 0.410 [0.34, 0.48] |
| 32 | 0.495 [0.45, 0.54] | 0.535 [0.47, 0.61] |
