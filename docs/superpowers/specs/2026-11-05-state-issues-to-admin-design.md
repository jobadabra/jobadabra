# State issues → Admin pages (5 Nov 2026)

> **Verdict:** 🟡 Six GitHub issues are not bugs: a workflow rewrites them as a store or a report. Each gets an Admin home and leaves the issue list. Two of them (noise register, verdict audit) are data stores that loops read and the owner edits, so they need a small store in the Worker first. 4 PRs, session **sa**.

Owner, 5 Nov 2026: "turn this pinned issues into dashboards/tabs/pages in Admin … and will remove them from GH issue list". Screenshot: the issue list with the six below.
Sketch (decisions with recommendations): https://claude.ai/artifact/QGFj7sciUKrWWK1o9t4m9T

## Inventory (read from origin/main, 5 Nov 2026)

| Issue | Written by | Read back by | Admin page that already has the same numbers | What the owner does in the issue today |
|---|---|---|---|---|
| #1892 Top issues (ranked) | `desktop/e2e/triage.mjs` `refreshRanking` (every Finder run) | only triage itself, to find the issue it rewrites | Self-healing: "By detector", "Trend" (not the ranked list) | reads it |
| #341 Finder scorecard | `desktop/e2e/finder-scorecard.mjs --post` (by hand, from the triage skill) | the same script, to print "change since last" (`previousOf`) | Self-healing: "By detector" (not causes, severity changes, weekly yield) | reads it |
| #274 Noise register | `triage.mjs` (appends) | `triage.mjs` (drops a known noise finding without a judge), `verdict-audit.mjs` (samples from it), `selfheal-stats.mjs` (counts) | none | deletes an entry to have it filed after all |
| #2736 Verdict audit | `desktop/e2e/verdict-audit.mjs` (Saturdays, `finder-review.yml`) | `verdict-audit.mjs` (scores last week), `selfheal-stats.mjs`, `lib/loop-quality.mjs` ("verdict accuracy") | Self-healing: "How well it does" shows the score | **ticks 👍/👎 on 5 verdicts** |
| #2097 E2E root causes · W44 | `tools/ci-intel/jobs/e2e-weekly.mjs` (Mondays) | nobody (its Telegram message links it) | **`/admin/testing/e2e`: the same numbers, one classifier** | reads it |
| #2817 `red-main` (one per red suite) | `tools/e2e_bisect.py` (opens, edits, closes) | `tools/pr-red-check.sh` (wakes the breaking PR's session, parses `Breaking PR: #n (branch b)`), `e2e_bisect.py after-run` (open list) | none | reads it; sessions react |
| #72, #1658 Release channels; #73 Top issues (old duplicate) | nobody: #2990 stopped the writer on 2 Nov | nobody | n/a | all three are **closed but still pinned** |

Not on the list today (same family, no open issue; the same store covers them when one opens): `harness-signatures` (`lib/signatures.mjs`, read by triage and selfheal-stats), `ai-budget` (`ai-budget.mjs`), `stable-canary` (`stable-canary.yml`, owner decision "fix forward or roll back").

