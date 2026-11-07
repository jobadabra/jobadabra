# Stop attribution (#3410)

Keep the global extension stop and invariant 8: a stopped application never resumes from an ordinary page report. Only a positive user Stop trigger may say “Stopped by you”. Chrome cancellation carries browser provenance; unclassified/legacy events remain unknown. No arbitrary reason text is interpreted as a user action. One reducer owns journey state; its stored note carries the fixed explanation through persistence and every session view.

## Progress
- [x] Reproduce browser/unknown events being labeled “by you” in the journey reducer before the fix. (proof: desktop/test/unit/main/application-journey.test.js)
- [x] Carry user/browser/unknown origin through extension stop, event wiring, terminal wrapper and reducer; preserve global stop protections. (proof: extension/stop.js)
- [x] Verify fresh session behavior and existing Stop safety: 129 focused and adjacent Stop/journey/session-state/extension-contract checks pass on the integrated main base. (proof: desktop/test/unit/extension/stop-request.test.js)
- [ ] Render actual fictional before/after, light/dark and narrow; obtain owner UI approval before commit.
- [ ] Independent review, changed-file lint, fast shipping gate, PR screenshots, CI and review follow-up.

Files: `extension/stop.js`, `extension/stop-messages.js`, `desktop/lib/ext-server-handlers.js`, `desktop/lib/extension-contract.js`, `desktop/lib/stop-all.js`, `desktop/lib/terminals.js`, `desktop/lib/application-journey.js`, `desktop/renderer/pages/session-next-step.js`, and existing Stop/journey tests. No model calls, live user app, credentials or data.

Independent review found the stopped-event contract omitted the new optional source field. The existing extension-contract test reproduced the mismatch (6 passed, 1 failed); adding the optional string field restores all 7 checks.
