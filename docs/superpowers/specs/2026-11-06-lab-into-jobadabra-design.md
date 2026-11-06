# Fold jobadabra-lab into jobadabra (short name `lm`)

> **Verdict:** the lab's code, workflows, tests, issues and secrets move into this repo under `lab/`; `jobadabra-web` stays its own repo. Nothing runs twice and nothing stops: each scheduled job is switched off in the lab in the same step it is switched on here, and the central scout goes last, after its proof.
> Owner, 6 Nov 2026: "do you think it's worth to keep jobadabra-lab separate from jobadabra repo? … I keep it public for now, before launch. And then I move everything private." → "Merging web I don't want. web I want to be separately. Only lab I want."

## Design (states, owners, verdicts)
- **Where a lab thing lives:** code and data under `lab/<same path as in the lab>` (the back-office role stays visible); a workflow file under `.github/workflows/lab-<name>.yml` (GitHub reads only the root folder); a lab test under `lab/tests/` (or beside its module for `*.test.mjs`), run by `tests-python.yml`'s last step.
- **Who runs a scheduled job:** exactly one repo at a time. The owner of that fact is the lab workflow's `schedule:` line: present = the lab runs it, absent = this repo runs it. A job moves by two PRs merged back to back: lab PR removes `schedule:` (keeps `workflow_dispatch`), then this repo's PR adds it. A one-cron gap is accepted; a double run is not (the scout twice doubles AI spend; the brain twice posts two briefs).
- **The scout's memory:** R2 first (web#457, lab#82), GitHub cache second. The cache is per repo, so a new repo starts with no cache: the restore step reads R2 (`cache-matched-key == ''`). Cache keys `central-scout-db-*` and `-early-*` and the path list stay byte-for-byte (a changed key or path loses the cache: the 2 Nov incident, memory `feedback-moving-a-job-moves-its-state`).
- **Private reads public, never the reverse** stops being a repo boundary: the lab is public until launch, then the whole repo goes private together (owner). Until then `lab/` holds nothing that was not already public in the lab repo (checked 6 Nov: the lab repo is public; `lab/data/licenses.json` lists who got a key, no keys).

## Where each lab file lands
| Lab path | Lands at | PR |
|---|---|---|
| `aliases/ proposer/ digest/ teach/ triage/ discovery/ canary/ playbooks/ prompts/ lib/ config/ data/ tests/ tools/ docs/` | `lab/<same>` (history kept, see below) | 1/4 |
| `desktop/e2e/brain-codex.mjs` | `lab/desktop/e2e/brain-codex.mjs`, then the brain workflow runs it from there (its imports of `./lib/broker-client.mjs` get a path) | 2/4 |
| `.github/workflows/*.yml` (11) | staged inert at `lab/.github/workflows/`, then `git mv` to `.github/workflows/lab-<name>.yml` | 1/4 stage, 2/4 + 3/4 move |
| `CLAUDE.md`, `README.md` | `lab/CLAUDE.md`, `lab/README.md` (the "private repo, never public" lines reworded) | 1/4 import, 4/4 reword |
| `.claude/skills/notion-map` | `.claude/skills/notion-map` (today `~/.claude/skills/notion-map` links to `~/job-pilotto-internal`, outside any repo: the owner repoints the link) | 4/4 |
| `tools/public-tree.sh`, `tests/test_public_tree.py`, `tests/test_pr_convention.py` | deleted: one repo has no overlay and no second PR convention | 4/4 |
| `.github/workflows/pr-checks.yml`, `pr-labels.yml` | deleted: this repo already has `pr-body-check.yml`, `pr-gate.yml`, `pr-labels.yml` | 2/4 |
| `.gitignore` | `lab/.gitignore` kept; the root `.gitignore` gets `!lab/data/` (it ignores every `data/`) | 1/4 |

