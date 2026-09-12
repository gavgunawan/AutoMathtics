// Stage 4.6 — the support desk: the incident log the owner writes from a phone, the canned replies
// that never ask a parent for a secret, and the promise that every procedure in the desk's documents
// names a command this repository actually has.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fixture, rejected } from './support.mjs';
import { INCIDENT_SEVERITIES, EVENT_OUTCOMES, INTENT_OUTCOMES } from '../server/support.mjs';
import { EVENTS } from '../server/subscription.mjs';

const OPERATOR = 'ops@example.test';
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const HOUR = 3_600_000;

test('the incident log: open, note, close, list — an audit row for each, a bad severity refused, and closing is final', async () => {
  const f = fixture();
  await assert.rejects(f.support.openIncident({ operator: '', severity: 1, summary: 'the app is down' }), rejected('OPERATOR_REQUIRED'));
  for (const severity of [0, 4, '1', 1.5, null, undefined, NaN]) {
    await assert.rejects(f.support.openIncident({ operator: OPERATOR, severity, summary: 'the app is down' }), rejected('INVALID_SEVERITY'), String(severity));
  }
  assert.deepEqual([...INCIDENT_SEVERITIES], [1, 2, 3]);
  assert.equal((await f.store.list('incidents')).length, 0, 'a refused open writes nothing');
  // the sweep that found it, cited by its own id
  const sweep = await f.support.inspectAll({ operator: OPERATOR });
  await assert.rejects(f.support.openIncident({ operator: OPERATOR, severity: 1, summary: 'the app is down', sweepId: 'last-nights-sweep' }), rejected('INVALID_ID'));
  await assert.rejects(f.support.openIncident({ operator: OPERATOR, severity: 1, summary: 'x' }), rejected('INVALID_REQUEST'), 'a summary is a sentence, not a letter');
  await assert.rejects(f.support.openIncident({ operator: OPERATOR, severity: 2, summary: 'ok', systems: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'] }), rejected('INVALID_REQUEST'));
  await assert.rejects(f.support.openIncident({ operator: OPERATOR, severity: 2, summary: 'ok', familiesAffected: -1 }), rejected('INVALID_REQUEST'));

  const opened = await f.support.openIncident({ operator: OPERATOR, severity: 1, summary: 'two renewals charged for one period', systems: ['payments'], familiesAffected: 2, sweepId: sweep.id });
  assert.match(opened.id, /^inc-20260906-[0-9a-f]{4}$/, 'short enough to type into a reply, sorted by the day it opened');
  assert.equal(opened.status, 'open'); assert.equal(opened.severity, 1); assert.equal(opened.openedBy, OPERATOR); assert.equal(opened.openedAt, f.now());
  assert.deepEqual(opened.systems, ['payments']); assert.equal(opened.familiesAffected, 2); assert.equal(opened.sweepId, sweep.id);
  assert.equal(opened.parentNoticeDueAt, f.now() + 72 * HOUR, 'severity 1 carries the 72-hour deadline for telling affected parents');
  assert.deepEqual(opened.actions, []); assert.equal(opened.resolvedAt, null); assert.deepEqual(opened.followUps, []);
  assert.deepEqual(await f.store.get(`incidents/${opened.id}`), opened);
  f.advance(60_000);
  const lesser = await f.support.openIncident({ operator: OPERATOR, severity: 2, summary: 'one family cannot sign in' });
  assert.equal(lesser.parentNoticeDueAt, null, 'the deadline belongs to severity 1');
  assert.equal(lesser.sweepId, null); assert.deepEqual(lesser.systems, []); assert.equal(lesser.familiesAffected, 0);

  f.advance(5 * 60_000);
  const noted = await f.support.noteIncident(opened.id, { operator: OPERATOR, note: 'the second invoice.paid is a redelivery; the inbox shows both' });
  assert.equal(noted.actions.length, 1); assert.deepEqual(noted.actions[0], { at: f.now(), by: OPERATOR, note: 'the second invoice.paid is a redelivery; the inbox shows both' });
  await f.support.noteIncident(opened.id, { operator: OPERATOR, note: 'told both parents; refunding in the dashboard' });
  assert.deepEqual((await f.support.noteIncident(opened.id, { operator: OPERATOR, note: 'refunds recorded' })).actions.map((a) => a.note).length, 3, 'the timeline keeps its order');
  await assert.rejects(f.support.noteIncident(opened.id, { operator: '', note: 'x' }), rejected('OPERATOR_REQUIRED'));
  await assert.rejects(f.support.noteIncident('inc-20260101-0000', { operator: OPERATOR, note: 'x' }), rejected('INCIDENT_NOT_FOUND'));
  await assert.rejects(f.support.noteIncident(opened.id, { operator: OPERATOR, note: '' }), rejected('INVALID_REQUEST'));

  f.advance(2 * HOUR);
  const closed = await f.support.closeIncident(opened.id, { operator: OPERATOR, resolution: 'both charges refunded at the provider and recorded', followUps: ['pin the redelivery case in a test', 'check the other paying family'] });
  assert.equal(closed.status, 'closed'); assert.equal(closed.resolvedAt, f.now()); assert.equal(closed.resolvedBy, OPERATOR);
  assert.equal(closed.resolution, 'both charges refunded at the provider and recorded');
  assert.deepEqual(closed.followUps, ['pin the redelivery case in a test', 'check the other paying family']);
  assert.equal(closed.actions.length, 3, 'closing does not rewrite the timeline'); assert.equal(closed.openedAt, opened.openedAt);
  await assert.rejects(f.support.closeIncident(opened.id, { operator: OPERATOR, resolution: 'again' }), rejected('INCIDENT_NOT_OPEN'), 'closing is final');
  await assert.rejects(f.support.noteIncident(opened.id, { operator: OPERATOR, note: 'one more thought' }), rejected('INCIDENT_NOT_OPEN'), 'what is learnt afterwards is the postmortem, not the record');
  await assert.rejects(f.support.closeIncident('inc-20260101-0000', { operator: OPERATOR, resolution: 'nothing to close' }), rejected('INCIDENT_NOT_FOUND'));
  await assert.rejects(f.support.closeIncident(lesser.id, { operator: OPERATOR, resolution: 'done', followUps: [''] }), rejected('INVALID_REQUEST'));
  assert.equal((await f.store.get(`incidents/${lesser.id}`)).status, 'open', 'a refused close leaves it open');

  // the log: open ones by default, newest first
  const open = await f.support.listIncidents();
  assert.deepEqual(open.map((r) => r.id), [lesser.id]);
  assert.deepEqual((await f.support.listIncidents('closed')).map((r) => r.id), [opened.id]);
  const all = await f.support.listIncidents('all');
  assert.deepEqual(all.map((r) => r.id), [lesser.id, opened.id]); assert.equal(all[1].notes, 3); assert.equal(all[1].severity, 1);
  await assert.rejects(f.support.listIncidents('everything'), rejected('INVALID_REQUEST'));

  // every verb is audited under the operator, and an incident belongs to no single family
  const rows = (await f.store.list('audit')).filter((a) => a.action.startsWith('support.incident'));
  assert.deepEqual(rows.map((a) => a.action).sort(), ['support.incident_closed', 'support.incident_note', 'support.incident_note', 'support.incident_note', 'support.incident_opened', 'support.incident_opened']);
  for (const row of rows) { assert.equal(row.uid, OPERATOR); assert.equal(row.familyId, null); assert.ok(row.expireAt > row.at); }
  assert.equal(rows.find((a) => a.action === 'support.incident_opened').incidentId, opened.id);
  assert.equal(rows.find((a) => a.action === 'support.incident_closed').openForMs, 2 * HOUR + 6 * 60_000);
  // the record itself never expires: it is what a postmortem is written from
  for (const id of [opened.id, lesser.id]) assert.equal((await f.store.get(`incidents/${id}`)).expireAt, undefined);
});

test('the incident CLI is wired to those three verbs, takes key=value arguments in any order, and says so in its usage', async () => {
  const src = await read('../scripts/support.mjs');
  assert.match(src, /case 'incident': \{/);
  for (const call of ['support.openIncident({ operator: actor, severity: Number(positional[0])', 'support.noteIncident(positional[0], { operator: actor', 'support.closeIncident(positional[0], { operator: actor', 'support.listIncidents(positional[0]']) assert.ok(src.includes(call), call);
  assert.ok(src.includes("/^(systems|families|sweep|follow-ups)=([\\s\\S]*)$/"), 'the four named arguments are parsed in any order');
  assert.ok(src.includes("split(options.systems, ',')") && src.includes("split(options['follow-ups'], ';')"), 'systems are commas, follow-ups are semicolons');
  assert.ok(src.includes("positional.slice(1).join(' ')"), 'a summary typed without quotes is rejoined, never truncated to its first word');
  const usage = src.split('\n').filter((l) => l.includes('Usage: node scripts/support.mjs'));
  assert.equal(usage.length, 2, 'the incident sub-usage and the top-level one');
  assert.ok(usage.every((l) => l.includes('incident')));
  for (const line of ['incident open SEVERITY', 'incident note INCIDENT_ID', 'incident close INCIDENT_ID', 'incident list [open|closed|all]']) assert.ok(src.includes(line), line);
});

test('no canned reply asks a parent for a password, a PIN or a card number — and the check itself catches one that does', async () => {
  const doc = await read('../SUPPORT_REPLIES.md');
  const SECRET = String.raw`passwords?|pins?|passcode|card number|card details|cvv|security code|bank details`;
  const ASK = String.raw`asks?|asking|sends?|gives?|share|provide|forward|tell|reply with|paste|let me know`;
  // "Support never asks you for your password" is the opposite of an ask: it is the anti-phishing line the first reply carries.
  const DISCLAIMED = /\b(never|not|cannot|can't|won't|will not|do not|don't|does not|no one|nobody|nothing)\b[^.!?]{0,24}\b(asks?|asking|needs?|sends?|requires?)\b/i;
  const ASKS_FOR_IT = new RegExp(String.raw`\b(${ASK})\b[^.!?]{0,60}\b(${SECRET})\b`, 'i');            // "reply with your PIN"
  const SEND_IT_HERE = new RegExp(String.raw`\b(${SECRET})\b[^.!?]{0,60}\b(to us|to me|here|in this email|in your reply|back to us|by email|by reply)\b`, 'i');
  const WHAT_IS_YOURS = /what(?:'s| is| are)\s+(?:your|the)\s+[^.?!]{0,24}(passwords?|pins?|card number)/i;
  const asksForASecret = (text) => {
    for (const sentence of text.split(/(?<=[.!?])\s+|\n{2,}/)) {
      if (DISCLAIMED.test(sentence)) continue;
      if (ASKS_FOR_IT.test(sentence) || SEND_IT_HERE.test(sentence) || WHAT_IS_YOURS.test(sentence)) return sentence.trim().replace(/\s+/g, ' ');
    }
    return null;
  };
  // the check is not vacuous: these are caught, and these are not
  for (const phish of ['Please reply with your PIN and card number so we can check.', 'To verify it is you, send me your password here.', 'What is your PIN? I will test the account.',
    'Just paste the card number in this email and I will refund it.', 'If you have not got the card handy, reply with your card number.', 'Tell me the PIN you set and I will try it.']) {
    assert.ok(asksForASecret(phish), `the check missed: ${phish}`);
  }
  for (const ok of ['Support never asks you for your password, a PIN or a card number.',
    'Sign in, open Mission Control, choose the child, then Reset PIN and set the new six digits.',
    'I have refunded the amount back to the way you paid.']) assert.equal(asksForASecret(ok), null, ok);

  const blocks = [...doc.matchAll(/^### (.+)$\n\n```text\n([\s\S]*?)\n```$/gm)].map((m) => ({ title: m[1], body: m[2] }));
  assert.equal(blocks.length, 15, 'fifteen replies, one per situation the labels sort mail into');
  for (const { title, body } of blocks) {
    const asked = asksForASecret(body);
    assert.equal(asked, null, `"${title}" asks for a secret: ${asked}`);
    const words = body.trim().split(/\s+/).filter(Boolean).length;
    assert.ok(words <= 120, `"${title}" is ${words} words; the limit is 120`);
    assert.ok(words >= 40, `"${title}" is ${words} words: too short to say what happens next`);
  }
  // the situations the desk actually sees, in the order SUPPORT_DESK.md labels them
  for (const situation of ['First reply', 'Recovery started', 'Recovery not possible', 'Password reset', 'Mobile number changed', 'PIN reset', 'Refund approved',
    'Refund refused', 'Cancellation confirmed', 'Pause confirmed', 'Bug received', 'Bug fixed and deployed', 'Feature idea noted', 'Child-safety escalation', "another family's data"]) {
    assert.ok(blocks.some((b) => b.title.toLowerCase().includes(situation.toLowerCase())), situation);
  }
  assert.match(doc, /Support\s*\n?never asks you for your password, a PIN or a card number/, 'the first reply tells the parent what this desk will never ask, so a phishing mail is recognisable');
});

test('every procedure in the desk documents names a command this repository actually has', async () => {
  const docs = {};
  for (const name of ['SUPPORT_DESK.md', 'INCIDENTS.md', 'SUPPORT_REPLIES.md']) docs[name] = await read(`../${name}`);
  const script = (relative) => existsSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)));
  const support = await read('../scripts/support.mjs'), cases = new Set([...support.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]));
  let checked = 0;
  for (const [name, text] of Object.entries(docs)) {
    for (const [, file, first, second] of text.matchAll(/node scripts\/([a-z-]+)\.mjs\s+([A-Za-z0-9_.-]+)(?:\s+([A-Za-z0-9_.-]+))?/g)) {
      checked++;
      assert.ok(script(`scripts/${file}.mjs`), `${name} names scripts/${file}.mjs, which does not exist`);
      if (file === 'support') assert.ok(cases.has(first), `${name} names \`support.mjs ${first}\`, which is not a command`);
      if (file === 'subscription') assert.ok(EVENTS.includes(second), `${name} names the subscription event \`${second}\`, which the state machine does not have`);
    }
    for (const [, outcome] of text.matchAll(/resolve-event \S+ \S+ ([a-z_]+)/g)) assert.ok(EVENT_OUTCOMES.includes(outcome), `${name} names the outcome \`${outcome}\``);
    for (const [, outcome] of text.matchAll(/reconcile-intent \S+ \S+ ([a-z_]+)/g)) assert.ok(INTENT_OUTCOMES.includes(outcome), `${name} names the intent outcome \`${outcome}\``);
    for (const [, path] of text.matchAll(/`(scripts\/[A-Za-z0-9/._-]+)`/g)) assert.ok(script(path), `${name} names ${path}, which does not exist`);
  }
  assert.ok(checked >= 10, `only ${checked} commands were checked: the extraction stopped matching`);
  // the desk says plainly where the repository cannot do what a procedure would like
  assert.match(docs['SUPPORT_DESK.md'], /no `refund` verb in `scripts\/support\.mjs`/);
  assert.match(docs['SUPPORT_DESK.md'], /no cancel verb in `scripts\/support\.mjs`/);
  // the desk must name the address a copy goes to and how to tell whether the running release sends any
  assert.match(docs['SUPPORT_DESK.md'], /`FEEDBACK_TO`/);
  assert.match(docs['SUPPORT_DESK.md'], /Check the running release before you answer/);
});
