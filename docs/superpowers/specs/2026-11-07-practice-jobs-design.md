# Practice jobs: Full automation end to end, no real application (pj)

> **Verdict:** a dev-build-only second app ("practice") whose Jobs list is made of our recorded employer pages, served from this Mac. Full automation runs for real, Submit included; the Submit lands in a local catcher that shows what would have been sent. No real employer is reachable.

Owner, 7 Nov 2026: "how can we simulate the full automation, but without sending real applications?" Picked "Practice jobs (Recommended)". Claude Desktop (skill `jobadabra-how-it-works`) must be able to test on it too.

## Problem
Full automation is the one feature we cannot try end to end: the twin never Submits (`docs/live-test.md`), tests never Submit (CLAUDE.md Safety), and a real Submit is a real application. So the last step (permit, press, receipt) is only ever proven in pieces.

## Facts that shape the design (measured 7 Nov 2026, origin/main 2f312d24)
| Fact | Where | Consequence |
|---|---|---|
| 163 recorded cases (11 captured, 152 hand-cut), 60 ladder pages; 23 cases have no form | `desktop/e2e/recorded`, `e2e/ladder-fixtures/pages` | Practice list picks form pages only |
| Only **52 of 163** forms have a `<form action>`; **61** use `onsubmit="return false"` | same | A catcher *server* alone sees a third of Submits: the served page needs a **capture shim** (below) |
| Pages sit on `*.example.*` hosts (jobs.example.com ×35 …), 8 on `jobs.lever.co` | case.json `pages[].url` | A host map is needed so the hidden browser finds them at those addresses |
| e2e already has an HTTPS fixture server and `hostRules(port)`: `MAP <host> 127.0.0.1:<port>, MAP * ~NOTFOUND , EXCLUDE 127.0.0.1` | `e2e/lib/forms.mjs:492` | Reuse the rule: every other name is unresolvable, so no employer is contactable |
| The hidden browser takes those flags only when `JOBADABRA_E2E=1` (a regex allow-list) | `lib/background-browser.js:13-21` | One new gate for practice, dev build only |
| The twin is the precedent for an isolated copy: own folder, refused if it is the real one | `lib/twin.js` `twinRefusal`, guard `test/guards/safety/twin.test.js` | Practice copies the pattern, not the code |
| `app.isPackaged` tells a dev run from a release; `electron-builder` ships only `lib/**`, `renderer/**`, `demo/**`… | `desktop/package.json` `build.files` | Practice code in `desktop/practice/` is not in `files`: absent from every installer |
| Each queued item carries its own mode + confirmation; the Submit permit reads the item | CLAUDE.md Safety, `background-apply-controller.js:357` | Practice needs no change to the safety chain: it runs it for real |

