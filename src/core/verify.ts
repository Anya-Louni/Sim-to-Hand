import { CUBE_HALF, ZONES, zoneByName } from './scene.ts';
import type { CubeState, Sim } from './sim.ts';
import type { Goal, GoalCheck, Verification } from './types.ts';

const cm = (v: number) => (v * 100).toFixed(1);

/** Ground-truth check of goal predicates against simulator state. */
export function verifyGoals(sim: Sim, goals: Goal[]): Verification {
  const cubes = new Map(sim.cubes().map((c) => [c.name, c]));
  const checks: GoalCheck[] = goals.map((goal) => {
    if (goal.pred === 'on') {
      const a = cubes.get(goal.a);
      const b = cubes.get(goal.b);
      if (!a || !b) return { goal, ok: false, detail: `unknown cube ${!a ? goal.a : goal.b}` };
      const dxy = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]);
      const dz = a.pos[2] - b.pos[2];
      const ok = dxy < 0.6 * CUBE_HALF * 2 && Math.abs(dz - 2 * CUBE_HALF) < 0.012 && a.speed < 0.05;
      return {
        goal,
        ok,
        detail: ok
          ? `${goal.a} rests on ${goal.b}`
          : `${goal.a} is not on ${goal.b} (offset ${cm(dxy)} cm, height diff ${cm(dz)} cm)`,
      };
    }
    const a = cubes.get(goal.a);
    const z = zoneByName(goal.zone);
    if (!a || !z) return { goal, ok: false, detail: `unknown ${!a ? 'cube ' + goal.a : 'zone ' + goal.zone}` };
    const ok = Math.abs(a.pos[0] - z.x) < z.half && Math.abs(a.pos[1] - z.y) < z.half && a.pos[2] < 0.2 && a.speed < 0.05;
    return {
      goal,
      ok,
      detail: ok ? `${goal.a} is in ${goal.zone}` : `${goal.a} is outside ${goal.zone} (${cm(Math.hypot(a.pos[0] - z.x, a.pos[1] - z.y))} cm from center)`,
    };
  });
  const ok = checks.length > 0 && checks.every((c) => c.ok);
  const summary = checks.length === 0 ? 'No goal to check' : ok ? 'All goal conditions hold' : checks.filter((c) => !c.ok).map((c) => c.detail).join('; ');
  return { ok, checks, summary };
}

function supportOf(c: CubeState, all: CubeState[]): string {
  if (c.pos[2] < CUBE_HALF + 0.01) {
    const z = ZONES.find((z) => Math.abs(c.pos[0] - z.x) < z.half && Math.abs(c.pos[1] - z.y) < z.half);
    return z ? `table, inside ${z.name}` : 'table';
  }
  const under = all.find((o) => o !== c && Math.hypot(o.pos[0] - c.pos[0], o.pos[1] - c.pos[1]) < 0.04 && o.pos[2] < c.pos[2]);
  return under ? `on the ${under.name} cube` : 'in the air';
}

/** Compact text description of the scene for the planner. */
export function describeScene(sim: Sim, holding: string | null): string {
  const cubes = sim.cubes();
  const lines = cubes.map(
    (c) => `- ${c.name} cube at x=${cm(c.pos[0])} y=${cm(c.pos[1])} z=${cm(c.pos[2])} cm, ${c.name === holding ? 'held by the gripper' : supportOf(c, cubes)}`,
  );
  const zones = ZONES.map((z) => `- ${z.name} centered at x=${cm(z.x)} y=${cm(z.y)} cm`);
  return `Frame: robot base at x=0 y=0, x points away from the robot, +y is the robot's left.\nCubes (5 cm):\n${lines.join('\n')}\nZones on the table:\n${zones.join('\n')}\nGripper: ${holding ? 'holding ' + holding : 'empty'}`;
}
