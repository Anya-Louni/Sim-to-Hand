Hard suite (A6): hand-written goals; for impossible tasks the right answer is a refusal. Brackets are 95% Wilson confidence intervals.

| Condition | Tasks | Correct | relational | reorder | impossible | distractor | Refused a possible task | Acted on an impossible task | LLM calls |
|---|---|---|---|---|---|---|---|---|---|
| scripted | 20 | 19/20 = 95% [76, 99] | 5/5 | 4/5 | 5/5 | 5/5 | 0/15 | 0/5 | 0 |
| scripted-chaos | 20 | 19/20 = 95% [76, 99] | 5/5 | 4/5 | 5/5 | 5/5 | 0/15 | 0/5 | 0 |

Wrong answers (2):

- scripted ord-05: step 4 place(blue) failed: No contact felt when lowering the yellow cube onto blue. Goal check: yellow is not on blue (offset 1.1 cm, height diff 10.0 cm); red is not on yellow (offset 1.1 cm, height diff -5.0 cm)
- scripted-chaos ord-05: step 3 lift() failed: Sensors lost the yellow cube during lift: fingertip switches went off. Goal check: yellow is not on blue (offset 21.6 cm, height diff 0.0 cm); red is not on yellow (offset 21.6 cm, height diff 5.0 cm)

Refusals (10):

- scripted imp-01: "no goal"
- scripted imp-02: "no goal"
- scripted imp-03: "no goal"
- scripted imp-04: "no goal"
- scripted imp-05: "no goal"
- scripted-chaos imp-01: "no goal"
- scripted-chaos imp-02: "no goal"
- scripted-chaos imp-03: "no goal"
- scripted-chaos imp-04: "no goal"
- scripted-chaos imp-05: "no goal"