## Workflows (11)
| Lab workflow | Trigger (UTC) | Secrets / vars | New name | Moves in |
|---|---|---|---|---|
| proposer | daily 03:47 | LAB_KEY | lab-proposer.yml | 2/4 |
| aliases | daily 03:57 | LAB_KEY | lab-aliases.yml | 2/4 |
| triage | daily 05:47 | LAB_KEY | lab-triage.yml | 2/4 |
| form-learning | Mon 06:23 | LAB_KEY | lab-form-learning.yml | 2/4 |
| scout-canary | Mon 05:17 | none | lab-scout-canary.yml | 2/4 |
| playbooks | push to `playbooks/**` | LAB_KEY | lab-playbooks.yml | 2/4 |
| product-brain | daily 05:00, Sun 16:00 | NOTION_BRAIN_TOKEN, BRAIN_BOT_TOKEN, BRAIN_CHAT_ID, BRAIN_PROMPT_*, JOBADABRA_TELEMETRY_KEY, CI_ALERTS_TELEGRAM_*, BRAIN_DATABASE_ID | lab-product-brain.yml | 2/4 |
| public-page-cases | dispatch, paths | none | lab-public-page-cases.yml; its overlay build becomes a plain checkout | 2/4 |
| pr-checks, pr-labels | PRs on the lab | none | deleted | 2/4 |
| **central-scout** | **04:20 10:20 16:20 22:20** | INDEX_PUBLISH_KEY, CENTRAL_SCOUT_SERPAPI_KEY, CI_ALERTS_TELEGRAM_*, BRAIN_BOT_TOKEN/CHAT_ID | lab-central-scout.yml | **3/4, last, after gi's proof** |

In each moved workflow: the two-checkout layout (`ops/` beside the engine) becomes one checkout and `ops/…` becomes `lab/…`; `${{ vars.OWNER_OF_JOBADABRA }}/jobadabra` becomes `github.repository`; `public/desktop/e2e/broker-relay-run.mjs` becomes `desktop/e2e/broker-relay-run.mjs`.
Guards to update in the same PR: `tests/guards/rules/test_desktop_extension_only.py` (`SERVER_WORKFLOWS` names `central-scout.yml` and `product-brain.yml`; the new `lab-` names are the back-office the owner folded in on 6 Nov), `tools/ci-agents.json` (4 entries name repo `jobadabra-lab`), `tests/tooling/ci/test_pr_verdict.py` (PR workflow list: the lab ones do not run on PRs). The `CLAUDE.md` rule "central-scout/brief workflow goes to jobadabra-lab" is reworded in 4/4 only with the owner's OK for that edit.

## Central scout: the move, step by step (gi = jobadabra-4b, 6 Nov 2026)
1. gi has no open or planned lab PR. Proof first: the 04:20 UTC lab run logs `scout memory: saved to R2` with kinds and countries kept; gi sends the line to the coordinator.
2. Pre-flight here (no spend): a manual `workflow_dispatch` that only does the R2 `GET /api/scout-memory` with this repo's `INDEX_PUBLISH_KEY` (lab's is dated 29 Sep, this repo's 21 Oct: they may differ). 200 = go; 401 = the owner re-sets the secret, never me.
3. Merge order: lab PR (removes `schedule:`) → this repo's PR (adds it) → `workflow_dispatch` once by hand.
4. First run here must log: `scout memory: restored from R2 <date>` (cache empty), the feed count within the 10% guard of the last lab run (6,833 → 3,871 is the incident this prevents), then `scout memory: saved to R2`. Carried unchanged: the R2 steps, `CENTRAL_AI_CAP: '200'`, cache keys and path list, `concurrency: central-scout`.
5. If any line is missing: re-enable the lab schedule, disable here, report. The lab workflow stays (dispatch only) until the second green run here.

