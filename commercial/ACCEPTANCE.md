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
| P1a | On *Create parent account* type a password, then a different one under *Type the password again*, and press the button; then type the same password in both | refused with a note that the two passwords don't match, and nothing is sent: no verification email, no account at the provider; with the same password twice the account is created and P1 goes on |
| P2 | Enrol the mobile: country code, consent box, SMS code | one SMS; a wrong code is refused; after the code the Send button is disabled and counts down from `0:00:30`, second by second, and comes back at zero; after enrolment the app asks to sign in again |
| P2b | Ask for a code each time the Send button comes back, four times; then open the same screen in a private window and ask again at once | the first three codes arrive 30 seconds apart; after the third the button counts down from `0:02:00`, and after the fourth from `0:15:00`; in the private window (a device with no record yet) the request is refused by the ladder, and the button counts down from the server's seconds if they are relayed, or else from that device's own estimate, which starts at its first rung and can be shorter than the server's wait: a press at zero is then refused again and the countdown steps up until the two agree, so a parent is delayed, never locked out (the SMS ladder: at once, 30 s, 30 s, 2 min, 15 min, 1 h, 6 h, 12 h, a day before the ninth — `DEPLOY_V3.md` section 5) |
| P3 | Sign in with password + SMS | the family setup screen; cookie is HttpOnly (no `document.cookie` in the console) |
| P4 | Create the family with the attestation unticked, then ticked | refused, then created; the family reference is shown |
| P5 | Add a child: nickname, PIN, age, year level, each of the three starting options | all three accepted; year/test options need a year; the placement card shows for *test* |
| P6 | Reload, close the tab, reopen | still signed in within 30 minutes; after 30 minutes idle, the sign-in screen |
| P6b | Sign in with *Remember this device for 30 days* ticked; close the browser; the next day open the app from a bookmark or home-screen shortcut. Then *Hand over to kids*, close and reopen. Then change the password from another device | Mission Control opens without signing in and says until when the device stays signed in; after the handover the launch pad opens without signing in, and Mission Control needs the full password + SMS sign-in again; after the password change the device shows the sign-in screen at its next action or reload (the server rechecks the account at most a minute late). Left unticked, P6 applies |
| P7 | Sign out; press back | no family data visible; API calls answer 401 |
| P8 | A sensitive action (PIN reset, plan change, deletion) after 5 minutes idle | a fresh password + SMS check is demanded; cancelling discards the action |
| P9 | Open the parent workspace in two tabs; sign out in one | the other tab returns to sign-in on its next action |
| P10 | Tap *Send feedback* under the sign-in screen, write a line and an address to answer, *Send*; sign in and send one from Mission Control; *Hand over to kids* and look for the button on the launch pad, the PIN screen, the child's home, a game, the shop, the map and a summary; from the child's home tap *Parent sign-in*; reload the tablet, and again once the launch pad's 12 hours are over; then sign in as the parent on the tablet | each note is thanked once; `node scripts/report.mjs feedback --days 1` lists both with their screen (`sign-in`, then Mission Control's) and release, the first with the address, the second with the parent and the family; with `FEEDBACK_TO` and Resend each also reaches the owner's inbox (at most 20 copies a day, 5 of them for notes sent signed out) and Reply goes to the parent or to the address given; no *Send feedback* anywhere in kid mode, nor on the tablet's sign-in screen after a reload or an expired launch pad, until the parent has signed in on it |

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

## Email (email-v1)

With `EMAIL_PROVIDER=fake` nothing is sent: read each email in Firestore → `outbox` (kept 14 days), or run
`node scripts/report.mjs preview FAMILY_UUID` (the HTML, links inert). With Resend and no verified domain, only the Resend
account owner's own address receives mail (`DEPLOY_V3.md` → Email).

| # | Do | Expect |
|---|---|---|
| E1 | Sign up a new parent: press *Create parent account* with the first box unticked, then ticked, leaving the news box as it is | refused with a note until the first box is ticked; the news box starts unticked; afterwards Mission Control's *Email updates* shows the weekly report on and news off |
| E2 | In Mission Control untick *Weekly progress report* and save; after 5 minutes idle tick it again and save | saved at once after a recent sign-in; after 5 minutes a fresh password + SMS check comes first, then the app asks to set the switches again — nothing is saved by itself |
| E3 | Let the children play at least 20 questions in a week; open the inbox after Monday 07:00 Singapore (or run the job: Cloud Run → Jobs → `automathtics-v3-report` → Execute) | one email per family: the subject names the children, the missions and the % right; per child the three lists (✅ right and fast, 🐢 right but slow, ⚠️ wrong again and again), the pace line, the System Scan line; the game's colours; readable on the phone; no raw ids |
| E4 | Tap *Set Allison's pace to 75%* in the email | the app opens on a panel saying exactly what changes (and the pace now); Cancel changes nothing; Confirm changes it (Game & progress shows it); the same button again is harmless |
| E5 | Tap *Focus Geralt's System Scan on these*, confirm; then start Geralt's next System Scan | Game & progress shows the scan focus on; the scan has 25 questions, most of them the styles the email named; unlock, the 25/25 rule and the double pay unchanged; *Switch Geralt's scan focus off* reverses it |
| E6 | Use the mail app's own *Unsubscribe* beside the sender (Gmail, Apple Mail); on another account tap *Stop weekly reports* in the footer | the one-click unsubscribe turns the report off without opening anything; the footer link opens the app's panel and turns it off on Confirm; Mission Control shows it off; no report next Monday |
| E7 | A week with the weekly report switched off; a week in which no child answered a question | no email; the job's log says `progress_off` or `no_play` |
| E8 | Before Monday, change the parent's sign-in email to one not yet verified (or disable the account in the console) | no email, the log says `no_verified_address`; nothing goes to an unverified address |
| E9 | In Mission Control tick *Send it monthly instead* and save; run the job for a week that is not a month's first Monday, then for one that is (`--week 2026-W36`) | the first run skips the family with `monthly_not_due` and sends nothing; the second sends one email headed *MONTHLY REPORT · Your family's four weeks*, covering four weeks of play, with *Stop monthly reports* in the footer and the same buttons as a weekly one |
| E10 | Tap the footer's *Stop weekly reports* in an email on a weekly account | the panel offers *Send it monthly instead* first and *No, stop the report* second; monthly sets the cadence and keeps the report, and Mission Control agrees. The mail app's own one-click unsubscribe still turns it off outright |

