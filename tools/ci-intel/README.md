# CI intelligence: the collectors of this repo's own CI

> **Verdict:** four hourly/weekly jobs read this repo's CI (runs, artifacts, merged PRs, `desktop/e2e/lanes.json`) and publish what they find to the site's `/admin` pages. They live here, beside the tests they measure (owner, 2 Nov 2026).

| Workflow | Job (`jobs/`) | Publishes to | Secrets |
|---|---|---|---|
| `e2e-intel.yml` hourly :41 | `e2e-intel.mjs`, then `gtm-readiness.mjs` | `/e2e/data`, `/gtm/data` | `SELFHEAL_PUBLISH_KEY`, `E2E_CAUSE_CF_ACCOUNT`, `E2E_CAUSE_CF_TOKEN` |
| `integration-intel.yml` hourly :17 | `integration-intel.mjs` (+ `coverage-intel`, `clock-moved-intel`) | `/integration/data` | `SELFHEAL_PUBLISH_KEY` |
| `ops-overview.yml` hourly :17 | `ops-overview.mjs` | `/ops/data` | `SELFHEAL_PUBLISH_KEY` |
| `e2e-weekly.yml` Mondays 07:23 | `e2e-weekly.mjs` | one GitHub issue here + Telegram | `SELFHEAL_PUBLISH_KEY`, `CI_ALERTS_TELEGRAM_*` |

- `jobs/`: read GitHub with `gh`, build rows, PUT them. `*-rows.mjs` hold the pure part.
- `lib/`: pure parsing and validation the jobs share (causes, work split, scorecard, window of days, categories). No network, no clock but `now`.
- **The line:** this folder imports nothing from `jobadabra-web`. The site's pages, Worker handlers and D1 tables stay there and import these modules from the public tree ("private reads public, never the reverse").
- Tests: `desktop/test/ci-intel-*.test.js` (run by `tests-desktop.yml`, which starts on `tools/ci-intel/**`). The page-drawing and Worker-ingest tests stay in `jobadabra-web`.
- Run one by hand without publishing: `GH_TOKEN=… node tools/ci-intel/jobs/ops-overview.mjs --dry`.
