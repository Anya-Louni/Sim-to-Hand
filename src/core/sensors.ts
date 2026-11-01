import { mulberry32 } from './scene.ts';

/**
 * Cheap-sensor model, ported from research/vcf/sensors.py (strength 1):
 *   contact switches  threshold 0.3 N per fingertip, 2% random flips
 *   gripper effort    motor-current proxy, noise 0.6 N, 10-bit ADC over +-40 N
 *   wrist force       one axis along the tool, noise 0.5 N, 8-bit ADC over +-30 N, fixed offset up to 1.5 N
 *   dropouts          2% of reads return the previous value
 * Latency and drift from the research model are left out here because the agent reads sensors at single moments.
 *
 * sensorSet 'ft6' adds a 6-axis wrist force/torque reading (research/vcf/sensors.py degrade_ft): each force axis
 * uses the force model above, each torque axis noise 0.02 N m, 8-bit ADC over +-3 N m, offset up to 0.1 N m.
 * The extra random draws come after the single-axis ones, so the default readings are unchanged.
 */
export type SensorSet = 'single' | 'ft6';

export interface Reading {
  switchLeft: number;
  switchRight: number;
  effort: number;
  force: number;
  /** ft6 only: fx, fy, fz (N), tx, ty, tz (N m) in the wrist frame. */
  ft?: number[];
}

export interface RawSensors {
  touchLeft: number;
  touchRight: number;
  effort: number;
  forceTool: number;
  ft?: number[];
}

const FT_NOISE = [0.5, 0.5, 0.5, 0.02, 0.02, 0.02];
const FT_SPAN = [30, 30, 30, 3, 3, 3];
const FT_OFFSET = [1.5, 1.5, 1.5, 0.1, 0.1, 0.1];

const quantize = (x: number, bits: number, span: number) => {
  const step = (2 * span) / 2 ** bits;
  return Math.max(-span, Math.min(span, Math.round(x / step) * step));
};

export class CheapSensors {
  private rand: () => number;
  private offset: number;
  private last: Reading | null = null;
  private ftOffset: number[] = [];
  readonly sensorSet: SensorSet;

  constructor(seed: number, sensorSet: SensorSet = 'single') {
    this.sensorSet = sensorSet;
    this.rand = mulberry32(seed * 104729 + 7);
    this.offset = (this.rand() * 2 - 1) * 1.5;
    if (sensorSet === 'ft6') this.ftOffset = FT_OFFSET.map((o) => (this.rand() * 2 - 1) * o);
  }

  private gauss(sd: number) {
    const u = Math.max(1e-9, this.rand());
    return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rand());
  }

  read(raw: RawSensors): Reading {
    if (this.last && this.rand() < 0.02) return this.last;
    const sw = (v: number) => {
      const on = v > 0.3 ? 1 : 0;
      return this.rand() < 0.02 ? 1 - on : on;
    };
    const r: Reading = {
      switchLeft: sw(raw.touchLeft),
      switchRight: sw(raw.touchRight),
      effort: quantize(raw.effort + this.gauss(0.6), 10, 40),
      force: quantize(raw.forceTool + this.offset + this.gauss(0.5), 8, 30),
    };
    if (this.sensorSet === 'ft6' && raw.ft) r.ft = raw.ft.map((v, k) => quantize(v + this.ftOffset[k] + this.gauss(FT_NOISE[k]), 8, FT_SPAN[k]));
    this.last = r;
    return r;
  }
}

/** Mean of several reads, to ride over flips and dropouts. */
export function average(reads: Reading[]): Reading {
  const n = reads.length || 1;
  const sum = (k: 'switchLeft' | 'switchRight' | 'effort' | 'force') => reads.reduce((s, r) => s + r[k], 0) / n;
  const out: Reading = { switchLeft: sum('switchLeft'), switchRight: sum('switchRight'), effort: sum('effort'), force: sum('force') };
  if (reads[0]?.ft) out.ft = reads[0].ft.map((_, k) => reads.reduce((s, r) => s + (r.ft?.[k] ?? 0), 0) / n);
  return out;
}

export interface SensorEvent {
  skill: string;
  check: 'grasp' | 'contact' | 'hold';
  ok: boolean;
  detail: string;
}
