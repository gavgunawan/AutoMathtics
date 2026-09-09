// The SMS resend ladder at the identity provider. Identity Platform asks this function before every verification
// SMS it would send for the v3 project — a parent enrolling a mobile, the second factor at sign-in — and sends
// nothing when it refuses. The rules are in ladder.mjs; the refusal reaches the browser as `SMS_WAIT:<seconds>`
// inside the provider's error, and public/auth.js turns it into "try again in …". Deployed and registered by
// scripts/cloudshell/06-sms-ladder.sh (DEPLOY_V3.md → section 5, block F). Nothing here reads or writes anything
// but the ladder's own records.
import { beforeSmsSent, HttpsError } from 'firebase-functions/v2/identity';
import { defineSecret, defineString } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { decide, ladderKey, recordSend } from './ladder.mjs';

const pepper = defineSecret('AM_V3_SMS_PEPPER');                    // Secret Manager; created by the deploy block
const runtimeAccount = defineString('SMS_LADDER_SERVICE_ACCOUNT');  // functions/.env.<project>: the v3 runtime account (Firestore access, nothing else)
const COLLECTION = 'smsLadder';
initializeApp();

export const smsLadder = beforeSmsSent({ region: 'asia-southeast1', serviceAccount: runtimeAccount, secrets: [pepper], memory: '256MiB', maxInstances: 3, timeoutSeconds: 7 }, async (event) => {
  const phone = event.additionalUserInfo?.phoneNumber || event.data?.phoneNumber || null;
  const key = ladderKey(pepper.value(), phone);
  if (!key) { console.warn(JSON.stringify({ smsLadder: 'no usable number on the event', smsType: event.smsType || null, hasPhone: !!phone })); return; } // the provider validates numbers itself; nothing to count
  const db = getFirestore(), ref = db.collection(COLLECTION).doc(key), now = Date.now();
  const verdict = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref), record = snap.exists ? snap.data() : null, v = decide(record, now);
    if (v.allowed) { const next = recordSend(record, now); tx.set(ref, { ...next, expireAt: new Date(next.expireAt) }); } // Firestore's TTL wants a timestamp
    return v;
  });
  if (!verdict.allowed) {
    console.info(JSON.stringify({ smsLadder: 'refused', rung: verdict.rung, waitSeconds: Math.ceil(verdict.waitMs / 1000), smsType: event.smsType || null }));
    throw new HttpsError('resource-exhausted', `SMS_WAIT:${Math.ceil(verdict.waitMs / 1000)}`); // no " : " in this text: the browser SDK splits the provider's message on it
  }
});
