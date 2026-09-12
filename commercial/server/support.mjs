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
import { Fault, fail, object, uuid, text } from './security.mjs';
import { normalizeProgress, freshProgress } from './progress.mjs';
import { reconcile } from './ledger.mjs';
import { deriveState, effectiveEntitlement } from './subscription.mjs';
import { sweepSessions, RECOVERY_WINDOW_MS } from './recovery.mjs';
import { INTENT_INFLIGHT_MS, AWAITING_PAYMENT_MS } from './payments.mjs';
import { prefsOf, prefsPath } from './email.mjs';

const DAY = 86_400_000, AUDIT_RETENTION_MS = 400 * DAY;
export const DELETION_GRACE_MS = 14 * DAY;
// How long after a pause's resume date the sweep waits before naming it: the provider raises its first invoice then, and a
// payment takes a few days to fail through dunning. Sooner would name every family in the week its pause ends.
export const GRACE_AFTER_PAUSE_MS = 7 * DAY;
export const INTENT_OUTCOMES = Object.freeze(['no_provider_change', 'provider_reverted', 'applied_by_operator', 'refunded']);
/** What deletion keeps, and why. */
export const RETENTION = Object.freeze({
  'families/{f}/billing/*': 'financial record of every subscription event',
  'families/{f}/leaving/*': 'why a family left: the reason, the offers shown and taken, the action, the plan, the seats and the creation month, with the parent\'s own words removed at deletion; names nobody and expires by TTL 400 days after each record',
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
  'sweeps/*': 'the routine invariant sweep: counts and findings; expires by TTL 90 days after each run',
  'emailPrefs/{uid}': 'the parent account\'s email choices and their history (the consent record): the sign-in account outlives the family; deleted with that account',
  'reports/*': 'weekly report status per family and week (sent or skipped, attempts, provider message id; no content); expires by TTL 400 days after each week',
  'feedback/* (sent signed out)': 'notes from the sign-in screen name no family and no account, so no export carries them and no deletion finds them, even one with an address to answer; they expire by TTL 400 days after each (a parent\'s own notes go with the family or the sign-in account)',
  'feedback copies (the owner\'s mailbox, Resend\'s log)': 'the emailed copy of a note, its words and the parent\'s address as Reply-To, lives outside this service: in the owner\'s mailbox for as long as the owner keeps it and in Resend\'s log for its own retention; no family or account deletion reaches it',
});
export const DELETION_BATCH = 300; // comfortably under Firestore's 500 writes per transaction
const ACCESS = new Set(['trial', 'active', 'grace']);
const flagged = (docs, key, values) => docs.filter((d) => values.includes(d[key]));
// What an operator can establish about an inbox row the server could not apply (Stage 4.2), after acting at the provider.
export const EVENT_OUTCOMES = Object.freeze(['refunded_at_provider', 'cancelled_at_provider', 'applied_by_operator', 'no_action_needed']);
const OPEN_EVENT = new Set(['reconciliation_required', 'rejected', 'requires_action']); // requires_action: waiting on a server-side action that may never come (a checkout abandoned) — resolvable, and taken off the customer's pending list

