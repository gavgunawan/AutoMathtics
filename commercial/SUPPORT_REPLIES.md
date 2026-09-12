# Canned replies (Stage 4.6)

Fifteen replies, one per situation the desk actually sees (`SUPPORT_DESK.md` → Labels). Each is under
120 words, written to be read on a phone by a worried parent, and none of them ever asks for a
password, a PIN or a card number.

## How to use these

1. Save each block as a Gmail template: Settings → **Advanced** → Templates **on**, then Compose →
   ⋮ → **Templates** → *Save draft as template*. Name it exactly as the heading here, so searching
   "refund" at 11pm finds the right one.
2. Paste, then **replace every `CAPITALISED_PLACEHOLDER`**. A reply that still says `DATE` or
   `AMOUNT` is worse than no reply.
3. Quote the id (`SUPPORT_OPERATION_ID`, `INCIDENT_ID`, or the thread subject when the repository has
   no id to give — `SUPPORT_DESK.md` → Support operation ids).
4. Remove the `needs-reply` label, add `waiting-on-parent` if the ball is now theirs.
5. Never paste two of these into one mail. One situation, one reply.

The placeholders, in full:

| Placeholder | What goes there |
|---|---|
| `TARGET` | the date the response-time target falls on (`SUPPORT_DESK.md` → Response-time targets) |
| `DATE` | a real date, written out: *3 October 2026* |
| `AMOUNT` | the amount with its currency, as the provider's dashboard shows it |
| `SUPPORT_OPERATION_ID` | the id the command printed (`supportOperations/{id}`, `billingReconciliations/{id}`) |
| `INCIDENT_ID` | the incident id (`INCIDENTS.md`), e.g. `inc-20260912-4f2a` |
| `TICKET_OR_INCIDENT_ID` | the incident id if there is one, otherwise the Gmail thread subject |
| `REASON_IN_ONE_SENTENCE`, `WHAT_WAS_WRONG_IN_ONE_SENTENCE`, `WHAT_I_HAVE_DONE_SO_FAR`, `WHAT_YOU_ASKED_FOR_IN_YOUR_WORDS` | your own words, one sentence |
| `support@YOURDOMAIN` | the published support address |

## Never ask for a secret

No reply here asks a parent to send a password, a PIN, a card number, a card's security code or bank
details — not to prove who they are, not to "check the account", not ever. There is nothing the desk
could do with one: passwords live with the identity provider, PINs are stored so that even the owner
cannot read them, and card details never reach this system at all (the provider's hosted page takes
them). A message that asks a parent for any of those is not from this desk, and the *First reply*
says so in as many words.

`tests/support-desk.test.mjs` reads every block below and fails the build if one of them asks.

## The replies

### 1. First reply (acknowledge, and say when)

```text
Thanks for writing, and sorry for the trouble.

I have your message, and I am the person who answers it — there is one of
us, so replies are quick but not instant. I will come back to you by
TARGET. If something is stopping a child from playing, say so in a reply
and I will look the same day.

You can always write to support@YOURDOMAIN and I will see it. Support
never asks you for your password, a PIN or a card number — if a message
claiming to be us does, it is not us.

Reference: TICKET_OR_INCIDENT_ID.
```

### 2. Recovery started

```text
Your account recovery is under way. Here is exactly how it goes.

It can complete seven days after you asked. That wait is what protects
your family from someone who has your email but not your phone.

Before it can finish, choose "Forgot password" on the sign-in screen and
open the link the email service sends you. Without that step it never
completes, however long it waits.

If you can sign in normally at any point, do — that cancels the recovery,
which is exactly what you want if the phone turns up.

After the seven days, choose "Complete recovery", then verify a new
mobile number. Your family, the children and their progress are untouched.

Reference: TICKET_OR_INCIDENT_ID.
```

### 3. Recovery not possible (no faster path exists)

```text
I cannot speed this up, and I would rather tell you why than stall.

Support has no way to remove a second factor, shorten the seven-day wait,
or complete a recovery for someone. There is no override — not for me,
and not for anyone claiming to be me. That is deliberate: it is what
stops a stranger talking their way into your family's account.

The one thing I can do is cancel a recovery request, if you tell me it
was not you who started it. I would do that immediately.

So the path is the seven days, plus the password-reset link that proves
the inbox. I will keep an eye on it with you.

Reference: TICKET_OR_INCIDENT_ID.
```

### 4. Password reset

```text
You can reset it yourself, and I never see it.

On the sign-in screen choose "Forgot password". The email service sends a
link to your account address; open it and set a new one. Passwords are
handled by that service, not by me — nothing in my tools shows, sets or
checks one.

If the mail does not arrive, look in spam, then try once more and use the
newest link; they expire.

You will still need the code sent to your mobile to finish signing in. If
that phone is gone for good, reply here and I will start account recovery
instead.

Reference: TICKET_OR_INCIDENT_ID.
```

### 5. Mobile number changed

```text
Two situations, and the easy one is probably yours.

If your old phone still receives messages: sign in as usual, then
Mission Control → Change my mobile number. It asks you to sign in
freshly, sends a code to the old number, then a code to the new one, and
removes the old number only once the new one works. Your family is
unchanged throughout.

If the old number is gone for good, that is account recovery: seven days,
plus a password reset through the emailed link to prove the inbox. Reply
and I will walk you through it.

I cannot move a number across for you. Nobody at support can.

Reference: TICKET_OR_INCIDENT_ID.
```

### 6. PIN reset

