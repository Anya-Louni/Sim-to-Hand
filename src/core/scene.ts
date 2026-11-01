import type { Color, CubeSpec, SceneSpec, Zone } from './types.ts';

export const CUBE_HALF = 0.025;
export const HOVER_Z = 0.26;

export const COLORS: Record<Color, [number, number, number]> = {
  red: [0.9, 0.22, 0.2],
  green: [0.2, 0.72, 0.38],
  blue: [0.2, 0.45, 0.92],
  yellow: [0.98, 0.78, 0.18],
};

export const ZONES: Zone[] = [
  { name: 'red_zone', color: 'red', x: 0.66, y: -0.22, half: 0.055 },
  { name: 'green_zone', color: 'green', x: 0.66, y: 0.0, half: 0.055 },
  { name: 'blue_zone', color: 'blue', x: 0.66, y: 0.22, half: 0.055 },
];

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random non-overlapping cube layout in the spawn area in front of the robot. */
export function randomScene(seed: number, colors: Color[]): SceneSpec {
  const rand = mulberry32(seed);
  const cubes: CubeSpec[] = [];
  for (const name of colors) {
    for (let tries = 0; tries < 500; tries++) {
      const x = 0.36 + rand() * 0.18;
      const y = -0.24 + rand() * 0.48;
      if (cubes.every((c) => Math.hypot(c.x - x, c.y - y) > 0.11)) {
        cubes.push({ name, x, y, yaw: (rand() - 0.5) * 1.2 });
        break;
      }
    }
  }
  return { seed, cubes };
}

/** Resting height of a cube's centre: on the table, or on top of the cube it starts on. */
function startZ(scene: SceneSpec, name: string): number {
  const c = scene.cubes.find((k) => k.name === name)!;
  return c.on ? startZ(scene, c.on) + 2 * CUBE_HALF + 0.0005 : CUBE_HALF;
}

export function sceneXml(scene: SceneSpec): string {
  const cubes = scene.cubes
    .map((c) => {
      const [r, g, b] = COLORS[c.name];
      const h = CUBE_HALF;
      return `<body name="${c.name}" pos="${c.x} ${c.y} ${startZ(scene, c.name)}" euler="0 0 ${c.yaw}">
  <freejoint name="${c.name}"/>
  <geom type="box" size="${h} ${h} ${h}" rgba="${r} ${g} ${b} 1" density="500" friction="1.6 0.01 0.001" condim="4"/>
</body>`;
    })
    .join('\n');
  return `<mujoco model="sim-to-hand">
<include file="panda.xml"/>
<worldbody>
<geom name="table" type="plane" size="1.2 1.2 0.05" rgba="0.5 0.5 0.5 1" friction="0.8 0.005 0.0001"/>
${cubes}
</worldbody>
</mujoco>`;
}

export function zoneByName(name: string) {
  return ZONES.find((z) => z.name === name);
}
