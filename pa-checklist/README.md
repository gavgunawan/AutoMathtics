# Tugas Harian Naurah — daily PA checklist

Live page: <https://claude.ai/artifact/6aUymCDeQnr1tWHDpf8VrV>

`tugas-harian.html` is the source of that page. It is an **Artifact source file**: the
claude.ai publisher wraps it in `<!doctype html><html><head>…</head><body>`, which is why
the file starts at `<title>` with no document skeleton of its own. Opening the raw file in a
browser still renders it, but none of the runtime capabilities exist outside claude.ai, so it
falls back to the read-only "belum tersambung" state.

## What it does

One page, eleven duty cards ordered by their WIB deadline, 29 required pieces of proof a day.
A box cannot be ticked until proof exists for it. The day rolls at **midnight Asia/Jakarta**
and past days become read-only — there is no way to fill in yesterday.

## How proof is verified

| Layer | Blocks the tick? | What it does |
|---|---|---|
| Duplicate screenshot | **yes** | SHA-256 of the uploaded bytes is matched against every proof ever uploaded. A byte-identical re-upload is refused outright. |
| Near-duplicate | no, flags | 64-bit dHash perceptual fingerprint, Hamming distance ≤ 5 against any earlier day. Catches a re-cropped or re-saved screenshot. |
| Screenshot age | no, flags | `File.lastModified` compared to today (WIB). |
| Deadline | no, records | Tick time vs the card's WIB deadline; minutes late are stored and shown. |
| Claude vision | no, flags | The image goes to Claude with the task, the target and today's date. Returns a JSON verdict: right screen, right hotel/platform, what date is visible, what looks wrong. |
| Google Drive | **can satisfy the tick** | Three cards are checked against the real source instead of a screenshot — see below. |

The hash index (`hashes/YYYY-MM`) is append-only and outlives the images, so deleting an old
screenshot does not make it reusable.

## Hard checks wired to Google Drive

Run from the page via the viewer's own Google Drive connector (`mcp` capability), on a click:

| Card | Source | Verdict |
|---|---|---|
| FO form compset | sheet `FORM COMPSET OAKTREE (Responses)` | Per-slot: filled / missing / late by N minutes, from the form's own timestamps. 30-minute grace. |
| Laporan owner DRR | sheet `DRR 2026` | `modifiedTime` — was it touched today, and at what time. |
| FO input voucher | Drive `VERSE CIREBON / <MONTH YYYY> / <DD MONTH YYYY>` | File count plus each file's `createdTime`; anything created after midnight is reported as late. |

File and folder ids live in the `SRC` object near the top of the script. The voucher folder is
Verse Cirebon only — add the other three hotels by extending `SRC` and `checkVoucher`.

## Data layout (Artifact `db`)

```
days/YYYY-MM-DD   { dayKey, createdAt, items: { "<task>-<target>": {
                      done, at, by, byName, note,
                      proofs: [{ id, sha, ph, w, h, fmod, at, flags[], ai{} }],
                      auto:   { status, detail, at },
                      review: { st, by, at } } } }
hashes/YYYY-MM    { month, entries: { "<sha-24>": { p, d, i, t } } }
```

Proof images are Artifact assets, referenced as `/_blob/<id>`. Roughly 200 KB each after the
page downsizes them to 1600 px / JPEG q0.8; ~29 a day, so the asset store needs periodic
pruning of old days.

## Changing the checklist

Task titles, deadlines, targets, the AI prompt hint (`hint`), and the two columns of the
verification matrix (`sys` = what the system checks, `mine` = what the owner must check) are
all in the `TASKS` array. Edit, then republish the same file path to the URL above.

## Where the data lives

Nothing is written to Google Drive. The page only *reads* Drive.

- **Screenshots** → the Artifact's own asset store, served back at `/_blob/<id>`. They are not
  in Drive, not in the repo, and not in any chat.
- **Ticks, timestamps, Claude verdicts, Drive verdicts, flags, owner decisions** → the
  Artifact's `db` (see the layout above).

Both are scoped to this one artifact and readable only by accounts the artifact is shared
with. From a Claude session they are reachable with the `ArtifactData` tool against the
artifact URL — that is how the daily report reads them.

## Daily report

Routine `trig_01CYzfsFJ3wb1B1Xv4JQsVZa` — "Laporan harian checklist Naurah", `0 0 * * *`
UTC = **07:00 WIB daily**, fresh session each fire, delivered by push notification and email.
It reports on the previous WIB day.

It reads the `days` document, re-verifies against Drive where it can, writes its findings to
`audit/<YYYY-MM-DD>` so there is a trail independent of anyone ticking anything, and reports
under four headings: TIDAK BERES, TELAT, BELUM ADA BUKTI, CEK SENDIRI.

Routines created through the API cannot carry connector grants on this organization, so the
fired session may have no Google Drive access of its own. The page covers this: whenever it is
open and Drive has already been allowed for it, it re-runs the three Drive checks in the
background (on load, then every 90 minutes) and stores each verdict in `items[...].auto`. The
report treats those stored verdicts as authoritative. To make the report verify Drive itself
as well, attach the Google Drive connector to the Routine from the claude.ai Routines UI.
