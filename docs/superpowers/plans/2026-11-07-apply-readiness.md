# Apply readiness: plan (5 PRs after the owner's yes)

Spec: `docs/superpowers/specs/2026-11-07-apply-readiness-design.md`. Status: **awaiting owner yes**; nothing below is built. Each PR is titled `[ac] n/5 <what>`, carries the template's Plan progress block, and (UI PRs) its own side-by-side picture and the owner's yes before commit. A behaviour PR gets one fresh `/code-review` before ship.

L2b (#3563) is merged: it makes the match (`desktop/lib/triage-match.js`) the check's second half.

## R1 · 1/5 The step and the store (no caller changes yet)
- `src/stores/base.py:33` add `apply_readiness` to APPLICATION_FIELDS; `src/stores/sqlite.py:149` (migration + column); `src/stores/notion_rows.py:24` column "Apply readiness" (rich_text); `config/notion_schema.json` + `docs/notion-schema.md`; contract case in `tests/store_contract.py` (round trip, under 1.5 KB, empty when none).
- New `desktop/lib/apply-readiness.js`: `applyReadiness(ctx, job, {onStep})`, `storedCheck(storage, job)` (the read with its match merged; `null` when none, stale or unreadable; stale = the posting's date changed or it was closed then open), `saveCheck`. Header comment states the one-owner invariant. Kit drafting moves in from `desktop/lib/kit-handlers.js:43-71` (`prepareKitFor` becomes a thin export of it, removed in R2). Reads the form through `desktop/lib/background-apply-controller.js:277` (`triageRead`) and `matchReads`.
- IPC `applyReadiness` in `desktop/lib/apply-handlers.js`, `desktop/preload.cjs`, demo path in `desktop/lib/demo.js`. The Jobs button and dialog (`desktop/renderer/pages/jobs-triage.js`, `jobs.js`) call it; the in-memory `reads` Map is filled from `storedCheck`.
- Tell `fa` when merged: its 2/2 wires `storedCheck: job => storedCheck(storage, job)` in `desktop/main.js`'s handler context (`registerApplyHandlers`, `desktop/lib/apply-handlers.js:53`).
- Tests: `desktop/test/unit/main/apply-readiness.test.js` (kit missing, check missing, both present, stale, unreadable never stored as good), store contract on both adapters, integration `desktop/integration/store/`.

## R2 · 2/5 The old paths become callers; the guard
- `desktop/lib/apply.js:62` `draftMissing` and its callers `:300`, `:354`; `desktop/lib/kit-handlers.js:72` (`prepareKit` IPC); `desktop/lib/ready-handlers.js:146` (Ready's night also checks); `desktop/lib/job-actions-handlers.js:16-32` (`prepareTopMatches` → "Apply readiness on the top matches" calling the step; the engine's `kits` mode in `src/daily_modes.py:112` stays for Always on). Delete the three old kit paths.
- A fill that finds a different form writes the new read (`desktop/lib/background-apply-controller.js` fill start).
- ONE guard test `desktop/test/guards/rules/apply-readiness-one-owner.test.js` (first line `Guard: data — a second kit/form-read path would show a stale or missing check`): fails if any file but `apply-readiness.js` calls the kit draft or the form read. Also asserts Find jobs' args draft no kit (`desktop/lib/pipeline-args.js:47-76`, `src/daily_args.py:35`).
- Sweep the file list the guard reads (`git grep -n 'prepareKitFor\|draftMissing'`), docs/map, `docs/rules/applying.md`.

## R3 · 3/5 Names and the sweep
- "Apply readiness", "Check apply readiness", "Checking apply readiness · 3 of 8" in `desktop/renderer/index.html`, `desktop/i18n/catalogs/screens/main.js`, `desktop/i18n/catalogs/pages/jobs-final.js`, `desktop/lib/demo.js`, helpers `*-tail.js` (7 languages), ⌘K palette, notifications, `docs/superpowers/specs/2026-10-30-apply-triage.md`, `docs/map`. One grep over the old wording must return nothing; one test loops every language.

## R4 · 4/5 L2c: suggestions, Schedules row, Actions card, ⌘K
- Profile suggestion "Fill <detail> to unblock N forms" grouped by the missing fact (`read.match.missing`).
- Settings → Automation → Schedules row `settings.schedule.forms` ("Apply readiness": After each Find jobs / Once a day 08:00 / Only when I ask, default Only when I ask; this Mac only; ≤ 10 unchecked jobs per run; local timer `desktop/lib/schedule.js`); Actions card beside Find jobs; ⌘K "Check apply readiness". Each calls the one step. Picture + owner yes.

## R5 · 5/5 L2d: the first-Apply popup
- On the person's FIRST Apply / Apply to jobs press, once: "Check your jobs first?" → the step runs on the selection; Skip goes straight to Apply. Stored as shown-once in settings. Picture + owner yes. (Full automation's batch hold, `desktop/lib/apply-check-first.js`, is `fa`'s and reads `storedCheck`.)

## Small separate PR (promised to `fa`)
- `{unreadable: true, why: 'busy'}` from `background-apply-controller.js:277` when a background session is open, and its chip "the hidden browser is busy with an application" in 7 languages.

## Done when
Spec acceptance criteria 1–7 hold; the guard is green; the owner's timed 3-job run reports the time split from `triage: read finished` app.log lines.
