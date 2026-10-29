// Records docs/demo.gif from the real app: tower preset with chaos on.
// Usage: node --experimental-strip-types scripts/record-demo.ts [preset]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const preset = process.argv[2] ?? 'tower';
const frames = path.resolve('bench/out/frames');
fs.rmSync(frames, { recursive: true, force: true });
fs.mkdirSync(frames, { recursive: true });
fs.mkdirSync('docs', { recursive: true });

const server = await createServer({ server: { port: 5399, strictPort: true, hmr: false, watch: null }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:5399/');
await page.waitForSelector('#loading.done');
await page.click(`[data-preset="${preset}"]`);
await page.check('#chaos', { force: true });
await page.selectOption('#speed', '2');
await page.waitForTimeout(800);
await page.click('#run');

let i = 0;
const start = Date.now();
while (Date.now() - start < 6 * 60_000) {
  await page.screenshot({ path: path.join(frames, `f${String(i++).padStart(4, '0')}.png`) });
  const status = await page.textContent('#status-text');
  if (status === 'Done' || status === 'Failed' || status === 'Error') break;
  await page.waitForTimeout(250);
}
for (let k = 0; k < 12; k++) await page.screenshot({ path: path.join(frames, `f${String(i++).padStart(4, '0')}.png`) });
await browser.close();
await server.close();
console.log('frames', i, 'seconds', ((Date.now() - start) / 1000).toFixed(0));

// Play back about 3x faster than captured; two-pass palette for clean colors.
const vf = 'fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle';
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '12', '-i', path.join(frames, 'f%04d.png'), '-vf', vf, 'docs/demo.gif']);
console.log('docs/demo.gif', (fs.statSync('docs/demo.gif').size / 1e6).toFixed(1), 'MB');
