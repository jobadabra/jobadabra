---
name: same-inputs-search-pair
description: Compare two code versions of Find jobs on the owner's Mac when both searches must read the same pages and get the same AI answers, so a difference of one or two jobs is told from noise. By hand, local, plan AI, fictional people only. Use when a live pair's result is inside the usual difference, when a search PR claims a small gain, or when a lost job needs its cause named.
---

# Same-inputs search pair (by hand, on this Mac)

Owner, 14 Nov 2026 (via sa): "to stronger evidences" · "let's commit it open a PR... For now it still remains a by hand, local tool". It is not a CI check and never changes "All checks passed"; the live pair on the PR still decides.

## When
- A pair's gain or loss is 0-2 right jobs and you cannot tell it from the run-to-run difference.
- A job one side lost: you need to know whether the code dropped it or a site answered differently.
- Not for timing, load or a CI stall: both sides share the same seconds, so it cannot see them.

## One command (one pair at a time on the Mac; xc or another session may be using it)
`node tools/persona-search/same-inputs.mjs <profile id> --a <ref|folder> --b <ref|folder>` (A = before, B = after; main twice is an A/A and measures the noise).
Then `python3 tools/persona-search/same_inputs_report.py <work folder it printed> <profile id>` (add `--no-judge` to skip the judge).
Options: `--no-share` (nothing shared: the baseline for the noise), `--no-ai` (pages only), `--presses 2` (a second search on the same install), `--keep` (keep the shared folder and the stores).
~3-4 min a search; the judge adds ~1 min.

## What it does and refuses
- Both sides search at the same second from one strategy draft. The first side to ask an address fetches it; the other gets the same bytes after the same seconds counted from its own ask. A byte-identical AI request is answered once (same rule). A side's own second ask is live, as in a real run.
- A ref gets its own throwaway worktree under the OS temp folder; your checkouts are never patched. The engine's data folder is a throwaway under the OS temp folder and `src/same_inputs.py` refuses any other, so the owner's app folder can never be read through it.
- Fictional people only (`search-profiles.json`); every API key and base URL is removed (the Claude plan only); EURES and LinkedIn guest are off; the shared folder is deleted unless `--keep`.
- Off unless `JOBADABRA_TAPE_SHARED` is set; the installed app drops the variables (guard `desktop/test/unit/main/same-inputs-env.test.js`). With the env unset the engine runs the old path byte for byte.

## Reading the result
- LISTED both / only A / only B: jobs in the final list. READ: jobs the search opened. RIGHT: listed jobs the blind judge (role AND place, one pass over both lists) accepts.
- A job only one side lists: the report names it; its stage on each side (`kept`, `ai_no`, `never_asked`, `not_read`) says where it was lost.
- Measured noise (14 Nov 2026, one run each, 3 people): with sharing A/A differs by 0-2 right jobs (more for d03); without it 3-10 listed jobs. A difference inside that is not a result.
- Cannot see: timing and load, the page browser and the extension (reads not through urllib), a CI stall.

## Never
- Two searches at once on the Mac (the pair is the two); a real person's data; a paid AI key.
- Reading one pair as proof: a gain is claimed only with its mechanism proven by a test (`change-find-jobs`).
