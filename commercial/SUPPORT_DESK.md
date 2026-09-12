# The support desk (Stage 4.6)

One person runs this desk — the owner — from a phone, at no cost. Everything below is either a click
in a free console or a command that exists in this repository. Where the code cannot do something
yet, the section says so instead of inventing a command.

`SUPPORT.md` is the operator's reference (what each command does). This document is the desk: where
mail arrives, what gets answered when, what gets escalated, and the two money procedures. The words
to send are in `SUPPORT_REPLIES.md`; incidents are in `INCIDENTS.md`.

## The one-time setup, in order

1. the inbox (below) — half an hour, once;
2. the labels and filters in Gmail (below) — ten minutes;
3. the fifteen canned replies as Gmail templates (`SUPPORT_REPLIES.md`) — an evening;
4. `~/am-ops.sh` in Cloud Shell (below), so a command at 11pm is two lines, not ten.

## The inbox

`support@YOURDOMAIN` through **Cloudflare Email Routing**, forwarding to the owner's Gmail. Free,
receive-only, no server to run. It needs a domain whose authoritative DNS is Cloudflare's. The
staging origin is `PROJECT_ID.web.app` and Firebase Hosting serves that name, so the domain here is
a domain the owner buys and parks on Cloudflare for mail — it does not have to serve the app.

Click by click, on a phone (Cloudflare dashboard → the domain):

1. **Email** → **Email Routing** → **Get started**.
2. **Destination addresses** → **Add destination** → the owner's Gmail address. Cloudflare emails a
   verification link to that Gmail. Open it and confirm. Nothing routes until this says *Verified*.
3. **Custom addresses** → **Create address** → custom address `support`, action *Send to an email*,
   destination the verified Gmail. Save.
4. **Catch-all address** → leave it **disabled**. A catch-all on a small domain is a spam funnel.
5. **DNS records** → **Add records automatically**. Cloudflare writes the records in the table below
   into the zone itself. If the zone already has MX records for another mail provider, Cloudflare
   says so — remove them first, or mail will go to the old provider.
6. **Overview** → the status must read **Enabled** and every record **green**.
7. Send one mail from a phone to `support@YOURDOMAIN` and watch it land in Gmail. That is the test;
   the console's own status is not.

### DNS records

Cloudflare adds these itself in step 5. The table is here so the owner can check the zone by hand,
or rebuild it if the zone is ever moved.

| Type | Name | Value | Notes |
|---|---|---|---|
| MX | `@` (the domain itself) | `route1.mx.cloudflare.net` | priority as Cloudflare's own page fills it in; `route1` is the first |
| MX | `@` | `route2.mx.cloudflare.net` | second |
| MX | `@` | `route3.mx.cloudflare.net` | third |
| TXT | `@` | `v=spf1 include:_spf.mx.cloudflare.net ~all` | SPF for the routing service |
| TXT | `_dmarc` | `v=DMARC1; p=reject; rua=mailto:support@YOURDOMAIN` | optional, recommended **only while nothing sends as this domain** |

Do not invent the MX priorities: use the numbers Cloudflare shows next to each record (they are
filled in by *Add records automatically* and visible under **DNS → Records**). Everything else in the
table is exact.

`p=reject` is safe here precisely because nothing ever sends mail *as* the domain — see the next
paragraph. If that ever changes, `p=reject` must come down first, or the new sender's mail is
rejected everywhere.

### Replies go out from the Gmail address, not from support@

Email Routing **receives** only. Cloudflare cannot send mail as `support@YOURDOMAIN`, and Gmail's
*Send mail as* needs an SMTP server of its own, which is a paid sender. So:

- the owner replies from Gmail; the parent sees the Gmail address in *From*;
- the Gmail signature names the desk: one line, `AutoMathtics support — support@YOURDOMAIN`, so a
  parent's reply to *that* address still arrives;
- the first reply (`SUPPORT_REPLIES.md` → *First reply*) says which address to write to.

That is the whole cost-free compromise. A real `From: support@…` is a Stage 4.3+ cost decision (an
SMTP sender), the same decision `RECOVERY.md` records for out-of-band notices.

### If there is no domain yet

