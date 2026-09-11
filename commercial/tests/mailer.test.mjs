// The mailer (email-v1): the fake provider records instead of sending (in memory; in the outbox for 14 days when given a
// store); Resend gets exactly the request its API documents, the key only in its header, with an Idempotency-Key and the
// RFC 8058 one-click headers; a failure or the deadline is a provider code carrying neither the key nor the address.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailer, mailerConfig, maskAddress, RESEND_API, OUTBOX_TTL_MS, DEFAULT_FROM, SEND_TIMEOUT_MS } from '../server/mailer.mjs';
import { MemoryStore } from './support.mjs';

const KEY = `re_${'Ab12Cd34'.repeat(3)}`, TO = 'parent.a@example.test';
const message = (more = {}) => ({ to: TO, subject: 'Allison this week: 4 missions, 92% right', html: '<p>week</p>', text: 'week', idempotencyKey: 'report:f1:2026-W36',
  headers: { 'List-Unsubscribe': '<https://pilot.example.test/api/email/unsubscribe?t=v1.a.b>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }, tags: [{ name: 'kind', value: 'weekly_report' }], ...more });
function provider(answer) {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body), signal: init.signal }); return typeof answer === 'function' ? answer(init) : { ok: answer.status < 400, status: answer.status, json: async () => answer.json }; };
  return { fetch, calls };
}
const clean = (e) => { const said = JSON.stringify({ message: e.message, code: e.code, provider: e.provider, stack: e.stack }); return !said.includes(KEY) && !said.includes(TO); };

test('fake: the email is recorded, never sent: in memory, and in the outbox for 14 days with the family it belongs to', async () => {
  const store = new MemoryStore(), now = 1_000_000, m = createMailer({ provider: 'fake', store, now: () => now, fetch: async () => { throw Error('no network in the fake'); } });
  const r = await m.send({ ...message(), familyId: 'f1' });
  assert.equal(r.provider, 'fake'); assert.match(r.id, /^fake_[0-9a-f-]{36}$/);
  assert.equal(m.sent.length, 1); assert.equal(m.sent[0].to, TO); assert.equal(m.sent[0].from, DEFAULT_FROM); assert.deepEqual(m.sent[0].headers, message().headers); assert.equal(m.sent[0].idempotencyKey, 'report:f1:2026-W36');
  const row = await store.get(`outbox/${r.id}`);
  assert.equal(row.familyId, 'f1'); assert.equal(row.html, '<p>week</p>'); assert.equal(row.expireAt, now + OUTBOX_TTL_MS); assert.equal(OUTBOX_TTL_MS, 14 * 86_400_000);
  const bare = createMailer(); await bare.send(message()); assert.equal(bare.sent.length, 1, 'no store: memory only');
});

test('resend: one POST to the documented endpoint, the key as a bearer token, the Idempotency-Key, the one-click headers in the body, the provider\'s id back', async () => {
  const p = provider({ status: 200, json: { id: 'em_123' } }), m = createMailer({ provider: 'resend', apiKey: KEY, from: 'AutoMathtics <reports@example.test>', fetch: p.fetch });
  assert.deepEqual(await m.send({ ...message(), familyId: 'f1' }), { id: 'em_123', provider: 'resend' });
  assert.equal(p.calls.length, 1); const c = p.calls[0];
  assert.equal(c.url, RESEND_API); assert.equal(RESEND_API, 'https://api.resend.com/emails'); assert.equal(c.method, 'POST');
  assert.deepEqual(c.headers, { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'report:f1:2026-W36' });
  assert.deepEqual(c.body, { from: 'AutoMathtics <reports@example.test>', to: [TO], subject: message().subject, html: '<p>week</p>', text: 'week', headers: message().headers, tags: message().tags }, 'the family id never leaves the server');
  assert.ok(c.signal instanceof AbortSignal, 'a deadline rides with the request'); assert.ok(!JSON.stringify(c.body).includes(KEY), 'the key only in its header'); assert.equal(m.sent.length, 0);
  const plain = provider({ status: 200, json: { id: 'em_2' } }); await createMailer({ provider: 'resend', apiKey: KEY, fetch: plain.fetch }).send(message({ idempotencyKey: null }));
  assert.equal(plain.calls[0].headers['Idempotency-Key'], undefined); assert.equal(plain.calls[0].body.from, DEFAULT_FROM);
});

