import type { Goal, Plan, Skill } from './types.ts';

/**
 * Deterministic planner used as a no-LLM baseline and offline fallback.
 * It only works from explicit goal predicates, not from natural language.
 */
export function scriptedPlan(goals: Goal[]): Plan {
  // Order "on" goals bottom-up: place a cube only after its support is in place.
  const on = goals.filter((g): g is Extract<Goal, { pred: 'on' }> => g.pred === 'on');
  const ordered: typeof on = [];
  const remaining = [...on];
  while (remaining.length) {
    const i = remaining.findIndex((g) => !remaining.some((o) => o.a === g.b));
    ordered.push(...remaining.splice(i < 0 ? 0 : i, 1));
  }
  const steps: Skill[] = [];
  const pick = (a: string, target: string) =>
    steps.push({ skill: 'move_to', target: a }, { skill: 'grasp', object: a }, { skill: 'lift' }, { skill: 'place', on: target }, { skill: 'release' });
  for (const g of goals) if (g.pred === 'in_zone') pick(g.a, g.zone);
  for (const g of ordered) pick(g.a, g.b);
  return { reasoning: 'Scripted baseline plan built directly from the goal predicates.', goal: goals, steps };
}