Use the owner's Gmail address as the support address, publish that, and keep every label and target
below unchanged. The only loss is the name in front of the @ and the DMARC record. Do not use a
`+support` suffix as the published address: parents mistype it, and mail to the bare address then
looks like personal mail.

## Labels

Applied in this order, top to bottom. The first two decide what gets touched tonight; the rest decide
which reply to paste.

| Order | Label | Applies to |
|---|---|---|
| 1 | `child-safety` | anything about a child's safety, a stranger, self-harm, a real name or a photo reaching the app, a child in distress |
| 2 | `account-recovery` | lost phone, lost second factor, "I can't get the code", a suspicious recovery notice |
| 3 | `billing` | charges, invoices, plan and seat questions, a payment that failed |
| 4 | `bug` | it does not work, it crashed, a wrong number, a missing reward |
| 5 | `refund` | money back is asked for or offered |
| 6 | `cancel` | stop the subscription, pause, leave, delete our data |
| 7 | `feature-idea` | a suggestion |
| 8 | `other` | everything else |

Plus two that travel with the thread, not with the subject:

- `needs-reply` — the ball is here. It comes off when the reply is sent.
- `waiting-on-parent` — the ball is with the parent. It comes off when they answer.

`child-safety` and `account-recovery` always come first, whatever else the mail also is. A mail that
is both a billing question and a child-safety worry is `child-safety` first and is handled as
`child-safety`.

### The filters that do the sorting

Gmail → Settings → Filters → *Create a new filter*. One filter per label, matching words in the
subject or body, each with **Apply the label** and **Also apply the label `needs-reply`**. Suggested
matches, to be widened as real mail arrives:

| Label | Has the words |
|---|---|
| `child-safety` | `safety OR stranger OR "real name" OR photo OR scared OR bullying OR "self harm"` |
| `account-recovery` | `"can't receive" OR "lost my phone" OR "new number" OR "recovery" OR "can't sign in" OR "two factor" OR "verification code"` |
| `billing` | `invoice OR charged OR charge OR payment OR plan OR seat OR subscription OR receipt` |
| `bug` | `bug OR broken OR crash OR error OR "doesn't work" OR stuck OR frozen` |
| `refund` | `refund OR "money back" OR reimburse` |
| `cancel` | `cancel OR pause OR unsubscribe OR "delete our data" OR "delete my account"` |
| `feature-idea` | `idea OR suggestion OR "would be nice" OR "feature request"` |

Never let a filter archive or auto-reply. The desk is small enough to read; a filter that hides mail
is how a `child-safety` note goes unread for a week.

## Response-time targets

Measured from when the mail arrives to when a real reply is sent. An acknowledgement is a real reply
only if it says what happens next and when (that is what *First reply* is for).

| Label | Target |
|---|---|
| `child-safety` | **same day, before anything else** |
| `account-recovery` | one business day |
| `billing`, `refund` | one business day |
| `bug` | two business days — **same day** when it stops a child playing |
| `cancel`, `feature-idea`, `other` | three business days |

"Business day" is the owner's own working week; a Saturday mail on a `bug` is due Tuesday. The
`child-safety` target has no weekend.

These targets are **not stated inside the app today.** The parent screens have no help page: the app
is one shell (`public/index.html`) whose footer text is pinned by `tests/release.test.mjs`, and the
only support words in `public/app.js` are the error messages that say "contact support" without
naming an address or a time. Putting the address and this table in front of parents needs a small UI
change (a help panel in Mission Control) that this release does not make. Until then the targets
reach parents in the *First reply* text only, and that is a known gap — it is in **What only the
owner can do** below.

## Escalation

The owner decides. This is the ladder they decide against.

### Severity 1 — stop everything

Data loss; one family's data shown to another; money taken wrongly; the app down for everyone.

1. Stop feature work. Now, not after this one commit.
2. Open the incident: `node scripts/support.mjs incident open 1 "one line" systems=… families=N`
   (`INCIDENTS.md`). The id it prints goes in every reply about it.
