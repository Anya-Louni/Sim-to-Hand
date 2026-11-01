import { runEpisode, type Decider, type Detector, type EpisodeResult } from '../core/agent.ts';
import { CUBE_HALF, HOVER_Z, mulberry32, randomScene, ZONES } from '../core/scene.ts';
import { DEFAULT_CHAOS, Executor, type Injection } from '../core/skills.ts';
import { BENCHMARK, generateTasks, HARD_BENCHMARK } from '../core/tasks.ts';
import type { CubePose } from '../core/sim.ts';
import type { Color, Skill, Task } from '../core/types.ts';
import { verifyGoals } from '../core/verify.ts';
import { llmJudge, llmPlanner, scriptedPlanner } from '../llm/planner.ts';
import { makeTransport } from './transport.ts';
import { World } from './world.ts';

export interface BenchConfig {
  ids?: string[];
  /** 'hard': the A6 suite (relational, reorder, impossible, distractor). Default: the main suite. */
  suite?: 'main' | 'hard';
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
  /** Hard suite: the task cannot be done, so a refusal is the right answer. */
  impossible?: boolean;
}

const log = document.getElementById('log')!;
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const transport = makeTransport(() => ({}), 3);
let world: World | null = null;

async function runBench(cfg: BenchConfig): Promise<BenchRow[]> {
  const tasks = (cfg.suite === 'hard' ? HARD_BENCHMARK : BENCHMARK).filter((t) => !cfg.ids || cfg.ids.includes(t.id));
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
    rows.push({ ...row, impossible: !!task.impossible });
    log.textContent += `\n${task.id} ${row.success ? 'OK' : 'FAIL'} attempts=${row.attempts} vision=${row.visionAgreements}/${row.visionChecks} ${row.failure ?? row.error ?? ''}`;
  }
  return rows;
}

(window as unknown as { runBench: typeof runBench }).runBench = runBench;

// ---------- Large seeded trials ----------

export interface TrialConfig {
  perKind: number;
  seed: number;
  shard: [number, number];
  decide: Decider;
  inject: Injection;
  chaos: boolean;
  maxReplans: number;
  /** 'perceived': the robot aims at the camera's cube estimates (A5). Default: true simulator poses. */
  state?: 'sim' | 'perceived';
}

type CvDetect = (payload: unknown) => Promise<{ ok: boolean; detail: string }>;
const cvDetect = () => (window as unknown as { cvDetect: CvDetect }).cvDetect;
const cvPerceive = () => (window as unknown as { cvDetect: (p: unknown) => Promise<{ cubes: Record<string, CubePose | null> }> }).cvDetect;

function detector(w: World, task: Task): Detector {
  return (image, goal) => cvDetect()({ image, goal, cam: w.renderer.snapCamera(), cubes: task.scene.cubes.map((c) => c.name), zones: ZONES });
}

async function runTrials(cfg: TrialConfig) {
  const tasks = generateTasks(cfg.perKind, cfg.seed).filter((_, i) => i % cfg.shard[1] === cfg.shard[0]);
  world ??= await World.create(document.getElementById('scene') as HTMLCanvasElement, tasks[0].scene);
  const w = world;
  const rows = [];
  for (const task of tasks) {
    w.load(task.scene);
    const t0 = performance.now();
    const perceived = cfg.state === 'perceived';
    const useCam = perceived || cfg.decide === 'camera' || cfg.decide === 'combined';
    const r = await runEpisode(
      {
        sim: w.sim,
        clock: { realtime: false, frame: () => new Promise((res) => setTimeout(() => res(performance.now()), 0)) },
        planner: scriptedPlanner(task.goal),
        judge: null,
        snapshot: useCam
          ? async () => {
              w.renderer.sync(w.sim, false);
              return w.renderer.snapshot();
            }
          : null,
        detector: useCam ? detector(w, task) : undefined,
        perceive: perceived
          ? async (image) => (await cvPerceive()({ op: 'perceive', image, cam: w.renderer.snapCamera(), cubes: task.scene.cubes.map((c) => c.name) })).cubes
          : undefined,
        emit: () => {},
      },
      {
        instruction: task.instruction,
        goal: task.goal,
        maxReplans: cfg.maxReplans,
        chaos: { ...DEFAULT_CHAOS, enabled: cfg.chaos, seed: hash(task.id) },
        decide: cfg.decide,
        inject: cfg.inject,
      },
    );
    rows.push({ id: task.id, kind: task.kind, seed: task.scene.seed, wallSeconds: (performance.now() - t0) / 1000, ...r });
    log.textContent += `\n${task.id} ${cfg.decide}/${cfg.inject} truth=${r.success} declared=${r.declared} attempts=${r.attempts}`;
  }
  return rows;
}

