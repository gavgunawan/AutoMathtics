import { randomUUID } from 'node:crypto';
import { Fault, fail, sha256, mac, randomToken, object, text, uuid, pin, childInput, publicChild } from './security.mjs';

const MINUTE = 60_000;
const FAMILY_LIMIT = 20; // Pilot safety cap, independent of paid seat count.
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
  audit(tx, action, uid, familyId = null, childId = null) {
    tx.set(`audit/${randomUUID()}`, { action, uid, familyId, childId, at: this.now() });
  }
  async rate(bucket, maximum, windowMs) {
    const path = `rateLimits/${mac(this.secret, bucket)}`;
    return this.store.transaction(async (tx) => {
      const old = await tx.get(path), now = this.now();
      const next = old && old.until > now ? { ...old } : { count: 0, until: now + windowMs };
      if (next.count >= maximum) fail(429, 'TOO_MANY_ATTEMPTS');
      next.count++; tx.set(path, next);
    });
  }
  async authenticate(token) {
    const key = sessionKey(token);
    if (!key) fail(401, 'SIGN_IN_REQUIRED');
    const session = await this.store.get(`sessions/${key}`);
    if (!session || session.expiresAt <= this.now()) fail(401, 'SIGN_IN_REQUIRED');
    await this.identity.recheck(session);
    return { key, uid: session.uid };
  }
  async authorize(tx, ctx, roles, needFamily = true) {
    const s = await tx.get(`sessions/${ctx.key}`);
    if (!s || s.uid !== ctx.uid || s.expiresAt <= this.now()) fail(401, 'SIGN_IN_REQUIRED');
    if (!roles.includes(s.role)) fail(403, 'PARENT_REQUIRED');
    const parent = await tx.get(`parents/${s.uid}`);
    if (!parent || parent.familyId !== s.familyId) fail(403, 'ACCESS_DENIED');
    if (!s.familyId) {
      if (needFamily) fail(409, 'CREATE_FAMILY_FIRST');
      return { s, parent, family: null };
    }
    const member = await tx.get(`families/${s.familyId}/members/${s.uid}`);
    const family = await tx.get(`families/${s.familyId}`);
    if (!member || member.role !== 'owner' || member.status !== 'active' || !family) fail(403, 'ACCESS_DENIED');
    return { s, parent, family };
  }
  requireRecent(s) {
    if (s.authTime * 1000 < this.now() - 5 * MINUTE) fail(403, 'REAUTHENTICATE');
  }
  entitlement(family, childId = null) {
    const e = family.entitlement;
    if (!e || e.status !== 'active' || !Number.isSafeInteger(e.accessUntil) || e.accessUntil <= this.now()) fail(403, 'SUBSCRIPTION_INACTIVE');
    if (!Number.isInteger(e.seatLimit) || e.seatLimit < 1 || e.seatLimit > FAMILY_LIMIT ||
        !Array.isArray(family.activeChildIds) || family.activeChildIds.length > e.seatLimit) fail(403, 'ACCESS_DENIED');
    if (childId && !family.activeChildIds.includes(childId)) fail(403, 'CHILD_INACTIVE');
    return e;
  }
  async login(idToken, previousToken) {
    text(idToken, 20, 8192);
    const who = await this.identity.verifyLogin(idToken, this.now());
    const token = randomToken(), key = sha256(token), oldKey = sessionKey(previousToken);
    await this.store.transaction(async (tx) => {
      const path = `parents/${who.uid}`;
      const parent = await tx.get(path);
      const old = oldKey ? await tx.get(`sessions/${oldKey}`) : null;
      // Also blocks a copied pre-handover ID token presented with a new cookie.
      if (parent && who.authTime <= (parent.reauthAfter || 0)) fail(403, 'REAUTHENTICATE');
      const s = { ...who, familyId: parent?.familyId || null, role: 'parent', childId: null,
        csrf: randomToken(), createdAt: this.now(), expiresAt: this.now() + 30 * MINUTE };
      if (!parent) tx.set(path, { familyId: null, reauthAfter: 0, createdAt: this.now() });
      if (old) tx.delete(`sessions/${oldKey}`);
      tx.set(`sessions/${key}`, s);
      this.audit(tx, 'parent.signed_in', who.uid, s.familyId);
    });
    return token;
  }
  async me(ctx) {
    return this.store.transaction(async (tx) => {
      const { s, family } = await this.authorize(tx, ctx, ['parent', 'selector', 'child'], false);
      if (s.role === 'child') {
        this.entitlement(family, s.childId);
        const child = await tx.get(`families/${s.familyId}/children/${s.childId}`);
        const credential = await tx.get(`families/${s.familyId}/credentials/${s.childId}`);
        if (!child || child.status !== 'active' || !credential || credential.version !== s.pinVersion) fail(401, 'CHILD_SESSION_REVOKED');
        return { role: 'child', csrf: s.csrf, child: publicChild(child) };
      }
      const children = [];
      for (const id of family?.childIds || []) {
        const c = await tx.get(`families/${s.familyId}/children/${id}`);
        if (c) children.push(publicChild(c));
      }
      return { role: s.role, csrf: s.csrf, family: family ? {
        id: family.id, label: family.label, children,
        ...(s.role === 'parent' ? { entitlement: family.entitlement, activeCount: family.activeChildIds.length } : {}),
      } : null };
    });
  }
  async createFamily(ctx, body) {
    object(body, ['label', 'adultAttestation', 'consentVersion']);
    const label = text(body.label, 1, 40).normalize('NFC').trim();
    if (!label || body.adultAttestation !== true || body.consentVersion !== 'pilot-v1') fail(400, 'CONSENT_REQUIRED');
    const familyId = randomUUID();
    return this.store.transaction(async (tx) => {
      const { s, parent } = await this.authorize(tx, ctx, ['parent'], false);
      this.requireRecent(s);
      if (parent.familyId) return { id: parent.familyId }; // One family per owner; safe retry.
      tx.set(`families/${familyId}`, { id: familyId, label, childIds: [], activeChildIds: [], createdAt: this.now(),
        entitlement: { status: 'inactive', seatLimit: 0, accessUntil: 0, version: 0, source: 'manual' } });
      tx.set(`families/${familyId}/members/${s.uid}`, { role: 'owner', status: 'active' });
      tx.set(`parents/${s.uid}`, { ...parent, familyId, consentVersion: 'pilot-v1', attestedAt: this.now() });
      tx.set(`sessions/${ctx.key}`, { ...s, familyId });
      this.audit(tx, 'family.created', s.uid, familyId);
      return { id: familyId };
    });
  }
  async createChild(ctx, body, requestId) {
    const input = childInput(body); uuid(requestId);
    await this.rate(`child-create:${ctx.uid}`, 10, MINUTE);
    const initial = await this.store.transaction((tx) => this.authorize(tx, ctx, ['parent']));
    this.requireRecent(initial.s);
    this.entitlement(initial.family);
    const familyId = initial.s.familyId, childId = randomUUID();
    const fingerprint = mac(this.secret, JSON.stringify(input)); // PIN never in the replay record.
    const opPath = `families/${familyId}/operations/${requestId}`;
    const existing = await this.store.get(opPath);
    if (existing) {
      if (existing.uid !== ctx.uid || existing.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT');
      return { child: existing.child };
    }
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
      const child = { id: childId, nickname: input.nickname, icon: input.icon, status: 'active', createdAt: this.now() };
      tx.set(`families/${familyId}`, { ...family, childIds: [...family.childIds, childId], activeChildIds: [...family.activeChildIds, childId] });
      tx.set(`families/${familyId}/children/${childId}`, child);
      tx.set(`families/${familyId}/credentials/${childId}`, { hash, version: 1 });
      tx.set(opPath, { uid: ctx.uid, fingerprint, child: publicChild(child), at: this.now() });
      this.audit(tx, 'child.created', s.uid, familyId, childId);
      return { child: publicChild(child) };
    });
  }
  async lock(ctx) {
    await this.store.transaction(async (tx) => {
      const { s, parent } = await this.authorize(tx, ctx, ['parent']);
      tx.set(`sessions/${ctx.key}`, { ...s, role: 'selector', childId: null, expiresAt: this.now() + 12 * 60 * MINUTE });
      tx.set(`parents/${s.uid}`, { ...parent, reauthAfter: Math.max(parent.reauthAfter || 0, s.authTime, Math.floor(this.now() / 1000)) });
      this.audit(tx, 'session.child_mode', s.uid, s.familyId);
    });
  }
  async selector(ctx) {
    await this.store.transaction(async (tx) => {
      const { s } = await this.authorize(tx, ctx, ['child', 'selector']);
      tx.set(`sessions/${ctx.key}`, { ...s, role: 'selector', childId: null });
    });
  }
  async selectChild(ctx, childId, code) {
    uuid(childId); pin(code);
    await this.rate(`pin-family:${ctx.uid}`, 30, 15 * MINUTE);
    const ticket = randomUUID();
    const state = await this.store.transaction(async (tx) => {
      const { s, family } = await this.authorize(tx, ctx, ['selector']);
      const path = `families/${s.familyId}/children/${childId}`;
      const child = await tx.get(path);
      const credential = await tx.get(`families/${s.familyId}/credentials/${childId}`);
      const attemptPath = `families/${s.familyId}/pinAttempts/${childId}`;
      const prior = await tx.get(attemptPath);
      if (!child || !credential) fail(404, 'CHILD_NOT_FOUND');
      this.entitlement(family, childId);
      if (child.status !== 'active') fail(403, 'CHILD_INACTIVE');
      const attempts = prior && prior.until > this.now() ? { ...prior } : { count: 0, until: this.now() + 15 * MINUTE };
      if (attempts.count >= 5) fail(429, 'PIN_LOCKED');
      attempts.count++; attempts.ticket = ticket;
      tx.set(attemptPath, attempts); // Reserve an attempt BEFORE expensive verification, across devices.
      return { s, credential, attemptPath };
    });
    const correct = await this.hasher.verify(state.s.familyId, childId, code, state.credential.hash);
    await this.store.transaction(async (tx) => {
      const { s, family } = await this.authorize(tx, ctx, ['selector']);
      const current = await tx.get(`families/${s.familyId}/credentials/${childId}`);
      const attempts = await tx.get(state.attemptPath);
      this.entitlement(family, childId);
      if (!current || current.version !== state.credential.version || current.hash !== state.credential.hash) fail(409, 'PIN_CHANGED_RETRY');
      if (correct) {
        if (attempts?.ticket === ticket) tx.delete(state.attemptPath);
        tx.set(`sessions/${ctx.key}`, { ...s, role: 'child', childId, pinVersion: current.version });
        this.audit(tx, 'child.signed_in', s.uid, s.familyId, childId);
      } else this.audit(tx, 'child.pin_failed', s.uid, s.familyId, childId);
    });
    if (!correct) fail(401, 'INCORRECT_PIN');
  }
  async resetPin(ctx, childId, code) {
    uuid(childId); pin(code);
    await this.rate(`pin-reset:${ctx.uid}`, 5, MINUTE);
    const first = await this.store.transaction((tx) => this.authorize(tx, ctx, ['parent']));
    this.requireRecent(first.s);
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
        if (parent) tx.set(`parents/${s.uid}`, { ...parent, reauthAfter: Math.max(parent.reauthAfter || 0, s.authTime, Math.floor(this.now() / 1000)) });
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
    const active = keepChildIds ?? family.activeChildIds;
    if (active.length > seatLimit || active.some((id) => !family.childIds.includes(id))) fail(409, 'SELECT_CHILDREN_FOR_DOWNGRADE');
    const children = [];
    for (const id of family.childIds) children.push(await tx.get(`${path}/children/${id}`));
    const entitlement = { seatLimit, accessUntil, status: seatLimit && accessUntil > now ? 'active' : 'inactive',
      version: family.entitlement.version + 1, source: 'manual' };
    tx.set(path, { ...family, activeChildIds: active, entitlement });
    for (const child of children) if (child) tx.set(`${path}/children/${child.id}`, { ...child, status: active.includes(child.id) ? 'active' : 'inactive' });
    tx.set(`audit/${randomUUID()}`, { action: 'entitlement.granted', familyId, actor, reason, entitlement, at: now });
    return entitlement;
  });
}
