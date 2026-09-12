# Data, retention and deletion — what the v3 service holds and why (Stage 4.7)

This is the engineering statement behind the parent-facing privacy disclosure. It says, per kind of
data, what is collected, where it lives, who can see it, how long it stays, and how it leaves. The
launch-country legal review turns it into the words parents read; until that review is complete the
pilot uses **synthetic child data** (`README.md`, `DEPLOY_V3.md`).

## Principles

- **Children have no account.** A child has a nickname, a PIN (stored only as a salted, peppered
  hash bound to the family and child), an age and year level for placement, and learning progress.
  No email, no phone, no photo, no free-text from the child, nothing shared between families.
- **One adult owns a family.** The parent's email and phone are held by the identity provider
  (Firebase Authentication); the service keeps the provider's user id and an HMAC of the verified
  phone, never the number.
- **Money moves at the payment provider.** The service never sees a card number. It keeps the
  provider's customer and subscription references and the signed events the provider sends.
- **Every operator action is a named CLI command with an audit row.** No browser route writes
  arbitrary state; nothing moves a child, a parent or a subscription between families
  (`NO_TRANSFER.md`).

## Inventory

| Data | Where | Who sees it | Retention | Leaves by |
|---|---|---|---|---|
| Parent email, password, verified phone number | Firebase Authentication (the v3 project), Google's infrastructure | the parent; the operator sees email and masked phone in the provider console | as long as the sign-in account exists | the parent deletes the sign-in account (`SUPPORT.md` → the sign-in account) |
| Parent record: provider uid, family link, phone key (HMAC), re-authentication floor | Firestore `parents/{uid}` | the parent (via `/api/me`), the operator (CLI) | with the family; after deletion a tombstone with the phone key stays so a returning parent starts fresh and gets no second trial | family deletion → tombstone; sign-in account deletion leaves the tombstone |
| Family: display name, time zone, member uids, entitlement, subscription facts | Firestore `families/{f}` | the parent; the operator | until deletion | the parent's deletion request, executed after 14 days (`SUPPORT.md`) |
| Child profile: nickname, PIN hash, status, age and year level, starting option | `families/{f}/children/{c}`, `credentials/{c}` | the parent; the child sees the nickname | with the family | family deletion (removed) |
| Learning progress, sessions, wallet ledger, game state | `families/{f}/learning/{c}/…`, `game/…` | the parent (export), the child while playing | with the family | family deletion (removed, counted on the deletion record) |
| Login sessions (opaque cookie hash, uid, the parent's email and mobile factor id, role, family, CSRF token, expiry, whether the device is remembered) | Firestore `sessions/{hash}` | nobody reads them but the server | 30 minutes (parent) and 12 hours (launch pad), or 30 days from the sign-in when the parent ticks Remember this device (a hand-over in its last 12 hours still gets 12 hours); deleted at sign-out, deletion and recovery; refused from its next use after a password reset or a change of mobile, and removed by the TTL at its expiry | expiry |
| Remember-this-device answer: a SHA-256 of the email of the account that ticked the box (`automathtics.remember`), so it comes back ticked for that account only; not readable, though anyone who can guess the email could check it | this device's browser storage | nobody; never sent | until the box is unticked at a sign-in, or the site's data is cleared | removal |
| Rate-limit buckets | `rate/…` | nobody | minutes to a day, TTL | expiry |
| SMS resend ladder: timestamps of the verification SMS to a number in its current run | `smsLadder/{hmac}` — an HMAC of the number under a secret; the number itself is not stored | nobody | two days, TTL | expiry |
| The Send countdown: timestamps of the verification codes this browser asked for, per destination, in the current run | the parent's own browser (`localStorage`, key `automathtics.sms.` + an HMAC of the number, or of the enrolled factor's id, under a random key kept on the same device; plus the time the provider said to wait, when it said so); never sent anywhere. The number is not stored in clear, but it is not secret from anyone who can read the device's storage: the key sits beside the records and phone numbers are few enough to try one by one. Records whose run is over, and waits that have passed or lie further off than a day, are removed the next time the sign-in page loads; opening the app with `?resetsms` removes them all | the parent's browser only | until the first load after a day without a code to that destination | the browser's own "clear site data"; a private window keeps them only until it closes |
| Billing events from the provider, customer references, checkouts, change intents, reconciliation decisions, subscription event log | `billingEvents/*`, `billingCustomers/*`, `checkouts/*`, `billingChangeIntents/*`, `billingReconciliations/*`, `families/{f}/billing/*` | the operator; the parent sees their own subscription state | **kept after family deletion** (financial record, idempotency and dispute evidence — `PAYMENTS.md` → retention); they name the family id and provider references, no person | never by TTL; a future legal retention limit would be a reviewed change |
| Trial ledger: one trial per verified phone | `phones/{phoneKey}` (HMAC only) | nobody | kept (anti-abuse; holds no number) | — |
| Audit rows: action, uid, family id, child id, timestamp | `audit/*` | the operator | **400 days**, TTL | expiry |
| Deletion records, support operations | `deletions/{f}`, `supportOperations/*` | the operator | kept (accountability for the deletion and every corrective action) | — |
| Recovery requests | `recoveries/{uid}` | the parent (own status), the operator | 60 days after the ready date, TTL (`RECOVERY.md`) | expiry |
| Server logs | Cloud Run logging | the operator | the project's logging retention (set in `DEPLOY_V3.md`); logs carry request ids and error codes, no bodies, no tokens | expiry |
| Operator dashboard report: aggregate counts, medians, month-by-month subscription dates, the two speed matrices and the de-duplicated reward names parents typed. No nickname, no family, child or parent reference, no address, nothing a child wrote, and no number computed from fewer than five families (`--min-cell`) - such a number is left out of the HTML and the JSON alike; only the size of the cohort the report covers is printed regardless, so a reader can understand the dashes | the operator's own machine. `scripts/dashboard.mjs` writes the file where the operator says; it is never uploaded, never published and has no URL, and it needs no network to open | the operator who ran it, and anyone they choose to show the file to | as long as that operator keeps the file - there is no retention rule for a working document, so delete it once the question it answered is answered | the operator deletes the file. The run itself leaves one `audit/*` row (`operator.dashboard`: the operator identity, the settings and how many families were covered, never which ones), which expires with the 400-day TTL |
| Payment provider records: customer, subscription, invoices, card on file | Stripe | the operator in Stripe's dashboard; Stripe as processor | Stripe's own retention; the customer is not deleted with the family (financial record) — cancelled, and refunded where due | Stripe's processes |