// ---------- Checkpoint minimal pairs ----------

export interface CheckpointConfig {
  kind: 'contact' | 'place';
  seed: number;
  /** contact: hover gap in mm (0 means lower until contact). place: sideways offset of the release point in mm. */
  param: number;
}

const COLORS: Color[] = ['red', 'green', 'blue', 'yellow'];

async function runCheckpoint(cfg: CheckpointConfig) {
  const rand = mulberry32(cfg.seed * 31 + 5);
  const c = [...COLORS].sort(() => rand() - 0.5);
  const [a, b] = c;
  const scene = randomScene(cfg.seed, [a, b, ...(rand() < 0.5 ? [c[2]] : [])]);
  world ??= await World.create(document.getElementById('scene') as HTMLCanvasElement, scene);
  const w = world;
  w.load(scene);
  const sim = w.sim;
  const ex = new Executor(sim, { realtime: false, frame: () => new Promise((res) => setTimeout(() => res(performance.now()), 0)) }, { ...DEFAULT_CHAOS, seed: cfg.seed });
  for (const st of [{ skill: 'move_to', target: a }, { skill: 'grasp', object: a }, { skill: 'lift' }] as Skill[]) {
    const r = await ex.run(st);
    if (!r.ok) return { error: r.error };
  }
  const tb = sim.cube(b);
  const yaw = sim.target.yaw;
  const off = sim.gripPos()[2] - sim.cube(a).pos[2];
  // Offset along one of the target cube's own axes, so a large offset leaves the held cube's center past the edge.
  const ang = tb.yaw + (Math.floor(rand() * 4) * Math.PI) / 2;
  const dx = cfg.kind === 'place' ? (Math.cos(ang) * cfg.param) / 1000 : 0;
  const dy = cfg.kind === 'place' ? (Math.sin(ang) * cfg.param) / 1000 : 0;
  await ex.moveTo([tb.pos[0] + dx, tb.pos[1] + dy, HOVER_Z], yaw);
  const top = tb.pos[2] + CUBE_HALF;
  await ex.moveTo([tb.pos[0] + dx, tb.pos[1] + dy, top + CUBE_HALF + off + 0.015], yaw, 1.0);
  let rise: number;
  if (cfg.kind === 'contact' && cfg.param > 0) {
    // Hover: the guard still runs, so this is what the sensors would read on the way down to the gap.
    rise = await ex.guardedLower(top + CUBE_HALF + off + cfg.param / 1000, 4);
  } else {
    rise = await ex.guardedLower(top + CUBE_HALF + off - 0.004, 4);
    // Keep a light press after the guard stops, as a real controller would.
    const g = sim.gripPos();
    await ex.moveTo([g[0], g[1], g[2] - 0.003], yaw, 0.3);
  }
  const reading = await ex.sense();
  let truth: boolean;
  let gapMm: number | null = null;
  if (cfg.kind === 'contact') {
    gapMm = (sim.cube(a).pos[2] - sim.cube(b).pos[2] - 2 * CUBE_HALF) * 1000;
    truth = gapMm < 0.5;
  } else {
    await ex.run({ skill: 'release' });
    await ex.retreat();
    truth = verifyGoals(sim, [{ pred: 'on', a, b }]).ok;
  }
  w.renderer.sync(sim, false);
  const image = w.renderer.snapshot();
  return {
    kind: cfg.kind,
    seed: cfg.seed,
    param: cfg.param,
    a,
    b,
    cubes: scene.cubes.map((x) => x.name),
    truth,
    gapMm,
    sensorContact: rise > 2,
    forceRise: +rise.toFixed(3),
    switches: +((reading.switchLeft + reading.switchRight) / 2).toFixed(2),
    effort: +reading.effort.toFixed(2),
    grip: sim.gripPos(),
    cubePos: Object.fromEntries(sim.cubes().map((x) => [x.name, x.pos.map((v) => +v.toFixed(5))])),
    cam: w.renderer.snapCamera(),
    image,
  };
}

Object.assign(window as object, { runTrials, runCheckpoint });
