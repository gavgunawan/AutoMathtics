# /pa-naurah — the PA checklist as a website

Served at **automathtics.net/pa-naurah** by the same Pages workflow that publishes the game.
`index.html` is a complete standalone document: no build step, no framework, Firebase loaded as
ES modules from gstatic.

It exists because the claude.ai version needs every user to hold a seat in the owner's Claude
organisation. This one needs a PIN.

## The PIN is a credential, not a string in the page

Searching this file for `230867` finds nothing. What the keypad types becomes the password for the
Firebase account `pa-naurah@automathtics.app`; a wrong PIN gets no token, so it gets no data —
not a hidden screen, nothing at all. Firebase throttles repeated failures. Changing the PIN is a
password change in the console, not a deploy.

See `firebase-rules.md` for the four console steps this depends on. Until they are done the gate
rejects every PIN, including the right one.

## What it stores

Realtime Database under `pa/naurah`:

```
days/<YYYY-MM-DD>/dayKey
                 /items/<task>-<target>/{done, at, note, noanswer,
                                         proofs/<id>/{url, sha, ph, w, h, fmod, at, flags[]},
                                         auto/{status, detail}}
hashes/<YYYY-MM>/<sha-24>/{p, d, i, t}
```

Screenshots go to Storage at `pa/naurah/<day>/<row>/<id>.jpg`, downsized to 1600px / JPEG q0.8
before upload. The hash index is append-only and outlives the images, so deleting an old
screenshot never makes it reusable.

## What it checks by itself

Byte-identical re-upload is refused outright. A 64-bit dHash flags a re-cropped or re-saved
screenshot from another day. The file's own modified date and the deadline are recorded on every
tick. The day rolls at midnight WIB and there is no way back — the page only ever renders today.

It does **not** reach Google Drive or Claude: a static page holds no credentials for either. The
three sheet-backed cards (voucher, DRR, compset) are therefore not hers to tick. They render in
their own section, excluded from her daily count, showing whatever the morning report last wrote
to `items[...].auto`. Her 24 rows are the ones a screenshot can actually settle.

## The game layer

A meter across the header fills as rows complete. Each tick plays a ka-ching built from
oscillators (no audio files — same `tone()` approach the game uses) and throws coins from the
checkbox. A clean day fires a jackpot arpeggio and a full-screen burst.

The streak counts consecutive days at 24/24 and, following the game's own convention, stays hidden
until it reaches 3. Fourteen consecutive perfect days is the Rp 2.000.000 bonus, tracked as
fourteen segments under the counter. One missed day puts it back to zero.

## Deploying

The workflow triggers on pushes to `main` touching `index.html`, `pa-naurah/index.html` or the
workflow itself, and stages only those two files. Nothing else in the repository is ever served.
