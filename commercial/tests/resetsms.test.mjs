// Support's reset for a device's SMS countdown (DEPLOY_V3.md section 5): opening the app with ?resetsms removes every record
// the Send countdown keeps on that device. The review of PR #44 found it inside the checkout-return branch, where it
// never ran; it now runs on its own flag.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uiFixture } from './ui-support.mjs';

function storage(seed) {
  const map = new Map(Object.entries(seed));
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => { map.delete(k); },
    key: (i) => [...map.keys()][i] ?? null, get length() { return map.size; } };
}
const seed = () => ({ 'automathtics.sms.key': 'a'.repeat(64), 'automathtics.sms.0123abcd': '[1]', 'automathtics.sms.0123abcd.hold': '2',
  'automathtics.remember': 'f'.repeat(64), unrelated: 'kept' });

test('?resetsms removes every countdown record on the device and says so; nothing else is touched', async (t) => {
  for (const search of ['?resetsms', '?resetsms=1', '?x=1&resetsms']) {
    const store = storage(seed());
    const h = await uiFixture(t, { signedIn: false, storage: store, location: { search, pathname: '/' } });
    assert.deepEqual([...store.map.keys()].sort(), ['automathtics.remember', 'unrelated'], search);
    assert.ok(h.message.textContent.includes('SMS countdown on this device was reset'), h.message.textContent);
  }
});

test('without the flag the records stay, including on the way back from a checkout', async (t) => {
  for (const search of ['?checkout=done&result=cancel', '?resets=1']) {
    const store = storage(seed());
    await uiFixture(t, { signedIn: false, storage: store, location: { search, pathname: '/' } });
    assert.equal(store.map.size, 5, search);
  }
});
