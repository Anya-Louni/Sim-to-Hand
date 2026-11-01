import { describeScene, verifyGoals } from './verify.ts';
import { Executor, type ChaosOptions, type Clock } from './skills.ts';
import type { Sim } from './sim.ts';
import type { Goal, Judgement, Plan, Skill, Verification } from './types.ts';
import type { SensorEvent } from './sensors.ts';
import type { Attempt } from '../llm/prompts.ts';

export interface PlanRequest {
  instruction: string;
  scene: string;
  history: Attempt[];
  image?: string;
  cubes: string[];
}

export interface Planner {
  name: string;
  plan(req: PlanRequest): Promise<{ plan: Plan; provider: string; calls: number }>;
}

export interface Judge {
  judge(instruction: string, image: string): Promise<Judgement & { provider: string }>;
}

export type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'attempt'; attempt: number }
  | { type: 'plan'; attempt: number; plan: Plan; provider: string; goalSource: 'task' | 'planner' }
  | { type: 'plan_error'; attempt: number; message: string }
  | { type: 'step'; attempt: number; index: number; skill: Skill; status: 'running' | 'ok' | 'failed'; error?: string }
  | { type: 'chaos'; message: string }
  | {
      type: 'verify';
      attempt: number;
      ground: Verification;
      vision: (Judgement & { provider: string }) | null;
      visionError?: string;
      image?: string;
      agree: boolean | null;
      sensors: SensorVerdict;
    }
  | { type: 'replan'; attempt: number; reason: string }
  | { type: 'done'; result: EpisodeResult };

export interface SensorVerdict {
  ok: boolean;
  events: SensorEvent[];
  summary: string;
}

export interface EpisodeResult {
  success: boolean;
  attempts: number;
  replans: number;
  visionChecks: number;
  sensorChecks: number;
  sensorAgreements: number;
  visionAgreements: number;
  disagreements: { attempt: number; ground: boolean; vision: boolean; reason: string }[];
  llmCalls: number;
  chaosEvents: number;
  simSeconds: number;
  failure?: string;
  planner: string;
  providers: string[];
}

export interface EpisodeOptions {
  instruction: string;
  /** Benchmark tasks pass their own goal; free text uses the planner's goal. */
  goal?: Goal[];
  maxReplans: number;
  chaos: ChaosOptions;
}

export interface AgentDeps {
  sim: Sim;
  clock: Clock;
  planner: Planner;
  judge: Judge | null;
  snapshot: (() => Promise<string>) | null;
  emit: (e: AgentEvent) => void;
  cancelled?: () => boolean;
  speed?: number;
}

const stepText = (s: Skill) => {
  switch (s.skill) {
    case 'move_to':
      return `move_to(${s.target})`;
    case 'grasp':
      return `grasp(${s.object})`;
    case 'place':
      return `place(${s.on})`;
    default:
      return `${s.skill}()`;
  }
};
export { stepText };

