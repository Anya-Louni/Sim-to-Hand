import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const TASK_GOAL = {
  stack: 'Is the held cube resting on the larger cube?',
  grasp: 'Is the cube held between the fingers?',
  button: 'Is the button pressed past its click (4 mm)?',
  peg: 'Is the peg seated at the bottom of the hole?',
  push: 'Is the block touching the wall?',
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pct = (x) => (x == null || Number.isNaN(x) ? '–' : (100 * x).toFixed(0) + '%');
const get = async (p) => {
  try {
    const r = await fetch(p);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
};

const [boards, pairs, attack, scenes] = await Promise.all([get('data/leaderboard.json'), get('data/pairs.json'), get('data/attack.json'), get('data/scenes.json')]);

// ---------- Headline ----------
function headline() {
  const b = boards?.large ?? boards?.small;
  const el = document.getElementById('headline');
  if (!b) return (el.textContent = 'Results not exported yet.');
  // Only cite models that answered at least 80% of the test set.
  const covered = (r) => { const [a, n] = String(r.coverage).split('/').map(Number); return !n || a / n >= 0.8; };
  const vlms = b.rows.filter((r) => r.kind === 'vlm' && covered(r));
  const best = vlms.sort((a, c) => c.balanced_accuracy - a.balanced_accuracy)[0];
  if (!best) return (el.textContent = 'Vision model runs are still in progress; see the leaderboard for partial results.');
  const sensor = b.rows.find((r) => r.judge === 'sensor_logreg');
  el.innerHTML = `On ${b.n_test} simulated contact-dependent attempts, the best free vision model at scale (${esc(best.judge)}, ${best.coverage} answered) scored <b>${pct(best.balanced_accuracy)}</b> balanced accuracy and called <b>${pct(best.false_success_rate)}</b> of failures a success. A logistic regression on three cheap, noisy sensor signals scored <b>${pct(sensor.balanced_accuracy)}</b> with a false-success rate of <b>${pct(sensor.false_success_rate)}</b>. It fails where its sensors cannot see the contact, and it does not transfer to unseen tasks.`;
}

// ---------- Leaderboard ----------
let lbSet = boards?.large ? 'large' : 'small';
function leaderboard() {
  const tabs = document.getElementById('lb-tabs');
  tabs.innerHTML = Object.keys(boards ?? {}).map((k) => `<button class="tab ${k === lbSet ? 'active' : ''}" data-k="${k}">${k === 'small' ? 'Small set (all models)' : 'Scaled set'}</button>`).join('');
  tabs.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { lbSet = b.dataset.k; leaderboard(); sweep(); }));
  const b = boards?.[lbSet];
  if (!b) return;
  document.getElementById('lb-note').textContent = `${b.n_test} test samples. Coverage shows how many each judge answered; free-tier daily quotas limited some models. Sorted by balanced accuracy.`;
  const tasks = ['stack', 'grasp', 'button', 'peg', 'push'];
  const rows = [...b.rows].sort((a, c) => c.balanced_accuracy - a.balanced_accuracy);
  document.getElementById('lb').innerHTML =
    `<thead><tr><th>Judge</th><th>Coverage</th><th>Balanced acc.</th><th>False-success</th><th>False-failure</th><th>ECE</th>${tasks.map((t) => `<th>${t}</th>`).join('')}</tr></thead><tbody>` +
    rows.map((r) => `<tr class="${r.kind}"><td>${esc(r.judge)}</td><td class="num">${r.coverage}</td><td class="num">${r.balanced_accuracy.toFixed(2)}<span class="bar" style="width:${Math.max(0, (r.balanced_accuracy - 0.5) * 120)}px"></span></td><td class="num">${pct(r.false_success_rate)}</td><td class="num">${pct(r.false_failure_rate)}</td><td class="num">${r.ece == null ? '–' : r.ece.toFixed(2)}</td>${tasks.map((t) => `<td class="num">${r.by_task[t] == null || Number.isNaN(r.by_task[t]) ? '–' : r.by_task[t].toFixed(2)}</td>`).join('')}</tr>`).join('') +
    '</tbody>';
}

