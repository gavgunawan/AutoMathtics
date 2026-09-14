// A family's calendar (the owner's decision of 14 Sep 2026): a new family starts on the zone of its parent's verified mobile (+62 WIB,
// +65 Singapore, +60 Malaysia, anything else the default), which the session carries as a zone name and never as the number; a parent
// picks another in Game & progress from a list of the zones AutoMathtics serves, where a box to type a zone name used to be.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './support.mjs';
import { uiFixture } from './ui-support.mjs';
import { TIME_ZONE_CHOICES, timeZoneForPhone } from '../server/progress.mjs';
import { DEFAULT_TIME_ZONE } from '../server/service.mjs';
import { TERMS_VERSION } from '../server/site.mjs';

test('the first calendar follows the calling code of the verified mobile, and only the zone name reaches the session', async () => {
  assert.deepEqual(['+628123456789', '+6591234567', '+60123456789', '+14155550100', '', null, undefined, '62812'].map(timeZoneForPhone),
    ['Asia/Jakarta', 'Asia/Singapore', 'Asia/Kuala_Lumpur', null, null, null, null, null]);
  assert.deepEqual(TIME_ZONE_CHOICES.map((c) => c.zone), ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'Asia/Singapore', 'Asia/Kuala_Lumpur']);
  for (const c of TIME_ZONE_CHOICES) assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: c.zone }), c.zone);
  const f = fixture();
  for (const [uid, phone, zone] of [['parentId', '+628123456789', 'Asia/Jakarta'], ['parentMy', '+60123456789', 'Asia/Kuala_Lumpur'], ['parentSg', '+6591234567', 'Asia/Singapore'], ['parentUs', '+14155550100', DEFAULT_TIME_ZONE]]) {
    f.token(uid); const factor = f.enrollPhone(uid, phone);
    const { ctx } = await f.login(uid, { firebase: { sign_in_provider: 'password', sign_in_second_factor: 'phone', second_factor_identifier: factor } });
    const session = [...f.store.data.entries()].find(([k, v]) => k.startsWith('sessions/') && v.uid === uid)?.[1];
    assert.ok(session, uid); assert.ok(!JSON.stringify(session).includes(phone.slice(1)), `${uid}: the session never carries the number`);
    const created = await f.service.createFamily(ctx, { label: 'Crew', adultAttestation: true, consentVersion: TERMS_VERSION });
    assert.equal((await f.store.get(`families/${created.id}`)).timeZone, zone, `${uid} ${phone}`);
  }
});

test('Game & progress: the time zone is a choice of the zones served with the family\'s own selected; saving another stores it; a zone from before the list stays listed and chosen', async (t) => {
  const h = await uiFixture(t); await h.f.child(h.a.ctx); await h.api.refresh();
  await h.click('Game & progress');
  const select = () => h.nodes('SELECT').find((s) => s.attrs['aria-label'] === 'Family time zone');
  assert.ok(select(), 'a list to choose from, not a box to type in');
  assert.deepEqual(select().children.map((o) => o.value), ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'Asia/Singapore', 'Asia/Kuala_Lumpur']);
  assert.equal(select().value, 'Asia/Singapore', 'the family\'s zone is the one shown');
  assert.ok(h.root.textContent.includes('WITA (UTC+8)') && h.root.textContent.includes('When a child’s day ends'));
  select().value = 'Asia/Makassar'; await h.click('Save time zone');
  assert.equal((await h.f.store.get(`families/${h.a.familyId}`)).timeZone, 'Asia/Makassar');
  assert.equal(select().value, 'Asia/Makassar', 'the screen is drawn again with the saved zone');
  const fam = await h.f.store.get(`families/${h.a.familyId}`); await h.f.store.put(`families/${h.a.familyId}`, { ...fam, timeZone: 'Europe/London' });
  await h.click('Back to family'); await h.click('Game & progress');
  assert.deepEqual([select().children[0].value, select().value], ['Europe/London', 'Europe/London'], 'opening the screen changes nothing');
});
