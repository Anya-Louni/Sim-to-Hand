import { executeLLM, type LLMKeys, type LLMRequest, type LLMResponse } from '../llm/providers.ts';

const KEY_STORE = 'sim-to-hand.keys';

export function loadKeys(): LLMKeys {
  try {
    return JSON.parse(localStorage.getItem(KEY_STORE) ?? '{}');
  } catch {
    return {};
  }
}

export function saveKeys(keys: LLMKeys) {
  try {
    if (!keys.gemini && !keys.groq) localStorage.removeItem(KEY_STORE);
    else localStorage.setItem(KEY_STORE, JSON.stringify(keys));
  } catch {
    /* storage blocked: keys stay in memory for this page only */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Visitor keys go straight from the browser to the provider and never touch the proxy.
 * Without keys, requests go through the proxy, which holds the server keys.
 */
export function makeTransport(getKeys: () => LLMKeys, retries = 2): (req: LLMRequest) => Promise<LLMResponse> {
  return async (req) => {
    let lastErr: Error = new Error('request failed');
    for (let i = 0; i <= retries; i++) {
      if (i > 0) await sleep(4000 * i * i);
      const keys = getKeys();
      try {
        if (keys.gemini || keys.groq) return await executeLLM(req, keys);
        const res = await fetch('/api/llm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
        const json = await res.json().catch(() => ({ error: `proxy returned ${res.status}` }));
        if (res.ok) return json as LLMResponse;
        lastErr = new Error(json.error ?? `proxy returned ${res.status}`);
        if (res.status === 400 || res.status === 503) break;
      } catch (e) {
        lastErr = e as Error;
        if (/no API key/i.test(lastErr.message)) break;
      }
    }
    throw lastErr;
  };
}
