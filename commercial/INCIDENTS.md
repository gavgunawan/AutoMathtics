# The incident log (Stage 4.6)

When something is wrong for a real family, it gets an incident: an id to put in the reply, a
timeline of what was actually done, and afterwards a postmortem short enough to write the same
evening. Three commands, one document per incident, an audit row for each. The severities and the
ladder they belong to are in `SUPPORT_DESK.md` → Escalation.

Nothing here is automatic. The nightly sweep fails visibly when it finds something
(`RECONCILIATION.md` → Routine sweep) and a parent's mail arrives in the inbox, but the decision
that *this is an incident* is the owner's, and so is every line of the record.

## The three commands

Run them with the preamble in `SUPPORT_DESK.md` → Running the commands from a phone (`source
~/am-ops.sh`). Arguments of the form `key=value` may come in any order; everything else is
positional, and an unquoted summary is rejoined instead of truncated.

```bash
node scripts/support.mjs incident open 1 "renewals charged twice" systems=payments families=2 sweep=SWEEP_UUID
node scripts/support.mjs incident note inc-20260912-4f2a "two invoice.paid events for the same period; the second is a redelivery"
node scripts/support.mjs incident close inc-20260912-4f2a "refunded both in the dashboard; recorded" follow-ups="pin the redelivery case in a test; check the other paying family"
node scripts/support.mjs incident list            # open ones, newest first; `closed` or `all` for the rest
```

- **`open SEVERITY "one line"`** — `SEVERITY` is `1`, `2` or `3`; anything else is refused with
  `INVALID_SEVERITY` and nothing is written. The one line is what you would say out loud. It prints
  the record, including the id: **write that id into the reply to the parent.**
  - `systems=a,b` — the parts involved, comma-separated, up to ten (`payments`, `sessions`,
    `learning`, `sms`, `hosting`, `firestore`, whatever fits). Free text, on purpose.
  - `families=N` — how many families are affected. `0` when it is nobody yet (a near miss found by
    the sweep). It is a count, never a family id: an incident is not one family's record, and the
    ids that belong in it go in a note.
  - `sweep=SWEEP_UUID` — the id of the nightly sweep run that named it (`sweeps/{id}`, printed by
    `node scripts/support.mjs sweep`). It must be a real uuid or the command is refused.
- **`note ID "what you did or found"`** — one line on the timeline, stamped with the time and the
  operator. Use it liberally: what you tried, what it showed, what you decided, when you told the
  parent. Only while the incident is open.
- **`close ID "how it ended"`** — the resolution, and optionally `follow-ups="one; two"`
  (semicolons, up to ten). **Closing is final**: a note or a second close is refused with
  `INCIDENT_NOT_OPEN`. What is learnt afterwards goes in the postmortem below, not back into the
  record.
- **`list [open|closed|all]`** — read-only, newest first, for the evening when you have lost the id.

Every one of these needs `OPERATOR_ID` (`OPERATOR_REQUIRED` otherwise) and the same project
confirmation as every other operator command. The operator's name is on the incident and on its
audit rows.

## The record

`incidents/{id}`, where the id is `inc-YYYYMMDD-xxxx` in UTC — short enough to type into a mail, and
sorted by the day it was opened.

| Field | What it holds |
|---|---|
| `id` | `inc-20260912-4f2a` |
| `status` | `open`, then `closed`. Nothing else, and never back |
| `severity` | `1`, `2` or `3` |
| `summary` | the one line, as opened |
| `systems` | the parts involved, as given |
| `familiesAffected` | a count |
| `openedAt` / `openedBy` | the moment, and the operator |
| `sweepId` | the nightly sweep run that named it, or `null` |
| `parentNoticeDueAt` | `openedAt` + 72 hours on **every severity 1**, else `null` — the deadline for telling affected parents when personal data was involved (`SUPPORT_DESK.md` → Escalation). The owner decides whether it was; when in doubt, tell them |
| `actions` | the timeline: `{ at, by, note }`, oldest first |
| `resolvedAt` / `resolvedBy` / `resolution` | the close |
| `followUps` | what is left to do, as given at the close |

Audit rows, all under the operator's identity, `familyId: null` (an incident spans families):
`support.incident_opened` (with the severity), `support.incident_note`, `support.incident_closed`
(with the severity and how long it was open). They expire by TTL 400 days like every other audit row;
the incident document itself does **not** expire — see Retention.

## Retention

`incidents/*` carries no `expireAt`: it is the accountability record a postmortem is written from,
and it outlives every family in it. It is listed in `RETENTION` (`server/support.mjs`) and in
`SUPPORT.md`, and `DEPLOY_V3.md` §4b names it among the collections that deliberately have no TTL
policy. A family's deletion never touches it — but note that an incident's *notes* are free text, so
**never paste a child's real name, a phone number, an email address or a PIN into one**. A family id
and a child id are enough, and they are what the rest of the tooling speaks.

## Postmortem template

Written the same evening if it can be, the next day at the latest, for **every severity 1 and every
severity 2**; never for a severity 3. It lives in this file, appended under *The log* below, so the
whole history is in one place and in git. Four questions, no more:

```markdown
### inc-YYYYMMDD-xxxx — one line, in the past tense

**Severity** 1 · **Opened** 2026-09-12 22:40 UTC · **Closed** 2026-09-13 01:05 UTC ·
**Families affected** 2 · **Systems** payments · **Sweep** SWEEP_UUID

**What happened.** What a parent saw, in their words if you have them, and what was true underneath.
Times in UTC, from the record's own timeline.

**Why it happened.** The actual cause, not the trigger. "A redelivered provider event was applied
twice because X" — not "Stripe sent an event".

**What caught it.** The nightly sweep, a parent's mail, the health check, a test that failed, or
luck. If the answer is luck or a parent, say so: that is the most useful line in the document.

**What changes.** One to three things, each of them something a person will actually do: a test that
would have caught it, a guard in the code, a line in a runbook, a check added to the sweep. Anything
bigger goes in the follow-ups of the record and is tracked there, not promised here.
```

Rules that keep this honest:

- Name no person. The owner is the only operator; blame is not information.
- Quote real times and real ids from `incidents/{id}`, not from memory.
- If a parent was told, say when and what they were told. If they were not, say that.
- If nothing changes as a result, write *"What changes: nothing — here is why"* and mean it. A
  postmortem that invents a fix nobody will build is worse than an honest one that does not.

## The log

Newest first. One heading per incident, in the shape above.

*No incidents yet. The desk opened in week 2026-W37 and the only family is the owner's own
(`PILOT.md`).*
