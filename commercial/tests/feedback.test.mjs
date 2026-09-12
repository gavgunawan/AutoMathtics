// Send feedback (the owner's request of 12 Sep 2026; hardened after the reviews of 12 Sep 2026): the words, the screen, the page's
// own operation id and, signed out, an address to be answered at, sent from the sign-in screen with the pre-authentication CSRF
// token or from a parent's session, which is checked as on every session route; who sent it is the session's to say, never the
// body's, and a child never sends one, not even a retry; a retried send is one note, also when eight arrive at once; the budgets
// are signed-out senders' and parents' apart, peeked before the note's transaction and spent in it only for a kept note, an IPv6
// /64 counting as one address and a /56 capped too, an instance's slot taken at its check; the UTC day caps signed-out notes and
// the owner's copies; kept 400 days, audited by id alone, in the family's export and gone with the family or the account; the
// operator's read; the paper trail; the button in the app, never on a device in kid mode, which the device remembers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fixture, secret } from './support.mjs';
import { uiFixture } from './ui-support.mjs';
import { createApp } from '../server/http.mjs';
import { mac } from '../server/security.mjs';
import { Feedback, FEEDBACK_TTL_MS, FEEDBACK_MAIL_TIMEOUT_MS, FEEDBACK_DAY, FEEDBACK_BUDGETS } from '../server/feedback.mjs';
import { createMailer } from '../server/mailer.mjs';
import { RETENTION, DELETION_GRACE_MS } from '../server/support.mjs';

