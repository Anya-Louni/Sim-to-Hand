import { CUBE_HALF, HOVER_Z, mulberry32, zoneByName } from './scene.ts';
import { average, CheapSensors, type Reading, type SensorEvent } from './sensors.ts';
import type { Pose, Sim } from './sim.ts';
import type { Skill } from './types.ts';

export interface Clock {
  /** Wait for the next frame (realtime) or yield briefly (fast mode). */
  frame(): Promise<number>;
  realtime: boolean;
}

export interface ChaosOptions {
  enabled: boolean;
  seed: number;
  slipProb: number;
  nudgeProb: number;
  maxEvents: number;
}

export const DEFAULT_CHAOS: ChaosOptions = { enabled: false, seed: 1, slipProb: 0.2, nudgeProb: 0.12, maxEvents: 2 };

export type ExecEvent = { type: 'chaos'; message: string } | { type: 'note'; message: string };

export interface StepResult {
  ok: boolean;
  error?: string;
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const minJerk = (t: number) => t * t * t * (10 - 15 * t + 6 * t * t);

export class Executor {
  holding: string | null = null;
  private rand: () => number;
  private chaosCount = 0;
  private pendingSlip: number | null = null;
  speed = 1;
  private sim: Sim;
  private clock: Clock;
  private chaos: ChaosOptions;
  private emit: (e: ExecEvent) => void;
  private cancelled: () => boolean;
  /** Cheap, noisy sensors the agent uses to check its own grasps and placements. */
  private sensors: CheapSensors;
  sensorEvents: SensorEvent[] = [];

  constructor(sim: Sim, clock: Clock, chaos: ChaosOptions, emit: (e: ExecEvent) => void = () => {}, cancelled: () => boolean = () => false) {
    this.sim = sim;
    this.clock = clock;
    this.chaos = chaos;
    this.emit = emit;
    this.cancelled = cancelled;
    this.rand = mulberry32(chaos.seed * 7919 + 13);
    this.sensors = new CheapSensors(chaos.seed);
  }

  /** Average of eight sensor reads taken over 80 ms. */
  async sense(): Promise<Reading> {
    const reads: Reading[] = [];
    let k = 0;
    await this.advance(0.08, () => {
      if (k++ % 5 === 0) reads.push(this.sensors.read(this.sim.rawSensors()));
    });
    return average(reads);
  }

  /** Held, according to the sensors: both fingertip switches on and the fingers not fully closed. */
  private async sensedHold(): Promise<{ held: boolean; r: Reading }> {
    const r = await this.sense();
    return { held: r.switchLeft >= 0.5 && r.switchRight >= 0.5 && this.sim.gripWidth() > 0.03, r };
  }

  /** Reset per-attempt chaos budget. */
  newAttempt() {
    this.chaosCount = 0;
    this.sensorEvents = [];
  }

  /** Advance simulated time, optionally driving a per-step callback with progress 0..1. */
  async advance(seconds: number, during?: (alpha: number) => void) {
    const sim = this.sim;
    const dt = sim.timestep;
    const total = Math.max(1, Math.round(seconds / dt));
    let done = 0;
    let last = this.clock.realtime ? await this.clock.frame() : 0;
    while (done < total) {
      if (this.cancelled()) throw new Error('cancelled');
      let n: number;
      if (this.clock.realtime) {
        const now = await this.clock.frame();
        const wall = Math.min(0.05, (now - last) / 1000) * this.speed;
        last = now;
        n = Math.max(1, Math.round(wall / dt));
      } else {
        n = 400;
      }
      n = Math.min(n, total - done);
      for (let i = 0; i < n; i++) {
        during?.(done / total);
        this.checkSlip();
        sim.step();
        done++;
      }
      if (!this.clock.realtime) await this.clock.frame();
    }
  }

  private checkSlip() {
    if (this.pendingSlip === null) return;
    const t = this.sim.time;
    if (t >= this.pendingSlip && t < this.pendingSlip + 0.3) this.sim.grip = 1;
    else if (t >= this.pendingSlip + 0.3) {
      this.sim.grip = 0;
      this.pendingSlip = null;
    }
  }

  private chaosRoll(p: number) {
    return this.chaos.enabled && this.chaosCount < this.chaos.maxEvents && this.rand() < p;
  }

  /** Called between plan steps: maybe shove a cube. */
  maybeNudge() {
    if (!this.chaosRoll(this.chaos.nudgeProb)) return;
    const free = this.sim.cubeNames.filter((n) => n !== this.holding);
    if (!free.length) return;
    const name = free[Math.floor(this.rand() * free.length)];
    const ang = this.rand() * Math.PI * 2;
    const v = 0.5 + this.rand() * 0.3;
    this.sim.shove(name, Math.cos(ang) * v, Math.sin(ang) * v);
    this.chaosCount++;
    this.emit({ type: 'chaos', message: `Nudged the ${name} cube` });
  }