```text
A child's six digits are yours to reset, from your own screen.

Sign in, open Mission Control, choose the child, then Reset PIN and set
the new six digits. It will make you sign in freshly first. Nobody at
support can read or set a child's code — they are stored so that even I
cannot.

Five wrong tries lock that child out for fifteen minutes. Waiting it out
works, and so does resetting, which clears the lock at once.

If the screen refuses the reset, tell me what it said on screen and I
will look into it.

Reference: TICKET_OR_INCIDENT_ID.
```

### 7. Refund approved

```text
Approved, and thank you for your patience.

I have refunded AMOUNT through the payment provider, back to the way you
paid. How soon it shows up is your bank's pace, usually a few working
days. You do not need to do anything.

A partial refund leaves your access exactly as it is, to the end of the
period you paid for. A full refund ends access straight away, because the
money for it has gone back.

Either way your children's progress, coins, crowns and rewards stay as
they are, and nothing is deleted.

Reference: SUPPORT_OPERATION_ID.
```

### 8. Refund refused, with the reason

```text
I am not going to refund this one, and here is the reason.

REASON_IN_ONE_SENTENCE.

I know that is not the answer you wanted. What I can do instead: cancel
the subscription at the end of the period you have already paid for, so
nothing renews and you keep the time you bought. Say the word and I will
set that up today — or do it yourself in Mission Control, which is one
click.

If I have misread this — a charge you never made, or days the app was
down for you — tell me what happened and I will look again properly.

Reference: TICKET_OR_INCIDENT_ID.
```

### 9. Cancellation confirmed

```text
Done. Nothing will renew.

Your access runs to DATE, the end of the period you have already paid
for. I do not cut that short; the time is yours. After that date the
children's screens stop, and their progress, coins, crowns, items and
rewards are all kept exactly as they are.

Cancelling deletes nothing. If you also want your family's data removed,
that is your own action in Mission Control: Delete my family, which
schedules it fourteen days out and shows a "Keep my family" button the
whole time.

Changing your mind before DATE is one click in Mission Control.

Reference: SUPPORT_OPERATION_ID.
```

### 10. Pause confirmed — what "pause" means here

```text
There is no pause button, and I would rather say so than pretend.

The closest thing: cancel at the end of the period you have paid for.
Access runs to that date, nothing renews, and every bit of the children's
progress is kept — coins, crowns, items, rewards, all of it.

When you want to come back, start the plan again from Mission Control.
The children carry on exactly where they stopped. Nobody restarts.

Cancelling deletes nothing, and I will not delete anything unless you ask
for it yourself in Mission Control.

Shall I set the cancellation for DATE?

Reference: TICKET_OR_INCIDENT_ID.
```

### 11. Bug received

```text
Thank you — that is a real bug report, and I would much rather have it.

It is written down. If it is stopping a child from playing I will look
today; otherwise within two working days.

Three things make it far quicker to find, and none of them are private:
which screen you were on, roughly what time it happened, and what you
expected to see instead. The version is in the footer at the bottom of
the page.

Please do not send screenshots showing a child's real name — the nickname
is all I need.

Reference: TICKET_OR_INCIDENT_ID.
```

### 12. Bug fixed and deployed

```text
Fixed, and the fix is live.

WHAT_WAS_WRONG_IN_ONE_SENTENCE. It is deployed now: reload the page once
and you are on the new version — the number in the footer changes when
you do.

Nothing was lost while it was broken. If a child's coins or progress look
wrong after the reload, give me the child's nickname and I will check
their ledger against their wallet myself.

Thank you for reporting it. This one was found because you wrote in,
which is how most of them are found.

Reference: TICKET_OR_INCIDENT_ID.
```

### 13. Feature idea noted

```text
Noted properly, not politely.

WHAT_YOU_ASKED_FOR_IN_YOUR_WORDS — written down, with your name against
it, in the list I actually build from.

I cannot promise it or give you a date. One person builds this, so the
queue is short and honest: anything about a child's safety, then anything
broken, then money, then new things. Ideas that stop a child getting
stuck move up.

If it lands, I will write back on this same thread so you know it was
yours.

Reference: TICKET_OR_INCIDENT_ID.
```

### 14. Child-safety escalation

```text
I have stopped what I was doing to read this properly.

This is the one thing I handle the same day, before everything else.
Where it stands right now: WHAT_I_HAVE_DONE_SO_FAR.

If a child is in danger at this moment, please contact your local
emergency service — I am one person with a laptop, and they are not.

Tell me anything else you have noticed, in your own words, whenever you
are ready. There are no account details I need from you for this.

I will write again by the end of today with what has changed, and this
thread stays open until you tell me it is finished.

Reference: INCIDENT_ID.
```

### 15. We cannot discuss another family's data

```text
I cannot talk to you about another family's account, and I hope that is
what you would want from us.

Everything I can see is scoped to the account that writes to me. I cannot
confirm whether an address has an account, read another family's
children, move a child from one family to another, or tell one parent
what another has done. No command in my tools does any of that.

If you share an account with someone, whoever signs in can see it — they
are the one to ask.

If you believe a child is at risk, say so in a reply and I will treat it
as a safety matter today.

Reference: TICKET_OR_INCIDENT_ID.
```

## What these replies deliberately do not say

- They never promise a date for a fix or a feature.
- They never say a parent's note from inside the app reached the desk: there is no feedback form and
  nothing reads `FEEDBACK_TO` yet (`SUPPORT_DESK.md` → Feedback notes from the app).
- They never say a subscription is *paused*: the code has no pause.
- They never offer to delete a family's data on the parent's behalf. That is the parent's own
  fourteen-day action, and an operator only executes it once the fourteen days have passed.
- They never quote an id the repository did not print.
