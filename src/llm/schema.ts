import Ajv from 'ajv';
import { ZONES } from '../core/scene.ts';
import type { Judgement, Plan } from '../core/types.ts';

const name = { type: 'string', minLength: 1, maxLength: 32 };

export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reasoning', 'goal', 'steps'],
  properties: {
    reasoning: { type: 'string', maxLength: 800 },
    goal: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        oneOf: [
          { type: 'object', additionalProperties: false, required: ['pred', 'a', 'b'], properties: { pred: { const: 'on' }, a: name, b: name } },
          { type: 'object', additionalProperties: false, required: ['pred', 'a', 'zone'], properties: { pred: { const: 'in_zone' }, a: name, zone: name } },
        ],
      },
    },
    steps: {
      type: 'array',
      minItems: 1,
      maxItems: 40,
      items: {
        oneOf: [
          { type: 'object', additionalProperties: false, required: ['skill', 'target'], properties: { skill: { const: 'move_to' }, target: name } },
          { type: 'object', additionalProperties: false, required: ['skill', 'object'], properties: { skill: { const: 'grasp' }, object: name } },
          { type: 'object', additionalProperties: false, required: ['skill'], properties: { skill: { const: 'lift' } } },
          { type: 'object', additionalProperties: false, required: ['skill', 'on'], properties: { skill: { const: 'place' }, on: name } },
          { type: 'object', additionalProperties: false, required: ['skill'], properties: { skill: { const: 'release' } } },
        ],
      },
    },
  },
} as const;

export const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['success', 'reason'],
  properties: { success: { type: 'boolean' }, reason: { type: 'string', maxLength: 600 } },
} as const;

const ajv = new Ajv({ allErrors: true });
const planValidator = ajv.compile(PLAN_SCHEMA);
const judgeValidator = ajv.compile(JUDGE_SCHEMA);

export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('no JSON object in model output');
  return JSON.parse(t.slice(start, end + 1));
}

/** Schema check plus a check that every name exists in the scene. */
export function validatePlan(raw: unknown, cubes: string[]): { plan?: Plan; errors: string[] } {
  if (!planValidator(raw)) {
    return { errors: (planValidator.errors ?? []).slice(0, 6).map((e) => `${e.instancePath || '/'} ${e.message}`) };
  }
  const plan = raw as unknown as Plan;
  const zones = ZONES.map((z) => z.name);
  const errors: string[] = [];
  const isCube = (n: string) => cubes.includes(n);
  const isTarget = (n: string) => isCube(n) || zones.includes(n);
  plan.steps.forEach((s, i) => {
    if (s.skill === 'move_to' && !isTarget(s.target)) errors.push(`step ${i}: unknown target "${s.target}"`);
    if (s.skill === 'grasp' && !isCube(s.object)) errors.push(`step ${i}: unknown object "${s.object}"`);
    if (s.skill === 'place' && !isTarget(s.on)) errors.push(`step ${i}: unknown place target "${s.on}"`);
  });
  plan.goal.forEach((g, i) => {
    if (!isCube(g.a)) errors.push(`goal ${i}: unknown cube "${g.a}"`);
    if (g.pred === 'on' && !isCube(g.b)) errors.push(`goal ${i}: unknown cube "${g.b}"`);
    if (g.pred === 'in_zone' && !zones.includes(g.zone)) errors.push(`goal ${i}: unknown zone "${g.zone}"`);
  });
  return errors.length ? { errors } : { plan, errors };
}

export function validateJudgement(raw: unknown): Judgement {
  if (!judgeValidator(raw)) throw new Error('judge output failed schema: ' + ajv.errorsText(judgeValidator.errors));
  return raw as unknown as Judgement;
}