3. Fix or roll back **the same day**. What roll back means, exactly:
   - **Traffic back to the last good revision** (fastest, no build, works from a phone): Cloud Run →
     service `automathtics-v3` → **Revisions** → the previously tested revision → **Manage traffic**
     → 100 % to it. Then Firebase Hosting → **Release history** → **Rollback** if the shell changed.
     Afterwards `curl https://PROJECT_ID.web.app/api/health` reports the **older** commit in
     `release` — that is the evidence the rollback happened.
   - **Redeploy the previous release from source**: in `~/AutoMathtics`, `git checkout THE_GOOD_SHA`,
     then `cd commercial && TRUSTED_PROXY_HOPS=2 npm run deploy:staging`. Note that Cloud Shell
     **block C** (`scripts/cloudshell/03-deploy.sh`) cannot do this: it runs `git pull --ff-only`
     first and would either fast-forward back to the tip or refuse on a detached HEAD. Block C
     redeploys *the tip of the branch*; use it to roll **forward** to a fix, and the two steps above
     to roll back.
   - Neither reverts database writes (`DEPLOY_V3.md` §7). A bad write is a data problem, and the
     sweep (`node scripts/support.mjs sweep`) is what names it.
4. **Tell affected parents within 72 hours when personal data was involved.** The incident record
   carries the deadline (`parentNoticeDueAt`) for every severity 1. The owner decides whether
   personal data was involved; when in doubt, tell them.
5. Close the incident and write the postmortem (`INCIDENTS.md`).

### Severity 2 — within the week

A family blocked out of the app; refunds stuck; a child's progress visibly wrong; the second factor
failing for one parent. Open an incident at severity 2, reply inside the label's target, fix within
the week.

### Severity 3 — the backlog

Everything else: cosmetic faults, single confusing screens, ideas. Open an incident only if it needs
tracking; otherwise the labelled thread is the record.

### What can actually be switched off

There is **no per-feature kill switch** in this build. `server/config.mjs` validates configuration; it
has no feature flags, and a missing value makes the server refuse to start rather than run with the
feature off. The real levers are:

| Lever | What it turns off | How |
|---|---|---|
| Cloud Run traffic on an older revision | the new code, everywhere | the console, above |
| `PAYMENT_PROVIDER=fake` with `FAKE_PAYMENTS_ACK=no-real-money` | **all real money**: checkouts go to the zero-cost fake gateway, no card is charged | redeploy with those two variables (`scripts/deploy-staging.sh` then binds the fake webhook secret instead of the Stripe ones) |
| Cloud Scheduler → the sweep job's schedule → **Pause** | the nightly invariant sweep only | the console; a paused sweep stops the alert, so unpause it the same week |
| Authentication → Settings → Blocking functions → remove *Before SMS is sent* | the SMS resend ladder (block F) — codes then flow at the provider's own quota | the console |
| `firestore.rules` | nothing: it already denies every client read and write; the server holds authority | — |

So: the app cannot be half-disabled. Severity 1 is a rollback decision, not a flag decision, and
that is the honest state of this release.

## Feedback notes from the app

The app's *Send feedback* panel sits under the sign-in screen and every parent screen, never on the
kids' side. Each note is stored with the screen it came from, and a copy is emailed to `FEEDBACK_TO`
when the running service is deployed with that address and an email provider configured.

**Check the running release before you answer.** `curl https://YOURAPP/api/health` names the commit it
serves. A release older than the feedback work sent nothing, so do not tell a parent their in-app note
arrived unless the release carries it; the identity provider’s own mail (verification, password reset)
is the only mail such a release ever sends.

A copy has this shape, which the filters and labels above expect:

| Field | Value |
|---|---|
| To | the `FEEDBACK_TO` address — the same `support@YOURDOMAIN` |
| Reply-To | the parent's own account address, so *Reply* in Gmail answers the parent |
| Subject | `[feedback] SCREEN — NOTE_ID` |
| Body | the screen the note was written on, the release commit (`/api/health` → `release`), the note id, then the parent's words |
| Never in it | the child's nickname, the PIN, the phone number, the session cookie, any part of a secret |

A note id makes the thread citable in an incident and in an audit row. Where the running release has no
feedback panel, a parent's own mail is the only channel, and the *First reply* text is where they learn

## Refunds

Money moves **at the provider, in its dashboard**. Nothing in this repository moves money, and there
is **no `refund` verb in `scripts/support.mjs`** — the spec for this desk asked for one and it does
not exist. What the repository does is *record* a refund on the subscription, so entitlement and the
audit trail agree with the money.

