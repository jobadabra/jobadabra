# Guided setup of the user's own AI plan: plan (2 PRs)

Spec: `docs/superpowers/specs/2026-11-02-claude-code-guided-setup-design.md`. Titles `[cc] n/2 <what>`.

## PR 1/2: the states, the detection, the words, the counter
1. Tests first (red on today's code): `desktop/test/unit/main/plan-readiness.test.js`, `desktop/test/unit/renderer/ai-plan-guide.test.js`, `desktop/integration/app/ai-plan-states.test.js`; change the two tests that assert the old behaviour.
2. `desktop/lib/plan-readiness.js` (facts + `readiness`), `apply.js` (`claudeDesktopApp`, a chosen file, the app's own folder is not Claude Code), `claude-code.js` (no folder list or winget in the error; `supportDetails`; the new Always on sentence).
3. `renderer/ai-plan-guide.js` (words per state) and the chooser draws it; "Copy details for support"; file picker IPC `chooseCliFile`.
4. Field counter: `ai_setup_state` in `lib/analytics.js` EVENTS, sent from the status IPC.
5. UI preview: all 7 states, light and dark, one side-by-side image (`npm run side-by-side`, name starts `cc`), the owner's yes, then commit the visuals.

## PR 2/2: install, sign-in, a real Windows check
1. In-app install with progress and Cancel (`install.ps1` / `install.sh` from Anthropic, per user, no admin), same for Git for Windows.
2. Sign in: `claude auth login` opens Anthropic's page; the window's focus re-checks.
3. Machine-setup rows in `.github/workflows/fresh-install-smoke.yml` (Windows + macOS runners; Claude Code and Codex; only the chat app / nothing / the official installer, no sign-in), planned with a8 who owns that file. No new pipeline.
