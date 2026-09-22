# Tugas Harian Naurah — daily PA checklist

Live page: <https://claude.ai/artifact/6aUymCDeQnr1tWHDpf8VrV>

`tugas-harian.html` is the source of that page. It is an **Artifact source file**: the
claude.ai publisher wraps it in `<!doctype html><html><head>…</head><body>`, which is why
the file starts at `<title>` with no document skeleton of its own. Opening the raw file in a
browser still renders it, but none of the runtime capabilities exist outside claude.ai, so it
falls back to the read-only "belum tersambung" state.

## What it does

One page, eleven duty cards sorted by their WIB deadline, **32 required pieces of proof a day**.
A box cannot be ticked until proof exists for it. The day rolls at **midnight Asia/Jakarta** and
earlier days become read-only — there is no way to fill in yesterday.

| WIB | Card | Rows |
|---|---|---|
| 09:00 | FO input voucher ke folder harian — checks **yesterday's** folder | 1 |
| 10:00 | Laporan owner DRR | 1 |
| 11:00 | Cek IG, TikTok & WA hotel | 3 |
| 13:00 | AR update semua hotel | 4 |
| 16:00 | Pesan OTA ter-respond ≤ 2 jam | 4 |
| 17:00 | Kunci Oak Tree (2× per week) | 1 |
| acak | Test call acak ke FO — 4 units, random time each | 4 |
| 20:30 | Video call Bu Endah — dapur bersih | 1 (+1 optional photo) |
| 21:00 | FO isi form compset — 6 slots at 01:00…21:00 | 6 |
| 21:00 | Bincard — Luxe bar, Luxe kitchen, Oak Tree | 3 |
| 22:00 | Upload log prices Bookandlink | 4 |

Two of these deadlines are interpretations worth knowing. **Compset at 21:00** is the card's
deadline — all six slots chased by 9pm; the individual slot times stay at 01:00/09:00/11:00/
14:00/17:00/21:00 because those are what the Google Form's own timestamps are measured against.
**Voucher at 09:00** must mean the previous day's folder, since today's vouchers do not exist at
9am; the rule that a file created after midnight is late is unchanged, just pointed one day back.

### Random test calls

`callTimes(dayKey)` gives each of the four units a time drawn from an FNV-1a hash of the date, so
every viewer sees the same times, a reload does not reroll them, and nobody can nudge them. Each
unit sits in a different band — 07:00–10:30, 10:30–14:30, 14:30–18:30, 18:30–22:00 — and which
unit lands in which band is shuffled daily, so FO cannot learn "we always get called in the
morning". The draw is written to `days/<date>.callplan` so the morning report can judge lateness.

**Tidak diangkat** on a row demands a *second* call-attempt proof before the tick opens, and sends
the row to the owner's queue whether or not it is eventually ticked.

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

Routine `trig_01CYzfsFJ3wb1B1Xv4JQsVZa` — "Laporan harian checklist Naurah", `0 0 * * *` UTC =
**07:00 WIB daily**, fresh session each fire. Reports on the previous WIB day.

Delivered to the owner by push notification and email, and emailed to **pa.versehotels@gmail.com**
without the CEK SENDIRI section (that list is the owner's) plus a line on what to chase first.

It reads the `days` document, re-verifies against Drive where it can, writes its findings to
`audit/<YYYY-MM-DD>` so there is a trail independent of anyone ticking anything, and reports under
four headings: TIDAK BERES, TELAT, BELUM ADA BUKTI, CEK SENDIRI.

**Routines created through the API cannot carry connector grants on this organization**, so the
fired session may have no Google Drive and no Gmail of its own. Two consequences: the Drive
re-verification is skipped (the page covers this — whenever it is open and Drive has already been
allowed for it, it re-runs the three checks on load and every 90 minutes and stores each verdict
in `items[...].auto`, which the report treats as authoritative), and Naurah's email will not send.
Attaching **Google Drive** and **Gmail** to the Routine in the claude.ai Routines UI fixes both.

## Giving the PA access

The page declares `db`, `assets` and `mcp`, which makes it **organization-internal** — it cannot
be shared by public link, and a signed-in visitor from outside the owner's claude.ai organization
only ever holds `view`, which cannot write. So the PA must be a member of the organization first;
sharing the URL alone is not enough.

Levels, in the Share menu's words:

| Level | Can tick | Can upload proof | Can accept/reject flags |
|---|---|---|---|
| Can view | no | no | no |
| Can interact | yes | no | no |
| **Can edit** | yes | **yes** | no |
| Owner | yes | yes | yes |

Asset upload sits with `admin`, which the Share menu calls **"Can edit"** — so that is the level
the PA needs, otherwise she can tick but not attach the screenshot that unlocks the tick. Signing
off flags in the review queue stays owner-only regardless (`user.isOwner()`), so "Can edit" does
not let her clear findings raised against her own uploads.

She should also connect **Google Drive** in her own claude.ai connector settings: the page's three
Drive checks run with the viewer's credentials, and they are what keeps the daily report's
verification alive. The Claude vision checks spend the *viewer's* Claude usage, roughly one quick
call per screenshot.
