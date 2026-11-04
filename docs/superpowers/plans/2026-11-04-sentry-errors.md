# Handle the Sentry errors (se)

Owner, 4 Nov 2026: "let's start a new session … to handle all the sentry errors"; "Which is noise, let's fix the noise. Which are already fixed, let's mark them as fixed… Which are real product bugs, let's fix the product bugs… starting from the most occuring ones".

Verdicts for the 141 unresolved issues of `job-pilotto-app` (read 4 Nov 2026), ranked by events. PRs below are named up front; the list grows only by a note here.

## Progress
- [ ] 1/3 CI e2e stand-ins' refusals are marked planted, so they stop reaching Sentry as AI-limit / AI-call-failed issues (the biggest family, ~1,900 events, almost all `environment:e2e`)
- [ ] 2/3 A run stopped from outside, or that ended with a note, is not reported as `run_failed` with its last log line as the error (4X, 4T, 4H, 4C, 4J, 3A, 4E, 3X)
- [ ] 3/3 Notion run-history row refused for a 2001-character text (4W): cause not proven yet; the PR names it or parks it
- Resolved in Sentry with a named released fix (no PR needed): 4N 4M 4K 2X 14 1D 23 2N 21