## Secrets and variables (names only; I cannot read values)
All 14 lab secret names and the 3 variables already exist here, with other dates, so a value may differ. Nothing is overwritten by me.
| Name | Lab set | Here set | Used by | What is needed |
|---|---|---|---|---|
| LAB_KEY | 5 Oct | 2 Oct | 5 workflows | owner to confirm which is valid; the lab's is newer |
| BRAIN_PROMPT_BRIEF / EXPLORE / REVIEW | 2 Nov | 11 Oct | product-brain | here = old prompts. Re-run `lab/tools/sync-prompts.sh` against this repo (owner's OK; it reads `lab/prompts/*.md`) |
| CENTRAL_SCOUT_SERPAPI_KEY | 2 Nov | 26 Oct | central-scout | owner confirms or re-sets |
| CI_ALERTS_TELEGRAM_BOT_TOKEN / CHAT_ID | 2 Nov | 13 Oct | 2 workflows | owner confirms or re-sets |
| INDEX_PUBLISH_KEY | 29 Sep | 21 Oct | central-scout | pre-flight above proves it |
| JOBADABRA_TELEMETRY_KEY | 2 Nov | 2 Nov | product-brain | likely equal |
| NOTION_BRAIN_TOKEN, BRAIN_BOT_TOKEN, BRAIN_CHAT_ID | 29 Sep | 29 Sep | brain, scout | likely equal |
| AI_COST_PUBLISH_KEY, ANTHROPIC_API_KEY | — | — | no lab workflow reads them | not moved |
| BRAIN_DATABASE_ID (var) | same value here | | product-brain | none |
| OWNER_OF_JOBADABRA / OWNER_OF_WEB (vars) | same value here | | | dropped from workflows (`github.repository`) |
No org secret can be listed with my token (needs admin:org); if the owner keeps some at org level, the table above changes.

## Things that are not in git
- **Releases (2.4 GB of encrypted assets):** `net-records` (262 MB), `net-records-backup-20261017` (659 MB), `search-tapes` (1.39 GB), `search-tapes-debug` (108 MB). Readers and writers: `replay-refill.yml`, `site-replays.yml`, `journeys.yml`, `fix-verdicts.yml`, `lab-ci.yml` (the CI App token scoped to `repositories: jobadabra-lab`), `tools/persona-search/tape-store.mjs`, `desktop/e2e/net-records-fetch.sh`. Archiving the lab makes them read-only, so the writers would fail. **Decision for the owner (4/4):** (a) copy the four releases here as `lab-net-records`, … and repoint the readers (removes five App-token steps); (b) keep the lab repo alive as a data-only store (no code, no workflows) and archive nothing. Recommended: (a), after one green replay-refill and site-replays on the new home.
- **Actions cache:** only `central-scout-db-*` and `-early-*` (12 each) and Playwright caches. Not transferable; R2 covers the scout, Playwright refills itself.
- **Issues:** 5 open (#60–#64, label `fill-failure`, Greenhouse EU fields). `gh issue transfer` per issue (same owner); the label must exist here first. `triage.py` then files into this repo (`GITHUB_REPOSITORY`), found again by its body marker. **Trap:** `fill-failure` issues mix into this repo's issue list that the triage-github-open-issues skill and the Finder read; the skill gets a line to skip that label.
- **Gitar:** an org-level app; this repo is connected. Nothing to move. Lab PR labels (`Gitar: …`) are not needed for archived work.
- **Rulesets, webhooks:** the lab has one ruleset (PRs with required checks) and no webhooks; this repo's ruleset applies.
- **History:** this repo is squash-only (no merge commit, no rebase merge), so a PR cannot carry the 99 lab commits. The lab history, rewritten under `lab/` with its PR numbers marked `lab#N` (`git filter-repo`), is kept as the tag `lab-history-2026-11-06` (see the plan). The archived lab repo keeps the original too.
- **References to repoint (4/4):** 82 files name `jobadabra-lab` across this repo (workflows, `src/repos.py`, `tools/repos.sh`, `desktop/lib/repos.js`, docs, skills, comments naming a spec as `jobadabra-lab:docs/specs/…`), plus `jobadabra-web` and memory notes. Counted by `git grep -c jobadabra-lab` at each PR.

## Proof per step
| Step | Proof |
|---|---|
| 1/4 import | lab's 8 Python and 5 Node test files pass here (52 + 33 tests) and run in `tests-python.yml`; `git ls-files lab` = 72 files; no lab workflow active here |
| 2/4 workflows | per workflow: one `workflow_dispatch` here, green, then the next cron |
| 3/4 scout | the five log lines above |
| 4/4 repoint | `git grep jobadabra-lab` only in history notes; 5 issues transferred; owner archives |

## Not in scope
`jobadabra-web` structure; deleting the lab repo or its history; moving the Worker; AI spend.

## Progress
- [ ] 1/4 import `lab/` + tests in CI + this spec/plan
- [ ] 2/4 workflows except the scout (lab schedule off ↔ here on)
- [ ] 3/4 central scout (after gi's proof)
- [ ] 4/4 repoint, issues, releases, owner archives
