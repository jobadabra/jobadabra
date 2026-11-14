# The PR's checks list what it waits for, and a search PR's pair starts by itself (3 PRs)

Owner, 14 Nov 2026 (relayed by sa): "why I don't see the search pair as a PR CI check?"; "when I click on 'All checks passed' … It doesn't show the e2e running. It shows just green"; asked via AskUserQuestion: "Yes, only when search files change (Recommended)", then "I want all the PRs like that, to start the pair by themselves, and to see the check at the PR level, and to see the outcome results as a PR comment".

## Design (states / one owner / verdicts)
- **Rows (1/3):** `pr-verdict.py` alone writes. One check row per counted by-hand run (the PR's e2e) on the PR's current open head, a pure function of (counted runs, the verdict's state). Rows are never required; the one required check stays "All checks passed". An ending run is looked at again until it completes.
- **One pair per PR at a time (2/3):** the pair workflow's own concurrency group replaces the older pair of a PR (`release` and `status` run on a cancel: claims back, row "superseded", grey). A head that moved only by files the search does not read keeps the numbers (the comment says which commit was measured and that it stands).
- **One starter (3/3):** the PR verdict starts the pair, once per head that changes a search file (`SEARCH_FILES`, `tools/pr-body-check.py`), at most 4 starts per PR per 24 h; people come from the body's Moves lines, never a guess (no people: the row says "pair needed: name the people"); a push that changes no search file copies the earlier row ("ran on <sha7>, search files unchanged since"). `tools/ship-search-hold.sh` keeps only the hold and loses its dispatch.

## Progress
- [ ] 1/3 #4188 rows for by-hand runs, the Details link, an ending run read again (`pr_verdict_rows.py`, `checks: write` on the verdict job)
- [ ] 2/3 one pair per PR at a time, a moved head with no search file change keeps the numbers (`search-pair.yml`, `pair.py reach`)
- [ ] 3/3 the verdict starts the pair, the row from the first workflow end after the PR is held (`pr_verdict_pair.py`; `actions: write` on the same job; ship's dispatch removed)
