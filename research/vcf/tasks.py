"""Five contact-dependent tasks. Each builds one attempt with a controlled magnitude and labels it from sim state.

Variants:
  stack   touching the base cube vs hovering {mag} above it (cube held in the gripper)
  grasp   gripper closed on the cube vs closed {mag} beside it
  button  pressed past the 4 mm click vs pressed only {mag}
  peg     peg seated in the hole vs resting on the rim, offset {mag} past the clearance
  push    block against the wall vs stopped {mag} short
"""
from __future__ import annotations

from dataclasses import dataclass, field

import mujoco
import numpy as np

from .robot import Robot, down_rot

GUARD_N = 8.0  # guarded moves stop when the estimated contact force passes this


@dataclass
class Attempt:
    task: str
    variant: str  # "success" or "failure": what the generator aimed for
    mag: float  # controlled magnitude in meters (gap, offset or press depth)
    realized: float = 0.0  # measured value of the controlling quantity at capture time
    label: int = 0  # ground truth from sim state after the stability check
    rule: str = ""
    sensors: np.ndarray = field(default_factory=lambda: np.zeros((0, 5)))
    qpos: np.ndarray = field(default_factory=lambda: np.zeros(0))
    meta: dict = field(default_factory=dict)


def _gid(m, name):
    return mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_GEOM, name)


def _bid(m, name):
    return mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, name)


def contact_force(m, d, a: str, b: str | list[str]) -> float:
    """Total normal force between geom a and geom(s) b."""
    ga = _gid(m, a)
    gb = {_gid(m, x) for x in ([b] if isinstance(b, str) else b)}
    total = 0.0
    f = np.zeros(6)
    for i in range(d.ncon):
        c = d.contact[i]
        if (c.geom1 == ga and c.geom2 in gb) or (c.geom2 == ga and c.geom1 in gb):
            mujoco.mj_contactForce(m, d, i, f)
            total += abs(f[0])
    return total


def set_free(m, d, body: str, pos, yaw: float = 0.0):
    j = m.body_jntadr[_bid(m, body)]
    a = m.jnt_qposadr[j]
    d.qpos[a : a + 3] = pos
    d.qpos[a + 3 : a + 7] = [np.cos(yaw / 2), 0, 0, np.sin(yaw / 2)]
    v = m.jnt_dofadr[j]
    d.qvel[v : v + 6] = 0


def body_pos(m, d, body: str) -> np.ndarray:
    return d.xpos[_bid(m, body)].copy()


def wrist_force(robot: Robot) -> np.ndarray:
    m, d = robot.m, robot.d
    sid = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_SENSOR, "wrist_force")
    a = m.sensor_adr[sid]
    return d.sensordata[a : a + 3].copy()


def guarded_move(robot: Robot, pos: np.ndarray, seconds: float, guard: float = GUARD_N):
    """Minimum-jerk move that freezes the target once the contact force passes the guard."""
    start = robot.target_pos.copy()
    tare = wrist_force(robot)  # the sensor also reads the hand and any held object
    n = int(round(seconds / robot.m.opt.timestep))
    for i in range(n):
        if np.linalg.norm(wrist_force(robot) - tare) > guard:
            # Hold where the arm actually is, so the contact force stays bounded.
            p, _ = robot.site_pose(robot.d, robot.site)
            robot.target_pos = p
            robot.wait((n - i) * robot.m.opt.timestep)
            return
        t = (i + 1) / n
        s = t * t * t * (10 - 15 * t + 6 * t * t)
        robot.target_pos = start + (pos - start) * s
        robot.step()


class Task:
    name = ""
    fail_range = (0.0005, 0.003)

    def __init__(self, model: mujoco.MjModel):
        self.m = model
        self.d = mujoco.MjData(model)
        self.robot = Robot(model, self.d)
        self.capture_hook = None  # called at decision time, before the stability check

    def reset(self, rng: np.random.Generator) -> dict:
        mujoco.mj_resetData(self.m, self.d)
        self.robot = Robot(self.m, self.d)
        return {"cx": 0.5 + rng.uniform(-0.03, 0.03), "cy": rng.uniform(-0.08, 0.08), "yaw": rng.uniform(-0.4, 0.4)}

    def attempt(self, layout: dict, variant: str, mag: float, rng: np.random.Generator) -> Attempt:
        raise NotImplementedError

    def _capture(self, att: Attempt):
        r = self.robot
        r.logging = False
        att.sensors = np.array(r.log)
        r.log = []
        att.qpos = self.d.qpos.copy()
        if self.capture_hook:
            att.meta.update(self.capture_hook(self) or {})

    def _record(self):
        self.robot.log = []
        self.robot.logging = True


