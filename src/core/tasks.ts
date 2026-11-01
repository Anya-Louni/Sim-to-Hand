import { mulberry32, randomScene, ZONES } from './scene.ts';
import type { Color, Goal, SceneSpec, Task } from './types.ts';

const on = (a: string, b: string): Goal => ({ pred: 'on', a, b });
const inZone = (a: string, zone: string): Goal => ({ pred: 'in_zone', a, zone });

function stack(id: string, seed: number, a: Color, b: Color, others: Color[], phrasing: string): Task {
  return { id, kind: 'stack', instruction: phrasing, scene: randomScene(seed, [a, b, ...others]), goal: [on(a, b)] };
}

function tower(id: string, seed: number, top: Color, mid: Color, bottom: Color, phrasing: string, extra: Color[] = []): Task {
  return { id, kind: 'tower', instruction: phrasing, scene: randomScene(seed, [top, mid, bottom, ...extra]), goal: [on(mid, bottom), on(top, mid)] };
}

function sort(id: string, seed: number, phrasing: string): Task {
  const colors: Color[] = ['red', 'green', 'blue'];
  return { id, kind: 'sort', instruction: phrasing, scene: randomScene(seed, colors), goal: colors.map((c) => inZone(c, `${c}_zone`)) };
}

function zone(id: string, seed: number, cube: Color, z: string, others: Color[], phrasing: string): Task {
  return { id, kind: 'zone', instruction: phrasing, scene: randomScene(seed, [cube, ...others]), goal: [inZone(cube, z)] };
}

export const PRESETS = {
  stack: () => stack('preset-stack', 101, 'red', 'blue', ['green'], 'Stack the red cube on the blue one.'),
  sort: () => sort('preset-sort', 202, 'Sort the cubes by color into their matching zones.'),
  tower: () => tower('preset-tower', 303, 'red', 'green', 'blue', 'Build a 3-cube tower: blue at the bottom, then green, then red on top.', ['yellow']),
};

/** Seeded benchmark suite. Phrasings vary so the planner has to read the instruction. */
export const BENCHMARK: Task[] = [
  stack('stack-01', 11, 'red', 'blue', ['green'], 'Stack the red cube on the blue one.'),
  stack('stack-02', 12, 'green', 'yellow', ['red'], 'Put the green block on top of the yellow block.'),
  stack('stack-03', 13, 'blue', 'red', ['yellow', 'green'], 'Place blue onto red.'),
  stack('stack-04', 14, 'yellow', 'green', ['blue'], 'I want the yellow cube sitting on the green cube.'),
  stack('stack-05', 15, 'red', 'yellow', [], 'Stack red on yellow.'),
  stack('stack-06', 16, 'green', 'blue', ['red', 'yellow'], 'Can you pick up the green one and set it on the blue one?'),
  stack('stack-07', 17, 'blue', 'green', ['red'], 'The blue cube should end up on top of the green cube.'),
  stack('stack-08', 18, 'yellow', 'red', ['blue'], 'Move the yellow cube so it rests on the red cube.'),
  tower('tower-01', 21, 'red', 'green', 'blue', 'Build a 3-cube tower: blue at the bottom, then green, then red on top.'),
  tower('tower-02', 22, 'yellow', 'red', 'green', 'Make a tower with green on the bottom, red in the middle and yellow on top.'),
  tower('tower-03', 23, 'blue', 'yellow', 'red', 'Stack three cubes: red base, yellow middle, blue top.', ['green']),
  tower('tower-04', 24, 'green', 'blue', 'yellow', 'Put blue on yellow, then green on blue.'),
  tower('tower-05', 25, 'red', 'yellow', 'blue', 'Tower, bottom to top: blue, yellow, red.', ['green']),
  tower('tower-06', 26, 'blue', 'red', 'green', 'Build a tower where blue is on top of red and red is on top of green.'),
  sort('sort-01', 31, 'Sort the cubes by color into their matching zones.'),
  sort('sort-02', 32, 'Put every cube in the zone that has the same color.'),
  sort('sort-03', 33, 'Tidy up: each cube goes to its matching colored square.'),
  sort('sort-04', 34, 'Organize the cubes into the red, green and blue zones by color.'),
  zone('zone-01', 41, 'red', 'red_zone', ['green', 'blue'], 'Put the red cube in the red zone.'),
  zone('zone-02', 42, 'yellow', 'green_zone', ['red'], 'Move the yellow cube into the green zone.'),
  zone('zone-03', 43, 'blue', 'red_zone', ['yellow', 'green'], 'Drop the blue cube into the red square.'),
  zone('zone-04', 44, 'green', 'blue_zone', ['red', 'yellow'], 'Place the green block in the blue zone.'),
  { id: 'stack-09', kind: 'stack', instruction: 'Stack the green cube on the red cube.', scene: randomScene(51, ['red', 'green', 'blue']), goal: [on('green', 'red')] },
  { id: 'zone-05', kind: 'zone', instruction: 'Put the blue cube in the blue zone and the red cube in the red zone.', scene: randomScene(52, ['red', 'blue', 'yellow']), goal: [inZone('blue', 'blue_zone'), inZone('red', 'red_zone')] },
];

