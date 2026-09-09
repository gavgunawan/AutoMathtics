// Stage 3.5 — recovery, export, deletion, and the support/operator tooling.
//
// Two audiences, two doors. A parent can read everything their family is (export), ask for the
// family to be deleted, or take that back — through the ordinary session, CSRF and recent-auth
// checks. An operator works through the CLI (scripts/support.mjs) under an explicit operator
// identity: every corrective action writes an audit row naming that identity. There is no
// browser route that lets anyone write arbitrary state, and nothing here can move a child, a
// family or a subscription to another account: the no-transfer invariant holds (NO_TRANSFER.md).
//
// Deletion is not "delete everything". Personal and product data go; learning and game data go;
// the financial records that PR #17 made durable stay, with the personal linkage they need
// reduced to a tombstone (RETENTION below says what and why).
import { randomUUID } from 'node:crypto';
import { fail, object, uuid, text } from './security.mjs';
import { normalizeProgress, freshProgress } from './progress.mjs';
import { reconcile } from './ledger.mjs';
import { deriveState, effectiveEntitlement } from './subscription.mjs';

const DAY = 86_400_000, AUDIT_RETENTION_MS = 400 * DAY;
export const DELETION_GRACE_MS = 14 * DAY;
export const INTENT_OUTCOMES = Object.freeze(['no_provider_change', 'provider_reverted', 'applied_by_operator', 'refunded']);
/** What deletion keeps, and why. */
export const RETENTION = Object.freeze({
  'families/{f}/billing/*': 'financial record of every subscription event',
  'billingEvents/*': 'provider event inbox: idempotency and dispute evidence',
  'billingCustomers/*': 'provider customer reference → family: needed to read the records above',
  'checkouts/*': 'checkout intents: idempotency evidence for hosted sessions that may have been paid',
  'billingChangeIntents/*': 'plan-change intents: idempotency and reconciliation evidence',
  'billingReconciliations/*': 'operator reconciliation decisions',
  'phones/*': 'one trial per verified phone: anti-abuse; holds no phone number',
  'families/{f} (tombstone)': 'family id, subscription facts, customer references, deletion record; label and children removed',
  'parents/{uid} (tombstone)': 'deleted flag and phone key, so a returning parent starts fresh and gets no second trial',
});
const ACCESS = new Set(['trial', 'active', 'grace']);
const flagged = (docs, key, values) => docs.filter((d) => values.includes(d[key]));

export class Support {
  constructor({ foundation, store, billing = null, payments = null, now = Date.now }) {
    this.foundation = foundation; this.store = store; this.billing = billing; this.payments = payments; this.now = now;
  }
  audit(tx, action, actor, familyId, extra = {}) {
    tx.set(`audit/${randomUUID()}`, { action, uid: actor, familyId, childId: null, at: this.now(), expireAt: this.now() + AUDIT_RETENTION_MS, ...extra });
  }
  operator(id) { if (typeof id !== 'string' || !/^[A-Za-z0-9@._:-]{3,120}$/.test(id)) fail(400, 'OPERATOR_REQUIRED'); return id; }

