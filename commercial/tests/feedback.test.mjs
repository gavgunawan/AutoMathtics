// Send feedback (the owner's request of 12 Sep 2026): the words, the screen and, signed out, an address to be answered at, sent from
// the sign-in screen with the pre-authentication CSRF token or from a parent's session; who sent it is the session's to say, never
// the body's, and a child never sends one; the body is checked before any budget, then budgeted per session, per address and per
// instance; kept 400 days, audited by id alone, in the family's export and gone with the family or the account; copied to the
// owner by Resend when FEEDBACK_TO is set, never failing the request; the operator's read; the paper trail; the button in the app.
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
import { Feedback, FEEDBACK_TTL_MS, FEEDBACK_MAIL_TIMEOUT_MS } from '../server/feedback.mjs';
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
  s.send = (data, extra = {}) => fetch(`${base}/api/feedback`, { method: 'POST', headers: { Cookie: s.cookie, Origin: ORIGIN, 'X-CSRF-Token': s.csrf, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(data) });
  await s.renew(); return s;
}
const notes = async (f) => (await f.store.entries('feedback')).map(([id, d]) => ({ id, ...d }));
const sentRows = async (f) => (await f.store.list('audit')).filter((a) => a.action === 'feedback.sent');

test('signed out: the words, the screen and an address to answer, with the pre-authentication CSRF token; kept with the release for 400 days and audited by its id alone; Origin, CSRF and fetch metadata still guard it', async (t) => {
  const f = fixture(), s = await listen(t, f);
  const r = await s.send({ text: '  The timer is hard to read on my phone.\n\nOtherwise lovely!  ', page: 'mission-control', contact: ' someone@example.test ' });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
  const [n] = await notes(f);
  assert.deepEqual(n, { id: n.id, text: 'The timer is hard to read on my phone.\n\nOtherwise lovely!', page: 'mission-control', at: f.now(), contact: 'someone@example.test', release: 'test-release', expireAt: f.now() + FEEDBACK_TTL_MS });
  assert.equal(FEEDBACK_TTL_MS, 400 * DAY);
  const [a] = await sentRows(f);
  assert.deepEqual([a.feedbackId, a.uid, a.familyId, a.childId], [n.id, null, null, null]); assert.ok(!/timer|someone/.test(JSON.stringify(a)), 'the audit row holds ids, never the words or the address');
  assert.equal((await s.send({ text: 'No address this time', page: 'mission-control' })).status, 200);
  assert.ok(!('contact' in (await notes(f)).find((x) => x.text === 'No address this time')), 'no address, no field');
  for (const extra of [{ 'X-CSRF-Token': 'nope' }, { Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await s.send({ text: 'x', page: 'mission-control' }, extra)).status, 403, JSON.stringify(extra));
  assert.equal((await notes(f)).length, 2, 'the refused ones kept nothing');
});

test('inside a session the session names the sender: a parent\'s uid and family, never the body\'s; an address sent beside a session is dropped; the launch pad\'s and a child\'s sessions are refused', async (t) => {
  const f = fixture(), p = await f.family('parentA', 1), { child } = await f.child(p.ctx), s = await listen(t, f);
  await s.as((await f.login('parentA')).cookie);
  assert.equal((await s.send({ text: 'From Mission Control', page: 'mission-control', contact: 'elsewhere@example.test' })).status, 200);
  const [n] = await notes(f); assert.deepEqual([n.uid, n.familyId, 'contact' in n], ['parentA', p.familyId, false], 'answered at the account address instead');
  const [a] = await sentRows(f); assert.deepEqual([a.uid, a.familyId, a.feedbackId], ['parentA', p.familyId, n.id]);
  const launchPad = await f.service.lock(p.ctx); await s.as(launchPad);
  let r = await s.send({ text: 'from the tablet', page: 'who-is-on-a-mission' }); assert.equal(r.status, 403); assert.equal((await r.json()).error, 'PARENT_REQUIRED');
  await s.as(await f.service.selectChild(await f.service.authenticate(launchPad), child.id, '763829'));
  r = await s.send({ text: 'from a child', page: 'your-grid' }); assert.equal(r.status, 403); assert.equal((await r.json()).error, 'PARENT_REQUIRED');
  assert.equal((await notes(f)).length, 1, 'no free text from a child, nor from the launch pad');
});

test('the body is checked before any budget is spent: 1 to 2000 characters once trimmed, a screen name, an address of at most 254 characters, nothing else', async (t) => {
  const f = fixture(), s = await listen(t, f);
  const bad = [[{ text: '', page: 'x' }, 'FEEDBACK_TEXT'], [{ text: '   \n ', page: 'x' }, 'FEEDBACK_TEXT'], [{ text: 'a'.repeat(2001), page: 'x' }, 'FEEDBACK_TEXT'], [{ text: 5, page: 'x' }, 'FEEDBACK_TEXT'],
    [{ text: 'hi', page: 'Mission Control' }, 'INVALID_REQUEST'], [{ text: 'hi' }, 'INVALID_REQUEST'], [{ text: 'hi', page: 'x'.repeat(41) }, 'INVALID_REQUEST'], [{ text: 'hi', page: 'x', other: 1 }, 'INVALID_REQUEST'],
    [{ text: 'hi', page: 'x', contact: 'not-an-address' }, 'FEEDBACK_CONTACT'], [{ text: 'hi', page: 'x', contact: `${'a'.repeat(64)}@${'b'.repeat(186)}.com` }, 'FEEDBACK_CONTACT'], [{ text: 'hi', page: 'x', contact: null }, 'FEEDBACK_CONTACT']];
  for (const [body, code] of bad) { const r = await s.send(body); assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80)); assert.equal((await r.json()).error, code, JSON.stringify(body).slice(0, 80)); }
  assert.equal((await s.send({ text: 'a'.repeat(2000), page: 'x', contact: '' })).status, 200, '2000 characters, and an empty address, are fine');
  for (let i = 0; i < 4; i++) assert.equal((await s.send({ text: `note ${i}`, page: 'x' })).status, 200, 'the malformed ones spent nothing: four more fit the five an hour');
  assert.equal((await s.send({ text: 'sixth', page: 'x' })).status, 429);
  assert.equal((await notes(f)).length, 5);
});

