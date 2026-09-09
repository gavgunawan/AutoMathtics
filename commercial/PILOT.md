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
2. **Export again from v2** the same way as the dry-run files (the v2 database records for each child and
   the family settings), and check the `lastScanWeek` and the last history row are the ones just played.
   These files are the archive (decision 5): keep them.
3. **Create the family in v3** on staging; grant two seats (`npm run grant:cloud -- FAMILY 2 <expiry> 'pilot'`).
4. **Add the children with the *start from A1* option** — it writes no progress document, which the
   importer requires (it refuses a child who already has any). Age and year level as they are today.
5. **Dry-run the import for each child** against the fresh export and read the summary:
   ```bash
   npm run migrate:cloud -- FAMILY_UUID CHILD_UUID path/allison.json "pilot cutover"
   ```
6. **Write** with `CONFIRM_MIGRATION=write` in front of the same command, once per child. Each writes the
   learning document, the ledger opening row (`migrate-opening`) and an audit row.
7. **Verify**: the parent workspace shows the sectors, crowns, balances and equipped items from the table;
   `node scripts/support.mjs family FAMILY_UUID` shows both ledgers `match: true`.
8. **Re-enter** the reward and the rocket (decisions 1–2).
9. **Hand over** on each device; the children play their first v3 paper the same day.
10. **Freeze v2 for the family**: remove the v2 bookmark from the children's devices and change the v2 admin
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
