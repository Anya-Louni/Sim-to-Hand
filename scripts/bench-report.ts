// Builds bench/RESULTS.md from bench/results.json. No browser, no API calls.
// Usage: node --experimental-strip-types scripts/bench-report.ts
import fs from 'node:fs';

export const CONDITIONS = ['scripted', 'scripted-chaos', 'llm', 'llm-chaos'];
const KINDS = ['stack', 'tower', 'sort', 'zone'];

/** 95% Wilson interval for k successes out of n. */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [NaN, NaN];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

/** "21/24 = 88% [69, 96]" */
export function rate(k: number, n: number): string {
  if (!n) return 'not run';
  const [lo, hi] = wilson(k, n);
  return `${k}/${n} = ${Math.round((100 * k) / n)}% [${Math.round(100 * lo)}, ${Math.round(100 * hi)}]`;
}

export function report(all: Record<string, any[]>): string {
  let md = 'Brackets are 95% Wilson confidence intervals.\n\n';
  md += `| Condition | Tasks | Success | Avg replans | Avg chaos events | Vision agrees with sim | Sensors agree with sim | LLM calls |\n|---|---|---|---|---|---|---|---|\n`;
  for (const c of CONDITIONS) {
    const rows = all[c];
    if (!rows) continue;
    const n = rows.length;
    const sum = (k: string) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
    const avg = (k: string) => (sum(k) / n).toFixed(2);
    md += `| ${c} | ${n} | ${rate(rows.filter((r) => r.success).length, n)} | ${avg('replans')} | ${avg('chaosEvents')} | ${rate(sum('visionAgreements'), sum('visionChecks'))} | ${rate(sum('sensorAgreements'), sum('sensorChecks'))} | ${sum('llmCalls')} |\n`;
  }
  md += `\nPer-kind success:\n\n| Condition | ${KINDS.join(' | ')} |\n|---|${KINDS.map(() => '---|').join('')}\n`;
  for (const c of CONDITIONS) {
    const rows = all[c];
    if (!rows) continue;
    const k = (kind: string) => {
      const r = rows.filter((x) => x.kind === kind);
      return `${r.filter((x) => x.success).length}/${r.length}`;
    };
    md += `| ${c} | ${KINDS.map(k).join(' | ')} |\n`;
  }
  const prov: Record<string, number> = {};
  for (const rows of Object.values(all)) for (const r of rows) for (const p of r.providers ?? []) if (p !== 'scripted') prov[p] = (prov[p] ?? 0) + 1;
  md += `\nCalls by provider: ${Object.entries(prov).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}\n`;
  const dis = Object.entries(all).flatMap(([name, rows]) =>
    rows.flatMap((r: any) => r.disagreements.map((d: any) => `- ${name} ${r.id} attempt ${d.attempt + 1}: sim=${d.ground ? 'success' : 'failure'}, vision=${d.vision ? 'success' : 'failure'}. Vision said: "${d.reason}"`)),
  );
  md += `\nVision disagreements (${dis.length}):\n\n${dis.join('\n') || 'none'}\n`;
  const fails = Object.entries(all).flatMap(([name, rows]) => rows.filter((r: any) => !r.success).map((r: any) => `- ${name} ${r.id}: ${r.failure ?? r.error}`));
  md += `\nFailures (${fails.length}):\n\n${fails.join('\n') || 'none'}\n`;
  return md;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('bench-report.ts')) {
  const all = JSON.parse(fs.readFileSync('bench/results.json', 'utf8')).conditions;
  fs.writeFileSync('bench/RESULTS.md', report(all));
  console.log('wrote bench/RESULTS.md');
}
