// The cheap-sensor model must stay inside its stated spec: noise, quantization, offset, flips and dropouts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { average, CheapSensors, type Reading } from '../src/core/sensors.ts';

const N = 20000;
const raw = { touchLeft: 1.0, touchRight: 0.0, effort: 10.0, forceTool: -5.0 };

function sample(seed: number) {
  const s = new CheapSensors(seed);
  const reads: Reading[] = [];
  let dropouts = 0;
  for (let i = 0; i < N; i++) {
    const r = s.read(raw);
    if (reads.length && r === reads[reads.length - 1]) dropouts++; // a dropout returns the previous read object
    reads.push(r);
  }
  return { reads, dropouts };
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a: number[]) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)));

test('dropouts happen about 2% of the time', () => {
  const { dropouts } = sample(1);
  assert.ok(Math.abs(dropouts / N - 0.02) < 0.005, `dropout rate ${dropouts / N}`);
});

test('contact switches flip about 2% of the time', () => {
  const { reads } = sample(2);
  const left = reads.filter((r) => r.switchLeft === 0).length / N; // touching, so 0 is a flip
  const right = reads.filter((r) => r.switchRight === 1).length / N; // not touching, so 1 is a flip
  for (const f of [left, right]) assert.ok(Math.abs(f - 0.02) < 0.006, `flip rate ${f}`);
});

test('effort: noise about 0.6 N on a 10-bit grid over +-40 N', () => {
  const { reads } = sample(3);
  const e = reads.map((r) => r.effort);
  const step = 80 / 1024;
  for (const v of e) assert.ok(Math.abs(v / step - Math.round(v / step)) < 1e-9, `off-grid ${v}`);
  assert.ok(Math.abs(mean(e) - 10) < 0.05, `mean ${mean(e)}`);
  assert.ok(Math.abs(sd(e) - 0.6) < 0.05, `sd ${sd(e)}`);
});

test('wrist force: 8-bit grid over +-30 N, noise about 0.5 N, fixed offset within 1.5 N', () => {
  for (const seed of [4, 5, 6, 7]) {
    const { reads } = sample(seed);
    const f = reads.map((r) => r.force);
    const step = 60 / 256;
    for (const v of f) assert.ok(Math.abs(v / step - Math.round(v / step)) < 1e-9, `off-grid ${v}`);
    const offset = mean(f) - raw.forceTool;
    assert.ok(Math.abs(offset) <= 1.5 + 0.05, `offset ${offset}`);
    assert.ok(Math.abs(sd(f) - Math.hypot(0.5, step / Math.sqrt(12))) < 0.06, `sd ${sd(f)}`);
  }
});

test('readings saturate at the converter range', () => {
  const s = new CheapSensors(8);
  for (let i = 0; i < 200; i++) {
    const r = s.read({ touchLeft: 0, touchRight: 0, effort: 500, forceTool: -500 });
    assert.equal(r.effort, 40);
    assert.equal(r.force, -30);
  }
});

test('the same seed gives the same readings', () => {
  const a = new CheapSensors(9);
  const b = new CheapSensors(9);
  for (let i = 0; i < 100; i++) assert.deepEqual(a.read(raw), b.read(raw));
});

test('average is the per-channel mean', () => {
  const r = average([
    { switchLeft: 1, switchRight: 0, effort: 2, force: 4 },
    { switchLeft: 0, switchRight: 0, effort: 4, force: 8 },
  ]);
  assert.deepEqual(r, { switchLeft: 0.5, switchRight: 0, effort: 3, force: 6 });
});

test('ft6 adds a 6-axis reading on its grids and leaves the single-axis reads unchanged', () => {
  const ft = [1, -2, -5, 0.05, -0.1, 0.02];
  const a = new CheapSensors(7);
  const b = new CheapSensors(7, 'ft6');
  const fz: number[] = [];
  for (let i = 0; i < 2000; i++) {
    const ra = a.read({ ...raw, ft });
    const rb = b.read({ ...raw, ft });
    assert.equal(ra.ft, undefined);
    assert.equal(rb.ft!.length, 6);
    rb.ft!.forEach((v, k) => {
      const step = (2 * (k < 3 ? 30 : 3)) / 256;
      assert.ok(Math.abs(v / step - Math.round(v / step)) < 1e-9, `axis ${k} off-grid ${v}`);
    });
    fz.push(rb.ft![2]);
  }
  assert.ok(Math.abs(mean(fz) - -5) < 1.6, `fz mean ${mean(fz)}`);
  assert.ok(Math.abs(sd(fz) - 0.5) < 0.1, `fz sd ${sd(fz)}`);
  assert.equal(average([new CheapSensors(1, 'ft6').read({ ...raw, ft })]).ft!.length, 6);
});
