// Shared setup for tests that need the MuJoCo simulator in Node.
import loadMujoco from '@mujoco/mujoco';
import fs from 'node:fs';
import path from 'node:path';
import { Sim } from '../src/core/sim.ts';
import type { SceneSpec } from '../src/core/types.ts';

const dir = 'public/models';
const files: Record<string, Uint8Array> = { 'panda.xml': new Uint8Array(fs.readFileSync(path.join(dir, 'panda.xml'))) };
for (const f of fs.readdirSync(path.join(dir, 'assets'))) files['assets/' + f] = new Uint8Array(fs.readFileSync(path.join(dir, 'assets', f)));

let mj: any = null;

export async function makeSim(scene: SceneSpec): Promise<Sim> {
  mj ??= await loadMujoco();
  return new Sim(mj, files, scene);
}

/** Fast headless clock: no waiting between physics batches. */
export const clock = { realtime: false, frame: async () => 0 };