export async function runEpisode(deps: AgentDeps, opts: EpisodeOptions): Promise<EpisodeResult> {
  const { sim, emit } = deps;
  const ex = new Executor(sim, deps.clock, opts.chaos, (e) => {
    if (e.type === 'chaos') {
      result.chaosEvents++;
      emit({ type: 'chaos', message: e.message });
    } else emit({ type: 'status', message: e.message });
  }, deps.cancelled);
  ex.speed = deps.speed ?? 1;
  const result: EpisodeResult = {
    success: false,
    attempts: 0,
    replans: 0,
    visionChecks: 0,
    sensorChecks: 0,
    sensorAgreements: 0,
    visionAgreements: 0,
    disagreements: [],
    llmCalls: 0,
    chaosEvents: 0,
    simSeconds: 0,
    planner: deps.planner.name,
    providers: [],
  };
  const history: Attempt[] = [];
  let lastImage: string | undefined;

  for (let attempt = 0; attempt <= opts.maxReplans; attempt++) {
    result.attempts = attempt + 1;
    ex.newAttempt();
    emit({ type: 'attempt', attempt });
    emit({ type: 'status', message: attempt === 0 ? 'Planning' : 'Replanning' });

    let plan: Plan;
    try {
      const out = await deps.planner.plan({
        instruction: opts.instruction,
        scene: describeScene(sim, ex.holding),
        history,
        image: attempt > 0 ? lastImage : undefined,
        cubes: sim.cubeNames,
      });
      plan = out.plan;
      result.llmCalls += out.calls;
      result.providers.push(out.provider);
      emit({ type: 'plan', attempt, plan, provider: out.provider, goalSource: opts.goal ? 'task' : 'planner' });
    } catch (e) {
      const message = (e as Error).message;
      emit({ type: 'plan_error', attempt, message });
      result.failure = `planner error: ${message}`;
      break;
    }

    const goal = opts.goal ?? plan.goal;
    let stepError: string | undefined;
    for (let i = 0; i < plan.steps.length; i++) {
      if (i > 0) ex.maybeNudge();
      const skill = plan.steps[i];
      emit({ type: 'step', attempt, index: i, skill, status: 'running' });
      const r = await ex.run(skill);
      emit({ type: 'step', attempt, index: i, skill, status: r.ok ? 'ok' : 'failed', error: r.error });
      if (!r.ok) {
        stepError = `step ${i + 1} ${stepText(skill)} failed: ${r.error}`;
        break;
      }
    }
    emit({ type: 'status', message: 'Verifying' });
    await ex.retreat();

    const ground = verifyGoals(sim, goal);
    // Third check: the agent's own cheap sensors. Success needs every grasp felt, every placement felt as contact,
    // no hold lost, and the plan run to the end. Sensors cannot see where a cube ends up after release.
    const evs = ex.sensorEvents;
    const places = plan.steps.filter((st) => st.skill === 'place').length;
    const contacts = evs.filter((e) => e.check === 'contact' && e.ok).length;
    const sensorOk = !stepError && evs.every((e) => e.ok) && contacts >= places;
    const sensors: SensorVerdict = {
      ok: sensorOk,
      events: [...evs],
      summary: sensorOk
        ? `Felt ${evs.filter((e) => e.check === 'grasp').length} grasp(s) and ${contacts} placement contact(s)`
        : evs.find((e) => !e.ok)
          ? `${evs.find((e) => !e.ok)!.skill}: ${evs.find((e) => !e.ok)!.detail}`
          : stepError
            ? 'Plan stopped before finishing'
            : `Only ${contacts} of ${places} placements felt contact`,
    };
    result.sensorChecks++;
    if (sensorOk === ground.ok) result.sensorAgreements++;
    let vision: (Judgement & { provider: string }) | null = null;
    let visionError: string | undefined;
    let image: string | undefined;
    if (deps.snapshot) {
      image = await deps.snapshot();
      lastImage = image;
      if (deps.judge) {
        try {
          vision = await deps.judge.judge(opts.instruction, image);
          result.llmCalls++;
          result.providers.push(vision.provider);
        } catch (e) {
          visionError = (e as Error).message;
        }
      }
    }
    const agree = vision ? vision.success === ground.ok : null;
    if (vision) {
      result.visionChecks++;
      if (agree) result.visionAgreements++;
      else result.disagreements.push({ attempt, ground: ground.ok, vision: vision.success, reason: vision.reason });
    }
    emit({ type: 'verify', attempt, ground, vision, visionError, image, agree, sensors });

    if (ground.ok) {
      result.success = true;
      result.failure = undefined;
      break;
    }
    const failure = stepError ? `${stepError} Goal check: ${ground.summary}` : `Plan finished but goal not met: ${ground.summary}`;
    result.failure = failure;
    history.push({ attempt, steps: plan.steps.map(stepText).join(', '), failure, vision: vision ? `${vision.success ? 'success' : 'failure'}: ${vision.reason}` : undefined });
    if (attempt < opts.maxReplans) {
      result.replans++;
      emit({ type: 'replan', attempt, reason: failure });
    }
  }
  result.simSeconds = sim.time;
  emit({ type: 'done', result });
  return result;
}
