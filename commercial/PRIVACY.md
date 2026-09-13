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
| Learning progress, sessions, wallet ledger, game state | `families/{f}/learning/{c}/…`, `game/…` | the parent (export), the child while playing; the launch pad and the parent's workspace show what each child wears (pet, outfit, vehicle, title, ring, name effect), never a balance or the inventory; a child on the Family Rocket sees each crew member's nickname and the fuel they poured (the owner's choice, 11 Sep 2026), never an id | with the family | family deletion (removed, counted on the deletion record) |
| Login sessions (opaque cookie hash, uid, the parent's email and mobile factor id, role, family, CSRF token, expiry, whether the device is remembered) | Firestore `sessions/{hash}` | nobody reads them but the server | 30 minutes (parent) and 12 hours (launch pad), or 30 days from the sign-in when the parent ticks Remember this device (a hand-over in its last 12 hours still gets 12 hours); deleted at sign-out, deletion and recovery; refused from its next use after a password reset or a change of mobile, and removed by the TTL at its expiry | expiry |
| Remember-this-device answer: a SHA-256 of the email of the account that ticked the box (`automathtics.remember`), so it comes back ticked for that account only; not readable, though anyone who can guess the email could check it | this device's browser storage | nobody; never sent | until the box is unticked at a sign-in, or the site's data is cleared | removal |
| How to, seen: which track's How to for which sector has already opened by itself for each child on this device (`automathtics.howto.<childId>`, a list such as `engine:A nav:B`), so a new sector's first paper shows it once rather than on every start; the child's random id, no name | this device's browser storage | nobody; never sent | until the site's data is cleared | removal |
| Kid-mode marker: `automathtics.kidmode` = `1` once the device was handed over to the kids; it hides *Send feedback* on that device, the sign-in screen included, so that no note is written from a child's tablet, and holds nothing else | this device's browser storage | nobody; never sent | set when the launch pad or a child's screen opens, removed when a parent's session opens on the device | a parent's sign-in on the device, or the browser's "clear site data"; without storage the app keeps it in the page's memory only |
| Seen marker: `automathtics.seen` = `1` once any session has opened on the device (13 Sep 2026), so the site's own address opens there at sign-in rather than at the introduction a stranger sees; a device with any other `automathtics.*` note counts as seen too. Holds nothing else | this device's browser storage | nobody; never sent | until the site's data is cleared | removal |
| Rate-limit buckets | `rate/…` | nobody | minutes to a day, TTL | expiry |
| Feedback day counts: per UTC day, how many notes were kept (and how many of them signed out) and how many copies went to the owner; counts only | Firestore `feedbackDays/{YYYY-MM-DD}` | nobody (the operator in the console) | 8 days, TTL | expiry |
| SMS resend ladder: timestamps of the verification SMS to a number in its current run | `smsLadder/{hmac}` — an HMAC of the number under a secret; the number itself is not stored | nobody | two days, TTL | expiry |
| The Send countdown: timestamps of the verification codes this browser asked for, per destination, in the current run | the parent's own browser (`localStorage`, key `automathtics.sms.` + an HMAC of the number, or of the enrolled factor's id, under a random key kept on the same device; plus the time the provider said to wait, when it said so); never sent anywhere. The number is not stored in clear, but it is not secret from anyone who can read the device's storage: the key sits beside the records and phone numbers are few enough to try one by one. Records whose run is over, and waits that have passed or lie further off than a day, are removed the next time the sign-in page loads; opening the app with `?resetsms` removes them all | the parent's browser only | until the first load after a day without a code to that destination | the browser's own "clear site data"; a private window keeps them only until it closes |
| Billing events from the provider, customer references, checkouts, change intents, reconciliation decisions, subscription event log | `billingEvents/*`, `billingCustomers/*`, `checkouts/*`, `billingChangeIntents/*`, `billingReconciliations/*`, `families/{f}/billing/*` | the operator; the parent sees their own subscription state | **kept after family deletion** (financial record, idempotency and dispute evidence — `PAYMENTS.md` → retention); they name the family id and provider references, no person | never by TTL; a future legal retention limit would be a reviewed change |
| Trial ledger: one trial per verified phone | `phones/{phoneKey}` (HMAC only) | nobody | kept (anti-abuse; holds no number) | — |
| Audit rows: action, uid, family id, child id, timestamp | `audit/*` | the operator | **400 days**, TTL | expiry |
| Deletion records, support operations | `deletions/{f}`, `supportOperations/*` | the operator | kept (accountability for the deletion and every corrective action) | — |
| Recovery requests | `recoveries/{uid}` | the parent (own status), the operator | 60 days after the ready date, TTL (`RECOVERY.md`) | expiry |
| Email choices, the consent record (email-v1): the progress-report cadence (weekly, monthly or off) and the news switch, and 20 change rows, each with when, through which door (the sign-up boxes, Mission Control, an email button) and under which version of the wording: the sign-up row, both boxes as ticked, is the consent itself and is kept for good; the newest of the rest fill the other 19, and a save that changes nothing adds no row. No address: that stays with the identity provider | Firestore `emailPrefs/{uid}` | the parent (Mission Control, the family export), the operator | as long as the sign-in account; kept when the family is deleted (the account may start a new one) | deleting the sign-in account removes it. An account deleted at the provider before it ever signed in leaves its record (a uid and two switches) |
| Leaving records (the cancel-or-pause flow, 12 Sep 2026): one per flow a parent completed — when, the reason chosen from a fixed list, up to 500 characters the parent typed if they chose to, which alternatives were offered and which was taken, what was done (keep, fewer emails, pause, downgrade, cancel), the plan, the seats and the subscription state at that moment, the month the family was created, and whether it came from the app or an email link. No name, no address, no child, no id of anything but the flow itself; the audit row beside it carries ids only | Firestore `families/{f}/leaving/{id}` | the parent (the family export), the operator, and the owner as counts in the monthly leaving report | **400 days**, TTL. The family's deletion removes the parent's own words from every record and keeps the rest — the reason, the offers and the action name nobody, and they are the churn record the owner's monthly report reads | expiry; the free text also goes at family deletion |
| The monthly leaving report as sent: counts, shares, reasons, offers, plan, seat and cohort mixes for one month. No family id, no name, no address, no free text | the owner's mailbox (through Resend, United States, once the owner has an account); `reports/leaving:{YYYY-MM}` holds the claim and its outcome, status only | the owner; the operator | the claim 400 days by TTL; the email for as long as the owner's mailbox and Resend's own log keep it | expiry |
| Weekly report status: per family and ISO week, sent or skipped and why, the attempts, the provider's message id. No report content | `reports/{familyId}:{week}` | the operator | **400 days**, TTL | expiry |
| Rendered report emails, only with the `fake` email provider (the staging preview until the owner has a real provider): the whole email as it would have gone, with the parent's full address, the children's nicknames and their week, and the buttons' live tokens | `outbox/{id}` | the operator, who could use those buttons until they expire | 14 days, TTL; removed at once when the family is deleted | expiry, family deletion |
| Email button tokens: the action, the parent's uid, the family and child ids, the value, the week and the expiry, signed by the server (not encrypted: anyone holding one can read it and, until it expires, use it) | wherever the email is: the parent's mailbox and the mailbox provider's systems, Resend's log of sent email, and with the fake provider the outbox (14 days); the browser's address bar only as a fragment (`#email=…`, never sent to a server) until the app tidies it on opening; and, for the stop-the-report token alone, request logs, because the RFC 8058 List-Unsubscribe URL must carry it in its query for the mailbox provider to post to, so Cloud Run logs it whenever that URL is posted to or clicked | the parent, anyone the email is forwarded to, the email provider, the operator (logs, outbox) | 14 days after the report's week for pace and scan focus, 365 days for stopping the report | expiry; a new `SESSION_SECRET` voids every one |
| Server logs | Cloud Run logging | the operator | the project's logging retention (set in `DEPLOY_V3.md`) | expiry. Logs carry request ids, paths and error codes, no bodies; the one logged URL that carries a token is the List-Unsubscribe URL (`/api/email/unsubscribe?t=…`), whose stop-the-report token can switch the weekly report off and nothing else; the buttons carry theirs in the fragment, which no server sees |
| Operator dashboard report: aggregate counts, medians, month-by-month subscription dates, the two speed matrices and the de-duplicated reward names parents typed. No nickname, no family, child or parent reference, no address, nothing a child wrote, and no number computed from fewer than five families (`--min-cell`) - such a number is left out of the HTML and the JSON alike; only the size of the cohort the report covers is printed regardless, so a reader can understand the dashes | the operator's own machine. `scripts/dashboard.mjs` writes the file where the operator says; it is never uploaded, never published and has no URL, and it needs no network to open | the operator who ran it, and anyone they choose to show the file to | as long as that operator keeps the file - there is no retention rule for a working document, so delete it once the question it answered is answered | the operator deletes the file. The run itself leaves one `audit/*` row (`operator.dashboard`: the operator identity, the settings and how many families were covered, never which ones), which expires with the 400-day TTL |
| Payment provider records: customer, subscription, invoices, card on file | Stripe | the operator in Stripe's dashboard; Stripe as processor | Stripe's own retention; the customer is not deleted with the family (financial record) — cancelled, and refunded where due | Stripe's processes |
| The weekly report as sent: the parent's address, the children's nicknames and their week's figures (email-v1) | Resend, the email provider, a processor in the United States (once the owner opens the account; until then nothing is sent) | Resend; the parent | Resend's own log retention, 30 days (confirm it when the account is opened) | Resend's processes |
| Feedback: the words (1 to 2000 characters), the screen it was sent from, when, and the release; from a signed-in parent the uid and the family id; from the sign-in screen, only if the sender gives one, an address to be answered at | Firestore `feedback/{id}` (the id is the page's own operation id, so a retried send is one note); with `FEEDBACK_TO` and Resend, and within the day's caps (20 copies, 5 of them for notes sent signed out), also an email to the owner (Resend, United States) whose Reply-To is the parent's account address or the address given | the operator (`node scripts/report.mjs feedback`, the owner's inbox); the parent, in the family export | **400 days**, TTL; the owner's emailed copy for as long as the owner's mailbox keeps it, and in Resend's log for Resend's own retention | a family's deletion removes the notes its parents sent, and the sign-in account's deletion those it sent without a family. A note sent signed out names no family and no account, so no export carries it and no deletion finds it, even one with an address to answer: it goes by TTL, or when the operator deletes it on request (Firestore console). The owner's emailed copy (the words, and the parent's address as Reply-To) stays in the owner's mailbox and in Resend's log: no family or account deletion reaches it. Never from a child: no button on a device in kid mode, and the server refuses a child's or the launch pad's session |

