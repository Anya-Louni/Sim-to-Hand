import { mulberry32 } from './scene.ts';

/**
 * Cheap-sensor model, ported from research/vcf/sensors.py (strength 1):
 *   contact switches  threshold 0.3 N per fingertip, 2% random flips
 *   gripper effort    motor-current proxy, noise 0.6 N, 10-bit ADC over +-40 N
 *   wrist force       one axis along the tool, noise 0.5 N, 8-bit ADC over +-30 N, fixed offset up to 1.5 N
 *   dropouts          2% of reads return the previous value
 * Latency and drift from the research model are left out here because the agent reads sensors at single moments.
 */
export interface Reading {
  switchLeft: number;
  switchRight: number;
  effort: number;
  force: number;
}

export interface RawSensors {
  touchLeft: number;
  touchRight: number;
  effort: number;
  forceTool: number;
}

const quantize = (x: number, bits: number, span: number) => {
  const step = (2 * span) / 2 ** bits;
  return Math.max(-span, Math.min(span, Math.round(x / step) * step));
};

export class CheapSensors {
  private rand: () => number;
  private offset: number;
  private last: Reading | null = null;

  constructor(seed: number) {
    this.rand = mulberry32(seed * 104729 + 7);
    this.offset = (this.rand() * 2 - 1) * 1.5;
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
    this.last = r;
    return r;
  }
}

/** Mean of several reads, to ride over flips and dropouts. */
export function average(reads: Reading[]): Reading {
  const n = reads.length || 1;
  const sum = (k: keyof Reading) => reads.reduce((s, r) => s + r[k], 0) / n;
  return { switchLeft: sum('switchLeft'), switchRight: sum('switchRight'), effort: sum('effort'), force: sum('force') };
}

export interface SensorEvent {
  skill: string;
  check: 'grasp' | 'contact' | 'hold';
  ok: boolean;
  detail: string;
}
