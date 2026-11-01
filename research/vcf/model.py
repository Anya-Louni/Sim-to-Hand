"""Scene XML for each task, built around the MuJoCo Menagerie Franka Panda."""
from __future__ import annotations

import functools
import os
from pathlib import Path

import mujoco

ROOT = Path(__file__).resolve().parent.parent
PANDA_DIR = ROOT / "assets" / "menagerie_panda"
MAX_DISTRACTORS = 4
TASKS = ["stack", "grasp", "button", "peg", "push"]


def _patched_panda() -> Path:
    """Panda with gravity compensation, a stiffer gripper, and the sensors this study reads."""
    out = PANDA_DIR / "panda_vcf.xml"
    xml = (PANDA_DIR / "panda.xml").read_text()
    import re

    xml = re.sub(r'<body name="(link[1-7]|hand|left_finger|right_finger)"', r'<body name="\1" gravcomp="1"', xml)
    xml = xml.replace('<option integrator="implicitfast"/>', '<option integrator="implicitfast" cone="elliptic" impratio="10"/>')
    xml = xml.replace('gainprm="0.01568627451 0 0" biasprm="0 -100 -10"', 'gainprm="0.1568627451 0 0" biasprm="0 -1000 -60"')
    xml = xml.replace('forcerange="-100 100" ctrlrange="0 255"', 'forcerange="-40 40" ctrlrange="0 255"')
    xml = re.sub(
        r'(<body name="hand"[^>]*>)',
        r'\1\n<site name="grip" pos="0 0 0.1034" size="0.004" rgba="1 0 0 0" group="5"/>'
        r'\n<site name="tip" pos="0 0 0.1125" size="0.004" rgba="1 0 0 0" group="5"/>'
        r'\n<site name="wrist" pos="0 0 0" size="0.004" rgba="1 0 0 0" group="5"/>',
        xml,
    )
    for side in ("left_finger", "right_finger"):
        xml = re.sub(
            rf'(<body name="{side}"[^>]*>)',
            rf'\1\n<site name="{side}_tip" type="box" pos="0 0.004 0.044" size="0.016 0.016 0.014" rgba="0 1 0 0" group="5"/>',
            xml,
        )
    xml = xml.replace(
        "<keyframe>",
        """<sensor>
    <touch name="touch_left" site="left_finger_tip"/>
    <touch name="touch_right" site="right_finger_tip"/>
    <force name="wrist_force" site="wrist"/>
  </sensor>
  <keyframe>""",
    )
    out.write_text(xml)
    return out


