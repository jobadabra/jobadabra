# Cloud browser runner: one Cloudflare browser for three tasks

Verdict: **approved** (owner, 8 Nov 2026, relayed by the coordinator: "Approve the 5 lines (Recommended)" and "Site holds it, encrypted (Recommended)"); `auto` stays last. Ready to send's Cloudflare container becomes ONE runner that takes a task kind: `readiness` (Apply readiness, read only), `fill` (fill up to ready to submit, today's night) and `auto` (Full automation, Submit included). No second runner is built.

## The owner's words (8 Nov 2026, relayed by the coordinator)
- On R2's Always-on question: "Why not using our solution on CloudFlare? We have already implemented. Basically CLoud/Server Browser on CLoudFlare", then "Yes, use the cloud browser (Recommended)".
- "Let's make that code reusable. modular/abastracted..." · "about the cloud browser run on CloudFlare" · "So that we can use it for various tasks" · "One time for Appply Readienss. Another one for Form filling up to Ready to submit. Another time for fully automated applying (including submittin)".

## What exists (read 8 Nov 2026)
- **The container** (`jobadabra-web:ops/hosted/ready-fill/main.mjs`): `POST /run {site, token}` starts a night; `GET /state`, `WS /ws` (the live view), `GET /handoff`, `POST /close`. Every call needs the night token; nothing is written to disk but the browser's temp profile.
- **The Worker** `jobadabra-web:workers/ready-runner` starts it per account; the image is checked by `ready-fill-image.yml` before each deploy.
- **The shared night files** (this repo, `desktop/ready-fill/`): `night.mjs` (one browser, the night's copy of the extension, the stand-in app, one tab per job, counts only to the Worker, the cost cap), `fill-job.mjs` (one job), `no-submit.mjs` (the net that refuses a submit request), `live.mjs` (live view, hand-off).
- **Cost** (`night.mjs` costMicro, measured): the container ≈ $0.000012 a second (standard-1), so a 30 s form read ≈ $0.0004 a job, plus the AI the extension reports.

## Design (states, their one owner, the verdicts)
- **One runner, one task per run.** `POST /run {site, token, task}` with `task` one of `readiness | fill | auto` (missing = `fill`, so today's nights are unchanged). The night code picks the per-job step by task; browser start, extension copy, stand-in, tabs, live view, cost cap and `/close` stay shared.
- **What each task may do:**

  | Task | Started by | Reads the form | Fills | Presses Submit | Result back |
  |---|---|---|---|---|---|
  | `readiness` | Always on with no Mac (Prepare top matches, a scheduled run) | yes | no | never | the Apply readiness read per job (the same shape as `lib/apply-readiness.js` stores) |
  | `fill` | Ready to send (today) | yes | yes, held for the person | never | held tabs, hand-off (today) |
  | `auto` | Full automation with Always on (later) | yes | yes | only through the one gate below | the job's outcome and the page's own proof |

- **Where the result lands:** a `readiness` read goes to the job's `apply_readiness` field through the store the person chose (Always on + Notion: the Applications row). With the default store (this Mac) and the Mac off, the site keeps it encrypted with the account's hosted state (where Ready to send's cloud state already lives), and it is removed on the site once the app has read it (owner, 8 Nov 2026: "Site holds it, encrypted (Recommended)").
- **The app's seam:** `lib/apply-readiness.js` `readForm(job)` is the one place a read happens; R2 (PR "[ac] Every Apply goes through Apply readiness") routes every caller through it. The cloud runner becomes a second `readForm` used only when Always on runs without the Mac.

## Safety (CLAUDE.md "Safety" applied to a new place; for the owner's yes before any Submit code)
1. Submit from the cloud only in task `auto`, only with the item's own stamped confirmation (`autoConfirmedAt` carried by the queued item, as on the Mac), never from a saved setting alone.
2. The page's own proof always holds (every required field filled, a sending button, no bot check); kit eligibility holds unless the person turned on "Apply to jobs marked not eligible".
3. `readiness` and `fill` keep `no-submit.mjs` as the net; `auto` presses Submit through one gate function with its own guard test.
4. Never a login wall, a captcha, an SMS code or a disguised browser (honest user agent, no stealth plugin); a 401/403/429 ends that job, no retry.
5. Tests, the image check and the pool never submit: the image check runs `readiness` and `fill` against the stand-in site only.

## PRs (n/N, both repos; site PR first)
1. jobadabra: `desktop/ready-fill` takes a task; `readiness` reads and does not fill (unit tests, the no-submit net unchanged).
2. jobadabra-web: the container's `/run` passes the task; the Worker starts `readiness`; the image check runs a `readiness` night.
3. jobadabra: Apply readiness's cloud `readForm` for Always on; Always on's Prepare top matches goes through it and takes the name "Apply readiness on the top matches".
4. Later, after the owner's yes on the safety lines: `auto` (its own spec section and guard).

## Progress
- [x] Owner's yes on the safety lines and the open question (8 Nov 2026: "Approve the 5 lines (Recommended)"; "Site holds it, encrypted (Recommended)") (proof: none: the owner's decision, relayed by the coordinator)
- [x] 1/4 `desktop/ready-fill` takes `task` (`fill` default, `readiness`; any other refused): `read-night.mjs` reads each form through the extension's background poll and `lib/triage-reader.js` (`read-commands.mjs`), tells the site `{job, task, state: read | unreadable, read, why, ms, costMicro}`, holds nothing; the browser start is shared (`night-browser.mjs`). (proof: desktop/test/unit/ready-fill/ready-read.test.js)
  The page kind a read needs is the Mac's AI rung (`lib/ladder/rung2-sketch.js` `pageKind`), its model calls through the site's existing `/api/ready/ai` (night token, the night's cap; the site picks the model): no new site route. `night.mjs` loads the read's files only for a read, so the fill night's image runs unchanged before 2/4 (code review of 1/4; guard in `ready-read.test.js`).
- [ ] 2/4 (jobadabra-web): `/run` passes the task; the image carries, beside `form-address.js`: `desktop/lib/triage-reader.js`, `triage-read.js`, `session-tab.js`, `ladder/rung2-sketch.js`, `ladder/rung1-kept.js`, `ladder/rung3-digest.js`, `ai/models.js` and `desktop/shared/alias-schema.js` (the web image test follows `../../desktop/lib` imports too); the site keeps a read encrypted and removes it once the app has read it; the image check runs a `readiness` night.
- [ ] 3/4 · [ ] 4/4
