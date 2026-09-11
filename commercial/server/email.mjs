// Email (email-v1, the owner's request of 11 Sep 2026): the parent's consent at sign-up and the email preferences behind
// Mission Control's switches. As everywhere else, the browser only sends choices; the server decides, records and audits.
//
// emailPrefs/{uid} = { progress, news, version, updatedAt, changes: [the last 20 of { at, progress, news, source }] }
//  • progress: the weekly progress report. With no record it is on: the report is part of the service the required sign-up box
//    describes, and every report carries its own way out.
//  • news: news and offers. With no record it is off: it needs a recorded yes. It is a separate, optional, unticked box because
//    consent made a condition of sign-up is not consent (Indonesia PDP Law 27/2022, Singapore PDPA s.14(2)(a), GDPR art. 7(4)).
//  • source: which door a change came through: 'signup' (the boxes), 'settings' (Mission Control), 'email' (a button in an email).
// The record belongs to the sign-in account, not to the family, and never holds the address: the address stays with the
// identity provider and is read when a report is sent. Deleting the sign-in account deletes the record (server/support.mjs).
import { createHmac } from 'node:crypto';
import { fail, object, text } from './security.mjs';

export const EMAIL_VERSION = 'email-v1';
// ---- the buttons in an email: v1.<base64url(json)>.<base64url(hmac-sha256)>, the payload { a: action, u: parent uid,
// f: family, c: child, v: value, w: ISO week, e: expiry }. The key is an HMAC of SESSION_SECRET under its own label, so a
// token can never pass for a session, a CSRF token or a pre-authentication cookie, all of which the same secret signs.
export const LINK_ACTIONS = Object.freeze({ focus: 14, pace: 14, unsub: 365 }); // how many days each kind of button works
const linkKey = (secret) => createHmac('sha256', secret).update('email-links-v1').digest();
export function signEmailToken(secret, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `v1.${body}.${createHmac('sha256', linkKey(secret)).update(`v1.${body}`).digest('base64url')}`;
}
const CHANGES_MAX = 20;
export const prefsPath = (uid) => `emailPrefs/${uid}`;
/** What the switches read: the record's state, or the defaults when none was ever written. */
export const prefsOf = (doc) => ({ progress: doc?.progress !== false, news: doc?.news === true });
/** The record after a change: the whole new state, and a row saying when, what and through which door. */
export function withChange(doc, patch, source, now) {
  const was = prefsOf(doc), state = { progress: typeof patch.progress === 'boolean' ? patch.progress : was.progress, news: typeof patch.news === 'boolean' ? patch.news : was.news };
  return { ...state, version: EMAIL_VERSION, updatedAt: now, changes: [...(Array.isArray(doc?.changes) ? doc.changes : []), { at: now, ...state, source }].slice(-CHANGES_MAX) };
}
const flags = (body, keys) => { for (const k of keys) if (body[k] !== undefined && typeof body[k] !== 'boolean') fail(400, 'INVALID_REQUEST'); };

export class Email {
  constructor({ foundation, store, identity, secret, now = Date.now }) { this.foundation = foundation; this.store = store; this.identity = identity; this.secret = secret; this.now = now; }
  /**
   * The sign-up boxes, recorded the moment the account exists: the browser posts the new account's own ID token right after the
   * provider created it. Only the token's signature is checked (no second factor exists yet, and this records the account's own
   * choice and nothing else), and only an absent record is written, so a second call, or anyone else holding the token, changes
   * nothing. parents/{uid} is never touched: login() creates it, in the shape it and authorize() expect.
   */
  async consent(body) {
    object(body, ['idToken', 'news']); text(body.idToken, 20, 8192); flags(body, ['news']);
    const uid = await this.identity.verifyUid(body.idToken); if (!uid) fail(401, 'INVALID_LOGIN');
    await this.store.transaction(async (tx) => {
      if (await tx.get(prefsPath(uid))) return; // recorded already: from here on the switches change it
      tx.set(prefsPath(uid), withChange(null, { progress: true, news: body.news === true }, 'signup', this.now()));
      this.foundation.audit(tx, 'email.consent_recorded', uid);
    });
    return { ok: true };
  }
  /** Mission Control's switches. A recent sign-in: a child at a remembered, open Mission Control must not switch the report off. */
  async setPrefs(ctx, body) {
    object(body, ['progress', 'news']); flags(body, ['progress', 'news']);
    if (body.progress === undefined && body.news === undefined) fail(400, 'INVALID_REQUEST');
    return this.store.transaction(async (tx) => {
      const { s } = await this.foundation.authorize(tx, ctx, ['parent'], false); this.foundation.requireRecent(s);
      const next = withChange(await tx.get(prefsPath(s.uid)), body, 'settings', this.now());
      tx.set(prefsPath(s.uid), next); this.foundation.audit(tx, 'email.prefs_changed', s.uid, s.familyId);
      return prefsOf(next);
    });
  }
}
