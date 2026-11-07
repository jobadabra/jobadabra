# Extension localization: approved design

The owner expanded desktop localization to the Chrome extension. Emails and the website are excluded. The first milestone ships independently from the remaining panels.

## Display behavior

- Default to **Follow desktop app** in extension options. Offer explicit overrides with flags and native names for English, German, French, Italian, Spanish, Romanian and Russian (`en`, `de`, `fr`, `it`, `es`, `ro`, `ru`).
- Persist the extension preference in existing Chrome local settings. A supported effective desktop locale wins while following; an explicit extension override remains unchanged when desktop language changes.
- Reflect later desktop switches through existing authenticated responses, not only initial pairing. Preserve all Origin and token checks. Use an existing response instead of introducing another authentication surface.
- The last known desktop display locale is a rebuildable offline cache. English is the fallback for a new unpaired extension and for older desktop responses with missing or invalid locale. Network failures retain the offline cache.
- Use bundled explicit message keys, single-pass interpolation and plain text or safe escaping. Never perform heuristic whole-DOM replacement. Date, number and plural formatting follows the selected locale, including Romanian and Russian categories.
- Translate app-authored extension UI only. Employer DOM, applicant answers, AI output, filling decisions, prompts, consent and submission policies, stored applicant data and the manifest version remain unchanged. No new dependencies, paid APIs or data synchronization.

## Milestones

1. **[ml-ext] 1/2 Add inherited language setting and translate extension options/popup** — runtime, catalogs, options, popup and minimal locale transport.
2. **[ml-ext] 2/2 Translate app-authored extension panels and remaining UI** — injected panels and remaining app-owned controls. No stacked PR before milestone 1 merges.

## Acceptance evidence

Named unit files verify English compatibility, seven-catalog key and parameter parity, desktop/extension supported-locale parity, missing/invalid/offline fallback, explicit overrides, later desktop switches, locale plural rules and preservation of external/applicant text. Route tests verify unchanged Origin/token authorization. Fictional mocked options/popup previews show the localized interface without using the live app, accounts, data, browser profile, paid models or app ports.
