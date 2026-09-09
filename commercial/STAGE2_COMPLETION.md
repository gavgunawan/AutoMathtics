# Stage 2 completion checkpoint

This file is a concise reviewer index for `hardening/stage2-completion`.

## Why this pass exists

The staff Stage 2 merge established the secure learning core. A follow-up audit found two remaining Stage 1b
login-abuse issues, several Stage 2 hardening/evidence gaps, and the fact that the broader v2 game/economy UI
had not yet been moved behind the v3 server boundary.

## Closed security findings

- S1B-A: duplicate/pre-rate-limit Firebase Auth backend lookup removed.
- S1B-B: a failed-login address bucket no longer denies a later valid signed login from the same NAT address.
- S2-A: durable 20/hour new-learning-session budget per child; resume is free.
- S2-B: canonical answer grammar tightened.
- S2-C: real-emulator concurrent-answer race added.

S2-D remains a manual acceptance item: real iPhone Safari / Android Chrome interaction cannot be proven by
the Node DOM harness or Firestore emulator.

## Game migration included

See `STAGE2_LEARNING.md` for the complete feature list and API surface. The important architectural change is
that v2 game state is no longer trusted from the browser: wallet, purchases, rewards, loot, Rocket contributions,
System Scan eligibility, pace and progress are all server-owned transaction state.

## Test evidence before push

The completed local deterministic suite on this branch is **140/140 passed, 0 failed, 0 skipped**. It includes
the original Stage 1/1b/2 checks plus game, migration and UI regressions. GitHub CI is the authoritative second
environment for the Firebase emulator concurrent-answer race and Docker build. Do not merge this branch to the
release line unless all required checks pass.

## Deliberately deferred to Stage 3+

- Payment gateway and subscription webhooks.
- Automated commercial entitlement lifecycle.
- Account export/deletion and self-service recovery.
- Production deployment/monitoring/privacy operations.
