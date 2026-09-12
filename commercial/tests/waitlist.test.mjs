// The waiting list behind /join (the owner's request of 12 Sep 2026): an address and the permission to write to it, kept once
// per address however often it is left, refused without that permission or without a real address, capped for the day against
// a list filled from many places, expiring 400 days after it was last left, and carrying only the short tag a post's link had.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './support.mjs';
import { Waitlist, WAITLIST_TTL_MS, WAITLIST_A_DAY } from '../server/waitlist.mjs';
import { sha256 } from '../server/security.mjs';

const rejected = (code) => (e) => e.code === code;
const make = (f) => new Waitlist({ store: f.store, release: 'test-release', now: f.now });
const row = (f, email) => f.store.get(`waitlist/${sha256(email.toLowerCase())}`);

test('an address and its permission are kept once, under a hash of the address, with the tag its link carried and a 400-day expiry', async () => {
  const f = fixture(), w = make(f), at = f.now();
  assert.deepEqual(await w.join(w.parse({ email: ' Parent@Example.test ', consent: true, source: 'ig' })), { ok: true, repeat: false });
  const kept = await row(f, 'parent@example.test');
  assert.equal(kept.email, 'Parent@Example.test', 'the address as it was typed, which is what an email is sent to');
  assert.equal(kept.source, 'ig'); assert.equal(kept.consentAt, at); assert.equal(kept.joinedAt, at);
  assert.equal(kept.release, 'test-release'); assert.equal(kept.expireAt, at + WAITLIST_TTL_MS);
  assert.equal((await f.store.list('waitlist')).length, 1);
  assert.equal(await w.size(), 1);
});

test('the same address again is one row: it keeps the tag and the day it first arrived, renews its expiry, and spends none of the day\'s allowance', async () => {
  const f = fixture(), w = make(f), first = f.now();
  await w.join(w.parse({ email: 'parent@example.test', consent: true, source: 'ig' }));
  f.advance(3 * 86_400_000);
  assert.deepEqual(await w.join(w.parse({ email: 'PARENT@example.test', consent: true, source: 'tiktok' })), { ok: true, repeat: true });
  const kept = await row(f, 'parent@example.test');
  assert.equal((await f.store.list('waitlist')).length, 1, 'one address, one row, whatever its capitalisation');
  assert.equal(kept.source, 'ig', 'the post it actually came from');
  assert.equal(kept.joinedAt, first); assert.equal(kept.lastAt, f.now()); assert.equal(kept.expireAt, f.now() + WAITLIST_TTL_MS);
  assert.equal((await f.store.get(`waitlistDays/${new Date(first).toISOString().slice(0, 10)}`)).count, 1);
});

test('nothing is kept without a real address or without the permission to write to it, and a junk tag is dropped rather than stored', async () => {
  const f = fixture(), w = make(f);
  for (const body of [{ email: 'not-an-address', consent: true }, { email: 'a@b', consent: true }, { email: '', consent: true }])
    assert.throws(() => w.parse(body), rejected('INVALID_EMAIL'));
  for (const consent of [false, undefined, 'yes', 1])
    assert.throws(() => w.parse({ email: 'parent@example.test', consent }), rejected('CONSENT_REQUIRED'));
  const clean = w.parse({ email: 'parent@example.test', consent: true, source: 'Not A Tag!' });
  assert.equal(clean.source, null, 'a tag outside the shape is simply not carried');
  await w.join(clean);
  assert.equal((await row(f, 'parent@example.test')).source, null);
  assert.equal((await f.store.list('waitlist')).length, 1);
});

test('a day holds only so many addresses never seen before; the day after is its own, and an address already listed is never refused', async () => {
  const f = fixture(), w = make(f);
  for (let i = 0; i < WAITLIST_A_DAY; i++) await w.join(w.parse({ email: `p${i}@example.test`, consent: true }));
  await assert.rejects(w.join(w.parse({ email: 'one-too-many@example.test', consent: true })), rejected('WAITLIST_BUSY'));
  assert.deepEqual(await w.join(w.parse({ email: 'p0@example.test', consent: true })), { ok: true, repeat: true }, 'an address already on the list costs nothing');
  f.advance(86_400_000);
  assert.deepEqual(await w.join(w.parse({ email: 'one-too-many@example.test', consent: true })), { ok: true, repeat: false });
});
