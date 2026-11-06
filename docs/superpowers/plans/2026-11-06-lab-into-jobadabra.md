# Plan: fold jobadabra-lab into jobadabra (lm)

Spec: [2026-11-06-lab-into-jobadabra-design.md](../specs/2026-11-06-lab-into-jobadabra-design.md). Four PRs, titled `[lm] n/4 <what>`.

| PR | What | Who gets what | Waits for |
|---|---|---|---|
| 1/4 | Import the lab's 72 files into `lab/`, repoint its tests at this repo's engine, run them in `tests-python.yml`, `!lab/data/` in `.gitignore`, this spec and plan. No lab workflow is active here. | the owner: one repo to read and one CI; nothing changes in what runs | nothing (gi has no lab PR) |
| 2/4 | Move 8 workflows (proposer, aliases, triage, form-learning, scout-canary, playbooks, product-brain, public-page-cases); delete pr-checks/pr-labels; guards and `ci-agents.json`. Per workflow a lab PR removes `schedule:` and this repo's PR adds it. | the owner: the same jobs, one fewer place | owner's yes on the summary; secrets table settled (`BRAIN_PROMPT_*`, `LAB_KEY`, alerts) |
| 3/4 | Move the central scout. | the owner: the employer index keeps its feeds | gi's 04:20 UTC proof line; INDEX_PUBLISH_KEY pre-flight 200 |
| 4/4 | Repoint every `jobadabra-lab` reference (this repo, jobadabra-web, lab docs, skills, memory notes), transfer the 5 issues, copy or keep the releases (owner's choice), reword the CLAUDE.md rule (owner's OK), delete the overlay tool. Then the owner archives the lab. | the owner: one name for the back-office | 2/4 and 3/4 merged and green twice |

## 1/4 — steps
1. `git filter-repo --to-subdirectory-filter lab` on a fresh clone of the lab (commit messages: `#N` → `lab#N`); copy its tree to `lab/`; check `git ls-files lab` = 72 and `diff -r` against the lab at `3ed17ab` is empty.
2. Root `.gitignore`: `!lab/data/`.
3. Repoint: `tests/test_discovery.py`, `tests/test_scout_workflows.py` read the engine at `lab/..`; the three `*.test.mjs` read `../../extension`.
4. `tests-python.yml`: `lab/**` in `paths:` and a last step (`cryptography`, `unittest discover -s lab/tests`, `node --test` on `lab/**/*.test.mjs`).
5. Tag the rewritten lab history `lab-history-2026-11-06` (owner's OK first; see the spec's History line).
6. Named tests locally: the 8 Python and 5 Node lab files; the `test_workflow_*` files; the guards the push gate names.

## 2/4 — per workflow (the switch order)
1. Lab PR: delete `schedule:` (keep `workflow_dispatch`).
2. This repo: `git mv lab/.github/workflows/<n>.yml .github/workflows/lab-<n>.yml`, `ops/` → `lab/`, `vars.OWNER_OF_JOBADABRA` → `github.repository`, add the schedule.
3. Merge lab first, then here; `gh workflow run lab-<n>.yml`; read the log.
Schedules are staggered so one merge never moves two jobs.

## 3/4 — scout
See the spec's five steps. Rollback: re-add the lab `schedule:`, remove it here.

Also in 4/4: drop the `lab/` skip in `tools/new-code-comments.mjs` and `tools/spec-proof.mjs` (TODO(AI) in both, #3334) so lab edits meet the gates.

## Progress
- [ ] 1/4 · [ ] 2/4 · [ ] 3/4 · [ ] 4/4
