// The SMS resend ladder — the owner's policy for verification SMS to one mobile number (9 Sep 2026; the first
// three codes brought to 30 seconds apart on 11 Sep 2026, after a change of number sat out a fifteen-minute rung
// four times), enforced at the identity provider by the blocking function in index.js before any SMS goes out:
//   1st  at once
//   2nd  30 seconds after the 1st
//   3rd  30 seconds after the 2nd
//   4th  2 minutes after the 3rd
//   5th  15 minutes after the 4th
//   6th  1 hour after the 5th
//   7th  6 hours after the 6th
//   8th  12 hours after the 7th
//   9th  a day after the 8th
// The sends to a number form a *run*; a day without a code to that number ends the run, and the next code is
// the first rung again. Inside a run every send counts, however old — the fifth code waits its fifteen minutes
// even when the first was sent yesterday. The last rung and the quiet period are the same day, and `currentRun`
// ends a run on a gap of exactly that length, so the ninth code arrives a day after the eighth as the policy
// says but as the FIRST rung of a fresh run: eight codes is the most a run ever holds, and the code after the
// wait starts the ladder over rather than extending it. That is the more forgiving reading of the two rules.
// public/sms-schedule.js carries a copy of this table so the browser can count down to the next rung; it is
// display only, and tests/sms-ladder.test.mjs fails if the two ever differ.
//
// A rung is spent when Identity Platform ASKS permission, which is the only moment a blocking function sees.
// No hook reports delivery, so codes that the provider then fails to send still climb the ladder, and a parent
// hitting a delivery fault is pushed up the rungs by failures alone (DEPLOY_V3.md says how to clear a record). The number itself is never stored: the record key is an HMAC of the E.164
// number under a pepper the function reads from Secret Manager. Pure — no I/O and no clock of its own — so the
// same rules run in the unit tests (tests/sms-ladder.test.mjs).
import { createHmac } from 'node:crypto';

const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
/** The wait after the n-th send of a run (index n − 1) before the next may go; the last entry repeats. */
export const SMS_LADDER_MS = Object.freeze([30 * SECOND, 30 * SECOND, 2 * MINUTE, 15 * MINUTE, HOUR, 6 * HOUR, 12 * HOUR, DAY]);
export const SMS_QUIET_MS = DAY;           // this long without a code ends the run
// The record expires by TTL a day after its run could last have counted. Every send rewrites expireAt from its own
// time, and a record matters only until a day of quiet after its latest send, so two days covers a run however many
// rungs it climbs (the longest wait inside one is the day that also ends it) — the longer ladder changes nothing here.
export const SMS_RECORD_TTL_MS = 2 * DAY;
const E164 = /^\+[1-9]\d{6,14}$/;

/** The record key for a number: an HMAC of its E.164 form under the pepper; null for anything that is not a number. */
export function ladderKey(pepper, phoneNumber) {
  if (typeof pepper !== 'string' || pepper.length < 16 || typeof phoneNumber !== 'string') return null;
  const digits = phoneNumber.replace(/[\s().-]/g, '');
  if (!E164.test(digits)) return null;
  return createHmac('sha256', pepper).update(`sms:${digits}`).digest('hex');
}
/** The current run at `now`: the latest sends with no day of quiet between them, nor between the last and now; oldest first. */
export function currentRun(record, now) {
  const all = (Array.isArray(record?.sends) ? record.sends : []).filter((t) => Number.isSafeInteger(t) && t <= now).sort((a, b) => a - b);
  let start = all.length;
  while (start > 0 && (start === all.length ? now : all[start]) - all[start - 1] < SMS_QUIET_MS) start--;
  return all.slice(start);
}
/** May a send go now? `rung` is how many sends the run holds already; `waitMs` is how long until the next may go. */
export function decide(record, now) {
  const run = currentRun(record, now);
  if (run.length === 0) return { allowed: true, waitMs: 0, retryAt: now, rung: 0 };
  const last = run[run.length - 1], wait = SMS_LADDER_MS[Math.min(run.length, SMS_LADDER_MS.length) - 1], retryAt = last + wait;
  return { allowed: now >= retryAt, waitMs: Math.max(0, retryAt - now), retryAt, rung: run.length };
}
/** The record after a send at `now`: the run plus this send. Only after decide() allowed it. */
export function recordSend(record, now) {
  const sends = [...currentRun(record, now), now];
  return { sends, count: sends.length, lastAt: now, expireAt: now + SMS_RECORD_TTL_MS };
}
