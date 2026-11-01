export interface Attempt {
  attempt: number;
  steps: string;
  failure: string;
  vision?: string;
}

export interface PlanPayload {
  instruction: string;
  scene: string;
  history: Attempt[];
  invalid?: string;
  image?: string;
}

export interface JudgePayload {
  instruction: string;
  image: string;
}

export const PLAN_SYSTEM = `You plan tabletop manipulation for a Franka Panda arm with a parallel gripper.
You never output joint angles or torques. You output a JSON plan built only from these skills:
- {"skill":"move_to","target":T}  move the open gripper above a cube or zone T
- {"skill":"grasp","object":C}    descend onto cube C and close the gripper
- {"skill":"lift"}                raise the held cube
- {"skill":"place","on":T}        carry the held cube above T and lower it onto cube T or into zone T
- {"skill":"release"}             open the gripper and back off
Names: cubes are named by color ("red","green","blue","yellow"). Zones are "red_zone","green_zone","blue_zone".
Rules:
- One cube at a time: move_to, grasp, lift, place, release.
- To build a stack, place the bottom-most cube first. A cube that has another cube on top cannot be grasped; unstack first.
- Only use names that exist in the scene.
- Also output "goal": the conditions that must hold when the task is done.
  {"pred":"on","a":A,"b":B} means cube A rests directly on cube B.
  {"pred":"in_zone","a":A,"zone":Z} means cube A sits inside zone Z.
- If earlier attempts failed, read the failure, look at the current scene, and plan only what is still needed.
- If the instruction cannot be done in this scene (an object or zone that does not exist, a cube on itself,
  goals that contradict each other), do not plan. Return {"reasoning": "...", "refuse": "<why>", "goal": [], "steps": []}.
Return only JSON: {"reasoning": "<one or two sentences>", "goal": [...], "steps": [...]}`;

export function planUserText(p: PlanPayload): string {
  let t = `Instruction: ${p.instruction}\n\nCurrent scene:\n${p.scene}`;
  if (p.history.length) {
    t += '\n\nEarlier attempts in this episode:';
    for (const h of p.history) {
      t += `\n- Attempt ${h.attempt + 1}: ${h.steps}\n  Result: ${h.failure}`;
      if (h.vision) t += `\n  Camera check said: ${h.vision}`;
    }
    if (p.image) t += '\nThe attached image is the camera view after the last attempt.';
  }
  if (p.invalid) t += `\n\nYour previous output was rejected: ${p.invalid}\nFix it and return valid JSON only.`;
  return t;
}

export const JUDGE_SYSTEM = `You check whether a robot finished a tabletop task, using only a camera image.
The table has colored 5 cm cubes and three colored square zones (red, green, blue) near the far edge.
Judge only what is visible. Return only JSON: {"success": true|false, "reason": "<one sentence>"}`;

export function judgeUserText(p: JudgePayload): string {
  return `Task given to the robot: "${p.instruction}"\nDid the task succeed in this final image?`;
}
