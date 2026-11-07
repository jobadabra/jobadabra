---
area: apply
paths: [extension, docs/rules/applying.md, docs/rules/apply-flow-workflow.md, docs/flows, docs/apply-flow.md, desktop/lib/application-journey.js, desktop/e2e/flows.mjs, desktop/e2e/ladder-fixtures, tools/journey-gate.mjs, tools/ladder-gate.mjs, tools/recorded-cases.mjs, tools/replay-files.mjs, .claude/skills/apply-to-job, .claude/skills/fix-recorded-sites, desktop/practice, docs/practice-jobs.md]
updated: 2026-11-07
---
# Apply and forms
> The Chrome extension reads a job's form, the AI judges what each field means, and the person's kit fills it. Submit is only ever the person's press, or Full automation they turned on after one confirmation (safety lives in CLAUDE.md).

## Rules
- Full automation can be tried end to end with no real application: `cd desktop && npm run practice` ([docs/practice-jobs.md](../practice-jobs.md)); dev builds only, its Submit lands in a local catcher.
- The extension first: a new capability goes into the extension's flow before any "Claude can do it" path. Claude's takeover is OFF (one flag); the panel's "Report" is the way out of a stuck page.
- A form bug is never fixed "for that website". Name which part of the self-improving mechanism it improves (operator, fingerprint, alias, recipe, noticing the miss); test the SHAPE with a fixture.
- Universal first: no site names, hosts or growing word lists in logic (guard `tools/hardcoded-page-words.mjs`). A wrong decision is data (ladder fixture, prompt example, learned move); an unread field is universal code with a recorded page; safety is code.
- The AI judges meanings (ready? did it work? bot check? which step?); structure only finds controls; floors only AND with the AI.
- Fix at the lowest ladder rung that has the information: 0 structure, 1 kept answer, 2 text sketch, 3 digest, 4 screenshot, 5 takeover, 6 the person. A fix must not make another site worse (`desktop/e2e/ladder-fixtures/`, `tools/ladder-gate.mjs`).
- A push that changes a file a recorded replay loads adds a recorded page that fails on origin/main's code; trailers `Pool-row:`, `Recorded-unneeded:` (see the rules page).
- One owner per state: where an application stands is `desktop/lib/application-journey.js` plus `extension/tab-identity.js`; the panel dim is one per-tab state (`extension/apply-state.js`), changed only on verdicts, never by a page timer.
- Written questions get a DRAFT from the person's own facts, typed and marked, counted as left until they edit or keep it.
- Flow core: your open PR is the claim on `FLOW_CORE` / `FLOW_FILES` (`desktop/e2e/flows.mjs`); read a file's "Invariants:" block first.
- One mechanism across Apply modes (standard, background, Full automation): extend the step every mode passes, test each mode touched.

## Key files
- Extension display languages: `extension/i18n.js` owns preference/cache; `i18n-format.js` shares trusted text formatting, and `panel-i18n.js` redraws only app-owned panel nodes. [Approved localization design](../superpowers/specs/2026-11-07-extension-localization.md).
- `extension/`: content scripts, the panel, `fill-flow.js` (the decision flow), `ladder/core.js`, `page/` (controls, skeleton), `tab-identity.js`, `apply-state.js`.
- `desktop/lib/`: `application-journey.js`, `apply*.js`, `background-apply-*.js` (the app side of applying).
- `desktop/e2e/recorded/`, `ladder-fixtures/`, `flows.mjs`: recorded pages, rung fixtures, the flow registry.
- `tools/journey-gate.mjs`, `ladder-gate.mjs`, `recorded-cases.mjs`, `replay-files.mjs`: the push gates for flow changes.
- More: `node desktop/scripts/codemap.mjs apply fill ladder`.

## Live specs
- [Application journey](../superpowers/specs/2026-10-10-application-journey.md): the one owner of where an application stands.
- [Fill ladder](../superpowers/specs/2026-10-12-fill-ladder.md) and [AI ladder](../superpowers/specs/2026-10-10-ai-ladder.md): which rung decides what.
- [Apply triage](../superpowers/specs/2026-10-30-apply-triage.md) and [background apply](../superpowers/specs/2026-10-27-background-apply-execution.md).
- [What we learned about you](../superpowers/specs/2026-10-28-what-we-learned-design.md): facts versus learned answers, two drawers.

## Ask the sources
ask: github issues label=fill-failure state=open
ask: sentry issues is:unresolved culprit=extension
ask: posthog events event=apply_started days=7
ask: posthog events event=applied days=7

## Lessons
- The hands are rarely the problem: of the pool's leftovers, about 99% were answers, uploads, consent and policy; about 1% were clicking failures. Do not route filling through another browser tool; improve answers and uploads.
- Judge filling work by a blind round on fresh forms with the same AI, never by our own recorded pool, which we overfit. A pool-only gain is not an improvement.
- A new rule keyed on a page's shape first replays the recorded cases of that shape; one rule that held "no-form pages with fields" broke two sure answers.
- A bug the owner saw is proven on the owner's own sequence: the panel flicker survived three fixes because the tests never played posting, redirect, form. Read for existing tests that assert the opposite.
- Review-queue questions are generated from missing details and rated by the AI; check the value is not already held before asking. No typed question lists.
- A prompt rule stays general: a named fill-in slot held where a neutral example alone did not.

## Go deeper
[applying rules](../rules/applying.md) · [apply-flow workflow](../rules/apply-flow-workflow.md) · [scenario matrix](../flows/applying.md) · [ladder](../flows/ladder.md) · [apply flow](../apply-flow.md) · [reading websites](../rules/agent-detail.md#reading-websites) · [no matching tab](../rules/agent-detail.md#no-chrome-tab) · [apply-to-job skill](../../.claude/skills/apply-to-job/SKILL.md) · [fix-recorded-sites skill](../../.claude/skills/fix-recorded-sites/SKILL.md)
