"""Panda control: damped least squares IK on a site, smooth Cartesian moves, sensor logging."""
from __future__ import annotations

import mujoco
import numpy as np

ARM = 7
Q_HOME = np.array([0.0, -0.25, 0.0, -2.3, 0.0, 2.05, 0.785])
SENSOR_HZ = 100


def down_rot(yaw: float) -> np.ndarray:
    """Tool pointing down (site z = -world z), rotated by yaw about world z."""
    c, s = np.cos(yaw), np.sin(yaw)
    return np.array([[c, s, 0.0], [s, -c, 0.0], [0.0, 0.0, -1.0]])


def _min_jerk(t: float) -> float:
    return t * t * t * (10 - 15 * t + 6 * t * t)


class Robot:
    def __init__(self, model: mujoco.MjModel, data: mujoco.MjData):
        self.m, self.d = model, data
        self.ikd = mujoco.MjData(model)
        self.sites = {n: mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_SITE, n) for n in ("grip", "tip")}
        self.range = model.jnt_range[:ARM].copy()
        self.q = Q_HOME.copy()
        self.grip = 1.0  # 1 open, 0 closed
        self.site = "grip"
        self.target_pos = np.zeros(3)
        self.target_rot = down_rot(0.0)
        self.log: list[np.ndarray] = []
        self.logging = False
        self._sid = {n: mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_SENSOR, n) for n in ("touch_left", "touch_right", "wrist_force")}
        self._jacp = np.zeros((3, model.nv))
        self._jacr = np.zeros((3, model.nv))

    # ---- kinematics -------------------------------------------------------
    def site_pose(self, data: mujoco.MjData, site: str):
        i = self.sites[site]
        return data.site_xpos[i].copy(), data.site_xmat[i].reshape(3, 3).copy()

    def solve_ik(self, pos: np.ndarray, rot: np.ndarray, site: str, iters: int = 8, q0: np.ndarray | None = None) -> np.ndarray:
        m, d = self.m, self.ikd
        q = (self.q if q0 is None else q0).copy()
        sid = self.sites[site]
        for _ in range(iters):
            d.qpos[:ARM] = q
            mujoco.mj_kinematics(m, d)
            mujoco.mj_comPos(m, d)
            ep = pos - d.site_xpos[sid]
            n = np.linalg.norm(ep)
            if n > 0.05:
                ep *= 0.05 / n
            R = d.site_xmat[sid].reshape(3, 3)
            eo = 0.5 * sum(np.cross(R[:, k], rot[:, k]) for k in range(3))
            mujoco.mj_jacSite(m, d, self._jacp, self._jacr, sid)
            J = np.vstack([self._jacp[:, :ARM], self._jacr[:, :ARM]])
            A = J @ J.T + 1e-4 * np.eye(6)
            dq = J.T @ np.linalg.solve(A, np.concatenate([ep, eo]))
            z = 0.05 * (Q_HOME - q)
            dq += z - J.T @ np.linalg.solve(A, J @ z)
            q = np.clip(q + dq, self.range[:, 0], self.range[:, 1])
        return q

    def teleport(self, pos: np.ndarray, rot: np.ndarray, site: str = "grip", finger: float = 0.04):
        """Place the arm exactly at an IK solution (used only for initial setup)."""
        q = Q_HOME.copy()
        for _ in range(6):
            q = self.solve_ik(pos, rot, site, iters=20, q0=q)
        self.q = q
        self.d.qpos[:ARM] = q
        self.d.qpos[7] = self.d.qpos[8] = finger
        self.d.qvel[:] = 0
        self.site, self.target_pos, self.target_rot = site, pos.copy(), rot.copy()
        self.grip = 1.0 if finger > 0.035 else 0.0
        self._apply()
        mujoco.mj_forward(self.m, self.d)

    # ---- control ----------------------------------------------------------
    def _apply(self):
        self.d.ctrl[:ARM] = self.q
        self.d.ctrl[7] = 255.0 * self.grip

    def step(self, n: int = 1):
        steps_per_log = int(round(1.0 / (SENSOR_HZ * self.m.opt.timestep)))
        for _ in range(n):
            k = int(round(self.d.time / self.m.opt.timestep))
            if k % 5 == 0:
                self.q = self.solve_ik(self.target_pos, self.target_rot, self.site, iters=4)
                self._apply()
            mujoco.mj_step(self.m, self.d)
            if self.logging and k % steps_per_log == 0:
                self.log.append(self.read_sensors())

    def wait(self, seconds: float):
        self.step(int(round(seconds / self.m.opt.timestep)))

    def move(self, pos: np.ndarray, seconds: float, rot: np.ndarray | None = None):
        start = self.target_pos.copy()
        rot = self.target_rot if rot is None else rot
        n = int(round(seconds / self.m.opt.timestep))
        for i in range(n):
            s = _min_jerk((i + 1) / n)
            self.target_pos = start + (pos - start) * s
            self.target_rot = rot
            self.step()

    def set_grip(self, open_frac: float, seconds: float):
        self.grip = open_frac
        self.wait(seconds)

    # ---- sensors ----------------------------------------------------------
    def read_sensors(self) -> np.ndarray:
        """Raw signals: time, touch left, touch right (N), gripper actuator force (N), wrist force along tool z (N)."""
        d, m = self.d, self.m
        adr = m.sensor_adr
        tl = d.sensordata[adr[self._sid["touch_left"]]]
        tr = d.sensordata[adr[self._sid["touch_right"]]]
        f = d.sensordata[adr[self._sid["wrist_force"]] : adr[self._sid["wrist_force"]] + 3]
        return np.array([d.time, tl, tr, d.actuator_force[7], f[2]])