class Stack(Task):
    name = "stack"
    fail_range = (0.0005, 0.002)

    def attempt(self, L, variant, mag, rng):
        m, d, r = self.m, self.d, self.robot
        set_free(m, d, "base", [L["cx"], L["cy"], 0.025], L["yaw"])
        top = 0.05
        held = np.array([L["cx"], L["cy"], top + 0.02 + 0.03])
        r.teleport(held, down_rot(L["yaw"]), "grip", finger=0.02)
        set_free(m, d, "obj", held, L["yaw"])
        r.grip = 0.0
        mujoco.mj_forward(m, d)
        r.wait(0.4)
        off = body_pos(m, d, "obj")[2] - r.site_pose(d, "grip")[0][2]
        gap = -0.0015 if variant == "success" else mag
        target = np.array([L["cx"], L["cy"], top + 0.02 + gap - off])
        self._record()
        guarded_move(r, target, 0.7)
        r.wait(0.4)
        att = Attempt(self.name, variant, mag)
        self._capture(att)
        att.realized = body_pos(m, d, "obj")[2] - 0.02 - (body_pos(m, d, "base")[2] + 0.025)
        r.wait(2.0)
        f = contact_force(m, d, "obj", "base")
        dxy = np.linalg.norm(body_pos(m, d, "obj")[:2] - body_pos(m, d, "base")[:2])
        att.label = int(f > 0.05 and dxy < 0.012)
        att.rule = f"contact force top-base {f:.2f} N after 2 s hold, xy offset {dxy*1000:.1f} mm"
        return att


class Grasp(Task):
    name = "grasp"
    fail_range = (0.001, 0.004)

    def attempt(self, L, variant, mag, rng):
        m, d, r = self.m, self.d, self.robot
        set_free(m, d, "obj", [L["cx"], L["cy"], 0.02], L["yaw"])
        R = down_rot(L["yaw"])
        side = R[:, 0] * (1 if rng.random() < 0.5 else -1)  # perpendicular to the closing axis
        shift = rng.uniform(0, 0.002) if variant == "success" else 0.02 + 0.0125 + mag
        xy = np.array([L["cx"], L["cy"], 0.0]) + side * shift
        r.teleport(np.array([xy[0], xy[1], 0.09]), R, "grip", finger=0.04)
        mujoco.mj_forward(m, d)
        r.wait(0.2)
        self._record()
        guarded_move(r, np.array([xy[0], xy[1], 0.023]), 0.6)
        r.set_grip(0.0, 0.6)
        r.wait(0.2)
        att = Attempt(self.name, variant, mag)
        self._capture(att)
        att.realized = shift
        g0 = r.site_pose(d, "grip")[0]
        r.move(g0 + np.array([0, 0, 0.08]), 0.6)
        r.wait(1.0)
        obj = body_pos(m, d, "obj")
        dist = np.linalg.norm(obj - r.site_pose(d, "grip")[0])
        att.label = int(obj[2] > 0.07 and dist < 0.025)
        att.rule = f"lift test: cube z {obj[2]*1000:.0f} mm, distance to grip {dist*1000:.0f} mm"
        return att


class Button(Task):
    name = "button"
    fail_range = (0.0003, 0.0025)
    CLICK = 0.004

    def attempt(self, L, variant, mag, rng):
        m, d, r = self.m, self.d, self.robot
        b = _bid(m, "housing")
        m.body_pos[b] = [L["cx"], L["cy"], 0]
        cap_top = 0.024 + 0.012
        R = down_rot(L["yaw"])
        r.teleport(np.array([L["cx"], L["cy"], cap_top + 0.03]), R, "tip", finger=0.0)
        r.grip = 0.0
        mujoco.mj_forward(m, d)
        r.wait(0.2)
        press = rng.uniform(0.005, 0.0058) if variant == "success" else mag
        self._record()
        guarded_move(r, np.array([L["cx"], L["cy"], cap_top - press]), 0.7, guard=20.0)
        r.wait(0.4)
        att = Attempt(self.name, variant, mag)
        self._capture(att)
        j = m.jnt_qposadr[mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, "cap")]
        att.realized = -d.qpos[j]
        r.wait(2.0)
        disp = -d.qpos[j]
        att.label = int(disp >= self.CLICK)
        att.rule = f"cap displacement {disp*1000:.2f} mm after 2 s hold (click at {self.CLICK*1000:.0f} mm)"
        return att


