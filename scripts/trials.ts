// Seeded experiments at scale. Runs the agent in parallel headless pages and writes every outcome to CSV.
//
//   npm run trials -- checkpoints [pairs]          minimal pairs: contact gap and placement offset
//   npm run trials -- trials [perKind] [conds]     full episodes, conds like camera/slip,sensors/knock
//   npm run trials -- perceived [perKind] [conds]  same episodes, robot aims at camera cube estimates (A5)
//   npm run trials -- probes [perKind] [conds]     press-probe strategies (B1) and the router (B3)
//
// Outputs go to experiments/data (CSV, committed) and experiments/images (JPEG, ignored).
// Runs resume: rows already in the CSV are skipped. The camera check calls research/vcf/detect.py (OpenCV).
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { chromium, type Page } from 'playwright-core';
import { createServer } from 'vite';

const WORKERS = Number(process.env.WORKERS ?? 6);
const PY = process.env.PYTHON ?? ['research/.venv/Scripts/python.exe', 'research/.venv/bin/python', '../vision-cant-feel/.venv/Scripts/python.exe'].find((p) => fs.existsSync(p)) ?? 'python';
const DATA = 'experiments/data';
const IMG = 'experiments/images';
fs.mkdirSync(DATA, { recursive: true });

const mode = process.argv[2] ?? 'checkpoints';

// ---------- CSV helpers ----------
const esc = (v: unknown) => {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function csv(file: string, cols: string[]) {
  const full = path.join(DATA, file);
  if (!fs.existsSync(full)) fs.writeFileSync(full, cols.join(',') + '\n');
  const done = new Set(
    fs
      .readFileSync(full, 'utf8')
      .split('\n')
      .slice(1)
      .filter(Boolean)
      .map((l) => l.split(',')[0]),
  );
  return {
    done,
    add: (row: Record<string, unknown>) => fs.appendFileSync(full, cols.map((c) => esc(row[c])).join(',') + '\n'),
  };
}

// ---------- OpenCV detector bridge: one Python process per page ----------
class DetectorProc {
  private p: ChildProcessWithoutNullStreams;
  private queue: ((v: any) => void)[] = [];
  constructor() {
    this.p = spawn(PY, ['-u', 'research/vcf/detect.py', '--serve'], { stdio: 'pipe' });
    readline.createInterface({ input: this.p.stdout }).on('line', (l) => this.queue.shift()?.(JSON.parse(l)));
    this.p.stderr.on('data', (d) => process.stderr.write(`[detect] ${d}`));
  }
  call(payload: unknown): Promise<any> {
    return new Promise((res) => {
      this.queue.push(res);
      this.p.stdin.write(JSON.stringify(payload) + '\n');
    });
  }
  close() {
    this.p.stdin.end();
  }
}

// ---------- browser ----------
const server = await createServer({ server: { port: 5300, strictPort: true, hmr: false, watch: null }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({
  channel: fs.existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') ? 'msedge' : 'chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const procs: DetectorProc[] = [];
async function newPage(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 700, height: 600 } });
  page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()));
  const det = new DetectorProc();
  procs.push(det);
  await page.exposeFunction('cvDetect', (payload: unknown) => det.call(payload));
  await page.goto('http://localhost:5300/bench.html');
  await page.waitForFunction(() => 'runTrials' in window);
  return page;
}

/** Runs jobs on WORKERS pages in parallel. Pages are created once and reused. */
const pages: Promise<Page>[] = [];
async function pool<T>(jobs: T[], run: (page: Page, job: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(WORKERS, jobs.length) }, async (_, k) => {
    pages[k] ??= newPage();
    const page = await pages[k];
    while (next < jobs.length) await run(page, jobs[next++]);
  });
  await Promise.all(workers);
}

