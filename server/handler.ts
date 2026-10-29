import { DEFAULT_CONFIG, LLMError, executeLLM, type LLMConfig, type LLMRequest } from '../src/llm/providers.ts';

export interface Env {
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  GEMINI_MODELS?: string;
  GROQ_MODEL?: string;
  RATE_PER_10MIN?: string;
  RATE_PER_DAY?: string;
}

// Best-effort limits. Memory is per server instance, so this is basic protection, not a quota system.
const hits = new Map<string, number[]>();
let day = '';
let dayCount = 0;

function limited(ip: string, env: Env): string | null {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    dayCount = 0;
    hits.clear();
  }
  const perDay = Number(env.RATE_PER_DAY ?? 400);
  if (dayCount >= perDay) return 'The shared demo key reached its daily limit. Add your own free key in Settings.';
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (list.length >= Number(env.RATE_PER_10MIN ?? 30)) return 'Too many requests from your address. Wait a few minutes or add your own key in Settings.';
  list.push(now);
  hits.set(ip, list);
  dayCount++;
  return null;
}

const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;

function parse(body: unknown): LLMRequest | string {
  const b = body as Record<string, any>;
  if (!b || typeof b !== 'object') return 'body must be JSON';
  const p = b.payload ?? {};
  if (b.kind === 'plan') {
    if (!str(p.instruction, 400) || !str(p.scene, 3000)) return 'invalid plan payload';
    if (!Array.isArray(p.history) || p.history.length > 6 || JSON.stringify(p.history).length > 8000) return 'invalid history';
    if (p.image !== undefined && !str(p.image, 400_000)) return 'image too large';
    if (p.invalid !== undefined && !str(p.invalid, 1500)) return 'invalid field too large';
    return { kind: 'plan', payload: { instruction: p.instruction, scene: p.scene, history: p.history, image: p.image, invalid: p.invalid } };
  }
  if (b.kind === 'judge') {
    if (!str(p.instruction, 400) || !str(p.image, 400_000)) return 'invalid judge payload';
    return { kind: 'judge', payload: { instruction: p.instruction, image: p.image } };
  }
  return 'kind must be plan or judge';
}

export async function handleLLM(body: unknown, env: Env, ip: string): Promise<{ status: number; json: unknown }> {
  const req = parse(body);
  if (typeof req === 'string') return { status: 400, json: { error: req } };
  const block = limited(ip, env);
  if (block) return { status: 429, json: { error: block } };
  const config: LLMConfig = {
    geminiModels: env.GEMINI_MODELS ? env.GEMINI_MODELS.split(',').map((s) => s.trim()) : DEFAULT_CONFIG.geminiModels,
    groqModel: env.GROQ_MODEL || DEFAULT_CONFIG.groqModel,
  };
  try {
    const out = await executeLLM(req, { gemini: env.GEMINI_API_KEY, groq: env.GROQ_API_KEY }, config);
    return { status: 200, json: out };
  } catch (e) {
    const status = e instanceof LLMError ? e.status : 500;
    // Upstream errors can echo request details; keep the message short.
    return { status: status === 429 || status === 503 ? status : 502, json: { error: (e as Error).message.slice(0, 300) } };
  }
}
