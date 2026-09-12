# Recovery, export, deletion and support tooling (Stage 3.5)

`server/support.mjs`, `scripts/support.mjs`. Two doors: the parent's, through the ordinary
session + CSRF + recent-sign-in checks; the operator's, through the CLI under an explicit
`OPERATOR_ID`, with an audit row for every corrective action. There is no browser route that
writes arbitrary state, and nothing here can move a child, a family or a subscription to another
account (`NO_TRANSFER.md`; `tests/support.test.mjs` scans the module for it).

## The parent's door

- `GET /api/family/export` (recent sign-in): everything the family is — every audit row of the family read in
  pages (`auditTruncated: true` only past 50,000 rows, years of use; then the rows kept are the first
  50,000 by document id, an arbitrary set in time, not the oldest or the newest; the operator's `family` report reads
  the family's events, intents, checkouts and reconciliations the same way, one family's rows only, and `truncated`
  names any collection capped), and otherwise family, entitlement and
  subscription facts, the family's billing events, game configuration, each child with their
  progress and every ledger row, the audit trail for the family. No credentials, sessions, keys,
  fingerprints or phone keys. The browser offers it as a JSON download. It is a read the parent
  keeps; no route on this or any other server consumes it — the no-transfer scan admits exactly
  this path and checks there is no import counterpart.
- `POST /api/family/deletion { operationId }` (recent sign-in): schedules deletion **14 days**
  out. Nothing changes meanwhile; the parent workspace shows the date and a "Keep my family"
  button. `POST /api/family/deletion/cancel { operationId }` takes it back.

## Deletion is not "delete everything"

Executed by an operator (`scripts/support.mjs delete FAMILY_UUID`, `CONFIRM_DELETION` required;
`FORCE_BEFORE_GRACE=yes` executes early and is audited as forced) once the 14 days have passed.
Idempotent. In order:

