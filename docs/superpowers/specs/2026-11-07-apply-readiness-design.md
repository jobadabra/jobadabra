# Apply readiness: one step that gets a job ready to apply

Verdict: **approved by the owner on 7 Nov 2026** ("Yes, build it (Recommended)"; answers below), R1 in build. Today three separate paths draft a kit and a fourth (the form check, #3519) reads the form; the owner wants them to be ONE step, `applyReadiness(job)`, named "Apply readiness", run only when the person shows interest in applying. Sketch (colored, with the callers box, cost bars and decisions): https://claude.ai/artifact/WMU6BfMuEfreuEZqBDcLfM . R1 (the step and the store) is this spec's first PR; R2 waits for the Always on recommendation below.

## The owner's words (7 Nov 2026, relayed by the coordinator)
- "Basically an job (single or batch) before the applying process starts in reality, we should have the check/practice prepared (alongside the application kit)."
- "we should combine all of these 3 steps into one. One step does all 3 of them."
- Name: "And should have an unified name: Check forms / Prepare the appliaction... whatever you wanna call it" → "Apply readiness...."
- "Find jobs prepares 3 kits? That shouldn't happen. Preparing (application) kits should happen only when user manifested interest in applying." (Verified: Find jobs prepares none; `--auto-kit-max` defaults to 0, `src/daily_args.py:35`; `KITS_DEFAULT = 3` is only for the "Prepare top matches" button, `src/daily_helpers.py:101`.)
- "I do'nt think a form changes every 3 days. I think it stays stable for the whole period of the job posting being active."
- "If store is Mac/Windows only (default) then nothing is written to Notion. If the user activates Always on and chooses Notion as the backend, then everything goes through Notion."
- "the kit, like I said, it not triggered outside Apply and outside Check forms."
- L2c (Schedules row, Profile suggestion, Actions card, ⌘K) and L2d (the first-Apply popup) STAY; both call the one step.

## Problem
- A kit is drafted in three places (`prepareKitFor` `desktop/lib/kit-handlers.js:43`, `draftMissing` `desktop/lib/apply.js:62`, Ready's night `desktop/lib/ready-handlers.js:146`) plus the engine's kits mode for "Prepare top matches" (`desktop/lib/job-actions-handlers.js:16`, `src/daily_modes.py` kits_mode).
- The form check (`triageRead` `desktop/lib/background-apply-controller.js:277`, then the match `desktop/lib/triage-match.js`) is a separate action whose result lives only in the Jobs window's memory (`readOf/setRead`, `desktop/renderer/pages/jobs-triage.js`); a batch, a schedule and the Full automation hold (`desktop/lib/apply-check-first.js`) cannot see it.
- Result: the person presses Apply, waits for a kit, then the form may stop for a missing detail the check would have named first.

## Design (states, their one owner, the verdicts)
- **One step** `applyReadiness(job)` in `desktop/lib/apply-readiness.js`; its header comment states the invariant: only this file drafts a kit or reads a form for readiness.
  1. Kit missing: draft it (the engine's prepare for one job, today `prepareKitFor`, moves in).
  2. No valid stored check: read the form (`triageRead`) and match its required questions once (`matchReads`).
  3. Store both on the job's Applications record through the store layer.
  4. Return one result `{kit: {ok, error?}, check: <read with match> | null, state}`; Check statuses stay L2a's: Simple form (can apply automatically / needs your details / answers not checked), Needs you, Couldn't read, with sub-status.
- **Valid while the posting is open.** A stored check is reused until the posting is reopened or reposted, or until a fill finds the form different from the stored read (the fill writes the new read back). No timer.
- **Store decides where it is kept.** One new field on the Applications record, `apply_readiness` (compact JSON: checked-at, posting date, the read, the match; under 1.5 KB for Notion's 2000-character text), through the interface and every adapter: `src/stores/base.py:33` APPLICATION_FIELDS, `src/stores/notion_rows.py:24` (column "Apply readiness", rich_text, like "Kit inputs") with `config/notion_schema.json`, `src/stores/sqlite.py:149`, contract `tests/store_contract.py`. Default store: nothing goes to Notion.
- **Callers (every way in calls the step):** Apply on one job (`kit-handlers.js:72` IPC prepareKit and the fill's start); the batch (`apply.js:300`, `:354` draftMissing); Ready's night (`ready-handlers.js:146`); Check apply readiness (Jobs button, ⌘K, Actions card, the Settings → Automation → Schedules row); "Prepare top matches" becomes "Apply readiness on the top matches" (`job-actions-handlers.js:26`, this Mac; the engine's kits mode stays for Always on runs); the first-Apply popup (L2d); Full automation's hold (`apply-check-first.js`, `storedCheck(job)` wired by `fa`'s 2/2, reads the stored check). The three old paths are deleted, not wrapped.
- **UI names:** feature, Schedules row, Actions card: "Apply readiness"; button and ⌘K: "Check apply readiness"; live dialog: "Checking apply readiness · 3 of 8"; one log tag. Sweep "See which jobs can apply automatically", "Check forms", "form check" in `desktop/renderer`, all 7 languages (`desktop/i18n/catalogs`), the palette, notifications, `docs/map`, and `docs/superpowers/specs/2026-10-30-apply-triage.md`.

## The owner's answers (7 Nov 2026, relayed by the coordinator)
1. Design: "Yes, build it (Recommended)": 3 PRs, R1 the step and the store, R2 the callers and the guard, then L2c/L2d (the names sweep rides with R2).
2. Prepare top matches: "There should be no difference between Mac only and Always on. We should support "Apply readiness on the top matches" for Alwyas on, as well." One step and one result in both; no separate engine kit mode that skips the check. **Open, before R2 touches it:** how Always on with no Mac runs the check (the cloud run's own browser, or the Mac's hidden browser when it comes online), what it costs, one recommendation to the owner. R1 does not wait on this.
3. Ready's night: "Yes, kit + check (Recommended)".
4. Reposted posting is read again; a fill that finds a different form writes the new read (decision 3 of the sketch, unchanged).

## How R1 reaches the store (found while building)
The desktop never opens the tracker; it calls the engine's store CLI (`desktop/lib/store/engine.js` → `python -m src.stores call applications get|update`). So R1 adds no engine mode: `apply_readiness` is a field of `src/stores/base.py` APPLICATION_FIELDS (all adapters, the Notion column "Apply readiness"), the Jobs rows carry it (`src/desktop_jobs.py`), and `desktop/lib/apply-readiness.js` reads and writes it through that call. Freshness is the posting date (`posted_at`) the check was made for; a closed-then-open posting with the same date is not detected yet (TODO(AI) in the step). A simple form is stored only after its question match; an unreadable read is never stored.

## Acceptance criteria
1. Pressing Apply on a job with no kit shows the check result before the fill starts; the kit and the check come from one call.
2. Find jobs drafts no kit and reads no form (assert the engine args and the app's calls).
3. A job checked once is not read again while its posting is open; a reposted posting is read again; a fill that finds a different form stores the new read.
4. Default store writes nothing to Notion; with Always on + Notion the field is in the Applications row; every adapter passes the same contract test.
5. ONE guard test fails if any file other than `apply-readiness.js` calls the kit draft or the form read directly.
6. Old wording is gone (grep over the sweep list returns nothing); a test loops over every language.
7. Cost shown to the person is measured: about 20 s per missing kit, 3–5 s form read, 5–12 s posting read, one page-kind AI call per new page shape, one batched match call per run.

## Non-goals
- No change to what Full automation may submit, to the Submit safety rules, or to L2a's statuses. No kits from Find jobs. No timer-based re-read. No new AI step beyond the existing page-kind and question-verdict calls. Radio-group questions stay parked (needs the page sketch to carry the group's question).

## Progress
- [x] L1 light read (#3548) and L2a three statuses (#3556) (proof: desktop/lib/triage-reader.js @f0b711f)
- [x] L2b match (#3563, merged 7 Nov 2026) (proof: desktop/lib/triage-match.js @30ff290)
- [x] Owner's yes on the sketch (proof: none: the owner's answers are quoted above, relayed by the coordinator 7 Nov 2026)
- [x] R1 the step and the store (#3573, merged 7 Nov 2026) · [ ] R2 the paths become callers + the guard (held: the hang below) · [ ] L2c · [ ] L2d
- Plan: `docs/superpowers/plans/2026-11-07-apply-readiness.md`. `fa`'s Full automation hold (`2026-11-07-full-automation-check-first.md`) consumes `storedCheck(job)` from R1.

### Handoff (session ac, 8 Nov 2026 ~06:45 UTC)
- **State:** #3578 (red-main fix) and #3585 (the Jobs-check e2e step reads its own toast, try 1 on that flake) merged; after-merge e2e on 36abf1d green (apply-1/2/3of3). This branch `ac-read-ends` (no PR yet) holds option A, owner-approved picture ("Yes, ship it"): the Jobs dialog shows each read's step and seconds plus the job title, and a quiet read ends in 30 s with its reason. It is held because the coordinator asked for the hang's root cause first.
- **The hang (owner: "we fixed this type of bugs tens of times. Why it's still there?"; owner picked "Local test first", then "Watch one press, then fix"):** 11 of 11 Jobs-check reads in the live-test twin on 8 Nov 2026 (`Job Pilotto (live test)/home/logs/app.log`) ended `ended-without-report` at 150 s. Each was handed out (`take()` marked opening, queue 5-33 s), but the twin's hidden browser logged no page step for any of them (0 `[extension]` page lines; its own `jp-decisions` show only two worker restarts). Try count 3:
  1. Disproved: "Apply moves the tab and the read is lost". `desktop/integration/extension/triage-read-apply-moves.test.mjs` (this commit) runs the real owned extension: same tab, new tab by link, `window.open`, each reports the form in 2-7 s.
  2. Disproved: "old sessions handed to the person block the read". The same test seeds the twin's 4 stale `manualRequired` rows; the read still opens.
  3. Open: the twin's hidden-browser worker runs with `__jobadabraBackgroundOwned` **undefined** (a fresh copy has it), though its `owned-bootstrap.js` on disk sets it; it polls every ~30 s (seen live, 06:34-06:40 UTC, 200 answers). Unknown: what it does with a read command.
- **Next step:** the owner presses "See which jobs can apply automatically" (1 job) in the twin while `node .handoff/ro-watch.mjs <the twin hidden browser's DevToolsActivePort> <log> 360` (in this worktree, not committed) listens read-only (targets, worker console, requests: route + action). Where the read dies is the root cause; fix with a test that plays it, then ship option A with the guards and a `Design:` block (one owner of a read's end; every hidden-page reader ends in a look or a reason). Then R2, including the owner's ask "I should have the other 2 modes for each job, in the options menu" (owner chose "Inside R2"; picture first).
- **Elsewhere:** session jobadabra-92 ("ab") fixes Apply to jobs starting nothing after drafting kits and Full automation's "Press Find jobs first" on all-ineligible jobs (owner: "they were not eligible. BUt it should be stated more clearly, eventaully").