## Observable behaviour
1. `cd desktop && npm run practice` opens a **second app** (own window, own port, own folder `…/Jobadabra (practice)/home`, banner "Practice: no real application is sent" (Gitar, PR 2/4: the engine's page fetches and the AI do leave the machine, so the banner claims only the application)). Never the owner's app, Chrome, Keychain or sessions.
2. Its Jobs list holds ~12 **Practice jobs** (title "Practice · <shape>", company "Practice Co"), one per recorded form shape (multi-step, upload, menus, account first, bot check…), with a fictional applicant and kit.
3. The person turns on Full automation in its Settings (the real confirmation) and presses Apply; the hidden browser opens the page, the extension fills, Full automation presses Submit.
4. The Submit lands in the **catcher**. Practice shows "What would have been sent": the fields and values of the form, the page address, the time, and "Left this Mac: 0 requests".
5. Claude Desktop does the same through the app's own screens (skill gets one paragraph, outside this repo).

## Design

### States and their one owner
| State | Owner | Changed by |
|---|---|---|
| Practice mode on | env `JOBADABRA_PRACTICE=1` set by `npm run practice` only; read once at start by `desktop/practice/gate.js` | nothing at runtime |
| Practice jobs | the practice folder's own sqlite store, seeded at start | the seed, then the normal app flow |
| Caught submissions | `catcher.js` ledger file in the practice folder | the catcher only; the app reads it |

### How a practice job enters the list without touching the real store
A **separate folder and store**: `<temp folder>/jobadabra-practice`, emptied at each start (`desktop/practice/gate.js` refuses any other folder, and any real data folder of either name or OS). The app starts on it the way the e2e harness starts a test app (`JOBADABRA_E2E`: its own port, secrets in that folder, no Finder, clipboard or browser doors; `lib/e2e-host.js`), so practice gets the isolation tests already have. The seed writes the 12 rows through the engine's own store command (`python -m src.stores call applications …`, sqlite adapter), as `e2e/lib/seed-data.mjs` does for tests: each is a Saved job with no drafted kit, like a fresh posting on a person's list. No row ever reaches the real store, because the practice process cannot open it.

### How the Submit is caught (the catcher)
`desktop/practice/server.js` (one HTTPS server on 127.0.0.1, self-signed cert as `forms.mjs`, reused through `hostRules`) serves each case's pages at their recorded address. Each served page gets a **capture shim** injected before `</body>`: a capture-phase `submit` listener on `document` plus a click listener on submit-type buttons that read `FormData` and `POST /__caught`, then let the page go on. The shim is what catches the 61 `return false` forms and the 52 with an action alike. A form action's own POST lands on the same server and answers 303 → "sent" page, as `startForms` does. The shim never changes a page's fields, so what the extension filled is what is caught.

### How the catcher proves nothing left the Mac
1. **Resolver:** the hidden browser starts with `MAP * ~NOTFOUND , EXCLUDE 127.0.0.1` (the e2e rule), so only the catcher's hosts resolve.
2. **Positive control at start:** the launcher starts a probe browser with the same host rule string the app's hidden browser gets, and asks it to load a real public name (the app's own browser process is not probed); if it loads, practice refuses to start (a proof the rule took effect, not assumed).
3. **Ledger:** the "Left this Mac" line is the count of requests the catcher saw for hosts outside its map (the browser cannot send them, so 0 is the expected number, and a non-zero is shown red).
4. **Scope:** the Chrome path ("Open in Chrome") is refused in practice; only the owned hidden browser runs.

### Dev build vs release
- Code in `desktop/practice/` (not in `build.files`, so not in any installer). **No hook was added to shipped code**: the hidden browser already takes a host map under `JOBADABRA_E2E` (`lib/background-browser.js`), and `npm run practice` starts the app from the source checkout with it.
- Guard (safety, `test/guards/safety/practice-isolation.test.js`): `build.files` has no practice entry; no file the installer ships imports `practice/`; the gate refuses every real data folder; every practice job is on a reserved name.
- **Reserved names only** (found while building 2/4): the hidden browser cannot reach a real host, but the app's engine fetches job pages by itself, outside that browser, so a recorded page on `jobs.lever.co` would reach the real site. A practice job lives on `example.com/.org/.net`, `*.example`, `*.test` or `*.invalid`; 52 of 163 recorded cases are on other names and are not offered. Recorded cases replay one at a time and 3 share an address, so `practiceJobs()` also refuses two jobs at one address.

### AI in practice
Owner, 7 Nov 2026: "Person's own AI (Recommended)". The person's own AI setup answers (Free AI or Claude plan), because "Full automation runs for real". Cost: one fill is a few calls; the app's own credit sentence shows it. Alternative: the case's recorded `ai` answers through a stand-in (free, repeatable, but not the product's AI).

## Acceptance criteria
- [ ] `npm run practice` starts a second app; its window title and banner say Practice; its folder is not a real folder (a start on a real folder is refused with a test).
- [ ] The Jobs list shows the practice jobs; the real app's store is byte-identical after a practice session (test with temp folders, no real app).
- [ ] Full automation on a `return false` form and on an `action` form each produce one caught submission with the filled values; both are visible in "What would have been sent".
- [ ] A canary load of a real public name fails in the practice browser; practice refuses to start if it succeeds.
- [ ] `build.files` has no practice entry and nothing the installer ships imports `practice/` (no hook in shipped code).
- [ ] Nothing in the tests touches the owner's app, Chrome profile, Keychain or port 47111.

## Non-goals
- Not in a release build, not for users, no setting.
- Not a Tier 1 e2e journey (registry + owner's yes needed); a later PR may add one.
- No change to the e2e harness: practice writes its own small server (`desktop/practice/server.js`) with the same host rule and self-signed cert approach as `e2e/lib/forms.mjs`, because that file is e2e-only (fixed host list, test fixtures) and heavy to import.
- No real-employer pages, no captured real data; only the files in `e2e/recorded` and `e2e/ladder-fixtures/pages`.
- The Claude Desktop skill lives outside the repo (`~/.claude/skills-src/jobadabra-how-it-works`): the coordinator adds its paragraph.

## Plan (4 PRs)
1. Practice server + catcher + capture shim (`desktop/practice/`), with the guard that it only listens on loopback.
2. Dev launch: `npm run practice`, gate, practice folder + seed of the 12 jobs, host-rule proof, release guard.
3. UI: the banner, the practice jobs, "What would have been sent" (side-by-side to the owner first; palette entry).
4. Docs: `docs/practice-jobs.md`, the map line, the paragraph for the skill (sent to the coordinator).

## Progress
- [x] Spec + sketch approved by the owner (7 Nov 2026: own AI, about 12 jobs, result on each job's card) (proof: none: the owner's answers, relayed by the coordinator)
- [x] 1/4 server + catcher + shim (proof: desktop/practice/server.js @e3fbc289)
- [x] 2/4 dev launch + isolation + host-rule proof + release guard (proof: desktop/practice/launch.mjs @452ce7b) (two real launches; the second opened 12 jobs on its own port)
- [ ] 3/4 UI: banner, "What would have been sent" on each job's Application tab (this PR; the practice jobs are Saved, under Jobs → Saved, by design)
- [ ] 4/4 docs + skill paragraph
