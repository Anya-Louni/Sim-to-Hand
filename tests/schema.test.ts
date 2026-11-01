import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractJson, validateJudgement, validatePlan } from '../src/llm/schema.ts';

const cubes = ['red', 'blue', 'green'];
const good = {
  reasoning: 'Stack red on blue.',
  goal: [{ pred: 'on', a: 'red', b: 'blue' }],
  steps: [{ skill: 'move_to', target: 'red' }, { skill: 'grasp', object: 'red' }, { skill: 'lift' }, { skill: 'place', on: 'blue' }, { skill: 'release' }],
};

test('a valid plan passes', () => {
  const v = validatePlan(structuredClone(good), cubes);
  assert.deepEqual(v.errors, []);
  assert.equal(v.plan?.steps.length, 5);
});

test('zones are valid targets for move_to and place', () => {
  const p = { ...structuredClone(good), goal: [{ pred: 'in_zone', a: 'red', zone: 'red_zone' }] };
  p.steps[3] = { skill: 'place', on: 'red_zone' };
  assert.deepEqual(validatePlan(p, cubes).errors, []);
});

test('unknown names are rejected with the step index', () => {
  const p = structuredClone(good);
  p.steps[1] = { skill: 'grasp', object: 'purple' };
  p.goal[0] = { pred: 'on', a: 'red', b: 'yellow' };
  const v = validatePlan(p, cubes);
  assert.equal(v.plan, undefined);
  assert.ok(v.errors.some((e) => e.includes('step 1') && e.includes('purple')));
  assert.ok(v.errors.some((e) => e.includes('goal 0') && e.includes('yellow')));
});

test('a zone is not a cube: grasping a zone or stacking on one in a goal fails', () => {
  const p = structuredClone(good);
  p.steps[1] = { skill: 'grasp', object: 'red_zone' };
  assert.ok(validatePlan(p, cubes).errors.length > 0);
});

test('schema violations are rejected', () => {
  for (const bad of [
    { ...good, steps: [] },
    { ...good, steps: [{ skill: 'fly', target: 'red' }] },
    { ...good, steps: [{ skill: 'move_to' }] },
    { ...good, extra: 1 },
    { reasoning: 'x', steps: good.steps },
    { ...good, steps: [{ skill: 'move_to', target: 'red', joint_angles: [0, 1] }] },
  ]) {
    const v = validatePlan(bad, cubes);
    assert.equal(v.plan, undefined, JSON.stringify(bad));
    assert.ok(v.errors.length > 0);
  }
});

test('JSON is extracted from code fences and surrounding text', () => {
  assert.deepEqual(extractJson('```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Here you go: {"a": {"b": 2}} done'), { a: { b: 2 } });
  assert.throws(() => extractJson('no json here'));
});

test('judge output needs success and reason', () => {
  assert.equal(validateJudgement({ success: true, reason: 'stacked' }).success, true);
  assert.throws(() => validateJudgement({ success: 'yes', reason: 'x' }));
  assert.throws(() => validateJudgement({ success: true }));
});
