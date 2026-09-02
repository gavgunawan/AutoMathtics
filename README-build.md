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