/** A scene with some cubes starting stacked: stacks are [top, base] pairs; bases come from the random layout. */
function stackedScene(seed: number, table: Color[], stacks: [Color, Color][]): SceneSpec {
  const s = randomScene(seed, table);
  for (const [top, base] of stacks) {
    const b = s.cubes.find((c) => c.name === base)!;
    s.cubes.push({ name: top, x: b.x, y: b.y, yaw: b.yaw, on: base });
  }
  return s;
}

const task = (id: string, kind: Task['kind'], instruction: string, scene: SceneSpec, goal: Goal[], impossible?: string): Task => ({ id, kind, instruction, scene, goal, impossible });

/**
 * Harder suite (A6). Goals are written by hand; relational goals were read off the seeded layouts
 * (robot base at the origin, x away from the robot, the robot's left is +y).
 *   relational  the target is named by where it is, not by color
 *   reorder     cubes start stacked and must be unstacked or reordered
 *   impossible  the right answer is a refusal (missing object, missing zone, self-stack, contradiction)
 *   distractor  the instruction contains corrections, negations or irrelevant text
 */
export const HARD_BENCHMARK: Task[] = [
  task('rel-01', 'relational', 'Put the cube closest to the robot base on top of the cube farthest from it.', randomScene(61, ['red', 'green', 'blue']), [on('blue', 'green')]),
  task('rel-02', 'relational', "Move the cube furthest to the robot's left into the red zone.", randomScene(62, ['red', 'blue', 'yellow']), [inZone('blue', 'red_zone')]),
  task('rel-03', 'relational', 'Stack the cube nearest to the red zone on the yellow cube.', randomScene(63, ['green', 'blue', 'yellow']), [on('green', 'yellow')]),
  task('rel-04', 'relational', "Put the cube furthest to the robot's right on the cube furthest to its left.", randomScene(64, ['red', 'green', 'blue', 'yellow']), [on('yellow', 'green')]),
  task('rel-05', 'relational', 'Of the three cubes, take the one at the middle distance from the robot base and put it in the blue zone.', randomScene(65, ['red', 'green', 'blue']), [inZone('green', 'blue_zone')]),
  task('ord-01', 'reorder', 'Swap the two stacked cubes so that the blue cube ends up on top of the red cube.', stackedScene(71, ['blue', 'green'], [['red', 'blue']]), [on('blue', 'red')]),
  task('ord-02', 'reorder', 'Reverse the tower so the top cube becomes the bottom one.', stackedScene(72, ['blue'], [['red', 'blue'], ['green', 'red']]), [on('red', 'green'), on('blue', 'red')]),
  task('ord-03', 'reorder', 'Take the yellow cube off the red cube and put it in the green zone.', stackedScene(73, ['red', 'blue'], [['yellow', 'red']]), [inZone('yellow', 'green_zone')]),
  task('ord-04', 'reorder', 'Move the green cube into the red zone.', stackedScene(74, ['green', 'red'], [['blue', 'green']]), [inZone('green', 'red_zone')]),
  task('ord-05', 'reorder', 'Put the yellow cube on the blue cube, then the red cube on the yellow cube.', stackedScene(75, ['yellow', 'blue'], [['red', 'yellow']]), [on('yellow', 'blue'), on('red', 'yellow')]),
  task('imp-01', 'impossible', 'Put the purple cube in the red zone.', randomScene(91, ['red', 'blue', 'green']), [], 'there is no purple cube'),
  task('imp-02', 'impossible', 'Put the yellow cube on the red cube.', randomScene(92, ['red', 'green', 'blue']), [], 'there is no yellow cube in this scene'),
  task('imp-03', 'impossible', 'Stack the red cube on top of itself.', randomScene(93, ['red', 'blue']), [], 'a cube cannot rest on itself'),
  task('imp-04', 'impossible', 'Put the red cube in the orange zone.', randomScene(94, ['red', 'green', 'blue']), [], 'there is no orange zone'),
  task('imp-05', 'impossible', 'Put the red cube on the blue cube and the blue cube on the red cube.', randomScene(95, ['red', 'blue']), [], 'the two goals contradict each other'),
  task('dis-01', 'distractor', "The green cube is fragile, so don't touch it. Put the red cube on the blue cube.", randomScene(81, ['red', 'green', 'blue', 'yellow']), [on('red', 'blue')]),
  task('dis-02', 'distractor', 'Ignore what I said earlier about the yellow cube. Just put the blue one in the red zone.', randomScene(82, ['blue', 'red', 'yellow']), [inZone('blue', 'red_zone')]),
  task('dis-03', 'distractor', 'Not the red cube, I mean the green one: put it in the blue zone.', randomScene(83, ['red', 'green', 'blue']), [inZone('green', 'blue_zone')]),
  task('dis-04', 'distractor', 'Earlier I asked for a tower, but forget that. Only stack yellow on green.', randomScene(84, ['yellow', 'blue', 'green']), [on('yellow', 'green')]),
  task('dis-05', 'distractor', 'Put the blue cube on the red cube. Actually no, put the red cube on the blue cube.', randomScene(85, ['red', 'green', 'blue']), [on('red', 'blue')]),
];

