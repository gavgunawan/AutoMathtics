# Stage 2 - secure learning engine and migrated game

Base entering this completion pass: `release/v3.0` at `dbc189f20e74231b978c1ca447cc4c5e58af0777`.
Working branch: `hardening/stage2-completion`.

**Status:** Stage 2 code-complete candidate. It is suitable for emulator/private-development
verification, not public-production certification. Stage 3 begins the commercial account/payment
lifecycle; staging, real mobile QA, production IAM/monitoring and final privacy controls remain later gates.

## Security boundary

The v2 browser-authoritative game was not copied as a trust model. v3 keeps this boundary:

```
authenticated child session
  -> server authorizes family / active child / entitlement / current PIN
  -> server owns learning session + hidden answers + clocks
  -> browser submits only route intent and answer values
  -> server grades and transactionally writes progress / rewards
  -> browser receives a safe projection
```

Firestore client rules remain deny-all. Browser requests never supply authoritative family identity,
child identity, expected answers, marks, paper completion, currency awards, shop prices or random loot.

## Learning routes

| Route | Role | Purpose |
|---|---|---|
| `GET /api/learn/state` | child | Tracks, wallet/progress summary, history, scan state and current session |
| `POST /api/learn/session` | child | Start/resume Engine, Navigator or a permitted System Scan |
| `POST /api/learn/answer` | child | Strict server grading + ordered/idempotent progress write |
| `POST /api/learn/quit` | child | Close the server session and retain a quit history row |

Rules migrated from v2:
- Six sectors A-F, 100 papers per sector, five-paper runs.
- Engine = 25 questions/run; Navigator = 15 questions/run.
- 100% is required to advance.
- Check points at 20-paper tiers; double loot and a crown.
- Both tracks must complete a sector before the sector jump.
- Practice remains available on a finished track while the other catches up.
- Every successful normal/practice run pays 50 Grid Coins and 100 Reward Points.
- Check points and weekly System Scan pay double.
- Every block of three consecutive family-local pass days adds one 50/100 streak bonus.
- Per-child pace is server-owned and clamped to 10-200%.

## Strict answers and replay protection

`server/progress.mjs` validates each answer type explicitly. Integer/decimal strings use canonical
spellings (no leading zeroes, negative zero, exponent form, whitespace or trailing junk); fractions
must be exactly `{ n, d }` with canonical digit strings; choice indexes must be canonical and in range.
Malformed input is `400 INVALID_ANSWER` and does not consume the question.

Each displayed question gets one browser-generated UUID `attemptId`. A network retry of that ID returns
the stored response. A different attempt against an already-advanced question is `409 STALE_QUESTION`.
The final answer, history row, paper/crown, wallet award, streak bonus and sector jump are one transaction.

New learning-session creation is durably limited to 20/hour per child. Resuming the already-open session
does not spend that budget. Learning sessions expire logically after two hours and carry a Firestore TTL
field for later physical cleanup.

## Migrated v2 game features

The following are now server-authoritative and available through the v3 child/parent UI:

- Full v2 Grid Shop catalog and inventory.
- Pets, outfits, rings, backgrounds, effects, sound packs, shout packs, timer skins, titles,
  name effects, map themes, vehicles and Command Deck cosmetic.
- Server-priced purchases and server-selected Surprise Box outcomes.
- Streak Shields (max two), including the v2 one-day continuity bridge.
- Mystery Egg purchase and server-selected hatch after five successful sessions.
- Earned Storm Dragon (five consecutive session passes) and Thunder Hawk (10-day streak).
- Reward Store configured by the parent, with per-child eligibility, optional daily caps,
  pending child requests, parent approval and rejection/refund.
- Family Rocket with parent-defined prize/currency/goal/minimum/crew, child fuel contributions,
  automatic launch when ready, and parent force-launch/scrap/claim controls.
