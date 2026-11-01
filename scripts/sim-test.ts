// Headless check that the executor can stack cubes. Run: npm run test:sim
import loadMujoco from '@mujoco/mujoco';
import fs from 'node:fs';
import path from 'node:path';
import { randomScene } from '../src/core/scene.ts';
import { Sim } from '../src/core/sim.ts';
import { Executor, DEFAULT_CHAOS } from '../src/core/skills.ts';
import { scriptedPlan } from '../src/core/scripted.ts';
import { verifyGoals } from '../src/core/verify.ts';
import type { Color, Goal } from '../src/core/types.ts';

const mj = await loadMujoco();
const dir = 'public/models';
const files: Record<string, Uint8Array> = { 'panda.xml': new Uint8Array(fs.readFileSync(path.join(dir, 'panda.xml'))) };
for (const f of fs.readdirSync(path.join(dir, 'assets'))) files['assets/' + f] = new Uint8Array(fs.readFileSync(path.join(dir, 'assets', f)));

const clock = { realtime: false, frame: async () => 0 };
const cases: { colors: Color[]; goal: Goal[] }[] = [
  { colors: ['red', 'blue', 'green'], goal: [{ pred: 'on', a: 'red', b: 'blue' }] },
  { colors: ['red', 'blue', 'green'], goal: [{ pred: 'on', a: 'green', b: 'blue' }, { pred: 'on', a: 'red', b: 'green' }] },
  { colors: ['red', 'blue', 'green'], goal: ['red', 'green', 'blue'].map((c) => ({ pred: 'in_zone', a: c, zone: c + '_zone' }) as Goal) },
];
let pass = 0;
const seeds = Number(process.argv[2] ?? 3);
for (let seed = 1; seed <= seeds; seed++) {
  for (const tc of cases) {
    const t0 = Date.now();
    const sim = new Sim(mj, files, randomScene(seed, tc.colors));
    const ex = new Executor(sim, clock, DEFAULT_CHAOS);
    let err = '';
    for (const step of scriptedPlan(tc.goal).steps) {
      const r = await ex.run(step);
      if (!r.ok) {
        err = r.error!;
        break;
      }
    }
    await ex.retreat();
    const v = verifyGoals(sim, tc.goal);
    if (v.ok) pass++;
    console.log(`seed ${seed} ${JSON.stringify(tc.goal.map((g) => Object.values(g).join(':')))} ${v.ok ? 'OK' : 'FAIL'} ${err} ${v.ok ? '' : v.summary} (${sim.time.toFixed(1)}s sim, ${Date.now() - t0}ms wall)`);
    sim.dispose();
  }
}
console.log(`${pass}/${seeds * cases.length} passed`);
process.exit(pass === seeds * cases.length ? 0 : 1);
