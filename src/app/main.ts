import { runEpisode, type Planner } from '../core/agent.ts';
import { randomScene } from '../core/scene.ts';
import { DEFAULT_CHAOS } from '../core/skills.ts';
import { PRESETS } from '../core/tasks.ts';
import type { Goal, SceneSpec } from '../core/types.ts';
import { llmJudge, llmPlanner, scriptedPlanner } from '../llm/planner.ts';
import { Feed } from './feed.ts';
import { loadKeys, makeTransport, saveKeys } from './transport.ts';
import { World } from './world.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const feed = new Feed($('feed'), $('status'), $('status-text'), $('attempt'));
const input = $<HTMLInputElement>('instruction');
const runBtn = $<HTMLButtonElement>('run');
const stopBtn = $<HTMLButtonElement>('stop');
const plannerSel = $<HTMLSelectElement>('planner');

let keys = loadKeys();
const transport = makeTransport(() => keys);

let world: World;
let busy = false;
let cancel = false;
let scene: SceneSpec = PRESETS.stack().scene;
/** Goal attached to the loaded preset; cleared when the instruction is edited by hand. */
let presetGoal: { instruction: string; goal: Goal[] } | null = null;

function setBusy(b: boolean) {
  busy = b;
  runBtn.hidden = b;
  stopBtn.hidden = !b;
  document.querySelectorAll<HTMLButtonElement>('.presets button').forEach((x) => (x.disabled = b));
  input.disabled = b;
}

function loadScene(s: SceneSpec) {
  scene = s;
  world.load(s);
}

function loadPreset(name: keyof typeof PRESETS) {
  const t = PRESETS[name]();
  input.value = t.instruction;
  presetGoal = { instruction: t.instruction, goal: t.goal };
  loadScene(t.scene);
  feed.clear();
  feed.status('Ready', 'idle');
  feed.note('', 'Ready', 'Press Run, or edit the instruction. Turn on Chaos to watch the agent recover.');
}

/** Perceived-state mode through the dev detector route (see vite.config.ts). */
async function perceive(image: string) {
  const r = await fetch('/api/detect', {
    method: 'POST',
    body: JSON.stringify({ op: 'perceive', image, cam: world.renderer.snapCamera(), cubes: world.sim.cubeNames }),
  });
  const j = await r.json();
  if (!j.cubes) throw new Error(j.detail ?? 'camera detector failed');
  return j.cubes;
}

fetch('/api/detect')
  .then((r) => r.ok && r.headers.get('content-type')?.includes('json') && ($('perceived-wrap').hidden = false))
  .catch(() => {});

async function run() {
  const instruction = input.value.trim();
  if (!instruction || busy) return;
  const goal = presetGoal && presetGoal.instruction === instruction ? presetGoal.goal : undefined;
  let planner: Planner;
  if (plannerSel.value === 'scripted') {
    if (!goal) {
      feed.clear();
      feed.note('error', 'Scripted planner', 'The scripted planner only runs presets. Switch to the LLM planner for free text.');
      return;
    }
    planner = scriptedPlanner(goal);
  } else planner = llmPlanner(transport);

  setBusy(true);
  cancel = false;
  feed.clear();
  // Re-run from the same starting layout, so repeated runs are comparable.
  loadScene(scene);
  const chaos = { ...DEFAULT_CHAOS, enabled: $<HTMLInputElement>('chaos').checked, seed: (Math.random() * 1e9) | 0 };
  try {
    await runEpisode(
      {
        sim: world.sim,
        clock: { realtime: true, frame: () => new Promise((r) => requestAnimationFrame(r)) },
        planner,
        judge: llmJudge(transport),
        snapshot: async () => world.renderer.snapshot(),
        perceive: $<HTMLInputElement>('perceived').checked ? perceive : undefined,
        emit: (e) => feed.handle(e),
        cancelled: () => cancel,
        speed: Number($<HTMLSelectElement>('speed').value),
      },
      { instruction, goal, maxReplans: Number($<HTMLSelectElement>('replans').value), chaos, probe: $<HTMLInputElement>('probe').checked },
    );
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'cancelled') {
      feed.note('error', 'Stopped', 'Run stopped by user.');
      feed.status('Stopped', 'idle');
    } else {
      feed.note('error', 'Error', msg);
      feed.status('Error', 'bad');
    }
  } finally {
    setBusy(false);
  }
}

function frameLoop(last: number) {
  requestAnimationFrame((now) => {
    // While an episode runs, its executor steps physics. Otherwise keep the scene alive here.
    if (!busy && world) {
      const steps = Math.min(25, Math.round(Math.min(0.05, (now - last) / 1000) / world.sim.timestep));
      for (let i = 0; i < steps; i++) world.sim.step();
    }
    if (world) {
      world.renderer.sync(world.sim, busy);
      world.renderer.render();
    }
    frameLoop(now);
  });
}

async function init() {
  try {
    world = await World.create($<HTMLCanvasElement>('scene'), scene);
  } catch (e) {
    $('loading').innerHTML = `<span>Could not load the simulator: ${(e as Error).message}</span>`;
    return;
  }
  loadPreset('stack');
  if (import.meta.env.DEV) (window as unknown as { world: World }).world = world;
  $('loading').classList.add('done');
  frameLoop(performance.now());

  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) =>
    b.addEventListener('click', () => loadPreset(b.dataset.preset as keyof typeof PRESETS)),
  );
  $('shuffle').addEventListener('click', () => {
    presetGoal = null;
    loadScene(randomScene((Math.random() * 1e9) | 0, ['red', 'green', 'blue', 'yellow']));
    feed.clear();
    feed.status('Ready', 'idle');
    input.focus();
  });
  $('task-form').addEventListener('submit', (e) => {
    e.preventDefault();
    run();
  });
  stopBtn.addEventListener('click', () => (cancel = true));

  const dlg = $<HTMLDialogElement>('settings');
  $('open-settings').addEventListener('click', () => {
    $<HTMLInputElement>('key-gemini').value = keys.gemini ?? '';
    $<HTMLInputElement>('key-groq').value = keys.groq ?? '';
    dlg.showModal();
  });
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'save') {
      keys = { gemini: $<HTMLInputElement>('key-gemini').value.trim() || undefined, groq: $<HTMLInputElement>('key-groq').value.trim() || undefined };
    } else if (dlg.returnValue === 'clear') keys = {};
    else return;
    saveKeys(keys);
    $('open-settings').textContent = keys.gemini || keys.groq ? 'Keys: yours' : 'Keys';
  });
  if (keys.gemini || keys.groq) $('open-settings').textContent = 'Keys: yours';
}

init();
