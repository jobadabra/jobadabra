# Fair EURES comparison implementation plan

**Goal:** Make EURES comparison distinguish pipeline delivery from independent discovery.
**Architecture:** An opt-in branch of Search check calls a paired Python runner through the existing Codex relay. The persona harness passes the EURES feature switch in extraEnv, preserving the app path.
**Spec:** ../specs/2026-11-10-eures-comparison-design.md
**Execution:** Inline; two PRs, site first; no live AI rerun in preparation.

## Tasks
- [ ] Add `--without-eures` to `run.mjs`, merging the switch into each engine invocation's extraEnv.
- [ ] Add `eures_comparison.py`: independent fresh installs, saved draft reuse, alternating arm order, fresh reference, combined blind judge, source contributions, exact overlap, contamination and failure reporting.
- [ ] Add the optional workflow input; keep paired results outside nightly history and Admin uploads. Upload Markdown/JSON and append per-persona summaries.
- [ ] Run the tool on offline fixtures (duplicates, missing employers, unknown judgments, contamination, failure). Run the existing EURES switch test, YAML parse and changed-file checks. Save an example report.
- [ ] Update search hub and checklists, commit, ship with the repo tool and hand off the PR.

## PR sequence
1. `[ec] 1/2 Separate EURES reference from search totals` — site accepts source categories and corrects the Night tab; owner merges first.
2. `[ec] 2/2 Compare searches with and without EURES` — public harness, optional workflow, source producer.

## Verification evidence
43 EURES reader tests pass on Python 3.12. Offline paired-run fixtures pass for both arm orders, shared draft, duplicates, missing identity, timing, contamination and failures. Workflow parsed with Ruby YAML; search map check passes. The site half passes 50 focused tests and has desktop/mobile previews. No live AI run started.
