---
name: investigate-e2e-reds
description: Find why an e2e suite keeps going red over days (the circle), not why one run failed - list every red of the suite on main in a window, read each one's cause from its artifacts, group by cause and day, find the feature or input behind the biggest group, check flakiness on the same commit, name which check let it through, then a sketch with a root-cause table and the one structural decision for the owner, and one owner per fix. Use when the owner says "apply e2e failed too many times", "why are we going in circles", "why does <suite> keep failing", "investigate the e2e reds", "consult Admin → Testing", or after a 2nd red alert of one suite in a week. For fixing one red, use fix-failing-e2e.
---

# Investigate e2e reds: why a suite keeps going red

Why this exists (owner, 10 Nov 2026, on a 3rd "apply · red on main" alert in two days: "apply e2e failed too many times in the last few days. Pleas consult the data in Admin -> Testing ... And see why we're going in circles. Why it's failing so many times. And how we can prevent it. how we can fix the root cause"; then "Let's save this as a skill").
The investigation that night: 49 red apply suites on main since 2 Nov; 23 of the 44 readable were one feature (the Jobs check / Apply readiness), changed 6 times in 4 days (#3527, #3578, #3585, #3615, #3630, #3637) while product PRs ran no e2e; 9 were Electron's download failing (504) at launch on Mac runners. Outcome: the owner chose "a PR touching covered files runs only the e2e steps that cover them". One wrong hypothesis on the way (below, step 5) is the reason step 5 exists.

`fix-failing-e2e` fixes one red. This skill finds the pattern across many, so the fix lands on the cause of the pattern.

## 1. Every red of the suite, on main, in the window (facts from GitHub)
Window: the last 7-10 days. Main only (PR reds are the PR's business). All workflows that run the suite: after-merge, beta, RC soak, night burn-in, scheduled checks.
```bash
S=<scratch>; R=jobadabra/jobadabra
# gh run list --created was unreliable (returned 1 row); the API with pagination is not:
gh api -X GET repos/$R/actions/runs -f created='>=YYYY-MM-DD' -f status=failure -f per_page=100 --paginate \
  --jq '.workflow_runs[]|"\(.id)\t\(.created_at[0:16])\t\(.head_branch)\t\(.head_sha[0:7])\t\(.name)\t\(.display_title[0:60])"' > $S/red-runs.tsv
awk -F'\t' '$3=="main"' $S/red-runs.tsv | cut -f5 | sort | uniq -c | sort -rn      # which workflows
# the suite's red jobs (name starts with the suite, e.g. ^apply covers apply-1of3 and applyflows-2of3):
cut -f1 <filtered runs> | while read id; do gh api repos/$R/actions/runs/$id/jobs --paginate \
  --jq ".jobs[]|select(.conclusion==\"failure\" and (.name|test(\"^<suite>\")))|\"$id\t\(.id)\t\(.name)\t\(.started_at[0:16])\""; done > $S/reds.tsv
```
Count reds per job name and per day. Say the total ("49 red apply suites since 2 Nov") before any cause.

## 2. One cause line per red, read from its artifacts
- First choice: the job's `suite-failures.json` (`suite`, `step`, `message`): `gh run download <run> -R $R -D <dir> -p '*<job name>*'`. It is slow (the artifact carries videos and logs; ~45 downloads took over 10 minutes): run it in the background with `tee`, and work on what has landed.
- No file (cancelled, launch failure, older run): search the whole job log for known phrases, one category each: `gh run view --job <id> -R $R --log | grep -q '<phrase>'`. Don't grep `--log-failed` for "✗"/"Error": it returns the step's script and env lines (`E2E_AI_ANSWERS: off`, `repository: …`), not the failure.
- Cross-check with Admin → Testing (`curl -sL -H "Authorization: Bearer $(security find-generic-password -s job-pilotto.site.api_key -w)" https://www.jobadabra.top/admin/testing/e2e`, strip tags): "Top 5 suites" (reds, main cause), "Biggest breaks · one cause, many red suites", "Red runs", "Not fixed yet". A big "Not fixed yet" / "Not named yet" share means the page cannot answer the question: your per-red read is the answer, the page is the cross-check.

## 3. Group: cause × day, then the biggest group's feature
- Categories: the step's feature (the app area its step tests), CI/infra (launch, download, runner), AI (credit, stored answer missing), other. Per day, so a burst (one PR) reads differently from a steady rate.
- For the biggest group: `git log origin/main --since=<window start> --format='%h %ad %s' --date=short -- <the steps' lib files> <the feature's app files>`. Product changes to the feature + test-only fixes to its steps, interleaved, is the circle. Count both.

## 4. Flaky or not, on the same commit
Find a green and a red of the same step on the same commit (e.g. the after-merge run green and the night burn-in red on 768e92b). Same code, different result = flaky: say so first and name the non-deterministic input (runner load, the hidden browser, a race, the outside world), per the golden rule in CLAUDE.md.

## 5. Prove the cause from the logs, not from a coincidence
A constant that changed near the first red is a hypothesis, not a cause. Read the red's and a green's `logs/app.log` at the step, side by side, and check the hypothesis against the timeline: did the test hold the page, or did the app never ask for it? For the Jobs check, the read lines carry the answer: `triage: read finished {"outcome", "last", "queueMs", "openMs", "quietMs"}` plus the `[visit]`/`[extension]` lines between `opening` and the end.
Why: on 10 Nov the coordinator blamed the 30 s quiet rule (#3615, `SILENT_MS`) because the red showed `quietMs 30003`; the pane's read of the same log showed the step had released the page within one poll and the restarted hidden browser never requested it. Changing the step for the 30 s rule would not have saved that run. Call it a hypothesis until a log line or a failing test shows it; count tries out loud.

## 6. Which check let it through
For each group: where would it have been caught before merge, and why wasn't it? (Product PRs run no e2e; a Python-only PR skipped a desktop-only test; the cache didn't cover Mac.) A fix there is a gate only if it pays: count the escapes it would have caught in the last 30 days (≥2), by PR number.

## 7. Report: one sketch, one decision, one owner per fix
- A Claude Artifact (colored, per the CLAUDE.md sketch rule): verdict band with a stacked split by cause (counts), a stepper of the circle (date → PR → red), a root-cause table (Cause · Root · Fix · Who), and the decision with its escape count.
- The one structural decision goes to the owner through AskUserQuestion with a recommendation. Fixes that need no decision start at once, one owner each (a session or pane with a brief), with a `Design:` block first when the area has 3+ fixes in 7 days.
- Terminal reply: the table of causes with counts, what each owner is doing, what changed in the coordinator's own earlier claims (corrections said plainly).
