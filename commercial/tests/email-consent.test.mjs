// Email consent at sign-up and the switches behind Mission Control (email-v1): the required box and the optional one, recorded
// by the server from the new account's own token, once and before any session; the switches need a recent sign-in and keep
// their history; the record goes with the sign-in account and comes with the family export; the pages say it in words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fixture, rejected, secret } from './support.mjs';
import { uiFixture } from './ui-support.mjs';
import { createApp } from '../server/http.mjs';
import { prefsOf, withChange } from '../server/email.mjs';
import { DELETION_GRACE_MS } from '../server/support.mjs';

const BAD_TOKEN = 'not-a-real-token-000000000000';
const audits = async (f, action) => (await f.store.list('audit')).filter((x) => x.action === action);
async function listen(t, f) {
  const cfg = { origin: 'https://pilot.example.test', secret, emulator: true, web: { authDomain: 'demo-am-foundation.firebaseapp.com' } };
  const server = createApp(f.service, cfg, { email: f.email }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`, s = { base, cfg };
  s.renew = async () => { const boot = await fetch(`${base}/api/bootstrap`); s.cookie = boot.headers.get('set-cookie').split(';')[0]; s.csrf = (await boot.json()).csrf; }; // a pre-authentication cookie lives ten minutes
  s.call = (path, data, more = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { Cookie: s.cookie, Origin: cfg.origin, 'X-CSRF-Token': s.csrf, 'Content-Type': 'application/json', ...more }, body: JSON.stringify(data) });
  await s.renew(); return s;
}

test('sign-up consent: the new account\'s own token records both boxes once, before any session and without a parent record; a bad token, CSRF token, origin or body records nothing', async (t) => {
  const f = fixture(), s = await listen(t, f);
  const token = f.token('newParent'); // a brand-new account: no parent record, no session
  let r = await s.call('/api/auth/consent', { idToken: token, news: true });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
  const doc = await f.store.get('emailPrefs/newParent');
  assert.equal(doc.progress, true); assert.equal(doc.news, true); assert.equal(doc.version, 'email-v1'); assert.equal(doc.updatedAt, f.now());
  assert.deepEqual(doc.changes, [{ at: f.now(), progress: true, news: true, source: 'signup' }]);
  assert.equal(await f.store.get('parents/newParent'), null, 'parents/{uid} is never created early: login() makes it, in its own shape');
  const rows = await audits(f, 'email.consent_recorded'); assert.equal(rows.length, 1); assert.equal(rows[0].uid, 'newParent'); assert.equal(rows[0].familyId, null); assert.equal(rows[0].childId, null);
  // only if absent: a second call, or anyone else holding the token, changes nothing
  f.advance(1000); r = await s.call('/api/auth/consent', { idToken: token, news: false }); assert.equal(r.status, 200);
  assert.deepEqual(await f.store.get('emailPrefs/newParent'), doc); assert.equal((await audits(f, 'email.consent_recorded')).length, 1);
  // news left out: the report on, news off
  assert.equal((await s.call('/api/auth/consent', { idToken: f.token('quietParent') })).status, 200);
  assert.deepEqual(prefsOf(await f.store.get('emailPrefs/quietParent')), { progress: true, news: false });
  // refusals, none of which writes
  const bad = await s.call('/api/auth/consent', { idToken: BAD_TOKEN, news: true }); assert.equal(bad.status, 401); assert.equal((await bad.json()).error, 'INVALID_LOGIN');
  for (const body of [{ idToken: f.token('oddParent'), news: 'yes' }, { idToken: f.token('oddParent'), news: true, progress: false }, { news: true }, { idToken: 'short' }]) assert.equal((await s.call('/api/auth/consent', body)).status, 400, JSON.stringify(body));
  assert.equal((await s.call('/api/auth/consent', { idToken: f.token('oddParent') }, { 'X-CSRF-Token': 'nope' })).status, 403);
  assert.equal((await s.call('/api/auth/consent', { idToken: f.token('oddParent') }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await s.call('/api/auth/consent', { idToken: f.token('oddParent') }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal(await f.store.get('emailPrefs/oddParent'), null);
});

test('sign-up consent is budgeted per address like recovery: twenty an hour, then 429 whatever the token, until the hour is over', async (t) => {
  const f = fixture(), s = await listen(t, f);
  for (let i = 0; i < 20; i++) assert.equal((await s.call('/api/auth/consent', { idToken: BAD_TOKEN })).status, 401);
  assert.equal((await s.call('/api/auth/consent', { idToken: f.token('lateParent') })).status, 429);
  assert.equal(await f.store.get('emailPrefs/lateParent'), null);
  f.advance(60 * 60_000 + 1000); await s.renew();
  assert.equal((await s.call('/api/auth/consent', { idToken: f.token('lateParent') })).status, 200);
});

test('the switches: a parent session with a recent sign-in, booleans only; every change is a row with its door, the newest twenty kept, and audited', async (t) => {
  const f = fixture(), a = await f.family('parentA', 1);
  assert.deepEqual((await f.service.me(a.ctx)).emailPrefs, { progress: true, news: false }, 'no record: the report on, news off');
  assert.deepEqual(await f.email.setPrefs(a.ctx, { progress: false }), { progress: false, news: false });
  let doc = await f.store.get('emailPrefs/parentA'); assert.deepEqual(doc.changes, [{ at: f.now(), progress: false, news: false, source: 'settings' }]);
  assert.deepEqual((await f.service.me(a.ctx)).emailPrefs, { progress: false, news: false });
  assert.ok((await audits(f, 'email.prefs_changed')).some((x) => x.uid === 'parentA' && x.familyId === a.familyId));
  for (const bad of [{}, { progress: 'no' }, { news: 1 }, { progress: true, other: true }, null]) await assert.rejects(f.email.setPrefs(a.ctx, bad), rejected('INVALID_REQUEST'));
  for (let i = 0; i < 25; i++) await f.email.setPrefs(a.ctx, { news: i % 2 === 0 });
  doc = await f.store.get('emailPrefs/parentA'); assert.equal(doc.changes.length, 20, 'the newest twenty'); assert.equal(doc.news, true); assert.equal(doc.progress, false, 'a change to one switch leaves the other');
  // the child, and a parent session older than five minutes (a remembered Mission Control left open), are refused
  const k = await f.childSession('parentB'); await assert.rejects(f.email.setPrefs(k.childCtx, { progress: false }), rejected('PARENT_REQUIRED'));
  f.advance(5 * 60_000 + 1000); await assert.rejects(f.email.setPrefs(a.ctx, { progress: true }), rejected('REAUTHENTICATE'));
  assert.equal((await f.store.get('emailPrefs/parentA')).progress, false, 'nothing changed');
  // over HTTP, with the session's own CSRF token; the selector and the child never see the prefs
  const p = await f.login('parentA'), s = await listen(t, f), csrf = (await f.service.me(p.ctx)).csrf;
  const r = await s.call('/api/account/email', { progress: true }, { Cookie: `__session=${p.cookie}`, 'X-CSRF-Token': csrf });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { progress: true, news: true });
  assert.equal((await s.call('/api/account/email', { progress: true }, { Cookie: `__session=${p.cookie}`, 'X-CSRF-Token': 'nope' })).status, 403);
  assert.equal((await f.service.me(k.childCtx)).emailPrefs, undefined);
});

test('the record belongs to the sign-in account: the export carries it, family deletion keeps it, deleting the sign-in account deletes it', async () => {
  const f = fixture(), a = await f.family('parentA', 1);
  assert.deepEqual((await f.support.exportFamily(a.ctx)).emailPrefs, [{ uid: 'parentA', progress: true, news: false, version: null, updatedAt: null, changes: [] }], 'nothing recorded: the defaults, said so');
  await f.email.setPrefs(a.ctx, { news: true });
  const x = await f.support.exportFamily(a.ctx);
  assert.deepEqual(x.emailPrefs.map((e) => [e.uid, e.progress, e.news, e.version, e.changes.length]), [['parentA', true, true, 'email-v1', 1]]);
  assert.ok(!JSON.stringify(x.emailPrefs).includes('@'), 'no address in the record');
  await f.support.requestDeletion(a.ctx, { operationId: randomUUID() }); f.advance(DELETION_GRACE_MS + 1);
  await f.support.executeDeletion(a.familyId, { operator: 'ops@example.test' });
  assert.ok(await f.store.get('emailPrefs/parentA'), 'the account still exists, and so do its choices');
  f.advance(2000); const p = await f.login('parentA'); await f.support.deleteAccount(p.ctx, { operationId: randomUUID() });
  assert.equal(await f.store.get('emailPrefs/parentA'), null, 'gone with the sign-in account');
});

test('the record\'s shape: defaults without one, whole states with a door on each row, the newest twenty', () => {
  assert.deepEqual(prefsOf(null), { progress: true, news: false }); assert.deepEqual(prefsOf({ progress: false }), { progress: false, news: false }); assert.deepEqual(prefsOf({ news: 'yes' }), { progress: true, news: false });
  let doc = withChange(null, { news: true }, 'signup', 1);
  assert.deepEqual(doc, { progress: true, news: true, version: 'email-v1', updatedAt: 1, changes: [{ at: 1, progress: true, news: true, source: 'signup' }] });
  for (let i = 2; i < 30; i++) doc = withChange(doc, { progress: i % 2 === 0 }, 'settings', i);
  assert.equal(doc.changes.length, 20); assert.equal(doc.changes[0].at, 10); assert.equal(doc.changes.at(-1).at, 29); assert.equal(doc.news, true);
});

test('UI: the sign-up form carries the two boxes, the first required and the second optional and unticked; the choice reaches the server as the account is made; a failure there never blocks the sign-up', async (t) => {
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
  assert.deepEqual(prefsOf(await h.f.store.get('emailPrefs/newParent')), { progress: true, news: false }, 'news stays off unless ticked');
  assert.equal(await h.f.store.get('parents/newParent'), null);
  assert.ok(h.requests.some((r) => r.path === '/api/auth/consent' && r.method === 'POST'));
  // news ticked: recorded yes
  const g = await uiFixture(t, { signedIn: false }); g.api.signInScreen(true);
  g.setAuth('newsParent', { signUp: async () => ({ stage: 'verify' }), idToken: async () => g.f.token('newsParent') });
  for (const b of g.nodes('INPUT').filter((i) => i.type === 'checkbox')) b.checked = true;
  await g.submitLogin(); assert.deepEqual(prefsOf(await g.f.store.get('emailPrefs/newsParent')), { progress: true, news: true });
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
  sw('Weekly progress report').checked = false; await h.click('Save email settings');
  assert.ok(h.message.textContent.includes('Email settings saved'), h.message.textContent);
  assert.equal((await h.f.store.get('emailPrefs/parentA')).progress, false); assert.equal(sw('Weekly progress report').checked, false, 'the page shows what the server now holds');
  h.f.advance(301_000); sw('News and offers').checked = true; await h.click('Save email settings');
  assert.ok(h.root.textContent.includes('PARENT VERIFICATION')); assert.equal((await h.f.store.get('emailPrefs/parentA')).news, false, 'not saved without a fresh sign-in');
  h.setAuth(); await h.submitLogin();
  assert.ok(h.root.textContent.includes('Email updates')); assert.ok(h.message.textContent.includes('Set the switches again'), h.message.textContent);
  assert.equal((await h.f.store.get('emailPrefs/parentA')).news, false, 'and not sent by itself afterwards');
  assert.equal(h.requests.filter((r) => r.path === '/api/account/email').length, 2);
});