1. the family is frozen (see below), then an active subscription is ended as a recorded `terminate`
   event (Stage 4's adapter tells the provider);
2. per child, in bounded batches: learning sessions, ledger rows, operation receipts, progress;
3. in one transaction: children, credentials, PIN attempts, child-creation receipts, members,
   game configuration, every login session of the family or its parents; parent documents become
   tombstones (`deleted`, `familyId: null`, phone key kept); the family document becomes a
   tombstone with no label and no children — keeping id, subscription facts, provider customer
   references and the deletion record; `deletions/{familyId}` records what happened and what was
   kept.

| Retained | Why |
|---|---|
| `families/{f}/billing/*` | financial record of every subscription event |
| `billingEvents/*` | provider event inbox: idempotency and dispute evidence |
| `billingCustomers/*` | provider customer reference → family: needed to read the records above |
| `checkouts/*`, `billingChangeIntents/*`, `billingReconciliations/*` | idempotency and reconciliation evidence |
| `phones/*` | one trial per verified phone; holds no phone number |
| family / parent tombstones | the minimum linkage the records above need; a returning parent starts fresh and gets no second trial |
| `audit/*` | security and accountability trail (uid, familyId, childId, action); expires by TTL 400 days after each row |
| `deletions/{f}`, `supportOperations/*` | who asked, who executed, what was removed and kept; which operator started which corrective action |
| `incidents/*` | the incident log and the postmortems written from it: severity, timeline, resolution, follow-ups; no TTL (`INCIDENTS.md`) |

### How it runs

A job in phases, each phase a bounded transaction (`DELETION_BATCH` = 300 writes, under Firestore's
500), the whole thing **resumable** — a rerun after a crash continues from the recorded phase and
reports the accumulated counts:

0. **freeze**, the first mutating transaction: validate, then `deletion.status = executing` — from here `Foundation.authorize()`
   admits nobody (parent, selector or child: `FAMILY_DELETED`), so no Stage 1/2 write can land
   between sweeps; live checkouts become `superseded_by_deletion`, open change intents
   `frozen_by_deletion` (still reconcilable), the in-flight markers are cleared, and the audit row
   names the operator and the execution id;
   `Foundation.login()` refuses a new session for the family too, so the sweep below finds none;
0b. the subscription ends as a recorded `terminate` event — only now, when no payment can revive it and no parent can act;
1. login sessions of the family and its parents, in batches;
2. per child: learning sessions, ledger rows, operation receipts in batches, then the progress
   document;
3. children, credentials, PIN attempts, receipts, members, game config; parent and family
   tombstones; `deletions/{f}`.

A late provider event for a deleted (or executing) family is recorded in the inbox as
`reconciliation_required: FAMILY_DELETED`, shown in the family report, and never revives product
entitlement; Stage 4 reconciles, refunds or cancels at the provider.

### The sign-in account (Stage 4)

From the moment the deletion is asked for, the sign-in account admits nobody: `login()` and every
authorization refuse the uid (`ACCOUNT_DELETED`), whatever the identity provider did since — a provider
fault leaves `identityDeletion.requestedAt` without `deletedAt`, and only the operator's retry
(`delete-account UID`) finishes it. Sessions are swept in bounded batches.


Family deletion removes the family and its data; the parent's Firebase Authentication account is
separate. Once no family points at the parent — the family tombstone left `familyId: null`, or none
was ever created — the parent may delete the sign-in account itself: `POST /api/account/deletion
{ operationId }` (recent sign-in; `FAMILY_STILL_EXISTS` while a family remains). Two steps, so a
provider failure is visible and retryable: every session of the uid is deleted and `parents/{uid}`
gets `identityDeletion.requestedAt` in one transaction; then the Auth account is deleted at the
provider and the record gets `identityDeletion.deletedAt`. The operator path is
`scripts/support.mjs delete-account PARENT_UID` (also the retry). **Identity retention**: the email
and phone number live in the Auth account and go with it; what remains is the parent tombstone with
its phone key, so one trial per phone survives the account, and the audit rows (TTL 400 days).

A tombstoned family admits no session (`FAMILY_DELETED`). Deleting the Firebase Auth account
itself is the parent's action through the identity provider; the tombstone means a returning
account has no family and creates a new one.

## Recovery rules

Recovery never bypasses MFA or family ownership. A parent who loses their second factor
recovers their **own** account through the ceremony in `RECOVERY.md` — self-service, seven days,
proof of the inbox through the identity provider's own password reset, cancelled by any full
sign-in; the operator's only verb is `cancel-recovery`. An operator never points a parent record at
a different family, never adds a member, never moves a child, never removes a second factor. The only corrective
actions are the ones below, and each writes an audit row with the operator's identity.

## The operator's door (`scripts/support.mjs`)

| Command | What |
|---|---|
| `family FAMILY_UUID` | the report: **attention** first (`requires_action` count, open intents, open checkouts, in-flight change, live checkout, ledger drift/damage, pending deletion), then entitlement and subscription, children with ledger reconciliation status, provider customers with their pending lists, the inbox for those customers, change intents, checkouts, family billing events, reconciliations, audit history |
| `customer PROVIDER REF` | provider reference → family |
| `inbox [status]` | the global inbox by outcome (`requires_action` by default) |
| `reprocess FAMILY_UUID` | server-side reprocessing of the family's waiting events (the same code the server runs itself); `supportOperations/{id}` names the operator before anything moves and records how it ended |
| `reconcile-intent PROVIDER OPERATION_UUID OUTCOME "note"` | record what was established at the provider for a change intent the server could not finalise (`creating` / `stale` / `superseded`): `no_provider_change`, `provider_reverted`, `applied_by_operator`, `refunded`; writes `billingReconciliations/{id}`, marks the intent `reconciled` (it can never finalise afterwards); an `applied` intent is not open to this |
| `reconcile-provider FAMILY_UUID` | Stage 4.2: fetch the provider's customer and subscription and compare them with the family's record — plan (a scheduled downgrade explains the provider's price), period end, cancel flag, live vs ended, deleted family with a live subscription — plus every open change intent with provider evidence; writes `billingReconciliations/{id}` (`kind: provider_state`, `match`, `findings`) and an audit row; the family report shows the latest run under **attention** (`providerCheck`). Read-only at the provider. RECONCILIATION.md says what each finding means and what to do |
| `resolve-event PROVIDER EVENT_ID OUTCOME "note"` | Stage 4.2: close an inbox row the server could not apply — `reconciliation_required` (a late event on a deleted family) or `rejected` — after acting at the provider: `refunded_at_provider`, `cancelled_at_provider`, `applied_by_operator`, `no_action_needed`; the row keeps its outcome and gains the resolution, `billingReconciliations/{id}` (`kind: event`) records it, and **attention** stops counting it |
| `cancel-recovery UID "reason"` | Stage 4.4: cancel a pending account-recovery request (the parent says it was not them, or anything looks wrong). Protective only — there is no command that removes a second factor, shortens the wait or completes a recovery (`RECOVERY.md`) |
| `sweep [batch]` | the routine invariant sweep over every family, every provider customer mapping and the inbox (RECONCILIATION.md → Routine sweep): seats vs children, child list vs documents, members vs parents, provider links both ways, subscription facts, ledgers, open intents/checkouts/markers, deletions due or stuck, recoveries stuck, tombstone residue. Read-only; writes `sweeps/{id}` and an audit row; exits 2 when there is a finding, so the scheduled daily run fails visibly |
| `incident open SEVERITY "one line" [systems=a,b] [families=N] [sweep=SWEEP_UUID]`, `incident note ID "…"`, `incident close ID "…" [follow-ups="one; two"]`, `incident list [open\|closed\|all]` | Stage 4.6: the incident log `incidents/{id}` — severity 1/2/3 (anything else is `INVALID_SEVERITY`), the timeline of what was done, the resolution and the follow-ups; severity 1 carries the 72-hour deadline for telling affected parents. Closing is final (`INCIDENT_NOT_OPEN`). An audit row per verb; the document has no TTL. `INCIDENTS.md` holds the format and the postmortem template; `SUPPORT_DESK.md` holds the escalation ladder it serves |
| `export FAMILY_UUID` | the same export the parent gets |
| `delete FAMILY_UUID` | execute a requested deletion (above) |

Superseded checkouts and superseded/stale/creating intents appear in the report. With Stripe (Stage
4.1/4.2) a superseded hosted session is expired at the provider, a superseded checkout never returns
its URL again, and a late payment on it is refused by the inbox and refunded by the operator in the
provider's dashboard; the family's own decisions — cancel at period end, a scheduled downgrade, the
deletion of the family — reach the provider before the record changes, and `reconcile-provider`
shows where the two still disagree (RECONCILIATION.md).
