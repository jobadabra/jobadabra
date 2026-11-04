---
area: feedback
paths: [tools/feedback-ai.mjs, tools/fixer, tools/feedback-ai-sandbox.sh, tools/feedback-released.mjs, tools/sentry-fixer, tools/fixer-brief.mjs, tools/ci-agents.json, desktop/e2e/edit-codex.mjs, desktop/e2e/lib/severity.mjs, desktop/e2e/lib/triage-findings.mjs, desktop/lib/app-feedback.js, .github/workflows/feedback-ai.yml, .github/workflows/sentry-fix.yml, .github/workflows/ui-fix.yml, .github/workflows/ui-findings.yml]
updated: 2026-11-04
---
# Feedback and fixers
> People's feedback, Sentry crashes and the UI Finder's findings reach AI fixers that open DRAFT pull requests; the owner merges. One shared fixer core with an agent loop is being built.

## Rules
- Draft PRs only, never a merge, never main; at most 3 a day, one at a time. The UI Fixer (`ui-fix.yml`) stays OFF; only the UI Finder runs. Auto-merge of fixer PRs stays off.
- The repo is public and the AI reads text strangers wrote: the AI's code runs only in the no-network box (`tools/feedback-ai-sandbox.sh`), tokens stay in the driver, PR text and diff are leak-scanned (`leaks()`, `prText()` in `tools/fixer/leaks.mjs`).
- Walls: allowed and denied paths, at most 8 files and 60 KB; a refused change is final, never patched up afterwards.
- Proof: the changed tests must fail on a clean checkout and pass with the change (`proof()`); a fix without a test is not opened.
- Severity is what the person feels: high blocks the journey, medium confuses or needs a workaround, low is barely noticeable; a wording change is low. Enforced in `desktop/e2e/lib/severity.mjs`.
- The Sentry fixer takes only real, fresh, non-one-off issues without an open PR (`tools/sentry-fixer/lib.mjs`); end-to-end runs never count.
- Every AI step here runs through the broker on the owner's plan, never an API key ([ai hub](ai.md)).

## Key files
- `tools/feedback-ai.mjs`: the command line of the "Send to AI" run (`feedback-ai.yml`); the code it uses lives in `tools/fixer/`: `walls.mjs` (denied paths, caps), `proof.mjs`, `leaks.mjs`, `publish.mjs`.
- `tools/sentry-fixer/`: `pick.mjs` chooses the issue, `codex-fix.mjs` asks for the edit, `lib.mjs` holds the decisions.
- `desktop/e2e/edit-codex.mjs`: the quick edit (two broker calls, no tools) that the Finder's self-review and the UI fixer use.
- `desktop/e2e/lib/triage-findings.mjs`, `severity.mjs`: how Finder findings are judged and graded.
- `desktop/lib/app-feedback.js`: "Send feedback" in the app; `tools/feedback-released.mjs` tells reporters which build carries their fix.
- `tools/ci-agents.json`: the registry of CI agents (what each starts on, what it acts on).
- More: `node desktop/scripts/codemap.mjs sentry fixer feedback`.

## Live specs
- [AI fixer core](../superpowers/specs/2026-11-03-ai-fixer-core-design.md): one core, four sources, an agent loop measured against the quick edit.
- [CI agents plan](../superpowers/plans/2026-11-03-ci-agents.md): registry, admin tab, fixer core PRs.
- [Finder precision and recall](../superpowers/specs/2026-11-01-finder-precision-recall-design.md): fewer false findings, more real ones.
- [AI user agents](../superpowers/specs/2026-11-03-ai-user-agents-design.md): agents that use the app like a person and file findings.

## Ask the sources
ask: sentry issues is:unresolved environment=production
ask: github issues label=confirmed state=open
ask: github prs head=sentry-fix OR fd-ai OR auto-fix state=open
ask: linear issues team=JOB label=ai-ready

## Lessons
- A money gate must never switch a finder off silently: when its AI credit ran out it filed almost nothing for days. Read the latest run log for "Skipped: the AI limit" before tuning detectors.
- Scripted end-to-end suites found most of the real UI bugs; AI screenshot review and real users found few. Keep the scripted layer first (`desktop/e2e/README.md`).
- A fixer that cannot run a test guesses blind: that is why the agent loop is measured before any source switches to it.
- A fix PR needs the owner's scenario as its test; read the existing tests for one that asserts the opposite.

## Go deeper
[change loop](../rules/change-loop.md) · [rounds](../rules/rounds.md) · [Finder README](../../desktop/e2e/README.md) · [agent coding SDLC](../superpowers/specs/2026-11-01-agent-coding-sdlc-design.md)
