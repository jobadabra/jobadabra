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
- **Trigger:** the owner calls `await window.pilot.linkedinCloudProbe()` from the window's developer console on a beta or dev build; no button, no ⌘K row, no new screen (a one-time measurement is not a feature: owner, "Explore, then park"). Product code reads the session with `linkedin-session.js readSession` (a macOS Keychain prompt is the owner's to answer); no agent reads it. New files only (`lib/linkedin-cloud-probe.js`, `lib/linkedin-cloud-handlers.js`); `linkedin-*.js` and `search-beside.js` stay lt's. The real switch comes with 5/6, only if the probe says go.
- **Path:** the app sends the session once over TLS to `/api/ready/batch` with task `linkedin`; the site seals it in the batch blob (READY_KEK, like the user's own AI key) and returns it only to that batch's night token; the container opens a plain browser (honest default user agent, no stealth, no extension), sets the two cookies, loads ONE LinkedIn Jobs search page, reports `{status, finalPath, cards}`, and the browser profile is deleted.
- **Verdict (conservative by design):** `go` only when every main-document answer is not 401/403/429/999, the last status is 200, the final URL is still `/jobs/search`, the SIGNED-IN page shows (its navigation bar, no guest sign-in form or public list) and signed-in job cards are on it. LinkedIn serves a public guest page with cards at the same address when it does not accept the session, so cards alone are never a go (code review, 11 Nov 2026). Everything else (sign-in, authwall, checkpoint, captcha, a limit status, a guest page, an unclear page, no cards, an error) is `no`: LinkedIn stays Mac-only, no retry, no second try. A selector LinkedIn changed can only turn `go` into `unclear`.
- **Who:** the owner's install only (`reader.owner`; the app asks the site `owner` BEFORE it reads the session, so a non-owner install uploads nothing). The session is whichever LinkedIn account the Keychain holds: for the owner's pick, a spare account, the owner signs in to LinkedIn with it first (Settings → Connections → LinkedIn); nothing enforces it. One read a day per install; a started night is never replaced; the tick never starts it. Cost: container seconds, about $0.0004.
- **Never:** the session in a log, file, PR, test or message; a retry; a stealth plugin; a real-session test (tests use a fake session on a stand-in host).
- **CLAUDE.md "LinkedIn jobs":** "Keychain only" changes only when 5/6 is built, with the owner's words in that commit.

## 2/6 Settings parity
- "How often": the chosen hours reach the cloud schedule (the site owns the schedule; the app pushes the hours with the config). The finder lane ("searching wider", `press-stages.js`): read its cloud counterpart and say works or missing.

## 3/6 Web search in the cloud (`board_web`, `boards_found`)
- The container has no plan CLI and no Brave/SerpApi key. Options: the site's AI route with web search, or a site-held search key. **Ask before spending:** the measured cost per run goes to the owner first.

## 4/6 EURES, Adzuna, alert e-mails
- EURES: `JOBADABRA_EURES=1` in the cloud env, as the installed app (owner, 10 Nov: off in development and CI, never the headline).
- Adzuna: the person's own free key would go sealed to the site and be deleted on Always on off (a credential leaving the Mac: its own design block before code).
- Alert e-mails: needs the Gmail token in the cloud, which `hosted_run.py` forbids today (docstring "No Notion, Gmail, Telegram ... ever"). The owner chose it ("let's build them all"); its own design block (sealed token, delete on off, read-only scope) comes first and is shown to the owner before code.

## 5/6 LinkedIn lane in the cloud (only if 1/6 = go)
- The person's session sealed on the site, a scheduled read with the Mac off, read by the extension in the cloud browser with the Mac's page-kind judge, same limits (3 searches, no retry on any check). The owner's 26 and 31 Oct "own press only" rule changes for Always on: asked again with the measured number.

## 6/6 Always On says what it does not read
- The Always On card lists, from sf's lanes, what the cloud does not read (honest words, no promise of the Mac's coverage).

## Progress
- [ ] Sketch and the owner's yes (sketch https://claude.ai/artifact/TdRGmaJvmB8oRbFXhs8zUs; yes 11 Nov 2026)
- [ ] 1/6 LinkedIn cloud probe: web PR first, then this repo's night file and ⌘K command; the one read by the owner
- [ ] 2/6 Settings parity
- [ ] 3/6 Web search in the cloud (cost shown first)
- [ ] 4/6 EURES, Adzuna, alert e-mails (a design block each)
- [ ] 5/6 LinkedIn lane in the cloud (only if the probe says go)
- [ ] 6/6 Always On says what it does not read