**When it applies.** The owner's call, in three cases that come up: a charge the parent did not
intend (a renewal they meant to cancel, a second charge); a plan they could not use (the app was
down, the family was blocked); a mistake of the desk's own. A refund is **not** the answer to
"we stopped using it" — that is a cancellation, below.

**What the parent is told.** `SUPPORT_REPLIES.md` → *Refund approved* or *Refund refused*. Both
quote the support operation id, say the amount, and say what happens to access. A refused refund
always gives the reason in one sentence.

**The commands, in this order.**

1. See the family and the money first:
   ```
   node scripts/support.mjs family FAMILY_UUID
   ```
   Read **attention** first: `refundFailures`, `requiresAction`, `rejected`, `providerCheck`. The
   `billing` list is the family's event ledger; `subscription.refunds` counts what is already
   recorded.
2. Refund the charge in the **Stripe dashboard** (test mode for the pilot; the pilot family itself
   runs on a manual grant and has no charge to refund — `PILOT.md`). Partial or full.
3. Stripe then sends `refund.created`, the inbox records it and the state machine applies it by
   itself. Check that it landed:
   ```
   node scripts/support.mjs family FAMILY_UUID
   node scripts/support.mjs inbox            # anything still requires_action
   ```
4. **Only if the event never arrives** (a provider the webhook cannot reach, the fake provider, a
   charge taken outside Stripe) record it by hand:
   ```
   node scripts/subscription.mjs FAMILY_UUID refund AMOUNT_CENTS full
   ```
   Leave `full` off for a partial refund. `AMOUNT_CENTS` must be at least 1 — a zero-cent "full"
   refund is refused (`INVALID_REQUEST`), on purpose, so a mistyped amount cannot cancel a family.
   A family with **no subscription record at all** (the pilot family on a manual grant) is refused
   with `INVALID_TRANSITION`: there is no money line to write the refund on, and that refusal is
   correct — the refund then exists only at the provider and in the thread.
5. A refund never cancels the subscription. If the family is also leaving, cancel it at the provider
   too, then:
   ```
   node scripts/support.mjs reconcile-provider FAMILY_UUID
   ```
   until `match: true`. A **full** refund ends our record, so a subscription left live at the
   provider makes the next run report `PROVIDER_SUBSCRIPTION_LIVE` — and the family would be billed
   again. After a partial refund both sides are still live and `match: true` is the right answer.
6. On a **deleted** family the same provider event is `reconciliation_required: FAMILY_DELETED` and
   never revives access. Close it with what was done:
   ```
   node scripts/support.mjs resolve-event stripe EVENT_ID refunded_at_provider "refunded in the dashboard, see incident/ticket"
   ```

**What the ledger shows afterwards.** In `families/{f}/billing/{eventId}`: one row of type `refund`
with `amountCents`, `full`, the actor (`webhook:stripe`, or the `OPERATOR_ID` when recorded by hand)
and its `result`. On `families/{f}.subscription`: a new entry in `refunds[]` with `amountCents`,
`full`, `at` and `providerRef`. Two partial refunds are two entries with their own amounts, never a
running total. A **full** refund also sets `state: 'cancelled'` and `endedAt: now` — access ends
immediately, which is the owner's policy — and clears any scheduled plan change. A partial refund
changes nothing about access.

Two honest details about the ids. `providerRef` on a `refunds[]` entry is the **customer**
reference, not the refund's own id (`server/payments.mjs` passes `ev.customer`), and it is `null`
when the refund was recorded by hand — `scripts/subscription.mjs` has no argument for it. Stripe's
own refund id *is* stored, as `refundRef` on the `billingEvents` row (that is what makes a second
delivery `DUPLICATE_REFUND`), but **neither `inbox` nor `family` prints it**: both print the provider
*event* id, which is the one `resolve-event` takes. So quote the support operation id or the ticket in
your reply, never `providerRef`, and match a refund to a Stripe refund id in the dashboard rather
than in the report.

**Child wallets are never touched.** No refund, dispute or cancellation posts a ledger row to a
child's coins or fuel. A child's ledger only moves when the child plays or the parent spends
(`SUBSCRIPTIONS.md`, `PAYMENTS.md`).

