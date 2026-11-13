# Always On does everything the Mac does (session `ap`)

Verdict: **approved to build all six** (owner, 11 Nov 2026, asked via AskUserQuestion with the sketch https://claude.ai/artifact/TdRGmaJvmB8oRbFXhs8zUs: "Yes, a spare account (Recommended)" for the LinkedIn probe; gaps "How often hours + finder check", "Web search in the cloud (ask cost first)", "Honest words on the card", "EURES / Adzuna / alert e-mails"; then "let's build them all"). PR 5/6 stays behind the owner's own stop rule: if the one LinkedIn cloud read meets a check, LinkedIn stays Mac-only and nothing more is tried.

## The owner's words (11 Nov 2026)
- "is Linkedin jobs also being used on the Always On (hosted cloudflare)?" · "it should" · "We should replicate the entire functionality/settings on the Always on as it's on the local" (session lt).
- Asked via AskUserQuestion: "Prove one cloud read first (Recommended)"; "New session, sketch first (Recommended)".

## What exists (read from code, 11 Nov 2026)
- The cloud engine run is `src/hosted_run.py`: `daily --mode scheduled` in the container, SQLite store, AI through the site, `config/search.json` + `profile.md` pushed by `desktop/lib/hosted-search.js config()`. No Notion, Gmail, Telegram or user key.
- sf's source lanes (`reader_rows.py LANES`, lanes 1/5, not on main when this was written): `eures, employer_sites, job_boards, free_job_apis, job_alert_emails, board_web, boards_found` (side engine), `linkedin, finder` (side app). Reuse those ids; never a second list.
- The cloud browser runner: tasks `fill | readiness | auto` (`desktop/ready-fill/`, web `api/ready*.js`); `COPY desktop/ready-fill/*.mjs` puts a new night file in the image without a Dockerfile edit.

## Design: states, their one owner, the verdicts
| Thing | States | One owner | Verdict that changes it |
|---|---|---|---|
| A lane in the cloud | reads / off (with its reason) | the lane's `Row.on(env)` in the container env (`hosted_run.environment`) | the env the run is given; never a second switch |
| The LinkedIn probe | queued → read → deleted | the site's batch row (task `linkedin`) | the one night result: status, final path class, cards count |
| The session on the site | held sealed → gone | the site's batch blob | the night's result (any), the owner's Stop, or the tick at 10 minutes: whichever first |
| Which settings the cloud knows | pushed, with their copy time | `hosted-search.js config()` | the app's push |

## 1/6 The LinkedIn cloud probe (the one measured read)
- **Trigger:** the owner calls `await window.pilot.linkedinCloudProbe()` from the window's developer console; the IPC refuses unless the build runs from source or has the Beta channel on (a real gate in `lib/linkedin-cloud-handlers.js`, code review 11 Nov 2026); no button, no ⌘K row, no new screen (a one-time measurement is not a feature: owner, "Explore, then park"). Product code reads the session with `linkedin-session.js readSession` (a macOS Keychain prompt is the owner's to answer); no agent reads it. New files only (`lib/linkedin-cloud-probe.js`, `lib/linkedin-cloud-handlers.js`); `linkedin-*.js` and `search-beside.js` stay lt's. The real switch comes with 5/6, only if the probe says go.
- **Path:** the app sends the session once over TLS to `/api/ready/batch` with task `linkedin`; the site seals it in the batch blob (READY_KEK, like the user's own AI key) and returns it only to that batch's night token; the container opens a plain browser (honest default user agent, no stealth, no extension), sets the two cookies, loads ONE LinkedIn Jobs search page, reports `{status, finalPath, cards}`, and the browser profile is deleted.
- **Verdict (conservative by design):** `go` only when every main-document answer is not 401/403/429/999, the last status is 200, the final URL is still `/jobs/search`, the SIGNED-IN page shows (its navigation bar, no guest sign-in form or public list) and signed-in job cards are on it. LinkedIn serves a public guest page with cards at the same address when it does not accept the session, so cards alone are never a go (code review, 11 Nov 2026). Everything else (sign-in, authwall, checkpoint, captcha, a limit status, a guest page, an unclear page, no cards, an error) is `no`: LinkedIn stays Mac-only, no retry, no second try. A selector LinkedIn changed can only turn `go` into `unclear`.
- **Who:** the owner's install only (`reader.owner`; the app asks the site `owner` BEFORE it reads the session, so a non-owner install uploads nothing). The session is whichever LinkedIn account the Keychain holds: for the owner's pick, a spare account, the owner signs in to LinkedIn with it first (Settings → Connections → LinkedIn); nothing enforces it. One read a day per install; a started night is never replaced; the tick never starts it. Cost: container seconds, about $0.0004.
- **Never:** the session in a log, file, PR, test or message; a retry; a stealth plugin; a real-session test (tests use a fake session on a stand-in host).
- **CLAUDE.md "LinkedIn jobs":** this PR adds the one owner-approved cloud-probe exception sentence (owner's words in the commit); the "Keychain only" rule itself changes only when 5/6 is built.

## 2/6 Settings parity
- "How often": the chosen hours reach the cloud schedule (the site owns the schedule; the app pushes the hours with the config). Built: `hosted-search.js pushSchedule` sends `freqHours` at turn-on, at app start and on a Settings change while on (`hoursSent` remembers what the site took); the site clamps it (Pro 4-24 h; a trial stays daily by its cost design, so a trial card must not promise the hours). "How often = Off" is the Mac's schedule and does not pause the cloud (the site's only pause is Always on's own switch); `pushSchedule` reports it as `off`.
- **Finder lane: missing in the cloud** (read from `src/hosted_run.py`: no scout or finder step; the app's "searching wider" is the Mac's). 6/6 says so on the card.

## 3/6 Web search in the cloud (`board_web`, `boards_found`)
- **Found (11 Nov 2026):** the site already has the lane: `jobadabra-web shared/free-ai-web.js` serves the board web search to Free AI (one shared answer per roles × places for 30 days, about $0.035 a new cell, $10 a month for everyone, 2 a day per install), and its relay `who()` already accepts the cloud run token (`HR1.`). Only the engine's `web_search.free_ai()` knew Free AI by the `JPF1.` prefix, so the cloud took the "your API key" path.
- **Built:** `free_ai()` also accepts `HR1.` (test: `tests/unit/ai/test_plan_search.py`). No new code path, no second lane.
- **Cost, measured:** nothing yet: the lane has never run in production (no `freeai:web:*` keys in the KV; no `WEB_SEARCH_ANTHROPIC_KEY` on the `www` Worker, read 11 Nov). Owner, asked via AskUserQuestion: "Fund the lane, then enable it (Recommended)": the owner makes the separate Anthropic workspace key with a $10/month spend limit (money stays his); the Worker secret is set through the Cloudflare MCP; then one cloud run's `board_web` line is read to measure.

## 4/6 EURES, Adzuna, alert e-mails
- EURES: `JOBADABRA_EURES=1` in the cloud env, as the installed app (owner, 10 Nov: off in development and CI, never the headline). **Built (4/6a):** `src/hosted_run.py environment()` sets it; the row's one gate stays `reader_rows._eures_on`.
- Adzuna: the person's own free key would go sealed to the site and be deleted on Always on off (a credential leaving the Mac: its own design block before code).
- Alert e-mails: needs the Gmail token in the cloud, which `hosted_run.py` forbids today (docstring "No Notion, Gmail, Telegram ... ever"). The owner chose it ("let's build them all"); its own design block (sealed token, delete on off, read-only scope) comes first and is shown to the owner before code.

## 5/6 LinkedIn lane in the cloud (only if 1/6 = go)
- The person's session sealed on the site, a scheduled read with the Mac off, read by the extension in the cloud browser with the Mac's page-kind judge, same limits (3 searches, no retry on any check). The owner's 26 and 31 Oct "own press only" rule changes for Always on: asked again with the measured number.

## 6/6 Always On says what it does not read
- The Always On card lists, from sf's lanes, what the cloud does not read (honest words, no promise of the Mac's coverage).

## Progress
- [ ] Sketch and the owner's yes (sketch https://claude.ai/artifact/TdRGmaJvmB8oRbFXhs8zUs; yes 11 Nov 2026)
- [ ] 1/6 LinkedIn cloud probe (app #3784 merged 14f9d37; site jobadabra-web #547; the owner's one read still to do): web PR first, then this repo's night file and the console-called IPC; the one read by the owner
- [x] 2/6 Settings parity (How often hours reach the cloud schedule; finder lane reported missing; the card's wording is 6/6) (proof: desktop/test/unit/main/hosted-hours.test.js)
- [ ] 3/6 Web search in the cloud (cost shown first)
- [ ] 4/6 EURES, Adzuna, alert e-mails (a design block each; EURES done: hosted_run.environment sets JOBADABRA_EURES=1; Adzuna and alert e-mails wait for the owner's design yes)
- [ ] 5/6 LinkedIn lane in the cloud (owner, 13 Nov 2026, asked via AskUserQuestion: "Try both, session with the spare account", replacing "Both desktop-only" the same day): the public (logged-out) search on trial from the Always on runner for the owner's install only, JobSpy pace, a few pages a day, first 429/999/check stops it, every answer recorded for a decision on everyone after about a week ([lg] 4/4 of spec 2026-11-13-linkedin-guest-search-design.md); no session read in the cloud: the 1/6 probe is not run (owner, 13 Nov 2026: "lets' keep Linkedin and Google sessions/credentials windows/mac only")
- [ ] 6/6 Always On says what it does not read (LinkedIn part: [lg] 3/4 of spec 2026-11-13-linkedin-guest-search-design.md; the other sources as they are)
