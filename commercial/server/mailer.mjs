// The mailer (email-v1): one send() over two providers.
//  • fake: records the rendered email instead of sending it, in memory (`sent`, for tests) and, when a store is given, in
//    outbox/{id} for 14 days by TTL: the staging preview until the owner has a Resend account (only the owner can open one).
//  • resend: POST https://api.resend.com/emails with the account key as a bearer token and an Idempotency-Key (Resend keeps a key
//    for 24 hours, so a retry inside them is the same email), within 10 seconds. A network failure or the timeout is
//    PROVIDER_UNREACHABLE, a refusal PROVIDER_ERROR with the provider's status and error name; neither carries the key, the
//    address or the email (the pattern of gateways/stripe.mjs api()).
import { randomUUID } from 'node:crypto';
import { Fault, fail } from './security.mjs';

export const RESEND_API = 'https://api.resend.com/emails';
export const OUTBOX_TTL_MS = 14 * 86_400_000, SEND_TIMEOUT_MS = 10_000;
// Resend's shared test sender: without a verified domain it delivers only to the Resend account owner's own address, which is
// the pilot (the owner is the only parent). A domain comes before any other family (DEPLOY_V3.md → Email).
export const DEFAULT_FROM = 'AutoMathtics <onboarding@resend.dev>';
const ADDRESS = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[^\s@<>"]{2,}$/, KEY = /^re_[A-Za-z0-9_-]{8,}$/;
const FROM = /^(?:[^<>\r\n"]{1,80} <[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[^\s@<>"]{2,}>|[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[^\s@<>"]{2,})$/;
/** a.parent@example.com → a…@example.com: enough to tell two parents apart in a log line, never the address itself. */
export const maskAddress = (to) => { const [local, domain] = String(to || '').split('@'); return local && domain ? `${local.slice(0, 1)}…@${domain}` : '…'; };

/** The job's mailer settings, from its environment (the web service itself never sends). */
export function mailerConfig(env = process.env) {
  const provider = env.EMAIL_PROVIDER || 'fake', from = env.EMAIL_FROM || DEFAULT_FROM;
  if (!['fake', 'resend'].includes(provider)) throw Error('EMAIL_PROVIDER must be "fake" or "resend".');
  if (!FROM.test(from)) throw Error('EMAIL_FROM must be an address, or "Name <address>".');
  if (provider === 'fake') return { provider, apiKey: null, from };
  if (!KEY.test(env.EMAIL_API_KEY || '')) throw Error('Set EMAIL_API_KEY to the Resend API key (re_…); it lives in Secret Manager as am-v3-email-key.');
  return { provider, apiKey: env.EMAIL_API_KEY, from };
}

/**
 * send({ to, subject, html, text, headers, idempotencyKey, tags, familyId }) → { id, provider }. `familyId` never leaves the
 * server: the fake provider's outbox row carries it so that a family's deletion takes its previews with it (support.mjs).
 */
export function createMailer({ provider = 'fake', apiKey = null, from = DEFAULT_FROM, fetch = globalThis.fetch, now = Date.now, store = null, timeoutMs = SEND_TIMEOUT_MS } = {}) {
  if (!['fake', 'resend'].includes(provider)) throw Error('Unknown email provider.');
  if (provider === 'resend' && !KEY.test(apiKey || '')) throw Error('The resend provider needs its API key.');
  const sent = [];
  async function send({ to, subject, html, text, headers = {}, idempotencyKey = null, tags = [], familyId = null } = {}) {
    if (!ADDRESS.test(to || '') || typeof subject !== 'string' || !subject || subject.length > 200 || typeof html !== 'string' || typeof text !== 'string') fail(400, 'INVALID_EMAIL');
    if (provider === 'fake') {
      const id = `fake_${randomUUID()}`, at = now(), row = { id, provider, from, to, subject, html, text, headers, tags, idempotencyKey, at };
      sent.push(row);
      if (store) await store.transaction(async (tx) => tx.set(`outbox/${id}`, { ...row, familyId, expireAt: at + OUTBOX_TTL_MS }));
      return { id, provider };
    }
    let res;
    try {
      res = await fetch(RESEND_API, { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
        body: JSON.stringify({ from, to: [to], subject, html, text, headers, tags }) });
    } catch { fail(502, 'PROVIDER_UNREACHABLE'); }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || typeof json?.id !== 'string') { const e = new Fault(502, 'PROVIDER_ERROR'); e.provider = { status: res.status, name: typeof json?.name === 'string' ? json.name.slice(0, 64) : null }; throw e; }
    return { id: json.id, provider };
  }
  return { provider, from, send, sent };
}