## Design
- **One store, one owner per fact.** A new D1 table `ci_state (key TEXT PRIMARY KEY, body TEXT, at TEXT)` in `jobadabra-web`, written by CI with `SELFHEAL_PUBLISH_KEY` (`PUT /ci-state/<key>`, the same key and style as `/agent-coding/data`). Keys: `noise-register`, `verdict-audit`, `red-main`. Pages (Self-healing, a new Red main tab) read it; **no second copy**.
- **Reports are not stores.** Top issues and the scorecard are numbers computed from the real issues: they ride in the existing 3-hourly `selfheal_snapshots` body (new fields `ranking`, `scorecard`). "Change since last" = the previous day's snapshot, not a hidden block in an issue comment.
- **E2E weekly is a deletion.** The Admin e2e page already draws it; the Monday Telegram message links that page instead of an issue.
- **Owner's two interactive pieces get Admin buttons first:** verdict-audit ticks (👍/👎, saved by an owner-cookie POST like `promo-codes.js`) and the noise register's "Forget" (the issue's "delete an entry"). Same auth as the other Admin forms.
- **Red main:** the store is `ci_state/red-main` (a list: suite, since commit, breaking PR + branch, bisect trail, run). `e2e_bisect.py` writes it instead of opening issues; `pr-red-check.sh` reads it through a **public read-only GET** (suite names, PR numbers and SHAs are already public in this repo), cached like its other lookups. If the site does not answer, the hook says "red main: not read", never "green".
- **Order:** the Admin pieces and store land first (one web PR; nothing writes yet), then one public PR switches every writer and reader together, then each issue is closed with a one-line comment linking its page. An issue is never closed while anything writes or reads it.
- **A failed store read** in a loop (triage register) proceeds without it and says so in the run summary: it costs a repeated AI judgement, never a wrong filing.
- **No new gate or CI check** (tooling freeze): each PR moves an existing writer.

## Plan (4 PRs, grouped by repo; owner, 5 Nov 2026: "Too many PRs. Let's do it in 3x less PRs. In 4 PRs, max. At most 5 PRs."; `[sa] n/4 <what>`)
| n | Repo | What | Files |
|---|---|---|---|
| 1/4 | web (#419) | test-only: the grey-note test stops importing the weekly issue body | `test/unit/admin/e2e/e2e-grey-note.test.js` |
| 2/4 | public (#3263) | Monday e2e summary stops opening an issue; Telegram links `/admin/testing/e2e`; this spec | `tools/ci-intel/jobs+lib/e2e-weekly.mjs`, `e2e-weekly.yml`, README |
| 3/4 | web | **All Admin pieces at once, nothing writes to them yet:** `ci_state` table + endpoints; Self-healing cards Top issues, Finder scorecard, Judged noise (Forget), Verdict audit (ticks); Testing tab Red main | new `admin/selfheal-{top,score,noise,audit}.js`, `red-main-page.js`, `ci-state.js`, a migration; small edits in `selfheal.js`, `admin.js`, the router; one test per card |
| 4/4 | public | **Every writer and reader switches together:** `selfheal-stats` publishes `ranking` + `scorecard`; `triage.mjs`, `verdict-audit.mjs`, `lib/loop-quality.mjs`, `finder-scorecard.mjs` use the store; `e2e_bisect.py` writes red-main to it; `pr-red-check.sh` reads it | `desktop/e2e/*`, `tools/e2e_bisect.py`, `tools/pr-red-check.sh`, `e2e.yml`, `e2e-bisect.yml`, their tests |

Not a PR, after 4/4 merged: close #274 #341 #1892 #2097 #2736 #2817 each with a one-line comment linking its Admin card; unpin #72 #73 #1658. Merge order 1 → 2 → 3 → 4. 3/4 shows the owner a light + dark preview before it is committed; 4/4 gets a fresh code review (it changes the hook every session runs); if that review finds 4/4 too large, the red-main half becomes a 5th PR, never more.

## Progress
- [x] Inventory sent to mac-32 (5 Nov 2026) (proof: none: a message to the coordinator, the inventory table above is its content)
- [x] Sketch published and sent (5 Nov 2026) (proof: none: Claude Artifact https://claude.ai/artifact/QGFj7sciUKrWWK1o9t4m9T)
- [x] Owner's yes, quoted by mac-32 (5 Nov 2026) (proof: none: the owner's message "Go ahead", then "In 4 PRs, max. At most 5 PRs.")
- [ ] 1/4 web #419 · [ ] 2/4 public #3263 · [ ] 3/4 web Admin pieces · [ ] 4/4 public switch
- [ ] All six issues closed with their page linked; #72 #73 #1658 unpinned