test('budgets: ten a day per session whatever the address, five an hour per address whatever the session, a hundred an hour per instance', async (t) => {
  const f = fixture(), s = await listen(t, f, { proxyHops: 1 }), from = (ip) => ({ 'X-Forwarded-For': ip });
  for (let i = 0; i < 10; i++) assert.equal((await s.send({ text: `n${i}`, page: 'x' }, from(`10.0.0.${i}`))).status, 200);
  assert.equal((await s.send({ text: 'eleventh', page: 'x' }, from('10.0.0.10'))).status, 429, 'the eleventh from one session in a day');
  for (let i = 0; i < 5; i++) { await s.renew(); assert.equal((await s.send({ text: `a${i}`, page: 'x' }, from('10.0.0.50'))).status, 200); }
  await s.renew(); assert.equal((await s.send({ text: 'sixth from one address', page: 'x' }, from('10.0.0.50'))).status, 429, 'the sixth from one address in an hour');
  f.advance(60 * 60_000 + 1000); await s.renew(); assert.equal((await s.send({ text: 'an hour on', page: 'x' }, from('10.0.0.50'))).status, 200);
  const g = fixture(), w = await listen(t, g, { proxyHops: 1, peerFactor: 1000 }); // the peer's share out of the way, so only the instance's cap is left
  for (let i = 0; i < 100; i++) { if (i % 10 === 0) await w.renew(); assert.equal((await w.send({ text: `m${i}`, page: 'x' }, from(`10.1.${i >> 4}.${i}`))).status, 200); }
  await w.renew(); assert.equal((await w.send({ text: 'one too many', page: 'x' }, from('10.2.0.1'))).status, 429, 'a hundred an hour per instance');
  assert.equal((await notes(g)).length, 100);
});

