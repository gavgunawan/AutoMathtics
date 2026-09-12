// /join, the page a social post points at (the owner's request of 12 Sep 2026). Before the doors open on 19 September it takes
// an address and the permission to write to it, and nothing else: no password, no mobile code, no child. The SMS code lives
// where it always did, inside sign-up. From 19 September the same address leads into that sign-up instead, and the page states
// the one date the trial ends on, which is the same moment for everyone however late they joined.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uiFixture } from './ui-support.mjs';

const WIB_BEFORE = Date.parse('2026-09-15T04:00:00Z'); // 11:00 in Jakarta, four days before the doors open
const WIB_OPEN = Date.parse('2026-09-22T04:00:00Z'); // during the trial
const WIB_OVER = Date.parse('2026-10-11T04:00:00Z'); // the morning after it ends
const at = (ms) => ({ clock: () => ms, location: { pathname: '/join', search: '', hash: '', href: 'https://automathtics.net/join' } });
const text = (h) => h.root.textContent;

test('before the doors open, /join explains the grid and asks for an address alone — no password, no mobile code, no child', async (t) => {
  const h = await uiFixture(t, { signedIn: false, family: false, ...at(WIB_BEFORE) });
  assert.ok(text(h).includes('19 September 2026'), 'it names the day it opens');
  for (const words of ['Engine.', 'Navigator.', 'Grid coins.', 'Reward points.', 'A weekly email.',
    'No child email address, phone number, photo or full birth date'])
    assert.ok(text(h).includes(words), words);
  assert.ok(text(h).includes('A code by SMS.'), 'the mobile step is named, so nobody is surprised by it later');
  assert.ok(text(h).includes('it comes during sign-up'), 'and placed where it happens, which is not this page');
  const fields = h.nodes('INPUT');
  assert.deepEqual(fields.map((i) => i.type), ['email', 'checkbox'], 'an address and a permission; nothing else is asked for');
  assert.equal(h.nodes('BUTTON').filter((b) => b.textContent.includes('Start the free trial')).length, 0, 'the trial cannot be started early');
  assert.equal(h.html.attrs['data-mode'], 'join', 'not dressed as a parent screen: no Mission Control masthead over a stranger’s first page');
});

test('the address goes to the waiting list with its permission and the tag the post\'s link carried, and the page says what happens next', async (t) => {
  const h = await uiFixture(t, {
    signedIn: false, family: false, clock: () => WIB_BEFORE, recordBodies: ['/api/waitlist'],
    location: { pathname: '/join', search: '?from=ig', hash: '', href: 'https://automathtics.net/join?from=ig' },
  });
  const [address, agree] = h.nodes('INPUT');
  address.value = ' Parent@Example.test '; agree.checked = true;
  h.nodes('FORM')[0].onsubmit({ preventDefault() {} }); await h.idle();
  assert.deepEqual(h.requests.filter((r) => r.path === '/api/waitlist').map((r) => r.body), [{ email: 'Parent@Example.test', consent: true, source: 'ig' }]);
  assert.ok(text(h).includes('You are on the list.'));
  assert.ok(text(h).includes('We have sent a note to'), 'it says a note went, so silence is never the only answer');
  assert.ok(text(h).includes('Parent@Example.test'), 'it repeats the address, so a typo is visible while it can still be fixed');
  assert.ok(text(h).includes('unsubscribe'), 'and says how to get off the list again');
});

test('from 19 September the same page starts the trial instead, and names the one moment it ends for everyone', async (t) => {
  const h = await uiFixture(t, { signedIn: false, family: false, ...at(WIB_OPEN) });
  assert.ok(text(h).includes('10 October 2026, 23:59 WIB'), 'one date, in the reader\'s own time zone');
  assert.ok(text(h).includes('No card, nothing to cancel.'));
  assert.ok(text(h).includes('starts charging on 11 October'), 'paying during the trial is possible and costs nothing until then');
  assert.equal(h.nodes('INPUT').length, 0, 'the list is closed: the way in is sign-up');
  await h.click('Start the free trial ▶');
  assert.ok(text(h).includes('A new crew starts here.'), 'which is the ordinary sign-up, where the email check and the mobile code live');
});

test('after it ends the page stops promising a trial and simply opens an account', async (t) => {
  const h = await uiFixture(t, { signedIn: false, family: false, ...at(WIB_OVER) });
  assert.ok(text(h).includes('The opening trial has finished.'));
  assert.ok(!text(h).includes('No card, nothing to cancel.'), 'nothing that is no longer true');
  assert.equal(h.nodes('INPUT').length, 0);
});

// The owner's report of 13 Sep 2026: joining twice with the same address said the same thing both times, so it read as broken.
test('an address already waiting is told so, and told where to look for the note it was sent', async (t) => {
  const h = await uiFixture(t, {
    signedIn: false, family: false, clock: () => WIB_BEFORE, recordBodies: ['/api/waitlist'],
    location: { pathname: '/join', search: '', hash: '', href: 'https://automathtics.net/join' },
  });
  await h.f.waitlist.join(h.f.waitlist.parse({ email: 'parent@example.test', consent: true })); // already waiting
  const [address, agree] = h.nodes('INPUT');
  address.value = 'parent@example.test'; agree.checked = true;
  h.nodes('FORM')[0].onsubmit({ preventDefault() {} }); await h.idle();
  assert.ok(text(h).includes('You are already on the list.'), 'not the same words as a first join');
  assert.ok(text(h).includes('parent@example.test'));
});