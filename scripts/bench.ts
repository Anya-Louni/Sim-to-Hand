// Seeded benchmark. Starts Vite, runs the bench page in headless Edge or Chrome, writes bench/results.json and bench/RESULTS.md.
// Usage: npm run bench -- [conditions] [task ids]
//   conditions: comma list of scripted, scripted-chaos, llm, llm-chaos (default: all four)
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

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

const server = await createServer({ server: { port: 5299, strictPort: true, hmr: false, watch: null }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({ channel: fs.existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') ? 'msedge' : 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 700, height: 600 } });
page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()));
await page.goto('http://localhost:5299/bench.html');
await page.waitForFunction(() => 'runBench' in window);

fs.mkdirSync('bench', { recursive: true });
const outFile = 'bench/results.json';
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
  const rows = await page.evaluate((cfg) => (window as any).runBench(cfg), { ids, chaos: cond.chaos, planner: cond.planner, vision: cond.vision, maxReplans: MAX_REPLANS });
  clearInterval(poll);
  console.log(`${cond.name}: ${rows.filter((r: any) => r.success).length}/${rows.length} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  all[cond.name] = rows;
  fs.writeFileSync(outFile, JSON.stringify({ date: new Date().toISOString(), maxReplans: MAX_REPLANS, conditions: all }, null, 2));
}
await browser.close();
await server.close();

// Summary table.
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : 'n/a');
let md = `| Condition | Tasks | Success | Avg replans | Avg chaos events | Vision agrees with sim | Sensors agree with sim | LLM calls |\n|---|---|---|---|---|---|---|---|\n`;
for (const c of ALL) {
  const rows = all[c.name];
  if (!rows) continue;
  const n = rows.length;
  const ok = rows.filter((r) => r.success).length;
  const avg = (k: string) => (rows.reduce((s, r) => s + r[k], 0) / n).toFixed(2);
  const vc = rows.reduce((s, r) => s + r.visionChecks, 0);
  const va = rows.reduce((s, r) => s + r.visionAgreements, 0);
  const sc = rows.reduce((s, r) => s + (r.sensorChecks ?? 0), 0);
  const sa = rows.reduce((s, r) => s + (r.sensorAgreements ?? 0), 0);
  md += `| ${c.name} | ${n} | ${ok}/${n} (${pct(ok, n)}) | ${avg('replans')} | ${avg('chaosEvents')} | ${vc ? `${va}/${vc} (${pct(va, vc)})` : 'not run'} | ${sc ? `${sa}/${sc} (${pct(sa, sc)})` : 'not run'} | ${rows.reduce((s, r) => s + r.llmCalls, 0)} |\n`;
}
md += `\nPer-kind success:\n\n| Condition | stack | tower | sort | zone |\n|---|---|---|---|---|\n`;
for (const c of ALL) {
  const rows = all[c.name];
  if (!rows) continue;
  const k = (kind: string) => {
    const r = rows.filter((x) => x.kind === kind);
    return `${r.filter((x) => x.success).length}/${r.length}`;
  };
  md += `| ${c.name} | ${k('stack')} | ${k('tower')} | ${k('sort')} | ${k('zone')} |\n`;
}
const prov: Record<string, number> = {};
for (const rows of Object.values(all)) for (const r of rows) for (const p of r.providers ?? []) prov[p] = (prov[p] ?? 0) + 1;
md += `
Calls by provider: ${Object.entries(prov).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}
`;
const dis = Object.entries(all).flatMap(([name, rows]) => rows.flatMap((r: any) => r.disagreements.map((d: any) => `- ${name} ${r.id} attempt ${d.attempt + 1}: sim=${d.ground ? 'success' : 'failure'}, vision=${d.vision ? 'success' : 'failure'}. Vision said: "${d.reason}"`)));
md += `\nVision disagreements (${dis.length}):\n\n${dis.join('\n') || 'none'}\n`;
const fails = Object.entries(all).flatMap(([name, rows]) => rows.filter((r: any) => !r.success).map((r: any) => `- ${name} ${r.id}: ${r.failure ?? r.error}`));
md += `\nFailures (${fails.length}):\n\n${fails.join('\n') || 'none'}\n`;
fs.writeFileSync('bench/RESULTS.md', md);
console.log('\n' + md);
