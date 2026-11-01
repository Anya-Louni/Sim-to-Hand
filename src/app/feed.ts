import { stepText, type AgentEvent } from '../core/agent.ts';
import { COLORS } from '../core/scene.ts';
import type { Goal, Skill } from '../core/types.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function swatch(name: string) {
  const color = (COLORS as Record<string, number[]>)[name.replace('_zone', '')];
  if (!color) return '';
  const [r, g, b] = color.map((v) => Math.round(v * 255));
  return `<span class="swatch" style="background:rgb(${r},${g},${b})"></span>`;
}

const goalText = (g: Goal) => (g.pred === 'on' ? `on(${g.a}, ${g.b})` : `in_zone(${g.a}, ${g.zone})`);

function skillHtml(s: Skill) {
  const arg = s.skill === 'move_to' ? s.target : s.skill === 'grasp' ? s.object : s.skill === 'place' ? s.on : '';
  return `${s.skill}(${arg ? swatch(arg) + esc(arg) : ''})`;
}

/** Renders agent events into the side panel. */
export class Feed {
  private stepLists = new Map<number, HTMLOListElement>();

  private el: HTMLElement;
  private statusEl: HTMLElement;
  private statusText: HTMLElement;
  private attemptEl: HTMLElement;

  constructor(el: HTMLElement, statusEl: HTMLElement, statusText: HTMLElement, attemptEl: HTMLElement) {
    this.el = el;
    this.statusEl = statusEl;
    this.statusText = statusText;
    this.attemptEl = attemptEl;
  }

  clear() {
    this.el.innerHTML = '';
    this.stepLists.clear();
    this.attemptEl.textContent = '';
  }

  status(text: string, kind: 'idle' | 'busy' | 'ok' | 'bad' = 'busy') {
    this.statusText.textContent = text;
    this.statusEl.className = `status ${kind}`;
  }

  private card(cls: string, html: string) {
    const d = document.createElement('div');
    d.className = `card ${cls}`;
    d.innerHTML = html;
    this.el.appendChild(d);
    this.el.scrollTop = this.el.scrollHeight;
    return d;
  }

  note(cls: string, title: string, body: string) {
    this.card(cls, `<h3>${esc(title)}</h3><p>${esc(body)}</p>`);
  }

  handle(e: AgentEvent) {
    switch (e.type) {
      case 'status':
        this.status(e.message);
        break;
      case 'attempt':
        this.attemptEl.textContent = `attempt ${e.attempt + 1}`;
        break;
      case 'plan': {
        const c = this.card(
          'plan',
          `<h3><span>Plan ${e.attempt + 1}</span><span class="src">${esc(e.provider)}</span></h3>
           <p>${esc(e.plan.reasoning)}</p>
           <div class="goals" title="${e.goalSource === 'task' ? 'Ground truth uses the task definition' : 'Ground truth uses the goal the planner wrote'}">${e.plan.goal.map((g) => `<span class="goal">${esc(goalText(g))}</span>`).join('')}</div>
           <ol class="steps">${e.plan.steps.map((s) => `<li><span>${skillHtml(s)}</span><span class="mark"></span></li>`).join('')}</ol>`,
        );
        this.stepLists.set(e.attempt, c.querySelector('ol')!);
        this.status('Executing');
        break;
      }
      case 'plan_error':
        this.note('error', 'Planner error', e.message);
        break;
      case 'step': {
        const li = this.stepLists.get(e.attempt)?.children[e.index] as HTMLLIElement | undefined;
        if (!li) break;
        li.className = e.status;
        li.querySelector('.mark')!.textContent = e.status === 'ok' ? '✓' : e.status === 'failed' ? '✗' : '…';
        if (e.error) li.insertAdjacentHTML('beforeend', `<span class="step-err">${esc(e.error)}</span>`);
        if (e.status === 'running') li.scrollIntoView({ block: 'nearest' });
        break;
      }
      case 'chaos':
        this.note('chaos', 'Chaos', e.message);
        break;
      case 'verify': {
        const g = e.ground;
        const v = e.vision;
        const vVerdict = v ? (v.success ? '<div class="verdict ok">Success</div>' : '<div class="verdict bad">Failure</div>') : '<div class="verdict na">Unavailable</div>';
        const vWhy = v ? esc(v.reason) : esc(e.visionError ?? 'No vision model configured');
        const agree =
          [e.agree === false ? 'vision' : '', e.sensors.ok !== g.ok ? 'sensors' : ''].filter(Boolean).length === 0 ? '<div class="agree yes">All checks agree</div>' : `<div class="agree no">${[e.agree === false ? 'Vision' : '', e.sensors.ok !== g.ok ? 'Sensors' : ''].filter(Boolean).join(' and ')} disagree with sim state. Logged. Sim state decides.</div>`;
        this.card(
          'verify',
          `<h3><span>Verify ${e.attempt + 1}</span>${v ? `<span class="src">${esc(v.provider)}</span>` : ''}</h3>
           <div class="checks">
             <div class="check"><div class="label">Sim state</div><div class="verdict ${g.ok ? 'ok' : 'bad'}">${g.ok ? 'Success' : 'Failure'}</div><div class="why">${esc(g.summary)}</div></div>
             <div class="check"><div class="label">Vision</div>${vVerdict}<div class="why">${vWhy}</div></div>
             <div class="check"><div class="label">Sensors</div><div class="verdict ${e.sensors.ok ? 'ok' : 'bad'}">${e.sensors.ok ? 'Success' : 'Failure'}</div><div class="why">${esc(e.sensors.summary)}</div></div>
           </div>
           ${e.image ? `<img class="snap" alt="Verification camera view" src="data:image/jpeg;base64,${e.image}">` : ''}
           ${agree}`,
        );
        break;
      }
      case 'replan':
        this.note('replan', 'Replan', e.reason);
        break;
      case 'done': {
        const r = e.result;
        const detail = `${r.attempts} attempt${r.attempts > 1 ? 's' : ''}, ${r.replans} replan${r.replans === 1 ? '' : 's'}, ${r.chaosEvents} chaos event${r.chaosEvents === 1 ? '' : 's'}, ${r.llmCalls} LLM call${r.llmCalls === 1 ? '' : 's'}`;
        this.card(`result ${r.success ? 'ok' : 'bad'}`, `${r.success ? 'Task complete' : 'Task failed'}<small>${esc(detail)}</small>`);
        this.status(r.success ? 'Done' : 'Failed', r.success ? 'ok' : 'bad');
        break;
      }
    }
  }
}

export { stepText };
