# AI tester bug reports any agent can replay (7 Nov 2026, short name fb)

> **Verdict:** 🟢 Both AI testers (the nightly persona agent, Claude Desktop by hand) file a bug through the app's own Send feedback in a **tester mode**. The app captures one evidence bundle; the **GitHub issue** (the only tracker) carries the summary and a link; the bundle sits behind that link in the private store; `npm run twin -- --replay <id>` loads its state.

Owner, 7 Nov 2026: "let's fix it so that AI persona creates proper github issues. detailed, with label, with proper description. screenshots, logs, state/profile... Basically on how we agreed". Pick on the sketch (https://claude.ai/artifact/E29LZop543wsN7Ef1UU89R): "Yes, as sketched (Recommended)": GitHub issues only, Admin stays for real people ("to avoid polluting Admin... to avoid making it a bug/issue tracker"), Admin hosts only a bundle page opened from the issue's link (no list, no status, no counts).
Issue: https://github.com/jobadabra/jobadabra/issues/3364. Progress: see the plan, `docs/superpowers/plans/2026-11-07-ai-tester-bug-reports.md`.

## What exists today (read from origin/main, 7 Nov 2026)

| Piece | Where | Fact |
|---|---|---|
| Send feedback, app side | `desktop/lib/feedback-handlers.js:37` `feedbackPrepare`, `:56` `sendFeedback`; `desktop/lib/feedback-bundle.js` | Holds one redacted copy in the main process: window JPEG (`shotDataUrl` :142, ≤1.8 MB), logs (`buildLogs` :123: support state, last 5 runs, last 400 app.log + 150 engine.log lines, ≤190 KB), screen data (`pageText` :168), opt-in Profile (`profileText` :184). The window cannot hand in other data at send time. |
| Where it lands | `desktop/lib/app-feedback.js:23` `send` → `POST https://www.jobadabra.top/api/feedback`; site `jobadabra-web/api/feedback.js` | One D1 row per feedback + R2 files `feedback/<ref>/…` (90 days, `shared/feedback.js` `TEXT_FILES`) + a Telegram message. 10 a day per install. Read on `/admin/feedback/inbox`. |
| What it lacks for a bug an agent must replay | — | No job-tab picture, no stored session record or job row, no extension version or mode chip, logs are the last lines not the minutes around the bug, no journey / expected / seen fields. |
| The persona agent's filing | `desktop/e2e/lib/agent-notes.mjs:62` `toFinding` → `ui-findings.yml` (reads artifact `e2e-artifacts-agent`) → `desktop/e2e/lib/triage-issues.mjs` `issueBody` / `labelsFor` | An argued note (expected, observed, why, severity, steps, one picture of the app window) becomes a Finder issue `[auto-ui] <view>: …`, labelled `agent-type:`, `persona:`, `judge:`, `proved`. Max 12 a session, low never filed, deduped by fingerprint (the noise register, moving to Admin per `2026-11-05-state-issues-to-admin-design.md`). |
| The persona's own Admin store | `.github/workflows/ai-user-agents.yml:227` → `desktop/e2e/lib/agent-run-upload.mjs` → `PUT /agent/run` (Bearer `REPLAYS_PUBLISH_KEY`) → `/admin/ai-persona` | Pictures, video and record of a run, for watching; not bugs. Stays as it is. |
| Closing a persona issue | `desktop/e2e/triage.mjs:192` `clearedNow` | **Not wired.** It clears only layout, AI-review, suite, chrome, probe, journey and a11y issues; an `ai-user-agent` issue is never "not seen", so it never closes. The sketch's "closes after 2 clean nights" needs PR 4/5. |
| The twin | `desktop/e2e/twin.mjs`, `desktop/lib/twin.js` | A clone of the real app folder + a Notion mirror, own window and browser; no replay of a given state. |

## Design

**States and their one owner**

| State | Owner | Changed by |
|---|---|---|
| The bug (open / fixed) | the GitHub issue | the Finder (files, "seen again", closes), a PR `Fixes #n` |
| The evidence | the bundle in the private store, immutable | written once by the app's tester send; deleted after 90 days |
| "Is this app a tester?" | the process environment, read once by `lib/tester-mode.js` | whoever launches it: the persona harness or the twin; never a setting, never the person |

**Tester mode** (`JOBADABRA_TESTER=persona|desktop-tester`, `JOBADABRA_TESTER_KEY` set by the launcher, see Keys)
- Read only in the main process. It is refused unless the app also runs as the test app or the twin (a real person's app can never be in it); guard test.
- Same dialog, same IPC path, same held-copy rule. The differences: the dialog also asks Journey (J-number or "none"), Expected, Seen, Severity (high / medium / low), Steps; the capture is the full bundle; **the send goes to the tester route, never to `/api/feedback`** (so no D1 row, no Telegram message, no count in Admin).
- The persona harness calls the same two IPC handlers the dialog calls (`feedbackPrepare` at the moment the note is made, `sendFeedback` for the notes that are filed). Claude Desktop presses the dialog's button.

**The bundle** (one object; built in the main process, redacted by `redact()`; each file capped like the feedback files)
- `report.json`: source, journey, expected, seen, severity, steps, at, the captured moment.
- `app.jpg` the app window; `tab.jpg` the job tab of the focused session, asked from the extension through the local server (none open: the bundle says "no job tab").
- `logs.txt`: `app.log` lines within ±5 minutes of the capture (timestamps are the ISO prefix, `lib/log.js:41`), the extension lines among them, the last runs, the support state.
- `state.json`: the stored session record(s) of that tab (`terminals.list()` public view, `desktop/lib/terminals.js:125`) and its job row from the store, as stored.
- `env.json`: app version, extension version, OS, AI engine, the session's mode chip text (`renderer/background-status.js:18` `sessionModeChip`), store kind.

**The store (site, `jobadabra-web`)**
- `POST /agent/bundle` with Bearer `REPLAYS_PUBLISH_KEY` (the narrow CI key; any other caller gets a 404, as the other publish routes) writes `bug-bundle/<id>/…` in the private R2 bucket, `<id>` = 16 random hex, and answers `{id, url}`. **No D1 row and no list**: nothing can count, rank or browse bundles. A daily purge drops objects over 90 days (the feedback files' rule).
- `GET /admin/bug-bundle/<id>`: one page (report, both pictures, logs, state, env, the replay command), behind the Admin login. `GET /admin/bug-bundle/<id>/<file>`: the raw file for the twin (Admin key). Not in the Admin menu.

**Filing (the Finder's path, unchanged shape)**
- The persona harness keeps each note's capture id; after ranking, each filed note is sent with its report and the answer's `bundle: {id, url}` rides on the finding (`toFinding`).
- The issue body gains: the journey line, `### Expected` / `### Seen` / `### Steps`, severity, versions and mode chip, `### Evidence bundle` (the link and `npm run twin -- --replay <id>`). Labels add `source:persona` or `source:desktop-tester`.
- **Persona data is invented** (CV, name, jobs from fixtures), so its two pictures and a redacted log excerpt sit in the issue (`<details>`). **Desktop-tester data is a copy of real data** (the twin, or Practice jobs): its pictures, logs and state never enter issue text or a committed file; the issue holds the sentences the tester wrote and the link only.
- Claude Desktop files the issue with the same text through the Finder's path (`triage.mjs` takes a finding file; the tester route returns the finding with the bundle id and the server files it on the next Finder run), so there is one filing path. Open: whether it is faster to let the route file the issue itself with the Finder's `issueBody`; decided in PR 4/5 (it must still go through the fingerprint dedupe and the noise register).
- **Closing a persona issue:** a night is clean for an issue when the session visited the issue's view (a goal ran there) and no note matched the fingerprint; two clean nights in a row close it (`clearedNow` gets an `ai-user-agent` branch that reads the visited views from `agent-run.json`). A desktop-tester issue is never auto-closed (a person ran it once); a `Fixes #n` PR closes it.

**Replay**: `npm run twin -- --replay <id>` fetches `state.json` and `env.json` with the Admin key from the Keychain, starts the twin (never the owner's window; never Submit) with the session record and job row loaded into its throw-away folder, and prints the bug's Seen / Expected. A bundle whose app version differs from the checkout says so.

## Limits and decisions
- **Safety:** the tester send is allowed only in a test app (persona harness) or the twin; a real person's app is never in tester mode (guard test).
- **What a twin bundle holds, said plainly:** the twin is a clone of the owner's real app folder, so its `state.json`, `logs.txt` and pictures can carry the owner's real session records, job rows and company names. They go only to the private bucket, behind the Admin login, for 90 days, redacted by `redact()` (secrets, e-mails, home folder). The Profile snapshot, CV text and answers are **not** part of the bundle (`profileText` is not called in tester mode). Persona bundles hold invented data only. Real-data bundles never enter issue text or a committed file (PR 4/5 test).
- **Keys:** CI sends with the narrow `REPLAYS_PUBLISH_KEY` (a GitHub secret). The twin on the owner's Mac needs no CI key: the tester route also accepts the Admin key, which already lives in the Keychain (`stats_key`, the same item the Admin tooling reads); the twin's launcher reads it from the Keychain and passes it in only to the child process, never to a shell profile or a file. No key found = tester mode stays off and says so. Tests use a fake key and a stand-in fetcher.
- **No new gate** (tooling freeze): each PR moves an existing writer; its tests guard safety or privacy only (`Guard:` line).
- **Admin counts untouched:** nothing here writes to the `feedback` table.
- **Depends on** the persona agent reaching screens: the 6 Nov nightly stopped at its 250k token cap after 3.3 min with 0 goals worked (run 42163935942: Claude answers at 7-9k tokens a step; the caps plan 100 steps). The filing format is useless until the agent's step plan comes from its token meter; that fix belongs to the persona sessions (`ce`/`ag`), reported to the coordinator 7 Nov. PR 4/5 waits for it.

## Not in this plan (parked if wanted later)
Screenshots of the browser extension's side panel as a third picture; a video clip in the bundle (the Admin AI persona tab already has the run video); filing real users' feedback as issues.
