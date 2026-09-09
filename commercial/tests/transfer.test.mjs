// Nothing moves between families: not a child, not their progress, not a session, not a coin.
// And a parent's verified phone is one identity however many emails they sign up with —
// the hook a free trial will hang on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture, rejected, canonical } from './support.mjs';
import { grantEntitlement } from '../server/service.mjs';
import { mac } from '../server/security.mjs';

const samePhone = (f, ...uids) => { for (const u of uids) { f.token(u); f.users.get(u).multiFactor.enrolledFactors[0].phoneNumber = '+6591234567'; } };

test('the public API has no route that transfers, imports, exports or migrates anything', async () => {
  const http = await readFile(new URL('../server/http.mjs', import.meta.url), 'utf8');
  const routes = [...http.matchAll(/'\/api\/[a-z/:-]+'/g)].map((m) => m[0]).concat([...http.matchAll(/\/\^\\\/api\\\/[^$]+\$\//g)].map((m) => m[0]));
  assert.ok(routes.length >= 12, `expected the route table, saw ${routes.length}`);
  for (const r of routes) assert.doesNotMatch(r, /transfer|import|export|migrat|move|merge|clone|copy|link|invite/i, r);
});
test('a child and their progress are bound to one family: another family cannot see, enter, reset or count them', async () => {
  const f = fixture(); const a = await f.childSession('parentA'), b = await f.childSession('parentB');
  const open = await f.learning.start(a.childCtx, { track: 'engine' });
  const stored = await f.store.get(`families/${a.p.familyId}/learning/${a.child.id}/sessions/${open.session.id}`);
  // family B's parent, selector and child, each holding A's child id and session id
  f.advance(2000); const pb = await f.login('parentB');
  await assert.rejects(f.service.resetPin(pb.ctx, a.child.id, '111111'), rejected('CHILD_NOT_FOUND'));
  await assert.rejects(f.service.selectChild(b.selCtx, a.child.id, '763829'), rejected('SIGN_IN_REQUIRED')); // B's selector cookie was replaced by B's child cookie
  const selB = await f.service.authenticate(await f.service.selector(b.childCtx));
  await assert.rejects(f.service.selectChild(selB, a.child.id, '763829'), rejected('CHILD_NOT_FOUND'));
  const me = await f.service.me(selB); assert.deepEqual(me.family.children.map((c) => c.id), [b.child.id]); // B's selector lists only B's children
  const childB = await f.service.authenticate(await f.service.selectChild(selB, b.child.id, '763829')); // B's own child, back in (selB is now retired)
  await assert.rejects(f.learning.answer(childB, { sessionId: open.session.id, index: 0, attemptId: randomUUID(), answer: canonical(stored.questions[0]) }), rejected('SESSION_NOT_FOUND'));
  await assert.rejects(f.learning.quit(childB, { sessionId: open.session.id }), rejected('SESSION_NOT_FOUND'));
  await assert.rejects(grantEntitlement(f.store, { familyId: b.p.familyId, seatLimit: 2, accessUntil: f.now() + 60_000, keepChildIds: [a.child.id], reason: 'cross-family seat', actor: 'test-operator' }, f.now()), rejected('SELECT_CHILDREN_FOR_DOWNGRADE'));
  assert.equal((await f.learning.state(a.childCtx)).active.session.id, open.session.id); // A is untouched
});
test('a parent who signs up again starts from nothing: new family, new child, paper 1, empty wallet', async () => {
  const f = fixture(); samePhone(f, 'parentA', 'parentA2');
  const first = await f.childSession('parentA');
  // play a session so there is real progress to be tempted by
  const open = await f.learning.start(first.childCtx, { track: 'nav' });
  const stored = await f.store.get(`families/${first.p.familyId}/learning/${first.child.id}/sessions/${open.session.id}`);
  let q = open.question, last; while (q) { f.advance(2000); last = await f.learning.answer(first.childCtx, { sessionId: open.session.id, index: q.index, attemptId: randomUUID(), answer: canonical(stored.questions[q.index]) }); q = last.question || null; }
  assert.equal(last.summary.passed, true);
  const again = await f.childSession('parentA2'); // same phone, new email
  const st = await f.learning.state(again.childCtx);
  assert.equal(st.nav.paper, 1); assert.equal(st.engine.paper, 1); assert.deepEqual(st.wallet, { gc: 0, rp: 0, bonuses: 0 }); assert.equal(st.history.length, 0);
  assert.notEqual(again.p.familyId, first.p.familyId); assert.notEqual(again.child.id, first.child.id);
});
test('the verified phone is one key across accounts; the ledger lists every family made under it', async () => {
  const f = fixture(); samePhone(f, 'parentA', 'parentB'); f.token('parentC'); // C keeps its own number
  const a = await f.family('parentA', 0), b = await f.family('parentB', 0), c = await f.family('parentC', 0);
  const fa = await f.store.get(`families/${a.familyId}`), fb = await f.store.get(`families/${b.familyId}`), fc = await f.store.get(`families/${c.familyId}`);
  assert.equal(typeof fa.phoneKey, 'string'); assert.equal(fa.phoneKey, fb.phoneKey); assert.notEqual(fa.phoneKey, fc.phoneKey);
  assert.equal(fa.phoneKey, mac(f.service.secret, 'phone:+6591234567')); assert.ok(!fa.phoneKey.includes('91234567'));
  const ledger = await f.store.get(`phones/${fa.phoneKey}`);
  assert.deepEqual(ledger.families, [a.familyId, b.familyId]); assert.equal(ledger.count, 2);
  assert.equal((await f.store.get(`phones/${fc.phoneKey}`)).count, 1);
  assert.equal((await f.store.get('parents/parentA')).phoneKey, fa.phoneKey);
  for (const path of ['parents/parentA', `families/${a.familyId}`, `phones/${fa.phoneKey}`]) assert.ok(!JSON.stringify(await f.store.get(path)).includes('+65'), `${path} stores a raw phone number`);
});
test('a family made without a phone on record simply has no key, and no ledger entry', async () => {
  const f = fixture(); f.token('parentA'); delete f.users.get('parentA').multiFactor.enrolledFactors[0].phoneNumber;
  const a = await f.family('parentA', 0);
  assert.equal((await f.store.get(`families/${a.familyId}`)).phoneKey, null);
});
