# A Find jobs PR proves its own before/after (search pair)

**Verdict:** any session starts its PR's before/after on CI with one command; the PR check then asks for its `Moves:` line.
Owner, 13 Nov 2026: "But why sessions don't know to do this by themselves. No skill is telling them to do this. No PR CI guardrail is requested them a before/after"; asked via AskUserQuestion by sa: "Self-serve workflow + tighter check (Recommended)".

## PRs
1. **1/2 The pair workflow:** `.github/workflows/search-pair.yml` + `tools/persona-search/pair.py`; skills change-find-jobs and check-job-search-locally say when and how.
   `gh workflow run search-pair.yml -f pr=<n> -f people='[3, "b02"]'`: up to 3 people (night 1-18, profile ids); waits for room at the broker; main and the PR search at the same minute on one runner with one draft (a PR touching the draft's producer drafts per side, 2 searches a side); the same blind judge; one PR comment with the table, minutes per part and a ready `Moves:` line. A side whose broker wait p90 is over 20 s is not counted.
2. **2/2 The tighter check:** `tools/pr-body-check.py` reads `Moves: … pending` as red unless the PR is a draft titled "DONT MERGE"; pr-gate.yml gains the draft triggers; SEARCH_FILES gains the strategy draft's producers (each checked by import); the `Moves:` line accepts a profile id. Escapes it would have caught: #3953, #3954, #3956.

## Progress
- [ ] 1/2 The pair workflow
- [ ] 2/2 The tighter check