/**
 * Seeded task generator for large experiments. Same seed, same tasks.
 * Kinds: stack (2 goals cubes), tower (3), sort (3 zones), zone (1 cube, any zone).
 */
export function generateTasks(perKind: number, seed = 1000): Task[] {
  const all: Color[] = ['red', 'green', 'blue', 'yellow'];
  const tasks: Task[] = [];
  for (let i = 0; i < perKind; i++) {
    const s = seed + i * 17;
    const rand = mulberry32(s);
    const pick = () => {
      const c = [...all];
      for (let k = c.length - 1; k > 0; k--) {
        const j = Math.floor(rand() * (k + 1));
        [c[k], c[j]] = [c[j], c[k]];
      }
      return c;
    };
    const n = String(i + 1).padStart(3, '0');
    let c = pick();
    tasks.push(stack(`g-stack-${n}`, s, c[0], c[1], c.slice(2, 2 + Math.floor(rand() * 3)), `Stack the ${c[0]} cube on the ${c[1]} cube.`));
    c = pick();
    tasks.push(tower(`g-tower-${n}`, s + 1, c[0], c[1], c[2], `Build a tower: ${c[2]} at the bottom, then ${c[1]}, then ${c[0]} on top.`, rand() < 0.5 ? [c[3]] : []));
    tasks.push(sort(`g-sort-${n}`, s + 2, 'Sort the cubes by color into their matching zones.'));
    c = pick();
    const z = ZONES[Math.floor(rand() * ZONES.length)].name;
    tasks.push(zone(`g-zone-${n}`, s + 3, c[0], z, c.slice(1, 1 + Math.floor(rand() * 3)), `Put the ${c[0]} cube in the ${z.replace('_', ' ')}.`));
  }
  return tasks;
}
