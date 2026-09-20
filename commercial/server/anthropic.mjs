// The Claude API as the tutor uses it (server/tutor.mjs): one call, one reply. No SDK — the service's only dependency is
// firebase-admin — and nothing but the model's words comes back. The key is read from the environment by config.mjs and is
// never logged, never echoed and never sent anywhere but api.anthropic.com.
import { TUTOR_MODEL } from './tutor.mjs';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export function createModel({ apiKey, model = TUTOR_MODEL, fetchFn = globalThis.fetch, timeoutMs = 20_000 }) {
  if (typeof apiKey !== 'string' || !apiKey) throw Error('createModel needs the API key.');
  return async ({ system, messages, maxTokens }) => {
    const res = await fetchFn(ANTHROPIC_URL, {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
    });
    if (!res.ok) { const text = typeof res.text === 'function' ? await res.text().catch(() => '') : ''; const e = Error(`anthropic ${res.status}`); e.status = res.status; e.body = String(text).slice(0, 300); throw e; } // the API's own words on a refusal (a wrong key, no credit, an unknown model), for the log — never the key
    const j = await res.json();
    return (Array.isArray(j.content) ? j.content : []).filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('').trim();
  };
}
