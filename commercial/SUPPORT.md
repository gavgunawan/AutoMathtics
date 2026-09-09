# Recovery, export, deletion and support tooling (Stage 3.5)

`server/support.mjs`, `scripts/support.mjs`. Two doors: the parent's, through the ordinary
session + CSRF + recent-sign-in checks; the operator's, through the CLI under an explicit
`OPERATOR_ID`, with an audit row for every corrective action. There is no browser route that
writes arbitrary state, and nothing here can move a child, a family or a subscription to another
account (`NO_TRANSFER.md`; `tests/support.test.mjs` scans the module for it).

## The parent's door

- `GET /api/family/export` (recent sign-in): everything the family is — family, entitlement and
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

1. an active subscription is ended as a recorded `terminate` event (Stage 4's adapter tells the
   provider);
2. per child, in one transaction: learning sessions, ledger rows, operation receipts, progress;
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

### How it runs

A job in phases, each phase a bounded transaction (`DELETION_BATCH` = 300 writes, under Firestore's
500), the whole thing **resumable** — a rerun after a crash continues from the recorded phase and
reports the accumulated counts:

0. **begin**, one transaction: `deletion.status = executing` — from here `Foundation.authorize()`
   admits nobody (parent, selector or child: `FAMILY_DELETED`), so no Stage 1/2 write can land
   between sweeps; live checkouts become `superseded_by_deletion`, open change intents
   `frozen_by_deletion` (still reconcilable), the in-flight markers are cleared, and the audit row
   names the operator and the execution id;
1. login sessions of the family and its parents, in batches;
2. per child: learning sessions, ledger rows, operation receipts in batches, then the progress
   document;
3. children, credentials, PIN attempts, receipts, members, game config; parent and family
   tombstones; `deletions/{f}`.

A late provider event for a deleted (or executing) family is recorded in the inbox as
`reconciliation_required: FAMILY_DELETED`, shown in the family report, and never revives product
entitlement; Stage 4 reconciles, refunds or cancels at the provider.

### What deletion is, and is not

This deletes the **family** and its data. The parent's Firebase Authentication sign-in account is
separate and is not deleted here; the browser module has no account-deletion operation yet.
Self-service Auth-account deletion after the family deletion, and the retention period of the
identity, are on the Stage 4 acceptance list.

A tombstoned family admits no session (`FAMILY_DELETED`). Deleting the Firebase Auth account
itself is the parent's action through the identity provider; the tombstone means a returning
account has no family and creates a new one.

## Recovery rules

Recovery never bypasses MFA or family ownership. A parent who loses their second factor
recovers their **own** account through the identity provider — a tested customer recovery
ceremony for a lost phone or changed number that does not enable takeover is a Stage 4 item
(real MFA validation lives there); an operator never points a parent
record at a different family, never adds a member, never moves a child. The only corrective
actions are the ones below, and each writes an audit row with the operator's identity.

## The operator's door (`scripts/support.mjs`)

| Command | What |
|---|---|
| `family FAMILY_UUID` | the report: **attention** first (`requires_action` count, open intents, open checkouts, in-flight change, live checkout, ledger drift/damage, pending deletion), then entitlement and subscription, children with ledger reconciliation status, provider customers with their pending lists, the inbox for those customers, change intents, checkouts, family billing events, reconciliations, audit history |
| `customer PROVIDER REF` | provider reference → family |
| `inbox [status]` | the global inbox by outcome (`requires_action` by default) |
| `reprocess FAMILY_UUID` | server-side reprocessing of the family's waiting events (the same code the server runs itself); `supportOperations/{id}` names the operator before anything moves and records how it ended |
| `reconcile-intent PROVIDER OPERATION_UUID OUTCOME "note"` | record what was established at the provider for a change intent the server could not finalise (`creating` / `stale` / `superseded`): `no_provider_change`, `provider_reverted`, `applied_by_operator`, `refunded`; writes `billingReconciliations/{id}`, marks the intent `reconciled` (it can never finalise afterwards); an `applied` intent is not open to this |
| `export FAMILY_UUID` | the same export the parent gets |
| `delete FAMILY_UUID` | execute a requested deletion (above) |

Superseded checkouts and superseded/stale/creating intents appear in the report so support has
visibility before a real provider arrives. For Stage 4: the adapter must cancel or expire a
superseded provider checkout where the provider allows it; where it cannot, the superseded
checkout never returns its URL again (already the case) and a late payment on it is reconciled
and refunded.
