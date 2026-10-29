export type Color = 'red' | 'green' | 'blue' | 'yellow';

export interface CubeSpec {
  name: Color;
  x: number;
  y: number;
  yaw: number;
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
}

export interface Task {
  id: string;
  kind: 'stack' | 'tower' | 'sort' | 'zone';
  instruction: string;
  scene: SceneSpec;
  goal: Goal[];
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