function sweep() {
  const b = boards?.[lbSet];
  const svg = document.getElementById('sweep');
  if (!b) return;
  const W = 640, H = 260, L = 50, R = 20, T = 20, B = 40;
  const pts = b.noise_sweep;
  const xs = (i) => L + (i / (pts.length - 1)) * (W - L - R);
  const ys = (v) => T + (1 - (v - 0.4) / 0.6) * (H - T - B);
  const bestVlm = Math.max(...b.rows.filter((r) => r.kind === 'vlm').map((r) => r.balanced_accuracy));
  let s = '';
  for (const v of [0.5, 0.6, 0.7, 0.8, 0.9, 1.0]) s += `<line x1="${L}" x2="${W - R}" y1="${ys(v)}" y2="${ys(v)}" stroke="currentColor" opacity="0.08"/><text x="${L - 8}" y="${ys(v) + 4}" text-anchor="end">${v.toFixed(1)}</text>`;
  pts.forEach((p, i) => (s += `<text x="${xs(i)}" y="${H - 18}" text-anchor="middle">${p.strength}</text>`));
  s += `<text x="${(L + W - R) / 2}" y="${H - 3}" text-anchor="middle">sensor noise strength</text>`;
  s += `<line x1="${L}" x2="${W - R}" y1="${ys(bestVlm)}" y2="${ys(bestVlm)}" stroke="var(--bad)" stroke-dasharray="5 4"/><text x="${W - R}" y="${ys(bestVlm) - 6}" text-anchor="end" style="fill:var(--bad)">best vision model ${bestVlm.toFixed(2)}</text>`;
  s += `<line x1="${L}" x2="${W - R}" y1="${ys(0.5)}" y2="${ys(0.5)}" stroke="currentColor" opacity="0.35" stroke-dasharray="2 3"/>`;
  s += `<polyline fill="none" stroke="var(--sensor)" stroke-width="2.5" points="${pts.map((p, i) => `${xs(i)},${ys(p.balanced_accuracy)}`).join(' ')}"/>`;
  pts.forEach((p, i) => (s += `<circle cx="${xs(i)}" cy="${ys(p.balanced_accuracy)}" r="4" fill="var(--sensor)"><title>strength ${p.strength}: ${p.balanced_accuracy}</title></circle>`));
  svg.innerHTML = s;
}

