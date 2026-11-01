// Builds web assets from the Menagerie Panda:
//  public/models/panda.xml        physics model, collision geometry only
//  public/models/assets/*         collision meshes
//  public/models/panda_visual.bin decimated visual meshes merged per body and color
import loadMujoco from '@mujoco/mujoco';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'vendor/panda';
const OUT = 'public/models';
const KEEP_RATIO = 0.15;

fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });

// 1. Physics XML: drop visual geoms and visual meshes, stiffen the gripper.
let xml = fs.readFileSync(path.join(SRC, 'panda.xml'), 'utf8');
xml = xml
  .split('\n')
  .filter((l) => !(l.includes('<geom') && l.includes('class="visual"')))
  .filter((l) => l.includes('finger_0.obj') || !/^\s*<mesh file="[^"]+\.obj"\/>/.test(l))
  .filter((l) => !l.includes('<light name="top"'))
  .join('\n')
  .replace(/<body name="(link[1-7]|hand|left_finger|right_finger)"/g, '<body name="$1" gravcomp="1"')
  .replace('<option integrator="implicitfast"/>', '<option integrator="implicitfast" cone="elliptic" impratio="10"/>')
  .replace(
    'gainprm="0.01568627451 0 0" biasprm="0 -100 -10"',
    'gainprm="0.1568627451 0 0" biasprm="0 -1000 -60"',
  )
  .replace('forcerange="-100 100" ctrlrange="0 255"', 'forcerange="-40 40" ctrlrange="0 255"')
  .replace(
    /(<body name="hand"[^>]*>)/,
    '$1\n                      <site name="grip" pos="0 0 0.1034" size="0.005" rgba="1 0 0 0"/>\n                      <site name="wrist" pos="0 0 0" size="0.004" rgba="1 0 0 0" group="5"/>',
  )
  // Cheap sensors, same layout as the research benchmark: fingertip contact zones and a wrist force sensor.
  .replace(/(<body name="(left_finger|right_finger)"[^>]*>)/g, '$1\n<site name="$2_tip" type="box" pos="0 0.004 0.044" size="0.016 0.016 0.014" rgba="0 1 0 0" group="5"/>')
  .replace(
    '<keyframe>',
    '<sensor>\n    <touch name="touch_left" site="left_finger_tip"/>\n    <touch name="touch_right" site="right_finger_tip"/>\n    <force name="wrist_force" site="wrist"/>\n  </sensor>\n  <keyframe>',
  );
if (!xml.includes('name="grip"') || !xml.includes('touch_right')) throw new Error('sites or sensors not inserted');
fs.writeFileSync(path.join(OUT, 'panda.xml'), xml);
const collisionFiles = [...xml.matchAll(/file="([^"]+)"/g)].map((m) => m[1]);
for (const f of collisionFiles) fs.copyFileSync(path.join(SRC, 'assets', f), path.join(OUT, 'assets', f));
console.log('physics xml written,', collisionFiles.length, 'collision meshes');

// 2. Visual meshes from the full model.
const mj = await loadMujoco();
const vfs = new mj.MjVFS();
for (const f of fs.readdirSync(path.join(SRC, 'assets'))) {
  vfs.addBuffer('assets/' + f, new Uint8Array(fs.readFileSync(path.join(SRC, 'assets', f))));
}
const m = mj.MjModel.from_xml_string(fs.readFileSync(path.join(SRC, 'panda.xml'), 'utf8'), vfs);
await MeshoptSimplifier.ready;

const bodyName = (i) => mj.mj_id2name(m, mj.mjtObj.mjOBJ_BODY.value, i);