  // ---------------------------------------------------------------- the family's own data (parent)
  /** Everything the family is, for the parent to keep. No credentials, sessions, keys or secrets. */
  async exportFamily(ctx) {
    return this.store.transaction(async (tx) => {
      const { s, family } = await this.foundation.authorize(tx, ctx, ['parent']);
      this.foundation.requireRecent(s);
      return this.collect(tx, family, s.uid);
    }, { readOnly: true });
  }
  async collect(tx, family, uid) {
    const f = family.id, children = [];
    for (const id of family.childIds || []) {
      const c = await tx.get(`families/${f}/children/${id}`); if (!c) continue;
      const prog = await tx.get(`families/${f}/learning/${id}`);
      const ledger = (await tx.list(`families/${f}/learning/${id}/ledger`)).sort((a, b) => a.seq - b.seq);
      children.push({ id: c.id, nickname: c.nickname, icon: c.icon, status: c.status, createdAt: c.createdAt || null, progress: prog ? normalizeProgress(prog) : null, ledger });
    }
    const config = await tx.get(`families/${f}/game/config`);
    const billing = (await tx.list(`families/${f}/billing`)).sort((a, b) => a.at - b.at)
      .map((e) => ({ id: e.id, type: e.type, plan: e.plan, periodEnd: e.periodEnd, amountCents: e.amountCents ?? null, at: e.at, actor: e.actor, state: e.result?.state || null }));
    const audit = (await tx.list('audit')).filter((a) => a.familyId === f).sort((a, b) => a.at - b.at).map((a) => ({ action: a.action, at: a.at, childId: a.childId || null }));
    return { exportedAt: this.now(), exportedBy: uid,
      family: { id: f, label: family.label, createdAt: family.createdAt, timeZone: family.timeZone || null, activeChildIds: family.activeChildIds || [], deletion: family.deletion || null },
      entitlement: effectiveEntitlement(family, this.now()), subscription: family.subscription || null, billing, gameConfig: config || null, children, audit };
  }
  /** The parent asks for the family to be deleted. Nothing changes for 14 days; the parent can take it back. */
  async requestDeletion(ctx, body) {
    object(body, ['operationId']); const operationId = uuid(body?.operationId ?? (fail(400, 'OPERATION_ID_REQUIRED')));
    return this.store.transaction(async (tx) => {
      const { s, family } = await this.foundation.authorize(tx, ctx, ['parent']);
      this.foundation.requireRecent(s);
      if (family.deletion) return { effectiveAt: family.deletion.effectiveAt, requestedAt: family.deletion.requestedAt, pending: true };
      const now = this.now(), deletion = { operationId, requestedAt: now, requestedBy: s.uid, effectiveAt: now + DELETION_GRACE_MS };
      tx.set(`families/${s.familyId}`, { ...family, deletion });
      this.audit(tx, 'family.deletion_requested', s.uid, s.familyId, { effectiveAt: deletion.effectiveAt });
      return { effectiveAt: deletion.effectiveAt, requestedAt: now, pending: true };
    });
  }
  async cancelDeletion(ctx, body) {
    object(body, ['operationId']); uuid(body?.operationId ?? (fail(400, 'OPERATION_ID_REQUIRED')));
    return this.store.transaction(async (tx) => {
      const { s, family } = await this.foundation.authorize(tx, ctx, ['parent']);
      this.foundation.requireRecent(s);
      if (!family.deletion) fail(409, 'NO_DELETION_PENDING');
      const { deletion, ...rest } = family;
      tx.set(`families/${s.familyId}`, rest);
      this.audit(tx, 'family.deletion_cancelled', s.uid, s.familyId, { hadEffectiveAt: deletion.effectiveAt });
      return { pending: false };
    });
  }

