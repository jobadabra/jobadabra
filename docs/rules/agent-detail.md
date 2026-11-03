# Agent detail moved out of AGENTS.md

Pure move (3 Nov 2026, harness map 2/8; owner: AGENTS.md must stay under Codex's 32 KiB cap): the sections below were in `AGENTS.md`, wording unchanged (only an `<a id>` anchor line added above each heading so the map can link to it). Reached from the [map](../map/index.md), which says when each one applies.

<a id="reading-websites"></a>
## Reading websites: one universal algorithm, AI where rules would grow (owner, 8 Oct 2026)
Find jobs using your browser, the extension (`extension/visit.js`) and the engine's site readers (`src/sources/visits.py`, `careers.py`) will meet
**thousands of sites**. A fix must work on any site, not the one in front of you.
- **No code for one website.** No site names, hosts or URL paths in the logic; no branch that exists because of one site.
- **No growing lists of words or patterns** (place spellings, button labels, frame hosts, query parameters). A list that will need a new entry
  for the next site is the signal to stop.
- **Use AI where a rule would need special cases**: give Claude what the page offers (its controls, links, suggestions, outline) and let it
  choose; keep the answer per site (recipes, job pages, pool facts) so the next visit costs nothing. The page's structure (frames, roles,
  links, JSON-LD) is fine to use: it is the same on every site.
- **A reader for a job system** (Workday, SmartRecruiters, ...) is fine only because one system serves many employers, and it is found
  generically (from the page or address), never listed per employer.
- **Test the class:** a fixture that stands for a kind of page (a list in a frame, a box that suggests, cards without links), not a copy of one site.

<a id="no-chrome-tab"></a>
### When "no open Chrome tab matches this job" is a lie (macOS, 1 Oct 2026)

macOS keeps **one** Apple Event connection per application, and it goes to whichever "Google Chrome" registered
first. An automation that leaves a windowless Chrome behind (`--no-startup-window`/`--headless`, launched from
`~/.claude/jobs/<id>/tmp/` or a temp dir) therefore **owns** Chrome's scripting: `windows()` answers `[]`, so the
app's focus/reload/close see no tabs at all and the session page says the form's tab is missing while the user is
looking straight at it. It cost hours to find once.

```sh
lsappinfo list | grep -A1 '"Google Chrome" ASN'      # two entries: BackgroundOnly (the stray) and Foreground (yours)
ps -Ao pid,ppid,lstart,command | grep 'MacOS/Google Chrome '   # the stray has ppid 1 (its launcher is gone)
```

The app now detects this (`desktop/lib/background-chrome.js`) and offers to quit the orphan from the extension card,
and the extension's own tab report is used for "which forms are open" so scripting is no longer the only source. When
you launch Chrome yourself in a script, kill it on exit (`trap 'kill $!' EXIT`), or it will hijack the next run.

<a id="logging"></a>
## Logging: when a debug session makes you wish for a line, add it then and there (1 Oct 2026)
Debugging that had to lean on file mtimes, Notion timestamps and GitHub runs — because nothing was written
down — is the signal to add logging, not to move on. Add it in the same turn, permanently.

- **Log decisions, not just errors.** Every irreversible or money-spending action (a Notion stage write, a cloud
  dispatch, an "Applied", a form fill, a run's start and end) gets one line: what happened, what asked for it, and
  the evidence it rested on. "Who decided this, and why?" must be answerable from the logs alone.
- **Log the evidence's identity, never its content.** Field names, counts, source, a short digest of the inputs,
  ids. Never the user's words, form answers, message bodies or tokens (`lib/log.js` says exactly this at the top).
- **The right file.** `logs/app.log` — the app's own doings, `log(area, message, fields)` from `lib/log.js`;
  `logs/engine.log` — what the Python engine printed for a run; `logs/notion-requests.log` — API traffic.
- **Read the logs first.** When something is wrong, `grep <area> logs/app.log` before archaeology. If the answer
  wasn't there, adding that line is part of fixing the bug.
- **Areas are stable and searchable** (`dispatch`, `sessions`, `run`, `extension`, `prep`, `review`, `update`,
  `window`): a new one is fine, a renamed one is a small tax on every future grep.

<a id="js-lint"></a>
## JavaScript lint checks
Desktop `npm test` runs ESLint first across `desktop/` and `extension/` (including tests and scripts). `no-undef` blocks failures; `no-unused-vars` is advisory. Use `cd desktop && npm run lint` for fast feedback. Fix the cause of lint errors; do not silence them by inventing globals. Browser, Node, preload and Chrome-extension globals are configured in `eslint.config.mjs`; generated build and shared files are excluded.

<a id="shared-verification"></a>
## Shared verification and checked desktop boundaries
`tools/check.sh` is what CI and the push hook run (`--fast`, `--area desktop|python|worker|site`, `--clean-install`); in a session run the one test file you changed instead (owner, 26 Oct 2026: suites run on CI only). The command selects Python 3.12+ and supported Node, stages desktop shared files, and reports setup problems without installing packages. CI and Claude hooks delegate to this same runner; it works from any directory and any agent.

Electron lifecycle callbacks are in `desktop/lib/lifecycle.js` with injected services; import them directly in tests. `main.js` supplies startup initialization and current app services. Session IPC channels must register through `sessionIpc` in `desktop/lib/session-contracts.js`; every exposed session channel has argument and response checks. Public terminal session views use that same contract. Add a channel's contract and tests before exposing it. Contracts cover the session bridge, not every IPC action yet. Contract failures log channel/direction/field names only, never argument values or session content.

<a id="offline-scenarios"></a>
## Offline app scenario tests
`tools/check.sh --fast` and the full desktop suite run `desktop/test/app-scenarios.test.js`.
Use `cd desktop && npm run test:scenarios` to reproduce just these journeys (stages shared files first).
When changing startup/reconciliation, session questions, resume, cancel, review handoff or quit, extend a
journey with the user's actions and observable consequences, including after restart and on service failure.
The suite runs the real preload, `lib/session-handlers.js` registrations, launcher, terminal persistence,
lifecycle callbacks and renderer state/cache helpers. Inject fake terminals, browser/dialog replies and Notion
responses; use fictional data in temporary folders, never real keys, applications, AI calls or browser tabs.
`main.js` supplies the live services to `registerSessionHandlers`; keep behavior there rather than duplicating
handlers in a test. These are offline integration tests, not a graphical Electron/Chrome end-to-end test.
Render changed screens with the normal demo smoke tools; live service compatibility needs separate checks.
