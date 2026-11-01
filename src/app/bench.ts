import { runEpisode, type EpisodeResult } from '../core/agent.ts';
import { DEFAULT_CHAOS } from '../core/skills.ts';
import { BENCHMARK } from '../core/tasks.ts';
import { llmJudge, llmPlanner, scriptedPlanner } from '../llm/planner.ts';
import { makeTransport } from './transport.ts';
import { World } from './world.ts';

export interface BenchConfig {
  ids?: string[];
  chaos: boolean;
  planner: 'llm' | 'scripted';
  vision: boolean;
  maxReplans: number;
}

export interface BenchRow extends EpisodeResult {
  id: string;
  kind: string;
  chaos: boolean;
  wallSeconds: number;
  error?: string;
}

const log = document.getElementById('log')!;
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const transport = makeTransport(() => ({}), 3);
let world: World | null = null;

async function runBench(cfg: BenchConfig): Promise<BenchRow[]> {
  const tasks = BENCHMARK.filter((t) => !cfg.ids || cfg.ids.includes(t.id));
  world ??= await World.create(document.getElementById('scene') as HTMLCanvasElement, tasks[0].scene);
  const w = world;
  const rows: BenchRow[] = [];
  for (const task of tasks) {
    w.load(task.scene);
    const t0 = performance.now();
    let row: BenchRow;
    try {
      const result = await runEpisode(
        {
          sim: w.sim,
          clock: { realtime: false, frame: () => new Promise((r) => setTimeout(() => r(performance.now()), 0)) },
          planner: cfg.planner === 'llm' ? llmPlanner(transport) : scriptedPlanner(task.goal),
          judge: cfg.vision ? llmJudge(transport) : null,
          snapshot: async () => {
            w.renderer.sync(w.sim, false);
            return w.renderer.snapshot();
          },
          emit: (e) => {
            if (e.type === 'chaos' || e.type === 'replan' || e.type === 'plan_error') log.textContent += `\n  ${task.id} ${e.type}: ${'message' in e ? e.message : e.reason}`;
          },
        },
        { instruction: task.instruction, goal: task.goal, maxReplans: cfg.maxReplans, chaos: { ...DEFAULT_CHAOS, enabled: cfg.chaos, seed: hash(task.id) } },
      );
      row = { ...result, id: task.id, kind: task.kind, chaos: cfg.chaos, wallSeconds: (performance.now() - t0) / 1000 };
    } catch (e) {
      row = {
        id: task.id, kind: task.kind, chaos: cfg.chaos, wallSeconds: (performance.now() - t0) / 1000, error: (e as Error).message,
        success: false, attempts: 0, replans: 0, visionChecks: 0, visionAgreements: 0, sensorChecks: 0, sensorAgreements: 0, disagreements: [], llmCalls: 0, chaosEvents: 0, simSeconds: 0, planner: cfg.planner, providers: [],
      };
    }
    rows.push(row);
    log.textContent += `\n${task.id} ${row.success ? 'OK' : 'FAIL'} attempts=${row.attempts} vision=${row.visionAgreements}/${row.visionChecks} ${row.failure ?? row.error ?? ''}`;
  }
  return rows;
}

(window as unknown as { runBench: typeof runBench }).runBench = runBench;
