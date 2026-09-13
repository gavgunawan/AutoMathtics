// The screens a stranger meets, and the terms (the owner's requests of 13 Sep 2026). A device that has never had a session opens
// at the introduction, with the prices and the public pages; a device that has opens at sign-in, as it always did. Nobody signs up
// without ticking the terms box, the family's step carries the version it agreed to, and a parent who signed up elsewhere ticks it
// there. An iPhone, which gives a web page no full screen, is told how to get one from the Home Screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uiFixture } from './ui-support.mjs';
import { TERMS_VERSION } from '../server/site.mjs';

const BEFORE = Date.parse('2026-09-15T04:00:00Z'); // 11:00 in Jakarta, before the grid opens
const root = { pathname: '/', search: '', hash: '', href: 'https://automathtics.net/' };
// a browser's localStorage, as far as the page uses it
const memory = (entries = {}) => {
  const m = new Map(Object.entries(entries));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
};
const boxes = (h) => h.nodes('INPUT').filter((i) => i.type === 'checkbox');
async function enter(h, name) {
  await h.nodes('BUTTON').find((n) => n.className === 'player-card' && n.textContent.includes(name)).onclick();
  h.nodes('INPUT')[0].value = '763829'; await h.click('Enter my grid');
}

test('a device that has never had a session opens at the introduction, with what it costs and the public pages; Sign in is one tap away', async (t) => {
  const h = await uiFixture(t, { signedIn: false, family: false, storage: memory(), location: root, clock: () => BEFORE });
  assert.equal(h.html.attrs['data-mode'], 'join', 'the introduction, not a sign-in form');
  for (const words of ['Maths practice they ask to do.', 'WHAT IT COSTS', 'IDR 150,000 a month', 'IDR 275,000 a month', 'IDR 125,000 a month', 'nothing is charged before 11 October'])
    assert.ok(h.root.textContent.includes(words), words);
  assert.deepEqual(h.nodes('A').map((a) => a.href), ['/pricing', '/terms', '/privacy', '/refunds', '/contact']);
  await h.click('I already have an account');
  assert.ok(h.root.textContent.includes('Sign in as parent'));
  assert.deepEqual(h.nodes('A').map((a) => a.href), ['/pricing', '/terms', '/privacy', '/refunds', '/contact'], 'and under the sign-in form too');
});

test('a device that has had a session opens at sign-in as before — the kids’ tablet with no public links on it — and a session marks the device as seen', async (t) => {
  const tablet = await uiFixture(t, { signedIn: false, family: false, storage: memory({ 'automathtics.kidmode': '1' }), location: root });
  assert.ok(tablet.root.textContent.includes('Sign in as parent'), 'the launch pad expired: a parent signs in, as always');
  assert.equal(tablet.nodes('A').length, 0, 'no way off to the public pages from a child’s device');
  const phone = await uiFixture(t, { signedIn: false, family: false, storage: memory({ 'automathtics.remember': 'ab'.repeat(32) }), location: root });
  assert.ok(phone.root.textContent.includes('Sign in as parent'), 'a parent’s phone');
  const blocked = await uiFixture(t, { signedIn: false, family: false, location: root });
  assert.ok(blocked.root.textContent.includes('Sign in as parent'), 'no storage to ask: sign-in, the safe answer');
  const store = memory(); await uiFixture(t, { storage: store, location: root });
  assert.equal(store.getItem('automathtics.seen'), '1', 'a session was had here: this device opens at sign-in from now on');
});

test('sign-up is refused until the terms box is ticked; ticked, the family’s step does not ask again and creating the family carries the version', async (t) => {
  const h = await uiFixture(t, { signedIn: false, family: false, recordBodies: ['/api/family'] });
  h.api.signInScreen(true);
  const terms = boxes(h)[0];
  assert.ok(terms.checked !== true, 'unticked to begin with');
  assert.ok(h.root.textContent.includes('I agree to the Terms of Service and the Privacy Policy.'), 'in English');
  assert.ok(h.root.textContent.includes('saya menyetujui Syarat dan Ketentuan Layanan serta Kebijakan Privasi.'), 'and in Bahasa Indonesia');
  assert.deepEqual(h.nodes('A').filter((a) => a.target === '_blank').map((a) => a.href), ['/terms', '/privacy', '/id/terms', '/id/privacy'], 'each opens in a new tab, so the form keeps what was typed');
  let made = 0;
  h.setAuth('newParent', { signUp: async () => { made++; return { stage: 'ready', idToken: h.f.token('newParent') }; }, idToken: async () => h.f.token('newParent') });
  boxes(h)[1].checked = true; // the emails, but not the terms
  await h.submitLogin();
  assert.equal(made, 0, 'no account'); assert.ok(h.message.textContent.includes('Terms of Service and the Privacy Policy'), h.message.textContent);
  boxes(h)[0].checked = true; await h.submitLogin();
  assert.equal(made, 1, 'the account is made'); assert.ok(h.root.textContent.includes('Name your crew.'));
  assert.equal(boxes(h).length, 0, 'the box is not asked a second time'); assert.ok(h.root.textContent.includes('You agreed to the Terms of Service and the Privacy Policy when you created this account.'));
  h.nodes('INPUT')[0].value = 'Test crew'; await h.click('Create family workspace');
  assert.deepEqual(h.requests.filter((r) => r.path === '/api/family').map((r) => r.body), [{ label: 'Test crew', adultAttestation: true, consentVersion: TERMS_VERSION }]);
  assert.equal((await h.f.store.get('parents/newParent')).consentVersion, TERMS_VERSION);
});

test('a parent who signed up somewhere else ticks the terms at the family’s step, and nothing is created until they do', async (t) => {
  const h = await uiFixture(t, { family: false, recordBodies: ['/api/family'] });
  assert.ok(h.root.textContent.includes('Name your crew.'));
  assert.equal(boxes(h).length, 1, 'the terms box, here');
  h.nodes('INPUT')[0].value = 'Test crew'; await h.click('Create family workspace');
  assert.equal(h.requests.filter((r) => r.path === '/api/family').length, 0, 'nothing sent'); assert.ok(h.message.textContent.includes('Tick the box'), h.message.textContent);
  boxes(h)[0].checked = true; await h.click('Create family workspace');
  assert.deepEqual(h.requests.filter((r) => r.path === '/api/family').map((r) => r.body.consentVersion), [TERMS_VERSION]);
  assert.ok(!h.root.textContent.includes('Name your crew.'), 'the family exists');
});

test('on an iPhone, where no web page can have full screen, the full-screen button says how to get it from the Home Screen; a home-screen app shows none', async (t) => {
  const iPhone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0 Mobile/15E148 Safari/604.1';
  const fsButton = (h) => h.nodes('BUTTON').find((b) => b.attrs['aria-label'] === 'Full screen');
  for (const [navigator, expected] of [[{ userAgent: iPhone }, true], [{ userAgent: iPhone, standalone: true }, false], [{ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, false]]) {
    const h = await uiFixture(t, { navigator });
    await h.f.child(h.a.ctx, 'Allison'); await h.api.refresh(); await h.click('Hand over to kids'); await enter(h, 'Allison');
    assert.ok(h.root.textContent.includes('Allison · SECTOR A'), 'the child’s home');
    assert.equal(Boolean(fsButton(h)), expected, JSON.stringify(navigator));
    if (expected) { await fsButton(h).onclick(); assert.ok(h.message.textContent.includes('Add to Home Screen'), h.message.textContent); }
  }
});
