// Live planner check against the configured provider. Run: node --experimental-strip-types scripts/plan-test.ts
import loadMujoco from '@mujoco/mujoco';
import fs from 'node:fs';
import path from 'node:path';
import { BENCHMARK } from '../src/core/tasks.ts';
import { Sim } from '../src/core/sim.ts';
import { describeScene } from '../src/core/verify.ts';
import { executeLLM } from '../src/llm/providers.ts';
import { llmPlanner } from '../src/llm/planner.ts';

process.loadEnvFile('.env');
const mj = await loadMujoco();
const dir = 'public/models';
const files: Record<string, Uint8Array> = { 'panda.xml': new Uint8Array(fs.readFileSync(path.join(dir, 'panda.xml'))) };
for (const f of fs.readdirSync(path.join(dir, 'assets'))) files['assets/' + f] = new Uint8Array(fs.readFileSync(path.join(dir, 'assets', f)));

const planner = llmPlanner((req) => executeLLM(req, { gemini: process.env.GEMINI_API_KEY, groq: process.env.GROQ_API_KEY }));
for (const id of (process.argv[2] ?? 'stack-01,tower-04,sort-02').split(',')) {
  const task = BENCHMARK.find((t) => t.id === id)!;
  const sim = new Sim(mj, files, task.scene);
  const t0 = Date.now();
  const out = await planner.plan({ instruction: task.instruction, scene: describeScene(sim, null), history: [], cubes: sim.cubeNames });
  console.log(id, out.provider, `${Date.now() - t0}ms`, JSON.stringify(out.plan.goal), out.plan.steps.length, 'steps');
  sim.dispose();
}
