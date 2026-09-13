// Email consent at sign-up and the switches behind Mission Control (email-v1): both boxes sent and the required one required,
// recorded by the server from the new account's own token, once, before any session, and never for an account being deleted;
// only a failed token check spends a budget, so a parent's consent is never lost to someone else's junk; the switches need a
// recent sign-in and keep a versioned history whose sign-up row is kept for good, and a save that changes nothing adds nothing;
// the record goes with the sign-in account and comes with the family export; the pages say it in words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fixture, rejected, secret } from './support.mjs';
import { uiFixture } from './ui-support.mjs';
import { createApp } from '../server/http.mjs';
import { prefsOf, withChange } from '../server/email.mjs';
import { DELETION_GRACE_MS } from '../server/support.mjs';

const BAD_TOKEN = 'not-a-real-token-000000000000', V = 'email-v1';
const audits = async (f, action) => (await f.store.list('audit')).filter((x) => x.action === action);
async function listen(t, f, more = {}) {
  const cfg = { origin: 'https://pilot.example.test', secret, emulator: true, web: { authDomain: 'demo-am-foundation.firebaseapp.com' }, ...more };
  const server = createApp(f.service, cfg, { email: f.email }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`, s = { base, cfg };
  s.renew = async () => { const boot = await fetch(`${base}/api/bootstrap`); s.cookie = boot.headers.get('set-cookie').split(';')[0]; s.csrf = (await boot.json()).csrf; }; // a pre-authentication cookie lives ten minutes
  s.call = (path, data, extra = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { Cookie: s.cookie, Origin: cfg.origin, 'X-CSRF-Token': s.csrf, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(data) });
  await s.renew(); return s;
}

test('sign-up consent: the new account\'s own token and both boxes, recorded once, before any session and without a parent record; the required box must be ticked; an account being deleted, a bad token, CSRF token, origin or body records nothing', async (t) => {
  const f = fixture(), s = await listen(t, f);
  const token = f.token('newParent'); // a brand-new account: no parent record, no session
  let r = await s.call('/api/auth/consent', { idToken: token, progress: true, news: true });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
  const doc = await f.store.get('emailPrefs/newParent');
  assert.equal(doc.progress, true); assert.equal(doc.news, true); assert.equal(doc.version, V); assert.equal(doc.updatedAt, f.now());
  assert.deepEqual(doc.changes, [{ at: f.now(), progress: true, news: true, cadence: 'weekly', source: 'signup', version: V }]);
  assert.equal(await f.store.get('parents/newParent'), null, 'parents/{uid} is never created early: login() makes it, in its own shape');
  const rows = await audits(f, 'email.consent_recorded'); assert.equal(rows.length, 1); assert.equal(rows[0].uid, 'newParent'); assert.equal(rows[0].familyId, null); assert.equal(rows[0].childId, null);
  // only if absent: a second call, or anyone else holding the token, changes nothing
  f.advance(1000); r = await s.call('/api/auth/consent', { idToken: token, progress: true, news: false }); assert.equal(r.status, 200);
  assert.deepEqual(await f.store.get('emailPrefs/newParent'), doc); assert.equal((await audits(f, 'email.consent_recorded')).length, 1);
  // news left out: the report on, news off
  assert.equal((await s.call('/api/auth/consent', { idToken: f.token('quietParent'), progress: true })).status, 200);
  assert.deepEqual(prefsOf(await f.store.get('emailPrefs/quietParent')), { progress: true, news: false, cadence: 'weekly' });
  // the required box not sent, or not ticked: nothing recorded
  for (const body of [{ idToken: f.token('carelessParent'), news: true }, { idToken: f.token('carelessParent'), progress: false, news: true }]) {
    const x = await s.call('/api/auth/consent', body); assert.equal(x.status, 400); assert.equal((await x.json()).error, 'CONSENT_REQUIRED');
  }
  assert.equal(await f.store.get('emailPrefs/carelessParent'), null);
  // an account being deleted is refused
  await f.store.put('parents/leavingParent', { familyId: null, deleted: true, identityDeletion: { requestedAt: f.now(), requestedBy: 'leavingParent', deletedAt: null } });
  const leaving = await s.call('/api/auth/consent', { idToken: f.token('leavingParent'), progress: true }); assert.equal(leaving.status, 403); assert.equal((await leaving.json()).error, 'ACCOUNT_DELETED');
  assert.equal(await f.store.get('emailPrefs/leavingParent'), null);
  // other refusals, none of which writes
  const bad = await s.call('/api/auth/consent', { idToken: BAD_TOKEN, progress: true, news: true }); assert.equal(bad.status, 401); assert.equal((await bad.json()).error, 'INVALID_LOGIN');
  for (const body of [{ idToken: f.token('oddParent'), progress: true, news: 'yes' }, { idToken: f.token('oddParent'), progress: 'yes' }, { idToken: f.token('oddParent'), progress: true, other: 1 }, { progress: true }, { idToken: 'short', progress: true }]) {
    assert.equal((await s.call('/api/auth/consent', body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await s.call('/api/auth/consent', { idToken: f.token('oddParent'), progress: true }, { 'X-CSRF-Token': 'nope' })).status, 403);
  assert.equal((await s.call('/api/auth/consent', { idToken: f.token('oddParent'), progress: true }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await s.call('/api/auth/consent', { idToken: f.token('oddParent'), progress: true }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal(await f.store.get('emailPrefs/oddParent'), null);
});

test('only a failed token check spends a budget: twenty from one address, then 429 for junk, while a real consent from that address still records; one token is good for ten tries an hour', async (t) => {
  const f = fixture(), s = await listen(t, f);
  for (let i = 0; i < 20; i++) assert.equal((await s.call('/api/auth/consent', { idToken: `${BAD_TOKEN}-${i}`, progress: true })).status, 401);
  assert.equal((await s.call('/api/auth/consent', { idToken: `${BAD_TOKEN}-x`, progress: true })).status, 429, 'junk after twenty failed checks: refused');
  assert.equal((await s.call('/api/auth/consent', { idToken: f.token('lateParent'), progress: true, news: true })).status, 200, 'a real consent is never refused for its address');
  assert.equal((await f.store.get('emailPrefs/lateParent')).news, true);
  const same = f.token('busyParent');
  for (let i = 0; i < 10; i++) assert.equal((await s.call('/api/auth/consent', { idToken: same, progress: true })).status, 200);
  assert.equal((await s.call('/api/auth/consent', { idToken: same, progress: true })).status, 429, 'the eleventh try of one token in an hour');
  f.advance(60 * 60_000 + 1000); await s.renew();
  assert.equal((await s.call('/api/auth/consent', { idToken: `${BAD_TOKEN}-y`, progress: true })).status, 401, 'an hour on, the address may fail again');
});

test('junk from everywhere fills only the instance\'s failure budget: after two hundred failed checks from as many addresses, junk gets 429 and a real consent still records', async (t) => {
  const f = fixture(), s = await listen(t, f, { proxyHops: 1 });
  for (let i = 0; i < 200; i++) assert.equal((await s.call('/api/auth/consent', { idToken: `${BAD_TOKEN}-${i}`, progress: true }, { 'X-Forwarded-For': `10.0.0.${i}` })).status, 401);
  assert.equal((await s.call('/api/auth/consent', { idToken: `${BAD_TOKEN}-z`, progress: true }, { 'X-Forwarded-For': '10.0.1.1' })).status, 429, 'the instance has had enough junk');
  assert.equal((await s.call('/api/auth/consent', { idToken: f.token('realParent'), progress: true }, { 'X-Forwarded-For': '10.0.1.2' })).status, 200, 'a real parent still records');
  assert.ok(await f.store.get('emailPrefs/realParent'));
});

test('the switches: a parent session with a recent sign-in, booleans only; each change a versioned row with its door, the newest twenty kept; the switches saved as they are add nothing', async (t) => {
  const f = fixture(), a = await f.family('parentA', 1);
  assert.deepEqual((await f.service.me(a.ctx)).emailPrefs, { progress: true, news: false, cadence: 'weekly' }, 'no record: the report on, weekly, news off');
  assert.deepEqual(await f.email.setPrefs(a.ctx, { progress: true, news: false }), { progress: true, news: false, cadence: 'weekly' }); assert.equal(await f.store.get('emailPrefs/parentA'), null, 'the switches as they are: no record');
  assert.deepEqual(await f.email.setPrefs(a.ctx, { progress: false }), { progress: false, news: false, cadence: 'off' });
  let doc = await f.store.get('emailPrefs/parentA'); assert.deepEqual(doc.changes, [{ at: f.now(), progress: false, news: false, cadence: 'off', source: 'settings', version: V }]);
  assert.deepEqual((await f.service.me(a.ctx)).emailPrefs, { progress: false, news: false, cadence: 'off' });
  assert.ok((await audits(f, 'email.prefs_changed')).some((x) => x.uid === 'parentA' && x.familyId === a.familyId));
  const audited = (await audits(f, 'email.prefs_changed')).length;
  assert.deepEqual(await f.email.setPrefs(a.ctx, { progress: false, news: false }), { progress: false, news: false, cadence: 'off' });
  assert.equal((await f.store.get('emailPrefs/parentA')).changes.length, 1, 'both switches sent as they are: no row'); assert.equal((await audits(f, 'email.prefs_changed')).length, audited, 'and no audit');
  for (const bad of [{}, { progress: 'no' }, { news: 1 }, { progress: true, other: true }, null]) await assert.rejects(f.email.setPrefs(a.ctx, bad), rejected('INVALID_REQUEST'));
  for (let i = 0; i < 25; i++) await f.email.setPrefs(a.ctx, { news: i % 2 === 0 });
  doc = await f.store.get('emailPrefs/parentA'); assert.equal(doc.changes.length, 20, 'the newest twenty'); assert.equal(doc.news, true); assert.equal(doc.progress, false, 'a change to one switch leaves the other');
  // the child, and a parent session older than five minutes (a remembered Mission Control left open), are refused
  const k = await f.childSession('parentB'); await assert.rejects(f.email.setPrefs(k.childCtx, { progress: false }), rejected('PARENT_REQUIRED'));
  f.advance(5 * 60_000 + 1000); await assert.rejects(f.email.setPrefs(a.ctx, { progress: true }), rejected('REAUTHENTICATE'));
  assert.equal((await f.store.get('emailPrefs/parentA')).progress, false, 'nothing changed');
  // over HTTP, with the session's own CSRF token; the selector and the child never see the prefs
  const p = await f.login('parentA'), s = await listen(t, f), csrf = (await f.service.me(p.ctx)).csrf;
  const r = await s.call('/api/account/email', { progress: true, news: true }, { Cookie: `__session=${p.cookie}`, 'X-CSRF-Token': csrf });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { progress: true, news: true, cadence: 'weekly' }, 'the report on again after off is weekly again');
  assert.equal((await s.call('/api/account/email', { progress: true }, { Cookie: `__session=${p.cookie}`, 'X-CSRF-Token': 'nope' })).status, 403);
  assert.equal((await f.service.me(k.childCtx)).emailPrefs, undefined);
});

test('the record belongs to the sign-in account: the export carries it, family deletion keeps it, deleting the sign-in account deletes it', async () => {
  const f = fixture(), a = await f.family('parentA', 1);
  assert.deepEqual((await f.support.exportFamily(a.ctx)).emailPrefs, [{ uid: 'parentA', progress: true, news: false, cadence: 'weekly', version: null, updatedAt: null, changes: [] }], 'nothing recorded: the defaults, said so');
  await f.email.setPrefs(a.ctx, { news: true });
  const x = await f.support.exportFamily(a.ctx);
  assert.deepEqual(x.emailPrefs.map((e) => [e.uid, e.progress, e.news, e.version, e.changes.length]), [['parentA', true, true, V, 1]]);
  assert.ok(!JSON.stringify(x.emailPrefs).includes('@'), 'no address in the record');
  await f.support.requestDeletion(a.ctx, { operationId: randomUUID() }); f.advance(DELETION_GRACE_MS + 1);
  await f.support.executeDeletion(a.familyId, { operator: 'ops@example.test' });
  assert.ok(await f.store.get('emailPrefs/parentA'), 'the account still exists, and so do its choices');
  f.advance(2000); const p = await f.login('parentA'); await f.support.deleteAccount(p.ctx, { operationId: randomUUID() });
  assert.equal(await f.store.get('emailPrefs/parentA'), null, 'gone with the sign-in account');
});

test('the record\'s shape: defaults without one; versioned rows with their door; the sign-up row kept for good while the newest others rotate; nothing new when nothing changes', () => {
  assert.deepEqual(prefsOf(null), { progress: true, news: false, cadence: 'weekly' }); assert.deepEqual(prefsOf({ progress: false }), { progress: false, news: false, cadence: 'off' }); assert.deepEqual(prefsOf({ news: 'yes' }), { progress: true, news: false, cadence: 'weekly' });
  assert.equal(withChange(null, { progress: true, news: false }, 'settings', 1), null, 'the defaults saved: nothing changes');
  let doc = withChange(null, { news: true }, 'signup', 1);
  assert.deepEqual(doc, { progress: true, news: true, cadence: 'weekly', version: V, updatedAt: 1, changes: [{ at: 1, progress: true, news: true, cadence: 'weekly', source: 'signup', version: V }] });
  assert.equal(withChange(doc, { news: true }, 'settings', 2), null, 'the same again: nothing');
  for (let i = 2; i < 30; i++) doc = withChange(doc, { progress: i % 2 === 1 }, 'settings', i);
  assert.equal(doc.changes.length, 20); assert.deepEqual(doc.changes[0], { at: 1, progress: true, news: true, cadence: 'weekly', source: 'signup', version: V }, 'the consent itself is never rotated out');
  assert.equal(doc.changes[1].at, 11); assert.equal(doc.changes.at(-1).at, 29); assert.equal(doc.news, true); assert.ok(doc.changes.every((row) => row.version === V));
});

test('UI: the sign-up form carries the two boxes, the first required and the second optional and unticked; both reach the server as the account is made; a failure there never blocks the sign-up', async (t) => {
  const h = await uiFixture(t, { signedIn: false });
  h.api.signInScreen(true);
  const boxes = () => h.nodes('INPUT').filter((i) => i.type === 'checkbox');
  assert.equal(boxes().length, 2); assert.ok(boxes().every((b) => !b.checked), 'both start unticked');
  assert.ok(h.root.textContent.includes('a weekly progress report, security notices and service updates. I can turn the weekly report off at any time.'));
  assert.ok(h.root.textContent.includes('Also send me news and offers from AutoMathtics. Optional; unsubscribe at any time.'));
  let made = 0; h.setAuth('newParent', { signUp: async () => { made++; return { stage: 'verify' }; }, idToken: async () => h.f.token('newParent') });
  await h.submitLogin();
  assert.equal(made, 0, 'no account without the first box'); assert.ok(h.message.textContent.includes('Tick the first box'), h.message.textContent);
  assert.equal(h.nodes('INPUT')[1].value, 'SyntheticPasswordOnly', 'the password is still there for the second try');
  boxes()[0].checked = true; await h.submitLogin();
  assert.equal(made, 1); assert.ok(h.root.textContent.includes('Check your inbox.'), 'on to the email check');
  const doc = await h.f.store.get('emailPrefs/newParent'); assert.deepEqual(prefsOf(doc), { progress: true, news: false, cadence: 'weekly' }, 'news stays off unless ticked'); assert.equal(doc.changes[0].source, 'signup');
  assert.equal(await h.f.store.get('parents/newParent'), null);
  assert.ok(h.requests.some((r) => r.path === '/api/auth/consent' && r.method === 'POST'));
  // news ticked: recorded yes
  const g = await uiFixture(t, { signedIn: false }); g.api.signInScreen(true);
  g.setAuth('newsParent', { signUp: async () => ({ stage: 'verify' }), idToken: async () => g.f.token('newsParent') });
  for (const b of g.nodes('INPUT').filter((i) => i.type === 'checkbox')) b.checked = true;
  await g.submitLogin(); assert.deepEqual(prefsOf(await g.f.store.get('emailPrefs/newsParent')), { progress: true, news: true, cadence: 'weekly' });
  // the server refuses, or the token cannot be had: the sign-up carries on regardless
  for (const idToken of [async () => BAD_TOKEN, async () => { throw Error('provider hiccup'); }]) {
    const u = await uiFixture(t, { signedIn: false }); u.api.signInScreen(true);
    u.setAuth('unluckyParent', { signUp: async () => ({ stage: 'verify' }), idToken });
    u.nodes('INPUT').filter((i) => i.type === 'checkbox')[0].checked = true;
    await u.submitLogin(); assert.ok(u.root.textContent.includes('Check your inbox.'), 'the sign-up is not blocked'); assert.equal(await u.f.store.get('emailPrefs/unluckyParent'), null);
  }
  // the sign-in form has no boxes
  const plain = await uiFixture(t, { signedIn: false }); assert.equal(plain.nodes('INPUT').filter((i) => i.type === 'checkbox').length, 0);
});

test('UI: Mission Control shows the Email updates switches as the server holds them; saving needs a recent sign-in, and after one nothing is sent by itself', async (t) => {
  const h = await uiFixture(t);
  assert.ok(h.root.textContent.includes('Email updates')); assert.ok(h.root.textContent.includes('Account and security emails always come.'));
  const sw = (words) => h.nodes('LABEL').find((l) => l.textContent.includes(words)).children.find((c) => c.tagName === 'INPUT');
  assert.equal(sw('Weekly progress report').checked, true); assert.equal(sw('News and offers').checked, false);
  // how often the report comes is one choice of three (the owner, 13 Sep 2026): weekly, monthly or none, never two at once
  assert.deepEqual(['Weekly progress report', 'Monthly progress report', 'No progress report'].map((w) => [sw(w).type, sw(w).name]),
    [['radio', 'report-cadence'], ['radio', 'report-cadence'], ['radio', 'report-cadence']], 'one named group of radios, so a browser keeps exactly one chosen');
  sw('Weekly progress report').checked = false; sw('No progress report').checked = true; await h.click('Save email settings');
  assert.ok(h.message.textContent.includes('Email settings saved'), h.message.textContent);
  assert.equal((await h.f.store.get('emailPrefs/parentA')).progress, false);
  assert.equal(sw('No progress report').checked, true, 'the page shows what the server now holds'); assert.equal(sw('Weekly progress report').checked, false);
  h.f.advance(301_000); sw('News and offers').checked = true; await h.click('Save email settings');
  assert.ok(h.root.textContent.includes('PARENT VERIFICATION')); assert.equal((await h.f.store.get('emailPrefs/parentA')).news, false, 'not saved without a fresh sign-in');
  h.setAuth(); await h.submitLogin();
  assert.ok(h.root.textContent.includes('Email updates')); assert.ok(h.message.textContent.includes('Set the switches again'), h.message.textContent);
  assert.equal((await h.f.store.get('emailPrefs/parentA')).news, false, 'and not sent by itself afterwards');
  assert.equal(h.requests.filter((r) => r.path === '/api/account/email').length, 2);
});
