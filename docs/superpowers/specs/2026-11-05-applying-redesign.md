# Applying: modes made clear, 10 headless at once, a live preview that works (5 Nov 2026, session ap)

> **Verdict:** 🟢 Owner, 5 Nov 2026: "Go ahead and implement the plan. I approve it" (on the [sketch](https://claude.ai/artifact/UkiehrUepXjsV7UQJcoHc2) and its recommended
> decisions). The preview's slowness, its phone-size layout and its stuck "Try again" each have a measured cause (below). 7 PRs, each small; each UI PR still gets
> its light + dark side-by-side and the owner's yes before its UI commit.

Owner, 5 Nov 2026 (exact): "we need to have a distinguish about what session and mode does it have? Are they fully automated? are the manually
triggered" · "the live previw is not finished. It's very slow, bad performance, it doesn't show all the tiems (some times it's broken at says Try
again). Also, the zoom is not the right one. It shows the mobile viewport while it should show more the desktop one" · "the live preview should
not be shown by default, only if the user requests it. We want to be able to run 10 sessions in parallel, headless, and being very performant. We
should still show the progress in our desktop app of what's happening, live" · "We should have live udpate log, but also a form live state (which
exists already) when there is a form page" · "we should remove the "Stop extension" button. And we should add another button isntead which woudl be
"Clear all applications/sessions" or "Cancel all applications/sesssions"."

Builds on: [background-apply-execution](2026-10-27-background-apply-execution.md) (its states and safety stay), [apply-dialog-mode-design](2026-10-27-apply-dialog-mode-design.md) (`MODES`).

## What was measured (5 Nov 2026)
Scratch probe: the app's own Chrome for Testing 156, launched with the app's exact flags (`browserArguments`), a fictional local form typing
every 120 ms, one window per session as the extension opens them; plus the app's own log and saved state of the owner's 5 Nov run (read only).