test('with Resend and FEEDBACK_TO the owner gets a copy: Reply goes to the parent\'s account address or to the address given, one Idempotency-Key per note, the words escaped in the HTML; a slow or failing provider never fails the request or loses the note; the fake provider, or no FEEDBACK_TO, emails nothing', async (t) => {
  const calls = [], mode = { now: 'ok' };
  const fetch = (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body), signal: init.signal });
    if (mode.now === 'hang') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    if (mode.now === 'down') return Promise.reject(Error('connect ECONNREFUSED'));
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: `em_${calls.length}` }) });
  };
  const f = fixture(), logs = [], feedback = new Feedback({ foundation: f.service, store: f.store, now: f.now, release: 'r1', mailer: createMailer({ provider: 'resend', apiKey: KEY, fetch }), to: OWNER, mailTimeoutMs: 50, log: (e) => logs.push(e) });
  const s = await listen(t, f, { feedback });
  assert.equal((await s.send({ text: 'Signed out <b>hello</b>', page: 'mission-control', contact: 'someone@example.test' })).status, 200);
  const [n] = await notes(f), [c] = calls;
  assert.deepEqual(c.body.to, [OWNER]); assert.equal(c.body.reply_to, 'someone@example.test'); assert.equal(c.headers['Idempotency-Key'], `feedback:${n.id}`);
  assert.equal(c.body.subject, 'AutoMathtics feedback · mission-control'); assert.ok(c.body.text.includes('Signed out <b>hello</b>') && c.body.text.includes(n.id));
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

test('the family export carries its parents\' notes; the family\'s deletion removes them, the sign-in account\'s deletion removes those it sent without a family, and a note sent signed out outlives both', async (t) => {
  const f = fixture(), a = await f.family('parentA', 1), s = await listen(t, f);
  assert.equal((await s.send({ text: 'signed out', page: 'mission-control' })).status, 200);
  await s.as((await f.login('parentA')).cookie); assert.equal((await s.send({ text: 'from the family', page: 'mission-control' })).status, 200);
  const x = await f.support.exportFamily((await f.login('parentA')).ctx);
  assert.deepEqual(x.feedback.map((n) => [n.text, n.uid, n.page, n.release]), [['from the family', 'parentA', 'mission-control', 'test-release']], 'the family\'s own, not the one that names nobody');
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
  assert.ok(src.includes("feedback: { options: ['--days']") && src.includes("if (!reading && !/^[a-f0-9]{64,}$/.test(env.SESSION_SECRET || ''))"), 'the read signs nothing, so it needs no SESSION_SECRET');
  for (const args of [['feedback', '--days'], ['feedback', '--days', 'x'], ['feedback', '--days', '0'], ['feedback', '--days', '401'], ['feedback', '--days', '7', '--days', '8'], ['feedback', 'all'], ['feedback', '--week', '2026-W36']]) {
    const r = await cli({}, args); assert.equal(r.code, 64, args.join(' ')); assert.match(r.err, /node scripts\/report\.mjs feedback \[--days N\]/);
  }
  assert.match((await cli({}, ['feedback', '--days', '30'])).err, /Set APP_MODE/, 'good arguments: then the environment');
  assert.match((await cli({ APP_MODE: 'staging', FIREBASE_PROJECT_ID: 'automathtics-v3-staging', CONFIRM_PROJECT: 'automathtics-v3-staging' }, ['feedback'])).err, /Set OPERATOR_ID/, 'the operator is named, as for every read');
});

