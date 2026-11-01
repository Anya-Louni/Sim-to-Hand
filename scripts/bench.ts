// Seeded benchmark. Starts Vite, runs the bench page in headless Edge or Chrome, writes bench/results.json and bench/RESULTS.md.
// Usage: npm run bench -- [conditions] [task ids]
//   conditions: comma list of scripted, scripted-chaos, llm, llm-chaos (default: all four)
//   SUITE=hard runs the harder suite (A6) and writes bench/results_hard.json and bench/RESULTS_HARD.md.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { hardReport, report } from './bench-report.ts';
import { JUDGE_SYSTEM, PLAN_SYSTEM } from '../src/llm/prompts.ts';

type Cond = { name: string; planner: 'llm' | 'scripted'; chaos: boolean; vision: boolean };
const ALL: Cond[] = [
  { name: 'scripted', planner: 'scripted', chaos: false, vision: false },
  { name: 'scripted-chaos', planner: 'scripted', chaos: true, vision: false },
  { name: 'llm', planner: 'llm', chaos: false, vision: true },
  { name: 'llm-chaos', planner: 'llm', chaos: true, vision: true },
];
const want = (process.argv[2] ?? ALL.map((c) => c.name).join(',')).split(',');
const ids = process.argv[3]?.split(',');
const MAX_REPLANS = 3;
const SUITE = process.env.SUITE === 'hard' ? 'hard' : 'main';

const server = await createServer({ server: { port: 5299, strictPort: true, hmr: false, watch: null }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({ channel: fs.existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') ? 'msedge' : 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 700, height: 600 } });
page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()));
// Every LLM call is cached on disk, keyed by the exact request and the system prompts (so editing a prompt misses
// the cache instead of replaying answers to the old prompt). A rerun replays the saved answers and costs nothing.
const CACHE = 'bench/llm-cache';
fs.mkdirSync(CACHE, { recursive: true });
let hits = 0;
let misses = 0;
await page.route('**/api/llm', async (route) => {
  const key = createHash('sha256').update(PLAN_SYSTEM + JUDGE_SYSTEM + (route.request().postData() ?? '')).digest('hex');
  const file = `${CACHE}/${key}.json`;
  if (fs.existsSync(file)) {
    hits++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(file, 'utf8') });
  }
  misses++;
  const res = await route.fetch();
  const body = await res.text();
  if (res.ok()) fs.writeFileSync(file, body);
  return route.fulfill({ response: res, body });
});
await page.goto('http://localhost:5299/bench.html');
await page.waitForFunction(() => 'runBench' in window);

fs.mkdirSync('bench', { recursive: true });
const outFile = SUITE === 'hard' ? 'bench/results_hard.json' : 'bench/results.json';
const all: Record<string, any[]> = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')).conditions : {};
for (const cond of ALL.filter((c) => want.includes(c.name))) {
  console.log(`\n== ${cond.name}`);
  const t0 = Date.now();
  let lines = 0;
  const poll = setInterval(async () => {
    const text = await page.textContent('#log').catch(() => '');
    const l = (text ?? '').split('\n');
    for (const line of l.slice(lines)) if (line.trim()) console.log(line);
    lines = l.length;
  }, 2000);
  const rows = await page.evaluate((cfg) => (window as any).runBench(cfg), { ids, suite: SUITE, chaos: cond.chaos, planner: cond.planner, vision: cond.vision, maxReplans: MAX_REPLANS });
  clearInterval(poll);
  console.log(`${cond.name}: ${rows.filter((r: any) => r.success).length}/${rows.length} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  all[cond.name] = rows;
  fs.writeFileSync(outFile, JSON.stringify({ date: new Date().toISOString(), maxReplans: MAX_REPLANS, conditions: all }, null, 2));
}
console.log(`LLM cache: ${hits} hits, ${misses} new calls`);
await browser.close();
await server.close();

// Summary with Wilson intervals; the same code runs alone as scripts/bench-report.ts.
const md = SUITE === 'hard' ? hardReport(all) : report(all);
fs.writeFileSync(SUITE === 'hard' ? 'bench/RESULTS_HARD.md' : 'bench/RESULTS.md', md);
console.log('\n' + md);