`RETENTION` in `server/support.mjs` is the machine-readable form of the "kept after deletion" rows and is
written onto every deletion record.

## The parent's rights, as implemented

- **See**: `/api/family/export` — everything above that belongs to the family, in one JSON document,
  after a fresh sign-in.
- **Delete the family**: `/api/family/deletion`, effective after 14 days, cancellable until then;
  the provider's subscription is ended first; what is kept is listed above and on the record.
- **Delete the sign-in account**: after the family is gone, from the no-family screen; the identity
  provider deletes email, password and phone.
- **Recover the account**: `RECOVERY.md` — self-service, seven days, no support shortcut.
- **Change the mobile number**: *Change my mobile number* in Mission Control — a fresh sign-in, a code to the new number, the old factor removed only once the new one is enrolled.

## What is not collected

No location, no contacts, no device identifiers beyond what the browser sends with every request,
no analytics SDK, no third-party scripts other than the identity provider's, no advertising, no
child-facing communication of any kind. Demographic fields (age, year level) exist for placement and
for aggregate analysis of the learning path; they are never shown to other families and never sold.

## Before real families

- Legal review of this inventory for the launch country (children's data, consent wording, the
  14-day deletion window, the financial retention exception, the 400-day audit window).
- The parent-facing disclosure and consent version (`consentVersion`) updated from `pilot-v1`.
- Logging retention set and verified on the staging project (`DEPLOY_V3.md`).
- A named person who answers export/deletion requests that arrive outside the app, using only the
  CLI commands in `SUPPORT.md`.
