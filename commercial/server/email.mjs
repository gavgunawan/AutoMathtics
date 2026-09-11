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
import { Fault, fail, object, text, equal, uuid } from './security.mjs';
import { normalizeProgress } from './progress.mjs';
import { maskAddress } from './mailer.mjs';

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
const TOKEN = /^v1\.([A-Za-z0-9_-]{1,2048})\.([A-Za-z0-9_-]{43})$/, UID = /^[A-Za-z0-9_-]{1,128}$/, KEYS = ['a', 'u', 'f', 'c', 'v', 'w', 'e'], DAY = 86_400_000;
const isUuid = (v) => { try { uuid(v); return true; } catch { return false; } };
/**
 * A button's token back to its payload: the signature first (constant time) and nothing parsed before it holds; then only what
 * this server signs passes, an action it knows, the value that action takes, a child for pace and focus, none for unsub, and an
 * expiry no later than the action allows. LINK_INVALID for all of that, LINK_EXPIRED once the expiry has passed.
 */
export function readEmailToken(secret, token, now) {
  const m = typeof token === 'string' ? TOKEN.exec(token) : null;
  if (!m || !equal(m[2], createHmac('sha256', linkKey(secret)).update(`v1.${m[1]}`).digest('base64url'))) fail(400, 'LINK_INVALID');
  let p = null; try { p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch { fail(400, 'LINK_INVALID'); }
  const days = p && typeof p === 'object' && !Array.isArray(p) ? LINK_ACTIONS[p.a] : undefined;
  if (!days || Object.keys(p).some((k) => !KEYS.includes(k)) || typeof p.u !== 'string' || !UID.test(p.u) || !isUuid(p.f) || typeof p.w !== 'string' || !/^\d{4}-W\d{2}$/.test(p.w) || !Number.isSafeInteger(p.e)) fail(400, 'LINK_INVALID');
  const value = p.a === 'pace' ? Number.isInteger(p.v) && p.v >= 10 && p.v <= 200 : p.a === 'focus' ? typeof p.v === 'boolean' : p.v === 'progress';
  if (!value || (p.a === 'unsub' ? p.c !== undefined : !isUuid(p.c)) || p.e > now + (days + 1) * DAY) fail(400, 'LINK_INVALID');
  if (p.e <= now) fail(410, 'LINK_EXPIRED');
  return p;
}
const done = (p, nickname) => (p.a === 'pace' ? `${nickname}’s question time is now ${p.v}%.` : p.a === 'focus' ? (p.v ? `${nickname}’s next System Scan focuses on the weak spots: about 75% of its questions.` : `${nickname}’s System Scan is back to the normal mix.`)
  : 'The weekly progress report is off. Switch it back on in Mission Control whenever you like.');
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

  // ---- the buttons in an email. A GET changes nothing anywhere: the button opens the app, which asks describe() what it does
  // and calls apply() only on the parent's tap, because link scanners and mail previews open every link they see.
  /** Is the token still about something real: the family (not deleted or being deleted), its owner the token's parent, the child still in it. Reads only. */
  async context(tx, p) {
    const family = await tx.get(`families/${p.f}`), member = await tx.get(`families/${p.f}/members/${p.u}`), parent = await tx.get(`parents/${p.u}`);
    const child = p.c ? await tx.get(`families/${p.f}/children/${p.c}`) : null, learning = p.c ? await tx.get(`families/${p.f}/learning/${p.c}`) : null, prefs = p.a === 'unsub' ? await tx.get(prefsPath(p.u)) : null;
    const live = !!family && family.deleted !== true && family.deletion?.status !== 'executing' && member?.role === 'owner' && member.status === 'active'
      && !!parent && parent.familyId === p.f && !parent.identityDeletion && parent.deleted !== true && (!p.c || (!!child && (family.childIds || []).includes(p.c)));
    return live ? { child, prog: p.c ? normalizeProgress(learning) : null, prefs } : null;
  }
  /** What the button will do, in the panel's words: { valid, action, nickname, value, current, email, reason }. Never changes anything. */
  async describe(body) {
    object(body, ['t']); let p;
    try { p = readEmailToken(this.secret, body.t, this.now()); }
    catch (error) { if (error instanceof Fault && error.status < 500) return { valid: false, reason: error.code === 'LINK_EXPIRED' ? 'expired' : 'invalid' }; throw error; }
    const view = await this.store.transaction(async (tx) => {
      const ctx = await this.context(tx, p); if (!ctx) return null;
      return { valid: true, action: p.a, nickname: ctx.child?.nickname || null, value: p.v, current: p.a === 'pace' ? ctx.prog.pacePercent : p.a === 'focus' ? ctx.prog.scanFocus === true : prefsOf(ctx.prefs).progress, email: null, reason: null };
    }, { readOnly: true });
    if (!view) return { valid: false, reason: 'gone' };
    if (p.a === 'unsub') { try { const user = await this.identity.lookup(p.u); view.email = user?.email ? maskAddress(user.email) : null; } catch { /* the panel says "for you" instead */ } }
    return view;
  }
  /** The parent tapped Confirm. The same checks as describe(), in the transaction that writes; a second tap sets the same value. */
  async apply(body) {
    object(body, ['t']); const p = readEmailToken(this.secret, body.t, this.now());
    return this.store.transaction(async (tx) => { const ctx = await this.context(tx, p); if (!ctx) fail(409, 'LINK_GONE'); return this.write(tx, p, ctx); });
  }
  /** RFC 8058 one-click: the mailbox provider's POST (http.mjs), the token its only authentication; it can switch the weekly report off and nothing else. */
  async unsubscribe(t) {
    const p = readEmailToken(this.secret, t, this.now()); if (p.a !== 'unsub') fail(400, 'LINK_INVALID');
    return this.store.transaction(async (tx) => { const ctx = await this.context(tx, p); if (!ctx) fail(409, 'LINK_GONE'); return this.write(tx, p, ctx); });
  }
  write(tx, p, ctx) {
    if (p.a !== 'unsub') tx.set(`families/${p.f}/learning/${p.c}`, { ...ctx.prog, ...(p.a === 'pace' ? { pacePercent: p.v } : { scanFocus: p.v }) });
    else if (prefsOf(ctx.prefs).progress !== false) tx.set(prefsPath(p.u), withChange(ctx.prefs, { progress: false }, 'email', this.now())); // already off: no second change row
    this.foundation.audit(tx, 'email.action_applied', p.u, p.f, p.c || null, { kind: p.a, week: p.w });
    return { ok: true, message: done(p, ctx.child?.nickname) };
  }
}
