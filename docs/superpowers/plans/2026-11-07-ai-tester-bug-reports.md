# AI tester bug reports: plan (7 Nov 2026, short name fb)

Spec: [2026-11-07-ai-tester-bug-reports-design.md](../specs/2026-11-07-ai-tester-bug-reports-design.md). Issue: #3364. PR titles `[fb] n/5 <what>`.

## Progress

- [ ] 1/5 Spec and plan (this PR; docs only)
- [ ] 2/5 `jobadabra-web`: bundle store `POST /agent/bundle` + Admin page `/admin/bug-bundle/<id>` by link (site first: nothing writes yet)
- [ ] 3/5 App: tester mode + the bundle (job-tab picture, ±5 min logs, session record + job row, versions, mode chip) sent to the tester route
- [ ] 4/5 Persona filing: bundle id on the finding, issue sections and labels, `source:persona` / `source:desktop-tester`, two clean nights close a persona issue (waits on the persona step-plan fix)
- [ ] 5/5 Twin `--replay <id>` + the testing skill's "How to report" (skill text in the PR body; the owner rebuilds the zip)

## PRs

| PR | Repo | Who gets what | Files (expected) | Proof |
|---|---|---|---|---|
| 1/5 | jobadabra | A reviewed design every later PR links | the spec, this plan | docs only |
| 2/5 | jobadabra-web | A bundle can be stored and opened by its link; Admin gets no list | `api/agent-bundle.js`, `admin/bug-bundle.js`, route + purge in `workers/www`, test | a stored bundle opens at its link; the same call with a wrong key is a 404; no `feedback` row is written |
| 3/5 | jobadabra | A tester's Send feedback carries everything an agent needs, and never goes to the real feedback box | `lib/tester-mode.js`, `lib/tester-bundle.js`, `lib/feedback-handlers.js`, `renderer/pages/app-feedback.js`, `renderer/index.html` | unit: a real person's app is never in tester mode; a tester send never calls `/api/feedback`; the bundle is redacted and capped; the ±5 min window cuts a fixture log right |
| 4/5 | jobadabra | The nightly issue says journey, expected, seen, severity, versions, steps, with its pictures and the bundle link; a fixed bug closes itself | `lib/agent-notes.mjs`, `lib/agent-run.mjs`, `lib/triage-issues.mjs`, `lib/triage-findings.mjs`, `triage.mjs` | unit: issue body of a planted persona finding and of a desktop-tester one (no picture or log in the second); two clean nights close; a night that did not visit the view does not |
| 5/5 | jobadabra | One command loads a reported bug's state in the twin | `e2e/twin.mjs`, `e2e/lib/twin-replay.mjs` | unit: the bundle's session record and job row land in the twin folder; real folder refused |

## Order and rules
- Site first (2/5), then the app (3/5) against the real route, then the filing (4/5), then the replay (5/5).
- 4/5 waits until the nightly reaches screens: the persona's step plan must come from its token meter (reported to the coordinator 7 Nov). Without that, no goal is worked and no note is made.
- Every behaviour PR gets one `/code-review` in a fresh subagent before ship; docs-only PRs skip it. Gitar approves each.
- The testing skill (`~/.claude/skills-src/jobadabra-how-it-works/SKILL.md`, "How to report each finding") is outside the repo. Its replacement text is written in PR 5/5's body: the same J-number / Expected / Seen / Where / Severity block, but **filed by pressing Send feedback in the twin's tester mode**, never pasted as chat text.
