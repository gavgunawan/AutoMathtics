# AutoMathtics — source & build notes (v1.14, 2 Sep 2026)

The deployed page is `index.html` at the repo root — GitHub Pages serves that one file and nothing else.
It is **generated**; never hand-edit it. Everything lives in `src/`:

| file | what it is |
| --- | --- |
| `src/automathtics-src.jsx` | the whole app — React + Firebase, styles, all Stage 1 logic |
| `src/automathtics-entry.jsx` | the mount |
| `src/shell-head.html` | HTML shell up to the bundle `<script>`, **including the Firebase config** |
| `src/shell-tail.html` | closing tags |
| `build.mjs` | bundles `src/` with esbuild and writes `index.html` |
| `serve.mjs` | `node serve.mjs` → http://localhost:5173 to preview the built file |

## Build

    npm install
    npm run build      # -> index.html, ~527 KB

Node 20+. React and Firebase are pinned in `package.json` so a rebuild reproduces the same bundle;
bump them deliberately, not by accident. The Firebase config is the only thing you ever hand-edit,
and it lives in `src/shell-head.html`.

## Testing without touching the kids' live data

`index.html` talks to the real database. For UI work run the harness instead:

    node harness.mjs     # -> http://localhost:5174

It builds the same app with the Firebase config stripped and the PIN gate off, so it runs local-only
(the player-selection screen says so) and reads/writes nothing but `localStorage`. Seed a state from
the browser console with
`localStorage.setItem('kumon-progress:<name>', JSON.stringify({level, paper, bossCleared, history, wallet}))`
and reload. Note `loadProgress` still runs its migrations on whatever you seed — for level A it will
backfill the SEED_SYNC passes, so seed a later level if you want the numbers left alone.

## Two tracks per sector (v2.0)

Every level ("sector") has two tracks that both have to be through — paper 100 and five crowns —
before the jump to the next sector (`trackDone`, `jumpTo`):

| track | fields | a paper is | a session is | timer at sector A |
| --- | --- | --- | --- | --- |
| ⚙️ ENGINE — arithmetic drills | the original `paper` / `bossCleared` | 5 sums | 25 questions | 25 s per question |
| 🧭 NAVIGATOR — word & logic | `prog.nav = { paper, bossCleared }` | 3 word problems | 15 questions, under ten minutes | 50 s per question |

`trk(p, t)` / `withTrk(p, t, patch)` read and write a track; `bossDueT`, `trackDone` and the load-time
crown clamp are per track. History rows for Navigator carry `track: "nav"` (and a 🧭 prefix on
`papers`); `qlog` rows carry a 5th element `isNav` so the heatmap can be shown per track. Practice mode
(`mode: "practice"`, rows flagged `practice`) replays random papers of a finished track for normal
pay without moving progress. The weekly System Scan is Engine-only.

Navigator questions come from `src/navigator.js`: templates with randomised numbers, names and objects
per level (difficulty one MOE year above the letter: A ≈ P2 … F ≈ PSLE heuristics) plus a fact base for
the real-world comparisons. A question is `{ display: { layout: "word", text, choices? }, answer:
{ type: int|dec|choice, v }, read }` — `dec` adds a "." key, `choice` replaces the keypad with buttons,
and `read` is spoken aloud by the browser (`speak`, 🔊 in the status row). Fuzz the generators with
`node node_modules/.harness/navfuzz.mjs`-style checks before changing templates.

## Players

The built-in `USERS` (Allison, Geralt — photo avatars, a pace multiplier) plus anything in
`settings.players` (`{ name, age, emoji, color, mult, joined }`) make up the `roster`, which every
screen and the admin panel iterate. "➕ Add player" on the selection screen runs the wizard: name
(`validPlayerName` — 2–12 alphanumerics, not a reserved name, not taken), icon, colour → PIN twice →
`createPlayer` writes the roster entry to settings and a `newPlayerProgress` (paper 1, empty
history, PIN) to the player's own node, enters them, and shows the quick guide (`GUIDE_SLIDES`; also
"🎓 Guide" on the home screen). The name is the storage key exactly as for the built-ins, so time
scale (`<name>Scale`), log, restore, PIN reset, manual credit and redemptions all just work. Admin
"✕ remove" drops the roster entry only — the progress node stays, and adding the same name again
picks it back up. The admin Save writes `players` from live settings, never from the draft.

## Family Rocket