class Peg(Task):
    name = "peg"
    fail_range = (0.0005, 0.004)
    CLEAR = 0.002  # (26 mm hole - 22 mm peg) / 2

    def attempt(self, L, variant, mag, rng):
        m, d, r = self.m, self.d, self.robot
        b = _bid(m, "block")
        m.body_pos[b] = [L["cx"], L["cy"], 0]
        m.body_quat[b] = [np.cos(L["yaw"] / 2), 0, 0, np.sin(L["yaw"] / 2)]
        R = down_rot(L["yaw"])
        axis = [R[:, 0], -R[:, 0], R[:, 1], -R[:, 1]][rng.integers(4)]
        o = rng.uniform(0, 0.0008) if variant == "success" else self.CLEAR + 0.0015 + mag
        hole = np.array([L["cx"], L["cy"], 0.0]) + axis * o
        grip_above = 0.02  # grip site sits 20 mm above the peg center
        start = np.array([hole[0], hole[1], 0.020 + 0.035 + grip_above + 0.03])
        r.teleport(start, R, "grip", finger=0.011)
        set_free(m, d, "obj", start - np.array([0, 0, grip_above]), L["yaw"])
        r.grip = 0.0
        mujoco.mj_forward(m, d)
        r.wait(0.4)
        off = body_pos(m, d, "obj")[2] - r.site_pose(d, "grip")[0][2]
        target = np.array([hole[0], hole[1], 0.012 - 0.0015 + 0.035 - off])
        self._record()
        guarded_move(r, target, 0.8)
        r.wait(0.4)
        att = Attempt(self.name, variant, mag)
        self._capture(att)
        att.realized = o
        r.wait(2.0)
        bottom = body_pos(m, d, "obj")[2] - 0.035
        f = contact_force(m, d, "obj", "floor")
        att.label = int(bottom < 0.012 + 0.0015 and f > 0.05)
        att.rule = f"peg bottom {(bottom-0.012)*1000:.1f} mm above hole floor, floor contact {f:.2f} N after 2 s hold"
        return att


class Push(Task):
    name = "push"
    fail_range = (0.0005, 0.003)
    WALL_X = 0.60

    def attempt(self, L, variant, mag, rng):
        m, d, r = self.m, self.d, self.robot
        w = _bid(m, "wall")
        m.body_pos[w] = [self.WALL_X + 0.02, L["cy"], 0]
        yaw = rng.uniform(-0.05, 0.05)
        final_x = self.WALL_X - 0.025 - (-0.001 if variant == "success" else mag)
        start_x = final_x - 0.03
        set_free(m, d, "obj", [start_x, L["cy"], 0.025], yaw)
        R = down_rot(0.0)  # fingers side by side along y; their flat front faces push along +x
        r.teleport(np.array([start_x - 0.06, L["cy"], 0.012]), R, "tip", finger=0.0)
        r.grip = 0.0
        mujoco.mj_forward(m, d)
        r.wait(0.2)
        # Make first contact before logging, then learn the pusher-to-block offset.
        x = start_x - 0.06
        while body_pos(m, d, "obj")[0] < start_x + 0.003 and x < start_x:
            x += 0.002
            r.move(np.array([x, L["cy"], 0.012]), 0.03)
        off = body_pos(m, d, "obj")[0] - r.site_pose(d, "tip")[0][0]
        self._record()
        guarded_move(r, np.array([final_x - off, L["cy"], 0.012]), 0.7)
        r.wait(0.4)
        att = Attempt(self.name, variant, mag)
        self._capture(att)
        att.realized = self.WALL_X - (body_pos(m, d, "obj")[0] + 0.025)
        r.wait(2.0)
        f = contact_force(m, d, "obj", "wall")
        gap = self.WALL_X - (body_pos(m, d, "obj")[0] + 0.025)
        att.label = int(f > 0.05)
        att.rule = f"block-wall contact {f:.2f} N, gap {gap*1000:.2f} mm after 2 s hold"
        return att


TASK_CLASSES = {c.name: c for c in (Stack, Grasp, Button, Peg, Push)}
