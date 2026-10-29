import loadMujoco from '@mujoco/mujoco';
import wasmUrl from '@mujoco/mujoco/mujoco.wasm?url';
import { Sim } from '../core/sim.ts';
import type { SceneSpec } from '../core/types.ts';
import { Renderer } from './renderer.ts';

const MODEL_FILES = [
  'panda.xml',
  ...['link0.stl', 'link1.stl', 'link2.stl', 'link3.stl', 'link4.stl', 'link5_collision_0.obj', 'link5_collision_1.obj', 'link5_collision_2.obj', 'link6.stl', 'link7.stl', 'hand.stl', 'finger_0.obj'].map((f) => 'assets/' + f),
];

const base = import.meta.env.BASE_URL;

export class World {
  sim!: Sim;
  readonly renderer: Renderer;
  private mj: any;
  private files: Record<string, Uint8Array> = {};

  private constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
  }

  static async create(canvas: HTMLCanvasElement, scene: SceneSpec): Promise<World> {
    const w = new World(canvas);
    const [mj] = await Promise.all([
      loadMujoco({ locateFile: (p: string) => (p.endsWith('.wasm') ? wasmUrl : p) }),
      w.renderer.loadRobot(`${base}models/panda_visual.bin`),
      ...MODEL_FILES.map(async (f) => {
        const res = await fetch(`${base}models/${f}`);
        if (!res.ok) throw new Error(`missing model file ${f}`);
        w.files[f] = new Uint8Array(await res.arrayBuffer());
      }),
    ]);
    w.mj = mj;
    w.load(scene);
    return w;
  }

  load(scene: SceneSpec) {
    this.sim?.dispose();
    this.sim = new Sim(this.mj, this.files, scene);
    this.renderer.setCubes(this.sim.cubeNames);
    this.renderer.sync(this.sim, false);
  }
}
