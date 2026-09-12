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
  assert.deepEqual(await w.join(w.parse({ email: ' Parent@Example.test ', consent: true, source: 'ig' })), { ok: true, repeat: false, mailed: false, mailedAt: null }, 'no mailer on this list: listed all the same');
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
  assert.deepEqual((await w.join(w.parse({ email: 'PARENT@example.test', consent: true, source: 'tiktok' }))).repeat, true);
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
  assert.equal((await w.join(w.parse({ email: 'p0@example.test', consent: true }))).repeat, true, 'an address already on the list costs nothing');
  f.advance(86_400_000);
  assert.equal((await w.join(w.parse({ email: 'one-too-many@example.test', consent: true }))).repeat, false);
});

// The owner's report of 12 Sep 2026: joining the list in silence feels broken. A new address gets one email back at once,
// from no-reply with Reply pointed at a person, carrying an unsubscribe that works as a click and as a mailbox provider's
// one-click POST. The email is best effort: the address is listed whether or not the provider answered.
test('a new address gets one email back, with an unsubscribe that works, and a repeat join is not written to twice', async () => {
  const f = fixture(), w = f.waitlist;
  await w.join(w.parse({ email: 'parent@example.test', consent: true, source: 'ig' }));
  assert.equal(f.waitlistMail.length, 1, 'one email, for one new address');
  const [sent] = f.waitlistMail;
  assert.equal(sent.to, 'parent@example.test');
  assert.equal(sent.replyTo, 'support@example.test', 'no-reply writes it, but a person answers it');
  assert.match(sent.subject, /on the AutoMathtics list/);
  assert.match(sent.text, /19 September 2026/);
  assert.equal(sent.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  const url = sent.headers['List-Unsubscribe'].replace(/^<|>$/g, '');
  assert.ok(sent.text.includes(url) && sent.html.includes(url), 'the same link a reader can click is the one the provider posts to');
  const again = await w.join(w.parse({ email: 'PARENT@example.test', consent: true }));
  assert.equal(f.waitlistMail.length, 1, 'a second Join within the day is a double tap, not a second person');
  assert.deepEqual([again.repeat, again.mailed], [true, false], 'and the page is told so, rather than left to guess');
  const token = new URL(url).searchParams.get('t');
  assert.deepEqual(await w.leave(token), { ok: true });
  assert.equal(await w.size(), 0, 'and the link takes that address off');
});

test('a forged or altered unsubscribe link removes nothing', async () => {
  const f = fixture(), w = f.waitlist;
  await w.join(w.parse({ email: 'parent@example.test', consent: true }));
  const url = f.waitlistMail[0].headers['List-Unsubscribe'].replace(/^<|>$/g, '');
  const good = new URL(url).searchParams.get('t'), [id, sig] = good.split('.');
  for (const bad of [id, `${id}.`, `${id}.${'0'.repeat(sig.length)}`, `${sha256('someone-else@example.test')}.${sig}`, '', 'nonsense'])
    await assert.rejects(w.leave(bad), rejected('INVALID_TOKEN'));
  assert.equal(await w.size(), 1, 'the address is still there');
  await w.leave(good);
  assert.equal(await w.size(), 0);
});

test('a provider that fails does not unlist anyone: the address is kept and the failure is logged, not shown', async () => {
  const f = fixture(), lines = [];
  f.waitlist.log = (event) => lines.push(event);
  f.waitlist.mailer = { send: async () => { throw Object.assign(Error('down'), { code: 'PROVIDER_UNREACHABLE' }); } };
  assert.deepEqual(await f.waitlist.join(f.waitlist.parse({ email: 'parent@example.test', consent: true })), { ok: true, repeat: false, mailed: false, mailedAt: null }, 'the send failed; the address is listed regardless');
  assert.equal(await f.waitlist.size(), 1);
  assert.ok(lines.some((l) => l.event === 'waitlist_confirm_failed'), 'the failure is a line in the log, not the parent\u2019s problem');
});

// The owner's report of 13 Sep 2026: they joined with the same address again and again and heard nothing, because the note
// only ever went to an address never seen before — and theirs had gone on the list before the note existed. An address that
// has never actually had the note gets it whenever it joins; one that has waits a day, so a second Join is never a way to
// mail-bomb somebody else's address.
test('an address listed before the note existed still gets one; after that a rejoin waits a day', async () => {
  const f = fixture(), w = f.waitlist;
  w.mailer = null; // the list as it was before it could write to anyone
  await w.join(w.parse({ email: 'parent@example.test', consent: true }));
  assert.equal((await f.store.get(`waitlist/${sha256('parent@example.test')}`)).mailedAt, undefined, 'nothing was sent, and nothing pretends otherwise');

  w.mailer = { send: async (m) => { f.waitlistMail.push(m); return { id: 'fake', provider: 'fake' }; } };
  const caught = await w.join(w.parse({ email: 'parent@example.test', consent: true }));
  assert.deepEqual([caught.repeat, caught.mailed], [true, true], 'the address was already listed, and now it hears about it');
  assert.equal(f.waitlistMail.length, 1);

  const soon = await w.join(w.parse({ email: 'parent@example.test', consent: true }));
  assert.deepEqual([soon.repeat, soon.mailed], [true, false], 'a third Join minutes later sends nothing');
  assert.equal(soon.mailedAt, caught.mailedAt, 'and still names when the note did go');

  f.advance(86_400_000);
  const tomorrow = await w.join(w.parse({ email: 'parent@example.test', consent: true }));
  assert.deepEqual([tomorrow.repeat, tomorrow.mailed], [true, true], 'a parent who lost it can ask again the next day');
  assert.equal(f.waitlistMail.length, 2);
});