`RETENTION` in `server/support.mjs` is the machine-readable form of the "kept after deletion" rows and is
written onto every deletion record.

**The waiting list** (`waitlist`, `server/waitlist.mjs`) is separate from every family record and holds one row per
address: the address itself, because writing to it on 19 September is the whole point of the list; the moment the
permission to write was given; and the short tag the link in a post carried (`/join?from=ig`), which describes the
post and not the person. No name, no child, no account — an address on this list belongs to nobody who has signed
up for anything. Rows are keyed by a SHA-256 of the address, so the same address left twice is one row and a row
can be found and removed by address alone when someone asks. They expire 400 days after the address was last left
(TTL), and `waitlistDays/{YYYY-MM-DD}` holds a count of new addresses for that day and nothing else, for 40 days.
Every message sent to this list carries the one-click unsubscribe the weekly report already carries.

## The parent's rights, as implemented

- **See**: `/api/family/export` — everything above that belongs to the family, in one JSON document,
  after a fresh sign-in.
- **Delete the family**: `/api/family/deletion`, effective after 14 days, cancellable until then;
  the provider's subscription is ended first; what is kept is listed above and on the record.
- **Delete the sign-in account**: after the family is gone, from the no-family screen; the identity
  provider deletes email, password and phone.
- **Recover the account**: `RECOVERY.md` — self-service, seven days, no support shortcut.
- **Change the mobile number**: *Change my mobile number* in Mission Control — a fresh sign-in, a code to the new number, the old factor removed only once the new one is enrolled.
- **Choose the emails** (email-v1): at sign-up, account and progress emails are the required box and news and offers a separate, unticked one, because consent made a condition of sign-up is not consent (Indonesia PDP Law 27/2022, Singapore PDPA s.14(2)(a), GDPR art. 7(4)); afterwards *Email updates* in Mission Control (a recent sign-in), *Stop weekly reports* in every report, or the mail app's own unsubscribe (RFC 8058 one-click). The report can be weekly, once a month, or off, and the unsubscribe page offers monthly before off. Each change is recorded with its door.
- **Leave, or pause** (12 Sep 2026): *Cancel or pause* in Mission Control, and the same page from an email's unsubscribe link. It says what will and will not change before anything is chosen, asks why (one reason from a fixed list, and up to 500 optional characters), offers at most one alternative set per family per 90 days, and only then keeps, reduces the emails, pauses for one to three months, schedules a smaller plan, or cancels at the period end. A pause collects nothing and grants nothing beyond the period already paid for; the children's profiles, progress and coins are untouched by every one of those choices.

