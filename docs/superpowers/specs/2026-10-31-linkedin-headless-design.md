# LinkedIn jobs on every Find jobs, headless

> **Verdict:** opt-in switch in Settings → Connections → LinkedIn. On: every Find jobs also reads the person's LinkedIn job searches in the app's own hidden browser, using their LinkedIn session copied from Chrome by the extension. Off (default): nothing changes.
> **Status:** draft for the owner's yes (31 Oct 2026, session `li`). Feasibility of a **signed-in** read is unmeasured (see Risks).

## Problem
- Today LinkedIn is read only in a visible tab of the person's own Chrome after they press "Find jobs using your browser" (`desktop/lib/visits.js`, `extension/visit.js`). The engine never fetches LinkedIn; `extension/refused-read.js:16` blocks it.
- Most people search on LinkedIn first. A Find jobs that leaves it out misses the biggest board unless they remember the extra press, and that press takes over a Chrome window.

## Owner's decisions (31 Oct 2026, exact words)
- Request: "Every Find jobs, if the user is logged in via Linkedin Jobs, should search and scrape jobs, using the user's login" … "but headlessly".
- How: "First option will focus the window. Right? I'd like to avoid this. Therefore, I'd go for option 2" → **the app's own headless browser, with the person's LinkedIn session copied from Chrome by the extension.** Not a hidden window in their Chrome, not LinkedIn's private API.
- Consent: "Opt-in, warned once" → off by default; one switch with one warning line.
- Signed-in proof (31 Oct): "My own try, local main". Build behind the off-by-default switch, then the owner turns it on once in their own app; a checkpoint stops us (disguise stays the owner's decision). No test touches their session.
- Web Store (31 Oct): "Accept, fallback desktop-only". If review rejects the cookie read, the path moves to the desktop-bundled extension build.
- Where the person finds the switch (owner, 31 Oct): "When the user presses Find jobs for the first, or for the second time, we should popup and ask about this." / "And/or it should be in the Suggestions card" / "Somewhere to easily found by the user".
- Sign-in without the extension (owner, 3 Nov 2026, after "Turn on LinkedIn for jobs search doesn't work"): "a headless chromium with the playwirght might be enough (as long as we can copy/get the user's linkedin session)"; his choice: **"Both: window first (Recommended)"**. See "Sign-in window" below: the window is the first way; the extension copy stays as a shortcut.
- This relaxes, on purpose: CLAUDE.md Safety ("go past a login wall (LinkedIn …): only through the user's own visit"), `docs/rules/why.md:13`, `docs/rules/applying.md:53` (26 Oct: "shouldn't start automatically in the background").

## Behaviour
**One read per Find jobs, only when the switch is on and a session exists.**
1. The extension (in the person's Chrome) copies the LinkedIn session cookies to the app **when the switch is turned on and at each Find jobs while on** (refresh), over the existing authenticated loopback. It never reads them otherwise.
2. The app keeps them **only in the Keychain** (`job-pilotto.linkedin-jobs.session`; e2e: the isolated-secrets file, `lib/keychain.js`).
3. At the LinkedIn step the app starts **the read's own short-lived headless browser** (`lib/linkedin-browser.js` over `lib/background-browser.js`, its own folder `linkedin-read`, a worker with no backgroundOwner so it never claims an application), sets the cookies in it for the read, opens the searches, and **deletes that browser's whole folder when the step ends** (so no profile keeps a credential between runs). Why (#3711, 10 Nov 2026): the first version used the kept, shared profile; the in-memory expiry never reached disk before the app's end killed the browser, so li_at stayed in the app folder on 4 LinkedIn hosts.
4. The owned browser's extension reads each list page exactly like today (`extension/visit.js`: AI-judged cards, follow pages, stop at login wall or check) and sends it to the app; `src/sources/visits.py` ingests; scoring and filters are the normal path.
5. Searches come from the current strategy (its own role and place words: `src/sources/visits_portals.py` `linkedin_searches`), at most **3 searches × 3 pages** (the app ends a read after 3 pages: `visits.runAll` `maxPages`), 1.8–3.2 s between pages (the extension's own pause) and 3–5 s between searches, beside the engine's steps on the press's one deadline (ends at 170 s: `lib/search-beside.js`); what did not fit is reported ("LinkedIn: read 2 of 3 searches, ran out of time").
6. Every search is a row in Recent activity; **Stop ends it** (tab closed, cookies removed).

### Where the person turns it on (three doors, one consent)
| Door | When | Action |
|---|---|---|
| Settings → Connections → LinkedIn | always | the switch + the one warning line |
| Ask on Find jobs | the 1st and 2nd Find jobs press while off and never asked twice before | one dialog: warning line, **On** / **Not now**. "Not now" twice = never asks again (the other doors stay) |
| Suggestions card | while off (and not on LinkedIn-less strategies, see non-goals) | entry "Also search LinkedIn, in the background" with one click that opens the same consent |
All three open **one consent** (the dialog); On requests the two optional permissions in the extension, whose own UI shows the consent text (Web Store rule), then copies the session. Each is in the ⌘K palette ("Turn on LinkedIn jobs"). One owner of "asked N times / answered": a small setting `linkedinJobs.asked` (0-2) and `linkedinJobs.declined` (0-2); the switch is `linkedinJobs.on` (`settings.linkedin` belongs to the profile import), changed only by the dialog's verdict.

### States (one owner: the LinkedIn step's result, written once per run)
| State | When | Card says |
|---|---|---|
| `off` | switch off (default) | nothing; no cookie access, no browser |
| `no-session` | on, no LinkedIn cookies found in Chrome | "LinkedIn: sign in to LinkedIn (Settings → Connections → LinkedIn), then press Find jobs" |
| `reading` | on, step running | "LinkedIn: reading search 2 of 3" |
| `done` | step finished | "LinkedIn: N jobs read" (or "none new") |
| `signed-out` | owned browser lands on a login page | "LinkedIn: sign in again (Settings → Connections → LinkedIn)" (no retry this run) |
| `check` | checkpoint / verification / bot-check page | "LinkedIn asked for a check" (no retry, not solved) |
| `limited` | 401/403/429 | "LinkedIn asked us to slow down"; 429 = skip for a day, others for this run |
| `no-browser` | background browser not downloaded | "Download Jobadabra's browser (one time)" with progress and Cancel (existing add-on) |
| `failed` | the owned browser would not start or open the page, or clearing the session failed | "LinkedIn: could not be read this time" (no retry) |
| `stopped` | Stop was pressed | "LinkedIn: stopped" |

Verdicts that change state: page kind judged by the AI (`src/ai/decide.py`), HTTP status, Stop, deadline. Nothing else.

## Sign-in window (owner, 3 Nov 2026: "Both: window first")
**Verdict:** "Sign in to LinkedIn" opens a Jobadabra window on LinkedIn's own sign-in page. The person signs in once (their password, their checks and codes, typed by them on LinkedIn's page); the app then copies the two sign-in cookies into the Keychain exactly as the extension copy does today, clears the window's storage and closes it. Everything after (the hidden read, Stop, the Keychain rules) is unchanged. No extension, no Chrome. Mac first: Windows has no credential store for the session yet (parked as JOB-254), so there the window refuses before it opens (`no-keychain`).
- **Window:** an Electron window with its own storage partition (`linkedin-signin`, not the app's), no preload, no node, sandboxed, honest user agent (Electron's own default, which names Electron). Links to other hosts open in the default browser; the window never leaves linkedin.com. **A sign-in provider's popup stays attached** (owner, 5 Nov 2026, after "When I try to enable LInkedin jobs. And I click login with Google, it doesn't really work": Chrome showed a blank `accounts.google.com/gsi/select`; decision "Allow popup, you try once (Recommended)"): a page's popup (Electron `new-window`, https) opens as a child window of the sign-in window, in the same in-memory partition, sandboxed, no node, no preload, honest user agent, no permissions, at most three at once, closed with the window. It is told from a link by how it opens, never by naming Google or Apple. The person types there; Jobadabra never sees it, reads nothing and injects nothing. If a popup opened and the window ended with no sign-in, the toast (reason `popup-ended`) says Google or Apple may not allow sign-in here and points to the Chrome way of the sign-in choice (or to connecting the extension). Not covered (no host list, so they cannot be told from links): a provider that signs in by a full-page redirect instead of a popup, and a `window.open` without a size (Electron reports it as a tab); both still open in the browser. A popup may navigate to any https page, never to another scheme; a sign-in finished only inside the popup is not seen (the verdict is the sign-in window's own page plus `li_at`). Closing it = cancel (nothing saved, storage cleared); 10 minutes without a sign-in ends it the same way.
- **One verdict for "signed in":** a `li_at` cookie is set in the partition AND the page left LinkedIn's sign-in and checkpoint paths (`/login`, `/uas`, `/checkpoint`, `/authwall`, `/signup`, `/add-phone`). Then: `cleanCookies` (the same allow-list: li_at, JSESSIONID) → `saveSession` (Keychain) → switch on → storage cleared → window closed → "LinkedIn jobs is on". The window's check pages (code by SMS or e-mail, captcha) are the person's to answer in their own window; the app never reads, fills or clicks anything in it.
- **The extension copy is the first way of the sign-in choice** (owner, 14 Nov 2026, asked via AskUserQuestion: "Ask, Chrome first (Recommended)"): every sign-in door asks "How do you want to sign in?", with "Use my LinkedIn sign-in from Chrome" first and picked while the extension is connected (greyed with what it needs when not), then "Sign in in a Jobadabra window"; the refresh at each Find jobs is as before. `signed-out` and `no-session` now point to Settings → Connections → LinkedIn, whose button opens the window.
- **Measured (3 Nov 2026, standalone probe, no sign-in):** LinkedIn's own `/login` page renders in an Electron window with the honest default user agent (`… Chrome/152 Electron/44.4.5 Safari/537.36`): email and password fields, Google and Apple options, no "unsupported browser" wall. A real sign-in through it is unproven until the owner's own try; if LinkedIn blocks it in this window, **stop: a new owner decision** (no disguise).
- **Every press is logged** (owner's ask via mac-07, 3 Nov 2026): `linkedin-jobs: press {path: window|extension, outcome (window) | opened, starting, reason, browser, idSource (extension)}` in app.log; never a cookie value, a URL with a query or a page's text. Why: tonight's cause was unprovable from the owner's machine because the log never recorded the press.
- **Relaxed on purpose (on top of the 31 Oct list):** "never types a password" stays true for us (the person types it, on LinkedIn's page, in our window; nothing is injected or read); what changes is that the app now **hosts** LinkedIn's sign-in page. Checks and codes there are the person's to solve ("a captcha is the user's to solve", refused-sites rule), never ours.
- **Not changed:** the session is a credential (Keychain only, never logged), the read pace, the 3×3 cap, Stop, `no-browser` (the hidden reader's one-time download), tests never touch the owner's session (a fake partition and a fake LinkedIn page).

## Design (10 Nov 2026, issues #3711 · #3710 · #3705; one block for the three PRs, owner's circles rule)
After lt's by-hand check (one press, signed in, LinkedIn answered: 0 jobs kept, the card silent, the session left on disk). Every PR on these files builds to this; none adds a case.
| State of a LinkedIn read | When | Card's LinkedIn lane says |
|---|---|---|
| `off` | switch off | nothing: no chip, no line |
| `no-session` | on, no session held | sign in to LinkedIn (Settings → Connections → LinkedIn) |
| `no-browser` | Jobadabra's browser not downloaded | one-time download, progress and Cancel |
| `reading` | step running | search n of m · N jobs read · M match your search so far |
| `done` | ≥ 1 search answered, jobs read | N jobs read · M match your search |
| `none-new` | ≥ 1 search answered, no new job | searches read · no new job since your last search |
| `signed-out` | a search landed on LinkedIn's sign-in page | sign in again; nothing more is read this time |
| `check` | a check page | LinkedIn asked for a check; not answered; nothing more today |
| `limited` | 401/403/429/999 | asked us to slow down; 429 = left alone a day |
| `failed` | asked and got no answer (0 of m searches answered), or the browser would not start | could not read LinkedIn this time (never "none new") |
| `stopped` | Stop | stopped |
- **One owner of the state:** the step's result (`lib/linkedin-headless.js` `linkedinStep`), written once per run (`noteRun` → `settings.linkedinJobs.last`). Verdicts that change it: the extension's page kind, the HTTP status, Stop, the deadline, and whether each search's read reached the step (the read is tied to the tab the step opened, never to a mark in the URL that a redirect drops: #3710).
- **Where a read job is** (#3710, after the 11 Nov 2026 press: LinkedIn's `/jobs/search-results/` cards named no place, so 0 of 10 fit; owner via AskUserQuestion, "Both, place first"): (a) the place its card names; else (b) the place the engine searched in, when the engine built the address with one (`linkedin_searches()` → `{name, url, place}` → `runAll` → the read's `place`), still judged by the place step; else (c) none. One mechanism: `src/sources/visits_read.py` gives a page's place to its placeless cards, as for a page the extension filtered. No host name.
- **Who reads it:** the Find jobs card's lane (chip + one live line, the same mechanism every parallel source will use: #3705), `settings.linkedinJobs.last` (the next press and Settings), Recent activity (one row per search).
- **Where the session lives:** the Keychain; during a read, only in the read's own browser folder, deleted when the step ends. Remaining window: an app killed in the middle of a read leaves that folder until the next start, which deletes it (and scrubs LinkedIn rows any earlier version left in the kept profile); every hidden-browser start waits for that sweep (`holdStartsUntil`). A read browser that hangs is ended with its process group when the step ends, and its folder deleted then (Gitar on #3717, 10 Nov 2026). Nothing else.
- **Tests read no real Keychain** (#3711): under `node --test` / unittest (`NODE_TEST_CONTEXT`, `JOBADABRA_UNDER_TEST`) the genuine `security` reads nothing (`lib/keychain.js`, `src/secret_store.py`); a test passes a fake `readSession` or exec. A by-hand verification press runs the DEV app, which is not a test and reads its session as a user's app does: never set either variable on it to "fix" a press.

## Safety (all of CLAUDE.md Safety still holds)
- Never solves a captcha or check, never uses an SMS code, never types a password; a login page or checkpoint ends LinkedIn for the run.
- **Never disguises the browser**: honest user agent (measured: `HeadlessChrome/156`, `navigator.webdriver=false`), no stealth plugin, no UA/fingerprint override. If a signed-in read needs disguise to work, **stop: new owner decision**.
- The copied session is a credential: Keychain only; never in logs, telemetry, the store, Notion or an upload; deleted when the switch goes off or on sign-out; refreshed only while on; removed from the owned profile at the end of each step.
- Pace: ≤ 9 pages per run, waits between pages, one LinkedIn step per Find jobs. Warning shown once, in the switch's own row: "LinkedIn may limit accounts it thinks are automated; we read slowly and only your job searches."
- Tests never use the owner's LinkedIn session or Chrome profile (see Test plan).
- `extension/refused-read.js` NEVER list and `src/sources/refused_reads.py` are **not touched**: this is not the refused-read path.

## Chrome Web Store (public listing is one of the five goals)
- Policy facts (developer.chrome.com/docs/webstore/user_data, 31 Oct 2026): authentication cookies are sensitive user data; disclosure is required even when data stays on the device; prominent disclosure and consent must be in the extension's own UI; collection only for a user-facing feature; "narrowest permissions". Extension ↔ native program on the same machine is exempt from the secure-transport rule only. Not stated: whether a local companion app counts as a "transfer".
- Design to stay inside: optional permissions only (`cookies` and `https://www.linkedin.com/*` requested at runtime when the switch goes on, removed when off; `extension/options.js:23` already toggles `cookies`); consent text shown in the extension UI before the first copy; read only the session cookies LinkedIn needs; send only over the loopback.
- **Residual risk:** a reviewer may reject "reads another site's auth cookie". Fallback: this path ships in the desktop-only extension build, not the Web Store one. Owner to accept.

## Acceptance criteria
0. The ask dialog appears on the 1st and 2nd Find jobs press while off, never after On or after "Not now" twice; the Suggestions entry shows while off and disappears on On; all three doors open the same consent; "Turn on LinkedIn jobs" is in ⌘K (class tests: card-system NOT_A_CARD, text-fields-allowed, input type, palette registry).
1. Switch off (default): no cookie read, no browser start, no LinkedIn request (assert).
2. Switch on + session + browser: one Find jobs reads ≤ 3 searches, jobs appear in the normal results with `source=linkedin`; Recent activity lists each read; Stop ends it within 5 s.
3. Each non-`done` state above is reached by a fixture and shows its words; none retries.
4. Cookies: absent from logs, `app.log`, store, telemetry (assert by scanning a run's output for the fixture's cookie value); absent from the owned profile after the step; Keychain item deleted when the switch goes off.
5. The step respects the Find jobs deadline and says what it skipped.
6. No user-agent override or stealth flag in `browserArguments` (guard test).
7. Every mode touched (Find jobs, "Find jobs using your browser", background apply) still passes its own test. The LinkedIn read does NOT share the kept browser: it runs in its own short-lived one, only during the step (Why (#3711, 10 Nov 2026): the shared kept profile is what leaked the session to disk; an in-memory browser context would avoid disk entirely, but the owned extension cannot run there, measured).

## Test plan
- Unit: cookie filter (only the allow-listed names/host), Keychain round trip (isolated), state verdicts, search selection from strategy, deadline cut.
- E2E on the fixture server (no real LinkedIn): host-map `linkedin.com` to a local server (the existing `JOB_PILOTTO_E2E_BACKGROUND_BROWSER_ARGS` host map) serving a guest list page, a login page, a checkpoint page, a 429; fake cookie value `FAKE-LI-AT`.
- Real LinkedIn: **logged-out** probe only (done once, 31 Oct: 60 cards, no wall). Signed-in proof = the owner's own try on local main (skill try-fix-in-local-main), or a test account the owner provides. Never the owner's cookies in a test, probe or CI job.

## Non-goals
- LinkedIn's private/Voyager API; any login, password, 2FA or SMS handling; auto-apply on LinkedIn (Easy Apply); messaging, profile or feed reads; more than one LinkedIn step per Find jobs; other login-wall sites (Indeed, Glassdoor, levels.fyi, Reddit, Xing stay as they are).
- Parked, not built: per-search tuning UI, scheduling LinkedIn outside Find jobs.

## Risks
| Risk | Status |
|---|---|
| LinkedIn flags a copied session used from a headless browser (different fingerprint) → checkpoint or logout | **Unmeasured.** First signed-in try = owner's own on local main, switch on. A checkpoint ends the run cleanly; if it happens every time, the design needs an owner decision (we do not disguise). |
| LinkedIn restricts the account for automation | Accepted by the owner ("Opt-in, warned once"); pace and warning line keep it small, not zero. Existing note: `src/sources/visits_portals.py:16`. |
| Web Store review rejects the cookie read | Fallback: desktop-only extension build. |
| Guest page measured fine, signed-in page differs | Card recipe/AI judge reads whatever list arrives; unreadable page = `check`/unknown, never a guess. |

## Progress
- [x] Feasibility: honest headless loads the public search, 60 cards, no wall (31 Oct 2026) (proof: none: one logged-out probe, numbers in this spec's Risks and Safety sections)
- [x] Chrome Web Store policy read (31 Oct 2026) (proof: docs/superpowers/specs/2026-10-31-linkedin-headless-design.md)
- [x] Owner's answers, 31 Oct 2026: signed-in proof on local main; Web Store fallback desktop-only; three doors (proof: none: AskUserQuestion answers relayed by the coordinator)
- [x] Owner's yes on spec + sketch (proof: none: the owner's answers of 31 Oct 2026, relayed by the coordinator)
- [x] PR 1/3 Session: switch, ask dialog, Suggestions entry, ⌘K, consent, cookie copy → Keychain, delete on off (no reading yet; #2694) (proof: desktop/lib/linkedin-session.js @f9e9652)
- [x] PR 2/3 Reader: owned-browser LinkedIn step inside Find jobs, states, proven on stand-ins (reader #2699; the e2e suite of PR 2b became integration tests when J4 went to tier 2, 2 Nov 2026) (proof: desktop/integration/app/linkedin-read.test.js)
- [x] PR 3/3 Rules and docs: CLAUDE.md, why.md, applying.md, Decision Log row (#2709; Notion row 40a62be8-fd86-815f-b622-ccdcee530c3c) (proof: docs/rules/why.md @33fc161)
- [ ] Owner's signed-in try on local main
- [x] Sign-in window: "Sign in to LinkedIn" opens a Jobadabra window on LinkedIn's own page, cookies → Keychain, extension copy kept as a shortcut, every press logged (owner's yes 3 Nov 2026) (proof: desktop/lib/linkedin-signin-window.js, desktop/test/linkedin-signin-window.test.js)
- [ ] Owner's real sign-in through the window (unproven until then; if LinkedIn blocks it: stop, no disguise)
- [x] By-hand check of a signed-in read, 10 Nov 2026 (lt): session works, LinkedIn answers, 0 jobs kept, card silent, session left on disk (proof: none: one press, issues #3705 #3710 #3711)
- [ ] #3711 the read's own browser, deleted at the step's end, swept at start (proof: desktop/integration/extension/linkedin-session-on-disk.test.mjs)
- [ ] #3710 the read reaches its step after a redirect; 0 answered = failed
- [ ] #3705 the LinkedIn lane on the Find jobs card