  // ---------------------------------------------------------------- operator: read
  /** One family, everything support needs to see, with the problems summarised first. */
  async familyReport(familyId) {
    uuid(familyId);
    const family = await this.store.get(`families/${familyId}`);
    if (!family) fail(404, 'FAMILY_NOT_FOUND');
    const now = this.now(), children = [];
    for (const id of family.childIds || []) {
      const c = await this.store.get(`families/${familyId}/children/${id}`); if (!c) continue;
      const prog = await this.store.get(`families/${familyId}/learning/${id}`);
      const rows = await this.store.list(`families/${familyId}/learning/${id}/ledger`);
      const ledger = reconcile(rows, (prog ? normalizeProgress(prog) : freshProgress()).wallet); // no progress document yet: a fresh, empty ledger
      children.push({ id, nickname: c.nickname, status: c.status, seated: (family.activeChildIds || []).includes(id), ledger: ledger ? { match: ledger.match, damaged: ledger.damaged, problems: ledger.problems, cached: ledger.cached, derived: ledger.derived } : null });
    }
    const customers = [];
    for (const [provider, ref] of Object.entries(family.billing || {})) {
      const mapping = await this.store.get(`billingCustomers/${provider}:${ref}`);
      customers.push({ provider, ref, mapping: mapping ? { lastEventAt: mapping.lastEventAt, lastEventId: mapping.lastEventId, pending: mapping.pending || [] } : null });
    }
    const refs = new Set(customers.map((c) => c.ref));
    const inbox = (await this.store.list('billingEvents')).filter((e) => refs.has(e.customer)).sort((a, b) => a.at - b.at)
      .map((e) => ({ id: e.providerEventId, provider: e.provider, type: e.type, at: e.at, attempts: e.attempts, outcome: e.outcome }));
    const intents = (await this.store.list('billingChangeIntents')).filter((i) => i.familyId === familyId).sort((a, b) => a.createdAt - b.createdAt)
      .map((i) => ({ operationId: i.operationId, provider: i.provider, kind: i.kind, fromPlan: i.fromPlan, toPlan: i.toPlan, status: i.status, providerOperationRef: i.providerOperationRef || null, reconciliation: i.reconciliation || null, createdAt: i.createdAt }));
    const checkouts = (await this.store.list('checkouts')).filter((c) => c.familyId === familyId).sort((a, b) => a.createdAt - b.createdAt)
      .map((c) => ({ checkoutId: c.checkoutId, provider: c.provider, plan: c.plan, status: c.status, providerCheckoutRef: c.providerCheckoutRef || null, supersededBy: c.supersededBy || null, createdAt: c.createdAt }));
    const billing = (await this.store.list(`families/${familyId}/billing`)).sort((a, b) => a.at - b.at).map((e) => ({ id: e.id, type: e.type, plan: e.plan, at: e.at, actor: e.actor, state: e.result?.state || null }));
    const audit = (await this.store.list('audit')).filter((a) => a.familyId === familyId).sort((a, b) => a.at - b.at).map((a) => ({ action: a.action, uid: a.uid, at: a.at, childId: a.childId || null }));
    const reconciliations = (await this.store.list('billingReconciliations')).filter((r) => r.familyId === familyId);
    const sub = family.subscription || null;
    const attention = {
      requiresAction: inbox.filter((e) => e.outcome?.status === 'requires_action').length,
      rejected: inbox.filter((e) => e.outcome?.status === 'rejected').length,
      openIntents: flagged(intents, 'status', ['creating', 'stale', 'superseded']).map((i) => i.operationId),
      openCheckouts: flagged(checkouts, 'status', ['creating', 'superseded']).map((c) => c.checkoutId),
      inFlight: family.billingIntent || null, liveCheckout: family.checkoutIntent || null,
      ledgerDamaged: children.filter((c) => c.ledger?.damaged).map((c) => c.id), ledgerDrift: children.filter((c) => c.ledger && !c.ledger.match && !c.ledger.damaged).map((c) => c.id),
      deletion: family.deletion || null, deleted: family.deleted === true,
    };
    return { familyId, deleted: family.deleted === true, label: family.deleted ? null : family.label, createdAt: family.createdAt, phoneKey: family.phoneKey || null, timeZone: family.timeZone || null,
      entitlement: effectiveEntitlement(family, now), subscription: sub ? { ...sub, state: deriveState(sub, now) } : null, manualGrant: family.entitlement || null,
      children, customers, inbox, intents, checkouts, billing, reconciliations, audit, attention };
  }
  /** Provider customer reference → family. */
  async customerLookup(provider, ref) {
    text(provider, 1, 16); text(ref, 1, 128);
    const mapping = await this.store.get(`billingCustomers/${provider}:${ref}`);
    if (!mapping) fail(404, 'UNKNOWN_CUSTOMER');
    return { provider, ref, familyId: mapping.familyId, lastEventAt: mapping.lastEventAt, lastEventId: mapping.lastEventId, pending: mapping.pending || [] };
  }
  /** The global inbox, filtered by outcome. */
  async inbox(status = 'requires_action') {
    const all = await this.store.list('billingEvents');
    return all.filter((e) => status === 'all' || e.outcome?.status === status).sort((a, b) => a.at - b.at)
      .map((e) => ({ id: e.providerEventId, provider: e.provider, type: e.type, customer: e.customer, familyId: e.familyId, at: e.at, attempts: e.attempts, outcome: e.outcome }));
  }