const t0 = Date.now();
if (mode === 'checkpoints') {
  const pairs = Number(process.argv[3] ?? 60);
  fs.mkdirSync(path.join(IMG, 'checkpoints'), { recursive: true });
  const cols = ['id', 'kind', 'seed', 'param', 'a', 'b', 'truth', 'gapMm', 'sensorContact', 'forceRise', 'switches', 'effort', 'image', 'meta'];
  const out = csv('checkpoints.csv', cols);
  // Deterministic parameters: even seeds are successes, odd seeds failures.
  const jobs: { kind: 'contact' | 'place'; seed: number; param: number }[] = [];
  for (let i = 0; i < 2 * pairs; i++) {
    const u = ((i * 2654435761) % 1000) / 1000;
    jobs.push({ kind: 'contact', seed: 5000 + i, param: i % 2 === 0 ? 0 : +(0.3 + 2.7 * u).toFixed(2) });
    jobs.push({ kind: 'place', seed: 7000 + i, param: i % 2 === 0 ? +(10 * u).toFixed(1) : +(28 + 8 * u).toFixed(1) });
  }
  const todo = jobs.filter((j) => !out.done.has(`${j.kind}-${j.seed}`));
  console.log(`${todo.length} checkpoints to run`);
  await pool(todo, async (page, job) => {
    const r: any = await page.evaluate((cfg) => (window as any).runCheckpoint(cfg), job);
    const id = `${job.kind}-${job.seed}`;
    if (r.error) return console.log(id, 'setup failed:', r.error);
    const img = path.join(IMG, 'checkpoints', `${id}.jpg`);
    fs.writeFileSync(img, Buffer.from(r.image, 'base64'));
    out.add({ ...r, id, image: img.replace(/\\/g, '/'), meta: { cam: r.cam, cubePos: r.cubePos, grip: r.grip, cubes: r.cubes } });
    console.log(id, `truth=${r.truth}`, r.gapMm !== null ? `gap=${r.gapMm.toFixed(2)}mm` : '', `sensors=${r.sensorContact}`);
  });
} else if (mode === 'trials' || mode === 'perceived' || mode === 'probes') {
  const perKind = Number(process.argv[3] ?? 20);
  const perceived = mode === 'perceived';
  const FAILS = ['none', 'slip', 'displace', 'knock', 'chaos'];
  const defaults = perceived
    ? ['oracle/none', 'sensors/none', 'combined/none', 'combined/chaos']
    : mode === 'probes'
      ? FAILS.flatMap((f) => [`sensors+probe/${f}`, `router/${f}`])
      : FAILS.flatMap((f) => ['oracle', 'camera', 'sensors', 'combined'].map((d) => `${d}/${f}`));
  const conds = (process.argv[4] ?? defaults.join(','))
    .split(',')
    .map((c) => c.split('/'));
  const pre = perceived ? 'perceived_' : mode === 'probes' ? 'probe_' : '';
  const ep = csv(`${pre}trials.csv`, ['key', 'decider', 'failure', 'id', 'kind', 'seed', 'truth', 'declared', 'attempts', 'replans', 'injected', 'chaosEvents', 'simSeconds', 'wallSeconds', 'firstTruth', 'firstDeclared', 'failureText']);
  const at = csv(`${pre}attempts.csv`, ['key', 'decider', 'failure', 'id', 'kind', 'attempt', 'truth', 'sensors', 'camera', 'declared', 'stepError', 'seconds', 'cameraDetail', ...(perceived ? ['perceptionMm', 'perceptionMaxMm', 'perceptionMissing'] : []), ...(mode === 'probes' ? ['probe', 'probes', 'probeDetail'] : [])]);
  for (const [cond, failure] of conds) {
    const [decide, probeFlag] = cond.split('+');
    const shards = Array.from({ length: WORKERS }, (_, k) => k);
    console.log(`\n== ${cond}/${failure}`);
    await pool(shards, async (page, k) => {
      const cfg = { perKind, seed: 1000, shard: [k, WORKERS], decide, inject: failure === 'chaos' ? 'none' : failure, chaos: failure === 'chaos', maxReplans: 3, state: perceived ? 'perceived' : 'sim', probe: probeFlag === 'probe' };
      const rows: any[] = await page.evaluate((c) => (window as any).runTrials(c), cfg);
      for (const r of rows) {
        const key = `${cond}/${failure}/${r.id}`;
        if (ep.done.has(key)) continue;
        const first = r.log[0];
        ep.add({ ...r, key, decider: cond, failure, truth: r.success, firstTruth: first?.truth, firstDeclared: first?.declared, failureText: r.failure });
        for (const a of r.log) at.add({ ...a, key: `${key}/${a.attempt}`, decider: cond, failure, id: r.id, kind: r.kind });
      }
      console.log(`  shard ${k}: ${rows.filter((r) => r.success).length}/${rows.length} true successes, ${rows.filter((r) => r.declared && !r.success).length} false`);
    });
  }
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
for (const p of procs) p.close();
await browser.close();
await server.close();