test('resend failures: unreachable, the 10-second deadline, a refusal, an answer without an id: each a provider code carrying neither the key nor the address', async () => {
  assert.equal(SEND_TIMEOUT_MS, 10_000);
  const down = createMailer({ provider: 'resend', apiKey: KEY, fetch: async () => { throw Error(`connect ECONNREFUSED ${KEY} ${TO}`); } });
  await assert.rejects(down.send(message()), (e) => e.code === 'PROVIDER_UNREACHABLE' && e.status === 502 && clean(e));
  const hang = (init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const slow = createMailer({ provider: 'resend', apiKey: KEY, fetch: provider(hang).fetch, timeoutMs: 30 }), t0 = Date.now();
  await assert.rejects(slow.send(message()), (e) => e.code === 'PROVIDER_UNREACHABLE' && clean(e)); assert.ok(Date.now() - t0 < 2000, 'the deadline ended it, not the provider');
  const refused = createMailer({ provider: 'resend', apiKey: KEY, fetch: provider({ status: 422, json: { statusCode: 422, name: 'validation_error', message: `Invalid \`to\` field: ${TO}` } }).fetch });
  await assert.rejects(refused.send(message()), (e) => e.code === 'PROVIDER_ERROR' && e.provider.status === 422 && e.provider.name === 'validation_error' && clean(e));
  const limited = createMailer({ provider: 'resend', apiKey: KEY, fetch: provider({ status: 429, json: { name: 'rate_limit_exceeded' } }).fetch });
  await assert.rejects(limited.send(message()), (e) => e.code === 'PROVIDER_ERROR' && e.provider.status === 429);
  const odd = createMailer({ provider: 'resend', apiKey: KEY, fetch: provider({ status: 200, json: {} }).fetch });
  await assert.rejects(odd.send(message()), (e) => e.code === 'PROVIDER_ERROR');
});

test('resend: a key refused as reused with another body means an email under it is there already (sent, unconfirmed, not a failure); a key still in flight says nothing yet: a failure to retry', async () => {
  const conflict = (name) => createMailer({ provider: 'resend', apiKey: KEY, fetch: provider({ status: 409, json: { statusCode: 409, name, message: 'Same idempotency key used with a different request payload.' } }).fetch });
  assert.deepEqual(await conflict('invalid_idempotent_request').send(message()), { id: null, provider: 'resend', unconfirmed: 'invalid_idempotent_request' });
  await assert.rejects(conflict('concurrent_idempotent_requests').send(message()), (e) => e.code === 'PROVIDER_IN_FLIGHT' && e.status === 502 && clean(e), 'the first request under the key is still being handled');
  const other = createMailer({ provider: 'resend', apiKey: KEY, fetch: provider({ status: 409, json: { name: 'something_else' } }).fetch });
  await assert.rejects(other.send(message()), (e) => e.code === 'PROVIDER_ERROR' && e.provider.status === 409, 'any other conflict stays an error');
});

test('an email the mailer cannot vouch for is refused before any provider hears of it', async () => {
  const p = provider({ status: 200, json: { id: 'em_x' } }), m = createMailer({ provider: 'resend', apiKey: KEY, fetch: p.fetch }), fake = createMailer();
  for (const bad of [{ to: 'not-an-address' }, { to: '' }, { to: 'a@b' }, { subject: '' }, { subject: 'x'.repeat(201) }, { html: null }, { text: 7 }]) {
    await assert.rejects(m.send(message(bad)), (e) => e.code === 'INVALID_EMAIL', JSON.stringify(bad)); await assert.rejects(fake.send(message(bad)), (e) => e.code === 'INVALID_EMAIL');
  }
  assert.equal(p.calls.length, 0); assert.equal(fake.sent.length, 0);
});

test('the job\'s mailer settings: fake by default, resend only with its key, a sender that is an address, and the key never in a message', () => {
  assert.deepEqual(mailerConfig({}), { provider: 'fake', apiKey: null, from: DEFAULT_FROM }); assert.equal(DEFAULT_FROM, 'AutoMathtics <onboarding@resend.dev>');
  assert.deepEqual(mailerConfig({ EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: KEY }), { provider: 'resend', apiKey: KEY, from: DEFAULT_FROM });
  assert.equal(mailerConfig({ EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: KEY, EMAIL_FROM: 'reports@automathtics.example' }).from, 'reports@automathtics.example');
  assert.throws(() => mailerConfig({ EMAIL_PROVIDER: 'resend' }), /EMAIL_API_KEY/);
  const wrong = `sk_live_${'x'.repeat(20)}`; assert.throws(() => mailerConfig({ EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: wrong }), (e) => /EMAIL_API_KEY/.test(e.message) && !e.message.includes(wrong));
  assert.throws(() => mailerConfig({ EMAIL_PROVIDER: 'smtp' }), /"fake" or "resend"/);
  for (const from of ['AutoMathtics', 'Name <not-an-address>', 'a@b.co\r\nBcc: x@y.zz']) assert.throws(() => mailerConfig({ EMAIL_FROM: from }), /EMAIL_FROM/, from);
  assert.throws(() => createMailer({ provider: 'resend' }), /API key/); assert.throws(() => createMailer({ provider: 'smtp' }), /Unknown/);
  assert.equal(maskAddress('gav.parent@example.test'), 'g…@example.test'); assert.equal(maskAddress('nonsense'), '…');
});
