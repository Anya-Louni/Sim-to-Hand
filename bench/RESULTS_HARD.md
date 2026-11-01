Hard suite (A6): hand-written goals; for impossible tasks the right answer is a refusal. Brackets are 95% Wilson confidence intervals.

| Condition | Tasks | Correct | relational | reorder | impossible | distractor | Refused a possible task | Acted on an impossible task | LLM calls |
|---|---|---|---|---|---|---|---|---|---|
| scripted | 20 | 19/20 = 95% [76, 99] | 5/5 | 4/5 | 5/5 | 5/5 | 0/15 | 0/5 | 0 |
| scripted-chaos | 20 | 19/20 = 95% [76, 99] | 5/5 | 4/5 | 5/5 | 5/5 | 0/15 | 0/5 | 0 |
| llm | 20 | 19/20 = 95% [76, 99] | 5/5 | 4/5 | 5/5 | 5/5 | 0/15 | 0/5 | 44 |
| llm-chaos | 20 | 18/20 = 90% [70, 97] | 4/5 | 4/5 | 5/5 | 5/5 | 0/15 | 0/5 | 55 |

Wrong answers (5):

- scripted ord-05: step 4 place(blue) failed: No contact felt when lowering the yellow cube onto blue. Goal check: yellow is not on blue (offset 1.1 cm, height diff 10.0 cm); red is not on yellow (offset 1.1 cm, height diff -5.0 cm)
- scripted-chaos ord-05: step 3 lift() failed: Sensors lost the yellow cube during lift: fingertip switches went off. Goal check: yellow is not on blue (offset 21.6 cm, height diff 0.0 cm); red is not on yellow (offset 21.6 cm, height diff 5.0 cm)
- llm ord-02: step 4 place(red_zone) failed: No contact felt when lowering the blue cube onto red_zone. Goal check: red is not on green (offset 10.5 cm, height diff 0.0 cm); blue is not on red (offset 8.0 cm, height diff -0.0 cm)
- llm-chaos rel-02: planner error: plan failed schema validation twice: goal and steps must not be empty unless you refuse
- llm-chaos ord-02: step 4 move_to(blue_zone) failed: Sensors lost the blue cube while moving to blue_zone: fingertip switches went off. Goal check: red is not on green (offset 11.5 cm, height diff -0.0 cm); blue is not on red (offset 17.1 cm, height diff 0.0 cm)

Refusals (20):

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
- llm imp-01: "The purple cube does not exist in the scene."
- llm imp-02: "The yellow cube does not exist in the scene."
- llm imp-03: "A cube cannot be placed on top of itself."
- llm imp-04: "The orange zone does not exist."
- llm imp-05: "The goal contains contradictory conditions (red on blue and blue on red simultaneously) which are impossible to achieve."
- llm-chaos imp-01: "The purple cube does not exist in the scene."
- llm-chaos imp-02: "The yellow cube does not exist in the scene."
- llm-chaos imp-03: "A cube cannot be placed on top of itself."
- llm-chaos imp-04: "The orange zone does not exist."
- llm-chaos imp-05: "The goal contains contradictory conditions (red on blue and blue on red simultaneously) which are impossible to achieve."