| Owner saw | Cause (measured) | Where |
|---|---|---|
| Phone layout, wrong zoom | Every hidden window opens at **756 × 469** CSS px: nothing sets a window size, so sites draw their below-1024 px layout | `extension/background-session.mjs:30` `windows.create({url, focused: false})`; `desktop/lib/background-browser.js` `browserArguments` (no `--window-size`) |
| Very slow | Only one hidden window's page is `visible`; every other one is `hidden` and paints **0.2 pictures/s** (the first window 8.6/s). The owner's log, 5 Nov: `fps 0.1`, one picture 61 s old. `--disable-backgrounding-occluded-windows` makes every page visible: **8.6/s in any window** | `background-browser.js` `browserArguments` |
| "Try again" for ever | The Lufthansa session **never had a hidden tab in that run** (`launchedAt` empty): re-applying returned its old `stopped` hand-off, so it skipped the queue, and the card still asked for a live page that does not exist. GLOCK kept its old mode ("Background automation" in a Full automation batch) the same way | `desktop/lib/background-apply-store.js:34` (`if (old) return old`); `desktop/renderer/live-card.js:53` (`live: true` for every hand-off) |
| Preview open by default | The card opens the stream for every hidden session it draws | `desktop/renderer/pages/session-live.js` `drawCard` → `opener.ensure()` |
| No live progress without the preview | "What happened" is built from the Chrome-session model: its first line is "Opened the job in Chrome" for a hidden session too, and the extension's per-step reports (page kind, Apply pressed, filling, dead end) reach only the app log | `desktop/renderer/session-steps-list.js:9` |
| 10 at once not possible | The controller fills **one job at a time** (#2646, a rule from the 28 Oct design, not an owner quote); each poll reads **2 store subprocesses per open job** (~80 ms each; 1,508 calls in 30 min on 5 Nov). The extension itself already fills many tabs at once in Standard automation | `desktop/lib/background-apply-controller.js:150-160`; `background-apply-store.js:20-22`; `desktop/lib/apply.js:299` |

Cost of 10 at once (same probe, desktop size 1440 × 900, fictional form): **1 window 0.9 GB → 5 windows 1.1 GB → 10 windows 2.0 GB**, 16 % of one
core at 10 (an 8-core, 16 GB Mac). Real sites weigh more: PR 6 measures time per application, CPU and memory at 1, 5 and 10 on the recorded pages.

## Design: states, their one owner, the verdicts that change them
| State the person sees | Its one owner | Verdicts that change it |
|---|---|---|
| **How it runs** (mode chip: who fills, who submits) | the session's own `background.mode` (`check` for a Chrome session), set once when the session starts; `sessionAutomationLabel` is the one reader for list, header, log and ⌘K | none: a mode never changes on a running session (a mode change in Settings hands it over, as today) |
| **Where it is** (queued, filling, needs you, ready, submitting, applied, cancelled) | the `Background Apply` section in the store (unchanged); the list, header and card only draw it | the existing verdicts: claim, checkpoint, ready, reserve, receipt, hand-off, cancel |
| **A new run of a job** | `store.queue` | a job whose old state is a finished hand-off (`stopped`, `cancelled`, `opened_in_browser`, `app_closed`, `review_requested`) starts fresh with the new mode; only `captcha_*` and `submission_outcome_unknown` are kept (the 27 Oct owner rule this line was for) |
| **The page exists** (a live picture can be asked for) | main: the session's hidden tab is open (`pageSocket`), told to the window with each session refresh | tab opened (claim → launch), tab closed (cancel, Open in my browser, quit) |
| **Preview shown** | the person: "Watch live" on one session; at most one at a time | Watch live, Hide, leaving the session or the page |
| **What happened** (live step log) | one per-session list of steps, written by main from the extension's existing per-tab reports | each report (opened, page kind, Apply pressed, form read, N of M filled, page asked for a check, ready, submitted, stopped) |
| **How many fill at once** | the controller: every claimed job up to 10 | claim, end of a job |

Nothing reactive is added: the preview, the log and the chip only draw these states.

## Acceptance criteria
1. **Mode at a glance.** Every session row, the header and the first log line name the mode in one shared wording with an icon; a Full automation
   session never reads "Background automation". Test: one loop over the three modes and every surface (list, header, log, ⌘K).
2. **10 at once, headless, measured.** Ten queued jobs on recorded pages run together in the hidden browser, never a visible window; time per
   application, CPU and memory at 1, 5 and 10, before and after, in the PR body. The poll reads no store subprocess for a job whose cached state
   did not change. Integration test: 10 fake-browser jobs claimed in one poll; a Stop or Cancel still reaches each one.
3. **Live progress without the preview.** "What happened" shows each step as it happens (no preview open) and says "in Jobadabra's browser" for a
   hidden session; the existing form state (N of M fields, required left) stays. Integration test: the app with a fake browser sends the step
   reports; the log shows them in order.
4. **Preview on request.** No stream opens until "Watch live"; when shown: the page at 1440 × 900 (desktop layout), fitted to the card's width,
   8+ pictures/s in any window while the page changes; a session with no open page offers no preview and never shows "Try again" (it says
   why and offers Open in my browser). Tests: the store's fresh-start rule per old reason; no `liveOpen` call before the press; the browser's
   launch flags and window size.
5. **Header.** "Stop the extension" is gone from the header; "Cancel all applications" asks once ("Cancel N applications? Filled forms close;
   nothing is sent.") and ends every unfinished session, stopping the extension's work first. Test: N sessions in mixed states → all cancelled,
   Applied ones untouched, the extension told to stop.

## Plan (7 PRs, titles `[ap] n/7 …`)
1. **Desktop-size hidden pages, all of them live**: window size 1440 × 900 and `--disable-backgrounding-occluded-windows`. Before/after numbers above.
2. **A new run starts fresh**: `store.queue` keeps only the check/unknown-submit hand-offs; the card asks for a picture only when main says the page exists.
3. **Cancel all applications** in the header in place of Stop the extension (Stop stays in ⌘K and the extension's popup).
4. **Mode at a glance**: one chip (icon + words) on list, header, log and ⌘K.
5. **Live step log**: the extension's per-tab reports become the session's "What happened" lines, live.
6. **10 at once**: the controller claims every queued job up to 10; the poll uses the cached state; measured at 1, 5, 10.
7. **Preview on request**: "Watch live", fit to width, one at a time.

UI PRs (3, 4, 5, 7) each get a light + dark, wide + narrow side-by-side and the owner's yes before their UI commit.

## Decisions (owner's approval of the plan, 5 Nov 2026: the sketch's recommendations)
1. **Mode wording:** one chip on list, header, log and ⌘K: "⚡ Full automation · sends by itself", "◐ Background · you submit", "👁 In Chrome · you submit".
2. **Cancel all applications:** ends every unfinished session (filling, queued, needs you, ready) after one confirm; stops the extension's work first; Applied ones untouched; "Stop the extension" stays in ⌘K and the extension's popup.
3. **How many at once:** all of a batch, up to 10; no new setting.
4. **Preview size:** pages at 1440 × 900; the preview fits the card's width; zoom and Expand stay.

## Progress
- [x] Causes measured (probe and the 5 Nov log, above). (proof: none: scratch probe, numbers in the table)
- [x] Owner's yes on the sketch and the 4 decisions (5 Nov 2026, quoted above). (proof: none: owner decision)
- [x] 1/7 Desktop-size hidden pages, all live: 1440 × 813 pages, every one visible and drawing; without the flag the first page stops at frame 53 (positive control on Chrome for Testing 156). (proof: desktop/integration/extension/hidden-browser-pages.test.mjs)
- [ ] 2/7 A new run starts fresh; picture only when the page exists
- [ ] 3/7 Cancel all applications
- [ ] 4/7 Mode at a glance
- [ ] 5/7 Live step log
- [ ] 6/7 10 at once, measured
- [ ] 7/7 Preview on request
