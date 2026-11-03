---
area: site
paths: [docs/site-routes.json, docs/site-test-names.json, docs/rules/private-site.md, docs/analytics.md, tests/site_private.py, desktop/test/site-private.js]
updated: 2026-11-03
---
# Site and admin (pointer hub)
> The website, /admin and their jobs live in the private repo jobadabra-web; this repo is the desktop app and the extension only. What the public repo holds is the contract between them.

## Rules
- jobadabra is the desktop app and the extension only: no `site/`, `worker/`, `hosted/` folder and no server-only workflow here. A Worker, container image or hosted job goes to jobadabra-web; code the app runs stays here under a non-server name (`app-core/`). Never recreate `site/`.
- Private reads public, never the reverse. The route contract is `docs/site-routes.json`: every route the site answers for the app, extension or engine, listed so they can be tested without the site code.
- A change on both sides: the private PR lands first (the site accepts the new route, feed type or reason word), then the public PR lists and uses it. The check is one way: the site may know more than public lists; public may never send what the site lacks.
- A new key in the served employer index is the exception: split it so the site stores it first without serving, then serves once the app's cache keeps it.
- Test file names are split by repo (`docs/site-test-names.json`): the site's tests in a shared folder carry its prefix. A test that reads a site file uses `tests/site_private.py` or `desktop/test/site-private.js`; it is skipped here and runs in the private CI.
- Shared tables the site re-exports live here (`desktop/e2e/lib/platform.mjs`, `desktop/lib/free-ai-models.js` and a few more): change them with the site's tests in mind.
- Nothing private in this repo: no site code, admin data, tokens or owner contact details.

## Key files
- `docs/site-routes.json`: the route contract; `docs/site-test-names.json`: which repo owns which test names.
- `tests/site_private.py`, `desktop/test/site-private.js`: helpers that skip or check against the private site.
- `desktop/lib/server.js`: the app's local server for the extension (not the website).
- Site code, admin pages and Workers: in jobadabra-web (private), not here.

## Live specs
- [Desktop and extension only](../superpowers/specs/2026-11-01-desktop-extension-only.md): which server code moved out and where each piece went.
- [GitHub org move](../superpowers/specs/2026-11-01-github-org-move-design.md): where the repos live now.

## Ask the sources
ask: github prs repo=jobadabra-web state=open
ask: cloudflare analytics worker=www days=7
ask: sentry issues is:unresolved culprit=site

## Lessons
- 75 red builds in two days came from change pairs waiting on each other across the two repos, not from bugs: that is why the private half lands first and its check is one way.
- A phone-size screenshot needs real mobile emulation (a narrow headless window crops the page).
- Render a site page the way production does (the joined tree), and refresh the overlay after an edit, or the check reads stale files.

## Go deeper
[private-site rules](../rules/private-site.md) · [analytics](../analytics.md) · [architecture](../ARCHITECTURE.md) · [CLAUDE.md](../../CLAUDE.md)