def _fixtures(task: str) -> str:
    """Task objects. Positions are placeholders; tasks move them at reset."""
    if task == "stack":
        return """
<body name="base" pos="0.5 0 0.025"><freejoint name="base"/>
  <geom name="base" type="box" size="0.025 0.025 0.025" rgba=".2 .4 .9 1" density="600" friction="1.2 0.01 0.001" condim="4"/></body>
<body name="obj" pos="0.5 0 0.2"><freejoint name="obj"/>
  <geom name="obj" type="box" size="0.02 0.02 0.02" rgba=".9 .2 .2 1" density="500" friction="1.6 0.01 0.001" condim="4"/></body>"""
    if task == "grasp":
        return """
<body name="obj" pos="0.5 0 0.02"><freejoint name="obj"/>
  <geom name="obj" type="box" size="0.02 0.02 0.02" rgba=".9 .2 .2 1" density="500" friction="1.6 0.01 0.001" condim="4"/></body>"""
    if task == "button":
        return """
<body name="housing" pos="0.5 0 0">
  <geom name="housing" type="box" pos="0 0 0.012" size="0.04 0.04 0.012" rgba=".25 .25 .28 1"/>
  <body name="cap" pos="0 0 0.024">
    <joint name="cap" type="slide" axis="0 0 1" range="-0.006 0" stiffness="300" damping="3" springref="0" limited="true"/>
    <geom name="cap" type="cylinder" size="0.016 0.006" pos="0 0 0.006" rgba=".9 .2 .2 1" mass="0.01"/>
  </body>
</body>"""
    if task == "peg":
        # Square hole 26 mm wide, 8 mm deep, in a 90 mm block. Peg is 22 mm square.
        return """
<body name="block" pos="0.5 0 0">
  <geom name="floor" type="box" pos="0 0 0.006" size="0.045 0.045 0.006" rgba=".75 .7 .6 1"/>
  <geom name="wall_n" type="box" pos="0 0.029 0.016" size="0.045 0.016 0.004" rgba=".75 .7 .6 1"/>
  <geom name="wall_s" type="box" pos="0 -0.029 0.016" size="0.045 0.016 0.004" rgba=".75 .7 .6 1"/>
  <geom name="wall_e" type="box" pos="0.029 0 0.016" size="0.016 0.013 0.004" rgba=".75 .7 .6 1"/>
  <geom name="wall_w" type="box" pos="-0.029 0 0.016" size="0.016 0.013 0.004" rgba=".75 .7 .6 1"/>
</body>
<body name="obj" pos="0.5 0 0.2"><freejoint name="obj"/>
  <geom name="obj" type="box" size="0.011 0.011 0.035" rgba=".2 .6 .9 1" density="500" friction="1.6 0.01 0.001" condim="4"/></body>"""
    if task == "push":
        return """
<body name="wall" pos="0.62 0 0">
  <geom name="wall" type="box" pos="0 0 0.04" size="0.02 0.15 0.04" rgba=".4 .4 .45 1"/>
</body>
<body name="obj" pos="0.52 0 0.025"><freejoint name="obj"/>
  <geom name="obj" type="box" size="0.025 0.025 0.025" rgba=".9 .6 .1 1" density="400" friction="0.5 0.01 0.001" condim="4"/></body>"""
    raise ValueError(task)


def scene_xml(task: str) -> str:
    distractors = "\n".join(
        f'<body name="distractor{i}" pos="0 0 -1" mocap="true"><geom name="distractor{i}" type="box" size="0.02 0.02 0.02" '
        f'rgba=".5 .5 .5 1" contype="0" conaffinity="0"/></body>'
        for i in range(MAX_DISTRACTORS)
    )
    return f"""<mujoco model="vcf_{task}">
<include file="panda_vcf.xml"/>
<option timestep="0.002"/>
<visual><global offwidth="1024" offheight="1024"/><quality shadowsize="4096"/><headlight ambient="0.25 0.25 0.25" diffuse="0.4 0.4 0.4"/></visual>
<asset>
  <texture name="tabletex" type="2d" builtin="checker" rgb1=".55 .5 .45" rgb2=".5 .45 .4" width="512" height="512" mark="none"/>
  <texture name="sky" type="skybox" builtin="gradient" rgb1=".62 .64 .68" rgb2=".32 .33 .36" width="256" height="1536"/>
  <material name="table" texture="tabletex" texrepeat="8 8" reflectance="0"/>
</asset>
<worldbody>
  <light name="key" pos="0.8 -0.6 1.6" dir="-0.3 0.3 -1" directional="false" castshadow="true" diffuse=".8 .8 .8"/>
  <light name="fill" pos="-0.4 0.8 1.2" dir="0.4 -0.4 -1" castshadow="false" diffuse=".3 .3 .3"/>
  <geom name="table" type="plane" size="1.2 1.2 0.05" material="table" friction="0.8 0.005 0.0001"/>
  <camera name="front" pos="1 0 0.3"/>
  <camera name="left" pos="0.5 -0.4 0.1"/>
  <camera name="right" pos="0.5 0.4 0.1"/>
  {_fixtures(task)}
  {distractors}
</worldbody>
{'<contact><exclude body1="housing" body2="cap"/></contact>' if task == "button" else ""}
</mujoco>"""


@functools.lru_cache(maxsize=None)
def compiled(task: str) -> mujoco.MjModel:
    _patched_panda()
    cwd = os.getcwd()
    os.chdir(PANDA_DIR)
    try:
        return mujoco.MjModel.from_xml_string(scene_xml(task))
    finally:
        os.chdir(cwd)
