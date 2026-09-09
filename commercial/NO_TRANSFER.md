# Nothing moves between families — and how free trials will stay one-per-phone

Owner's rule (9 Sep 2026): there must be no way, in the security model or in the game, to move a
child or their progress to another account. Otherwise a parent could open a fresh free-trial account
every week and the same child would keep progressing for nothing.

## The invariant, as built

1. **A child belongs to exactly one family, by path.** Children, credentials, PIN attempts, learning
   progress and sessions all live under `families/{familyId}/…`, and every server call derives
   `familyId` from the caller's session, never from the request. A child id from another family is
   simply not found. Tested in `tests/transfer.test.mjs` and the cross-family tests in
   `learning.test.mjs` / `hardening.test.mjs`.
2. **There is no transfer, import, export, migrate, merge, link or invite route**, in any role.
   `tests/transfer.test.mjs` scans `http.mjs`'s route table for those words so one cannot be added
   quietly.
3. **Seats cannot reference a child outside the family.** `grantEntitlement` rejects a keep-list
   naming any child not in `family.childIds`.
4. **A parent who signs up again starts from nothing**: new family, new child ids, paper 1, empty
   wallet. Tested.
5. **Coins are per child, server-owned, and never gifted** (shop/rewards are a later slice; when
   the Family Rocket arrives it pools within one family only).
6. **The parent workspace shows progress but cannot set it.** No parent route writes papers, crowns
   or placement. A parent may credit coins to their own child (`/api/game/parent/adjust`: a logged,
   in-family bonus, at most 10,000 a call, refused for a child of another family) and approve or reject
   reward requests; nothing leaves the family. Operator adjustments are CLI-only like `grant.mjs`.
7. **The one exception is the one-off v2 import** (`scripts/migrate-v2.mjs` → `server/migrate.mjs`),
   used to bring the owner's own children over from the old game. It is CLI-only with the same
   project guards as the grant tool, takes the v2 record as a file (it never connects to the v2
   project), refuses a child who already has any progress (`ALREADY_HAS_PROGRESS`), never merges,
   writes an audit row, and is a dry run unless `CONFIRM_MIGRATION=write`. Tested in
   `tests/migrate.test.mjs`.

## The one thing a fresh account cannot fake: the verified phone

Every parent account requires SMS multi-factor on a real phone number. From this change:

- `FirebaseIdentity.verifyLogin` returns the phone behind the MFA factor.
- `login()` stores `phoneKey = HMAC(SESSION_SECRET, "phone:" + number)` on the parent record. The
  number itself is never written.
- `createFamily()` stamps the family with `phoneKey` and appends the family to `phones/{phoneKey}`
  (`families[]`, `count`, `firstAt`, `lastAt`).

So a parent using `dad@a.com`, then `dad@b.com`, then `dad@c.com` with the same phone produces one
`phoneKey` and a ledger listing three families. A future free-trial grant is one line:
*grant the trial only if `phones/{phoneKey}.count === 1`* (or only once per key, however the trial
is defined). Farming trials then costs a new SIM per trial, on top of the child restarting at paper 1.

Also worth keeping when trials are designed:
- refuse trials for accounts whose phone has no ledger entry (i.e. MFA somehow absent);
- keep `phones/*` for the retention period even when a family is deleted (no TTL on it);
- rate-limit family creation per `phoneKey` (not implemented; the ledger makes it a two-line change).

## What this does not stop

- A family sharing one paid account among several children beyond their seats — that is what
  seat limits are for.
- A parent with access to many real phone numbers. Each one costs them an SMS-verified line.
- Two different parents with the same number (a shared family phone) being treated as one for
  trial purposes — acceptable: they can still both have paid families.