**The audit trail.** `billing.refund` with the actor and the family id, TTL 400 days. Plus
`support.event_resolved` if step 6 ran. A refund done only in the dashboard and never recorded leaves
`PROVIDER_SUBSCRIPTION_LIVE` or a drifting period end for the next `reconcile-provider` — that is the
check that catches a half-finished refund.

**A refund never removes access already paid for.** A partial refund leaves the period intact. A full
one ends it, because the money for it went back. There is no command that takes away a paid period
while keeping the money, and none should be added.

## Cancellations

**Default: at period end.** The parent keeps what they paid for and access stops when the period
does. Immediate cancellation happens **only** with a recorded refund decision (above) — either the
full refund's own effect, or the operator's `terminate` written down beside it.

**When it applies.** The parent asks to stop. That is all the justification needed; there is nothing
to argue.

**What the parent is told.** `SUPPORT_REPLIES.md` → *Cancellation confirmed*: the date access ends,
that the children's progress stays, that nothing is deleted by cancelling, and that deleting the
family is their own separate 14-day process. *Pause confirmed* covers "can we pause?" — and says
plainly that there is no pause in this build.

**The commands.**

1. The parent can do it themselves, and should be told so first: Mission Control → the subscription
   panel → *Cancel at period end* (`POST /api/billing/cancel`, undoable with the same panel). No
   operator command is better than the parent's own click.
2. If they cannot, or ask the desk to do it:
   ```
   node scripts/subscription.mjs FAMILY_UUID cancel.request
   ```
   and to reverse it while the period still runs:
   ```
   node scripts/subscription.mjs FAMILY_UUID cancel.undo
   ```
   Again: there is **no cancel verb in `scripts/support.mjs`**. `scripts/subscription.mjs` is the
   operator's event tool, under the same `OPERATOR_ID` and with the same audit row. It is refused
   (`INVALID_TRANSITION`) unless the subscription is in `trial`, `active` or `grace` — there is
   nothing to cancel in `past_due`, `cancelled` or `expired`, and nothing to cancel for a family on
   a manual grant.
3. Immediate, and only with the refund decision recorded:
   ```
   node scripts/subscription.mjs FAMILY_UUID terminate
   ```
   This ends access now. Record the refund first (or immediately after), so the audit trail shows
   money and access ending together.
4. Cancel it at the provider too, in the dashboard, then:
   ```
   node scripts/support.mjs reconcile-provider FAMILY_UUID
   ```
   until `match: true`. `cancel.request` through the parent's own route already reaches Stripe before
   the record changes; `scripts/subscription.mjs` does **not** — it writes a `manual` event only. So
   step 4 is mandatory after step 2 or 3.
5. **Deleting data is the parent's own 14-day process**, never the desk's shortcut: Mission Control →
   *Delete my family* (`POST /api/family/deletion`), a *Keep my family* button for 14 days, and then
   an operator executes it:
   ```
   CONFIRM_DELETION=FAMILY_UUID node scripts/support.mjs delete FAMILY_UUID
   ```
   The sweep names one that is due (`DELETION_DUE`). Never run it with `FORCE_BEFORE_GRACE=yes`
   unless the parent asked for it in writing in the thread; it is audited as forced.

**What the ledger shows afterwards.** `cancel.request` / `cancel.undo` / `terminate` each add a row
to `families/{f}/billing/{eventId}` with the actor and the result. On the subscription, a period-end
cancellation sets one fact: `cancelAtPeriodEnd: true`. Nothing else moves — the derived state stays
**`active`** and access continues while `now < periodEnd`; at the period end it becomes `cancelled`
instead of entering grace (a cancelled trial ends at `trialEndsAt` the same way), and `accessUntil`
is then 0. `terminate` instead sets `state: 'cancelled'` and `endedAt: now` at once, clearing any
scheduled change. Seats and children are untouched either way — a cancelled family's children keep
every ledger row and every crown; a later payment brings them back exactly as they were.

