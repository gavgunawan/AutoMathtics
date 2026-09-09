# Account recovery — policy and ceremony (Stage 4.4)

A parent signs in with a password and an SMS code to the mobile number they verified. The phone is
the identity the server keys families to (an HMAC of the number, never the number). This document
says what happens when that phone is gone, and what nobody — the parent, an attacker, support —
can shortcut. The policy comes first; `server/recovery.mjs` implements exactly this and nothing more.

## Two different situations

| | Who | What happens |
|---|---|---|
| **Changed number, old phone still works** | the parent | no ceremony: sign in normally, then use *Change mobile number* (the identity provider's own unenroll-and-enrol flow, which needs a fresh sign-in); the next sign-in carries the new factor, the family and everything in it are unchanged |
| **Lost phone / number gone** | the parent, alone | the recovery ceremony below |

Support has no third path. There is no command that removes a second factor, no command that
completes a recovery, and no way to shorten the wait. The operator's only verb is **cancel**.

## The ceremony

1. **Ask.** On the SMS step the parent chooses *I can't receive the code* and enters the account
   email. The server records a request (`recoveries/{uid}`) with the moment it can complete —
   **seven days** later — and answers the same way whether or not an account exists, has a second
   factor, or already has a request: "accepted, from *now plus seven days* at the earliest". An
   existing request keeps its own, earlier date and is not restarted; the parent learns that date
   only by completing. Completing answers "not completed" identically for an unknown address, an
   account without a request, missing proof and an unfinished wait — nothing about an account can be
   learned from these two forms.
2. **Prove the inbox.** Before anything can complete, the parent must reset the password through
   the identity provider's own emailed link (*Forgot password* / *Send password reset email*).
   The server never handles the password; it sees only that the provider revoked the account's
   tokens after the request, or that the password hash changed (it keeps an HMAC of the hash for
   the comparison, never the hash). Without this, the request never completes, however long it waits.
3. **Wait.** Seven days. During the wait the account works exactly as before for anyone who still
   has the phone: a full sign-in **cancels the request**, and the parent then sees a notice
   ("a recovery was requested on … and cancelled by this sign-in; if that wasn't you, reset your
   password"). This is the owner's protection against someone who has the email inbox and the
   password but not the phone.
4. **Complete.** After the wait the parent returns and chooses *Complete recovery*. Only now,
   with proof present, the server **claims** the request — `pending` → `completing`, in a
   transaction that re-reads it, so a sign-in that cancelled it a moment earlier wins and the
   provider is never asked — and only then removes the enrolled phone factor at the provider, ends
   every session of the account and invalidates older tokens. The claim is the point of no return:
   a sign-in after it cancels nothing, and its session does not survive the completion. A provider
   fault after the claim leaves `completing`; the next attempt resumes there.
5. **Re-enrol.** The parent signs in with the password; the server refuses the session until a
   mobile is verified again (`VERIFY_MOBILE_WITH_MFA`), the normal enrolment ceremony runs, and
   the next sign-in carries the new factor. The parent record's phone key follows the new number.
   The family, its children, its subscription and its ledgers are untouched: recovery changes
   *how the parent signs in*, never *what they own*. A request that is not completed within
   thirty days of its date lapses.

## What this does and does not protect against

- **Lost phone, honest parent**: recovered in seven days without support, with their own inbox.
- **Attacker with the password only**: cannot start a useful request (no inbox → no proof).
- **Attacker with the inbox and the password, not the phone**: can start and prove; the owner
  has seven days of ordinary sign-ins to notice the notice and cancel; the owner should then
  reset the password. If the owner does not sign in for seven days, the attacker completes — the
  same exposure as any lost-factor recovery that relies on the account's email. The waiting
  period is the control; the owner can ask the operator to **cancel** (and the operator can do
  nothing else).
- **Social engineering of support**: nothing to engineer — support cannot remove a factor,
  shorten a wait or complete a request; every operator action is a CLI command under an
  identity and writes an audit row.
- **Not covered at zero cost**: a notification to the old phone or a second email channel. Both
  would need a paid sender. The notice on sign-in is the substitute; if the owner wants an
  out-of-band warning, that is a Stage 4.3+ cost decision (an SMS or email provider).

## Records

`recoveries/{uid}`: `status` (`pending`, `completing`, `completed`, `cancelled_by_sign_in`, `cancelled_by_operator`,
`expired`), `requestedAt`, `readyAt`, `snapshot` (revocation time and password-hash HMAC at the
request), `mfaUid` (the factor that was enrolled), `claimId` / `claimedAt` (the point of no return), `proof` (`tokens_revoked` or `password_changed`),
`completedAt` / `cancelledAt` / `cancelledBy` / `note`, `acknowledgedAt` (the parent has seen the
notice), `expireAt` (TTL: sixty days after `readyAt`). Audit rows: `parent.recovery_requested`,
`parent.recovery_cancelled`, `parent.recovery_completed`, `support.recovery_cancelled`. The family
report lists the parents' recovery records under **attention** when one is pending.

## Operator

`node scripts/support.mjs cancel-recovery UID "reason"` — the parent contacted you and it was not
them, or anything else looks wrong. Protective only. There is no other recovery command.

## Tested

In memory (`tests/recovery.test.mjs`): the uniform answer, the proof gate, the waiting gate, the
cancel-on-sign-in and its notice, the operator's cancel and the absence of any other operator
power, provider fault → pending, the re-enrolment sign-in and the unchanged family, no second trial
for the same family, the HTTP routes before any session with the pre-authentication CSRF token.
Against the real Auth emulator (`tests/emulator.integration.mjs`): the emailed reset link's code,
the factor removed only after the wait, the password-only token refused, a new number enrolled, the
same family reopened.
