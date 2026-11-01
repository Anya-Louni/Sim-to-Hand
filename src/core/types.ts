export type Color = 'red' | 'green' | 'blue' | 'yellow';

export interface CubeSpec {
  name: Color;
  x: number;
  y: number;
  yaw: number;
  /** Starts resting on this cube (which must come earlier in the list). Default: on the table. */
  on?: Color;
}

export interface Zone {
  name: string;
  color: Color;
  x: number;
  y: number;
  half: number;
}

export interface SceneSpec {
  seed: number;
  cubes: CubeSpec[];
}

export type Skill =
  | { skill: 'move_to'; target: string }
  | { skill: 'grasp'; object: string }
  | { skill: 'lift' }
  | { skill: 'place'; on: string }
  | { skill: 'release' };

export type Goal = { pred: 'on'; a: string; b: string } | { pred: 'in_zone'; a: string; zone: string };

export interface Plan {
  reasoning: string;
  goal: Goal[];
  steps: Skill[];
  /** Set instead of a plan when the instruction cannot be done in this scene. */
  refuse?: string;
}

export interface Task {
  id: string;
  kind: 'stack' | 'tower' | 'sort' | 'zone' | 'relational' | 'reorder' | 'impossible' | 'distractor';
  instruction: string;
  scene: SceneSpec;
  /** Hand-written goal. Empty for impossible tasks, where the right answer is a refusal. */
  goal: Goal[];
  /** Why the task cannot be done (impossible tasks only). */
  impossible?: string;
}

export interface Judgement {
  success: boolean;
  reason: string;
}

export interface GoalCheck {
  goal: Goal;
  ok: boolean;
  detail: string;
}

export interface Verification {
  ok: boolean;
  checks: GoalCheck[];
  summary: string;
}
