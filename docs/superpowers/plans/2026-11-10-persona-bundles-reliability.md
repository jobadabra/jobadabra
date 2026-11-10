# Persona bundles and reliability implementation plan

Goal: make new persona findings replayable and reduce wasted tokens, targeting one confirmed bug per 100k gross tokens.
Spec: `docs/superpowers/specs/2026-11-10-persona-bundles-reliability-design.md`.
Execution: inline, one PR; focused tests only, no paid runs. Existing 7 Nov plan step 4 is completed for persona filing here; auto-close remains out of scope.

1. Add privacy regression cases to tester-mode tests: two captures retain their own screenshots/state, an unknown capture cannot reuse held evidence, a failed upload can retry. Implement bounded capture tickets in feedback-handlers, keyed only inside the tester app.
2. Add persona helper for trusted launch env, capture and selected-note send. Wire suite env, note capture, finding bundle and Finder normalization/labels. Guard fake credentials/replays and verify the stored link reaches issueBody with an offline uploader.
3. Reuse screen reader to check completion against steps/observations; downgrade unverified worked and unsupported bug verdicts. Prime the isolated CV picker; omit actions requiring jobs when no rows exist, using exact palette command identities.
4. Add money guard for cached gross usage; keep incremental cap and add gross cap. Scope goal knowledge, join notes before judge, avoid low-severity judge calls. Run focused tests RED then GREEN.
5. Review the diff in a fresh reviewer, fix material findings, run affected-test selection and cheap gates, commit and ship through tools/ship.sh. Owner merges. No claim of measured 100k yield until real scheduled results exist.
