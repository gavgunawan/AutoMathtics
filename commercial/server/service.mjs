import { randomUUID } from 'node:crypto';
import { Fault, fail, sha256, mac, randomToken, object, text, uuid, pin, childInput, startInput, publicChild } from './security.mjs';
import { initialProgress, normalizeProgress } from './progress.mjs';
import { effectiveEntitlement } from './subscription.mjs';
import { recoveryView } from './recovery.mjs';

const MINUTE = 60_000, DAY = 24 * 60 * MINUTE;
const FAMILY_LIMIT = 20; // Pilot safety cap, independent of paid seat count.
const AUDIT_RETENTION_MS = 400 * DAY, OPERATION_RETENTION_MS = DAY;
export const DEFAULT_TIME_ZONE = 'Asia/Singapore'; // the family's calendar day for streaks; parent-editable later
const sessionKey = (token) => /^[A-Za-z0-9_-]{43}$/.test(token || '') ? sha256(token) : null;

/**
 * Store contract: transaction(fn), get(path). Transaction supports get, set, delete;
 * all reads precede writes; exceptions roll back every write. Firebase Admin and
 * the serial in-memory test double implement the same contract.
 * Identity contract: verifyLogin(idToken, now), recheck(session).
 * No browser-supplied identity, role, family ID, verification flags or allowance
 * enter this service. Its public methods receive only a server-authenticated ctx.
 */