  private maybeScheduleSlip(window: number) {
    if (!this.holding || !this.chaosRoll(this.chaos.slipProb)) return;
    this.pendingSlip = this.sim.time + (0.25 + this.rand() * 0.5) * window;
    this.chaosCount++;
    this.emit({ type: 'chaos', message: `Grasp on the ${this.holding} cube will slip` });
  }

  /** Smooth Cartesian move of the gripper target. */
  async moveTo(pos: [number, number, number], yaw: number, duration?: number) {
    const start: Pose = { pos: [...this.sim.target.pos] as [number, number, number], yaw: this.sim.target.yaw };
    const dist = Math.hypot(pos[0] - start.pos[0], pos[1] - start.pos[1], pos[2] - start.pos[2]);
    const dyaw = wrapAngle(yaw - start.yaw);
    const T = duration ?? Math.max(0.5, dist / 0.28 + Math.abs(dyaw) * 0.3);
    await this.advance(T, (a) => {
      const s = minJerk(a);
      this.sim.target = {
        pos: [0, 1, 2].map((i) => start.pos[i] + (pos[i] - start.pos[i]) * s) as [number, number, number],
        yaw: start.yaw + dyaw * s,
      };
    });
    this.sim.target = { pos, yaw: start.yaw + dyaw };
    await this.advance(0.15);
  }

  async setGrip(open: boolean, wait = 0.5) {
    this.sim.grip = open ? 1 : 0;
    await this.advance(wait);
  }

  isHeld(name: string): boolean {
    const c = this.sim.cube(name).pos;
    const g = this.sim.gripPos();
    return Math.hypot(c[0] - g[0], c[1] - g[1], c[2] - g[2]) < 0.035 && this.sim.gripWidth() > 0.03;
  }

  /** Gripper yaw that aligns the fingers with a cube face, closest to the current yaw. */
  private alignYaw(cubeYaw: number): number {
    const cur = this.sim.target.yaw;
    let best = cur;
    let bestD = Infinity;
    for (let k = -4; k <= 4; k++) {
      const y = cubeYaw + (k * Math.PI) / 2;
      // Stay near the home yaw so joint 7 keeps range.
      if (Math.abs(wrapAngle(y - this.sim.homeYaw)) > Math.PI / 2 + 0.01) continue;
      const d = Math.abs(wrapAngle(y - cur));
      if (d < bestD) {
        bestD = d;
        best = cur + wrapAngle(y - cur);
      }
    }
    return best;
  }

  /** Resolve a cube or zone name to a table position and alignment yaw. */
  private resolve(name: string): { x: number; y: number; topZ: number; yaw: number; isCube: boolean } | null {
    if (this.sim.cubeNames.includes(name)) {
      const c = this.sim.cube(name);
      return { x: c.pos[0], y: c.pos[1], topZ: c.pos[2] + CUBE_HALF, yaw: c.yaw, isCube: true };
    }
    const z = zoneByName(name);
    if (z) return { x: z.x, y: z.y, topZ: 0, yaw: this.sim.target.yaw, isCube: false };
    return null;
  }

  private async checkDrop(skill: string, context: string): Promise<StepResult> {
    if (!this.holding) return { ok: true };
    const { held, r } = await this.sensedHold();
    if (!held) {
      const name = this.holding;
      this.holding = null;
      this.sensorEvents.push({ skill, check: 'hold', ok: false, detail: `switches ${r.switchLeft.toFixed(1)}/${r.switchRight.toFixed(1)} after ${context}` });
      return { ok: false, error: `Sensors lost the ${name} cube ${context}: fingertip switches went off.` };
    }
    return { ok: true };
  }