One shared goal at `kumon/rocket`: `{ id, status: fueling|launched|claimed, prize:{emoji,name}, goal,
minEach, crew:[names], fuel:{name:⚡}, createdOn, launchedOn, history }`. Dad defines it in the admin
panel (prize, goal, minimum per crew member, who's on the crew) and it appears on every crew member's
home screen as a gauge with ⚡50/100/250 fuel buttons. Every change is a `runTransaction`
(`updateRocket`), so two kids fuelling at once can't lose a contribution; `rocketReady` flips it to
`launched` inside the transaction the moment the tank is full and everyone on the crew has met the
minimum. A rocket has a `currency` (`gc` default, or `rp`); fuel buttons, symbols and the balance
check follow it. A kid's fuel is spending — `gcSpent` plus a purchase row, or for a 🏆 rocket
`rpSpent` plus an already-approved redemption row (the ledger the rp merge floor reads) — so balances and merges stay honest,
and it is never refunded (Scrap warns). Admin "Prize delivered" moves the launch into `history` and
frees the pad for the next one. Offline, the harness keeps the rocket in `localStorage`.

## Sync — nothing a device recorded can be erased by another

Every save is stamped (`savedAt`, `savedBy`) and every history row written since v1.17 carries `ts`.
`mergeProgress(a, b)` unions two snapshots of the same kid: history by row identity (`rowKey`), ordered
newest-first by `ts` with pre-stamp rows after; furthest `level`/`paper`/`bossCleared`; inventory,
purchases, redemptions and shield days unioned; spend never below the ledger; equipped looks from
whichever snapshot saved last. It runs in three places — `loadProgress` (cloud + local merged, never
picked), the `subscribeCloud` listener (incoming cloud value merged into current state, and the union
pushed back up if local knew more), and `cloudSave`, which is a `runTransaction` merging with whatever
is on the server at that instant. `sameProgress` compares ignoring the stamp, key order and the
nulls/empty arrays Firebase drops — it must, or the listener would ping-pong writes.

Known soft spot: a redemption Dad rejected (removed + refunded) can be re-added by a device that still
holds it; the admin panel just rejects it again.

## Session modes — the "Next session" rule

`beginSession` starts a **normal** session unless a check point is due (`bossDue`). Only `reallyStart`
— used by Restart and the how-to's start button — re-runs the current `sessionMode`, and `startRun`
hard-gates boss/scan regardless of who asked. Before v1.16, "Next session" went through `reallyStart`,
so after a cleared check point it launched another check point (a tier that wasn't due yet) and after
a weekly scan it launched scan after scan. Passing those phantom check points bumped `bossCleared`,
which the load-time clamp then reverted while voiding the pass row — the coins vanished with it.

## Shop

`SHOP_ITEMS` + `KIND_SLOT` define everything; `SHOP_SECTIONS` groups it for display. Item flags:
`big` (SUPER RARE card + blurb), `consumable` (crate/egg — never in inventory), `hatch` (egg pets,
hidden until owned), `unlock` (earned pets — locked card with live progress from `unlockProgress`),
`legend` (tag colour). `applyEarned(p)` hands over anything the record says has been earned and runs on
every pass and on every load; `LEGEND_SINCE` is the date the legendary pass-run chase starts counting
from (passes before it neither count nor break the run). A Surprise Box rolls one unowned cosmetic from
`CRATE_KINDS` (rare kinds at a third the weight) and auto-equips it. An egg records the pass count at
purchase and hatches `EGG_PASSES` passes later into a random unowned `HATCH_POOL` pet.

Looks are read on the home header, session status row, timer bar, combo shout, map (theme colours +
vehicle riding the lit tip), summary (vehicle launch, unlock/hatch banners) and the player-select cards
(read from `localStorage` since no progress is loaded yet there). The stale-build banner fetches the
live `index.html` with `cache: "no-store"` whenever the app comes to the front and offers a reload if
`BUILD_ID` (ASCII twin of `BUILD_TAG`) isn't in it — never mid-session.

## Streak ladder

One ladder, `STREAK_TIERS` (4 / 9 / 14 / 18 right in a row), drives everything that reacts to an
in-session streak: the combo shout and its colour, the pet's charge animation (`.petcharge-1…4`, each
bigger, brighter and faster) and the question sheet's glow (`.sheet-hot-1…4`). Change the thresholds
there and all three move together.

## Data

Firebase RTDB `families/gav-kmn-x7q94vb2nt38/kumon/{allison|geralt|testbot|settings}`.
Admin PIN 2026. Kid PINs default 8520.

Economy: pass ⚡50/🏆100, streak block +50/+100, CHECK POINT (every 20 papers, max T5, hard gate) and
weekly System Scan (Level B+, after papers 1–20 of current level) pay double. Coins derive from
history; `trimHistory` never evicts passes. One-time migrations in `loadProgress` (histRepair2,
streakFix1, sessionFix4, purchasesInit, bossCleared clamp) are idempotent.

`qlog` rows are `[tier, seconds, ok, qLevel]`. **`qLevel` matters**: a System Scan mixes in questions
from earlier levels, and the fluency heatmap must only count questions from the level it is showing.
Rows written before v1.14 have no 4th element — those are attributed to the session's level, except
on scan rows, which are dropped because they can't be attributed.

## Map

Each level's map traces the **letter of the level**. `LETTER_ROUTES` holds, per letter, a single
continuous `route` polyline (the 5 check points ride it, plus the exit at the end) and any `extra`
strokes that finish the glyph but carry no nodes — A's crossbar, E's and F's middle bar. Coordinates
are a 200×240 box. `at` optionally overrides where the check points sit when even spacing would bunch
two nodes on a corner (B and F use it). To retune a letter, edit the polyline and re-render.
