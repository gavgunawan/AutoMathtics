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
  'parents/{uid} (tombstone)': 'deleted flag and phone key, so a returning parent starts fresh and gets no second trial; after the sign-in account is deleted too, this is all that remains of the parent',
  'audit/*': 'security and accountability trail (uid, familyId, childId, action); expires by TTL 400 days after each row',
  'deletions/{f}': 'the deletion record: who asked, who executed, what was removed and what was kept',
  'supportOperations/*': 'which operator started which corrective action, and how it ended',
});
export const DELETION_BATCH = 300; // comfortably under Firestore's 500 writes per transaction
const ACCESS = new Set(['trial', 'active', 'grace']);
const flagged = (docs, key, values) => docs.filter((d) => values.includes(d[key]));
// What an operator can establish about an inbox row the server could not apply (Stage 4.2), after acting at the provider.
export const EVENT_OUTCOMES = Object.freeze(['refunded_at_provider', 'cancelled_at_provider', 'applied_by_operator', 'no_action_needed']);
const OPEN_EVENT = new Set(['reconciliation_required', 'rejected']);

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
      children.push({ id: c.id, nickname: c.nickname, icon: c.icon, status: c.status, createdAt: c.createdAt || null, demographics: c.demographics || null, start: c.start || null, progress: prog ? normalizeProgress(prog) : null, ledger });
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

  /**
   * Stage 4: the parent's sign-in account, once no family points at it — either the family was deleted
   * (its tombstone left the parent record with familyId null) or none was ever created. Two steps so a
   * failure at the identity provider leaves a record that says so and can be retried:
   *   1. one transaction: every session of this uid deleted, parents/{uid} marked `identityDeletion`;
   *   2. the Auth account is deleted at the provider; then the record gets `identityDeletedAt`.
   * What stays: the parent tombstone with its phone key (one trial per phone survives the account)
   * and nothing else personal — the email and phone number live in the Auth account and go with it.
   */
  async deleteAccount(ctx, body) {
    object(body, ['operationId']); uuid(body?.operationId ?? (fail(400, 'OPERATION_ID_REQUIRED')));
    const { uid } = await this.store.transaction(async (tx) => {
      const { s, parent } = await this.foundation.authorize(tx, ctx, ['parent'], false);
      this.foundation.requireRecent(s);
      if (s.familyId || parent.familyId) fail(409, 'FAMILY_STILL_EXISTS'); // delete the family first; that is the 14-day workflow
      return this.beginIdentityDeletion(tx, s.uid, parent, s.uid);
    });
    return this.finishIdentityDeletion(uid, uid);
  }
  /** Operator path for the same thing (a parent who cannot sign in any more, or a retry after a provider failure). */
  async deleteAccountFor(uid, operator) {
    text(uid, 1, 128); this.operator(operator);
    await this.store.transaction(async (tx) => {
      const parent = await tx.get(`parents/${uid}`);
      if (!parent) fail(404, 'PARENT_NOT_FOUND');
      if (parent.familyId) fail(409, 'FAMILY_STILL_EXISTS');
      return this.beginIdentityDeletion(tx, uid, parent, operator);
    });
    return this.finishIdentityDeletion(uid, operator);
  }
  async beginIdentityDeletion(tx, uid, parent, actor) {
    const now = this.now(), sessions = await tx.query('sessions', 'uid', uid, 200);
    for (const [key] of sessions) tx.delete(`sessions/${key}`);
    tx.set(`parents/${uid}`, { ...parent, deleted: true, deletedAt: parent.deletedAt || now, familyId: null, reauthAfter: Math.max(parent.reauthAfter || 0, Math.floor(now / 1000)), phoneKey: parent.phoneKey || null,
      identityDeletion: { requestedAt: parent.identityDeletion?.requestedAt || now, requestedBy: actor, deletedAt: parent.identityDeletion?.deletedAt || null } });
    this.audit(tx, 'account.deletion_started', actor, null, { subject: uid, sessions: sessions.length });
    return { uid };
  }
  async finishIdentityDeletion(uid, actor) {
    try { await this.foundation.identity.deleteUser(uid); }
    catch (error) { if (error?.code === 'auth/user-not-found' || /not.found|missing/i.test(String(error?.message))) { /* already gone at the provider: finish the record */ } else throw error; }
    return this.store.transaction(async (tx) => {
      const parent = await tx.get(`parents/${uid}`), now = this.now();
      const record = { ...parent, identityDeletion: { ...(parent.identityDeletion || { requestedAt: now, requestedBy: actor }), deletedAt: now } };
      tx.set(`parents/${uid}`, record);
      this.audit(tx, 'account.deleted', actor, null, { subject: uid });
      return { deleted: true, deletedAt: now };
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
    for (const [provider, ref] of [...Object.entries(family.billing || {}), ...Object.entries(family.providerCustomer || {})]) {
      const mapping = await this.store.get(`billingCustomers/${provider}:${ref}`);
      customers.push({ provider, ref, mapping: mapping ? { lastEventAt: mapping.lastEventAt, lastEventId: mapping.lastEventId, pending: mapping.pending || [], aliasOf: mapping.aliasOf || null } : null });
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
    const providerChecks = reconciliations.filter((r) => r.kind === 'provider_state').sort((a, b) => b.at - a.at);
    const sub = family.subscription || null;
    const attention = {
      requiresAction: inbox.filter((e) => e.outcome?.status === 'requires_action').length,
      reconciliationRequired: inbox.filter((e) => e.outcome?.status === 'reconciliation_required' && !e.outcome.resolution).length, // late provider events on a deleted family, until resolve-event
      rejected: inbox.filter((e) => e.outcome?.status === 'rejected' && !e.outcome.resolution).length,
      providerCheck: providerChecks[0] ? { at: providerChecks[0].at, match: providerChecks[0].match, findings: providerChecks[0].findings.map((x) => x.code) } : null, // the latest reconcile-provider run
      openIntents: flagged(intents, 'status', ['creating', 'stale', 'superseded', 'frozen_by_deletion']).map((i) => i.operationId),
      openCheckouts: flagged(checkouts, 'status', ['creating', 'superseded', 'superseded_by_deletion']).map((c) => c.checkoutId),
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
    // The operator's intent is durable before anything moves: a crash mid-way leaves supportOperations/{id} `running` under their name.
    const id = randomUUID(), startedAt = this.now();
    await this.store.transaction(async (tx) => { tx.set(`supportOperations/${id}`, { id, action: 'reprocess', operator, familyId, startedAt, status: 'running', results: null, finishedAt: null }); this.audit(tx, 'support.reprocess_started', operator, familyId, { operationId: id }); });
    const results = [];
    for (const [provider, ref] of [...Object.entries(family.billing || {}), ...Object.entries(family.providerCustomer || {})]) for (const r of await this.payments.reprocess(provider, ref)) results.push({ provider, ...r });
    await this.store.transaction(async (tx) => {
      const row = await tx.get(`supportOperations/${id}`);
      tx.set(`supportOperations/${id}`, { ...row, status: 'done', results: results.map((r) => ({ provider: r.provider, id: r.id, status: r.status, reason: r.reason || null })), finishedAt: this.now() });
      this.audit(tx, 'support.reprocess', operator, familyId, { operationId: id, results: results.map((r) => `${r.id}:${r.status}`) });
    });
    return results;
  }
  /**
   * Stage 4.2: the provider's truth against the family's record, read-only at the provider, one
   * reconciliation record per run (`kind: provider_state`) with the findings an operator acts on
   * (RECONCILIATION.md). A simulated provider holds no state, so it yields no findings and no verdict.
   */
  async reconcileProvider(familyId, operator) {
    uuid(familyId); this.operator(operator);
    const family = await this.store.get(`families/${familyId}`); if (!family) fail(404, 'FAMILY_NOT_FOUND');
    const now = this.now(), sub = family.subscription || null, state = sub ? deriveState(sub, now) : 'none', gone = family.deleted === true || family.deletion?.status === 'executing';
    const local = { state, plan: sub?.plan || null, scheduledPlan: sub?.scheduled?.plan || null, periodEnd: sub?.periodEnd || null, cancelAtPeriodEnd: !!sub?.cancelAtPeriodEnd, provider: sub?.provider || null, providerRef: sub?.providerRef || null, version: sub?.version ?? null };
    const wantsProvider = !!sub && sub.plan !== 'trial' && ['active', 'grace', 'past_due'].includes(state) && !gone; // the family's record says a provider subscription should be live
    const providers = [];
    for (const [provider, ref] of Object.entries(family.billing || {})) {
      const st = this.payments ? await this.payments.providerState(provider, ref) : { provider, available: false };
      const findings = [], add = (code, detail) => findings.push({ code, detail }), relevant = local.provider === provider, ps = st.subscription || null, live = ps?.live === true;
      if (!st.available) add('PROVIDER_STATE_UNAVAILABLE', 'this adapter cannot report provider state');
      else if (st.error) add('PROVIDER_UNREACHABLE', st.error);
      else if (st.simulated) { /* the fake provider holds nothing to compare */ }
      else if (!st.customer) { if (wantsProvider && relevant) add('NO_PROVIDER_CUSTOMER', `the family is ${state} on ${local.plan}; the provider knows no customer for its reference`); }
      else if (!live) { if (wantsProvider && relevant) add('NO_PROVIDER_SUBSCRIPTION', `the family is ${state} on ${local.plan}; the provider has ${ps ? `a ${ps.status}` : 'no'} subscription`); }
      else if (gone) add('DELETED_FAMILY_PROVIDER_LIVE', `the family is deleted; the provider's subscription ${ps.ref} is ${ps.status} — cancel it there, then resolve-event its late notice`);
      else if (!wantsProvider) add('PROVIDER_SUBSCRIPTION_LIVE', `the family is ${state}; the provider's subscription ${ps.ref} is ${ps.status}`);
      else {
        if (!ps.plan) add('UNKNOWN_PROVIDER_PRICE', `${ps.price} is not one of the adapter's prices`);
        else if (ps.plan !== local.plan && ps.plan !== local.scheduledPlan) add('PLAN_MISMATCH', `provider ${ps.plan}; family ${local.plan}${local.scheduledPlan ? ` (scheduled ${local.scheduledPlan})` : ''}`);
        if (ps.periodEnd && local.periodEnd && Math.abs(ps.periodEnd - local.periodEnd) > 60_000) add('PERIOD_END_MISMATCH', `provider ${new Date(ps.periodEnd).toISOString()}; family ${new Date(local.periodEnd).toISOString()}`);
        if (ps.cancelAtPeriodEnd !== local.cancelAtPeriodEnd) add('CANCEL_FLAG_MISMATCH', `provider cancel at period end ${ps.cancelAtPeriodEnd}; family ${local.cancelAtPeriodEnd}`);
      }
      providers.push({ provider, ref, available: st.available, simulated: st.simulated === true, error: st.error || null, customer: st.customer || null, subscription: ps, findings });
    }
    const target = (i) => (i.kind === 'clear' ? i.fromPlan : i.toPlan);
    const intents = (await this.store.query('billingChangeIntents', 'familyId', familyId, 100)).map(([, i]) => i).filter((i) => ['creating', 'stale', 'superseded', 'frozen_by_deletion'].includes(i.status)).sort((a, b) => a.createdAt - b.createdAt)
      .map((i) => { const p = providers.find((x) => x.provider === i.provider), ps = p?.subscription; return { operationId: i.operationId, provider: i.provider, kind: i.kind, fromPlan: i.fromPlan, toPlan: i.toPlan, status: i.status, providerOperationRef: i.providerOperationRef || null,
        providerEvidence: !p || !p.available || p.simulated || p.error ? 'unknown' : !ps?.live ? 'no_live_provider_subscription' : ps.plan === target(i) ? 'provider_on_target_plan' : 'provider_on_other_plan' }; });
    const findings = providers.flatMap((p) => p.findings.map((x) => ({ provider: p.provider, ...x }))), compared = providers.some((p) => p.available && !p.simulated && !p.error);
    const id = randomUUID(), record = { id, kind: 'provider_state', familyId, deleted: family.deleted === true, operator, at: now, local, providers, intents, findings, match: compared ? findings.length === 0 : null };
    await this.store.transaction(async (tx) => { tx.set(`billingReconciliations/${id}`, record); this.audit(tx, 'support.provider_reconciled', operator, familyId, { reconciliationId: id, findings: findings.map((x) => x.code), match: record.match }); });
    return record;
  }
  /**
   * Stage 4.2: close an inbox row the server could not apply — a late event on a deleted family
   * (`reconciliation_required`) or a `rejected` one — after acting at the provider. The row keeps
   * its outcome; the resolution sits beside it, and the family report stops counting it.
   */
  async resolveEvent(provider, eventId, { operator, outcome, note }) {
    text(provider, 1, 16); text(eventId, 1, 128); this.operator(operator);
    if (!EVENT_OUTCOMES.includes(outcome)) fail(400, 'INVALID_REQUEST');
    text(note, 1, 500);
    const path = `billingEvents/${provider}:${eventId}`;
    return this.store.transaction(async (tx) => {
      const r = await tx.get(path); if (!r) fail(404, 'EVENT_NOT_FOUND');
      if (!OPEN_EVENT.has(r.outcome?.status)) fail(409, 'EVENT_NOT_OPEN');
      if (r.outcome.resolution) fail(409, 'EVENT_ALREADY_RESOLVED');
      const id = randomUUID(), now = this.now();
      const record = { id, kind: 'event', provider, eventId, familyId: r.familyId || null, eventType: r.type, previousOutcome: r.outcome.status, reason: r.outcome.reason || null, outcome, note, operator, at: now };
      tx.set(`billingReconciliations/${id}`, record);
      tx.set(path, { ...r, outcome: { ...r.outcome, resolution: { id, outcome, operator, at: now } } });
      this.audit(tx, 'support.event_resolved', operator, r.familyId || null, { eventId, outcome });
      return record;
    });
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
      if (!['creating', 'stale', 'superseded', 'frozen_by_deletion'].includes(intent.status)) fail(409, 'INTENT_NOT_OPEN');
      const id = randomUUID(), now = this.now();
      const record = { id, kind: 'intent', provider, operationId, familyId: intent.familyId, previousStatus: intent.status, providerOperationRef: intent.providerOperationRef || null, outcome, note, operator, at: now };
      tx.set(`billingReconciliations/${id}`, record);
      tx.set(path, { ...intent, status: 'reconciled', reconciliation: { id, outcome, at: now } });
      this.audit(tx, 'support.intent_reconciled', operator, intent.familyId, { operationId, outcome });
      return record;
    });
  }
  /**
   * Delete `batch` documents of a collection per transaction until it is empty, counting them on the
   * family's deletion record in the same transaction, so a crash can neither lose a count nor count
   * twice (a retried transaction re-reads before it writes). Safe to re-run.
   */
  async sweep(collection, batch, familyId, key, select = (tx) => tx.entries(collection, batch)) {
    let total = 0;
    for (;;) {
      const n = await this.store.transaction(async (tx) => {
        const rows = await select(tx), f = await tx.get(`families/${familyId}`);
        for (const [id] of rows) tx.delete(`${collection}/${id}`);
        if (rows.length && f && !f.deleted) { const counts = { ...(f.deletion.counts || {}) }; counts[key] = (counts[key] || 0) + rows.length; tx.set(`families/${familyId}`, { ...f, deletion: { ...f.deletion, counts } }); }
        return rows.length;
      });
      total += n; if (n < batch) return total;
    }
  }
  sweepWhere(collection, field, value, batch, familyId, key) { return this.sweep(collection, batch, familyId, key, (tx) => tx.query(collection, field, value, batch)); }
  async progress(familyId, phase) { // which phase the job reached, for a rerun after a crash
    await this.store.transaction(async (tx) => { const f = await tx.get(`families/${familyId}`); if (!f || f.deleted) return; tx.set(`families/${familyId}`, { ...f, deletion: { ...f.deletion, phase } }); });
  }
  /**
   * Execute a deletion the parent asked for, once its 14 days have passed (an operator may force it
   * earlier with the explicit flag). A job in phases, each phase a bounded transaction, the whole
   * thing resumable after a crash:
   *   0. begin — one transaction: the family is `executing` from here on (Stage 1 admits nobody),
   *      live checkouts and open change intents are frozen, the record names the operator;
   *   1. login sessions, in batches;
   *   2. per child: learning sessions, ledger rows, operation receipts in batches, then progress;
   *   3. children, credentials, PIN attempts, receipts, members, game config; parent and family
   *      tombstones; deletions/{f}.
   * The subscription is ended first as a recorded event. Personal and product data go; financial
   * records stay with the linkage reduced to tombstones (RETENTION). Idempotent.
   */
  async executeDeletion(familyId, { operator, force = false, batch = DELETION_BATCH } = {}) {
    uuid(familyId); this.operator(operator);
    // phase 0 — validate, then freeze, in the FIRST mutating transaction. Nothing has moved when this
    // commits: no subscription event, no sweep. From here authorize() and login() admit nobody and a
    // payment event is recorded for reconciliation, so a crash at any later point leaves a frozen,
    // resumable family — never a terminated-but-usable one.
    const family = await this.store.transaction(async (tx) => {
      const f = await tx.get(`families/${familyId}`);
      if (!f) fail(404, 'FAMILY_NOT_FOUND');
      if (f.deleted) return f;
      if (!f.deletion) fail(409, 'NO_DELETION_PENDING');
      if (f.deletion.status === 'executing') return f; // resuming
      if (f.deletion.effectiveAt > this.now() && force !== true) fail(409, 'DELETION_NOT_DUE');
      const now = this.now();
      const checkouts = []; for (const [provider, id] of Object.entries(f.checkoutIntent || {})) if (id) checkouts.push([`checkouts/${provider}:${id}`, await tx.get(`checkouts/${provider}:${id}`)]);
      const intents = (await tx.query('billingChangeIntents', 'familyId', familyId, 100)).filter(([, i]) => i.status === 'creating'); // family-scoped lookup, not a collection scan
      const deletion = { ...f.deletion, status: 'executing', executionId: randomUUID(), startedAt: now, executedBy: operator, forced: force === true, phase: 'begun', counts: {} };
      const next = { ...f, deletion, billingIntent: null, checkoutIntent: null };
      tx.set(`families/${familyId}`, next);
      for (const [path, c] of checkouts) if (c && ['creating', 'pending'].includes(c.status)) tx.set(path, { ...c, status: 'superseded_by_deletion', supersededAt: now });
      for (const [id, i] of intents) tx.set(`billingChangeIntents/${id}`, { ...i, status: 'frozen_by_deletion', frozenAt: now });
      this.audit(tx, 'family.deletion_started', operator, familyId, { executionId: deletion.executionId, forced: force === true });
      return next;
    });
    if (family.deleted) return await this.store.get(`deletions/${familyId}`);
    // phase 0b — the subscription ends as a recorded financial event, now that nothing can revive it (a rerun finds it ended)
    if (family.subscription && ACCESS.has(deriveState(family.subscription, this.now()))) {
      // Stage 4.2: the provider stops billing first (idempotent under the execution id; a fault is recorded, never fatal — RECONCILIATION.md), then the machine records the end
      const providerCancellation = this.payments ? await this.payments.cancelAtProvider(family, `deletion:${family.deletion.executionId}`) : { provider: null, status: 'not_applicable' };
      await this.billing.apply(familyId, { id: randomUUID(), type: 'terminate' }, operator);
      await this.store.transaction(async (tx) => { const f = await tx.get(`families/${familyId}`); if (f && !f.deleted) tx.set(`families/${familyId}`, { ...f, deletion: { ...f.deletion, providerCancellation } }); });
    }
    // phase 1 — login sessions of the family and of its parents (nobody could use them: authorize and login refuse an executing family)
    const members = await this.store.entries(`families/${familyId}/members`), uids = members.map(([uid]) => uid);
    await this.sweepWhere('sessions', 'familyId', familyId, batch, familyId, 'loginSessions');
    for (const uid of uids) await this.sweepWhere('sessions', 'uid', uid, batch, familyId, 'loginSessions');
    await this.progress(familyId, 'sessions');
    // phase 2 — each child's learning and game data, bounded batches, then the progress document
    for (const childId of family.childIds || []) {
      const base = `families/${familyId}/learning/${childId}`;
      await this.sweep(`${base}/sessions`, batch, familyId, 'sessions'); await this.sweep(`${base}/ledger`, batch, familyId, 'ledgerRows'); await this.sweep(`${base}/operations`, batch, familyId, 'operations');
      await this.store.transaction(async (tx) => { if (await tx.get(base)) tx.delete(base); });
      await this.progress(familyId, `child:${childId}`);
    }
    // phase 3 — the family and its people
    return this.store.transaction(async (tx) => {
      const current = await tx.get(`families/${familyId}`); if (!current || current.deleted) return await tx.get(`deletions/${familyId}`);
      const now = this.now(), col = (c) => tx.entries(`families/${familyId}/${c}`);
      const mem = await col('members'), childDocs = await col('children'), creds = await col('credentials'), attempts = await col('pinAttempts'), receipts = await col('operations');
      const config = await tx.get(`families/${familyId}/game/config`);
      const parents = []; for (const [uid] of mem) parents.push([uid, await tx.get(`parents/${uid}`)]);
      for (const [name, rows] of [['children', childDocs], ['credentials', creds], ['pinAttempts', attempts], ['operations', receipts], ['members', mem]]) for (const [id] of rows) tx.delete(`families/${familyId}/${name}/${id}`);
      if (config) tx.delete(`families/${familyId}/game/config`);
      for (const [uid, p] of parents) if (p) tx.set(`parents/${uid}`, { deleted: true, deletedAt: now, familyId: null, reauthAfter: Math.max(p.reauthAfter || 0, Math.floor(now / 1000)), phoneKey: p.phoneKey || null, createdAt: p.createdAt || null }); // seconds, like login()
      const counts = { ...(current.deletion.counts || {}), children: childDocs.length };
      const deletion = { ...current.deletion, status: 'done', phase: 'done', executedAt: now, counts };
      tx.set(`families/${familyId}`, { id: familyId, deleted: true, deletedAt: now, deletedBy: current.deletion.executedBy || operator, createdAt: current.createdAt || null, phoneKey: current.phoneKey || null, billing: current.billing || null, providerCustomer: current.providerCustomer || null,
        subscription: current.subscription || null, childIds: [], activeChildIds: [], deletion, retention: Object.keys(RETENTION) });
      const record = { familyId, requestedAt: current.deletion.requestedAt, requestedBy: current.deletion.requestedBy, startedAt: current.deletion.startedAt, executedAt: now, executedBy: current.deletion.executedBy || operator, executionId: current.deletion.executionId, forced: current.deletion.forced === true, counts, providerCancellation: current.deletion.providerCancellation || null, retained: RETENTION };
      tx.set(`deletions/${familyId}`, record);
      this.audit(tx, 'family.deleted', operator, familyId, { counts });
      return record;
    });
  }
}
