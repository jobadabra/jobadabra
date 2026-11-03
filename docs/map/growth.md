---
area: growth
paths: [docs/analytics.md, docs/gtm-journeys.json, desktop/lib/analytics.js, desktop/lib/sentry.js, tools/coverage-report.mjs, .github/workflows/coverage-report.yml, .github/workflows/extension-store-publish.yml]
updated: 2026-11-03
---
# Growth: measuring use, journey readiness, store listings
> What the public repo can say about growth is thin and mostly measurement: which product steps are counted (without personal data), which user journeys are ready, and how the extension and installers reach their stores. Strategy and campaigns are not in this repo.

## Rules
- Crashes go to Sentry and steps to PostHog, only from an installed build with Technical reports on. The app builds each event itself, so only the listed fields leave the computer: event name from a fixed list (`EVENTS` in `desktop/lib/analytics.js`), flags, numbers, short words, a random install id.
- Never sent: text a person wrote, screen content, recordings, keystrokes, autocapture, CV, answers, mail, jobs, companies, paths. A new event needs a place in `EVENTS` and the doc table in `docs/analytics.md`, or `track()` drops it.
- A user journey is "ready" by proof, not by opinion: `docs/gtm-journeys.json` lists the journeys and the suites that prove each; `tools/coverage-report.mjs` decides nightly which are Tier 1 e2e, integration or report only.
- Every insight shown to a person has a one-click action; one with no action is folded into the feature or dropped.
- Early adopters are served on Free AI with caps; every mention of AI credit says what it buys.
- Store listings (Chrome Web Store, the Windows store) are published by workflows from tagged builds, never by hand. The extension is unlisted by choice; the installers should install without warnings (verified Google app, signed builds) as a goal.
- Ideas for growth go to the owner's inbox first, then to a ranked backlog (Linear, team JOB); nothing is built from an idea until it is ranked.

## Key files
- `desktop/lib/analytics.js`, `sentry.js`, `src/crash_reporting.py`: what is measured and how it is scrubbed.
- `docs/analytics.md`: the event list, what each reporter sends and never sends.
- `docs/gtm-journeys.json`, `tools/coverage-report.mjs`: journey readiness.
- `.github/workflows/extension-store-publish.yml`, `tools/webstore-publish.mjs`, `msix-store.yml`: store publishing.

## Live specs
- [Windows tester bugs, 0.9.2](../superpowers/plans/2026-11-03-windows-tester-092-bugs.md): what real testers hit first.
- [Fresh install smoke](../superpowers/specs/2026-11-01-fresh-install-smoke-design.md): the first-run path every new person walks.

## Ask the sources
ask: posthog events event=first_search_done days=30
ask: posthog events event=applied days=30
ask: github releases limit=5

## Lessons
- Count the first-press spread before judging an install: a person's first Find jobs press behaves differently from the next.
- The page a person lands on after install decides activation; measure the setup funnel (`setup_step`) before changing the wizard.
- The wizard stays AI, CV, Strategy only; every other connection is an always-present card and a dialog at its moment.

## Go deeper
[analytics](../analytics.md) · [site hub](site.md) · [release hub](release.md) · [app expectations](../app-expectations/README.md)
