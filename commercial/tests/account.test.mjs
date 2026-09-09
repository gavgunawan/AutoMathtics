// Stage 4.0 — the parent lifecycle ends properly: once no family points at the parent, the sign-in
// account itself can be deleted; sessions go first; a provider failure is visible and retryable;
// the phone key survives so a deleted parent cannot farm a second trial.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, rejected } from './support.mjs';
import { DELETION_GRACE_MS } from '../server/support.mjs';

const op = () => ({ operationId: randomUUID() });
const samePhone = (f, ...uids) => { for (const u of uids) { f.token(u); f.users.get(u).multiFactor.enrolledFactors[0].phoneNumber = '+6591239999'; } };
async function deletedFamily(f) {
  const a = await f.family('parentA', 1); await f.child(a.ctx);
  await f.support.requestDeletion(a.ctx, op()); f.advance(DELETION_GRACE_MS + 1);
  await f.support.executeDeletion(a.familyId, { operator: 'ops@example.test' });
  f.advance(2000); return { a, p: await f.login('parentA') };
}

test('a parent with a family cannot delete the sign-in account; one whose family is gone can, and it takes the sessions and the Auth account with it', async () => {
  const f = fixture(); const a = await f.family('parentA', 1);
  await assert.rejects(f.support.deleteAccount(a.ctx, op()), rejected('FAMILY_STILL_EXISTS'));
  await assert.rejects(f.support.deleteAccount(a.ctx, {}), rejected('OPERATION_ID_REQUIRED'));
  const { p } = await deletedFamily(f);
  assert.equal((await f.service.me(p.ctx)).family, null, 'signed in, no family');
  const other = await f.login('parentA'); // a second live session on another device
  const r = await f.support.deleteAccount(p.ctx, op()); assert.equal(r.deleted, true);
  assert.deepEqual(f.auth.deleted, ['parentA'], 'the Auth account was deleted at the provider');
  assert.equal((await f.store.query('sessions', 'uid', 'parentA', 50)).length, 0, 'every session of the uid is gone');
  await assert.rejects(f.service.me(p.ctx), rejected('SIGN_IN_REQUIRED')); await assert.rejects(f.service.me(other.ctx), rejected('SIGN_IN_REQUIRED'));
  const tomb = await f.store.get('parents/parentA');
  assert.equal(tomb.deleted, true); assert.equal(tomb.familyId, null); assert.equal(typeof tomb.phoneKey, 'string'); assert.ok(tomb.identityDeletion.deletedAt); assert.equal(tomb.identityDeletion.requestedBy, 'parentA');
  for (const k of Object.keys(tomb)) assert.ok(!/email|phoneNumber|name/i.test(k), `nothing personal stays on the tombstone: ${k}`);
  // the provider no longer knows the user: a fresh token for that uid cannot sign in
  assert.equal(f.users.has('parentA'), false); await assert.rejects(f.service.login(p.idToken), rejected('INVALID_LOGIN'));
  const audits = (await f.store.list('audit')).map((x) => x.action); assert.ok(audits.includes('account.deletion_started') && audits.includes('account.deleted'));
});
test('the used trial outlives the account: a new sign-up on the same phone gets no second trial', async () => {
  const f = fixture(); samePhone(f, 'parentA', 'parentA2');
  const a = await f.family('parentA', 0); await f.billing.startTrial(a.ctx, op());
  await f.support.requestDeletion(a.ctx, op()); f.advance(DELETION_GRACE_MS + 1); await f.support.executeDeletion(a.familyId, { operator: 'ops@example.test' });
  f.advance(2000); const p = await f.login('parentA'); await f.support.deleteAccount(p.ctx, op());
  const again = await f.family('parentA2', 0); // same phone, new email, new account
  await assert.rejects(f.billing.startTrial(again.ctx, op()), rejected('TRIAL_ALREADY_USED'));
});
test('a provider failure leaves a record that says so, and the retry finishes; the operator path does the same for a parent who cannot sign in', async () => {
  const f = fixture(); const { p } = await deletedFamily(f);
  f.auth.failDelete = Error('identity provider unavailable');
  await assert.rejects(f.support.deleteAccount(p.ctx, op()), /identity provider unavailable/);
  const mid = await f.store.get('parents/parentA'); assert.ok(mid.identityDeletion.requestedAt); assert.equal(mid.identityDeletion.deletedAt, null); assert.deepEqual(f.auth.deleted, []);
  assert.equal((await f.store.query('sessions', 'uid', 'parentA', 50)).length, 0, 'the sessions went in step one regardless');
  await assert.rejects(f.support.deleteAccountFor('parentA', ''), rejected('OPERATOR_REQUIRED'));
  await assert.rejects(f.support.deleteAccountFor('nobody', 'ops@example.test'), rejected('PARENT_NOT_FOUND'));
  const done = await f.support.deleteAccountFor('parentA', 'ops@example.test'); assert.equal(done.deleted, true);
  assert.deepEqual(f.auth.deleted, ['parentA']); assert.ok((await f.store.get('parents/parentA')).identityDeletion.deletedAt);
  // a parent who never made a family can leave straight away; a parent with one cannot even via the operator
  const g = fixture(); const solo = await g.login('parentZ'); assert.equal((await g.support.deleteAccount(solo.ctx, op())).deleted, true); assert.deepEqual(g.auth.deleted, ['parentZ']);
  const h = fixture(); const fam = await h.family('parentB', 1); await assert.rejects(h.support.deleteAccountFor('parentB', 'ops@example.test'), rejected('FAMILY_STILL_EXISTS')); void fam;
});
test('the account deletion needs the parent\'s own recent session', async () => {
  const f = fixture(); const { p } = await deletedFamily(f);
  const k = await f.childSession('parentB'); await assert.rejects(f.support.deleteAccount(k.childCtx, op()), rejected('PARENT_REQUIRED'));
  f.advance(6 * 60_000); await assert.rejects(f.support.deleteAccount(p.ctx, op()), rejected('REAUTHENTICATE'));
  assert.deepEqual(f.auth.deleted, []);
});