**The audit trail.** `billing.cancel.request`, `billing.cancel.undo`, `billing.terminate` under the
`OPERATOR_ID` (or the parent's uid when they clicked it), and for a deletion
`family.deletion_requested`, `family.deletion_started`, `family.deleted` plus the `deletions/{f}`
record naming who asked and who executed.

## Support operation ids, and quoting them

Every corrective action that runs as a job writes `supportOperations/{id}` naming the operator before
anything moves, and closes it with how it ended (`reprocess` today; the incident commands write
`incidents/{id}` the same way). Reconciliations write `billingReconciliations/{id}`; both ids are
printed by the command that made them. **Quote the id in the reply** — it is how a parent's mail,
the audit row and the money line up months later.

Where the repository has no id to quote (a refund done in the dashboard and applied by webhook, a
`cancel.request`), quote the incident id if there is one, otherwise the Gmail thread subject. Do not
invent an id.

## Running the commands from a phone

Cloud Shell in a mobile browser, one file created once so that 11pm is two lines. In Cloud Shell,
`~/am-ops.sh`:

```bash
export APP_MODE=staging
export PROJECT_ID='automathtics-v3-staging'
export FIREBASE_PROJECT_ID="$PROJECT_ID" CONFIRM_PROJECT="$PROJECT_ID"
export OPERATOR_ID='owner@yourdomain'          # an audit label; IAM is the permission
export SESSION_SECRET="$(gcloud secrets versions access 1 --secret am-v3-session --project "$PROJECT_ID")"
export PIN_PEPPER="$(gcloud secrets versions access 1 --secret am-v3-pin-pepper --project "$PROJECT_ID")"
export STRIPE_SECRET_KEY="$(gcloud secrets versions access 1 --secret am-v3-stripe-key --project "$PROJECT_ID")"
export WEBHOOK_SECRET_STRIPE="$(gcloud secrets versions access 1 --secret am-v3-webhook-stripe --project "$PROJECT_ID")"
export STRIPE_PRICE_STARTER='price_1UDktFEAg0w7lrNU8ixmQg6g' STRIPE_PRICE_FAMILY='price_1UDktZEAg0w7lrNU0kJdqUxK' STRIPE_PRICE_BIG='price_1UDktlEAg0w7lrNUb4AwLnP3'
cd ~/AutoMathtics/commercial
```

Then, each session:

```bash
source ~/am-ops.sh
node scripts/support.mjs family FAMILY_UUID
```

The secrets are fetched into the shell's environment and never printed or written to a file. The
tool refuses to run without `OPERATOR_ID`, without `CONFIRM_PROJECT` matching the project, or with
any `*EMULATOR*` variable set — those guards are why the preamble is this long. `SESSION_SECRET` and
`PIN_PEPPER` are needed because the tool constructs the same services the server does, even for a
command that only writes an incident note.

## The weekly ops line

One line per week, appended below, written on the same evening as the `inbox` and `sweep` check. It
is the only place the desk's own performance is recorded, and its history is this file's git history.

Format: `| ISO week | mail | answered inside target | outside, and why | incidents opened / closed | sweep findings |`

| Week | Mail | Inside target | Outside, and why | Incidents (open/closed) | Sweep findings |
|---|---|---|---|---|---|
| 2026-W37 | — | — | desk set up; no parent mail yet (the pilot family is the owner's own) | 0 / 0 | — |

## What only the owner can do

None of this can be done from a repository, and none of it is done:

1. **Buy a domain and park it on Cloudflare**, then run *The inbox* above — including opening the
   verification mail Cloudflare sends to the Gmail, and sending the one test message.
2. **Create the Gmail labels and filters** in *Labels* above, including the two travelling labels,
   and confirm no filter archives anything.
3. **Save the fifteen canned replies as Gmail templates** (Settings → Advanced → Templates on, then
   Compose → ⋮ → Templates → Save draft as template), named exactly as the headings in
   `SUPPORT_REPLIES.md` so the right one is findable at 11pm.
4. **Set the Gmail signature** to the one line naming `support@YOURDOMAIN`.
5. **Create `~/am-ops.sh`** in Cloud Shell (above) and check `node scripts/support.mjs family …`
   answers for a real family id.
6. **Decide and write down the reply address that goes in front of parents**, and accept that until
   the app has a help panel, parents learn the address and the targets from the *First reply* only.
7. **Ask for the app-side work** this desk cannot do itself: the feedback form and `FEEDBACK_TO`, and
   a help panel carrying the support address and the response-time table.
