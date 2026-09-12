# AutoMathtics v3.0 - private pilot

This is the account/security foundation, not the connected maths game.

- Read `commercial/DEPLOY_V3.md` for upload and live-pilot instructions.
- Code belongs on the `release/v3.0` branch of `gavgunawan/AutoMathtics`.
- Keep `.github/` and `commercial/` directly at repository root when extracting.
- Do not replace the old root `index.html` or use GitHub Pages for this Node server.
- Create a separate Firebase project; keep the existing children and game untouched.
- Generate/review the lockfile and pass emulator tests before deployment.
- No `.env`, runtime secret or service-account key belongs in GitHub.

The package manifest is 3.0.0, the page shows v3.0, and the API health endpoint
reports 3.0.0. See `commercial/REVIEW_STATUS.md` for actual test scope and limitations.