## Leaving (cancel or pause)

| # | Do | Expect |
|---|---|---|
| L1 | In Mission Control tap *Cancel or pause* on a subscribed family | the page names what will and will not change (the children keep everything; the plan and the date it is paid to), seven reasons and an optional box of up to 500 characters; *Continue* without a reason is refused and sends nothing; *Back* records nothing |
| L2 | Choose *It costs too much* on the Big family plan with one child seated, then *Switch to the smaller Family plan at renewal* | both the smaller plan and *Fewer seats at renewal* are offered; the choice is scheduled for the next renewal, nobody loses a seat before then, and `scripts/support.mjs family` shows the leaving record with the reason, the offers shown and the one taken |
| L3 | Choose *We are taking a break* and *Pause for 2 months* | the grid stays open to the end of the period already paid for, then closes; Mission Control says when collection starts again and offers *Start my subscription again now*; in Stripe the subscription carries `pause_collection` with behaviour `void` and that resume date, and **no invoice is raised** while it lasts; `reconcile-provider` matches |
| L4 | On the paused family, wait past the period end (or set a near resume date on staging), then look at the grid and at `scripts/support.mjs sweep` | the children cannot enter (the subscription is inactive) while every profile and all progress is kept; the sweep counts the family as paused and raises no finding; nothing anywhere calls it cancelled or expired |
| L5 | *Start my subscription again now*, then pay the next invoice in Stripe's test mode | the pause clears at Stripe and in the app at once; the paid invoice makes the family active again, and the amount is one month's, never two |
| L6 | Choose *Technical problems* | nothing can be cancelled on that screen: the feedback panel opens with the reason already typed in, *Send* files it (`report.mjs feedback --days 1` shows it), and only *I still want to cancel* brings the cancel button back |
| L7 | Choose any reason and *Cancel my subscription* | a confirmation screen first — one tap on the button sends nothing — with *Back* before *Yes*; after *Yes* the flag moves at Stripe, access runs to the period end, and *Keep my subscription* is offered again |
| L8 | Go through the flow twice in the same week | the second time no alternative is offered ("We offered you alternatives not long ago"): at most one set per family per 90 days, and the record says none was shown |
| L9 | After a month with at least one of the above, run `--args scripts/report.mjs,leaving,--month,YYYY-MM` | one plain email to the owner with the volumes and their shares, the reasons ranked, offers shown against taken, the plan, seat and cohort mixes and the three-month trend; running it again sends nothing (`already`); a month with nothing in it sends nothing at all |

## Failure states

| # | Do | Expect |
|---|---|---|
| F1 | Airplane mode mid-action | a clear message, no half-applied state after reconnecting; a retried click is not a second purchase (operation ids) |
| F2 | Expired session mid-form | the sign-in screen, then the form again; nothing submitted twice |
| F3 | Wrong origin (open the API host directly) | the API refuses browser calls without the app's origin |
| F4 | Old bookmark to the v2 game | v2 still works and is unaffected (PR #1 is draft) |

## A new version

| # | Do | Expect |
|---|---|---|
| U1 | Keep a tab open on the phone (Mission Control) and on the kids' tablet (a child's home), then deploy any change (block C). Switch back to each tab, or leave it in view for up to five minutes | the bar *A new version of AutoMathtics is ready.* with *Update now*; nothing reloads by itself; tapping it loads the new version (`/api/health` shows the new `release`) and the bar is gone. Tabs opened before the first release that contains this checker cannot know of it: they need one manual reload. While the deploy switches traffic an answer may still come from the other revision, so a tab may show the bar once too often (tapping it reloads what is already the new version) or once too late (the next check shows it) |
| U2 | On the kids' tablet start a paper, deploy a change while it runs, and answer on | no bar while the questions run; it appears on the summary or the child's home once the paper ends or is left, and nothing of the paper is lost |

Sign-off: date, devices, rows failed, tickets opened. The pilot (`PILOT.md`) starts only with every
row green on every device.