export class Foundation {
  constructor({ store, identity, hasher, secret, now = Date.now }) {
    this.store = store; this.identity = identity; this.hasher = hasher;
    this.secret = secret; this.now = now;
  }
  // Audit rows expire after AUDIT_RETENTION_MS through the Firestore TTL policy on `expireAt`.
  audit(tx, action, uid, familyId = null, childId = null) {
    tx.set(`audit/${randomUUID()}`, { action, uid, familyId, childId, at: this.now(), expireAt: this.now() + AUDIT_RETENTION_MS });
  }
  // Throttle inside an existing transaction, after authorization has been read, so an
  // unauthorized caller cannot spend a family's budget. The read happens now; the returned
  // thunk performs the write, so callers keep every read ahead of every write.
  async rateIn(tx, bucket, maximum, windowMs) {
    const path = `rateLimits/${mac(this.secret, bucket)}`;
    const old = await tx.get(path), now = this.now();
    const next = old && old.until > now ? { ...old } : { count: 0, until: now + windowMs, expireAt: now + windowMs };
    if (next.count >= maximum) fail(429, 'TOO_MANY_ATTEMPTS');
    next.count++;
    return () => tx.set(path, next);
  }
  async rate(bucket, maximum, windowMs) {
    return this.store.transaction(async (tx) => (await this.rateIn(tx, bucket, maximum, windowMs))());
  }
  // Refuse when a bucket is already full without spending it. Login pairs this with rate() on
  // failure only, so honest sign-ins never consume an address's failure budget.
  async peek(bucket, maximum) {
    const old = await this.store.get(`rateLimits/${mac(this.secret, bucket)}`);
    if (old && old.until > this.now() && old.count >= maximum) fail(429, 'TOO_MANY_ATTEMPTS');
  }
  async authenticate(token) {
    const key = sessionKey(token);
    if (!key) fail(401, 'SIGN_IN_REQUIRED');
    const session = await this.store.get(`sessions/${key}`);
    if (!session || session.expiresAt <= this.now()) fail(401, 'SIGN_IN_REQUIRED');
    await this.identity.recheck(session);
    return { key, uid: session.uid };
  }
  async authorize(tx, ctx, roles, needFamily = true, { allowRevokedChild = false } = {}) {
    const s = await tx.get(`sessions/${ctx.key}`);
    if (!s || s.uid !== ctx.uid || s.expiresAt <= this.now()) fail(401, 'SIGN_IN_REQUIRED');
    if (!roles.includes(s.role)) fail(403, 'PARENT_REQUIRED');
    const parent = await tx.get(`parents/${s.uid}`);
    if (!parent) fail(403, 'ACCESS_DENIED');
    if (parent.identityDeletion) fail(403, 'ACCOUNT_DELETED'); // Stage 4.0: the parent asked for the sign-in account to go; whatever the provider did since, no session of it works
    // The parent record moved on (a family was created from another session), so this session
    // is superseded rather than forbidden: send the device back to sign-in instead of stranding it.
    if (parent.familyId !== s.familyId) fail(401, 'SIGN_IN_REQUIRED');
    if (!s.familyId) {
      if (needFamily) fail(409, 'CREATE_FAMILY_FIRST');
      return { s, parent, family: null };
    }
    const member = await tx.get(`families/${s.familyId}/members/${s.uid}`);
    const family = await tx.get(`families/${s.familyId}`);
    if (!member || member.role !== 'owner' || member.status !== 'active' || !family) fail(403, 'ACCESS_DENIED');
    if (family.deleted === true || family.deletion?.status === 'executing') fail(403, 'FAMILY_DELETED'); // a tombstone, or a deletion under way, admits nobody (Stage 3.5)
    if (s.role !== 'child' || allowRevokedChild) return { s, parent, family };
    // A child session is only as good as its child: active, entitled, and holding the current
    // PIN version. This lives here, not in the routes, so no future route can forget it.
    const child = await tx.get(`families/${s.familyId}/children/${s.childId}`);
    const credential = await tx.get(`families/${s.familyId}/credentials/${s.childId}`);
    this.entitlement(family, s.childId);
    if (!child || child.status !== 'active' || !credential || credential.version !== s.pinVersion) fail(401, 'CHILD_SESSION_REVOKED');
    return { s, parent, family, child, credential };
  }
  requireRecent(s) {
    if (s.authTime * 1000 < this.now() - 5 * MINUTE) fail(403, 'REAUTHENTICATE');
  }
  // A subscription (Stage 3.2) wins over a manual pilot grant; its state is derived from its facts and the clock.
  entitlement(family, childId = null) {
    const e = effectiveEntitlement(family, this.now());
    if (!e || e.status !== 'active' || !Number.isSafeInteger(e.accessUntil) || e.accessUntil <= this.now()) fail(403, 'SUBSCRIPTION_INACTIVE');
    if (!Number.isInteger(e.seatLimit) || e.seatLimit < 1 || e.seatLimit > FAMILY_LIMIT ||
        !Array.isArray(family.activeChildIds) || family.activeChildIds.length > e.seatLimit) fail(403, 'ACCESS_DENIED');
    if (childId && !family.activeChildIds.includes(childId)) fail(403, 'CHILD_INACTIVE');
    return e;
  }
  async login(idToken, previousToken) {
    text(idToken, 20, 8192);
    // The token's signature is verified locally first; the account throttle then runs on the proven
    // uid before the single fresh Auth lookup (review finding S1B-A).
    const { phone, ...who } = await this.identity.verifyLogin(idToken, this.now(),
      (uid) => this.rate(`login:${uid}`, 10, 10 * MINUTE));
    // The parent's verified phone, keyed and never stored raw. A parent who signs up again with a
    // new email keeps the same phoneKey, which is how a free trial can be granted once per phone.
    const phoneKey = phone ? mac(this.secret, `phone:${phone}`) : null;
    const token = randomToken(), key = sha256(token), oldKey = sessionKey(previousToken);
    await this.store.transaction(async (tx) => {
      const path = `parents/${who.uid}`;
      const parent = await tx.get(path);
      const old = oldKey ? await tx.get(`sessions/${oldKey}`) : null;
      const family = parent?.familyId ? await tx.get(`families/${parent.familyId}`) : null;
      const recovery = await tx.get(`recoveries/${who.uid}`);
      // Stage 4.0: the deletion of the sign-in account was asked for. If the provider failed to delete the identity the
      // parent can still mint a token; this door stays shut until the operator's retry removes the identity for good.
      if (parent?.identityDeletion) fail(403, 'ACCOUNT_DELETED');
      // Also blocks a copied pre-handover ID token presented with a new cookie.
      if (parent && who.authTime <= (parent.reauthAfter || 0)) fail(403, 'REAUTHENTICATE');
      // Stage 3.5: a family being deleted, or deleted, gets no new session at all — the sweep must find none (after the tombstone the parent record points at no family, so a returning parent signs in and starts fresh)
      if (family && (family.deleted === true || family.deletion?.status === 'executing')) fail(403, 'FAMILY_DELETED');
      const s = { ...who, familyId: parent?.familyId || null, role: 'parent', childId: null,
        csrf: randomToken(), createdAt: this.now(), expiresAt: this.now() + 30 * MINUTE, expireAt: this.now() + 30 * MINUTE };
      if (!parent) tx.set(path, { familyId: null, reauthAfter: 0, createdAt: this.now(), phoneKey });
      else if (parent.phoneKey !== phoneKey) tx.set(path, { ...parent, phoneKey });
      if (old) tx.delete(`sessions/${oldKey}`);
      tx.set(`sessions/${key}`, s);
      this.audit(tx, 'parent.signed_in', who.uid, s.familyId);
      // Stage 4.4: a full sign-in during a recovery's waiting period is the owner saying "I still have my phone":
      // the request is cancelled here and a notice waits for them (RECOVERY.md)
      if (recovery && recovery.status === 'pending') { tx.set(`recoveries/${who.uid}`, { ...recovery, status: 'cancelled_by_sign_in', cancelledAt: this.now(), cancelledBy: who.uid }); this.audit(tx, 'parent.recovery_cancelled', who.uid, s.familyId); }
    });
    return token;
  }
  async me(ctx) {
    return this.store.transaction(async (tx) => {
      const { s, family, child } = await this.authorize(tx, ctx, ['parent', 'selector', 'child'], false);
      if (s.role === 'child') return { role: 'child', csrf: s.csrf, child: publicChild(child) };
      const children = [];
      for (const id of family?.childIds || []) {
        const c = await tx.get(`families/${s.familyId}/children/${id}`);
        if (c) children.push(publicChild(c));
      }
      const recovery = s.role === 'parent' ? recoveryView(await tx.get(`recoveries/${s.uid}`), this.now()) : null; // Stage 4.4: a finished request is shown until acknowledged
      return { role: s.role, csrf: s.csrf, ...(s.role === 'parent' ? { parent: { uid: s.uid }, recovery } : {}), family: family ? {
        id: family.id, label: family.label, children,
        ...(s.role === 'parent' ? { entitlement: effectiveEntitlement(family, this.now()), activeCount: family.activeChildIds.length, deletion: family.deletion ? { requestedAt: family.deletion.requestedAt, effectiveAt: family.deletion.effectiveAt } : null } : {}),
      } : null };
    }, { readOnly: true });
  }
  async createFamily(ctx, body) {
    object(body, ['label', 'adultAttestation', 'consentVersion']);
    const label = text(body.label, 1, 40).normalize('NFC').trim();
    if (!label || body.adultAttestation !== true || body.consentVersion !== 'pilot-v1') fail(400, 'CONSENT_REQUIRED');
    const familyId = randomUUID();
    return this.store.transaction(async (tx) => {
      const { s, parent } = await this.authorize(tx, ctx, ['parent'], false);
      this.requireRecent(s);
      // Every family made under this phone, in order. Trials and abuse checks read this ledger;
      // nothing ever moves a child or their progress between the families it lists.
      const ledgerPath = parent.phoneKey ? `phones/${parent.phoneKey}` : null;
      const ledger = ledgerPath ? await tx.get(ledgerPath) : null;
      if (parent.familyId) return { id: parent.familyId, token: null }; // Existing family; no boundary change.
      tx.set(`families/${familyId}`, { id: familyId, label, childIds: [], activeChildIds: [], createdAt: this.now(), timeZone: DEFAULT_TIME_ZONE, phoneKey: parent.phoneKey || null,
        entitlement: { status: 'inactive', seatLimit: 0, accessUntil: 0, version: 0, source: 'manual' } });
      // Merge, never replace: the ledger also carries trialFamilyId/trialAt, and a second family must not reset them.
      if (ledgerPath) tx.set(ledgerPath, { ...(ledger || {}), families: [...(ledger?.families || []), familyId], count: (ledger?.count || 0) + 1, firstAt: ledger?.firstAt || this.now(), lastAt: this.now() });
      tx.set(`families/${familyId}/members/${s.uid}`, { role: 'owner', status: 'active' });
      tx.set(`parents/${s.uid}`, { ...parent, familyId, consentVersion: 'pilot-v1', attestedAt: this.now() });
      const token = this.rotateSession(tx, ctx, s, { familyId });
      this.audit(tx, 'family.created', s.uid, familyId);
      return { id: familyId, token };
    });
  }
  async createChild(ctx, body, requestId) {
    const input = childInput(body); uuid(requestId);
    const initial = await this.store.transaction(async (tx) => {
      const authorized = await this.authorize(tx, ctx, ['parent']);
      (await this.rateIn(tx, `child-create:${ctx.uid}`, 10, MINUTE))();
      return authorized;
    });
    this.requireRecent(initial.s);
    const seats = this.entitlement(initial.family).seatLimit; // the effective entitlement (a subscription, or the manual grant)
    const familyId = initial.s.familyId, childId = randomUUID();
    // The replay record commits to the profile, never to the PIN in any form: the browser mints
    // a new request id whenever any field changes, so a PIN-only edit is a new request anyway.
    const fingerprint = mac(this.secret, JSON.stringify({ nickname: input.nickname, icon: input.icon, age: input.age, yearLevel: input.yearLevel, start: input.start }));
    const opPath = `families/${familyId}/operations/${requestId}`;
    const existing = await this.store.get(opPath);
    if (existing) {
      if (existing.uid !== ctx.uid || existing.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT');
      return { child: existing.child };
    }
    if (initial.family.activeChildIds.length >= seats) fail(409, 'CHILD_LIMIT_REACHED');
    if (initial.family.childIds.length >= FAMILY_LIMIT) fail(409, 'PILOT_PROFILE_LIMIT');
    const hash = await this.hasher.hash(familyId, childId, input.pin);
    return this.store.transaction(async (tx) => {
      const { s, family } = await this.authorize(tx, ctx, ['parent']);
      this.requireRecent(s);
      const e = this.entitlement(family);
      const op = await tx.get(opPath);
      if (op) {
        if (op.uid !== ctx.uid || op.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT');
        return { child: op.child };
      }
      if (family.activeChildIds.length >= e.seatLimit) fail(409, 'CHILD_LIMIT_REACHED');
      if (family.childIds.length >= FAMILY_LIMIT) fail(409, 'PILOT_PROFILE_LIMIT');
      // Demographics (age, primary year) are kept on the profile for the business backend; the start option decides the first papers.
      const child = { id: childId, nickname: input.nickname, icon: input.icon, status: 'active', createdAt: this.now(),
        demographics: { age: input.age, yearLevel: input.yearLevel, recordedAt: this.now() }, start: { option: input.start, yearLevel: input.yearLevel, chosenAt: this.now() } };
      tx.set(`families/${familyId}`, { ...family, childIds: [...family.childIds, childId], activeChildIds: [...family.activeChildIds, childId] });
      tx.set(`families/${familyId}/children/${childId}`, child);
      if (input.start !== 'a1') tx.set(`families/${familyId}/learning/${childId}`, initialProgress(input, this.now()));
      tx.set(`families/${familyId}/credentials/${childId}`, { hash, version: 1 });
      tx.set(opPath, { uid: ctx.uid, fingerprint, child: publicChild(child), at: this.now(), expireAt: this.now() + OPERATION_RETENTION_MS });
      this.audit(tx, 'child.created', s.uid, familyId, childId);
      return { child: publicChild(child) };
    });
  }
  // Internal helper: call only after the transaction has read all authorization state.
  // Never mutate ctx or return a raw cookie through the JSON API.
  rotateSession(tx, ctx, session, changes) {
    const token = randomToken();
    tx.delete(`sessions/${ctx.key}`);
    const next = { ...session, ...changes, csrf: randomToken() };
    next.expireAt = next.expiresAt; // the TTL follows the session's own expiry
    tx.set(`sessions/${sha256(token)}`, next);
    return token;
  }
  async lock(ctx) {
    return this.store.transaction(async (tx) => {
      const { s, parent } = await this.authorize(tx, ctx, ['parent']);
      const token = this.rotateSession(tx, ctx, s, {
        role: 'selector', childId: null, pinVersion: null, expiresAt: this.now() + 12 * 60 * MINUTE,
      });
      tx.set(`parents/${s.uid}`, { ...parent, reauthAfter: Math.max(parent.reauthAfter || 0, s.authTime, Math.floor(this.now() / 1000)) });
      this.audit(tx, 'session.child_mode', s.uid, s.familyId);
      return token;
    });
  }
  async selector(ctx) {
    return this.store.transaction(async (tx) => {
      const { s } = await this.authorize(tx, ctx, ['child', 'selector'], true, { allowRevokedChild: true });
      // This downgrade also lets a PIN-revoked child session return to selection.
      // It does not grant another child's access; a current PIN is still required.
      const token = this.rotateSession(tx, ctx, s, { role: 'selector', childId: null, pinVersion: null });
      this.audit(tx, 'session.selector', s.uid, s.familyId);
      return token;
    });
  }
  async releasePinReservation(path, ticket) {
    // Refund ONLY this request's reservation. A reset/new window removes old tickets,
    // so late cleanup cannot erase someone else's failures or a newly-created budget.
    await this.store.transaction(async (tx) => {
      const current = await tx.get(path);
      if (!current?.pending?.[ticket]) return;
      const pending = { ...current.pending }; delete pending[ticket];
      const count = Math.max(0, current.count - 1);
      if (!count) tx.delete(path);
      else tx.set(path, { ...current, pending, count });
    });
  }
  async selectChild(ctx, childId, code) {
    uuid(childId); pin(code);
    const ticket = randomUUID();
    const state = await this.store.transaction(async (tx) => {
      const { s, family } = await this.authorize(tx, ctx, ['selector']);
      const commitRate = await this.rateIn(tx, `pin-family:${ctx.uid}`, 30, 15 * MINUTE);
      const child = await tx.get(`families/${s.familyId}/children/${childId}`);
      const credential = await tx.get(`families/${s.familyId}/credentials/${childId}`);
      const attemptPath = `families/${s.familyId}/pinAttempts/${childId}`;
      const prior = await tx.get(attemptPath);
      if (!child || !credential) fail(404, 'CHILD_NOT_FOUND');
      this.entitlement(family, childId);
      if (child.status !== 'active') fail(403, 'CHILD_INACTIVE');
      // count = completed wrong checks + pending reservations. Pending checks cannot
      // overrun the five-check budget, but a busy/unavailable hasher is not a wrong PIN.
      const attempts = prior && prior.until > this.now() ? { ...prior, pending: { ...prior.pending } }
        : { count: 0, until: this.now() + 15 * MINUTE, expireAt: this.now() + 15 * MINUTE, pending: {} };
      if (attempts.count >= 5) {
        const failed = attempts.count - Object.keys(attempts.pending).length;
        fail(429, failed >= 5 ? 'PIN_LOCKED' : 'PIN_SERVICE_BUSY');
      }
      attempts.count++; attempts.pending[ticket] = true;
      delete attempts.ticket; // old local-pilot record format
      commitRate();
      tx.set(attemptPath, attempts);
      return { s, credential, attemptPath };
    });
    try {
      const correct = await this.hasher.verify(state.s.familyId, childId, code, state.credential.hash);
      // A correct PIN stored under a retired pepper or the unnamed legacy format is re-hashed
      // now, while the code is in hand; the version stays, so the child's sessions survive.
      const fresh = correct && this.hasher.needsRehash && this.hasher.needsRehash(state.credential.hash)
        ? await this.hasher.hash(state.s.familyId, childId, code) : null;
      const next = await this.store.transaction(async (tx) => {
        const { s, family } = await this.authorize(tx, ctx, ['selector']);
        const child = await tx.get(`families/${s.familyId}/children/${childId}`);
        const current = await tx.get(`families/${s.familyId}/credentials/${childId}`);
        const attempts = await tx.get(state.attemptPath);
        this.entitlement(family, childId);
        if (!child || child.status !== 'active') fail(403, 'CHILD_INACTIVE');
        if (!current || current.version !== state.credential.version || current.hash !== state.credential.hash) fail(409, 'PIN_CHANGED_RETRY');
        // Never authenticate from a stale verification whose reservation has expired
        // or disappeared. A reset, timeout or replaced window must start a new check.
        if (!attempts?.pending?.[ticket] || attempts.until <= this.now()) fail(409, 'PIN_CHECK_EXPIRED');
        const pending = { ...attempts.pending }; delete pending[ticket];
        if (correct) {
          // A correct proof clears completed failures, NOT other in-flight requests.
          const count = Object.keys(pending).length;
          if (count) tx.set(state.attemptPath, { ...attempts, pending, count });
          else tx.delete(state.attemptPath);
          if (fresh) tx.set(`families/${s.familyId}/credentials/${childId}`, { ...current, hash: fresh });
          const token = this.rotateSession(tx, ctx, s, { role: 'child', childId, pinVersion: current.version });
          this.audit(tx, 'child.signed_in', s.uid, s.familyId, childId);
          return token;
        }
        tx.set(state.attemptPath, { ...attempts, pending });
        this.audit(tx, 'child.pin_failed', s.uid, s.familyId, childId);
        return null;
      });
      if (!correct) fail(401, 'INCORRECT_PIN');
      return next;
    } catch (error) {
      // Cleanup itself must commit. On database failure we fail closed; an unreleased
      // reservation can persist until its 15-minute window ends, never grant access.
      await this.releasePinReservation(state.attemptPath, ticket);
      throw error;
    }
  }
  /** The parent changes where a child starts — only before the child has played anything (a pending placement test included). */
  async setChildStart(ctx, childId, body) {
    uuid(childId); object(body, ['start', 'yearLevel']);
    return this.store.transaction(async (tx) => {
      const { s, family } = await this.authorize(tx, ctx, ['parent']); this.requireRecent(s);
      if (!family.childIds.includes(childId)) fail(404, 'CHILD_NOT_FOUND');
      const child = await tx.get(`families/${s.familyId}/children/${childId}`), prog = normalizeProgress(await tx.get(`families/${s.familyId}/learning/${childId}`));
      if (!child) fail(404, 'CHILD_NOT_FOUND');
      if (prog.stats.sessions > 0 || prog.activeSession || prog.history.length > 0) fail(409, 'ALREADY_STARTED'); // a quit session is play too
      const chosen = startInput({ yearLevel: body.yearLevel ?? child.demographics?.yearLevel ?? null, start: body.start });
      const next = initialProgress(chosen, this.now());
      tx.set(`families/${s.familyId}/learning/${childId}`, { ...next, wallet: prog.wallet, pacePercent: prog.pacePercent, passDays: prog.passDays }); // whatever the wallet holds, the pace the parent set and the days already passed stay
      tx.set(`families/${s.familyId}/children/${childId}`, { ...child, demographics: { ...(child.demographics || {}), yearLevel: chosen.yearLevel }, start: { option: chosen.start, yearLevel: chosen.yearLevel, chosenAt: this.now() } });
      this.audit(tx, 'child.start_changed', s.uid, s.familyId, childId);
      return { child: publicChild({ ...child, start: { option: chosen.start }, demographics: { yearLevel: chosen.yearLevel } }), placement: next.placement };
    });
  }
  async resetPin(ctx, childId, code) {
    uuid(childId); pin(code);
    const first = await this.store.transaction(async (tx) => {
      const authorized = await this.authorize(tx, ctx, ['parent']);
      this.requireRecent(authorized.s);
      const commitRate = await this.rateIn(tx, `pin-reset:${ctx.uid}`, 5, MINUTE);
      const old = await tx.get(`families/${authorized.s.familyId}/credentials/${childId}`);
      if (!old) fail(404, 'CHILD_NOT_FOUND');
      commitRate();
      return authorized;
    });
    const hash = await this.hasher.hash(first.s.familyId, childId, code);
    await this.store.transaction(async (tx) => {
      const { s } = await this.authorize(tx, ctx, ['parent']); this.requireRecent(s);
      const path = `families/${s.familyId}/credentials/${childId}`;
      const old = await tx.get(path);
      if (!old) fail(404, 'CHILD_NOT_FOUND');
      tx.set(path, { hash, version: old.version + 1 });
      tx.delete(`families/${s.familyId}/pinAttempts/${childId}`);
      this.audit(tx, 'child.pin_reset', s.uid, s.familyId, childId);
    });
  }
  async logout(ctx) {
    await this.store.transaction(async (tx) => {
      const s = await tx.get(`sessions/${ctx.key}`);
      const parent = s ? await tx.get(`parents/${s.uid}`) : null;
      if (s) {
        tx.delete(`sessions/${ctx.key}`);
        // Only a parent session ending is a re-auth boundary; a child or selector cookie ends itself only.
        if (parent && s.role === 'parent') tx.set(`parents/${s.uid}`, { ...parent, reauthAfter: Math.max(parent.reauthAfter || 0, s.authTime, Math.floor(this.now() / 1000)) });
        this.audit(tx, 'session.signed_out', s.uid, s.familyId);
      }
    });
  }
}

/** Staff/CLI-only. There is deliberately NO HTTP route or browser admin PIN. */
export async function grantEntitlement(store, { familyId, seatLimit, accessUntil, keepChildIds, reason, actor }, now = Date.now()) {
  uuid(familyId); text(reason, 5, 200); text(actor, 3, 200);
  if (!Number.isInteger(seatLimit) || seatLimit < 0 || seatLimit > FAMILY_LIMIT ||
      !Number.isSafeInteger(accessUntil) || accessUntil < 0) fail(400, 'INVALID_ENTITLEMENT');
  if (keepChildIds !== undefined && (!Array.isArray(keepChildIds) || new Set(keepChildIds).size !== keepChildIds.length)) fail(400, 'INVALID_SEAT_SELECTION');
  for (const id of keepChildIds || []) uuid(id);
  return store.transaction(async (tx) => {
    const path = `families/${familyId}`, family = await tx.get(path);
    if (!family) fail(404, 'FAMILY_NOT_FOUND');
    if (family.subscription) fail(409, 'SUBSCRIPTION_MANAGED'); // a subscribed family's seats come from its subscription events
    const active = keepChildIds ?? family.activeChildIds;
    if (active.length > seatLimit || active.some((id) => !family.childIds.includes(id))) fail(409, 'SELECT_CHILDREN_FOR_DOWNGRADE');
    const children = [];
    for (const id of family.childIds) children.push(await tx.get(`${path}/children/${id}`));
    const entitlement = { seatLimit, accessUntil, status: seatLimit && accessUntil > now ? 'active' : 'inactive',
      version: family.entitlement.version + 1, source: 'manual' };
    tx.set(path, { ...family, activeChildIds: active, entitlement });
    for (const child of children) if (child) tx.set(`${path}/children/${child.id}`, { ...child, status: active.includes(child.id) ? 'active' : 'inactive' });
    tx.set(`audit/${randomUUID()}`, { action: 'entitlement.granted', familyId, actor, reason, entitlement, at: now, expireAt: now + AUDIT_RETENTION_MS });
    return entitlement;
  });
}
