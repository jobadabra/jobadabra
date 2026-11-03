---
area: release
paths: [RELEASE.md, tools/beta-release.sh, tools/release-stable.sh, tools/beta-approve.sh, tools/canary_promote.py, tools/release_guard.py, tools/prune-releases.sh, tools/webstore-publish.mjs, .github/workflows/desktop.yml, .github/workflows/build.yml, .github/workflows/canary-promote.yml, .github/workflows/stable-canary.yml, .github/workflows/release-guard.yml, .github/workflows/extension-store-publish.yml, .github/workflows/msix-store.yml]
updated: 2026-11-03
---
# Releases
> A build is made when the app changed, every gate suite runs on it, and a green one is approved for beta testers; stable is promoted on purpose. Friends' apps follow the latest stable, and their Always on runs follow the app's own release.

## Rules
- Nightly at 04:00 Zurich, if the app changed, a build is made and the gate runs on it; red or no build changes nothing. A build on demand (`gh workflow run desktop.yml`) is only a pre-release to try. Timers come from the Worker's scheduler, not GitHub cron.
- A beta by hand is `tools/beta-release.sh`. No beta starts while main's e2e is red; the fix of the latest red beta starts first.
- Only proven steps block a beta. A red on code unchanged since its last green is called flaky, opens an issue and does not hold the beta.
- No AI calls and no AI review in the beta pipeline: the screenshot review runs separately, nightly, report only.
- While a beta is red, no move or rename PR merges (folders, env vars, domains, repos). A workflow change shipped during a beta puts `CI-budget: <why>` in its commit, because runner queues alone push it over the 10-minute budget.
- Stable is promoted by hand: Actions "Release · Promote to stable", or `tools/release-stable.sh`. Release files are named `Jobadabra-*` only.
- A stable build also tells the reporters whose fix it carries (`tools/feedback-released.mjs`). A bad release has a rollback path in RELEASE.md section 5.
- Large optional parts (LibreOffice, transcription, Chromium) download on first use with progress and Cancel, never in the installer.
- Tests, the pool, the twin and our sessions never submit an application, in any build.

## Key files
- `.github/workflows/desktop.yml`: the one run per release (Build, E2E, Release, per platform lane); `e2e.yml` the gate suites; `canary-promote.yml`, `stable-canary.yml`, `release-guard.yml`.
- `tools/beta-release.sh`, `beta-approve.sh`, `release-stable.sh`, `canary_promote.py`, `release_guard.py`, `prune-releases.sh`.
- Stores: `extension-store-publish.yml`, `tools/webstore-publish.mjs` (Chrome Web Store), `msix-store.yml` (Windows).
- More: `node desktop/scripts/codemap.mjs release beta canary`.

## Live specs
- [E2E reliability design](../superpowers/specs/2026-10-28-e2e-reliability-design.md): the repair rules, the predictable beta and its night burn-in.
- [Fresh install smoke](../superpowers/specs/2026-11-01-fresh-install-smoke-design.md) and [upgrade data test](../superpowers/specs/2026-11-01-upgrade-data-test-design.md).
- [Desktop and extension only](../superpowers/specs/2026-11-01-desktop-extension-only.md): servers belong in the web or lab repos.

## Ask the sources
ask: github releases limit=5
ask: github runs workflow=desktop status=failure
ask: github issues label=red-main state=open
ask: sentry issues is:unresolved release=latest

## Lessons
- Our own moves cause reds: three betas in a row failed from our own folder moves and a doc edit that changed an AI request, not from product code.
- Weigh a release gate by the bugs it caught against its runner minutes; one catch in hundreds of PRs is low value.
- A beta that fails on untouched steps is a predictability problem: burn in every step at night, spread over different hours, before letting it block.
- Count failures per area at each round-up; a third fix in a week on the same files is a design problem.

## Go deeper
[RELEASE.md](../../RELEASE.md) · [CONTRIBUTING.md](../../CONTRIBUTING.md) · [e2e reliability rules](../superpowers/specs/2026-10-28-e2e-reliability-design.md) · [CI hub](ci.md)
