// Each skill on a fixed seed, plus the failures the executor must report.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOVER_Z, randomScene } from '../src/core/scene.ts';
import { DEFAULT_CHAOS, Executor } from '../src/core/skills.ts';
import { verifyGoals } from '../src/core/verify.ts';
import { clock, makeSim } from './helpers.ts';

async function setup(seed = 2) {
  const sim = await makeSim(randomScene(seed, ['red', 'blue', 'green']));
  const ex = new Executor(sim, clock, { ...DEFAULT_CHAOS, seed });
  return { sim, ex };
}

test('move_to, grasp, lift, place, release stack red on blue', async () => {
  const { sim, ex } = await setup();
  let r = await ex.run({ skill: 'move_to', target: 'red' });
  assert.ok(r.ok, r.error);
  const g = sim.gripPos();
  const red = sim.cube('red').pos;
  assert.ok(Math.hypot(g[0] - red[0], g[1] - red[1]) < 0.01, 'gripper above the cube');
  assert.ok(Math.abs(g[2] - HOVER_Z) < 0.02, 'gripper at hover height');

  r = await ex.run({ skill: 'grasp', object: 'red' });
  assert.ok(r.ok, r.error);
  assert.equal(ex.holding, 'red');
  assert.deepEqual(ex.sensorEvents.map((e) => [e.check, e.ok]), [['grasp', true]]);

  r = await ex.run({ skill: 'lift' });
  assert.ok(r.ok, r.error);
  assert.ok(sim.cube('red').pos[2] > 0.15, 'cube lifted');

  r = await ex.run({ skill: 'place', on: 'blue' });
  assert.ok(r.ok, r.error);
  assert.ok(ex.sensorEvents.some((e) => e.check === 'contact' && e.ok), 'placement contact felt');

  r = await ex.run({ skill: 'release' });
  assert.ok(r.ok, r.error);
  assert.equal(ex.holding, null);
  await ex.retreat();
  assert.equal(verifyGoals(sim, [{ pred: 'on', a: 'red', b: 'blue' }]).ok, true);
  sim.dispose();
});

test('bad requests fail with a clear error', async () => {
  const { sim, ex } = await setup();
  assert.match((await ex.run({ skill: 'move_to', target: 'purple' })).error!, /Unknown target/);
  assert.match((await ex.run({ skill: 'lift' })).error!, /not holding/);
  assert.match((await ex.run({ skill: 'place', on: 'blue' })).error!, /not holding/);
  await ex.run({ skill: 'move_to', target: 'red' });
  await ex.run({ skill: 'grasp', object: 'red' });
  assert.match((await ex.run({ skill: 'grasp', object: 'blue' })).error!, /Already holding/);
  assert.match((await ex.run({ skill: 'place', on: 'red' })).error!, /on itself/);
  sim.dispose();
});

test('a slip while carrying is caught by the sensors', async () => {
  const { sim, ex } = await setup();
  ex.inject = 'slip';
  for (const s of [{ skill: 'move_to', target: 'red' }, { skill: 'grasp', object: 'red' }, { skill: 'lift' }] as const) assert.ok((await ex.run(s)).ok);
  const r = await ex.run({ skill: 'place', on: 'blue' });
  assert.equal(r.ok, false);
  assert.match(r.error!, /Sensors lost the red cube/);
  assert.ok(ex.injected?.startsWith('slip'));
  assert.ok(ex.sensorEvents.some((e) => e.check === 'hold' && !e.ok));
  sim.dispose();
});

test('a moved target is caught as missing contact', async () => {
  const { sim, ex } = await setup();
  ex.inject = 'displace';
  for (const s of [{ skill: 'move_to', target: 'red' }, { skill: 'grasp', object: 'red' }, { skill: 'lift' }] as const) assert.ok((await ex.run(s)).ok);
  const r = await ex.run({ skill: 'place', on: 'blue' });
  assert.equal(r.ok, false);
  assert.match(r.error!, /No contact felt/);
  sim.dispose();
});

test('with sensing off the same slip goes unnoticed', async () => {
  const { sim, ex } = await setup();
  ex.sensing = false;
  ex.inject = 'slip';
  for (const s of [{ skill: 'move_to', target: 'red' }, { skill: 'grasp', object: 'red' }, { skill: 'lift' }, { skill: 'place', on: 'blue' }, { skill: 'release' }] as const) {
    assert.ok((await ex.run(s)).ok);
  }
  await ex.retreat();
  assert.equal(verifyGoals(sim, [{ pred: 'on', a: 'red', b: 'blue' }]).ok, false);
  sim.dispose();
});

test('the same seed gives the same final state', async () => {
  const end = async () => {
    const { sim, ex } = await setup(3);
    for (const s of [{ skill: 'move_to', target: 'green' }, { skill: 'grasp', object: 'green' }, { skill: 'lift' }, { skill: 'place', on: 'red_zone' }, { skill: 'release' }] as const) await ex.run(s);
    const p = sim.cube('green').pos;
    sim.dispose();
    return p;
  };
  assert.deepEqual(await end(), await end());
});