test('the paper trail: the privacy row, RETENTION for the notes that name nobody, feedback in both TTL lists, the deployment section and helper, the acceptance row; the route passes the naming rule', async () => {
  const privacy = await read('../PRIVACY.md'), deploy = await read('../DEPLOY_V3.md'), acceptance = await read('../ACCEPTANCE.md'), perms = await read('../scripts/cloudshell/02-permissions.sh'), http = await read('../server/http.mjs');
  for (const s of ['`feedback/{id}`', 'FEEDBACK_TO', 'Never from a child']) assert.ok(privacy.includes(s), s);
  assert.match(RETENTION['feedback/* (sent signed out)'], /TTL 400 days/);
  for (const [name, text] of [['DEPLOY_V3.md', deploy], ['02-permissions.sh', perms]]) assert.ok(text.match(/for GROUP in ([^;]+); do/)[1].split(/\s+/).includes('feedback'), `${name}: feedback expires by TTL`);
  for (const s of ['## 5c. Feedback', 'node scripts/report.mjs feedback --days 7', 'export FEEDBACK_TO=']) assert.ok(deploy.includes(s), s);
  assert.match(acceptance, /^\| P10 \| Tap \*Send feedback\*/m);
  assert.ok(http.includes("path === '/api/feedback'")); assert.doesNotMatch('/api/feedback', /transfer|import|export|migrat|move|merge|clone|copy|link|invite/i);
  const helper = await read('../scripts/deploy-staging.sh');
  assert.ok(helper.includes('FEEDBACK_TO: p.FEEDBACK_TO') && helper.includes('[ "${EMAIL_PROVIDER:-fake}" = resend ] && echo \',EMAIL_API_KEY=am-v3-email-key:1\''), 'the deploy passes FEEDBACK_TO on, and the key only with Resend');
});

test('UI: Send feedback under the sign-in screen, with an address to answer if wanted, and under every parent screen, without one; Cancel sends nothing; never in kid mode, nor on the sign-in screen reached from it', async (t) => {
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
  const [n] = await h.f.store.list('feedback');
  assert.deepEqual([n.text, n.contact, n.page, n.uid], ['The timer is hard to read.', 'someone@example.test', 'mission-control', undefined]);
  await h.click('Send feedback'); h.nodes('TEXTAREA')[0].value = 'never mind'; await h.click('Cancel');
  assert.equal(posts(), 1, 'Cancel sends nothing'); assert.equal(h.nodes('TEXTAREA').length, 0);
  // a parent screen: no address to give, the session says who
  const p = await uiFixture(t); await p.f.child(p.a.ctx); await p.api.refresh(); assert.ok(has(p), 'under Mission Control');
  await p.click('Send feedback'); assert.ok(!p.nodes('INPUT').some((i) => i.type === 'email' && i.required === false), 'no address signed in');
  p.nodes('TEXTAREA')[0].value = 'Love the rocket.'; await p.click('Send');
  const [m] = await p.f.store.list('feedback'); assert.deepEqual([m.text, m.uid, m.familyId, m.contact], ['Love the rocket.', 'parentA', p.a.familyId, undefined]);
  // kid mode: the launch pad, the PIN screen, the child's home, a game, the shop, the map, and the sign-in screen reached from it
  await p.click('Hand over to kids'); assert.ok(p.root.textContent.includes('Who is on a mission') && !has(p), 'the launch pad');
  await p.nodes('BUTTON').find((b) => b.className === 'player-card').onclick(); assert.ok(p.root.textContent.includes('Enter my grid') && !has(p), 'the PIN screen');
  p.nodes('INPUT')[0].value = '763829'; await p.click('Enter my grid'); assert.ok(p.root.textContent.includes('Welcome,') && !has(p), 'the child\'s home');
  await p.click('Start ENGINE'); assert.ok(p.root.textContent.includes('Question 1 of 25') && !has(p), 'a game');
  await p.click('Leave this session'); await p.click('🛒 Shop & rewards'); assert.ok(p.root.textContent.includes('GRID SHOP') && !has(p), 'the shop');
  await p.click('Back to my grid'); await p.click('🗺 Map & fluency'); assert.ok(p.root.textContent.includes('MISSION MAP') && !has(p), 'the map');
  await p.click('Back to my grid'); await p.click('Parent sign-in'); assert.ok(p.root.textContent.includes('Sign in as parent') && !has(p), 'nor the sign-in screen reached from kid mode');
  p.f.advance(2000); p.setAuth(); await p.submitLogin(); // a sign-in newer than the handover: one from its very second is refused (REAUTHENTICATE)
  assert.ok(p.root.textContent.includes('Hand over to kids') && has(p), 'back for the parent once signed in');
});