// ---------- Sparklines ----------
function spark(values, color, lo, hi) {
  if (!values?.length) return '';
  const min = lo ?? Math.min(...values), max = hi ?? Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 200},${40 - ((v - min) / span) * 36}`).join(' ');
  return `<svg class="spark" viewBox="0 0 200 44" preserveAspectRatio="none"><polyline fill="none" stroke="${color}" stroke-width="1.6" points="${pts}"/></svg>`;
}
function sensorBlock(sd) {
  const s = sd.sensors;
  return `<div class="spark-label">contact switch</div>${spark(s.switch, 'var(--sensor)', 0, 1)}<div class="spark-label">gripper effort (N)</div>${spark(s.effort, 'var(--sensor)')}<div class="spark-label">wrist force, one axis (N)</div>${spark(s.force, 'var(--sensor)')}`;
}

// ---------- Game ----------
const order = (pairs ?? []).map((_, i) => i).sort(() => Math.random() - 0.5);
let round = 0, correct = 0, played = 0;
function storeScore() {
  try { localStorage.setItem('vcf-score', JSON.stringify({ correct, played })); } catch {}
}
try { ({ correct = 0, played = 0 } = JSON.parse(localStorage.getItem('vcf-score') ?? '{}')); } catch {}
function playRound() {
  if (!pairs?.length) return;
  const p = pairs[order[round % order.length]];
  const flip = Math.random() < 0.5;
  const sides = flip ? ['failure', 'success'] : ['success', 'failure'];
  document.getElementById('game-task').textContent = p.task;
  document.getElementById('game-goal').textContent = TASK_GOAL[p.task];
  document.getElementById('game-score').textContent = played ? `you: ${correct}/${played}` : '';
  document.querySelectorAll('.choice').forEach((btn, i) => {
    btn.className = 'choice';
    btn.disabled = false;
    btn.querySelector('img')?.remove();
    const img = document.createElement('img');
    img.alt = `Option ${'AB'[i]}`;
    img.src = `img/${p.sides[sides[i]].id}-front.jpg`;
    btn.prepend(img);
    btn.onclick = () => answer(p, sides, i);
  });
  const rv = document.getElementById('reveal');
  rv.hidden = true;
  document.getElementById('next').hidden = true;
}
function answer(p, sides, pick) {
  const right = sides[pick] === 'success';
  played++;
  if (right) correct++;
  storeScore();
  document.querySelectorAll('.choice').forEach((btn, i) => {
    btn.disabled = true;
    btn.classList.add(sides[i] === 'success' ? 'right' : 'wrong');
  });
  const col = (side, letter) => {
    const sd = p.sides[side];
    const v = Object.entries(sd.vlm).filter(([k]) => k.endsWith('(single)'));
    return `<div class="col"><h4>${letter}: ${side === 'success' ? '<span class="yes">success</span>' : '<span class="no">failure</span>'}</h4>
      <div class="muted">${esc(sd.rule)}</div>
      <ul class="verdicts">${v.length ? v.map(([k, r]) => `<li><span>${esc(k.replace(' (single)', ''))}</span><span class="${r.success === (side === 'success') ? 'yes' : 'no'}">${r.success == null ? 'no answer' : r.success ? 'says success' : 'says failure'}</span></li>`).join('') : '<li>no vision answers yet</li>'}</ul>
      ${sensorBlock(sd)}</div>`;
  };
  const rv = document.getElementById('reveal');
  rv.innerHTML = col(sides[0], 'A') + col(sides[1], 'B');
  rv.hidden = false;
  document.getElementById('game-score').textContent = `you: ${correct}/${played}`;
  document.getElementById('next').hidden = false;
}
document.getElementById('next').addEventListener('click', () => { round++; playRound(); });

// ---------- Gallery ----------
let galleryTask = 'all';
function gallery() {
  const tasks = ['all', 'stack', 'grasp', 'button', 'peg', 'push'];
  const f = document.getElementById('pair-filter');
  f.innerHTML = tasks.map((t) => `<button class="tab ${t === galleryTask ? 'active' : ''}" data-t="${t}">${t}</button>`).join('');
  f.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { galleryTask = b.dataset.t; gallery(); }));
  const list = (pairs ?? []).filter((p) => galleryTask === 'all' || p.task === galleryTask).slice(0, 24);
  document.getElementById('gallery').innerHTML = list.map((p) => {
    const fooled = Object.entries(p.sides.failure.vlm).filter(([k, r]) => k.endsWith('(single)') && r.success === true).map(([k]) => k.replace(' (single)', ''));
    return `<div class="card"><div class="imgs"><img loading="lazy" alt="success" src="img/${p.sides.success.id}-front.jpg"><img loading="lazy" alt="failure" src="img/${p.sides.failure.id}-front.jpg"></div>
      <div class="meta"><span class="pill">${p.task}</span> failure magnitude <b>${p.mag_mm.toFixed(2)} mm</b>, pixel diff <b>${p.pixel_diff.front?.mean_abs ?? '–'}</b><br>
      <span class="muted">${fooled.length ? 'Called the failure a success: ' + esc(fooled.join(', ')) : 'No vision model called the failure a success.'}</span></div></div>`;
  }).join('');
}

// ---------- Millimeters to fool ----------
function mmChart() {
  const svg = document.getElementById('mm');
  if (!attack?.summary?.length) {
    svg.outerHTML = '<p class="muted">Attack results not exported yet.</p>';
    return;
  }
  const tasks = ['stack', 'grasp', 'button', 'peg', 'push'];
  const models = [...new Set(attack.summary.map((r) => r.model))];
  const colors = ['var(--accent)', 'var(--sensor)', 'var(--ok)', 'var(--bad)'];
  const val = (m, t) => {
    const rs = attack.summary.filter((r) => r.model === m && r.task === t);
    return rs.length ? rs.reduce((s, r) => s + Math.max(r.mm_to_fool_ladder, r.mm_to_fool_with_llm), 0) / rs.length : null;
  };
  const W = 640, H = 280, L = 44, B = 46, T = 16;
  const maxV = Math.max(4, ...tasks.flatMap((t) => models.map((m) => val(m, t) ?? 0)));
  const gw = (W - L - 10) / tasks.length, bw = (gw - 16) / models.length;
  let s = '';
  for (let v = 0; v <= maxV; v += maxV > 8 ? 4 : 2) {
    const y = T + (1 - v / maxV) * (H - T - B);
    s += `<line x1="${L}" x2="${W - 10}" y1="${y}" y2="${y}" stroke="currentColor" opacity="0.08"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${v} mm</text>`;
  }
  tasks.forEach((t, ti) => {
    models.forEach((m, mi) => {
      const v = val(m, t);
      if (v == null) return;
      const h = (v / maxV) * (H - T - B);
      const x = L + ti * gw + 8 + mi * bw;
      s += `<rect x="${x}" y="${H - B - h}" width="${bw - 3}" height="${Math.max(h, 1)}" fill="${colors[mi % colors.length]}" rx="2"><title>${m} on ${t}: ${v.toFixed(2)} mm</title></rect>`;
    });
    s += `<text x="${L + ti * gw + gw / 2}" y="${H - B + 16}" text-anchor="middle">${t}</text>`;
  });
  models.forEach((m, mi) => (s += `<rect x="${L + mi * 230}" y="${H - 14}" width="10" height="10" fill="${colors[mi % colors.length]}"/><text x="${L + mi * 230 + 14}" y="${H - 5}">${esc(m)}</text>`));
  svg.innerHTML = s;
  const tr = attack.transfer ?? [];
  if (tr.length) {
    const others = [...new Set(tr.flatMap((r) => Object.keys(r).filter((k) => k.includes('/'))))];
    const rate = (k) => {
      const v = tr.filter((r) => r[k] != null);
      return v.length ? `${v.filter((r) => r[k]).length}/${v.length}` : '–';
    };
    document.getElementById('transfer').innerHTML = `<h3>Do fooling scenes transfer?</h3><p class="muted">${tr.length} scenes fooled a source model. How many also fooled:</p><div class="table-wrap"><table><thead><tr><th>Judge</th><th>Also says success</th></tr></thead><tbody>${others.map((k) => `<tr><td>${esc(k)}</td><td class="num">${rate(k)}</td></tr>`).join('')}<tr class="sensor"><td>sensor classifier</td><td class="num">${rate('sensor_logreg_says_success')}</td></tr></tbody></table></div>`;
  }
}

// ---------- 3D viewer ----------
async function viewer() {
  const canvas = document.getElementById('three');
  if (!scenes?.length) return;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(getComputedStyle(document.body).getPropertyValue('--paper').trim() || '#fffdf8');
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 10);
  camera.up.set(0, 0, 1);
  camera.position.set(1.05, -0.55, 0.45);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0.5, 0, 0.05);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f70, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1.2, -0.8, 2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -0.8;
  key.shadow.camera.right = key.shadow.camera.top = 0.8;
  scene.add(key);
  const table = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshStandardMaterial({ color: 0xbbb4a8, roughness: 0.9 }));
  table.position.set(0.4, 0, 0);
  table.receiveShadow = true;
  scene.add(table);

  // Panda meshes: decimated Menagerie visuals grouped per body.
  const bodies = {};
  try {
    const buf = await (await fetch('../models/panda_visual.bin')).arrayBuffer();
    const len = new DataView(buf).getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len)));
    const base = 4 + len + ((4 - ((4 + len) % 4)) % 4);
    for (const c of header) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, base + c.posOffset, c.posCount).slice(), 3));
      g.setIndex(new THREE.BufferAttribute((c.u16 ? new Uint16Array(buf, base + c.idxOffset, c.idxCount) : new Uint32Array(buf, base + c.idxOffset, c.idxCount)).slice(), 1));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: new THREE.Color(c.rgba[0], c.rgba[1], c.rgba[2]), roughness: 0.45, metalness: 0.1 }));
      mesh.castShadow = true;
      (bodies[c.body] ??= new THREE.Group()).add(mesh);
    }
    Object.values(bodies).forEach((g) => scene.add(g));
  } catch {}
  const objects = new THREE.Group();
  scene.add(objects);
  let current = 0, variant = 'success';

  function show() {
    const sc = scenes[current][variant];
    table.material.color.setRGB(...sc.table_rgb);
    for (const [name, p] of Object.entries(sc.bodies)) {
      const g = bodies[name];
      if (!g) continue;
      g.position.set(...p.pos);
      g.quaternion.set(p.quat[1], p.quat[2], p.quat[3], p.quat[0]);
    }
    objects.clear();
    for (const gm of sc.geoms) {
      if (gm.rgba[3] === 0) continue;
      const s = gm.size;
      let geo;
      if (gm.type === 'box') geo = new THREE.BoxGeometry(2 * s[0], 2 * s[1], 2 * s[2]);
      else if (gm.type === 'sphere') geo = new THREE.SphereGeometry(s[0], 24, 16);
      else { geo = new THREE.CylinderGeometry(s[0], s[0], 2 * s[1], 32); geo.rotateX(Math.PI / 2); }
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(gm.rgba[0], gm.rgba[1], gm.rgba[2]), roughness: 0.5 }));
      mesh.position.set(...gm.pos);
      mesh.quaternion.set(gm.quat[1], gm.quat[2], gm.quat[3], gm.quat[0]);
      mesh.castShadow = mesh.receiveShadow = true;
      objects.add(mesh);
    }
    const g0 = sc.geoms.find((g) => g.pos[2] > 0 && g.pos[2] < 0.2);
    if (g0) controls.target.set(g0.pos[0], g0.pos[1], 0.04);
  }
  const tabs = document.getElementById('scene-tabs');
  tabs.innerHTML = scenes.map((s, i) => `<button class="tab ${i === 0 ? 'active' : ''}" data-i="${i}">${s.task}</button>`).join('');
  tabs.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    tabs.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    current = +b.dataset.i;
    show();
  }));
  document.querySelectorAll('#variant-tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#variant-tabs button').forEach((x) => x.classList.toggle('active', x === b));
    variant = b.dataset.v;
    show();
  }));
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();
  show();
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
}

headline();
leaderboard();
sweep();
playRound();
gallery();
mmChart();
viewer();
