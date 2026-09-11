// The buttons in an email (email-v1): a signed, expiring token each, checked in constant time and against the family, its owner
// and the child as they are now; the app's panel asks describe() what a button does and calls apply() only on a tap; RFC 8058
// one-click unsubscribe works cross-site with no cookie, Origin or CSRF token, and a GET changes nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture, rejected, secret } from './support.mjs';
import { uiFixture } from './ui-support.mjs';
import { createApp } from '../server/http.mjs';
import { signEmailToken, readEmailToken, LINK_ACTIONS } from '../server/email.mjs';
import { DELETION_GRACE_MS } from '../server/support.mjs';

const DAY = 86_400_000, WEEK = '2026-W35';
const token = (f, a, more = {}) => signEmailToken(secret, { a: 'pace', u: 'parentA', f: a.familyId, c: a.childId, v: 75, w: WEEK, e: f.now() + 14 * DAY, ...more });
const unsubToken = (f, a, more = {}) => signEmailToken(secret, { a: 'unsub', u: 'parentA', f: a.familyId, v: 'progress', w: WEEK, e: f.now() + 365 * DAY, ...more });
async function setup(f, uid = 'parentA') { const a = await f.family(uid, 2); const { child } = await f.child(a.ctx, 'Allison'); return { ...a, childId: child.id }; }
const prog = (f, a) => f.store.get(`families/${a.familyId}/learning/${a.childId}`);
const applied = async (f) => (await f.store.list('audit')).filter((x) => x.action === 'email.action_applied');
const setFamily = (f, id, patch) => f.store.transaction(async (tx) => { const fam = await tx.get(`families/${id}`); tx.set(`families/${id}`, { ...fam, ...patch }); });
async function listen(t, f) {
  const cfg = { origin: 'https://pilot.example.test', secret, emulator: true, web: { authDomain: 'demo-am-foundation.firebaseapp.com' } };
  const server = createApp(f.service, cfg, { email: f.email }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`, boot = await fetch(`${base}/api/bootstrap`), cookie = boot.headers.get('set-cookie').split(';')[0], { csrf } = await boot.json();
  return { base, call: (path, data, more = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { Cookie: cookie, Origin: cfg.origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json', ...more }, body: JSON.stringify(data) }) };
}

test('a token is signed with its own key and read back only unchanged, only with what this server signs, and only until it expires', () => {
  const now = Date.parse('2026-09-07T00:00:00Z'), base = { a: 'pace', u: 'parentA', f: randomUUID(), c: randomUUID(), v: 75, w: WEEK, e: now + 14 * DAY };
  const t = signEmailToken(secret, base), [v, body, sig] = t.split('.');
  assert.match(t, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/); assert.deepEqual(readEmailToken(secret, t, now), base); assert.deepEqual(LINK_ACTIONS, { focus: 14, pace: 14, unsub: 365 });
  const bad = (x, code = 'LINK_INVALID') => assert.throws(() => readEmailToken(secret, x, now), (e) => e.code === code, String(x).slice(0, 80));
  // tampering: a new payload under the old signature, a new signature, another version, another secret, cut short, junk
  bad(`${v}.${Buffer.from(JSON.stringify({ ...base, v: 200 })).toString('base64url')}.${sig}`); bad(`${v}.${body}.${sig.slice(0, -1)}${sig.at(-1) === 'A' ? 'B' : 'A'}`);
  bad(`v2.${body}.${sig}`); bad(signEmailToken('b3'.repeat(32), base)); bad(`${v}.${body}`); for (const junk of ['', 'v1..', null, 42, `${t}.x`]) bad(junk);
  // only what this server signs: known actions, the value each takes, a child for pace and focus and none for unsub, nothing extra
  for (const p of [{ a: 'delete' }, { v: 5 }, { v: 201 }, { v: '75' }, { v: 7.5 }, { c: undefined }, { c: 'not-a-child' }, { f: 'not-a-family' }, { u: 'bad uid' }, { w: 'soon' }, { e: 'later' }, { extra: 1 },
    { a: 'focus', v: 'yes' }, { a: 'unsub', v: 'progress' }, { a: 'unsub', c: undefined, v: 'news' }]) bad(signEmailToken(secret, { ...base, ...p }));
  assert.equal(readEmailToken(secret, signEmailToken(secret, { ...base, a: 'focus', v: false }), now).v, false);
  assert.equal(readEmailToken(secret, signEmailToken(secret, { a: 'unsub', u: 'parentA', f: base.f, v: 'progress', w: WEEK, e: now + 365 * DAY }), now).a, 'unsub');
  // time: dead at its expiry, and never longer-lived than its kind allows (a day of slack)
  bad(signEmailToken(secret, { ...base, e: now }), 'LINK_EXPIRED'); bad(signEmailToken(secret, { ...base, e: now + 16 * DAY })); assert.ok(readEmailToken(secret, signEmailToken(secret, { ...base, e: now + 15 * DAY }), now));
});

test('describe says what a button does and changes nothing; apply does it and audits it, and a second tap sets the same value', async () => {
  const f = fixture(), a = await setup(f), pace = token(f, a);
  assert.deepEqual(await f.email.describe({ t: pace }), { valid: true, action: 'pace', nickname: 'Allison', value: 75, current: 100, email: null, reason: null });
  assert.equal(await prog(f, a), null, 'describe wrote nothing');
  assert.deepEqual(await f.email.apply({ t: pace }), { ok: true, message: 'Allison’s question time is now 75%.' }); assert.equal((await prog(f, a)).pacePercent, 75);
  assert.deepEqual(await f.email.apply({ t: pace }), { ok: true, message: 'Allison’s question time is now 75%.' }); assert.equal((await prog(f, a)).pacePercent, 75, 'twice is harmless');
  const rows = await applied(f); assert.equal(rows.length, 2); assert.deepEqual([rows[0].uid, rows[0].familyId, rows[0].childId, rows[0].kind, rows[0].week], ['parentA', a.familyId, a.childId, 'pace', WEEK]);
  assert.equal((await f.email.describe({ t: pace })).current, 75, 'the panel shows the value as it now is');
  const on = token(f, a, { a: 'focus', v: true }), off = token(f, a, { a: 'focus', v: false });
  assert.deepEqual(await f.email.describe({ t: on }), { valid: true, action: 'focus', nickname: 'Allison', value: true, current: false, email: null, reason: null });
  assert.equal((await f.email.apply({ t: on })).message, 'Allison’s next System Scan focuses on the weak spots: about 75% of its questions.');
  assert.equal((await prog(f, a)).scanFocus, true); assert.equal((await prog(f, a)).pacePercent, 75, 'the pace stays');
  assert.equal((await f.email.apply({ t: off })).message, 'Allison’s System Scan is back to the normal mix.'); assert.equal((await prog(f, a)).scanFocus, false);
  // stopping the report: off, a change row from the email door, the address masked in the panel, Mission Control agrees
  const unsub = unsubToken(f, a);
  assert.deepEqual(await f.email.describe({ t: unsub }), { valid: true, action: 'unsub', nickname: null, value: 'progress', current: true, email: 'p…@example.test', reason: null });
  assert.equal((await f.email.apply({ t: unsub })).message, 'The weekly progress report is off. Switch it back on in Mission Control whenever you like.');
  const prefs = await f.store.get('emailPrefs/parentA'); assert.equal(prefs.progress, false); assert.equal(prefs.news, false); assert.deepEqual(prefs.changes.map((c) => c.source), ['email']);
  await f.email.apply({ t: unsub }); assert.equal((await f.store.get('emailPrefs/parentA')).changes.length, 1, 'already off: no second change row');
  assert.equal((await f.service.me(a.ctx)).emailPrefs.progress, false);
});

test('a button stops working when its link is spoiled or has expired, or what it was about has gone: another family, a child not in it, another parent, a family being deleted or deleted', async () => {
  const f = fixture(), a = await setup(f), b = await setup(f, 'parentB');
  const old = token(f, a, { e: f.now() + 1000 }); f.advance(1000);
  assert.deepEqual(await f.email.describe({ t: old }), { valid: false, reason: 'expired' }); await assert.rejects(f.email.apply({ t: old }), rejected('LINK_EXPIRED'));
  assert.deepEqual(await f.email.describe({ t: 'v1.junk.sig' }), { valid: false, reason: 'invalid' }); await assert.rejects(f.email.apply({ t: 'nope' }), rejected('LINK_INVALID'));
  await assert.rejects(f.email.describe({ t: token(f, a), extra: 1 }), rejected('INVALID_REQUEST'));
  const gone = async (t, why) => { assert.deepEqual(await f.email.describe({ t }), { valid: false, reason: 'gone' }, why); await assert.rejects(f.email.apply({ t }), rejected('LINK_GONE'), why); };
  await gone(token(f, a, { f: b.familyId }), 'family B named by parent A'); await gone(token(f, a, { c: b.childId }), 'B\'s child in A\'s family'); await gone(token(f, a, { u: 'parentB' }), 'A\'s family named for B\'s parent');
  assert.equal(await prog(f, b), null); assert.equal(await prog(f, a), null, 'nothing was written anywhere');
  await f.support.requestDeletion(a.ctx, { operationId: randomUUID() });
  assert.equal((await f.email.describe({ t: token(f, a) })).valid, true, 'a deletion only requested: the family is still here for its 14 days');
  await setFamily(f, a.familyId, { deletion: { ...(await f.store.get(`families/${a.familyId}`)).deletion, status: 'executing' } });
  await gone(token(f, a), 'a deletion under way'); await gone(unsubToken(f, a), 'the unsubscribe too');
  const { status, ...requested } = (await f.store.get(`families/${a.familyId}`)).deletion; void status; await setFamily(f, a.familyId, { deletion: requested }); // back to requested, for the real execution below
  f.advance(DELETION_GRACE_MS); await f.support.executeDeletion(a.familyId, { operator: 'ops@example.test' });
  await gone(token(f, a), 'a tombstone'); assert.equal(await f.store.get('emailPrefs/parentA'), null, 'and no record resurrected');
});

test('the routes: describe and apply before any session with the pre-authentication CSRF token, or inside one; Origin, CSRF and fetch metadata enforced; budgeted per address; names that pass the no-transfer rule', async (t) => {
  const f = fixture(), a = await setup(f), s = await listen(t, f);
  let r = await s.call('/api/email/describe', { t: token(f, a) }); assert.equal(r.status, 200); assert.equal((await r.json()).action, 'pace');
  for (const more of [{ 'X-CSRF-Token': 'nope' }, { Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await s.call('/api/email/apply', { t: token(f, a) }, more)).status, 403, JSON.stringify(more));
  assert.equal(await prog(f, a), null, 'refused requests change nothing');
  r = await s.call('/api/email/apply', { t: token(f, a) }); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, message: 'Allison’s question time is now 75%.' });
  const csrf = (await f.service.me(a.ctx)).csrf; // a remembered Mission Control, or the kids' tablet: the session's own token
  r = await s.call('/api/email/describe', { t: token(f, a, { v: 90 }) }, { Cookie: `__session=${a.cookie}`, 'X-CSRF-Token': csrf }); assert.equal(r.status, 200); assert.equal((await r.json()).current, 75);
  r = await s.call('/api/email/apply', { t: 'v1.bad.bad' }); assert.equal(r.status, 400); assert.equal((await r.json()).error, 'LINK_INVALID');
  for (let i = 0; i < 16; i++) assert.equal((await s.call('/api/email/describe', { t: 'v1.x.y' })).status, 200); // twenty an hour from one address…
  assert.equal((await s.call('/api/email/describe', { t: token(f, a) })).status, 429, '…then 429');
  const http = await readFile(new URL('../server/http.mjs', import.meta.url), 'utf8');
  for (const route of ["'/api/auth/consent'", "'/api/account/email'", "'/api/email/describe'", "'/api/email/apply'", "'/api/email/unsubscribe'"]) { assert.ok(http.includes(route), route); assert.doesNotMatch(route, /transfer|import|export|migrat|move|merge|clone|copy|link|invite/i); }
});

test('one-click unsubscribe (RFC 8058): the provider\'s cross-site POST with no cookie, Origin or CSRF token turns the report off; only that body and an unsub token; forgeries budgeted; a GET changes nothing and opens the app on the same token', async (t) => {
  const f = fixture(), a = await setup(f), s = await listen(t, f), unsub = unsubToken(f, a);
  const post = (tok, body = 'List-Unsubscribe=One-Click', type = 'application/x-www-form-urlencoded', more = {}) => fetch(`${s.base}/api/email/unsubscribe?t=${tok}`, { method: 'POST', headers: { 'Content-Type': type, 'Sec-Fetch-Site': 'cross-site', ...more }, body });
  let r = await fetch(`${s.base}/api/email/unsubscribe?t=${unsub}`, { redirect: 'manual', headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(r.status, 303); assert.equal(r.headers.get('location'), `/?email=${unsub}`); assert.equal(await f.store.get('emailPrefs/parentA'), null, 'a GET changes nothing');
  r = await fetch(`${s.base}/api/email/unsubscribe?t=%3Cscript%3E`, { redirect: 'manual' }); assert.equal(r.headers.get('location'), '/', 'nothing strange is echoed');
  assert.equal((await fetch(`${s.base}/api/email/unsubscribe?t=${unsub}`, { method: 'PUT' })).status, 405);
  assert.equal((await post(unsub, 'something=else')).status, 400); assert.equal((await post(unsub, '{"List-Unsubscribe":"One-Click"}', 'application/json')).status, 415);
  assert.equal((await post(unsub, 'List-Unsubscribe=One-Click', 'application/x-www-form-urlencoded', { 'Content-Encoding': 'gzip' })).status, 415);
  assert.equal(await f.store.get('emailPrefs/parentA'), null);
  r = await post(unsub); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /^text\/plain/);
  assert.equal(await r.text(), 'The weekly progress report is off. Switch it back on in Mission Control whenever you like.');
  const prefs = await f.store.get('emailPrefs/parentA'); assert.equal(prefs.progress, false); assert.equal(prefs.changes.at(-1).source, 'email');
  assert.ok((await applied(f)).some((x) => x.kind === 'unsub' && x.uid === 'parentA' && x.familyId === a.familyId));
  r = await post(unsub, '--b0undary\r\nContent-Disposition: form-data; name="List-Unsubscribe"\r\n\r\nOne-Click\r\n--b0undary--\r\n', 'multipart/form-data; boundary=b0undary'); assert.equal(r.status, 200, 'the multipart form the RFC prefers');
  assert.equal((await post(token(f, a))).status, 400, 'a pace button is no unsubscribe'); assert.equal((await prog(f, a)), null);
  for (let i = 0; i < 59; i++) assert.equal((await post('v1.bad.bad')).status, 400); // sixty forged tokens from one address…
  assert.equal((await post('v1.bad.bad')).status, 429, '…then 429'); assert.equal((await post(unsub)).status, 200, 'a real token is never refused for its address');
});

test('UI: an email button opens a panel that says exactly what it will do; Cancel changes nothing and Confirm does it; signed out too; a dead link says so', async (t) => {
  let a;
  const withPace = async (f, parent) => { const { child } = await f.child(parent.ctx, 'Allison'); a = { ...parent, childId: child.id }; return { search: `?email=${token(f, a)}`, pathname: '/' }; };
  const h = await uiFixture(t, { location: withPace });
  assert.ok(h.root.textContent.includes('Confirm this change')); assert.ok(h.root.textContent.includes('Set Allison’s question time to 75% (now 100%).'), h.root.textContent.slice(0, 300));
  assert.equal(h.requests.filter((r) => r.path === '/api/email/apply').length, 0, 'opening the link applied nothing');
  await h.click('Cancel'); assert.ok(h.message.textContent.includes('Nothing was changed.')); assert.ok(h.root.textContent.includes('Email updates'), 'back in Mission Control'); assert.equal(await prog(h.f, a), null);
  const g = await uiFixture(t, { location: withPace });
  await g.click('Confirm'); assert.equal((await prog(g.f, a)).pacePercent, 75); assert.ok(g.message.textContent.includes('Allison’s question time is now 75%.'), g.message.textContent);
  const u = await uiFixture(t, { signedIn: false, location: async (f) => ({ search: `?email=${unsubToken(f, await f.family('parentA', 2))}`, pathname: '/' }) });
  assert.ok(u.root.textContent.includes('Stop the weekly progress report for p…@example.test. Account and security emails still come.'), u.root.textContent.slice(0, 300));
  await u.click('Confirm'); assert.equal((await u.f.store.get('emailPrefs/parentA')).progress, false); assert.ok(u.root.textContent.includes('Sign in as parent'), 'back at sign-in, signed out as before');
  const d = await uiFixture(t, { location: async (f, parent) => ({ search: `?email=${signEmailToken(secret, { a: 'unsub', u: 'parentA', f: parent.familyId, v: 'progress', w: WEEK, e: f.now() - 1 })}`, pathname: '/' }) });
  assert.ok(d.root.textContent.includes('This link no longer works.') && d.root.textContent.includes('work for 14 days')); await d.click('Close'); assert.ok(d.root.textContent.includes('Email updates'));
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8'), boot = app.slice(app.indexOf("if (returned?.get('email'))"));
  assert.ok(boot.indexOf("history.replaceState(null, '', location.pathname)") < boot.indexOf('emailScreen(token)'), 'the address is tidied first'); assert.ok(app.indexOf("if (returned?.get('email'))") < app.indexOf('\nguardBack();'));
});
