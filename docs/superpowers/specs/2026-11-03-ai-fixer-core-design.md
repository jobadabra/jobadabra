# One AI fixer core with an agent loop (design)

Session ca, 3 Nov 2026. Plan: `docs/superpowers/plans/2026-11-03-ci-agents.md` (PR 4/6 of 6).

> **Verdict:** one core takes any item (a Sentry issue, a UI finding, a feedback report, a Linear task), lets ONE agent loop read, search, edit and run named tests in the sandbox box, and opens a DRAFT PR. Sentry and Feedback move onto it with no change in behaviour first; the loop is measured on about 10 `ai-ready` Linear tasks against today's quick edit before any source switches to it.

## Decided (owner, 3 Nov 2026)
- "I agree/aprove." One AI Fixer: sources read their item and report back; one core: brief → AI edit → path walls → sandboxed tests → draft PR → Telegram line. Triggers: a schedule, `/resolve JOB-123` in Telegram (`api/brain.js`), the /admin button. One at a time, a daily cap, draft PRs only, the owner merges, UI fixer stays OFF.
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
One run at a time (`concurrency`), 3 a day (the feedback cap, shared), step cap about 30, a token cap per run read from the broker tally, scheduled lane (behind the 70% reserve), draft PRs only. A broker refusal ends the run with its reason and one alert, as every CI AI job (`lib/ai-cap.mjs`). The AI user agent's pause switch pattern: a repository variable (`AI_FIXER = off`).

## Sources
| Source | `read` | `report` | Secret |
|---|---|---|---|
| Sentry | the unresolved issue picked as today (`tools/sentry-fixer/pick.mjs`) | a comment on the issue | existing |
| UI finding | an open `confirmed` issue | a comment | none (OFF) |
| Feedback | the site's brief with GitHub's run token (audience `jobadabra-feedback`) | the card's status | none |
| Linear | a task with label `ai-ready` (team JOB) | a comment with the PR link, then move to In Review | `LINEAR_API_KEY`: a free developer key, Keychain then GitHub secret, never in code |

## Moving in, with no change in behaviour (PR 5/6)
1. Move walls, proof, leaks and publish out of `tools/feedback-ai.mjs` into `tools/fixer/` as a pure move; the existing guard `desktop/test/feedback-ai.test.js` keeps passing unchanged.
2. Feedback and Sentry call the core with the **quick edit** as their engine (the same `edit-codex.mjs` / `codex-fix.mjs` calls), so their prompts, caps and outputs do not change.
3. Add the loop beside the quick edit as a second engine; a source picks it by one value in the registry `tools/ci-agents.json` (`today: loop`), which also makes the CI Agents rows honest.

## Measuring the loop (before any source switches)
About 10 real `ai-ready` Linear tasks, each run with the quick edit and with the loop on the same brief: PR opened or not, changed tests fail before and pass after, calls, tokens, minutes, and the owner's one-word rating of each draft (merge-ready, needs work, wrong). The table goes to the owner; a source switches only on his yes. Unseen tasks only; nothing personal enters a PR, a commit or Linear.

## Not now (parked)
A UI-finding source while the UI fixer is OFF; a second concurrent run; auto-merge (never).

## Progress
- [ ] 4/6 This spec
- [ ] 5/6 `tools/fixer/` core, Sentry and Feedback onto it with the quick edit, then the loop beside it
- [ ] 6/6 Linear source, `/resolve JOB-n` in `api/brain.js`, the nightly schedule, the 10-task measurement