- Weekly System Scan: 25 Engine questions, ten current-sector + fifteen earlier-sector questions,
  server shuffled, once per family week, double loot, no paper advancement.
- Parent manual Grid Coin / Reward Point adjustments with an idempotent audit ledger.
- Parent-visible Engine/Navigator progress, recent history and server-derived fluency heatmap.
- Navigator browser read-aloud using `speechSynthesis` when supported.
- Per-child pace control and family time zone.

All child game spending is based on balances held by the server. Prices, unlock conditions, reward costs,
rocket state and loot selection are not accepted from the browser.

## Game routes

Child role:
- `GET /api/game/state`
- `POST /api/game/shop/buy`
- `POST /api/game/shop/equip`
- `POST /api/game/rewards/redeem`
- `POST /api/game/rocket/fuel`

Parent role:
- `GET /api/game/parent`
- `POST /api/game/parent/rewards`
- `POST /api/game/parent/redemption`
- `POST /api/game/parent/rocket`
- `POST /api/game/parent/adjust`
- `POST /api/game/parent/settings`

Sensitive parent game writes require the same five-minute recent-authentication rule as other sensitive
parent operations. The browser reauth flow does not auto-submit the original mutation after reauthentication;
the parent explicitly repeats the action.

## v2 data migration

`server/v2-migration.mjs` maps a reviewed v2 JSON export into the v3 learning/game document model.
`scripts/import-v2.mjs` is an operator-only importer. It **never connects to the v2 Firebase project**.

Default execution is dry-run and does not load the Firebase SDK:

```sh
npm run import:v2 -- --file v2-export.json --family FAMILY_UUID
```

Only an explicit `--apply` writes to the configured v3 project. Existing target progress/config is refused
unless `--overwrite` is also explicit. Cloud use requires the same exact-project confirmation and operator
identity controls as other privileged scripts.

Bundle shape:

```json
{
  "children": {
    "OldChildName": {
      "childId": "V3_CHILD_UUID",
      "multiplier": 1.0,
      "progress": { "level": 0, "paper": 1, "nav": {}, "history": [], "wallet": {} }
    }
  },
  "settings": {},
  "rocket": null
}
```

The mapper converts v2 nested-array question logs into Firestore-safe objects, reconstructs earned currency
from trusted historical pass rows before applying historical spend, carries recognized inventory/equipment,
shields/egg/redemptions/System Scan state, maps reward/Rocket child names to v3 child UUIDs, and clears any
legacy in-flight session. Unknown inventory IDs and inconsistent accounting are reported rather than treated
as free currency.

## Stage 1b follow-up closed in this pass

- Login token signature/expiry is verified first without a duplicate revocation backend lookup.
- Once the signed UID is known, the per-account login limiter runs before the one fresh Auth user lookup.
- The fresh user record still enforces disabled status, verified/current email, current phone MFA and
  `tokensValidAfterTime` revocation.
- The failed-address budget no longer pre-blocks a subsequently valid signed login from the same office/NAT IP.
  Bad credentials from a saturated address remain rate-limited.

## Verification gates

Local deterministic suite must stay green. The GitHub workflow must then independently pass:
- `unit`
- real Firebase Auth + Firestore emulator integration
- `container-build`

The emulator suite includes a real Firestore two-answer race: two distinct attempt IDs target one current
question and exactly one may commit; the other must receive `STALE_QUESTION`.

## Still required before a real pilot/public launch

These are not unfinished Stage 2 game code:
- Human Safari/iPhone and Android/Chrome acceptance of the complete child game UI.
- Enable the documented Firestore TTL policies on the actual v3 project at staging time.
- Measure/confirm trusted proxy hops on the deployed origin.
- Production IAM/secrets/monitoring/abuse controls, backup/restore and privacy lifecycle work.
- Stage 3: payment gateway, subscription lifecycle, entitlement automation, account recovery,
  export/deletion and commercial admin operations.

The existing v2 application/project remains separate and must not be modified by this migration tooling.
