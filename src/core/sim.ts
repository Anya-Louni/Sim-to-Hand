import { sceneXml } from './scene.ts';
import type { SceneSpec } from './types.ts';

// The MuJoCo module is typed loosely; the bindings expose live typed-array views.
type MJ = any;

export const ARM_DOF = 7;
export const Q_HOME = [0, -0.25, 0, -2.3, 0, 2.05, 0.785];

export interface Pose {
  pos: [number, number, number];
  yaw: number;
}

export interface CubeState {
  name: string;
  pos: [number, number, number];
  quat: [number, number, number, number];
  yaw: number;
  speed: number;
}

/** Solves a small dense system A x = b in place (Gaussian elimination, partial pivoting). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

export class Sim {
  mj: MJ;
  m: MJ;
  d: MJ;
  private ikd: MJ;
  private vfs: MJ;
  private jacp: MJ;
  private jacr: MJ;
  readonly site: number;
  readonly cubeNames: string[];
  private cubeQ = new Map<string, number>();
  private cubeV = new Map<string, number>();
  private jntRange: [number, number][] = [];
  /** Current IK joint solution, used as the arm position command. */
  ikQ: number[] = [...Q_HOME];
  /** Commanded gripper opening, 0 closed to 1 open. */
  grip = 1;
  /** Cartesian target the controller is tracking. */
  target: Pose = { pos: [0.3, 0, 0.4], yaw: 0 };
  homeYaw = 0;

  constructor(mj: MJ, files: Record<string, Uint8Array>, scene: SceneSpec) {
    this.mj = mj;
    this.vfs = new mj.MjVFS();
    for (const [p, buf] of Object.entries(files)) this.vfs.addBuffer(p, buf);
    this.m = mj.MjModel.from_xml_string(sceneXml(scene), this.vfs);
    this.d = new mj.MjData(this.m);
    this.ikd = new mj.MjData(this.m);
    const nv = this.m.nv;
    this.jacp = new mj.DoubleBuffer(3 * nv);
    this.jacr = new mj.DoubleBuffer(3 * nv);
    this.site = mj.mj_name2id(this.m, mj.mjtObj.mjOBJ_SITE.value, 'grip');
    for (let j = 0; j < ARM_DOF; j++) this.jntRange.push([this.m.jnt_range[j * 2], this.m.jnt_range[j * 2 + 1]]);
    this.cubeNames = scene.cubes.map((c) => c.name);
    for (const name of this.cubeNames) {
      const j = mj.mj_name2id(this.m, mj.mjtObj.mjOBJ_JOINT.value, name);
      this.cubeQ.set(name, this.m.jnt_qposadr[j]);
      this.cubeV.set(name, this.m.jnt_dofadr[j]);
    }
    this.resetArm();
  }

  dispose() {
    this.jacp.delete();
    this.jacr.delete();
    this.ikd.delete();
    this.d.delete();
    this.m.delete();
    this.vfs.delete();
  }

  get time(): number {
    return this.d.time;
  }

  get timestep(): number {
    return this.m.opt.timestep;
  }

  private resetArm() {
    const q = this.d.qpos;
    for (let i = 0; i < ARM_DOF; i++) q[i] = Q_HOME[i];
    q[7] = q[8] = 0.04;
    this.mj.mj_forward(this.m, this.d);
    this.ikQ = [...Q_HOME];
    const p = this.gripPos();
    const R = this.d.site_xmat;
    const s = this.site * 9;
    // Site x axis is (cos yaw, sin yaw, 0) when pointing down.
    this.homeYaw = Math.atan2(R[s + 3], R[s + 0]);
    this.target = { pos: p, yaw: this.homeYaw };
    this.applyCtrl();
  }

  gripPos(): [number, number, number] {
    const s = this.site * 3;
    const x = this.d.site_xpos;
    return [x[s], x[s + 1], x[s + 2]];
  }

  /** Finger separation in meters. */
  /** Raw sensor values: fingertip touch (N), gripper actuator force (N), wrist force along the tool axis (N). */
  rawSensors(): { touchLeft: number; touchRight: number; effort: number; forceTool: number } {
    const { mj, m, d } = this;
    const adr = (name: string) => m.sensor_adr[mj.mj_name2id(m, mj.mjtObj.mjOBJ_SENSOR.value, name)];
    const s = d.sensordata;
    return { touchLeft: s[adr('touch_left')], touchRight: s[adr('touch_right')], effort: d.actuator_force[7], forceTool: s[adr('wrist_force') + 2] };
  }

  gripWidth(): number {
    return this.d.qpos[7] + this.d.qpos[8];
  }

  cube(name: string): CubeState {
    const a = this.cubeQ.get(name)!;
    const v = this.cubeV.get(name)!;
    const q = this.d.qpos;
    const quat: [number, number, number, number] = [q[a + 3], q[a + 4], q[a + 5], q[a + 6]];
    const [w, x, y, z] = quat;
    const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
    const qv = this.d.qvel;
    return {
      name,
      pos: [q[a], q[a + 1], q[a + 2]],
      quat,
      yaw,
      speed: Math.hypot(qv[v], qv[v + 1], qv[v + 2]),
    };
  }

  cubes(): CubeState[] {
    return this.cubeNames.map((n) => this.cube(n));
  }

  /** Adds a horizontal velocity to a cube (chaos nudge). */
  shove(name: string, vx: number, vy: number) {
    const v = this.cubeV.get(name)!;
    this.d.qvel[v] += vx;
    this.d.qvel[v + 1] += vy;
  }

  /** Damped least squares IK toward the Cartesian target, warm started from ikQ. */
  solveIK(target: Pose, iters = 6) {
    const { mj, m, ikd } = this;
    const nv = m.nv;
    const q = this.ikQ;
    const c = Math.cos(target.yaw);
    const s = Math.sin(target.yaw);
    const Rd = [
      [c, s, 0],
      [s, -c, 0],
      [0, 0, -1],
    ]; // desired columns x, y, z
    const lambda2 = 0.01;
    for (let it = 0; it < iters; it++) {
      const qp = ikd.qpos;
      for (let i = 0; i < ARM_DOF; i++) qp[i] = q[i];
      mj.mj_kinematics(m, ikd);
      mj.mj_comPos(m, ikd);
      const so = this.site * 3;
      const sx = ikd.site_xpos;
      const ep = [target.pos[0] - sx[so], target.pos[1] - sx[so + 1], target.pos[2] - sx[so + 2]];
      const n = Math.hypot(ep[0], ep[1], ep[2]);
      if (n > 0.05) for (let i = 0; i < 3; i++) ep[i] *= 0.05 / n;
      const R = ikd.site_xmat;
      const r0 = this.site * 9;
      const eo = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const a = [R[r0 + k], R[r0 + 3 + k], R[r0 + 6 + k]];
        const b = Rd[k];
        eo[0] += 0.5 * (a[1] * b[2] - a[2] * b[1]);
        eo[1] += 0.5 * (a[2] * b[0] - a[0] * b[2]);
        eo[2] += 0.5 * (a[0] * b[1] - a[1] * b[0]);
      }
      mj.mj_jacSite(m, ikd, this.jacp, this.jacr, this.site);
      const jp = this.jacp.GetView();
      const jr = this.jacr.GetView();
      const J: number[][] = [];
      for (let r = 0; r < 3; r++) J.push(Array.from({ length: ARM_DOF }, (_, k) => jp[r * nv + k]));
      for (let r = 0; r < 3; r++) J.push(Array.from({ length: ARM_DOF }, (_, k) => jr[r * nv + k]));
      const e = [...ep, ...eo];
      const A = J.map((ri, i) => J.map((rj, j) => ri.reduce((acc, v, k) => acc + v * rj[k], 0) + (i === j ? lambda2 : 0)));
      const y = solve(A.map((r) => [...r]), [...e]);
      const dq = new Array(ARM_DOF).fill(0);
      for (let k = 0; k < ARM_DOF; k++) for (let r = 0; r < 6; r++) dq[k] += J[r][k] * y[r];
      // Null space pull toward the home posture keeps the elbow natural.
      const z = Q_HOME.map((h, k) => 0.05 * (h - q[k]));
      const Jz = J.map((row) => row.reduce((acc, v, k) => acc + v * z[k], 0));
      const w = solve(A.map((r) => [...r]), Jz);
      for (let k = 0; k < ARM_DOF; k++) {
        let proj = z[k];
        for (let r = 0; r < 6; r++) proj -= J[r][k] * w[r];
        q[k] = Math.min(this.jntRange[k][1], Math.max(this.jntRange[k][0], q[k] + dq[k] + proj));
      }
    }
  }

  applyCtrl() {
    const ctrl = this.d.ctrl;
    for (let i = 0; i < ARM_DOF; i++) ctrl[i] = this.ikQ[i];
    ctrl[7] = 255 * this.grip;
  }

  /** One physics step; IK runs at control rate (every 5 steps). */
  step() {
    if (Math.round(this.d.time / this.timestep) % 5 === 0) {
      this.solveIK(this.target);
      this.applyCtrl();
    }
    this.mj.mj_step(this.m, this.d);
  }

  /** Body poses for rendering, keyed by body name. */
  bodyPose(name: string): { pos: number[]; quat: number[] } | null {
    const id = this.mj.mj_name2id(this.m, this.mj.mjtObj.mjOBJ_BODY.value, name);
    if (id < 0) return null;
    return {
      pos: Array.from(this.d.xpos.slice(id * 3, id * 3 + 3)),
      quat: Array.from(this.d.xquat.slice(id * 4, id * 4 + 4)),
    };
  }
}
