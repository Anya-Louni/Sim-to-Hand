# Active verification (B1) and the verification router (B3)

Status: built and evaluated. Results are in `experiments/RESULTS.md` (section 4) and come from
`npm run trials -- probes`.

## Problem

The cheap sensors stop at release: they feel a grasp, a hold and a placement contact, and then nothing. The
trials show the cost. When a cube is knocked off after release, the sensors-only agent says "done" on almost
every episode, and is wrong. The camera catches it, but cameras miss things too (occlusion, a 1 mm gap) and
they disagree with the sensors on correct placements.

Active verification means the robot touches the result before it says "done".

## Probe

One probe, the **press probe**, with the gripper closed:

1. Move above the spot where the robot put the cube, 4 cm over the cube's expected top face.
2. Lower slowly. The low-level guard stops the motion when the wrist force changes by more than 3 N. The lowest
   allowed point is 1.5 cm below the expected top.
3. Read the result with the cheap sensors only: the peak change in the noisy wrist force, and the height at which
   the arm stopped (joint encoders, which a real arm has).
4. Pass if the force rose by more than 2 N and the arm stopped within 1 cm of the expected top face.

What it catches: a cube that is not there (it was knocked off or slid away: no contact, or contact at table
height) and a cube resting at the wrong height (on the table instead of on the stack). What it cannot catch: a
cube sitting at the right height but rotated, and a sideways error of under about 2 cm (the fingers still land
on the cube).

Probed cubes: for each goal `on(a, b)` or `in_zone(a, z)`, cube `a`, unless another goal puts a cube on `a`. In
a tower only the top cube is probed; pressing the top at the right height implies the cubes under it are there.

Force limits: 3 N stop, 2 N contact threshold, about 3 cm/s approach (5.5 cm in 2 s). A 5 cm cube of density 500 weighs
0.6 N, so 3 N presses but does not push a resting cube off its support, which the trials confirm.

### Probes considered and not built

- **Lift probe** (re-grasp the top cube, lift 1 cm, read the weight on the wrist): the weight change, 0.6 N, is
  close to the 0.5 N sensor noise. It is also slow and can itself knock the stack over.
- **Wiggle probe** (grasp and push sideways, feel resistance from the cube below): needs friction modelling the
  sim does not calibrate, and it disturbs the result it checks.

## When to probe

Strategies, compared on the same 80 seeded tasks and the same five failure types as section 1:

| Strategy | Checks used | Probes |
|---|---|---|
| sensors | sensors | never |
| sensors + probe | sensors, then probe | after every attempt the sensors accept |
| combined | sensors and camera | never |
| router (B3) | sensors, then camera, then probe | only when the camera rejects what the sensors accepted |

The **router** runs checks from cheapest to dearest and stops as soon as the answer is settled:

1. Sensors (free, already read during the motion). If they report a failure, replan. No camera, no probe.
2. Camera (one image and one detector run). If it agrees with the sensors, declare done.
3. Probe (about 8 simulated seconds per probed cube in the trials: move over, press slowly, back off, clear the camera view). The camera and sensors disagree, so the touch decides.

Cost is reported in simulated seconds and in counts of camera checks and probes per episode, so the trade-off
figure shows false success against time.

## Measures

True success, false success (said done, was not) and attempts per episode, with Wilson intervals; probes and
camera checks per episode; simulated seconds per episode. The comparison of interest is false success under
"knocked after release" for sensors against sensors + probe, and camera checks used by the router against
combined.

## What the first evaluation changed

The first version pressed each top cube at the height where the robot had put it. In the knocked-after-release
trials it passed 20 of 80 failed episodes, all towers. The knock moves the middle cube, the robot stacks the top
cube onto the middle cube where it now lies, and the top cube then sits exactly where the robot put it, one level
too low. The probe now expects the height the goal implies: a cube on the table or in a zone is one cube high, and
`on(a, b)` puts a one cube above b. The first run is kept in `experiments/data/probe_v1_*.csv` and reported next to
the current one.

## Choices to revisit

- Thresholds (3 N stop, 2 N contact, 1 cm height tolerance) were set once from the sensor model and not tuned on
  the trial tasks.
- The probe is aimed where the robot put the cube, not where the camera sees it. With perceived state this
  is the same belief the robot already acts on.
