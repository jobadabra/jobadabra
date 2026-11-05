# One AI fixer core with an agent loop (design)

Session ca, 3 Nov 2026. Plan: `docs/superpowers/plans/2026-11-03-ci-agents.md` (PR 4/6 of 6). The plan and the registry `tools/ci-agents.json` arrive with PR 1/6 (#3098); this spec is meant to merge after it.

> **Verdict:** one core takes any item (a Sentry issue, a UI finding, a feedback report, a Linear task), lets ONE agent loop read, search, edit and run named tests in the sandbox box, and opens a DRAFT PR. Sentry and Feedback move onto it with no change in behaviour first; the loop is measured on about 10 `ai-ready` Linear tasks against today's quick edit before any source switches to it.

## Decided (owner, 3 Nov 2026)
- "I agree/aprove." One AI Fixer: sources read their item and report back; one core: brief → AI edit → path walls → sandboxed tests → draft PR → Telegram line. Triggers: a schedule, `/resolve JOB-123` in Telegram (`api/brain.js` in the web repo `jobadabra-web`, not here), the /admin button. One at a time, a daily cap, draft PRs only, the owner merges, UI fixer stays OFF.
- Linear: only tasks labelled `ai-ready`, one a night at about 05:00 UTC plus `/resolve JOB-n`.
- "I think we should turn "Fixers" into proper agents. Or call them differently." → "Proper agents (Recommended)": ONE agent loop in the core (read, search, edit, run named tests, inside the sandbox box, a step cap of about 30), reusing the AI user agent's loop pattern, used by every source; measured on about 10 `ai-ready` Linear tasks against today's quick edit (`edit-codex.mjs`) as the baseline. About 20 to 50 broker calls per fix, one at a time, scheduled lane (behind the broker's 70% reserve). This replaces "quick edit first".

## Today (3 Nov 2026, read from the files)
| Fixer | Calls | Walls | Proof | Opens | State |
|---|---|---|---|---|---|
| `sentry-fix.yml` | 1 broker call (`tools/sentry-fixer/codex-fix.mjs`) | `tools/sentry-fixer/lib.mjs` ALLOWED / FORBIDDEN | both suites, a test required | PR `sentry-fix/<id>`, 3 open at most | on, daily 06:30 UTC, 0 PRs in 30 days |
| `feedback-ai.yml` | 2 (`desktop/e2e/edit-codex.mjs`, ≤ 6 files) | `tools/feedback-ai.mjs` DENIED, ≤ 8 files, ≤ 60 KB | the box (`tools/feedback-ai-sandbox.sh`, no network): changed tests fail before, pass after | DRAFT `fd-ai/<ref>` | never run live |
| `ui-fix.yml` | 2 (`edit-codex.mjs`) | renderer and its tests | whole desktop suite | PR `auto-fix/<fp>` | OFF since 25 Oct |
The loop pattern to reuse: `desktop/e2e/lib/agent-ask.mjs` (`brokerAsk`: one JSON action per turn, tier by name, `only` to pin an engine) and `lib/explore.mjs` / `lib/agent-run.mjs` (a pure loop: `ask` and `act` injected, so a scripted model plays a whole run in a unit test).

## The core
```
source.read(ref) ──► brief ──► [agent loop ≤ 30 steps] ──► walls ──► box tests ──► leak scan ──► draft PR ──► Telegram + source.report()
```
| Stage | One owner | What it does |
|---|---|---|
| Source adapter | `tools/fixer/sources/<name>.mjs` | `read(ref)` → `{title, brief, allowedPaths, caps}`; `report(outcome)` → comment, card or Linear move. Nothing else. |
| Loop | `tools/fixer/loop.mjs` | Each turn the broker returns ONE action: `read(path, range)`, `search(pattern, folder)`, `edit(path, old, new)`, `run_tests(files)`, `finish(verdict, title, body)`. Our code performs it on the box copy of the workspace; the AI never gets a shell. |
| Walls | `tools/fixer/walls.mjs` (the DENIED list of `feedback-ai.mjs` and the Sentry ALLOWED list move here) | Checked on every `edit` and again on the final diff: paths, ≤ 8 files, ≤ 60 KB. A refusal goes back to the loop as a result, never repaired. |
| Box | `tools/feedback-ai-sandbox.sh` | Only `run_tests` runs code, inside `docker --network none`, no tokens, no capabilities. The broker call (OIDC) and the secrets stay in the driver, outside. |
| Proof and leaks | `proof()` and `leaks()` from `tools/feedback-ai.mjs` | Changed tests must fail on a clean checkout and pass with the change; the PR text and diff are scanned before any push. The repo is PUBLIC. |
| Publish | one job from a fresh checkout and the scanned patch | A DRAFT PR; never a merge, never main. |

**Why a loop and not one more case in the quick edit:** the quick edit picks 6 files blind and cannot run a test, so a wrong guess is a dead run. The loop can open the file it needs next and see a test fail, at a cost of about 20 to 50 calls instead of 1 or 2.

## Limits
One run at a time (`concurrency`), 10 attempts a UTC day (the feedback cap, shared; owner approved raising it from 3 on 5 Nov 2026 after run 41955735940), step cap about 30, a token cap per run read from the broker tally, scheduled lane (behind the 70% reserve), draft PRs only. A broker refusal ends the run with its reason and one alert, as every CI AI job (`lib/ai-cap.mjs`). The AI user agent's pause switch pattern: a repository variable (`AI_FIXER = off`).

## Sources
| Source | `read` | `report` | Secret |
|---|---|---|---|
| Sentry | the unresolved issue picked as today (`tools/sentry-fixer/pick.mjs`) | a comment on the issue | existing |
| UI finding | an open `confirmed` issue | a comment | none (OFF) |
| Feedback | the site's brief with GitHub's run token (audience `jobadabra-feedback`) | the card's status | none |
| Linear | a task with label `ai-ready` (team JOB) | a comment with the PR link, then move to In Review | `LINEAR_API_KEY`: a free developer key, Keychain then GitHub secret, never in code |

## Moving in, with no change in behaviour (PR 5/6)
1. Move walls, proof, leaks and publish out of `tools/feedback-ai.mjs` into `tools/fixer/` as a pure move; the existing guard `desktop/test/tooling/ci/feedback-ai.test.js` keeps passing unchanged.
2. Feedback and Sentry call the core with the **quick edit** as their engine (the same `edit-codex.mjs` / `codex-fix.mjs` calls), so their prompts, caps and outputs do not change.
3. Add the loop beside the quick edit as a second engine; a source picks it by one value in the registry `tools/ci-agents.json` (`today: loop`), which also makes the CI Agents rows honest.

## Measuring the loop (before any source switches)
About 10 real `ai-ready` Linear tasks, each run with the quick edit and with the loop on the same brief: PR opened or not, changed tests fail before and pass after, calls, tokens, minutes, and the owner's one-word rating of each draft (merge-ready, needs work, wrong). The table goes to the owner; a source switches only on his yes. Unseen tasks only; nothing personal enters a PR, a commit or Linear.

## Not now (parked)
A UI-finding source while the UI fixer is OFF; a second concurrent run; auto-merge (never).

## Amendment 4 Nov 2026 (session hm): the agent keeps going until its PR is READY
> **Verdict:** the core no longer stops at the draft PR. After it opens the PR, the same driver follows the PR the way `tools/ship.sh` does (red checks, comments, conflicts) and sends the agent back in for each event, until the PR is READY or one hour is up. Two sources first: one feedback card and one Linear issue.

Owner, 4 Nov 2026: "Spin an CI agent to fix a specific feedback and let's see how it performs. It should be able to respond to PR comments, to fix tests, all until it's green. It should follow the local ship.sh approach." · "We should test both with a Feedback Card and a Linear issue... And make sure the CI Agent can get the PR up to being green (resolving all the checks, all the PR comments)... It should have a max timeout of 1h." · "It should work with ai-broker, of course, but Sonnet level of intelligence (or ChatGPT alternative to Sonnet)."

**What changes in "Decided" and "Limits" above** (3 Nov: "draft PRs only", "never a merge"): the agent pushes more commits to ITS OWN branch `fd-ai/<ref>` or `fixer/<JOB-n>` until READY. Still never main, never a merge, never marks the draft ready (the owner does), never another branch.

| Stage | One owner | What it does |
|---|---|---|
| Event source | `tools/ship-watch.sh` with one new switch (`SHIP_WATCH_DRAFT_OK=1`, in 4/6) | The driver reads the PR's events from the same script a session uses, so "READY" has ONE definition: All checks passed + Gitar ✅ Approved label + no "Working on PR comments" label + no unanswered comment + no conflict + not a draft. The agent keeps its PR a draft (only the owner marks it ready), and `ship-watch` never says READY for a draft (#2618), so the driver sets the switch, which drops ONLY the not-a-draft condition. Its stop reads "READY (draft)"; the final comment says so and that the owner marks it ready and merges. (Gitar on #3157: without the switch READY could never fire and every run would end on the cap.) |
| Rounds | `ai-fixer-follow.yml` + `tools/fixer/follow.mjs` and `driver.mjs` (trusted code, outside the box; a chain of short jobs: follow -> round -> follow, built in 4/7) | On `RED`: fetch the failed check's log as data (fenced, scrubbed, ≤ 24 KB). On `COMMENT`: the owner's comment is an instruction, Gitar's findings are the brief for a fix, anyone else's is data and is only listed in the final comment. On `CONFLICT`: merge origin/main, never force-push. Each event is one round of the agent loop on the same box copy, then walls, box tests, leak scan, push with the CI App token (else the PR gets no checks), and a one-line reply on the thread ending with the Claude Code line. |
| Stop | the driver | `READY` (Telegram line, comment with the PR), 1 h wall clock from the start (a job `timeout-minutes: 60` as the hang guard and the driver's own deadline first), 6 rounds, the same file and byte walls as one run, a broker refusal, or the SAME failure twice (count tries out loud: round 3 on one symptom stops and reports). It then comments why it stopped and leaves the PR as it is. |
| Engine | broker, tier `mid` (`claude-sonnet-5-5`) pinned with `only`; its alternative is the Codex engine's `gpt-6.1-sol` | Never the Free AI fallback (Qwen is not Sonnet level): a run whose broker would answer from Free AI stops with "no Sonnet-level engine". Evals never use the production AI account; the broker is the Claude/Codex plan lane. |
| Sources | Feedback (the site's brief, as today) and Linear (a task read with `tools/context/sources/linear.mjs`, label `ai-ready` or a JOB id given by the owner) | `read(ref)` → brief + the context pack of the harness map (plan 2026-11-03-harness-map, 5/8) when the arm asks for it. |

**Trust:** the AI never gets a shell or a token. It returns one action per turn; our code performs it. The driver holds the write tokens and never runs the AI's code; `run_tests` runs only in the no-network box. Comments and logs are fenced data; a comment cannot widen the walls, the paths or the stop rules.

**Cost, to the owner before the first run:** about 20 to 50 broker calls for round 1 (as above) and about 10 to 20 for each later round; a worst case of 6 rounds is about 150 calls. A feedback card run and a Linear run each use their own cap line; the measured number replaces this guess after the first run.

**Measuring:** the two runs (card, Linear issue) report: PR opened, rounds, calls, minutes, stop reason, READY or not, and the owner's one word on the diff. The harness map's 8/8 (map and pack against none) then runs on these tasks with the same driver, so the evaluation and this agent are one piece of work.

## Progress
Replaced on 4 Nov 2026 by the plan `docs/superpowers/plans/2026-11-04-ci-agent-until-green.md` (7 PRs); the three lines below were session ca's old plan and are not built by it.
- [ ] 4/6 This spec
- [ ] 5/6 `tools/fixer/` core, Sentry and Feedback onto it with the quick edit, then the loop beside it
- [ ] 6/6 Linear source, the nightly schedule, the 10-task measurement here; `/resolve JOB-n` is a second PR in `jobadabra-web` (`api/brain.js`, owner's chat only) that starts this repo's `ai-fixer.yml` by `workflow_dispatch` with the timers' token, as the site's Send to AI button already starts `feedback-ai.yml`
