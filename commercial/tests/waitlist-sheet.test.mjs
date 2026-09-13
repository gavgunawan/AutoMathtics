// The owner's copy of the waiting list in a Google Sheet (the owner's request of 13 Sep 2026: "cant this be in gsheet or something
// less codey"). The sheet is rewritten whole from the list after every join and every leave, and at startup when the copy is over
// an hour old, so it never keeps an address the list no longer holds; Google being slow or refusing never costs a parent their
// place; values are written RAW; and the client asks the metadata server for a spreadsheets-only token, once, with no key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, secret } from './support.mjs';
import { Waitlist, WAITLIST_SHEET_REFRESH_MS, WAITLIST_TTL_MS } from '../server/waitlist.mjs';
import { createSheets, METADATA_TOKEN_URL } from '../server/sheets.mjs';
import { sha256 } from '../server/security.mjs';

const SHEET = '1vceAjJRQQYa1u3Z0okf7Tt3AOsZVBWui5Xvav985dNQ';
const recorder = () => { const writes = []; return { writes, write: async (id, body) => { writes.push({ id, ...structuredClone(body) }); } }; };
function make(f, extra = {}) {
  const logs = [];
  const w = new Waitlist({ store: f.store, release: 'test-release', now: f.now, secret, origin: 'https://automathtics.net', sheetId: SHEET, log: (e) => logs.push(e), ...extra });
  return { w, logs };
}
const join = (w, email, source) => w.join(w.parse({ email, consent: true, source }));
const wib = (ms) => new Date(ms + 7 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');

test('every join rewrites the sheet from the list: a header, newest first, the times in WIB, the count, and the rows below emptied', async () => {
  const f = fixture(), sheets = recorder(), { w } = make(f, { sheets }), first = f.now();
  await join(w, 'first@example.test', 'ig');
  f.advance(60_000);
  await join(w, 'second@example.test');
  assert.equal(sheets.writes.length, 2, 'one rewrite for each join');
  const last = sheets.writes.at(-1), [[range, table], [summaryRange, summary]] = last.data;
  assert.equal(last.id, SHEET); assert.equal(range, 'A1:E3');
  assert.deepEqual(table[0], ['Joined (WIB)', 'Email', 'Came from', 'Confirmation sent (WIB)', 'Last joined (WIB)']);
  assert.deepEqual(table.slice(1).map((r) => [r[1], r[2]]), [['second@example.test', ''], ['first@example.test', 'ig']], 'newest first, with the post each came from');
  assert.equal(table[2][0], wib(first), 'Jakarta time, UTC+7'); assert.equal(table[2][4], wib(first));
  assert.equal(table[1][3], '', 'no confirmation went: this list has no mailer');
  assert.equal(summaryRange, 'G1:H2'); assert.deepEqual(summary, [['List updated (WIB)', 'Addresses'], [wib(f.now()), 2]]);
  assert.deepEqual(last.clear, ['A4:E'], 'whatever sat below the list is emptied');
  assert.equal(sheets.writes[0].data[0][1].length, 2, 'the first rewrite held the first address alone');
});

test('an address that leaves the list leaves the sheet in the same request, and one past its expiry is never written', async () => {
  const f = fixture(), sheets = recorder(), { w } = make(f, { sheets });
  await join(w, 'stay@example.test'); await join(w, 'go@example.test');
  await w.leave(w.leaveToken(sha256('go@example.test')));
  assert.deepEqual(sheets.writes.at(-1).data[0][1].slice(1).map((r) => r[1]), ['stay@example.test']);
  f.advance(WAITLIST_TTL_MS + 1);
  await w.syncSheet('test');
  assert.deepEqual(sheets.writes.at(-1).data[0][1], [['Joined (WIB)', 'Email', 'Came from', 'Confirmation sent (WIB)', 'Last joined (WIB)']], 'past its expiry: out of the copy, whether or not the TTL sweep has reached the row');
  assert.deepEqual(sheets.writes.at(-1).clear, ['A2:E']);
});

test('a Google that refuses or hangs never costs a parent their place: the join is kept and answered, and the failure is logged without the address', async () => {
  const f = fixture();
  const broken = make(f, { sheets: { write: async () => { throw Object.assign(Error('Google answered 403'), { code: 'SHEETS_403' }); } } });
  assert.equal((await join(broken.w, 'a@example.test')).ok, true);
  assert.ok(await f.store.get(`waitlist/${sha256('a@example.test')}`), 'listed');
  assert.ok(broken.logs.some((e) => e.event === 'waitlist_sheet_failed' && e.code === 'SHEETS_403' && e.reason === 'join'), JSON.stringify(broken.logs));
  assert.ok(!JSON.stringify(broken.logs).includes('a@example.test'), 'no address in any log line');
  assert.equal(await f.store.get('waitlistSheet/state'), null, 'a failed write records nothing, so the next startup tries again');
  const g = fixture(), hung = make(g, { sheets: { write: () => new Promise(() => {}) }, sheetDeadlineMs: 20 });
  const started = Date.now();
  assert.equal((await join(hung.w, 'b@example.test')).ok, true);
  assert.ok(Date.now() - started < 2000, 'answered at the deadline, not whenever Google answers');
  assert.ok(await g.store.get(`waitlist/${sha256('b@example.test')}`), 'and listed');
});

test('at startup the sheet is rewritten only when it was never written for this sheet id or not within the hour; with no sheet named, nothing is written', async () => {
  const f = fixture(), sheets = recorder(), { w } = make(f, { sheets });
  assert.equal((await w.syncSheetIfStale()).synced, true, 'a new sheet fills itself at the first startup');
  assert.deepEqual(await w.syncSheetIfStale(), { synced: false, reason: 'fresh' });
  const state = await f.store.get('waitlistSheet/state');
  assert.deepEqual(Object.keys(state).sort(), ['count', 'sheetId', 'syncedAt'], 'the marker holds no address'); assert.equal(state.sheetId, SHEET);
  f.advance(WAITLIST_SHEET_REFRESH_MS);
  assert.equal((await w.syncSheetIfStale()).synced, true, 'an hour on: rewritten, so an expired address leaves it');
  assert.equal((await make(f, { sheets, sheetId: 'x'.repeat(44) }).w.syncSheetIfStale()).synced, true, 'another sheet: written at once');
  assert.equal(sheets.writes.length, 3);
  const none = make(f, { sheets, sheetId: null });
  await join(none.w, 'c@example.test');
  assert.deepEqual(await none.w.syncSheetIfStale(), { synced: false, reason: 'no_sheet' });
  assert.equal(sheets.writes.length, 3, 'no sheet named: no write, from a join or a startup');
});

test('the client asks the metadata server for a spreadsheets-only token once, writes RAW then clears, and names a refusal by its status', async () => {
  const calls = [], token = { access_token: 'tok-1', expires_in: 3600 };
  let now = 1_000_000;
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200, json: async () => (url === METADATA_TOKEN_URL ? token : {}) };
  };
  const sheets = createSheets({ fetch, now: () => now });
  await sheets.write(SHEET, { data: [['A1:B1', [['=HYPERLINK("https://example.test")', 'b']]]], clear: ['A2:E'] });
  await sheets.write(SHEET, { data: [['A1:B1', [['a', 'b']]]] });
  assert.ok(METADATA_TOKEN_URL.startsWith('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes='));
  assert.ok(METADATA_TOKEN_URL.endsWith(encodeURIComponent('https://www.googleapis.com/auth/spreadsheets')), 'spreadsheets, and nothing wider');
  assert.equal(calls[0].url, METADATA_TOKEN_URL); assert.equal(calls[0].headers['Metadata-Flavor'], 'Google');
  assert.equal(calls[1].url, `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values:batchUpdate`);
  assert.equal(calls[1].headers.Authorization, 'Bearer tok-1');
  assert.equal(calls[1].body.valueInputOption, 'RAW', 'a cell that looks like a formula stays text');
  assert.deepEqual(calls[1].body.data, [{ range: 'A1:B1', majorDimension: 'ROWS', values: [['=HYPERLINK("https://example.test")', 'b']] }]);
  assert.equal(calls[2].url, `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values:batchClear`); assert.deepEqual(calls[2].body, { ranges: ['A2:E'] });
  assert.equal(calls.length, 4, 'one token for both writes, and the second clears nothing');
  now += 3_600_000;
  await sheets.write(SHEET, { data: [['A1', [['c']]]] });
  assert.equal(calls.filter((c) => c.url === METADATA_TOKEN_URL).length, 2, 'a token about to lapse is fetched again');
  const refusing = createSheets({ fetch: async (url) => ({ ok: url === METADATA_TOKEN_URL, status: url === METADATA_TOKEN_URL ? 200 : 403, json: async () => token }) });
  await assert.rejects(refusing.write(SHEET, { data: [['A1', [['x']]]] }), { code: 'SHEETS_403' });
});