// The audit collection is every family's, TTL 400 days; one family writes a few rows a day, so the cap is years of rows.
const AUDIT_PAGE = 1000, AUDIT_CAP = 50_000;
export class Support {
  constructor({ foundation, store, billing = null, payments = null, now = Date.now, auditPage = AUDIT_PAGE, auditCap = AUDIT_CAP }) {
    this.auditPage = auditPage; this.auditCap = auditCap;
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
    // The v2 rocket import's one-shot marker (server/migrate.mjs) is operator bookkeeping, not the family's
    // data, and this is the one response that carries the game config as stored: it stays out.
    const stored = await tx.get(`families/${f}/game/config`);
    const config = stored ? Object.fromEntries(Object.entries(stored).filter(([k]) => k !== 'rocketMigration')) : null;
    const billing = (await tx.list(`families/${f}/billing`)).sort((a, b) => a.at - b.at)
      .map((e) => ({ id: e.id, type: e.type, plan: e.plan, periodEnd: e.periodEnd, amountCents: e.amountCents ?? null, at: e.at, actor: e.actor, state: e.result?.state || null }));
    // email-v1: the owner's email choices, with their history; the address itself stays with the identity provider
    const emailPrefs = [];
    for (const [owner, m] of await tx.entries(`families/${f}/members`)) if (m.role === 'owner') { const d = await tx.get(prefsPath(owner)); emailPrefs.push({ uid: owner, ...prefsOf(d), version: d?.version || null, updatedAt: d?.updatedAt || null, changes: d?.changes || [] }); }
    // the notes this family's parents sent with Send feedback (feedback.mjs), oldest first; one sent signed out names no family and is not here
    const feedback = [];
    for (let after = null; ;) {
      const page = await tx.queryAfter('feedback', 'familyId', f, after, this.auditPage);
      for (const [id, d] of page) feedback.push({ id, at: d.at, page: d.page, text: d.text, uid: d.uid || null, release: d.release || null });
      if (page.length < this.auditPage) break; after = page.at(-1)[0];
    }
    feedback.sort((a, b) => a.at - b.at);
    // Leaving (12 Sep 2026): every cancel-or-pause flow this family went through, oldest first, the parent's own words included
    const leaving = (await tx.entries(`families/${f}/leaving`, 100)).map(([, r]) => r).sort((a, b) => a.at - b.at);
    const trail = await this.familyAudit(tx, f), audit = trail.rows.map((a) => ({ action: a.action, at: a.at, childId: a.childId || null })); // every row of this family's, in pages (fourth round)
    return { exportedAt: this.now(), exportedBy: uid,
      family: { id: f, label: family.label, createdAt: family.createdAt, timeZone: family.timeZone || null, activeChildIds: family.activeChildIds || [], deletion: family.deletion || null },
      entitlement: effectiveEntitlement(family, this.now()), subscription: family.subscription || null, billing, gameConfig: config || null, children, emailPrefs, feedback, leaving, audit, auditTruncated: trail.truncated };
  }
  /** The rows of one collection with `field` equal to `value`, read in pages under the reader given (a transaction or the store); `truncated` only past the cap — and then the rows kept are the first by document id, not by time (the cap is years of use; SUPPORT.md). Never a whole collection: one family's rows cost one family's reads (fifth round). */
  async pagedBy(reader, collection, field, value) {
    const rows = []; let after = null, truncated = false;
    for (;;) {
      const page = await reader.queryAfter(collection, field, value, after, this.auditPage);
      for (const [, a] of page) rows.push(a);
      if (rows.length > this.auditCap) { truncated = true; break; } // strictly past the cap: exactly the cap is every row
      if (page.length < this.auditPage) break;
      after = page.at(-1)[0];
    }
    return { rows: rows.slice(0, this.auditCap), truncated };
  }
  /** Every audit row of one family, oldest first. */
  async familyAudit(reader, familyId) { const r = await this.pagedBy(reader, 'audit', 'familyId', familyId); return { rows: r.rows.sort((a, b) => a.at - b.at), truncated: r.truncated }; }
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
  /**
   * Step one, in the caller's transaction: the marker that closes the door. From this write on,
   * login() and authorize() refuse the uid (ACCOUNT_DELETED), so the sweep and the provider call
   * that follow can fail and be retried without a fresh token reopening anything (Stage 4 review).
   */
  beginIdentityDeletion(tx, uid, parent, actor) {
    const now = this.now();
    tx.set(`parents/${uid}`, { ...parent, deleted: true, deletedAt: parent.deletedAt || now, familyId: null, reauthAfter: Math.max(parent.reauthAfter || 0, Math.floor(now / 1000)), phoneKey: parent.phoneKey || null,
      identityDeletion: { requestedAt: parent.identityDeletion?.requestedAt || now, requestedBy: parent.identityDeletion?.requestedBy || actor, deletedAt: parent.identityDeletion?.deletedAt || null } });
    tx.delete(prefsPath(uid)); // email-v1: the account's email choices go with it; nothing is sent to an account being deleted
    this.audit(tx, 'account.deletion_started', actor, null, { subject: uid });
    return { uid };
  }
  /** Steps two and three: every session of the uid in bounded batches, the identity at the provider, then the record. A provider fault leaves requestedAt without deletedAt; the operator retries. */
  async finishIdentityDeletion(uid, actor) {
    const sessions = await sweepSessions(this.store, uid, DELETION_BATCH);
    await this.sweepWhere('feedback', 'uid', uid, DELETION_BATCH, null, 'feedback'); // the notes the account sent (those with a family went with it)
    try { await this.foundation.identity.deleteUser(uid); }
    catch (error) { if (error?.code === 'auth/user-not-found' || /not.found|missing/i.test(String(error?.message))) { /* already gone at the provider: finish the record */ } else throw error; }
    return this.store.transaction(async (tx) => {
      const parent = await tx.get(`parents/${uid}`), now = this.now();
      const record = { ...parent, identityDeletion: { ...(parent.identityDeletion || { requestedAt: now, requestedBy: actor }), deletedAt: now } };
      tx.set(`parents/${uid}`, record);
      this.audit(tx, 'account.deleted', actor, null, { subject: uid, sessions });
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
    const refs = new Set(customers.map((c) => c.ref)), truncated = [], paged = async (collection, field, value) => { const r = await this.pagedBy(this.store, collection, field, value); if (r.truncated && !truncated.includes(collection)) truncated.push(collection); return r.rows; }; // the family's rows only, never the whole collection (fifth round)
    const inboxRows = []; for (const ref of refs) inboxRows.push(...(await paged('billingEvents', 'customer', ref)));
    const inbox = inboxRows.sort((a, b) => (a.at - b.at) || ((a.receivedAt || 0) - (b.receivedAt || 0)) || (a.providerEventId < b.providerEventId ? -1 : a.providerEventId > b.providerEventId ? 1 : 0)) // deterministic: time, receipt, then id
      .map((e) => ({ id: e.providerEventId, provider: e.provider, type: e.type, at: e.at, attempts: e.attempts, outcome: e.outcome }));
    const intents = (await paged('billingChangeIntents', 'familyId', familyId)).sort((a, b) => a.createdAt - b.createdAt)
      .map((i) => ({ operationId: i.operationId, provider: i.provider, kind: i.kind, fromPlan: i.fromPlan, toPlan: i.toPlan, status: i.status, providerOperationRef: i.providerOperationRef || null, providerAnsweredAt: i.providerAnsweredAt || null, reconciliation: i.reconciliation || null, createdAt: i.createdAt }));
    const checkouts = (await paged('checkouts', 'familyId', familyId)).sort((a, b) => a.createdAt - b.createdAt)
      .map((c) => ({ checkoutId: c.checkoutId, provider: c.provider, plan: c.plan, status: c.status, providerCheckoutRef: c.providerCheckoutRef || null, supersededBy: c.supersededBy || null, expiredByDeletion: c.expiredByDeletion || null, createdAt: c.createdAt }));
    const billing = (await this.store.list(`families/${familyId}/billing`)).sort((a, b) => a.at - b.at).map((e) => ({ id: e.id, type: e.type, plan: e.plan, at: e.at, actor: e.actor, state: e.result?.state || null }));
    const trail = await this.familyAudit(this.store, familyId), audit = trail.rows.map((a) => ({ action: a.action, uid: a.uid, at: a.at, childId: a.childId || null })), auditTruncated = trail.truncated; // every row, in pages (fourth round)
    const reconciliations = await paged('billingReconciliations', 'familyId', familyId);
    const providerChecks = reconciliations.filter((r) => r.kind === 'provider_state').sort((a, b) => b.at - a.at);
    const members = family.deleted ? [] : await this.store.entries(`families/${familyId}/members`), recoveries = []; // Stage 4.4: the parents' recovery requests
    for (const [uid] of members) { const r = await this.store.get(`recoveries/${uid}`); if (r) recoveries.push({ uid, status: r.status, requestedAt: r.requestedAt, readyAt: r.readyAt, cancelledBy: r.cancelledBy || null }); }
    const sub = family.subscription || null;
    const attention = {
      requiresAction: inbox.filter((e) => e.outcome?.status === 'requires_action').length,
      reconciliationRequired: inbox.filter((e) => e.outcome?.status === 'reconciliation_required' && !e.outcome.resolution).length, // late provider events on a deleted family, until resolve-event
      rejected: inbox.filter((e) => e.outcome?.status === 'rejected' && !e.outcome.resolution).length,
      providerCheck: providerChecks[0] ? { at: providerChecks[0].at, match: providerChecks[0].match, findings: providerChecks[0].findings.map((x) => x.code) } : null, // the latest reconcile-provider run
      openIntents: flagged(intents, 'status', ['creating', 'awaiting_payment', 'stale', 'superseded', 'frozen_by_deletion']).map((i) => i.operationId),
      openCheckouts: flagged(checkouts, 'status', ['creating', 'superseded', 'superseded_by_deletion']).map((c) => c.checkoutId),
      inFlight: family.billingIntent || null, liveCheckout: family.checkoutIntent || null,
      ledgerDamaged: children.filter((c) => c.ledger?.damaged).map((c) => c.id), ledgerDrift: children.filter((c) => c.ledger && !c.ledger.match && !c.ledger.damaged).map((c) => c.id),
      deletion: family.deletion || null, deleted: family.deleted === true,
      pendingRecoveries: recoveries.filter((r) => r.status === 'pending').map((r) => r.uid),
      seatOverflow: (() => { const e = effectiveEntitlement(family, now); return !!e && e.status === 'active' && e.accessUntil > now && (family.activeChildIds || []).length > e.seatLimit; })(), // never true unless data was damaged: every access and every event enforces it
      refundFailures: inbox.filter((e) => e.type === 'refund.failed').length, // a refund the provider could not complete: access already ended; the operator decides
      disputesWon: inbox.filter((e) => e.type === 'dispute.won').length,      // the money came back after a dispute ended access; the operator may restore it
    };
    return { familyId, deleted: family.deleted === true, label: family.deleted ? null : family.label, createdAt: family.createdAt, phoneKey: family.phoneKey || null, timeZone: family.timeZone || null,
      entitlement: effectiveEntitlement(family, now), subscription: sub ? { ...sub, state: deriveState(sub, now) } : null, manualGrant: family.entitlement || null,
      children, customers, inbox, intents, checkouts, billing, reconciliations, recoveries, audit, auditTruncated, truncated, attention };
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
    for (const provider of new Set([...Object.keys(family.billing || {}), ...Object.keys(family.providerCustomer || {})])) for (const r of await this.payments.reprocessFamily(provider, familyId)) results.push({ provider, ...r });
    await this.store.transaction(async (tx) => {
      const row = await tx.get(`supportOperations/${id}`);
      tx.set(`supportOperations/${id}`, { ...row, status: 'done', results: results.map((r) => ({ provider: r.provider, id: r.id, status: r.status, reason: r.reason || null })), finishedAt: this.now() });
      this.audit(tx, 'support.reprocess', operator, familyId, { operationId: id, results: results.map((r) => `${r.id}:${r.status}`) });
    });
    return results;
  }
  /**
   * The routine sweep (RECONCILIATION.md → Routine sweep): every family, every customer mapping, the inbox,
   * against the invariants the code enforces at each access and each event — so anything that slipped past
   * them, or was damaged, shows up somewhere a person looks daily. Read-only; one `sweeps/{id}` record and one
   * audit row per run. Walks collections in pages of `batch`; keeps at most `maxFindings` findings in the
   * record (the counts are complete). The CLI exits non-zero when there is a finding, so a scheduled run fails
   * visibly.
   */
  async inspectAll({ operator, batch = 100, maxFindings = 200 } = {}) {
    this.operator(operator);
    const now = this.now(), startedAt = now, findings = [], counts = { families: 0, tombstones: 0, children: 0, activeChildren: 0, parents: 0, customerLinks: 0, customerMappings: 0, openIntents: 0, liveCheckouts: 0, openRecoveries: 0, inboxWaiting: 0, inboxReconciliation: 0, findings: 0 };
    const add = (code, family, detail) => { counts.findings++; if (findings.length < maxFindings) findings.push({ code, family, detail }); };
    for (let after = null; ;) {
      const page = await this.store.entriesAfter('families', after, batch);
      for (const [id, f] of page) await this.inspectFamily(id, f, now, add, counts);
      if (page.length < batch) break; after = page.at(-1)[0];
    }
    for (let after = null; ;) { // every provider customer must point at a family that points back (NO_TRANSFER)
      const page = await this.store.entriesAfter('billingCustomers', after, batch);
      for (const [id, m] of page) {
        counts.customerMappings++;
        const fam = m.familyId ? await this.store.get(`families/${m.familyId}`) : null;
        if (!fam) add('ORPHAN_CUSTOMER', m.familyId || null, `${id} points at no family`);
        else if (!(fam.billing?.[m.provider] === m.customerRef || fam.providerCustomer?.[m.provider] === m.customerRef || (m.aliasOf && fam.billing?.[m.provider] === m.aliasOf))) add('CUSTOMER_NOT_ON_FAMILY', m.familyId, id);
      }
      if (page.length < batch) break; after = page.at(-1)[0];
    }
    for (let after = null; ;) { // the inbox: what still waits on somebody
      const page = await this.store.entriesAfter('billingEvents', after, batch);
      for (const [eid, e] of page) {
        if (e.outcome?.status === 'requires_action') { counts.inboxWaiting++; if ((e.lastReceivedAt || e.receivedAt || 0) < now - DAY) add('INBOX_WAITING_STALE', e.familyId || null, `${eid}: ${e.outcome.reason} since ${new Date(e.receivedAt || 0).toISOString()} — the server-side action it waits for never came: reprocess, or resolve-event`); } // a day is longer than any parent action takes
        if (e.outcome?.status === 'reconciliation_required' && !e.outcome.resolution) counts.inboxReconciliation++;
      }
      if (page.length < batch) break; after = page.at(-1)[0];
    }
    const id = randomUUID(), record = { id, kind: 'sweep', operator, startedAt, finishedAt: this.now(), counts, findings, truncated: counts.findings > findings.length, expireAt: now + 90 * DAY };
    await this.store.transaction(async (tx) => { tx.set(`sweeps/${id}`, record); this.audit(tx, 'support.sweep', operator, null, { sweepId: id, findings: counts.findings, families: counts.families }); });
    return record;
  }
  /** One family against the invariants: seats, children, members and parents, provider links, subscription facts, open work. */
  async inspectFamily(id, f, now, add, counts) {
    if (f.deleted === true) {
      counts.tombstones++;
      if ((await this.store.entries(`families/${id}/children`, 1)).length) add('TOMBSTONE_RESIDUE', id, 'a child document remains');
      if ((await this.store.entries(`families/${id}/learning`, 1)).length) add('TOMBSTONE_RESIDUE', id, 'a learning document remains');
      if ((await this.store.query('sessions', 'familyId', id, 1)).length) add('TOMBSTONE_RESIDUE', id, 'a session remains');
      const pc = f.deletion?.providerCancellation || null, hadProvider = !!f.subscription && f.subscription.plan !== 'trial' && !!f.subscription.provider && !!f.billing?.[f.subscription.provider];
      if (pc?.status === 'failed' || (hadProvider && !pc)) add('DELETED_FAMILY_PROVIDER_LIVE', id, pc ? 'the provider subscription was not ended at deletion: reconcile-provider, then cancel at the provider' : 'the deletion never asked the provider to end the subscription: reconcile-provider, then cancel at the provider');
      for (const c of (await this.pagedBy(this.store, 'checkouts', 'familyId', id)).rows) { // a session the deletion could not expire, a subscription made beyond the record it could not end
        if (!['superseded', 'superseded_by_deletion'].includes(c.status)) continue;
        const gw = this.payments?.gateways && Object.hasOwn(this.payments.gateways, c.provider) ? this.payments.gateways[c.provider] : null, ref = c.providerCheckoutRef || c.lateSessionRef || null;
        if (c.expiredByDeletion && c.expiredByDeletion.expired !== true && c.expiredByDeletion.reason !== 'SESSION_COMPLETED') {
          // asked again each night: a provider back, or a session the operator expired by hand, settles the record
          let settled = false;
          if (gw && ref && typeof gw.cancelCheckout === 'function') { try { const o = await gw.cancelCheckout(ref); if (o.expired === true) { settled = true; await this.store.transaction(async (tx) => { const cur = await tx.get(`checkouts/${c.provider}:${c.checkoutId}`); if (cur) tx.set(`checkouts/${c.provider}:${c.checkoutId}`, { ...cur, expiredByDeletion: { ...o, at: this.now() } }); }); } } catch { /* named below */ } }
          if (!settled) add('DELETED_FAMILY_PROVIDER_LIVE', id, `the hosted session of checkout ${c.checkoutId} could not be expired at deletion (${c.expiredByDeletion.reason || 'no reason'}): expire it at the provider`);
        }
        const made = c.paymentPending?.subscriptionRef || (c.expiredByDeletion?.reason === 'SESSION_COMPLETED' ? c.expiredByDeletion.subscriptionRef : null) || null;
        if (made && !(c.endedByDeletion?.cancelled === true)) add('DELETED_FAMILY_PROVIDER_LIVE', id, `checkout ${c.checkoutId} made subscription ${made} (paid on a superseded session, or its payment clearing) and it was not ended at deletion: cancel it at the provider`);
      }
      return;
    }
    counts.families++;
    // a refusal on the provider's truth (two live subscriptions, a subscription the family does not know) marked the family: the
    // operator resolves it at the provider and reconcile-provider clears the mark once the provider is clean
    if (f.providerAttention && f.providerAttention.at > now - 7 * DAY) { counts.providerAttention = (counts.providerAttention || 0) + 1; add('PROVIDER_ATTENTION', id, `${f.providerAttention.code} on ${new Date(f.providerAttention.at).toISOString()}: reconcile-provider, resolve at the provider, reconcile again`); }
    const active = f.activeChildIds || [], childIds = f.childIds || [], e = effectiveEntitlement(f, now), live = !!e && e.status === 'active' && e.accessUntil > now;
    counts.children += childIds.length; counts.activeChildren += active.length;
    if (live && active.length > e.seatLimit) add('SEAT_OVERFLOW', id, `${active.length} active children for ${e.seatLimit} seats`);
    if (new Set(active).size !== active.length) add('DUPLICATE_SEAT', id, 'a child seated twice');
    for (const c of active) if (!childIds.includes(c)) add('ACTIVE_NOT_A_CHILD', id, c);
    const children = await this.store.entries(`families/${id}/children`, 100);
    if (children.length !== childIds.length) add('CHILD_LIST_MISMATCH', id, `${children.length} documents, ${childIds.length} listed`);
    for (const [cid, c] of children) {
      if (!childIds.includes(cid)) add('CHILD_NOT_LISTED', id, cid);
      const seated = active.includes(cid);
      if (seated && c.status !== 'active') add('SEATED_CHILD_INACTIVE', id, cid);
      if (!seated && c.status === 'active') add('ACTIVE_CHILD_UNSEATED', id, cid);
      const prog = await this.store.get(`families/${id}/learning/${cid}`);
      if (prog) {
        const led = reconcile(await this.store.list(`families/${id}/learning/${cid}/ledger`), normalizeProgress(prog).wallet);
        if (led?.damaged) add('LEDGER_DAMAGED', id, cid); else if (led && !led.match) add('LEDGER_DRIFT', id, cid);
      }
    }
    const members = await this.store.entries(`families/${id}/members`, 20);
    if (!members.some(([, m]) => m.role === 'owner' && m.status === 'active')) add('NO_OWNER', id, 'no active owner member');
    for (const [uid, m] of members) {
      counts.parents++;
      const p = await this.store.get(`parents/${uid}`);
      if (!p) { add('MEMBER_WITHOUT_PARENT', id, uid); continue; }
      if (m.status === 'active' && p.familyId !== id) add('PARENT_LINK_MISMATCH', id, `${uid} points at ${p.familyId || 'no family'}`);
      if (m.status === 'active' && p.identityDeletion) add('DELETED_ACCOUNT_STILL_MEMBER', id, uid);
      const rec = await this.store.get(`recoveries/${uid}`);
      if (rec && (rec.status === 'pending' || rec.status === 'completing')) { counts.openRecoveries++; if (rec.status === 'completing' && rec.claimedAt < now - 3_600_000) add('RECOVERY_STUCK', id, `${uid}: claimed ${new Date(rec.claimedAt).toISOString()}, never completed`); if (rec.status === 'pending' && rec.readyAt + RECOVERY_WINDOW_MS < now) add('RECOVERY_LAPSED', id, uid); }
    }
    for (const [provider, ref] of [...Object.entries(f.billing || {}), ...Object.entries(f.providerCustomer || {})]) {
      counts.customerLinks++;
      const m = await this.store.get(`billingCustomers/${provider}:${ref}`);
      if (!m) add('CUSTOMER_MAPPING_MISSING', id, `${provider}:${ref}`); else if (m.familyId !== id) add('CUSTOMER_MAPPING_MISMATCH', id, `${provider}:${ref} points at ${m.familyId}`);
    }
    const sub = f.subscription || null;
    if (sub) {
      const state = deriveState(sub, now);
      if (sub.periodEnd && sub.periodEnd > now + 400 * DAY) add('SUBSCRIPTION_PERIOD_ABSURD', id, new Date(sub.periodEnd).toISOString());
      if (['active', 'grace', 'past_due'].includes(state) && sub.plan !== 'trial' && sub.provider !== 'manual' && !f.billing?.[sub.provider]) add('PAID_WITHOUT_CUSTOMER', id, `${state} on ${sub.plan} via ${sub.provider}, no customer reference`);
      // Leaving (12 Sep 2026): a paused family is reported, never counted as churn. A pause the provider never echoed, or one
      // whose resume date has passed with no invoice since, is named: the family is waiting for money that is not coming.
      if (sub.pause) {
        counts.paused = (counts.paused || 0) + 1;
        if (sub.pause.echoed !== true && sub.pause.pausedAt < now - DAY) add('PAUSE_NOT_ECHOED', id, `paused ${new Date(sub.pause.pausedAt).toISOString()} and the provider has never echoed it: reconcile-provider`);
        if (Number.isSafeInteger(sub.pause.resumesAt) && sub.pause.resumesAt < now - GRACE_AFTER_PAUSE_MS) add('PAUSE_OVERDUE', id, `collection should have resumed ${new Date(sub.pause.resumesAt).toISOString()} and no invoice has been paid since: reconcile-provider`);
      }
    }
    for (const [, i] of await this.store.query('billingChangeIntents', 'familyId', id, 100)) {
      if (['creating', 'awaiting_payment', 'stale', 'superseded', 'frozen_by_deletion'].includes(i.status)) counts.openIntents++;
      if (i.status === 'creating' && i.createdAt < now - 5 * INTENT_INFLIGHT_MS) add('STALE_INTENT', id, i.operationId);
      if (i.status === 'awaiting_payment' && i.awaitingSince < now - AWAITING_PAYMENT_MS) add('LAPSED_AWAITING_PAYMENT', id, i.operationId);
    }
    for (const [provider, cid] of Object.entries(f.checkoutIntent || {})) {
      if (!cid) continue; counts.liveCheckouts++;
      const c = await this.store.get(`checkouts/${provider}:${cid}`);
      if (!c) add('CHECKOUT_MISSING', id, `${provider}:${cid}`); else if (['creating', 'pending'].includes(c.status) && c.createdAt < now - DAY) add('STALE_CHECKOUT', id, cid);
    }
    if (f.billingIntent && f.billingIntent.at < now - AWAITING_PAYMENT_MS) add('STALE_INFLIGHT_MARKER', id, f.billingIntent.operationId);
    if (f.deletion && !['executing', 'done'].includes(f.deletion.status || '') && f.deletion.effectiveAt && f.deletion.effectiveAt < now) add('DELETION_DUE', id, `effective ${new Date(f.deletion.effectiveAt).toISOString()}: run delete`);
    if (f.deletion?.status === 'executing' && f.deletion.startedAt < now - 3_600_000) add('DELETION_STUCK', id, `started ${new Date(f.deletion.startedAt).toISOString()}: rerun delete`);
  }
  /** Stage 4.4: the operator's only recovery verb — protective and audited; nothing here removes a factor or completes a request (RECOVERY.md). */
  async cancelRecovery(uid, operator, note) {
    text(uid, 1, 128); this.operator(operator); text(note, 1, 500);
    return this.store.transaction(async (tx) => {
      const rec = await tx.get(`recoveries/${uid}`); if (!rec) fail(404, 'RECOVERY_NOT_FOUND');
      if (rec.status !== 'pending') fail(409, 'RECOVERY_NOT_PENDING');
      const parent = await tx.get(`parents/${uid}`), next = { ...rec, status: 'cancelled_by_operator', cancelledAt: this.now(), cancelledBy: operator, note };
      tx.set(`recoveries/${uid}`, next);
      this.audit(tx, 'support.recovery_cancelled', operator, parent?.familyId || null);
      return next;
    });
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
    const local = { state, plan: sub?.plan || null, scheduledPlan: sub?.scheduled?.plan || null, periodEnd: sub?.periodEnd || null, cancelAtPeriodEnd: !!sub?.cancelAtPeriodEnd, provider: sub?.provider || null, providerRef: sub?.providerRef || null, version: sub?.version ?? null,
      paused: !!sub?.pause, pauseResumesAt: sub?.pause?.resumesAt ?? null, pauseEchoed: sub?.pause?.echoed === true };
    // A paused subscription is still live at the provider — collection is paused, the subscription is not — so the record still
    // expects one; `paused` is the state the family is in once the paid period has run out (deriveState).
    const wantsProvider = !!sub && sub.plan !== 'trial' && ['active', 'grace', 'past_due', 'paused'].includes(state) && !gone; // the family's record says a provider subscription should be live
    const providers = [];
    for (const [provider, ref] of Object.entries(family.billing || {})) {
      const st = this.payments ? await this.payments.providerState(provider, ref, family.providerCustomer?.[provider] || null) : { provider, available: false };
      const findings = [], add = (code, detail) => findings.push({ code, detail }), relevant = local.provider === provider, ps = st.subscription || null, live = ps?.live === true;
      if (!st.available) add('PROVIDER_STATE_UNAVAILABLE', 'this adapter cannot report provider state');
      else if (st.error) add('PROVIDER_UNREACHABLE', st.error);
      else if (st.simulated) { /* the fake provider holds nothing to compare */ }
      else if (!st.customer) { if (wantsProvider && relevant) add('NO_PROVIDER_CUSTOMER', `the family is ${state} on ${local.plan}; the provider knows no customer for its reference`); }
      else if (st.multiple) add('MULTIPLE_PROVIDER_SUBSCRIPTIONS', `${st.liveCount} live subscriptions at the provider (${(st.subscriptions || []).map((x) => `${x.ref} ${x.plan || x.price}`).join(', ')}): cancel the wrong one in the dashboard, then reconcile again — plan changes, cancellations, deletions and checkouts fail closed until then`);
      else if (!live) { if (wantsProvider && relevant) add('NO_PROVIDER_SUBSCRIPTION', `the family is ${state} on ${local.plan}; the provider has ${ps ? `a ${ps.status}` : 'no'} subscription`); }
      else if (gone) add('DELETED_FAMILY_PROVIDER_LIVE', `the family is deleted; the provider's subscription ${ps.ref} is ${ps.status} — cancel it there, then resolve-event its late notice`);
      else if (!wantsProvider) add('PROVIDER_SUBSCRIPTION_LIVE', `the family is ${state}; the provider's subscription ${ps.ref} is ${ps.status}`);
      else {
        if (!ps.plan) add('UNKNOWN_PROVIDER_PRICE', `${ps.price} is not one of the adapter's prices`);
        else if (ps.plan !== local.plan && ps.plan !== local.scheduledPlan) add('PLAN_MISMATCH', `provider ${ps.plan}; family ${local.plan}${local.scheduledPlan ? ` (scheduled ${local.scheduledPlan})` : ''}`);
        if (ps.periodEnd && local.periodEnd && Math.abs(ps.periodEnd - local.periodEnd) > 60_000) add('PERIOD_END_MISMATCH', `provider ${new Date(ps.periodEnd).toISOString()}; family ${new Date(local.periodEnd).toISOString()}`);
        if (ps.cancelAtPeriodEnd !== local.cancelAtPeriodEnd) add('CANCEL_FLAG_MISMATCH', `provider cancel at period end ${ps.cancelAtPeriodEnd}; family ${local.cancelAtPeriodEnd}`);
        // The provider is the authority on a pause: paused there and not here would charge nothing and grant access; paused here
        // and not there would charge a family that was told it would not be charged. Either way the operator resolves it.
        if (ps.paused === true && !local.paused) add('PAUSE_MISMATCH', `the provider has collection paused on ${ps.ref}${ps.pauseResumesAt ? ` until ${new Date(ps.pauseResumesAt).toISOString()}` : ' with no resume date'}; the family's record is not paused`);
        else if (ps.paused === false && local.paused) add('PAUSE_MISMATCH', `the family is paused${local.pauseResumesAt ? ` until ${new Date(local.pauseResumesAt).toISOString()}` : ''}; the provider is collecting as usual on ${ps.ref}`);
        else if (ps.paused === true && local.paused && ps.pauseResumesAt !== local.pauseResumesAt) add('PAUSE_RESUME_MISMATCH', `provider ${ps.pauseResumesAt ? new Date(ps.pauseResumesAt).toISOString() : 'no resume date'}; family ${local.pauseResumesAt ? new Date(local.pauseResumesAt).toISOString() : 'no resume date'}`);
        if (ps.paused === true && ps.pauseBehavior && ps.pauseBehavior !== 'void') add('PAUSE_BEHAVIOUR', `the provider's pause is "${ps.pauseBehavior}", not "void": an invoice raised now would be collected later`);
      }
      providers.push({ provider, ref, available: st.available, simulated: st.simulated === true, error: st.error || null, customer: st.customer || null, customerDeleted: st.customerDeleted === true, subscription: ps, liveCount: st.liveCount ?? null, findings });
    }
    const target = (i) => (i.kind === 'clear' ? i.fromPlan : i.toPlan);
    const intents = (await this.store.query('billingChangeIntents', 'familyId', familyId, 100)).map(([, i]) => i).filter((i) => ['creating', 'awaiting_payment', 'stale', 'superseded', 'frozen_by_deletion'].includes(i.status)).sort((a, b) => a.createdAt - b.createdAt)
      .map((i) => { const p = providers.find((x) => x.provider === i.provider), ps = p?.subscription; return { operationId: i.operationId, provider: i.provider, kind: i.kind, fromPlan: i.fromPlan, toPlan: i.toPlan, status: i.status, providerOperationRef: i.providerOperationRef || null,
        providerEvidence: !p || !p.available || p.simulated || p.error ? 'unknown' : (p.liveCount || 0) > 1 ? 'ambiguous_multiple_subscriptions' : !ps?.live ? 'no_live_provider_subscription' : ps.plan === target(i) ? 'provider_on_target_plan' : 'provider_on_other_plan' }; });
    const findings = providers.flatMap((p) => p.findings.map((x) => ({ provider: p.provider, ...x }))), compared = providers.some((p) => p.available && !p.simulated && !p.error);
    const id = randomUUID(), record = { id, kind: 'provider_state', familyId, deleted: family.deleted === true, operator, at: now, local, providers, intents, findings, match: compared ? findings.length === 0 : null };
    await this.store.transaction(async (tx) => {
      const current = await tx.get(`families/${familyId}`);
      if (current?.providerAttention && record.match === true) tx.set(`families/${familyId}`, { ...current, providerAttention: null }); // the provider is clean again: the mark goes
      tx.set(`billingReconciliations/${id}`, record); this.audit(tx, 'support.provider_reconciled', operator, familyId, { reconciliationId: id, findings: findings.map((x) => x.code), match: record.match });
    });
    return { ...record, attentionCleared: record.match === true };
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
      const mappingPath = r.outcome.status === 'requires_action' && r.customer ? `billingCustomers/${provider}:${r.customer}` : null, mapping = mappingPath ? await tx.get(mappingPath) : null;
      const id = randomUUID(), now = this.now();
      if (mapping && (mapping.pending || []).includes(eventId)) tx.set(mappingPath, { ...mapping, pending: mapping.pending.filter((x) => x !== eventId) }); // a resolved event is never processed again
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
      if (!['creating', 'awaiting_payment', 'stale', 'superseded', 'frozen_by_deletion'].includes(intent.status)) fail(409, 'INTENT_NOT_OPEN');
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
      const intents = (await tx.query('billingChangeIntents', 'familyId', familyId, 100)).filter(([, i]) => i.status === 'creating' || i.status === 'awaiting_payment'); // family-scoped lookup, not a collection scan
      const deletion = { ...f.deletion, status: 'executing', executionId: randomUUID(), startedAt: now, executedBy: operator, forced: force === true, phase: 'begun', counts: {} };
      const next = { ...f, deletion, billingIntent: null, checkoutIntent: null };
      tx.set(`families/${familyId}`, next);
      for (const [path, c] of checkouts) if (c && ['creating', 'pending'].includes(c.status)) tx.set(path, { ...c, status: 'superseded_by_deletion', supersededAt: now });
      for (const [id, i] of intents) tx.set(`billingChangeIntents/${id}`, { ...i, status: 'frozen_by_deletion', frozenAt: now });
      this.audit(tx, 'family.deletion_started', operator, familyId, { executionId: deletion.executionId, forced: force === true });
      return next;
    });
    if (family.deleted) return await this.store.get(`deletions/${familyId}`);
    // phase 0b — first the hosted sessions the freeze superseded are expired at the provider (best effort, recorded on each
    // checkout; a rerun finds the ones not yet done): a page still open in the parent's browser must not buy a subscription for a
    // family that is being deleted (fifth round). Then the subscription ends as a recorded financial event, now that nothing can
    // revive it (a rerun finds it ended).
    const endings = []; // subscriptions made beyond the family's record — by a session that completed while its payment cleared, or paid on a superseded session — ended here
    const endFor = async (gw, id, c, subscriptionRef) => {
      let r; try { r = await gw.cancelSubscription({ idempotencyKey: `deletion:${family.deletion.executionId}:${c.checkoutId}`, customerRef: c.customerRef, customerId: family.providerCustomer?.[c.provider] || null, subscriptionRef }); }
      catch (error) { if (!(error instanceof Fault)) throw error; r = { cancelled: false, reason: error.code }; }
      const ended = { cancelled: r.cancelled === true, already: r.already === true, reason: r.reason || null, providerOperationRef: r.providerOperationRef || subscriptionRef, subscriptionRef, at: this.now() };
      await this.store.transaction(async (tx) => { const cur = await tx.get(`checkouts/${id}`); if (cur && !(cur.endedByDeletion?.cancelled === true)) tx.set(`checkouts/${id}`, { ...cur, endedByDeletion: ended }); }); // a recorded ending is never downgraded by a concurrent run's fault
      endings.push({ provider: c.provider, status: ended.cancelled ? 'cancelled' : 'failed', already: ended.already, providerOperationRef: ended.providerOperationRef, reason: ended.reason, checkoutId: c.checkoutId, at: ended.at });
    };
    for (const c of (await this.pagedBy(this.store, 'checkouts', 'familyId', familyId)).rows) { // every checkout of the family, in pages: never the first hundred
      const id = `${c.provider}:${c.checkoutId}`, closed = ['superseded', 'superseded_by_deletion'].includes(c.status), ref = c.providerCheckoutRef || c.lateSessionRef || null;
      if (!closed) continue;
      const gw = this.payments?.gateways && Object.hasOwn(this.payments.gateways, c.provider) ? this.payments.gateways[c.provider] : null;
      if (!gw) { if (ref || c.paymentPending) await this.store.transaction(async (tx) => { const cur = await tx.get(`checkouts/${id}`); if (cur && !cur.expiredByDeletion) tx.set(`checkouts/${id}`, { ...cur, expiredByDeletion: { expired: false, reason: 'PROVIDER_NOT_CONFIGURED', at: this.now() } }); }); continue; } // named by the sweep, never skipped silently
      // every session of the family's that may still be payable — the one the freeze superseded, the ones earlier clicks superseded whose
      // best-effort expiry may have faulted, a session that arrived late — is expired; a record that says expired is never downgraded by
      // a rerun's refusal, and a record that says faulted is asked again by a rerun
      let completedRef = c.expiredByDeletion?.reason === 'SESSION_COMPLETED' ? c.expiredByDeletion.subscriptionRef || null : null;
      if (ref && !(c.expiredByDeletion?.expired === true) && !completedRef && typeof gw.cancelCheckout === 'function') {
        let outcome; try { outcome = await gw.cancelCheckout(ref); } catch (error) { if (!(error instanceof Fault)) throw error; outcome = { expired: false, reason: error.code }; }
        if (outcome.reason === 'SESSION_COMPLETED' && outcome.subscriptionRef) completedRef = outcome.subscriptionRef; // paid on a superseded session: a subscription made, ended below
        await this.store.transaction(async (tx) => { const cur = await tx.get(`checkouts/${id}`); if (cur && !(cur.expiredByDeletion?.expired === true)) tx.set(`checkouts/${id}`, { ...cur, expiredByDeletion: { ...outcome, at: this.now() } }); });
      }
      const made = c.paymentPending?.subscriptionRef || completedRef || null;
      if (made && made !== family.subscription?.providerSubscriptionRef && !(c.endedByDeletion?.cancelled === true) && typeof gw.cancelSubscription === 'function') await endFor(gw, id, c, made);
    }
    // The provider is told whatever the local state — a past_due family is still being dunned there, a refunded one may still be
    // live (Stage 4 review, third round); the machine records `terminate` only where access still existed.
    if (family.subscription) {
      // Stage 4.2: the provider stops billing first (idempotent under the execution id; a fault is recorded, never fatal — RECONCILIATION.md), then the machine records the end
      const providerCancellation = this.payments ? await this.payments.cancelAtProvider(family, `deletion:${family.deletion.executionId}`) : { provider: null, status: 'not_applicable' };
      if (ACCESS.has(deriveState(family.subscription, this.now()))) await this.billing.apply(familyId, { id: randomUUID(), type: 'terminate' }, operator);
      await this.store.transaction(async (tx) => { const f = await tx.get(`families/${familyId}`); if (f && !f.deleted) tx.set(`families/${familyId}`, { ...f, deletion: { ...f.deletion, providerCancellation } }); });
    }
    // what the deletion ended beyond the record stands as its provider cancellation when the record itself had none to end (no
    // subscription, a trial, an operator's grant): a failed ending is the one the operator reads
    if (endings.length) await this.store.transaction(async (tx) => { const f = await tx.get(`families/${familyId}`); if (!f || f.deleted) return; const pc = f.deletion?.providerCancellation || null; const chosen = endings.find((e) => e.status === 'failed') || endings.at(-1); tx.set(`families/${familyId}`, { ...f, deletion: { ...f.deletion, providerCancellation: !pc || pc.status === 'not_applicable' ? chosen : pc, otherEndings: endings } }); });
    // phase 1 — login sessions of the family and of its parents (nobody could use them: authorize and login refuse an executing family)
    const members = await this.store.entries(`families/${familyId}/members`), uids = members.map(([uid]) => uid);
    await this.sweepWhere('sessions', 'familyId', familyId, batch, familyId, 'loginSessions');
    for (const uid of uids) await this.sweepWhere('sessions', 'uid', uid, batch, familyId, 'loginSessions');
    await this.sweepWhere('outbox', 'familyId', familyId, batch, familyId, 'outbox'); // email-v1: the fake mail provider's rendered reports go now, not in 14 days
    await this.sweepWhere('feedback', 'familyId', familyId, batch, familyId, 'feedback'); // the notes its parents sent with Send feedback (feedback.mjs)
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
      // Leaving (12 Sep 2026): why the family left is kept — the reason, the offers and the action name nobody and are the churn
      // record the owner's monthly report reads — but the parent's own words go with the rest of their writing.
      const leaving = await tx.entries(`families/${familyId}/leaving`, 100);
      const parents = []; for (const [uid] of mem) parents.push([uid, await tx.get(`parents/${uid}`)]);
      for (const [name, rows] of [['children', childDocs], ['credentials', creds], ['pinAttempts', attempts], ['operations', receipts], ['members', mem]]) for (const [id] of rows) tx.delete(`families/${familyId}/${name}/${id}`);
      for (const [id, rec] of leaving) if (rec.freeText !== null) tx.set(`families/${familyId}/leaving/${id}`, { ...rec, freeText: null, redactedAt: now });
      if (config) tx.delete(`families/${familyId}/game/config`);
      for (const [uid, p] of parents) if (p) tx.set(`parents/${uid}`, { deleted: true, deletedAt: now, familyId: null, reauthAfter: Math.max(p.reauthAfter || 0, Math.floor(now / 1000)), phoneKey: p.phoneKey || null, createdAt: p.createdAt || null }); // seconds, like login()
      const counts = { ...(current.deletion.counts || {}), children: childDocs.length, leavingRedacted: leaving.filter(([, r]) => r.freeText !== null).length };
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
