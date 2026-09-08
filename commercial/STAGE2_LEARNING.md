# Stage 2 — the learning engine behind the child session

Branch: `feature/v3-learning-engine`, from `release/v3.0` @ `51696db` (Stage 1 + 1b).

## The vertical slice

```
child session → POST /api/learn/session → server-generated questions (answers stay server-side)
             → POST /api/learn/answer  → strict grading, per-question clock, idempotent by attempt id
             → progress, coins and history written in the same transaction as the final answer
```

Every call runs inside one transaction that re-reads authorization through `Foundation.authorize`
for the child role (active child, entitled family, current PIN version — Stage 1b F2). A parent
or selector cookie, a revoked child, or a lapsed family gets nothing.

### Routes (child role only)

| Route | Body | Returns |
|---|---|---|
| `GET /api/learn/state` | — | both tracks (sector, paper, crowns, what's next), wallet, stats, last 20 history rows, the open session if any |
| `POST /api/learn/session` | `{ track: 'engine' \| 'nav' }` | the session and its first question; resumes an open session (any track) for two hours |
| `POST /api/learn/answer` | `{ sessionId, index, attemptId, answer }` | `result`, `correct`, `expected`, then the next question or `done` + `summary` |
| `POST /api/learn/quit` | `{ sessionId }` | closes the session and records a quit row |

### Rules, as in v2

- Six sectors A–F, 100 papers each, five-paper sessions: 25 Engine questions or 15 Navigator.
- A session passes only with every question right. Pass → next five papers, ⚡50 🏆100.
- A 👑 check point is due at paper 21, 41, 61, 81 and 101 (25 / 15 questions from that tier); pass → a crown, ×2 loot.
- A sector is done at paper 100 with five crowns; the track then runs practice sessions (which still pay) until the other track finishes the sector, then both jump.
- Streak bonus: every block of three consecutive pass-days (family time zone, default `Asia/Singapore`, stored on the family) pays ⚡50 🏆100 once.
- The per-question clock is the v2 one (sector base + 5 s per tier for Engine; 50 s + 5 s per sector and tier for Navigator). An answer that arrives after it, plus five seconds of grace, is a timeout.

### Grading is strict

`server/progress.mjs` → `grade()`. Integers must match `^-?\d{1,7}$`, decimals `^-?\d{1,6}(\.\d{1,2})?$`
and compare at two places, fractions are `{ n, d }` digit strings compared in reduced form, choices are
an index string within range. Anything else is `400 INVALID_ANSWER` and does not consume the question.
The v2 `parseInt`/`parseFloat` path is not reproduced.

### Idempotency and ordering

- `attemptId` (UUID from the browser, one per question shown) — a retried request returns the stored
  response and counts once; a different `attemptId` for a question already answered is `409 STALE_QUESTION`.
- Only one open session per child (`learning/{child}.activeSession`); a session older than two hours is
  retired on the next start; answering it is `409 SESSION_EXPIRED`.
- The final answer, the history row, the paper/crown, the coins, the streak bonus and any sector jump
  are one write set in one transaction.

### Data

```
families/{familyId}/learning/{childId}                 — engine, nav, wallet {gc, rp, bonuses}, passDays, stats, history[≤60], activeSession
families/{familyId}/learning/{childId}/sessions/{id}   — questions[] with answers, results[], index, askedAt, status, lastAttempt, expireAt (24 h)
```

The browser receives `display`, `answerType`, `seconds`, `paper`, `tier` and `read` per question — never `answer`.

## F4 / F11 from the Stage 1 review, done here

- `expireAt` (a real Firestore `Timestamp`, converted at the store boundary) on `sessions`,
  `rateLimits`, `pinAttempts`, `operations` (24 h), `audit` (400 days) and learning `sessions` (24 h).
  TTL policies are created once per collection group with `gcloud` — see `DEPLOY_V3.md` §4b.
- The child-creation replay fingerprint no longer commits to the PIN; it covers nickname and icon
  only (the browser mints a new request id whenever any field changes).

## Not in this slice

Shop, pets, outfits, reward store and redemptions, family rocket, weekly System Scan, admin
adjustments, the map and heatmap views, read-aloud for Navigator, and migration of v2 histories.
Each is a later slice on the same session/transaction pattern.
