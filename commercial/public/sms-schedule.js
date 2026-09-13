// The browser's copy of the SMS resend ladder (functions/ladder.mjs), for display only: the blocking function at
// the identity provider is the authority and refuses on its own records. The browser keeps this copy because a
// refusal relayed with its seconds has never been seen at a browser, so without it a parent could not be shown
// how long to wait. The table is duplicated rather than shared because the function deploys from functions/
// alone; tests/sms-ladder.test.mjs fails the moment the two tables or their rules differ.
// Pure: no storage and no clock of its own, so the unit tests run it as it ships.
const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
/** The wait after the n-th send of a run (index n − 1) before the next may go; the last entry repeats. */
export const SMS_LADDER_MS = Object.freeze([5 * SECOND, 5 * SECOND, 2 * MINUTE, 15 * MINUTE, HOUR, 6 * HOUR, 12 * HOUR, DAY]);
export const SMS_QUIET_MS = DAY; // this long without a code ends the run

/** The current run at `now`, oldest first: the same rule as functions/ladder.mjs currentRun(), over a bare list of send times. */
export function currentRun(sends, now) {
  const all = (Array.isArray(sends) ? sends : []).filter((t) => Number.isSafeInteger(t) && t <= now).sort((a, b) => a - b);
  let start = all.length;
  while (start > 0 && (start === all.length ? now : all[start]) - all[start - 1] < SMS_QUIET_MS) start--;
  return all.slice(start);
}
/** When the next code may go, as a timestamp: at or before `now` means now. */
export function nextSendAt(sends, now) {
  const run = currentRun(sends, now);
  if (!run.length) return now;
  return run[run.length - 1] + SMS_LADDER_MS[Math.min(run.length, SMS_LADDER_MS.length) - 1];
}
/** The list to keep after a send at `now`: the run plus this send, so the device never holds more than a run. */
export function withSend(sends, now) { return [...currentRun(sends, now), now]; }
/**
 * The seconds a refusal from the ladder carries, or null. The function throws SMS_WAIT:<seconds>, and the browser
 * SDK delivers it in one of two shapes because it splits the provider's string on " : ": with that separator the
 * payload lands intact in error.message under auth/internal-error; without it the whole string is folded into
 * the code, lowercased with underscores turned into dashes — so SMS_WAIT:729 arrives as the code sms-wait:729.
 */
export function refusalSeconds(error) {
  const wait = /sms[_-]wait:(\d+)/i.exec(`${error?.code || ''} ${error?.message || ''}`);
  return wait && Number(wait[1]) > 0 ? Math.min(Number(wait[1]), Math.max(...SMS_LADDER_MS) / SECOND) : null; // never past the longest rung
}
/**
 * A failed send that may be the ladder's refusal with its seconds lost on the way, or a send the ladder allowed that
 * the provider then failed: a relayed resource-exhausted, or the provider's internal error with nothing readable in
 * it — auth/internal-error, or auth/internal-error-encountered. of 10 Sep. Either way no code reached the parent, so
 * the caller holds the shortest rung rather than spending one: the function keeps the count that decides.
 */
export function possibleRefusal(error) {
  const code = String(error?.code || ''), message = String(error?.message || '');
  if (/resource[-_ ]exhausted/i.test(`${code} ${message}`)) return true;
  const text = message.replace(/^Firebase:\s*/, '').replace(/\s*\(auth\/[^)]+\)\.?$/, '').replace(/^Error\.?$/, '').trim();
  return /^auth\/internal-error/.test(code) && !text;
}
