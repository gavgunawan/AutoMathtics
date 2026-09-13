// The opening email to the waiting list (the owner's approval of 13 Sep 2026): the approved words, once to every address the list
// holds when the doors open, with the unsubscribe every message to the list carries — never twice to anyone however often the job
// runs or however two runs overlap, never to an address that left or expired, at most a day's allowance a run, and a failed send
// retried by the next run rather than lost or doubled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture } from './support.mjs';
import { OPENING_SUBJECT, WAITLIST_OPEN_A_RUN, WAITLIST_OPEN_CLAIM_MS } from '../server/waitlist.mjs';
import { MONTHLY_PRICES } from '../server/pricing.mjs';
import { sha256 } from '../server/security.mjs';

async function join(f, ...emails) {
  for (const email of emails) { await f.waitlist.join(f.waitlist.parse({ email, consent: true })); f.advance(1000); } // joined in this order
  f.waitlistMail.length = 0; // their confirmations: these tests are about the opening email alone
}
const rowOf = (f, email) => f.store.get(`waitlist/${sha256(email)}`);
// The owner's approved text, line for line (the sign-up address is the service's own origin: the fixture's here)
const APPROVED = [
  'Hi,',
  "You asked us to write when AutoMathtics opened. It's open now.",
  'Every family can use it free until 10 October 2026, 23:59 WIB. No card needed.',
  '1. Sign up at pilot.example.test/join with your email and a password.',
  '2. Confirm your email, then add your mobile number for the sign-in code.',
  '3. Name your crew and add up to four children.',
  "Your children practise maths in short papers and earn coins for the shop. You get a weekly email showing what they answer quickly, what's slow, and what keeps going wrong.",
  "After 10 October it's IDR 199,000 a month for one child (379,000 for two, 519,000 for three, 599,000 for four), or pay yearly and save 20%. You're only ever charged if you choose a plan yourself.",
  'See you on the grid,\nAutoMathtics',
];

test('a dry run counts and sends nothing; the run writes once to every address with the approved words, a working unsubscribe and Reply to a person; a rerun writes to nobody twice', async () => {
  const f = fixture(), w = f.waitlist;
  await join(f, 'first@example.test', 'second@example.test');
  assert.deepEqual(await w.announceOpening(), { status: 'dry_run', due: 2, sent: 0, failed: 0, skipped: 0, wouldSend: 2, left: 2 });
  assert.equal(f.waitlistMail.length, 0, 'a dry run sends nothing');
  assert.equal((await rowOf(f, 'first@example.test')).openedMailAt, undefined, 'and marks nothing');

  assert.deepEqual(await w.announceOpening({ dryRun: false }), { status: 'sent', due: 2, sent: 2, failed: 0, skipped: 0, left: 0 });
  assert.deepEqual(f.waitlistMail.map((m) => m.to), ['first@example.test', 'second@example.test'], 'one email each, those who joined first first');
  const [m] = f.waitlistMail;
  assert.equal(m.subject, OPENING_SUBJECT); assert.equal(OPENING_SUBJECT, 'AutoMathtics is open: free until 10 October');
  for (const words of APPROVED) assert.ok(m.text.includes(words), words);
  assert.ok(m.html.includes('<a href="https://pilot.example.test/join">pilot.example.test/join</a>'), 'the sign-up address is a link');
  assert.equal(m.replyTo, 'support@example.test', 'no-reply writes it, a person answers it');
  assert.deepEqual(m.tags, [{ name: 'kind', value: 'waitlist_open' }]);
  assert.equal(m.idempotencyKey, `waitlist-open:${sha256('first@example.test')}`, 'the provider itself refuses a second copy within a day');
  assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  const url = m.headers['List-Unsubscribe'].replace(/^<|>$/g, '');
  assert.ok(m.text.includes(url) && m.html.includes(url), 'the link a reader clicks is the one a mailbox provider posts to');
  assert.equal(typeof (await rowOf(f, 'first@example.test')).openedMailAt, 'number');
  assert.equal((await rowOf(f, 'first@example.test')).openingClaimAt, undefined, 'the claim is gone once the address is marked');

  assert.deepEqual(await w.announceOpening({ dryRun: false }), { status: 'sent', due: 0, sent: 0, failed: 0, skipped: 0, left: 0 }, 'a rerun finds nobody left to write to');
  assert.equal(f.waitlistMail.length, 2);
  await w.leave(new URL(url).searchParams.get('t'));
  assert.equal(await w.size(), 1, 'the link in it takes that address off');

  await join(f, 'late@example.test');
  assert.equal((await w.announceOpening({ dryRun: false })).sent, 1, 'someone who joined after the run hears on the next one');
  assert.deepEqual(f.waitlistMail.map((x) => x.to), ['late@example.test']);
});

