# Private pilot and the v2 → v3 cutover (Stage 4.5)

One family — the owner's — moves from the live v2 game (GitHub Pages + the `automathtics` Realtime
Database) to v3 on the staging project. The rule that matters: **after cutover no child progresses in
both**. v2 stays deployed and untouched (PR #1 is draft) as the rollback for the first weeks; it is not
the place the children play any more.

## Before cutover

- `ACCEPTANCE.md` green on every device the children actually use.
- The staging project up (`DEPLOY_V3.md`, needs the Blaze go), TTL policies applied, the operator identity
  granted, secrets in Secret Manager.
- Money: the pilot family runs on a **manual grant** (`npm run grant:cloud`) — zero money moves. Stripe test
  mode is exercised separately (`RECONCILIATION.md`), never against the pilot family.
- The consent version and the parent-facing words from `PRIVACY.md` reviewed by the owner (the pilot is
  the owner's own children, under the adult attestation; nicknames only, no other child data).

## The dry run (done, 9 Sep 2026)

The converter (`server/migrate.mjs`, `tests/migrate.test.mjs`) was run against both children's v2 records
exactly as exported from the v2 database. Nothing is written by a dry run; `scripts/migrate-v2.mjs` prints
the same summary and stops unless `CONFIRM_MIGRATION=write` is set.

*The table below is the 9 Sep dry run, kept as history.* Cutover day is checked against the step-5
summaries of that day's export (cutover step 8), not against these figures.

| | Allison | Geralt |
|---|---|---|
| Engine | Sector A complete (paper 101), 5 crowns | Sector B paper 21, 1 crown |
| Navigator | Sector A paper 81, 3 crowns | Sector A paper 86, 4 crowns |
| History rows | 61 in v2; the last 60 carried, **1 older row not carried**; 45 sessions, 43 passes, 4 streak bonuses | 71 in v2; the last 60 carried, **11 older rows not carried**; 56 sessions, 52 passes, 4 streak bonuses |
| Earned under v2's economy | 2,700 GC / 5,400 RP | 3,250 GC / 6,500 RP |
| Spent (v2 ledgers) | 1,600 GC / 5,100 RP | 600 GC / 6,500 RP |
| **Carried balance** (ledger opening row) | **1,100 GC / 300 RP** | **2,650 GC / 0 RP** |
| Inventory | 5 items, all recognised (space and symbols backgrounds, Storm Dragon, tiny crown, Combo Master title); crown, symbols, dragon and title equipped | 4 items, all recognised (symbols background, Storm Dragon, Math Ninja and Dragon Tamer titles); dragon, symbols and Dragon Tamer equipped |
| Purchases / redemptions | 6 / 15 approved rocket-fuel redemptions | 5 (one duplicate Storm Dragon row, harmless) / 22 approved |
| Shields | 1, three shield days | 0 |
| Mystery Egg | none pending | none pending |
| System Scan week | 2026-W36 | 2026-W36 |
| v2 PIN in the v3 document | no | no |
| Unrecognised inventory items dropped | none | none |

**Decisions the export cannot make** (the owner, before cutover):

1. **Reward Store**: v2's family settings hold one reward — *¥100 cash*, 100 RP, both children, no daily
   cap. Re-enter it in the v3 parent workspace (*Game & progress* → rewards) before the children play.
   **Decided (9 Sep 2026): re-enter it exactly as it is — ¥100 cash, 100 RP, both children, no daily cap;
   no policy change during the migration.**
2. **Rocket**: every redemption is *Rocket fuel · Bonus ¥5000 cash for reaching ¥10000*, but the v2
   export carries no rocket object — the fuel already accumulated is not in the data. The owner sets the
   rocket goal in v3 (*Game & progress* → Family Rocket) and decides the starting fuel from what v2 shows on the day.
   **Decided (9 Sep 2026): on cutover day, read the visible v2 Rocket fuel immediately before the final
   export and use that exact amount as the v3 opening fuel; if no authoritative number can be established,
   record a reset to 0 in the cutover record rather than an estimate.**

   *Implementation note (11 Sep 2026, operator tooling, not an owner decision).* The v3 parent route cannot
   open a rocket with fuel in it (a built rocket starts empty; fuel only arrives by charging a child), and the
   parent screen builds only ⚡ GC rockets with a 🎁 prize — so it cannot rebuild this RP rocket or its prize
   either (a known limit of the parent screen, not changed here). The family's v2 `rocket` node is therefore
   exported with the rest (11 Sep: RP, goal 20,000, minimum 10,000 each, Allison 6,700, Geralt 7,100 — 13,800
   in the tank) and carried by the operator tool's rocket form (`importRocket` in `server/migrate.mjs`,
   cutover step 7), per child, with the same prize, currency, goal and minimum. The "visible v2 Rocket fuel"
   of the decision is read from the screen and checked against that node (step 2). The import writes **no
   ledger row and changes no wallet**: each child's fuel is already in that child's v2 RP spending (every pour
   was a v2 `rocket` redemption) and the child import carries the balance as earned minus spent, so the fuel
   has already left the carried balances once. The importer enforces this rather than assuming it: for each
   child, the v2 `rpSpent` the child import recorded (the learning document's `legacy` block, never the live
   wallet) must **equal** that child's fuel plus the other spending the operator declares for that child —
   0 unless declared, one child at a time, as `other.NAME=POINTS` (cutover step 7). Otherwise it refuses with
   `V2_ROCKET_FUEL_SPENT_MISMATCH:<name>` and prints both numbers. What counts as "no authoritative number"
   is narrow. Only these lead to the decision's reset to 0, and then **only after the owner decides it**: the
   `rocket` node is missing from the export; the v2 screen and the node disagree; or, for the right file that
   parses, the importer raises `V2_ROCKET_INVALID:…` (the node is damaged or outside what a v3 rocket can be)
   or `V2_ROCKET_ALREADY_READY` (it should already have launched in v2). Three outcomes are neither a reset nor
   a fix. A v2 node with no rocket in progress (`V2_ROCKET_NONE`: the `{ id: 'none', status: 'claimed' }` shape a
   v2 scrap or claim leaves) means there is nothing to carry, and v3 starts without a rocket. A launched v2 rocket (`V2_ROCKET_INVALID:status`) is a prize the family owes: the owner settles it
   by hand, v3 starts without a rocket, and it is never a fuel reset. A deletion in progress
   (`FAMILY_DELETED`, `FAMILY_DELETION_PENDING`: the family is deleted, being deleted, or the parent has asked
   for it) means stop — nothing is imported into a family on its way out. Everything else is an operator
   mistake with a fix, and the dry run is repeated after it: the command line (`Usage`, or
   `INVALID_REQUEST` — a reason of 5 to 200 characters); the file (a malformed file that does not parse as
   JSON, or `V2_ROCKET_WRONG_FILE` — the node's wrapper, the whole export or a child's record was given
   instead of the `rocket` node: save the node on its own again from the same export); a mapping or
   declaration mistake (`V2_ROCKET_UNMAPPED_CREW`, `V2_ROCKET_MAPPING_WITHOUT_CREW`,
   `V2_ROCKET_CREW_MAP_DUPLICATE`, `V2_ROCKET_OTHER_SPENT_WITHOUT_CREW`, `V2_ROCKET_OTHER_SPENT_INVALID`), an
   unknown id (`INVALID_ID`, `CHILD_NOT_FOUND`, `FAMILY_NOT_FOUND`), an inactive child (`CHILD_INACTIVE`:
   restore the seat), a name mismatch (`V2_ROCKET_CREW_NAME_MISMATCH`: the ids are swapped; a nickname that
   is not the v2 name cannot be fixed, see step 4), a child not imported yet (`V2_ROCKET_CHILD_NOT_IMPORTED`:
   steps 5–6 first), and `ROCKET_EXISTS` — the parent first scraps the rocket they built (or, if it has
   launched, clears it with *Prize delivered*), then the import runs. `V2_ROCKET_FUEL_SPENT_MISMATCH` is none
   of these: stop, the owner decides what the difference is before anything is written, and only spending
   the owner confirms is declared. `V2_ROCKET_ALREADY_IMPORTED` means this family's v2 rocket was already
   carried (the tool prints that import's `rocketId` and time); there is nothing to redo — go to step 8.
3. **Mystery Egg**: nothing to refund — neither child has one pending.
4. **Font scale and sound** (60 / 90, sound on) are device settings in v2; v3 has its own.
5. **History beyond the last 60 rows.** The importer carries at most 60 history rows per child
   (`HISTORY_MAX`), so 12 older session rows in total (Allison 1, Geralt 11) are not part of the
   children's active v3 progress. Balances, sectors and crowns are unaffected — those come from the
   whole record. **Decided (9 Sep 2026): the 60-row limit stands** — the older rows change no balance,
   sector, crown or placement. Keep the final raw v2 export files as the historical archive: store them
   with the cutover record, outside the app, and do not delete them.

## Cutover, in order

1. **Announce the stop.** Pick the day; the children finish their v2 session; nobody plays v2 after it.
2. **Export again from v2** the same way as the dry-run files (the v2 database records for each child,
   the family settings and the family's `rocket` node, saved as its own `rocket.json`), and check the
   `lastScanWeek` and the last history row are the ones just played. Read the visible v2 Rocket immediately
   before this export and check `rocket.json` shows the same fuel per child (decision 2).
   These files are the archive (decision 5): keep them.
3. **Create the family in v3** on staging; grant two seats (`npm run grant:cloud -- FAMILY 2 <expiry> 'pilot'`).
4. **Add the children with the *start from A1* option** — it writes no progress document, which the
   importer requires (it refuses a child who already has any). Age and year level as they are today. Each
   child's nickname **must be their v2 name: Allison, Geralt** (case and surrounding spaces do not matter).
   It cannot be changed later — v3 has no rename route — and the rocket import (step 7) matches each v2 crew
   name to the nickname; a child added under another name has to be removed and added again before step 5.
5. **Dry-run the import for each child** against the fresh export and read the summary:
   ```bash
   npm run migrate:cloud -- FAMILY_UUID CHILD_UUID path/allison.json "pilot cutover"
   ```
   Each summary must show `pendingRedemptions: 0`. If a child's is not 0, stop: the owner decides those
   requests in v2 (approve or reject), then the export (step 2) is repeated and this step with it. Note each
   child's `rpSpent`; step 7 checks it against their rocket fuel.
6. **Write** with `CONFIRM_MIGRATION=write` in front of the same command, once per child. Each writes the
   learning document, the ledger opening row (`migrate-opening`) and an audit row.
7. **Import the rocket**, right after both children — and before anyone presses *Build rocket* in the parent
   workspace, because the importer refuses a family that already has a rocket (`ROCKET_EXISTS`). Run the tool
   from a checkout where this change is merged, after `npm ci` there; an older checkout has no rocket form or
   an importer without the checks below. Map every v2 crew name to the child it became; the map must cover
   the crew exactly. Dry-run first:
   ```bash
   npm run migrate:cloud -- rocket FAMILY_UUID path/rocket.json allison=ALLISON_CHILD_UUID geralt=GERALT_CHILD_UUID "pilot cutover"
   ```
   Read the preview: the prize, `rp`, goal 20,000, minimum 10,000, `v2HistoryCount` 0, and each child's
   `fuel` equal to the screen read at step 2 **and** equal to that child's `rpSpent` in their step-5 summary
   (6,700 and 7,100 on the 11 Sep export, with `otherSpent` 0). **The write enforces that equality**: for each
   child, v2 `rpSpent` = fuel + other spending, where other spending is 0 unless declared for that child on
   the command line as `other.NAME=POINTS` (for example `other.geralt=300`: Geralt's total v2 RP spending
   that is not this rocket's fuel). Declare nothing unless the owner has confirmed what that spending was; a
   history in the node (the tool prints a WARNING) means earlier rockets are inside the spent figures and
   their fuel has to be declared this way. If the two numbers differ, the write refuses
   (`V2_ROCKET_FUEL_SPENT_MISMATCH:<name>`, printing both) and nothing is written: stop, the owner decides.
   The dry run reads only the file and says so; the write also checks, inside one transaction and before
   writing anything, that the family is not being deleted, that each crew name is the v3 child's nickname
   lower-cased (swapped ids are refused, `V2_ROCKET_CREW_NAME_MISMATCH`), that each child was imported from
   v2 (`V2_ROCKET_CHILD_NOT_IMPORTED`), and that this family has never had its v2 rocket imported (a one-shot
   marker in the game config, `V2_ROCKET_ALREADY_IMPORTED`). Those checks back up the reading of the preview;
   they do not replace it.
   Then write by putting `CONFIRM_MIGRATION=rocket` in front of the same command, once:
   ```bash
   CONFIRM_MIGRATION=rocket npm run migrate:cloud -- rocket FAMILY_UUID path/rocket.json allison=ALLISON_CHILD_UUID geralt=GERALT_CHILD_UUID "pilot cutover"
   ```
   The rocket form has its own token: `CONFIRM_MIGRATION=write` (the child form's) gives a rocket **dry run**
   and says so. Set the variable only as this one-shot prefix — never with `export` or `$env:` (run the step
   in Git Bash on Windows), so it cannot outlive the one command. The write stores the family's game config
   (the rocket and the marker) and one audit row (`rocket.migrated`: ids and numbers only — each child's id,
   fuel, spending and declared other spending); no ledger row and no wallet change (decision 2). The written
   line shows each crew name, fuel and spending next to the v3 nickname it landed on. If the write was
   interrupted (the connection dropped, the terminal closed), run the same write command once more: if it answers
   `V2_ROCKET_ALREADY_IMPORTED` (it prints the imported rocket's id and time), the rocket is in: go to step 8 and
   do not retry again; if it writes, the first attempt had not committed. `alreadyWritten: true` appears only
   inside a single run, when Firestore itself retried a commit whose reply was lost, and also means the rocket is in. A rocket scrapped in v3
   after the import is final — its fuel is not refunded and the v2 rocket can never be imported again (the
   marker outlives it). Any other refusal: see the implementation note under decision 2 for which ones are
   fixed and dry-run again.
8. **Verify**: the parent workspace shows the sectors, crowns, balances and equipped items of the step-5
   summaries of the cutover-day export (not the 9 Sep table above, which is history), and the Family Rocket
   at the fuel read at step 2 — 13,800 of 20,000 on the 11 Sep export — still fuelling; each child sees their
   own fuel on the rocket card; `node scripts/support.mjs family FAMILY_UUID` shows both ledgers `match: true`.
9. **Re-enter** the reward (decision 1).
10. **Hand over** on each device; the children play their first v3 paper the same day.
11. **Freeze v2 for the family**: remove the v2 bookmark from the children's devices and change the v2 admin
    PIN; v2 stays deployed and untouched as the fallback.

## Rollback

Within the first two weeks: the children go back to v2 (their v2 data is exactly as exported; nothing
here writes to v2). Progress made in v3 since the cutover is left behind — accept that or re-export it by
hand from the v3 family export. The v3 family is deleted through the normal path only if the pilot is
abandoned for good.

## The pilot runs until

- fourteen consecutive days of use with no operator action other than the scheduled checks
  (`RECONCILIATION.md`), no `attention` items in the family report, and no ticket from the family;
- both ledgers still `match: true`; the export (D1 in `ACCEPTANCE.md`) opens and is complete;
- the owner writes the cutover date, the two summaries above and the sign-off into `STAGE4_PLAN.md`.

Only then does the question of replacing v2 for everyone (PR #1) come up — and it is a separate decision.
