import type { Judge, PlanRequest, Planner } from '../core/agent.ts';
import { scriptedPlan } from '../core/scripted.ts';
import type { Goal } from '../core/types.ts';
import type { LLMRequest, LLMResponse } from './providers.ts';
import { extractJson, validateJudgement, validatePlan } from './schema.ts';

export type Transport = (req: LLMRequest) => Promise<LLMResponse>;

/** LLM planner: schema-validated JSON, one repair round on invalid output. */
export function llmPlanner(transport: Transport): Planner {
  return {
    name: 'llm',
    async plan(req: PlanRequest) {
      let invalid: string | undefined;
      let calls = 0;
      for (let round = 0; round < 2; round++) {
        calls++;
        const res = await transport({
          kind: 'plan',
          payload: { instruction: req.instruction, scene: req.scene, history: req.history, image: req.image, invalid },
        });
        let raw: unknown;
        try {
          raw = extractJson(res.text);
        } catch (e) {
          invalid = (e as Error).message;
          continue;
        }
        const v = validatePlan(raw, req.cubes);
        if (v.plan) return { plan: v.plan, provider: res.provider, calls };
        invalid = v.errors.join('; ');
      }
      throw new Error(`plan failed schema validation twice: ${invalid}`);
    },
  };
}

/** No-LLM baseline: plans straight from the task's goal predicates. */
export function scriptedPlanner(goal: Goal[]): Planner {
  return {
    name: 'scripted',
    async plan(req: PlanRequest) {
      if (!goal.length) return { plan: { reasoning: 'Scripted: the task has no goal to plan for.', refuse: 'no goal', goal: [], steps: [] }, provider: 'scripted', calls: 0 };
      const plan = scriptedPlan(goal);
      if (req.history.length) plan.reasoning = 'Scripted retry: redo the full goal sequence.';
      return { plan, provider: 'scripted', calls: 0 };
    },
  };
}

export function llmJudge(transport: Transport): Judge {
  return {
    async judge(instruction: string, image: string) {
      const res = await transport({ kind: 'judge', payload: { instruction, image } });
      return { ...validateJudgement(extractJson(res.text)), provider: res.provider };
    },
  };
}