test('at most the limit a run; a failed send is released and the next run writes it; an expired address is never written to; a claim left by a run that stopped lapses', async () => {
  const f = fixture(), w = f.waitlist;
  await join(f, 'a@example.test', 'b@example.test', 'c@example.test', 'd@example.test');
  await f.store.transaction(async (tx) => { // reads first, then writes, as a Firestore transaction requires
    const d = await tx.get(`waitlist/${sha256('d@example.test')}`), c = await tx.get(`waitlist/${sha256('c@example.test')}`);
    tx.set(`waitlist/${sha256('d@example.test')}`, { ...d, expireAt: f.now() - 1 }); // d has expired
    tx.set(`waitlist/${sha256('c@example.test')}`, { ...c, openingClaimAt: f.now() }); // c is held by a run that stopped a moment ago
  });
  const real = w.mailer;
  w.mailer = { send: async (m) => { if (m.to === 'b@example.test') throw Object.assign(Error('down'), { code: 'PROVIDER_UNREACHABLE' }); return real.send(m); } };
  const lines = []; w.log = (line) => lines.push(line);
  assert.deepEqual(await w.announceOpening({ dryRun: false, limit: 2 }), { status: 'sent', due: 3, sent: 1, failed: 1, skipped: 0, left: 2 }, 'a is written, b fails, c waits for the next run: the limit was two');
  assert.equal((await rowOf(f, 'b@example.test')).openingClaimAt, undefined, 'the failed send let go of its claim');
  assert.equal((await rowOf(f, 'b@example.test')).openedMailAt, undefined, 'and is not marked as written to');
  assert.ok(lines.some((l) => l.event === 'waitlist_open_failed' && l.reason === 'PROVIDER_UNREACHABLE'));
  assert.ok(!JSON.stringify(lines).includes('@'), 'no address in any log line');

  w.mailer = real;
  assert.deepEqual(await w.announceOpening({ dryRun: false, limit: 2 }), { status: 'sent', due: 2, sent: 1, failed: 0, skipped: 1, left: 1 }, 'b is written now; c is still held by the run that stopped');
  f.advance(WAITLIST_OPEN_CLAIM_MS);
  assert.deepEqual(await w.announceOpening({ dryRun: false }), { status: 'sent', due: 1, sent: 1, failed: 0, skipped: 0, left: 0 }, 'its claim lapsed: c is written');
  assert.deepEqual(f.waitlistMail.map((m) => m.to).sort(), ['a@example.test', 'b@example.test', 'c@example.test'], 'd had expired and heard nothing; nobody heard twice');
});

test('a bad limit is refused; without a mailer, or without the secret that signs the unsubscribe, nothing is sent; the prices are the price list\'s; the job reads its arguments strictly', async () => {
  const f = fixture(), w = f.waitlist;
  await join(f, 'a@example.test');
  for (const limit of [0, -1, 1.5, 1001, '5', null]) await assert.rejects(w.announceOpening({ dryRun: false, limit }), (e) => e.code === 'INVALID_LIMIT', String(limit));
  const mailer = w.mailer; w.mailer = null;
  assert.equal((await w.announceOpening({ dryRun: false })).status, 'no_mailer');
  w.mailer = mailer; const secret = w.secret; w.secret = null;
  assert.equal((await w.announceOpening({ dryRun: false })).status, 'unsigned');
  assert.equal(f.waitlistMail.length, 0, 'an email without a working unsubscribe is never sent');
  w.secret = secret;
  assert.equal((await w.announceOpening({ dryRun: false })).sent, 1);
  for (const n of [1, 2, 3, 4]) assert.ok(f.waitlistMail[0].text.includes(String(MONTHLY_PRICES[n]).replace(/\B(?=(\d{3})+(?!\d))/g, ',')), `the price for ${n}`);
  assert.equal(WAITLIST_OPEN_A_RUN, 90, 'under Resend\'s free 100 a day');
  const job = await readFile(new URL('../scripts/waitlist-open.mjs', import.meta.url), 'utf8');
  for (const s of ["dryRun: !send", "argv[i] === '--send' && !send", 'SESSION_SECRET is required', 'WAITLIST_FROM', 'CONFIRM_PROJECT', 'process.exitCode = 2'])
    assert.ok(job.includes(s), s);
});