const ORIGIN = 'https://pilot.example.test', OWNER = 'owner@example.test', KEY = `re_${'Ab12Cd34'.repeat(3)}`, DAY = 86_400_000;
const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
async function listen(t, f, { feedback = f.feedback, peerFactor = 20, ...more } = {}) {
  const cfg = { origin: ORIGIN, secret, emulator: true, web: { authDomain: 'demo-am-foundation.firebaseapp.com' }, ...more };
  const server = createApp(f.service, cfg, { feedback, peerFactor }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`, s = {};
  s.renew = async () => { const boot = await fetch(`${base}/api/bootstrap`); s.cookie = boot.headers.get('set-cookie').split(';')[0]; s.csrf = (await boot.json()).csrf; }; // a fresh pre-authentication cookie
  s.as = async (token) => { s.cookie = `__session=${token}`; s.csrf = (await (await fetch(`${base}/api/bootstrap`, { headers: { Cookie: s.cookie } })).json()).csrf; }; // inside that session
  // every note carries the page's operation id; a body that names its own (undefined: none at all) keeps it
  s.send = (data, extra = {}) => fetch(`${base}/api/feedback`, { method: 'POST', headers: { Cookie: s.cookie, Origin: ORIGIN, 'X-CSRF-Token': s.csrf, 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify('operationId' in data ? data : { operationId: randomUUID(), ...data }) });
  await s.renew(); return s;
}
const notes = async (f) => (await f.store.entries('feedback')).map(([id, d]) => ({ id, ...d }));
const sentRows = async (f) => (await f.store.list('audit')).filter((a) => a.action === 'feedback.sent');
const from = (ip) => ({ 'X-Forwarded-For': ip });
const storage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } }; };
// a store whose every read, inside a transaction or not, takes `ms` to answer (the transactions still run one at a time), so that
// requests sent together really are inside the route together; the function returned puts the store back as it was
const slow = (f, ms = 30) => {
  const store = f.store, proto = Object.getPrototypeOf(store), wait = () => new Promise((r) => setTimeout(r, ms));
  store.get = async (p) => { await wait(); return proto.get.call(store, p); };
  store.transaction = (fn, opts) => proto.transaction.call(store, (tx) => fn({ ...tx, get: async (p) => { await wait(); return tx.get(p); } }), opts);
  return () => { delete store.get; delete store.transaction; };
};

test('signed out: the words, the screen and an address to answer, with the pre-authentication CSRF token; kept under its operation id with the release for 400 days, counted for the day and audited by its id alone; Origin, CSRF and fetch metadata still guard it', async (t) => {
  const f = fixture(), s = await listen(t, f), day = new Date(f.now()).toISOString().slice(0, 10), operationId = randomUUID();
  const r = await s.send({ text: '  The timer is hard to read on my phone.\n\nOtherwise lovely!  ', page: 'sign-in', contact: ' someone@example.test ', operationId });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
  const [n] = await notes(f);
  assert.deepEqual(n, { id: operationId, text: 'The timer is hard to read on my phone.\n\nOtherwise lovely!', page: 'sign-in', at: f.now(), contact: 'someone@example.test', release: 'test-release', expireAt: f.now() + FEEDBACK_TTL_MS });
  assert.equal(FEEDBACK_TTL_MS, 400 * DAY);
  assert.deepEqual(await f.store.get(`feedbackDays/${day}`), { day, stored: 1, storedSignedOut: 1, copies: 0, copiesSignedOut: 0, expireAt: Date.parse(day) + 8 * DAY }, 'no mailer: no copy counted');
  const [a] = await sentRows(f);
  assert.deepEqual([a.feedbackId, a.uid, a.familyId, a.childId], [operationId, null, null, null]); assert.ok(!/timer|someone/.test(JSON.stringify(a)), 'the audit row holds ids, never the words or the address');
  assert.equal((await s.send({ text: 'No address this time', page: 'sign-in' })).status, 200);
  assert.ok(!('contact' in (await notes(f)).find((x) => x.text === 'No address this time')), 'no address, no field');
  for (const extra of [{ 'X-CSRF-Token': 'nope' }, { Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await s.send({ text: 'x', page: 'sign-in' }, extra)).status, 403, JSON.stringify(extra));
  assert.equal((await notes(f)).length, 2, 'the refused ones kept nothing');
});

test('inside a session the session names the sender: a parent\'s uid and family, never the body\'s; an address sent beside a session is dropped; the launch pad\'s and a child\'s sessions are refused, a replay of a kept note\'s id included', async (t) => {
  const f = fixture(), p = await f.family('parentA', 1), { child } = await f.child(p.ctx), s = await listen(t, f), kept = randomUUID();
  await s.as((await f.login('parentA')).cookie);
  assert.equal((await s.send({ text: 'From Mission Control', page: 'mission-control', contact: 'elsewhere@example.test', operationId: kept })).status, 200);
  const [n] = await notes(f); assert.deepEqual([n.uid, n.familyId, 'contact' in n], ['parentA', p.familyId, false], 'answered at the account address instead');
  const [a] = await sentRows(f); assert.deepEqual([a.uid, a.familyId, a.feedbackId], ['parentA', p.familyId, n.id]);
  const refused = async (body) => { const r = await s.send(body); assert.equal(r.status, 403, JSON.stringify(body)); assert.equal((await r.json()).error, 'PARENT_REQUIRED'); };
  const launchPad = await f.service.lock(p.ctx); await s.as(launchPad);
  await refused({ text: 'from the tablet', page: 'who-is-on-a-mission' }); await refused({ text: 'a replay from the tablet', page: 'who-is-on-a-mission', operationId: kept });
  await s.as(await f.service.selectChild(await f.service.authenticate(launchPad), child.id, '763829'));
  await refused({ text: 'from a child', page: 'your-grid' }); await refused({ text: 'a replay from a child', page: 'your-grid', operationId: kept });
  assert.equal((await notes(f)).length, 1, 'no free text from a child, nor from the launch pad');
});

test('a parent\'s session is checked as on every session route: revoked by a password reset it is refused (SESSION_REVOKED, as /api/me says), superseded it is sent back to sign-in, and neither writes a note or a stale family', async (t) => {
  const f = fixture(), p = await f.family('parentA', 1), s = await listen(t, f);
  await s.as((await f.login('parentA')).cookie);
  f.advance(2000); f.resetPassword('parentA'); f.advance(61_000); // the provider's emailed reset; identity rechecks are cached for a minute
  let r = await s.send({ text: 'after a password reset', page: 'mission-control' }); assert.equal(r.status, 401); assert.equal((await r.json()).error, 'SESSION_REVOKED');
  await s.as((await f.login('parentA')).cookie); // a fresh sign-in, then the parent record moves on (a family made from another session)
  await f.store.put('parents/parentA', { ...(await f.store.get('parents/parentA')), familyId: randomUUID() });
  r = await s.send({ text: 'from a superseded session', page: 'mission-control' }); assert.equal(r.status, 401); assert.equal((await r.json()).error, 'SIGN_IN_REQUIRED');
  assert.deepEqual([(await notes(f)).length, (await sentRows(f)).length], [0, 0], 'nothing kept, nothing audited, for family ' + p.familyId.slice(0, 8));
});

test('the body is checked before any budget is spent: 1 to 2000 characters once trimmed, a screen name, an address of at most 254 characters, the page\'s operation id, nothing else', async (t) => {
  const f = fixture(), s = await listen(t, f);
  const bad = [[{ text: '', page: 'x' }, 'FEEDBACK_TEXT'], [{ text: '   \n ', page: 'x' }, 'FEEDBACK_TEXT'], [{ text: 'a'.repeat(2001), page: 'x' }, 'FEEDBACK_TEXT'], [{ text: 5, page: 'x' }, 'FEEDBACK_TEXT'],
    [{ text: 'hi', page: 'Mission Control' }, 'INVALID_REQUEST'], [{ text: 'hi' }, 'INVALID_REQUEST'], [{ text: 'hi', page: 'x'.repeat(41) }, 'INVALID_REQUEST'], [{ text: 'hi', page: 'x', other: 1 }, 'INVALID_REQUEST'],
    [{ text: 'hi', page: 'x', contact: 'not-an-address' }, 'FEEDBACK_CONTACT'], [{ text: 'hi', page: 'x', contact: `${'a'.repeat(64)}@${'b'.repeat(186)}.com` }, 'FEEDBACK_CONTACT'], [{ text: 'hi', page: 'x', contact: null }, 'FEEDBACK_CONTACT'],
    [{ text: 'hi', page: 'x', operationId: undefined }, 'INVALID_ID'], [{ text: 'hi', page: 'x', operationId: 'not-an-operation-id' }, 'INVALID_ID']];
  for (const [body, code] of bad) { const r = await s.send(body); assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80)); assert.equal((await r.json()).error, code, JSON.stringify(body).slice(0, 80)); }
  assert.equal((await s.send({ text: 'a'.repeat(2000), page: 'x', contact: '' })).status, 200, '2000 characters, and an empty address, are fine');
  for (let i = 0; i < 4; i++) assert.equal((await s.send({ text: `note ${i}`, page: 'x' })).status, 200, 'the malformed ones spent nothing: four more fit the five an hour');
  assert.equal((await s.send({ text: 'sixth', page: 'x' })).status, 429);
  assert.equal((await notes(f)).length, 5);
});

test('a retried send is one note: the operation id is the note\'s id and its copy\'s Idempotency-Key; a retry is answered as the first send was, and spends, counts and mails nothing', async (t) => {
  const f = fixture(), calls = [], fetch = async (url, init) => { calls.push(init.headers['Idempotency-Key']); return { ok: true, status: 200, json: async () => ({ id: 'em_1' }) }; };
  const s = await listen(t, f, { feedback: new Feedback({ foundation: f.service, store: f.store, now: f.now, release: 'r1', mailer: createMailer({ provider: 'resend', apiKey: KEY, fetch }), to: OWNER }) });
  const operationId = randomUUID(), day = new Date(f.now()).toISOString().slice(0, 10);
  for (let i = 0; i < 8; i++) { const r = await s.send({ text: 'Once, please.', page: 'sign-in', operationId }); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true }); }
  assert.deepEqual((await notes(f)).map((n) => [n.id, n.text]), [[operationId, 'Once, please.']]); assert.deepEqual(calls, [`feedback:${operationId}`], 'one copy, under the note\'s own id');
  assert.equal((await sentRows(f)).length, 1); assert.equal((await f.store.get(`feedbackDays/${day}`)).stored, 1);
  for (let i = 0; i < 4; i++) assert.equal((await s.send({ text: `another ${i}`, page: 'sign-in' })).status, 200, 'eight tries of one note spent one of the five an hour');
  assert.equal((await s.send({ text: 'the sixth note', page: 'sign-in' })).status, 429);
});

test('budgets, each looked at before the note\'s transaction and spent in it only for a kept note: ten a day per session whatever the address, five an hour per address whatever the session, an IPv6 /64 as one address however written, and ten an hour per IPv6 /56 however its /64s rotate', async (t) => {
  const f = fixture(), s = await listen(t, f, { proxyHops: 1 }), hour = 60 * 60_000;
  for (let i = 0; i < 10; i++) assert.equal((await s.send({ text: `n${i}`, page: 'x' }, from(`10.0.0.${i}`))).status, 200);
  assert.equal((await s.send({ text: 'eleventh', page: 'x' }, from('10.0.0.10'))).status, 429, 'the eleventh from one session in a day');
  for (let i = 0; i < 5; i++) { await s.renew(); assert.equal((await s.send({ text: `a${i}`, page: 'x' }, from('10.0.0.10'))).status, 200, 'the refused eleventh spent none of its address\'s five'); }
  await s.renew(); assert.equal((await s.send({ text: 'sixth from one address', page: 'x' }, from('10.0.0.10'))).status, 429, 'the sixth from one address in an hour');
  f.advance(hour + 1000); // a fresh hour, and a fresh twenty for the instance's signed-out notes
  for (let i = 1; i <= 5; i++) { await s.renew(); assert.equal((await s.send({ text: `v${i}`, page: 'x' }, from(`2001:db8:1:2::${i.toString(16)}`))).status, 200); }
  await s.renew(); assert.equal((await s.send({ text: 'v6 again', page: 'x' }, from('2001:0db8:0001:0002:ffff:ffff:ffff:fffe'))).status, 429, 'the same /64, written out in full');
  for (let i = 3; i <= 7; i++) { await s.renew(); assert.equal((await s.send({ text: `the /64 number ${i}`, page: 'x' }, from(`2001:db8:1:${i}::1`))).status, 200, 'another /64 of the same /56'); }
  await s.renew(); assert.equal((await s.send({ text: 'an eleventh from the /56', page: 'x' }, from('2001:db8:1:ff::1'))).status, 429, 'ten an hour per /56, however its /64s rotate');
  await s.renew(); assert.equal((await s.send({ text: 'another /56', page: 'x' }, from('2001:db8:2:100::1'))).status, 200);
  f.advance(hour + 1000); await s.renew(); assert.equal((await s.send({ text: 'an hour on', page: 'x' }, from('10.0.0.10'))).status, 200);
});

test('signed-out senders and parents are budgeted apart: a caller forging X-Forwarded-For straight at the run.app host is held to twenty an hour behind its one real peer, on every instance, while a parent behind that same front end is still heard', async (t) => {
  const f = fixture(), one = await listen(t, f, { proxyHops: 2 }), two = await listen(t, f, { proxyHops: 2 }); // Hosting in front: the peer is the entry the Google front end appended
  assert.deepEqual(FEEDBACK_BUDGETS, { signedOut: { address: 5, net56: 10, peer: 20, session: 10, instance: 20 }, parent: { address: 5, session: 10, instance: 100 } });
  const forged = (i, peer = '198.51.100.7') => ({ 'X-Forwarded-For': `203.0.113.${i}, ${peer}` }); // a new "client" every time, one real caller
  for (let i = 0; i < 20; i++) { if (i % 10 === 0) await one.renew(); assert.equal((await one.send({ text: `junk ${i}`, page: 'x' }, forged(i))).status, 200); }
  await two.renew(); assert.equal((await two.send({ text: 'junk on another instance', page: 'x' }, forged(20))).status, 429, 'twenty an hour for the one caller behind them all, on every instance');
  assert.equal((await two.send({ text: 'someone else, signed out', page: 'x' }, forged(21, '198.51.100.8'))).status, 200, 'another front end is another peer');
  await one.as((await f.login('parentA')).cookie);
  assert.equal((await one.send({ text: 'a parent, same instance, same front end', page: 'mission-control' }, { 'X-Forwarded-For': '192.0.2.10, 198.51.100.7' })).status, 200, 'the parents\' peer and instance allowances are their own');
});

test('each instance\'s allowance counts only the notes it kept, signed-out senders\' twenty an hour apart from parents\' hundred: one address\'s refusals give their slots back and cannot use it up for everyone', async (t) => {
  const f = fixture(), w = await listen(t, f, { proxyHops: 1 });
  for (let i = 0; i < 5; i++) { await w.renew(); assert.equal((await w.send({ text: `a${i}`, page: 'x' }, from('10.9.9.9'))).status, 200); }
  for (let i = 0; i < 40; i++) { await w.renew(); assert.equal((await w.send({ text: `flood ${i}`, page: 'x' }, from('10.9.9.9'))).status, 429); }
  for (let i = 0; i < 15; i++) { if (i % 10 === 0) await w.renew(); assert.equal((await w.send({ text: `m${i}`, page: 'x' }, from(`10.1.0.${i}`))).status, 200, `note ${i} from another address`); }
  await w.renew(); const r = await w.send({ text: 'one too many', page: 'x' }, from('10.2.0.1'));
  assert.equal(r.status, 429); assert.equal((await r.json()).error, 'TOO_MANY_ATTEMPTS', 'twenty kept signed-out notes an hour per instance'); assert.equal((await notes(f)).length, 20);
  await w.as((await f.login('parentA')).cookie); assert.equal((await w.send({ text: 'a parent, all the same', page: 'mission-control' }, from('10.2.0.2'))).status, 200, 'the parents\' hundred are apart');
});

test('notes arriving together at the edge of an instance\'s allowance: the slot is taken at the check, so no more are kept than there are slots', async (t) => {
  const f = fixture(), w = await listen(t, f, { proxyHops: 1 });
  for (let i = 0; i < 18; i++) { if (i % 9 === 0) await w.renew(); assert.equal((await w.send({ text: `m${i}`, page: 'x' }, from(`10.1.0.${i}`))).status, 200); }
  await w.renew(); const restore = slow(f); // every read takes 30 ms now: five requests are inside the route at once
  const answers = await Promise.all([0, 1, 2, 3, 4].map((i) => w.send({ text: `at once ${i}`, page: 'x' }, from(`10.3.0.${i}`)))); restore();
  assert.deepEqual(answers.map((r) => r.status).sort(), [200, 200, 429, 429, 429], 'two slots left: two notes kept'); assert.equal((await notes(f)).length, 20);
});

test('eight sends of one note at once, over a store that answers in 30 ms: one note, one copy, one audit row, one slot of the day and one of the address; the seven retries give their instance slots back', async (t) => {
  const calls = [], fetch = async (url, init) => { calls.push(init.headers['Idempotency-Key']); return { ok: true, status: 200, json: async () => ({ id: `em_${calls.length}` }) }; };
  const f = fixture(), day = new Date(f.now()).toISOString().slice(0, 10);
  const s = await listen(t, f, { proxyHops: 1, feedback: new Feedback({ foundation: f.service, store: f.store, now: f.now, release: 'r1', mailer: createMailer({ provider: 'resend', apiKey: KEY, fetch }), to: OWNER }) });
  for (let i = 0; i < 12; i++) { if (i % 6 === 0) await s.renew(); assert.equal((await s.send({ text: `before ${i}`, page: 'x' }, from(`10.4.0.${i}`))).status, 200); } // twelve of the instance's twenty
  await f.store.put(`feedbackDays/${day}`, { ...(await f.store.get(`feedbackDays/${day}`)), copies: 0, copiesSignedOut: 0 }); // the day's copies are still to come
  await s.renew(); const operationId = randomUUID(), restore = slow(f);
  const answers = await Promise.all(Array.from({ length: 8 }, () => s.send({ text: 'Only once, please.', page: 'sign-in', operationId }, from('10.7.7.7'))));
  restore();
  assert.deepEqual(answers.map((r) => r.status), Array(8).fill(200), 'each answered as the first send was');
  assert.equal((await notes(f)).filter((n) => n.id === operationId).length, 1); assert.deepEqual(calls.filter((k) => k === `feedback:${operationId}`), [`feedback:${operationId}`], 'one copy');
  assert.equal((await sentRows(f)).filter((a) => a.feedbackId === operationId).length, 1, 'one audit row');
  assert.equal((await f.store.get(`feedbackDays/${day}`)).stored, 13, 'one slot of the day: twelve before, this one');
  assert.equal((await f.store.get(`rateLimits/${mac(secret, 'feedback-out:10.7.7.7')}`)).count, 1, 'one slot of the address');
  for (let i = 0; i < 7; i++) { if (i % 6 === 0) await s.renew(); assert.equal((await s.send({ text: `after ${i}`, page: 'x' }, from(`10.5.0.${i}`))).status, 200, 'the seven retries gave their instance slots back'); }
  await s.renew(); assert.equal((await s.send({ text: 'the twenty-first', page: 'x' }, from('10.6.0.1'))).status, 429);
});

test('a spent budget refuses before the note\'s transaction is opened: a flood of refusals takes no lock on the shared counters', async (t) => {
  const f = fixture(), s = await listen(t, f, { proxyHops: 1 }), proto = Object.getPrototypeOf(f.store); let opened = 0;
  f.store.transaction = (...args) => { opened++; return proto.transaction.apply(f.store, args); };
  for (let i = 0; i < 5; i++) { await s.renew(); assert.equal((await s.send({ text: `a${i}`, page: 'x' }, from('10.8.8.8'))).status, 200); }
  const before = opened;
  for (let i = 0; i < 10; i++) { await s.renew(); assert.equal((await s.send({ text: `refused ${i}`, page: 'x' }, from('10.8.8.8'))).status, 429); }
  assert.equal(opened, before, 'ten refusals, not one transaction'); delete f.store.transaction;
});

test('a UTC day\'s caps, whatever the addresses: at most a hundred notes from signed-out senders (then FEEDBACK_BUSY for them, never for a parent) and at most twenty copies to the owner, five of them for signed-out notes; past a copy cap the note is kept all the same', async (t) => {
  const f = fixture(), day = new Date(f.now()).toISOString().slice(0, 10), counts = () => f.store.get(`feedbackDays/${day}`), set = async (patch) => f.store.put(`feedbackDays/${day}`, { ...(await counts()), ...patch });
  const calls = [], logs = [], fetch = async (url, init) => { calls.push(JSON.parse(init.body).text); return { ok: true, status: 200, json: async () => ({ id: `em_${calls.length}` }) }; };
  const s = await listen(t, f, { feedback: new Feedback({ foundation: f.service, store: f.store, now: f.now, release: 'r1', mailer: createMailer({ provider: 'resend', apiKey: KEY, fetch }), to: OWNER, log: (e) => logs.push(e) }) });
  assert.deepEqual(FEEDBACK_DAY, { signedOut: 100, copies: 20, copiesSignedOut: 5 });
  assert.equal((await s.send({ text: 'first', page: 'sign-in' })).status, 200);
  assert.deepEqual(await counts(), { day, stored: 1, storedSignedOut: 1, copies: 1, copiesSignedOut: 1, expireAt: Date.parse(day) + 8 * DAY }); assert.equal(calls.length, 1);
  await set({ copies: 5, copiesSignedOut: 5 }); // five signed-out copies today: the next signed-out note is kept, not mailed; a parent's still is
  await s.renew(); assert.equal((await s.send({ text: 'kept, not mailed', page: 'sign-in' })).status, 200);
  assert.equal(calls.length, 1); assert.ok((await notes(f)).some((n) => n.text === 'kept, not mailed')); assert.deepEqual(logs.at(-1), { event: 'feedback_copy_skipped', reason: 'daily_cap' });
  await s.as((await f.login('parentA')).cookie); assert.equal((await s.send({ text: 'a parent, mailed', page: 'mission-control' })).status, 200); assert.equal(calls.length, 2);
  await set({ copies: 20 }); // twenty copies today: now even a parent's note is only kept
  assert.equal((await s.send({ text: 'a parent, kept', page: 'mission-control' })).status, 200); assert.equal(calls.length, 2); assert.ok((await notes(f)).some((n) => n.text === 'a parent, kept'));
  await set({ storedSignedOut: 100 }); // a hundred signed-out notes today, from anyone
  await s.renew(); const r = await s.send({ text: 'one too many today', page: 'sign-in' }); assert.equal(r.status, 429); assert.equal((await r.json()).error, 'FEEDBACK_BUSY');
  assert.ok(!(await notes(f)).some((n) => n.text === 'one too many today'));
  await s.as((await f.login('parentA')).cookie); assert.equal((await s.send({ text: 'a parent, still kept', page: 'mission-control' })).status, 200, 'never for a parent');
  f.advance(DAY); await s.renew(); assert.equal((await s.send({ text: 'a new day', page: 'sign-in' })).status, 200); assert.equal(calls.length, 3, 'the next UTC day mails again');
});

test('with Resend and FEEDBACK_TO the owner gets a copy: Reply goes to the parent\'s account address or to the address given, the words escaped in the HTML; a slow or failing provider never fails the request or loses the note; the fake provider, or no FEEDBACK_TO, emails nothing', async (t) => {
  const calls = [], mode = { now: 'ok' };
  const fetch = (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body), signal: init.signal });
    if (mode.now === 'hang') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    if (mode.now === 'down') return Promise.reject(Error('connect ECONNREFUSED'));
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: `em_${calls.length}` }) });
  };
  const f = fixture(), logs = [], feedback = new Feedback({ foundation: f.service, store: f.store, now: f.now, release: 'r1', mailer: createMailer({ provider: 'resend', apiKey: KEY, fetch }), to: OWNER, mailTimeoutMs: 50, log: (e) => logs.push(e) });
  const s = await listen(t, f, { feedback });
  assert.equal((await s.send({ text: 'Signed out <b>hello</b>', page: 'sign-in', contact: 'someone@example.test' })).status, 200);
  const [n] = await notes(f), [c] = calls;
  assert.deepEqual(c.body.to, [OWNER]); assert.equal(c.body.reply_to, 'someone@example.test'); assert.equal(c.headers['Idempotency-Key'], `feedback:${n.id}`);
  assert.equal(c.body.subject, 'AutoMathtics feedback · sign-in'); assert.ok(c.body.text.includes('Signed out <b>hello</b>') && c.body.text.includes(n.id));
  assert.ok(c.body.html.includes('Signed out &lt;b&gt;hello&lt;/b&gt;') && !c.body.html.includes('<b>'), 'escaped in the HTML'); assert.ok(c.signal instanceof AbortSignal);
  await s.as((await f.login('parentA')).cookie);
  assert.equal((await s.send({ text: 'Signed in', page: 'mission-control' })).status, 200); assert.equal(calls[1].body.reply_to, 'parentA@example.test', 'the account\'s own address');
  mode.now = 'hang'; const began = Date.now();
  assert.equal((await s.send({ text: 'A slow provider', page: 'mission-control' })).status, 200); assert.ok(Date.now() - began < 5000, 'a short wait');
  mode.now = 'down'; assert.equal((await s.send({ text: 'A provider down', page: 'mission-control' })).status, 200);
  assert.deepEqual(logs, [{ event: 'feedback_mail_failed', code: 'PROVIDER_UNREACHABLE' }, { event: 'feedback_mail_failed', code: 'PROVIDER_UNREACHABLE' }], 'a code in the log, never the words');
  assert.equal((await notes(f)).length, 4, 'every note kept'); assert.equal(FEEDBACK_MAIL_TIMEOUT_MS, 3000);
  const asked = calls.length;
  for (const mailer of [createMailer({ provider: 'fake' }), createMailer({ provider: 'resend', apiKey: KEY, fetch })]) {
    const g = fixture(), to = mailer.provider === 'fake' ? OWNER : null, w = await listen(t, g, { feedback: new Feedback({ foundation: g.service, store: g.store, now: g.now, release: 'r1', mailer, to }) });
    assert.equal((await w.send({ text: 'quiet', page: 'x' })).status, 200); assert.equal((await notes(g)).length, 1);
    if (mailer.provider === 'fake') assert.equal(mailer.sent.length, 0, 'the fake provider is not even asked');
  }
  assert.equal(calls.length, asked, 'no FEEDBACK_TO: Resend is not asked');
});

test('the family export carries its parents\' notes; the family\'s deletion removes them, the sign-in account\'s deletion removes those it sent without a family, and a note sent signed out, address and all, is in no export and outlives both', async (t) => {
  const f = fixture(), a = await f.family('parentA', 1), s = await listen(t, f);
  assert.equal((await s.send({ text: 'signed out', page: 'sign-in', contact: 'someone@example.test' })).status, 200);
  await s.as((await f.login('parentA')).cookie); assert.equal((await s.send({ text: 'from the family', page: 'mission-control' })).status, 200);
  const x = await f.support.exportFamily((await f.login('parentA')).ctx);
  assert.deepEqual(x.feedback.map((n) => [n.text, n.uid, n.page, n.release]), [['from the family', 'parentA', 'mission-control', 'test-release']], 'the family\'s own, not the one that names nobody');
  assert.ok(!JSON.stringify(x).includes('someone@example.test'));
  await f.support.requestDeletion(a.ctx, { operationId: randomUUID() }); f.advance(DELETION_GRACE_MS + 1);
  const record = await f.support.executeDeletion(a.familyId, { operator: 'ops@example.test' });
  assert.deepEqual((await notes(f)).map((n) => n.text), ['signed out']); assert.equal(record.counts.feedback, 1);
  f.advance(2000); const q = await f.login('parentA'); await s.as(q.cookie);
  assert.equal((await s.send({ text: 'no family now', page: 'step-2-of-3-your-crew' })).status, 200);
  assert.ok((await notes(f)).some((n) => n.text === 'no family now' && n.uid === 'parentA' && !('familyId' in n)));
  await f.support.deleteAccount(q.ctx, { operationId: randomUUID() });
  assert.deepEqual((await notes(f)).map((n) => n.text), ['signed out'], 'only the note that names nobody, which goes by TTL');
});

const execFileP = promisify(execFile), CLI = fileURLToPath(new URL('../scripts/report.mjs', import.meta.url));
const cli = (env, args) => execFileP(process.execPath, [CLI, ...args], { env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT || '', ...env } }).then(() => ({ code: 0, err: '' }), (e) => ({ code: e.code, err: String(e.stderr) }));
test('the operator\'s read: the notes of the last N days, newest first, with what it takes to answer; the CLI\'s feedback command reads its arguments strictly and needs no signing secret', async () => {
  const f = fixture(), put = (id, at, more = {}) => f.store.put(`feedback/${id}`, { text: `note ${id}`, page: 'mission-control', at, release: 'r1', expireAt: at + FEEDBACK_TTL_MS, ...more });
  await put('a', f.now() - 8 * DAY); await put('b', f.now() - 2 * DAY, { uid: 'parentA', familyId: 'fam-1' }); await put('c', f.now() - 60_000, { contact: 'someone@example.test' });
  const reader = new Feedback({ store: f.store, now: f.now }), week = await reader.recent(7);
  assert.deepEqual(week.map((n) => n.id), ['c', 'b'], 'newest first; eight days ago is out');
  assert.deepEqual(week[0], { id: 'c', at: new Date(f.now() - 60_000).toISOString(), page: 'mission-control', release: 'r1', uid: null, familyId: null, contact: 'someone@example.test', text: 'note c' });
  assert.deepEqual([week[1].uid, week[1].familyId, week[1].contact], ['parentA', 'fam-1', null]); assert.equal((await reader.recent(30)).length, 3);
  const src = await readFile(CLI, 'utf8');
  assert.ok(src.includes("feedback: { options: ['--days']") && src.includes("if (!reading && !owners && !/^[a-f0-9]{64,}$/.test(env.SESSION_SECRET || ''))"), 'the read signs nothing, so it needs no SESSION_SECRET (nor does the leaving report)');
  for (const args of [['feedback', '--days'], ['feedback', '--days', 'x'], ['feedback', '--days', '0'], ['feedback', '--days', '401'], ['feedback', '--days', '7', '--days', '8'], ['feedback', 'all'], ['feedback', '--week', '2026-W36']]) {
    const r = await cli({}, args); assert.equal(r.code, 64, args.join(' ')); assert.match(r.err, /node scripts\/report\.mjs feedback \[--days N\]/);
  }
  assert.match((await cli({}, ['feedback', '--days', '30'])).err, /Set APP_MODE/, 'good arguments: then the environment');
  assert.match((await cli({ APP_MODE: 'staging', FIREBASE_PROJECT_ID: 'automathtics-v3-staging', CONFIRM_PROJECT: 'automathtics-v3-staging' }, ['feedback'])).err, /Set OPERATOR_ID/, 'the operator is named, as for every read');
});

test('the paper trail: the privacy rows (the notes, the owner\'s copies, the day counts, the kid-mode marker), RETENTION, both TTL lists, the deployment section and helper, the README, the acceptance row; the route passes the naming rule', async () => {
  const privacy = await read('../PRIVACY.md'), deploy = await read('../DEPLOY_V3.md'), acceptance = await read('../ACCEPTANCE.md'), perms = await read('../scripts/cloudshell/02-permissions.sh'), http = await read('../server/http.mjs');
  for (const s of ['`feedback/{id}`', '`feedbackDays/{YYYY-MM-DD}`', '`automathtics.kidmode`', 'FEEDBACK_TO', 'Never from a child', 'stays in the owner\'s mailbox and in Resend\'s log', 'no export carries it and no deletion finds it']) assert.ok(privacy.includes(s), s);
  assert.match(RETENTION['feedback/* (sent signed out)'], /TTL 400 days/); assert.match(RETENTION['feedback/* (sent signed out)'], /no export carries them/);
  assert.match(RETENTION['feedback copies (the owner\'s mailbox, Resend\'s log)'], /no family or account deletion reaches it/);
  for (const [name, text] of [['DEPLOY_V3.md', deploy], ['02-permissions.sh', perms]]) { const groups = text.match(/for GROUP in ([^;]+); do/)[1].split(/\s+/); for (const g of ['feedback', 'feedbackDays']) assert.ok(groups.includes(g), `${name}: ${g} expires by TTL`); }
  for (const s of ['## 5c. Feedback', 'node scripts/report.mjs feedback --days 7', 'export FEEDBACK_TO=', 'IPv6 /64', 'FEEDBACK_BUSY', 'at most 20 copies to the owner, 5 of them', 'signed-out senders\' and parents\' apart', '10 per IPv6 /56', '20 per peer']) assert.ok(deploy.includes(s), s);
  assert.ok(!deploy.includes('with Hosting\'s shared front end allowed twenty times that'), 'no allowance shared by signed-out senders and parents any more');
  assert.ok(!deploy.includes('Budgets: five an hour per address, ten a day per session, a hundred an\nhour per instance.'), 'the old description is gone');
  assert.match(acceptance, /^\| P10 \| Tap \*Send feedback\*.*reload the tablet/m);
  const readme = await read('../README.md'); for (const s of ['`feedback/{id}`', '`feedbackDays/{YYYY-MM-DD}`']) assert.ok(readme.includes(s), s);
  assert.ok(!(await read('../server/mailer.mjs')).includes('the web service itself never sends'), 'the mailer\'s comment says what is true now');
  assert.ok(http.includes("path === '/api/feedback'")); assert.doesNotMatch('/api/feedback', /transfer|import|export|migrat|move|merge|clone|copy|link|invite/i);
  const helper = await read('../scripts/deploy-staging.sh');
  assert.ok(helper.includes('FEEDBACK_TO: p.FEEDBACK_TO') && helper.includes('[ "${EMAIL_PROVIDER:-fake}" = resend ] && echo \',EMAIL_API_KEY=am-v3-email-key:1\''), 'the deploy passes FEEDBACK_TO on, and the key only with Resend');
});

test('UI: Send feedback under the sign-in screen (its notes say sign-in or sign-up), with an address to answer if wanted, and under every parent screen, without one; one operation id per note; Cancel sends nothing; never in kid mode, nor on the sign-in screen reached from it', async (t) => {
  const has = (x) => x.nodes('BUTTON').some((b) => b.textContent === 'Send feedback');
  const h = await uiFixture(t, { signedIn: false }), posts = () => h.requests.filter((r) => r.path === '/api/feedback').length;
  assert.ok(has(h), 'under the sign-in screen');
  await h.click('Send feedback');
  const words = h.nodes('TEXTAREA')[0], reply = h.nodes('INPUT').find((i) => i.type === 'email' && i.required === false);
  assert.ok(words && reply, 'the words and, signed out, an address'); assert.equal(words.maxLength, 2000); assert.equal(reply.maxLength, 254);
  await h.click('Send'); assert.ok(h.message.textContent.includes('Write your feedback first'), h.message.textContent); assert.equal(posts(), 0);
  words.value = 'The timer is hard to read.'; reply.value = 'not-an-address'; await h.click('Send');
  assert.ok(h.message.textContent.includes('does not look right'), h.message.textContent); assert.equal(posts(), 0);
  reply.value = 'someone@example.test'; await h.click('Send');
  assert.equal(posts(), 1); assert.ok(h.message.textContent.includes('Thank you'), h.message.textContent); assert.equal(h.nodes('TEXTAREA').length, 0, 'the panel closes');
  const [[id, n]] = await h.f.store.entries('feedback');
  assert.deepEqual([n.text, n.contact, n.page, n.uid], ['The timer is hard to read.', 'someone@example.test', 'sign-in', undefined], 'the sign-in screen reports its own page');
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'kept under the page\'s operation id');
  await h.click('Send feedback'); h.nodes('TEXTAREA')[0].value = 'never mind'; await h.click('Cancel');
  assert.equal(posts(), 1, 'Cancel sends nothing'); assert.equal(h.nodes('TEXTAREA').length, 0);
  h.api.signInScreen(true); await h.click('Send feedback'); h.nodes('TEXTAREA')[0].value = 'Signing up was easy.'; await h.click('Send');
  assert.ok((await h.f.store.list('feedback')).some((x) => x.text === 'Signing up was easy.' && x.page === 'sign-up'), 'and the sign-up screen its own');
  // a parent screen: no address to give, the session says who
  const p = await uiFixture(t); await p.f.child(p.a.ctx); await p.api.refresh(); assert.ok(has(p), 'under Mission Control');
  await p.click('Send feedback'); assert.ok(!p.nodes('INPUT').some((i) => i.type === 'email' && i.required === false), 'no address signed in');
  p.nodes('TEXTAREA')[0].value = 'Love the rocket.'; await p.click('Send');
  const [m] = await p.f.store.list('feedback'); assert.deepEqual([m.text, m.uid, m.familyId, m.contact, m.page], ['Love the rocket.', 'parentA', p.a.familyId, undefined, 'mission-control']);
  // kid mode: the launch pad, the PIN screen, the child's home, a game, the shop, the map, and the sign-in screen reached from it
  await p.click('Hand over to kids'); assert.ok(p.root.textContent.includes('PLAYER SELECTION') && !has(p), 'the launch pad');
  await p.nodes('BUTTON').find((b) => b.className === 'player-card').onclick(); assert.ok(p.root.textContent.includes('Enter my grid') && !has(p), 'the PIN screen');
  p.nodes('INPUT')[0].value = '763829'; await p.click('Enter my grid'); assert.ok(p.root.textContent.includes('grid coins · spend in 🛒') && !has(p), 'the child\'s home');
  await p.click('⚙️ Start Engine ▶'); assert.ok(p.root.textContent.includes('Paper 1 · 1/25') && !has(p), 'a game');
  await p.click('✕ Quit'); await p.click('🛒 Shop'); assert.ok(p.root.textContent.includes('GRID SHOP') && !has(p), 'the shop');
  await p.click('Back'); await p.click('🗺 Map'); assert.ok(p.root.textContent.includes('🗺 SECTOR A ROUTE') && !has(p), 'the map');
  await p.click('Back'); await p.click('Parent sign-in'); assert.ok(p.root.textContent.includes('Sign in as parent') && !has(p), 'nor the sign-in screen reached from kid mode');
  p.f.advance(2000); p.setAuth(); await p.submitLogin(); // a sign-in newer than the handover: one from its very second is refused (REAUTHENTICATE)
  assert.ok(p.root.textContent.includes('Hand over to kids') && has(p), 'back for the parent once signed in');
});

test('UI: kid mode is remembered on the device: after a reload, or once the launch pad has expired, the tablet\'s sign-in screen shows no Send feedback until a parent\'s session opens there; with no storage, the page\'s memory alone', async (t) => {
  const has = (x) => x.nodes('BUTTON').some((b) => b.textContent === 'Send feedback'), device = storage();
  const h = await uiFixture(t, { storage: device }); await h.f.child(h.a.ctx); await h.api.refresh();
  assert.ok(has(h)); assert.equal(device.getItem('automathtics.kidmode'), null);
  await h.click('Hand over to kids'); assert.equal(device.getItem('automathtics.kidmode'), '1', 'the launch pad marks the device');
  const later = await uiFixture(t, { signedIn: false, storage: device }); // the tablet reloaded with no session left: the launch pad's twelve hours are over
  assert.ok(later.root.textContent.includes('Sign in as parent') && !has(later), 'still kid mode after the reload');
  later.setAuth(); await later.submitLogin();
  assert.ok(has(later), 'a parent\'s session opened here: the button is back'); assert.equal(device.getItem('automathtics.kidmode'), null, 'and the mark is gone');
  const bare = await uiFixture(t); await bare.f.child(bare.a.ctx); await bare.api.refresh(); await bare.click('Hand over to kids'); assert.ok(!has(bare));
  const reloaded = await uiFixture(t, { signedIn: false }); assert.ok(has(reloaded), 'without storage nothing outlives the page');
});

test('UI: a Send that meets a revoked session says so in words and takes the tab to sign-in, as a refresh does; nothing is kept', async (t) => {
  const h = await uiFixture(t); await h.click('Send feedback'); h.nodes('TEXTAREA')[0].value = 'After a reset elsewhere.';
  h.f.advance(2000); h.f.resetPassword('parentA'); h.f.advance(61_000); // the password was reset from another device; identity rechecks are cached for a minute
  await h.click('Send');
  assert.ok(h.root.textContent.includes('Sign in as parent'), 'the sign-in screen, as refresh() shows it');
  assert.equal(h.message.textContent, 'Your sign-in has ended: the password or the mobile number changed. Please sign in again.');
  assert.equal((await h.f.store.list('feedback')).length, 0);
});

test('UI: on the parent-verification screen a session is still open, so no reply address is offered (an answer goes to the account\'s address) and the note is the parent\'s', async (t) => {
  const h = await uiFixture(t); await h.draft(); // a sensitive action after five minutes: PARENT VERIFICATION, with the session still open
  await h.click('Send feedback');
  assert.ok(!h.nodes('INPUT').some((i) => i.type === 'email' && i.required === false), 'no address field while a session is live');
  assert.ok(h.root.textContent.includes('Any answer goes to your account’s email address.'));
  h.nodes('TEXTAREA')[0].value = 'The verification step is clear.'; await h.click('Send');
  const [n] = await h.f.store.list('feedback'); assert.deepEqual([n.text, n.page, n.uid, n.contact], ['The verification step is clear.', 'parent-verification', 'parentA', undefined]);
  assert.ok(h.root.textContent.includes('PARENT VERIFICATION'), 'and the verification goes on, undisturbed');
});
