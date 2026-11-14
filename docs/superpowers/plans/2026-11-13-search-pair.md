# A Find jobs PR proves its own before/after (search pair)

**Verdict:** any session starts its PR's before/after on CI with one command; the PR check asks for its `Moves:` line, and the hold is set and lifted by the tools.
Owner, 13 Nov 2026: "But why sessions don't know to do this by themselves. No skill is telling them to do this. No PR CI guardrail is requested them a before/after"; asked via AskUserQuestion by sa: "Self-serve workflow + tighter check (Recommended)".

## PRs
1. **1/2 The pair workflow:** `.github/workflows/search-pair.yml` + `tools/persona-search/pair.py`; skills change-find-jobs and check-job-search-locally say when and how.
   `gh workflow run search-pair.yml -f pr=<n> -f people='[3, "b02"]'`: up to 3 people (night 1-18, profile ids); claims its room at the broker (2 searches per person; first come, first served); main and the PR search at the same minute on one runner with one draft (a PR touching the draft's producer drafts per side, 2 searches a side); the same blind judge; one PR comment with the table, minutes per part and a ready `Moves:` line. A side whose broker wait p90 is over 20 s is not counted.
2. **2/4 The tighter check:** `tools/pr-body-check.py`: (14 Nov 2026: the red for a ready PR with a `Moves: … → pending` line is gone, the pair's row holds "All checks passed" instead, `tools/pr_verdict_pair_gate.py`); the line accepts a profile id and "usual difference not measured yet"; SEARCH_FILES gains the producers of a first search's words and places (strategy draft, places, fragment words, board ideas, search settings). Escapes in 30 days: #2977, #3857.
3. **3/4 Draft until ready:** `tools/ship*` opens every PR as a draft and marks it ready only when it prints READY (checks green, Gitar ✅ Approved, no unanswered comment); a push that loses READY puts it back to draft; a "DONT MERGE" title is never flipped. Owner, 13 Nov 2026 (via sa): "let's close these gaps"; outcome: any non-draft PR is safe to merge.
4. **4/4 The hold by itself:** a "pending" Moves line makes ship set draft + "DONT MERGE" (with the label search-hold, not a hidden marker: a refreshed body would drop it) and dispatch search-pair with the line's people; the pair writes the numbers into the line and lifts ship's own hold when valid with no loss beyond the usual difference; an invalid pair reruns once, then reports; a loss keeps the hold with why. Owner (via sa): "we shoulndt do by hand".
- Also merged: #3960, the pair compares the PR with the main commit it sits on.

## Progress
- [x] 1/4 The pair workflow (#3957) (proof: .github/workflows/search-pair.yml @0086082e)
- [x] 2/4 The tighter check (#3963) (proof: tests/tooling/ci/test_pr_moves.py @63f04b8)
- [x] 3/4 Draft until ready (#3965) (proof: tests/tooling/ci/test_ship_watch_draft.py @e3974be)
- [x] 4/4 The hold by itself (this PR) (proof: tests/tooling/ci/test_search_hold.py)
- Also merged: #3966, a night or profile round no longer holds a pair.
