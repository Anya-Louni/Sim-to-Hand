// Goal predicates checked against simulator state, with cubes placed by hand.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { CUBE_HALF, randomScene, ZONES } from '../src/core/scene.ts';
import { verifyGoals } from '../src/core/verify.ts';
import { makeSim } from './helpers.ts';

const sim = await makeSim(randomScene(1, ['red', 'blue', 'green']));
after(() => sim.dispose());
const H = CUBE_HALF;

test('on holds for a cube resting centered on another', () => {
  sim.teleport('blue', 0.45, 0.0, H);
  sim.teleport('red', 0.45, 0.0, 3 * H);
  assert.equal(verifyGoals(sim, [{ pred: 'on', a: 'red', b: 'blue' }]).ok, true);
  assert.equal(verifyGoals(sim, [{ pred: 'on', a: 'blue', b: 'red' }]).ok, false);
});

test('on fails with a large sideways offset or on the table', () => {
  sim.teleport('blue', 0.45, 0.0, H);
  sim.teleport('red', 0.45, 0.035, 3 * H);
  assert.equal(verifyGoals(sim, [{ pred: 'on', a: 'red', b: 'blue' }]).ok, false);
  sim.teleport('red', 0.45, 0.12, H);
  const v = verifyGoals(sim, [{ pred: 'on', a: 'red', b: 'blue' }]);
  assert.equal(v.ok, false);
  assert.match(v.summary, /red is not on blue/);
});

test('in_zone holds inside the square and fails outside it', () => {
  const z = ZONES[0];
  sim.teleport('green', z.x + z.half - 0.005, z.y, H);
  assert.equal(verifyGoals(sim, [{ pred: 'in_zone', a: 'green', zone: z.name }]).ok, true);
  sim.teleport('green', z.x + z.half + 0.005, z.y, H);
  assert.equal(verifyGoals(sim, [{ pred: 'in_zone', a: 'green', zone: z.name }]).ok, false);
});

test('all goals must hold, unknown names fail, an empty goal is not success', () => {
  sim.teleport('blue', 0.45, 0.0, H);
  sim.teleport('red', 0.45, 0.0, 3 * H);
  const z = ZONES[1];
  sim.teleport('green', z.x, z.y, H);
  assert.equal(verifyGoals(sim, [{ pred: 'on', a: 'red', b: 'blue' }, { pred: 'in_zone', a: 'green', zone: z.name }]).ok, true);
  assert.equal(verifyGoals(sim, [{ pred: 'on', a: 'red', b: 'blue' }, { pred: 'in_zone', a: 'green', zone: ZONES[2].name }]).ok, false);
  assert.equal(verifyGoals(sim, [{ pred: 'on', a: 'red', b: 'yellow' }]).ok, false);
  assert.equal(verifyGoals(sim, [{ pred: 'in_zone', a: 'red', zone: 'nowhere' }]).ok, false);
  assert.equal(verifyGoals(sim, []).ok, false);
});
