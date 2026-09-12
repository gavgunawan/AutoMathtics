# The support desk (Stage 4.6)

One person runs this desk — the owner — from a phone, at no cost. Everything below is either a click
in a free console or a command that exists in this repository. Where the code cannot do something
yet, the section says so instead of inventing a command.

`SUPPORT.md` is the operator's reference (what each command does). This document is the desk: where
mail arrives, what gets answered when, and what gets escalated. The words to send are in
`SUPPORT_REPLIES.md`; incidents are in `INCIDENTS.md`.

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

## Feedback notes from the app — not built yet

**`FEEDBACK_TO` does not exist in this repository.** Nothing in `server/`, `public/` or
`scripts/` reads it, there is no feedback form in the parent screens, and no mail is sent by the
application at all — the only mail a parent ever receives from this system is the identity
provider's own (email verification, the password-reset link `RECOVERY.md` step 2 relies on). Do not
tell a parent that a note they typed in the app reached the desk; today it cannot have.

When it is built, this is the shape the desk expects, so the filters and labels above keep working:

| Field | Value |
|---|---|
| To | the `FEEDBACK_TO` address — the same `support@YOURDOMAIN` |
| Reply-To | the parent's own account address, so *Reply* in Gmail answers the parent |
| Subject | `[feedback] SCREEN — NOTE_ID` |
| Body | the screen the note was written on, the release commit (`/api/health` → `release`), the note id, then the parent's words |
| Never in it | the child's nickname, the PIN, the phone number, the session cookie, any part of a secret |

A note id makes the thread citable in an incident and in an audit row. Until the feature exists, a
parent's own mail is the only channel, and the *First reply* text is where they learn the address.

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