  async run(skill: Skill): Promise<StepResult> {
    switch (skill.skill) {
      case 'move_to': {
        const r = this.resolve(skill.target);
        if (!r) return { ok: false, error: `Unknown target "${skill.target}".` };
        const yaw = r.isCube && !this.holding ? this.alignYaw(r.yaw) : this.sim.target.yaw;
        this.maybeScheduleSlip(1.5);
        await this.moveTo([r.x, r.y, HOVER_Z], yaw);
        return this.checkDrop('move_to', `while moving to ${skill.target}`);
      }
      case 'grasp': {
        if (this.holding) return { ok: false, error: `Already holding the ${this.holding} cube.` };
        if (!this.sim.cubeNames.includes(skill.object)) return { ok: false, error: `Unknown object "${skill.object}".` };
        await this.setGrip(true, 0.2);
        let c = this.sim.cube(skill.object);
        const yaw = this.alignYaw(c.yaw);
        const g = this.sim.gripPos();
        if (Math.hypot(g[0] - c.pos[0], g[1] - c.pos[1]) > 0.01 || g[2] < c.pos[2] + 0.08) {
          await this.moveTo([c.pos[0], c.pos[1], Math.max(c.pos[2] + 0.12, Math.min(HOVER_Z, g[2]))], yaw);
        }
        c = this.sim.cube(skill.object);
        await this.moveTo([c.pos[0], c.pos[1], c.pos[2] + 0.004], this.alignYaw(c.yaw), 0.9);
        await this.setGrip(false, 0.6);
        if (this.sim.gripWidth() < 0.03) {
          return { ok: false, error: `Grasp missed the ${skill.object} cube: the gripper closed on nothing.` };
        }
        const { held, r } = await this.sensedHold();
        const ok = held && Math.abs(r.effort) > 5;
        this.sensorEvents.push({ skill: `grasp(${skill.object})`, check: 'grasp', ok, detail: `switches ${r.switchLeft.toFixed(1)}/${r.switchRight.toFixed(1)}, effort ${r.effort.toFixed(1)} N` });
        if (!ok) {
          return { ok: false, error: `Grasp failed: the fingertip sensors do not feel the ${skill.object} cube.` };
        }
        this.holding = skill.object;
        return { ok: true };
      }
      case 'lift': {
        if (!this.holding) return { ok: false, error: 'Lift called while not holding anything.' };
        const g = this.sim.gripPos();
        this.maybeScheduleSlip(1.0);
        await this.moveTo([g[0], g[1], HOVER_Z], this.sim.target.yaw);
        await this.advance(0.3);
        return this.checkDrop('lift', 'during lift');
      }
      case 'place': {
        if (!this.holding) return { ok: false, error: 'Place called while not holding anything.' };
        if (skill.on === this.holding) return { ok: false, error: 'Cannot place a cube on itself.' };
        const r = this.resolve(skill.on);
        if (!r) return { ok: false, error: `Unknown place target "${skill.on}".` };
        const yaw = r.isCube ? this.alignYaw(r.yaw) : this.sim.target.yaw;
        this.maybeScheduleSlip(2.0);
        await this.moveTo([r.x, r.y, HOVER_Z], yaw);
        let res = await this.checkDrop('place', `while carrying it to ${skill.on}`);
        if (!res.ok) return res;
        const r2 = this.resolve(skill.on)!;
        // Lower until contact: stop on a rise in tool-axis force, then confirm contact with the cheap sensor.
        await this.moveTo([r2.x, r2.y, r2.topZ + CUBE_HALF + 0.015], yaw, 1.0);
        const rise = await this.guardedLower(r2.topZ + CUBE_HALF - 0.004, 4);
        const contact = rise > 2;
        this.sensorEvents.push({ skill: `place(${skill.on})`, check: 'contact', ok: contact, detail: `peak wrist force change ${rise.toFixed(1)} N` });
        res = await this.checkDrop('place', `while lowering it onto ${skill.on}`);
        if (!res.ok) return res;
        if (!contact) return { ok: false, error: `No contact felt when lowering the ${this.holding} cube onto ${skill.on}.` };
        return res;
      }
      case 'release': {
        const g = this.sim.gripPos();
        await this.setGrip(true, 0.4);
        this.holding = null;
        await this.moveTo([g[0], g[1], Math.min(HOVER_Z, g[2] + 0.12)], this.sim.target.yaw, 0.7);
        return { ok: true };
      }
    }
  }

  /** Lower the gripper toward z, stopping early when the raw tool-axis force changes by more than guard N. */
  private async guardedLower(z: number, guard: number): Promise<number> {
    const tare = (await this.sense()).force;
    const start = [...this.sim.target.pos] as [number, number, number];
    const f0 = this.sim.rawSensors().forceTool;
    let stopped = false;
    let peak = 0;
    let k = 0;
    await this.advance(0.8, (a) => {
      if (k++ % 5 === 0) peak = Math.max(peak, Math.abs(this.sensors.read(this.sim.rawSensors()).force - tare));
      if (stopped) return;
      if (Math.abs(this.sim.rawSensors().forceTool - f0) > guard) {
        stopped = true;
        const g = this.sim.gripPos();
        this.sim.target = { pos: [start[0], start[1], g[2]], yaw: this.sim.target.yaw };
        return;
      }
      const s = minJerk(a);
      this.sim.target = { pos: [start[0], start[1], start[2] + (z - start[2]) * s], yaw: this.sim.target.yaw };
    });
    await this.advance(0.2);
    return peak;
  }

  /** Move out of the camera's way and let the scene settle. */
  async retreat() {
    if (!this.holding) this.sim.grip = 1;
    await this.moveTo([0.28, 0, 0.42], this.sim.homeYaw);
    await this.advance(0.6);
  }
}
