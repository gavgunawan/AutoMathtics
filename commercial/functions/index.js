// The SMS resend ladder at the identity provider. Identity Platform asks this function before every verification
// SMS it would send for the v3 project — a parent enrolling a mobile, the second factor at sign-in — and sends
// nothing when it refuses. The rules are in ladder.mjs; the refusal is thrown as `SMS_WAIT:<seconds>` inside the
// provider's error, and the browser counts a relayed refusal's seconds down on the Send button (public/auth.js,
// public/sms-schedule.js, which also carries a display-only copy of the ladder for when no seconds arrive). A relayed one arrives as
// auth/internal-error carrying "HTTP Cloud Function returned an error … Message: …". No refusal has yet been seen
// at a browser: the bare auth/internal-error-encountered. of 10 Sep 2026 belongs to the send this function
// ALLOWED at 03:36:53Z (HTTP 200, rung 1), and decodes to the provider's own generic "Internal error
// encountered." — the provider failing, not our refusal being mistranslated. Whether a beforeSmsSent refusal is
// relayed at all is untested, so public/app.js (providerMessage) also answers a refusal it cannot read.
// Deployed and registered by
// scripts/cloudshell/06-sms-ladder.sh (DEPLOY_V3.md → section 5, block F). Nothing here reads or writes anything
// but the ladder's own records.
//
// Two failure postures, deliberately different. The ladder is abuse protection, not access control: when the
// infrastructure lets it down — Firestore slow or unreachable, the transaction past its deadline — the SMS is
// ALLOWED and one log line says so, because a parent locked out of sign-in by a hiccup in a rate limiter is the
// worse outcome, and the provider's own quota and region policy still stand underneath. A missing pepper is not
// a hiccup but a broken deploy, and it fails CLOSED at once so that it is noticed on the first SMS, not months later.
import { beforeSmsSent, HttpsError } from 'firebase-functions/v2/identity';
import { defineSecret, defineString } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { decide, ladderKey, recordSend } from './ladder.mjs';

const pepper = defineSecret('AM_V3_SMS_PEPPER');                    // Secret Manager; created by the deploy block
// functions/.env.<project>: the ladder's own service account, holding Firestore and this one secret and nothing else.
// Not the v3 runtime account: that one carries firebaseauth.admin and every server secret, which a function
// reachable through the identity provider has no business holding (06-sms-ladder.sh creates and grants it).
const ladderAccount = defineString('SMS_LADDER_SERVICE_ACCOUNT');
const COLLECTION = 'smsLadder';
// Identity Platform waits 7 s for a blocking function (timeoutSeconds below is that ceiling) and treats silence as
// an error. So: no write may start after DEADLINE_MS — a commit that lands after the provider has given up would
// count a code that was never sent, and refuse the parent's genuine retry — and the whole transaction is raced
// against ANSWER_BY_MS so the answer leaves with a second to spare for the response itself.
const DEADLINE_MS = 4000, ANSWER_BY_MS = 6000;
class DeadlineError extends Error { constructor(ms) { super(`past the deadline after ${ms} ms`); this.name = 'DeadlineError'; } }
initializeApp();

/** `run()` raced against the clock: rejects with a DeadlineError ANSWER_BY_MS after `started`, whatever `run` is still doing. */
function withinDeadline(started, run) {
  let timer;
  const clock = new Promise((_, reject) => { timer = setTimeout(() => reject(new DeadlineError(Date.now() - started)), Math.max(0, ANSWER_BY_MS - (Date.now() - started))); });
  return Promise.race([run(), clock]).finally(() => clearTimeout(timer)); // race() subscribes to both, so the loser's late rejection is never unhandled
}
/** One short reason for the log line: 'deadline', or the Firestore code and message, never a stack. */
const reasonOf = (err) => (err instanceof DeadlineError ? 'deadline' : `${err?.code ?? err?.name ?? 'error'}: ${String(err?.message ?? err)}`.slice(0, 200));

export const smsLadder = beforeSmsSent({ region: 'asia-southeast1', serviceAccount: ladderAccount, secrets: [pepper], memory: '256MiB', maxInstances: 3, timeoutSeconds: 7 }, async (event) => {
  const started = Date.now(), secret = pepper.value();
  if (typeof secret !== 'string' || secret.length < 16) { // ladderKey() would quietly return null for every number and the ladder would count nothing: fail closed instead
    console.error(JSON.stringify({ smsLadder: 'misconfigured', reason: 'no pepper' }));
    throw new HttpsError('internal', 'SMS_LADDER_MISCONFIGURED');
  }
  const phone = event.additionalUserInfo?.phoneNumber || event.data?.phoneNumber || null;
  const key = ladderKey(secret, phone);
  if (!key) { console.warn(JSON.stringify({ smsLadder: 'no usable number on the event', smsType: event.smsType || null, hasPhone: !!phone })); return; } // the provider validates numbers itself; nothing to count
  const db = getFirestore(), ref = db.collection(COLLECTION).doc(key);
  let verdict;
  try {
    verdict = await withinDeadline(started, () => db.runTransaction(async (tx) => {
      const snap = await tx.get(ref), record = snap.exists ? snap.data() : null, now = Date.now(), v = decide(record, now); // `now` inside: a retried attempt counts from its own clock
      if (v.allowed) {
        const elapsed = Date.now() - started;
        if (elapsed > DEADLINE_MS) throw new DeadlineError(elapsed); // before the write, so nothing is queued for a commit that may land late
        const next = recordSend(record, now); tx.set(ref, { ...next, expireAt: new Date(next.expireAt) }); // Firestore's TTL wants a timestamp
      }
      return v;
    }));
  } catch (err) { // the deadline, a Firestore error, anything the infrastructure did: allow, and say so in one line
    console.warn(JSON.stringify({ smsLadder: 'allowed-on-error', reason: reasonOf(err), ms: Date.now() - started }));
    return;
  }
  if (verdict.allowed) console.info(JSON.stringify({ smsLadder: 'allowed', rung: verdict.rung, smsType: event.smsType || null, ms: Date.now() - started })); // the request log alone says nothing about what was asked
  if (!verdict.allowed) {
    console.info(JSON.stringify({ smsLadder: 'refused', rung: verdict.rung, waitSeconds: Math.ceil(verdict.waitMs / 1000), smsType: event.smsType || null }));
    throw new HttpsError('resource-exhausted', `SMS_WAIT:${Math.ceil(verdict.waitMs / 1000)}`); // no " : " in this text: the browser SDK splits the provider's message on it
  }
});
