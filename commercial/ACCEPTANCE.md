# Device acceptance — the owner's checklist (Stage 4.6)

Run on the staging origin (`DEPLOY_V3.md`), never on the emulator origin, with a test family the
operator granted seats to, and with Stripe in test mode if 4.2 is live. Three devices minimum:
**iPhone Safari**, **Android Chrome**, **desktop Chrome or Edge**. Each row is a pass only when the
expected result is seen on every device; note the device and the date next to anything that fails.
Evidence: a screenshot per failed row and the family report (`scripts/support.mjs family`) at the
end of the run. Nothing here requires code; every failure is a ticket for the next PR.

## Parent

| # | Do | Expect |
|---|---|---|
| P0 | Open the site on each device | the Mission Control shell: the grid and aurora behind a dark panel, the AUTOMATHTICS mark in Orbitron, mono `// STEP` labels, violet-to-magenta buttons — the same look as the game; every word readable without zooming; no request to Google Fonts (the faces are served by the app) |
| P1 | Create a parent account; open the verification email on the phone | the app refuses the family screens until verified; after the link, *I have verified my email* continues |
| P2 | Enrol the mobile: country code, consent box, SMS code | one SMS; a wrong code is refused; after the code the Send button is disabled and counts down from `0:00:30`, second by second, and comes back at zero; after enrolment the app asks to sign in again |
| P2b | Ask for a code each time the Send button comes back, four times; then open the same screen in a private window and ask again at once | the first three codes arrive 30 seconds apart; after the third the button counts down from `0:02:00`, and after the fourth from `0:15:00`; in the private window (no record on that device) the request is refused by the ladder and the button counts down from the server's seconds, or, if they are not relayed, the plain sentence about spaced-out codes shows (the SMS ladder: at once, 30 s, 30 s, 2 min, 15 min, 1 h, 6 h, 12 h, a day before the ninth — `DEPLOY_V3.md` section 5) |
| P3 | Sign in with password + SMS | the family setup screen; cookie is HttpOnly (no `document.cookie` in the console) |
| P4 | Create the family with the attestation unticked, then ticked | refused, then created; the family reference is shown |
| P5 | Add a child: nickname, PIN, age, year level, each of the three starting options | all three accepted; year/test options need a year; the placement card shows for *test* |
| P6 | Reload, close the tab, reopen | still signed in within 30 minutes; after 30 minutes idle, the sign-in screen |
| P6b | Sign in with *Remember this device for 30 days* ticked; close the browser; the next day open the app from a bookmark or home-screen shortcut. Then *Hand over to kids*, close and reopen. Then change the password from another device | Mission Control opens without signing in and says until when the device stays signed in; after the handover the launch pad opens without signing in, and Mission Control needs the full password + SMS sign-in again; after the password change the device is back at sign-in within a couple of minutes. Left unticked, P6 applies |
| P7 | Sign out; press back | no family data visible; API calls answer 401 |
| P8 | A sensitive action (PIN reset, plan change, deletion) after 5 minutes idle | a fresh password + SMS check is demanded; cancelling discards the action |
| P9 | Open the parent workspace in two tabs; sign out in one | the other tab returns to sign-in on its next action |

## Handover and child

| # | Do | Expect |
|---|---|---|
| C1 | *Hand over the device*; pick a child; enter the PIN | child screen; the parent screens are unreachable without the parent signing in again |
| C2 | Wrong PIN five times | lockout message with a wait; the parent can reset the PIN after re-verifying |
| C3 | The placement test on a Year 2 child (*recommended* option) | 25 questions (15 Engine, 10 Navigator), a visible timer, a result and a starting point; cannot be retaken |
| C4 | Play an Engine paper and a Navigator paper to the end | pass/fail shown, wallet moves, history row appears; the parent sees it in the workspace |
| C5 | Navigator *Read aloud* | speech on iPhone and Android (first tap may need the device unmuted); silent, not broken, where unsupported |
| C6 | Rotate the phone mid-paper; switch apps and come back within a minute | the paper continues; the timer is honest (server time) |
| C7 | Kill the browser mid-paper; return | the session is either resumed or recorded as left at Qn — never lost silently |
| C8 | Shop: buy an item, equip it; Surprise Box; Mystery Egg | server-chosen results; balances never go negative; the ledger view in the parent workspace matches |
| C9 | *Switch child* and *Parent sign-in* from the child screen | the selector needs the family device session; the parent needs password + SMS |
| C10 | In a tab that showed another site first, open v3, tap once, then press Back repeatedly from a child's shop, map and game, and from a parent sub-screen | each Back goes one step inside v3: to the child's home (a game stays under *Continue*) or to the parent workspace. Browsers may let a Back pressed before the first tap, or mashed, leave the page; the old v2 site is offline since 11 Sep 2026, so that lands on GitHub's 404 page. Opening v3 in a fresh tab, or from the home screen, leaves nothing behind it |

## Money (test mode only)

| # | Do | Expect |
|---|---|---|
| M1 | Start the free trial | once per verified phone; a second family on the same phone is refused |
| M2 | Checkout with card 4242… | hosted page opens; on return the app says the provider confirms; within a minute the plan shows |
| M3 | Start a second checkout before paying the first, then try to pay the first | the first page is expired at Stripe; the second completes |
| M4 | Upgrade; downgrade with the seat choice; undo the downgrade | proration invoiced (upgrade); seats not lost before the period end; `reconcile-provider` matches after each |
| M5 | Cancel at period end; undo | the flag moves at Stripe each time; access continues to the period end |
| M6 | Refund in the dashboard (partial, then full) | recorded; access ends on the full refund |

## Recovery and deletion

| # | Do | Expect |
|---|---|---|
| R1 | On the SMS step choose *I can't receive the code* on a second test account | the ceremony screen; *Start* answers with a date; the reset email arrives from the provider |
| R2 | Sign in normally on that account during the wait | the request is cancelled; the notice shows once; *It was me* clears it |
| R3 | (Staging with a short `RECOVERY_WAIT_MS` build only) complete after the wait | password-only sign-in demands a new mobile; after enrolment the same family opens |
| D1 | Export the family | a JSON download with every child, history and the subscription facts |
| D2 | Request deletion; cancel; request again | the 14-day notice; cancel restores; the operator can force-execute on staging and the tombstone remains |
| D3 | After deletion, delete the sign-in account | refused before the family is gone; then the provider account disappears; the trial cannot be taken again on the same phone |

## Failure states

| # | Do | Expect |
|---|---|---|
| F1 | Airplane mode mid-action | a clear message, no half-applied state after reconnecting; a retried click is not a second purchase (operation ids) |
| F2 | Expired session mid-form | the sign-in screen, then the form again; nothing submitted twice |
| F3 | Wrong origin (open the API host directly) | the API refuses browser calls without the app's origin |
| F4 | Old bookmark to the v2 game | v2 still works and is unaffected (PR #1 is draft) |

Sign-off: date, devices, rows failed, tickets opened. The pilot (`PILOT.md`) starts only with every
row green on every device.
