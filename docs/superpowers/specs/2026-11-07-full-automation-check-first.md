# Full automation batches check the forms first, then confirm the split (fa)

> **Verdict:** a Full automation batch from Apply to jobs runs the quick form check on its chosen jobs, shows each result live, then asks one more confirmation: "We can apply to these 3 automatically. The other 2 need <mode>." Confirm queues each job with its own mode; Cancel queues nothing.

- Owner, 7 Nov 2026: "on appyling in batches, fully automated, the practice should go first, letting the user see live updates/results and letting him confirm one more time: 'As a result of "check forms" / practice... We'll be able to fill only these 3 jobs automatically. The rest need to be applied using X apply mode...'" ("practice" = the quick form check, session ac).
- Sketch: https://claude.ai/artifact/GqnMpsp8fZjidL7LMLfrbQ · the form check's sketch: https://claude.ai/artifact/6k8RX8jVPjuEKeuXy6Q167
- Owner's choices on the sketch (7 Nov 2026, relayed by the coordinator): unreadable job "Not applied, listed with reason"; Cancel during the check "End the batch, nothing queued"; all simple "Still one confirmation"; where "Inside Apply to jobs".

## Design

States of one Full automation batch, one owner (the main process's check plan, `desktop/lib/apply-check-first.js`):

| State | Entered by | Left by |
|---|---|---|
| held | Start in Full automation: the jobs are picked and their kits drafted as today, then held instead of queued (the batch's Full automation confirmation is checked first, as today) | a read, Confirm, Cancel, 30 minutes |
| checking | each `read(plan, url)`: the hidden browser's quick form check of one job of the plan; the app stores the read | the last read |
| confirmed | the person's Confirm with the list of jobs they saw under Full automation | queued (one time only) |
| cancelled | Cancel, closing the dialog, a mismatched Confirm, 30 minutes | nothing queued |

The split (`desktop/renderer/apply-split.js`, the same pure function in the app and the window) puts each job under the mode its read allows (`modeOfRead`, ac's table): `auto` → Full automation; `fill` (needs your details) → Background · you submit; `check` (captcha, login, account) → In Chrome · you submit; `none` (couldn't read, no read) → not applied, with its reason.

## Safety (CLAUDE.md "Safety → Submit")

- The existing Full automation confirmation (`autoConfirmedAt`, from Settings or the dialog pick) is asked exactly as before; this is a second confirmation on top.
- A check only moves a job down a mode, never up. Only the jobs in the Full automation group get the confirmation stamp; Background items carry none (the store's `reserve` refuses them), Chrome tabs are the person's.
- The app keeps the check's reads itself. Confirm carries the list of Full automation jobs the person saw: a job in it that the app's reads do not allow queues nothing at all; a job the app allows but the list left out is lowered to Background (the window may lower, never raise).
- The Jobs dialog never writes Settings' mode; each queued item carries its own {mode, confirmation} (unchanged).

## Progress
- [x] 1/2 app holds the batch, split, Confirm/Cancel (proof: desktop/test/unit/main/apply-check-first.test.js @fd0f52bc), merged as #3564
- [ ] 2/2 the dialog: every Full automation batch from Apply to jobs shows the live check, then the split (owner's yes on the side-by-side, 8 Nov 2026: "Ship it")
- Step a (the check prepared with the kit shows at once) landed with ac's R1, #3573: `apply-handlers.js` hands `readiness.storedCheck` to the held batch

## Plan

1. `[fa] 1/2` **Merged, #3564.** On main: `desktop/lib/apply-check-first.js` (`createCheckFirst`: `hold`, `readOne`, `confirm`, `cancel`, `splitOf`; `HOLD_MS` 30 min), `desktop/renderer/apply-split.js` (`splitBatch`, `urlsOf`), IPC `applyCheckRead(plan, url)`, `applyCheckConfirm(plan, autoUrls)`, `applyCheckCancel(plan)` (`desktop/lib/apply-handlers.js`, `desktop/preload.cjs`), `canQueue(mode, batch, jobs)` on the background controller, `openInChrome(storage, jobs)` in `desktop/lib/apply.js`. `applyCheckConfirm` is in `APPLY_ACTIONS` (first-choice gate) and `RUN_STARTS` (start-refusals guard). The hold happens only when `apply` is called with `checkFirst: true`; nothing calls it so yet.
2. `[fa] 2/2` The Apply to jobs dialog shows the check and then the split; every Full automation batch goes through it. Build it from this list alone:

| Step | File | What |
|---|---|---|
| a | `desktop/main.js` (499 lines: edit the existing `registerApplyHandlers({...})` line, add no line) | pass `storedCheck: job => storedCheck(storage, job)` from ac's `desktop/lib/apply-readiness.js` (R1, #3573) (`storedCheck(storage, job) → read \| null`; null = none, stale, kit changed or unreadable; the read already has ac's `match` merged, so `modeOfRead` takes it as is) |
| b | `desktop/lib/apply-handlers.js`, `desktop/renderer/apply-dialog-model.js` | the hold stays opt-in: the Apply to jobs dialog's Start always sends `checkFirst: true` (`which === 'auto' && options?.checkFirst === true`); a direct call (the e2e runner proofs of Full automation's own safety) queues at once, under the same confirmation |
| c | `desktop/renderer/apply-dialog-model.js` | pure: `applyDialogStart` passes a `check` answer through; a new `checkView(check, readsByUrl)` gives the dialog's groups from `splitBatch` (the same function the app uses), the headline counts ("We can apply to N jobs automatically", "The other M need another way", "K could not be read") and the Full automation urls Confirm sends |
| d | new `desktop/renderer/pages/apply-check.js` | the dialog's check and split states, one owner `state` + one `paint()` (as `jobs-triage.js`): running (Checking i of n · company, seconds, rows as they land, Cancel) → split (groups Full automation / Background · you submit / In Chrome · you submit / Not applied, each row the job and its reason, Cancel + "Apply to N jobs") |
| e | `desktop/renderer/pages/jobs-apply.js` | after Start: a result with `check` goes to `apply-check.js` before `applyDialogOutcome`. Live-read only jobs whose `read` is null, through `window.pilot.applyCheckRead(plan, url)`. Confirm calls `window.pilot.applyCheckConfirm(plan, autoUrls)`, then the result goes to the existing `applyDialogOutcome`; its caller handles `{cancelled}` and says `.error` (both class guards read the next lines). Cancel or closing the dialog calls `applyCheckCancel(plan)` |
| f′ | `desktop/lib/apply-check-first.js` `matchAll`, IPC `applyCheckMatch` | the app runs the check's one question match (L2b) on its own reads, through `matchReads` (lib/triage-match.js) and the same logged matcher as the form-check dialog, without readiness's store step, so the split shown and the one Confirm checks agree (a window-side match would make Confirm refuse every simple form) |
| f | read loop shared with ac | not done: the panel's loop reads through the held plan (`applyCheckRead`, the app keeps each read and skips the kit's ones) and the app matches, while `runTriage` reads and matches in the window; the shared part is ~10 lines. Revisit if a third reader appears |
| g | `desktop/renderer/index.html`, `desktop/renderer/style.css` | inside `#apply-dialog`: a check panel (bar, now-line, results list) and a split panel (groups); reuse the triage dialog's `.triage-progress` / `.triage-results` classes and the app's `chip`; new CSS only scoped under the new root |
| h | `desktop/i18n/catalogs/pages/*.js` (7 languages) | every new word; the reasons from `chipOf` (L2a) are reused, not reworded |
| i | tests | `desktop/integration/app/screen-apply-check-first.test.js` (probeWindow, demo `settings.demoTriageReads` for 5 jobs, as `screen-apply-triage.test.js`): Start in Full automation → rows land → split 3 / 1 / 1 → Confirm → outcomes; Cancel → nothing queued. Update `desktop/test/unit/main/apply-check-first.test.js` test "without checkFirst" (the dialog's batch holds; a direct call and a Background batch queue at once) and `desktop/test/unit/renderer/apply-dialog-mode.test.js` for the `check` answer. Unit test of `checkView`. |
| j | picture | before any commit: `npm run side-by-side` (file name starts with `fa`), the running check and the split, light + dark, narrow too; the owner's yes relayed by the coordinator with their words |

- The "Fill <detail> to unblock" link (L2c) and the detail names (L2b) come with ac's PRs; until then a Background row says "Needs your details".
- Behaviour PR touching Submit safety: one `/code-review` in a fresh subagent, asked "which existing test asserts the opposite?". Commit trailers the push gate asks for these files: `Recorded-unneeded`, `Pool-row: none …`, `Rung: none: …`, `Fixture: none: …`.
- Parked from the 1/2 review (Work board draft, Low): reads still queued after Confirm, non-automatic groups not compared, a partial success's message names no refused reason.
