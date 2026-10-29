import { randomScene } from './scene.ts';
import type { Color, Goal, Task } from './types.ts';

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