  // ---------------------------------------------------------------- operator: corrective, audited
  /** Reprocess every event waiting on this family's customers. Same code path the server runs itself. */
  async reprocess(familyId, operator) {
    uuid(familyId); this.operator(operator);
    const family = await this.store.get(`families/${familyId}`); if (!family) fail(404, 'FAMILY_NOT_FOUND');
    const results = [];
    for (const [provider, ref] of Object.entries(family.billing || {})) for (const r of await this.payments.reprocess(provider, ref)) results.push({ provider, ...r });
    await this.store.transaction(async (tx) => this.audit(tx, 'support.reprocess', operator, familyId, { results: results.map((r) => `${r.id}:${r.status}`) }));
    return results;
  }
  /**
   * Record what the operator established about a plan-change intent the server could not
   * finalise (creating / stale / superseded): the provider's side was checked and either nothing
   * changed there, it was reverted, the change was applied by the operator through an event, or
   * money was refunded. An applied intent is not open to this.
   */
  async reconcileIntent(provider, operationId, { operator, outcome, note }) {
    text(provider, 1, 16); uuid(operationId); this.operator(operator);
    if (!INTENT_OUTCOMES.includes(outcome)) fail(400, 'INVALID_REQUEST');
    text(note, 1, 500);
    const path = `billingChangeIntents/${provider}:${operationId}`;
    return this.store.transaction(async (tx) => {
      const intent = await tx.get(path);
      if (!intent) fail(404, 'INTENT_NOT_FOUND');
      if (!['creating', 'stale', 'superseded'].includes(intent.status)) fail(409, 'INTENT_NOT_OPEN');
      const id = randomUUID(), now = this.now();
      const record = { id, provider, operationId, familyId: intent.familyId, previousStatus: intent.status, providerOperationRef: intent.providerOperationRef || null, outcome, note, operator, at: now };
      tx.set(`billingReconciliations/${id}`, record);
      tx.set(path, { ...intent, status: 'reconciled', reconciliation: { id, outcome, at: now } });
      this.audit(tx, 'support.intent_reconciled', operator, intent.familyId, { operationId, outcome });
      return record;
    });
  }
  /**
   * Execute a deletion the parent asked for, once its 14 days have passed (an operator may force
   * it earlier with the explicit flag). Personal and product data go; learning and game data go;
   * financial records stay with the linkage reduced to tombstones (RETENTION). Idempotent.
   */
  async executeDeletion(familyId, { operator, force = false } = {}) {
    uuid(familyId); this.operator(operator);
    const family = await this.store.get(`families/${familyId}`);
    if (!family) fail(404, 'FAMILY_NOT_FOUND');
    if (family.deleted) return await this.store.get(`deletions/${familyId}`);
    if (!family.deletion) fail(409, 'NO_DELETION_PENDING');
    if (family.deletion.effectiveAt > this.now() && force !== true) fail(409, 'DELETION_NOT_DUE');
    const now = this.now(), counts = { children: 0, sessions: 0, ledgerRows: 0, operations: 0, loginSessions: 0 };
    // 1. the subscription ends first, as a financial event the records keep (the adapter tells the provider in Stage 4)
    if (family.subscription && ACCESS.has(deriveState(family.subscription, now))) await this.billing.apply(familyId, { id: randomUUID(), type: 'terminate' }, operator);
    // 2. each child's learning and game data, one transaction per child (ids come from entries())
    for (const childId of family.childIds || []) {
      const base = `families/${familyId}/learning/${childId}`;
      await this.store.transaction(async (tx) => {
        const sessions = await tx.entries(`${base}/sessions`), ledger = await tx.entries(`${base}/ledger`), ops = await tx.entries(`${base}/operations`), prog = await tx.get(base);
        for (const [id] of sessions) tx.delete(`${base}/sessions/${id}`);
        for (const [id] of ledger) tx.delete(`${base}/ledger/${id}`);
        for (const [id] of ops) tx.delete(`${base}/operations/${id}`);
        if (prog) tx.delete(base);
        counts.sessions += sessions.length; counts.ledgerRows += ledger.length; counts.operations += ops.length;
      });
    }
    // 3. the family and its people: children, credentials, PIN attempts, child-creation receipts, members, login sessions, parent tombstones, family tombstone
    return this.store.transaction(async (tx) => {
      const current = await tx.get(`families/${familyId}`); if (!current || current.deleted) return await tx.get(`deletions/${familyId}`);
      const sub = (c) => tx.entries(`families/${familyId}/${c}`);
      const members = await sub('members'), childDocs = await sub('children'), creds = await sub('credentials'), attempts = await sub('pinAttempts'), receipts = await sub('operations');
      const config = await tx.get(`families/${familyId}/game/config`);
      const uids = members.map(([uid]) => uid);
      const parents = []; for (const uid of uids) parents.push([uid, await tx.get(`parents/${uid}`)]);
      const logins = (await tx.entries('sessions')).filter(([, s]) => s.familyId === familyId || uids.includes(s.uid));
      for (const group of [['children', childDocs], ['credentials', creds], ['pinAttempts', attempts], ['operations', receipts], ['members', members]]) for (const [id] of group[1]) tx.delete(`families/${familyId}/${group[0]}/${id}`);
      if (config) tx.delete(`families/${familyId}/game/config`);
      for (const [key] of logins) tx.delete(`sessions/${key}`);
      for (const [uid, p] of parents) if (p) tx.set(`parents/${uid}`, { deleted: true, deletedAt: now, familyId: null, reauthAfter: Math.max(p.reauthAfter || 0, Math.floor(now / 1000)), phoneKey: p.phoneKey || null, createdAt: p.createdAt || null }); // seconds, like login()
      const tombstone = { id: familyId, deleted: true, deletedAt: now, deletedBy: operator, createdAt: current.createdAt || null, phoneKey: current.phoneKey || null, billing: current.billing || null,
        subscription: current.subscription || null, childIds: [], activeChildIds: [], deletion: { ...current.deletion, executedAt: now }, retention: Object.keys(RETENTION) };
      tx.set(`families/${familyId}`, tombstone);
      counts.children = childDocs.length; counts.loginSessions = logins.length;
      const record = { familyId, requestedAt: current.deletion.requestedAt, requestedBy: current.deletion.requestedBy, executedAt: now, executedBy: operator, forced: force === true, counts, retained: RETENTION };
      tx.set(`deletions/${familyId}`, record);
      this.audit(tx, 'family.deleted', operator, familyId, { counts });
      return record;
    });
  }
}
