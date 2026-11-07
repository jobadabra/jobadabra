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
- The app keeps the check's reads itself. Confirm carries the list of Full automation jobs the person saw; a list that differs from the app's split queues nothing.
- The Jobs dialog never writes Settings' mode; each queued item carries its own {mode, confirmation} (unchanged).

## Plan

1. `[fa] 1/2` The app holds a Full automation batch for its check: plan, the kit's stored check (injected) then live reads, split, Confirm and Cancel IPC; the window may lower a job, never raise it; asked for by the window (`checkFirst`), so today's dialog keeps working until 2/2. Test: 5 jobs → 3 queued as Full automation with the stamp, 2 as Background that the store refuses to submit; Cancel and a mismatched Confirm queue nothing.
2. `[fa] 2/2` The Apply to jobs dialog: live check (ac's `runTriage`), then the split, in every language; every Full automation batch goes through the check. Waits on ac's check prepared with the kit (its stored shape is wired into `storedCheck`) and the owner's yes on the rendered side-by-side; L2a #3556 is merged. Integration test on the app with a fake browser. The "Fill <detail> to unblock" link follows ac's L2b.
   - From the 1/2 review: the dialog handles the held answer (`check`) before `applyDialogOutcome`, which would otherwise close it as "Applying started" (`test/unit/renderer/apply-dialog-mode.test.js` asserts that for `{ok: true}`); a window caller of `applyCheckConfirm` handles `{cancelled}` (the first-choice gate's class test); the reads run only for jobs whose `read` is null.

## Progress
- [ ] 1/2 app holds the batch, split, Confirm/Cancel
- [ ] 2/2 the dialog
