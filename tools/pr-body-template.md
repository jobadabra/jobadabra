🟢 <one line: what changed for the user or for us, in plain words>

**Why:** <the incident, measurement or owner request behind it>
**Unblocks:** <exactly what this solves or lets happen next: a PR, a session, a number, a person's step>
**Root cause:** <a fix only, else delete this line: the cause in one sentence (file:line, log line or measurement); why this is not a symptom patch; what let it through (the rule, test or check that missed it)>
**Design:** <a fix that is the 3rd fix PR on the same files in 7 days, else delete: the states, their one owner, the verdicts that change them>
Moves: <a PR that changes a search file (src/sources, src/press, first_jobs, daily_search*, place/title triage, slots, time_budget, job_rank), else delete: `Moves: p<n> <number> <before> → <after> (1 run a side, same minute, usual difference <d>)` or `Moves: nothing (<why>)`>

| Area | Impact | How |
|---|---|---|
| 👤 Real users | 🟢 High / 🟡 Medium / ⚪ Low / — None | <what a real user gets> |
| 📝 Form filling | 🟢 High / 🟡 Medium / ⚪ Low / — None | <fields, forms, wrong answers> |
| 📊 Admin data accuracy | 🟢 High / 🟡 Medium / ⚪ Low / — None | <which page or number is truer> |
| 🔁 Offline replays | 🟢 High / 🟡 Medium / ⚪ Low / — None | <recordings, refills, verdicts> |
| 🧪 Tests & harness | 🟢 High / 🟡 Medium / ⚪ Low / — None | <what the tests now catch> |
| ⚡ Development speed | 🟢 High / 🟡 Medium / ⚪ Low / — None | <time or runner slots saved> |
| 💰 Cost | 🟢 High / 🟡 Medium / ⚪ Low / — None | <AI or CI money, + or -> |

- ✅ <2-4 short bullets: what changed, a few words each>

| | Before | After |
|---|---|---|
| <the measured or seen difference> | <before> | <after> |

**Plan progress**
<a PR from a plan, else delete this block: the plan names every PR from the start; the title reads "[xx] n/N <what>" (ship.sh --title="n/N <what>"); CI refuses n/N without this block>
Plan: `docs/superpowers/plans/<topic>.md` (or the spec holding the PR list)

| Plan | PRs |
|---|---|
| ✅ Done | 1–10 of N: <a few names> |
| ▶️ This PR | 11: <its name> |
| ⏳ Left | 12–N: <the next 2-3 names>, … |

**Design system (measured on <sha>)** ✅ all <N> rules pass on <N> screens
<desktop window changes: from desktop/, `npm run design-check -- --screens <the screens you changed>` on the committed change prints this block (spacing, primary buttons, ghost buttons, cards, clipping, contrast at 640 and 1100 px, light and dark); paste it here as printed. All passing is this one line (plus a `vs main: ghost 40 → 31 ▼9` line when a rule's count moved); a failure is `⛔ N new problems` and a table of only the failing cells (rule, screen, count, what): a problem main's render does not have, fix it. A PR that draws nothing says "No visible change: <why>" below and needs none>

<When a screen changed: every image in this table, one row per change; or: No screenshots: <why> (never for a site page: a change to web/public or admin html/css/js needs images of the changed section, live page vs your branch, or the line `No visible change: <why>` when it draws nothing; never shoot a page the change does not touch). A PR in the private site repo (jobadabra-web) hosts its images there: `node tools/pr-assets.mjs pr-assets-<branch> <png>... --repo=jobadabra/jobadabra-web`. Shoot a site page with `tools/site-run.sh node tools/page-shot.mjs --path /admin/<page> --width 1440,390 --seed <name> --clip '<the changed card or section>' --out <dir>` there (real Worker, demo data, refuses an unstyled page); the printed `github.com/<repo>/raw/<tag>/<file>` URLs render in a private repo, raw.githubusercontent.com ones do not.
Caption = what changed and where to look (a few words); crop to the changed card and frame the change: `npm run shot -- <page> --select '<card>' --mark '<changed control>'` (same options for before and after). A new screen: "—" before, the reason in the caption.>

| What changed | Before | After |
|---|---|---|
| <e.g. Availability card: "Start date" now sits under the dropdown> | ![before](<url>) | ![after](<url>) |