function quatRotate(q, v) {
  const [w, x, y, z] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

const groups = new Map(); // key body|rgba -> {pos:[], idx:[]}
for (let g = 0; g < m.ngeom; g++) {
  if (m.geom_group[g] !== 2 || m.geom_type[g] !== mj.mjtGeom.mjGEOM_MESH.value) continue;
  const mesh = m.geom_dataid[g];
  const mat = m.geom_matid[g];
  const rgba = mat >= 0 ? Array.from(m.mat_rgba.slice(mat * 4, mat * 4 + 4)) : Array.from(m.geom_rgba.slice(g * 4, g * 4 + 4));
  const key = bodyName(m.geom_bodyid[g]) + '|' + rgba.map((c) => c.toFixed(3)).join(',');
  if (!groups.has(key)) groups.set(key, { pos: [], idx: [] });
  const grp = groups.get(key);
  const va = m.mesh_vertadr[mesh];
  const vn = m.mesh_vertnum[mesh];
  const fa = m.mesh_faceadr[mesh];
  const fn = m.mesh_facenum[mesh];
  const gp = Array.from(m.geom_pos.slice(g * 3, g * 3 + 3));
  const gq = Array.from(m.geom_quat.slice(g * 4, g * 4 + 4));
  const base = grp.pos.length / 3;
  for (let i = 0; i < vn; i++) {
    const v = quatRotate(gq, [m.mesh_vert[(va + i) * 3], m.mesh_vert[(va + i) * 3 + 1], m.mesh_vert[(va + i) * 3 + 2]]);
    grp.pos.push(v[0] + gp[0], v[1] + gp[1], v[2] + gp[2]);
  }
  for (let i = 0; i < fn * 3; i++) grp.idx.push(base + m.mesh_face[fa * 3 + i]);
}

const header = [];
const chunks = [];
let offset = 0;
let tris = 0;
for (const [key, grp] of groups) {
  const [body, rgbaStr] = key.split('|');
  // Weld duplicate vertices (OBJ splits them per face) so the simplifier can collapse edges.
  const weld = new Map();
  const wpos = [];
  const vmap = new Uint32Array(grp.pos.length / 3);
  for (let i = 0; i < vmap.length; i++) {
    const k = `${Math.round(grp.pos[i * 3] * 1e4)},${Math.round(grp.pos[i * 3 + 1] * 1e4)},${Math.round(grp.pos[i * 3 + 2] * 1e4)}`;
    if (!weld.has(k)) {
      weld.set(k, wpos.length / 3);
      wpos.push(grp.pos[i * 3], grp.pos[i * 3 + 1], grp.pos[i * 3 + 2]);
    }
    vmap[i] = weld.get(k);
  }
  const pos = new Float32Array(wpos);
  const idx = Uint32Array.from(grp.idx, (v) => vmap[v]);
  const target = Math.max(36, Math.floor((idx.length * KEEP_RATIO) / 3) * 3);
  const [simp] = MeshoptSimplifier.simplify(idx, pos, 3, target, 0.004, []);
  // Compact vertices.
  const remap = new Map();
  const outPos = [];
  const outIdx = new Uint32Array(simp.length);
  for (let i = 0; i < simp.length; i++) {
    const v = simp[i];
    if (!remap.has(v)) {
      remap.set(v, outPos.length / 3);
      outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    }
    outIdx[i] = remap.get(v);
  }
  const p = new Float32Array(outPos);
  const useU16 = p.length / 3 < 65536;
  const ib = useU16 ? new Uint16Array(outIdx) : outIdx;
  header.push({ body, rgba: rgbaStr.split(',').map(Number), posOffset: offset, posCount: p.length, idxOffset: offset + p.byteLength, idxCount: ib.length, u16: useU16 });
  let pad = (p.byteLength + ib.byteLength) % 4 ? 4 - ((p.byteLength + ib.byteLength) % 4) : 0;
  chunks.push(Buffer.from(p.buffer), Buffer.from(ib.buffer), Buffer.alloc(pad));
  offset += p.byteLength + ib.byteLength + pad;
  tris += ib.length / 3;
}
const headerBuf = Buffer.from(JSON.stringify(header));
const lenBuf = Buffer.alloc(4);
lenBuf.writeUInt32LE(headerBuf.length);
const headPad = Buffer.alloc((4 - ((4 + headerBuf.length) % 4)) % 4);
fs.writeFileSync(path.join(OUT, 'panda_visual.bin'), Buffer.concat([lenBuf, headerBuf, headPad, ...chunks]));
console.log('visual groups', header.length, 'triangles', tris, 'bytes', fs.statSync(path.join(OUT, 'panda_visual.bin')).size);
