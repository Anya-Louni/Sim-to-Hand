Brackets are 95% Wilson confidence intervals.

| Condition | Tasks | Success | Avg replans | Avg chaos events | Vision agrees with sim | Sensors agree with sim | LLM calls |
|---|---|---|---|---|---|---|---|
| scripted | 24 | 24/24 = 100% [86, 100] | 0.00 | 0.00 | not run | 24/24 = 100% [86, 100] | 0 |
| scripted-chaos | 24 | 21/24 = 88% [69, 96] | 0.88 | 2.17 | not run | 43/45 = 96% [85, 99] | 0 |
| llm | 24 | 24/24 = 100% [86, 100] | 0.00 | 0.00 | 24/24 = 100% [86, 100] | not run | 48 |
| llm-chaos | 24 | 22/24 = 92% [74, 98] | 0.88 | 2.17 | 45/45 = 100% [92, 100] | not run | 90 |

Per-kind success:

| Condition | stack | tower | sort | zone |
|---|---|---|---|---|
| scripted | 9/9 | 6/6 | 4/4 | 5/5 |
| scripted-chaos | 9/9 | 3/6 | 4/4 | 5/5 |
| llm | 9/9 | 6/6 | 4/4 | 5/5 |
| llm-chaos | 9/9 | 4/6 | 4/4 | 5/5 |

Calls by provider: gemini/gemini-3.1-flash-lite 117, gemini/gemini-3.5-flash-lite 20, groq/openai/gpt-oss-120b 1

Vision disagreements (0):

none

Failures (5):

- scripted-chaos tower-02: Plan finished but goal not met: red is not on green (offset 5.4 cm, height diff -0.0 cm)
- scripted-chaos tower-03: step 3 lift() failed: Sensors lost the yellow cube during lift: fingertip switches went off. Goal check: yellow is not on red (offset 31.4 cm, height diff 0.0 cm); blue is not on yellow (offset 14.6 cm, height diff 0.0 cm)
- scripted-chaos tower-06: step 4 place(green) failed: Sensors lost the red cube while carrying it to green: fingertip switches went off. Goal check: red is not on green (offset 6.3 cm, height diff -0.0 cm); blue is not on red (offset 27.8 cm, height diff 0.0 cm)
- llm-chaos tower-03: step 3 lift() failed: The red cube slipped out of the gripper during lift. Goal check: yellow is not on red (offset 31.7 cm, height diff 0.0 cm); blue is not on yellow (offset 13.0 cm, height diff -0.0 cm)
- llm-chaos tower-06: step 4 place(green_zone) failed: The green cube slipped out of the gripper while carrying it to green_zone. Goal check: red is not on green (offset 30.4 cm, height diff 0.0 cm); blue is not on red (offset 12.7 cm, height diff -0.0 cm)