## What is not collected

No location, no contacts, no device identifiers beyond what the browser sends with every request,
no analytics SDK, no third-party scripts other than the identity provider's, no advertising, no
child-facing communication of any kind. Demographic fields (age, year level) exist for placement and
for aggregate analysis of the learning path; they are never shown to other families and never sold.

## Before real families

- Legal review of this inventory for the launch country (children's data, consent wording, the
  14-day deletion window, the financial retention exception, the 400-day audit window).
- ~~The parent-facing disclosure and consent version (`consentVersion`) updated from `pilot-v1`.~~ Done 13 Sep 2026: the Terms of
  Service, Privacy Policy and Refund Policy are public at `/terms`, `/privacy` and `/refunds`, in English and under `/id/` in Bahasa
  Indonesia (`server/site-pages.mjs`, the parent-facing form of this inventory: a change to one is a change to the other). Sign-up
  cannot be sent without the terms box, and creating a family requires and records `consentVersion: terms-2026-09-13`. The words
  still need the launch-country legal review below before real money is taken.
- Logging retention set and verified on the staging project (`DEPLOY_V3.md`).
- The email wording (`email-v1`: the two sign-up boxes and the report's footer) in the same legal review; a verified sending domain at the email provider, and its data-processing terms, before any family but the owner's gets an email.
- A named person who answers export/deletion requests that arrive outside the app, using only the
  CLI commands in `SUPPORT.md`.
