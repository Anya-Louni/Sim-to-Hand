import { JUDGE_SYSTEM, PLAN_SYSTEM, judgeUserText, planUserText, type JudgePayload, type PlanPayload } from './prompts.ts';

export type LLMRequest = { kind: 'plan'; payload: PlanPayload } | { kind: 'judge'; payload: JudgePayload };

export interface LLMKeys {
  gemini?: string;
  groq?: string;
}

export interface LLMConfig {
  geminiModels: string[];
  groqModel: string;
}

export const DEFAULT_CONFIG: LLMConfig = {
  geminiModels: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'],
  groqModel: 'openai/gpt-oss-120b',
};

export interface LLMResponse {
  text: string;
  provider: string;
}

export class LLMError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function gemini(key: string, model: string, system: string, text: string, image?: string): Promise<string> {
  const parts: unknown[] = [{ text }];
  if (image) parts.push({ inlineData: { mimeType: 'image/jpeg', data: image } });
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    }),
  });
  if (!res.ok) throw new LLMError(`gemini ${model}: ${res.status} ${(await res.text()).slice(0, 200)}`, res.status);
  const data = await res.json();
  const out = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
  if (!out) throw new LLMError(`gemini ${model}: empty response`, 502);
  return out;
}

async function groq(key: string, model: string, system: string, text: string): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
    }),
  });
  if (!res.ok) throw new LLMError(`groq ${model}: ${res.status} ${(await res.text()).slice(0, 200)}`, res.status);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

/**
 * Runs one request with fallback: each Gemini model in order, then Groq (text only, plans only).
 * Used by the proxy with server keys and by the browser with a visitor's own keys.
 */
export async function executeLLM(req: LLMRequest, keys: LLMKeys, config: LLMConfig = DEFAULT_CONFIG): Promise<LLMResponse> {
  const errors: string[] = [];
  const system = req.kind === 'plan' ? PLAN_SYSTEM : JUDGE_SYSTEM;
  const text = req.kind === 'plan' ? planUserText(req.payload) : judgeUserText(req.payload);
  const image = req.payload.image;
  if (keys.gemini) {
    for (const model of config.geminiModels) {
      try {
        return { text: await gemini(keys.gemini, model, system, text, image), provider: `gemini/${model}` };
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
  }
  if (req.kind === 'judge' && !keys.gemini) throw new LLMError('vision check needs a Gemini key (no API key for vision)', 503);
  if (req.kind === 'plan' && keys.groq) {
    const note = image ? '\n(The camera image is not available to you; rely on the scene text.)' : '';
    try {
      return { text: await groq(keys.groq, config.groqModel, system, text + note), provider: `groq/${config.groqModel}` };
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (!keys.gemini && !keys.groq) throw new LLMError('no API key configured', 503);
  throw new LLMError(errors.join(' | ') || 'no provider available for this request', 502);
}
