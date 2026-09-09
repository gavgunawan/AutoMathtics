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

A tombstoned family admits no session (`FAMILY_DELETED`). Deleting the Firebase Auth account
itself is the parent's action through the identity provider; the tombstone means a returning
account has no family and creates a new one.

## Recovery rules

Recovery never bypasses MFA or family ownership. A parent who loses their second factor
recovers their **own** account through the identity provider; an operator never points a parent
record at a different family, never adds a member, never moves a child. The only corrective
actions are the ones below, and each writes an audit row with the operator's identity.

## The operator's door (`scripts/support.mjs`)

| Command | What |
|---|---|
| `family FAMILY_UUID` | the report: **attention** first (`requires_action` count, open intents, open checkouts, in-flight change, live checkout, ledger drift/damage, pending deletion), then entitlement and subscription, children with ledger reconciliation status, provider customers with their pending lists, the inbox for those customers, change intents, checkouts, family billing events, reconciliations, audit history |
| `customer PROVIDER REF` | provider reference → family |
| `inbox [status]` | the global inbox by outcome (`requires_action` by default) |
| `reprocess FAMILY_UUID` | server-side reprocessing of the family's waiting events (the same code the server runs itself); audited |
| `reconcile-intent PROVIDER OPERATION_UUID OUTCOME "note"` | record what was established at the provider for a change intent the server could not finalise (`creating` / `stale` / `superseded`): `no_provider_change`, `provider_reverted`, `applied_by_operator`, `refunded`; writes `billingReconciliations/{id}`, marks the intent `reconciled` (it can never finalise afterwards); an `applied` intent is not open to this |
| `export FAMILY_UUID` | the same export the parent gets |
| `delete FAMILY_UUID` | execute a requested deletion (above) |

Superseded checkouts and superseded/stale/creating intents appear in the report so support has
visibility before a real provider arrives. For Stage 4: the adapter must cancel or expire a
superseded provider checkout where the provider allows it; where it cannot, the superseded
checkout never returns its URL again (already the case) and a late payment on it is reconciled
and refunded.
