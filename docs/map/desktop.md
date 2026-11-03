---
area: desktop
paths: [desktop/renderer, desktop/main.js, desktop/lib, tools/design-system, docs/rules/desktop-ui.md, .claude/skills/ui-look-and-feel, .claude/skills/desktop-change]
updated: 2026-11-03
---
# Desktop app UI
> The Electron app is one window with one module per page, built on a single design system: tokens, shared components and a rule for which control a value gets. A new screen looks like the old ones.

## Rules
- Reuse before styling: find the nearest sibling in the same container (`components.js`, `.insight-card`, `.summary-card`) and build from it. New CSS only for what is missing, scoped under the new root; a part needed twice goes to the shared library.
- Values live in `desktop/renderer/tokens.css` only (colours, radii, type scale, spacing); a raw value anywhere else fails `desktop/test/design.test.js`.
- The value's kind picks the control: short text a sized field, long text a growing box, yes or no two buttons, one of many a menu, several chips with an add. Never prose in a text box; a note for the AI is a muted line under its value.
- Chips are values, pills are status, tags are labels. A saved value is never cut by its box. One primary button per card; every button solid; icon-only buttons are secondary with a tooltip. No card inside a card.
- Contrast AA in both themes; look at light and dark. Pop-ups carry no button: the click is the one thing, and every call names a target or an action.
- Every new screen and action is in the ⌘K palette (`paletteCommands()` in `renderer/pages/nav.js`).
- A new task kind needs a parser, a render card on the insight-card shape, its kind in `CARD_KINDS`, and a look at the result beside a sibling's. A card has many states and a mockup shows one: list the states the parser and renderer draw and keep them all.
- Before a UI PR render the change with demo data in light and dark and make one side-by-side image; the owner's yes comes before the build goes on.
- No AI dollar amounts are shown; any mention of AI credit says what it buys, from the shared measured function.
- Say "your store" (this Mac or Notion), never "Notion" as the one database. Settings paths written in text ("Settings → Connections → AI") are checked by a test.

## Key files
- `desktop/renderer/pages/`: one module per page; `app.js` runs each page's `init()`; `pages/core.js` and `shared.js` hold the helpers and shared state.
- `desktop/renderer/components.js`, `components.css`, `tokens.css`, `gallery.js`: the building blocks and their gallery (`npm run gallery`, `npm run design-system`).
- `desktop/lib/`: the main-process side (IPC handlers, pipeline, stores access); `desktop/main.js`, `preload.cjs`.
- `npm run shot -- <page> --select '<card>'` renders a screen in demo mode; skills `ui-look-and-feel` (reference screenshots) and `desktop-change` (the fast loop and its traps).
- More: `node desktop/scripts/codemap.mjs renderer card palette`.

## Live specs
- [Always-on moments](../superpowers/specs/2026-11-02-always-on-moments-design.md) and [notify moments](../superpowers/specs/2026-11-02-notify-moments-design.md).
- [Waiting message](../superpowers/specs/2026-11-02-waiting-message-design.md) and [Gmail offer timing](../superpowers/specs/2026-11-02-gmail-offer-timing-design.md).
- [Insights with actions](../superpowers/specs/2026-10-28-insights-with-actions-design.md) and [your portrait](../superpowers/specs/2026-10-28-your-portrait-design.md).

## Ask the sources
ask: github issues label=confirmed state=open
ask: sentry issues is:unresolved culprit=renderer
ask: posthog events event=screen_time days=7

## Lessons
- A new dialog or free text box trips class tests (the card system, `text-fields-allowed.json`, solid buttons): run them for any renderer edit, even a comment.
- A design choice is drawn in the real page first, never asked as words; an insight needs a one-click action or it is folded into the feature or dropped.
- A wrong or stale screen is often a main-process state the window never refreshed: read `desktop-change` before debugging the renderer.
- Look at the rendered result before saying done, and measure pixels only after reading the source.

## Go deeper
[desktop UI rules](../rules/desktop-ui.md) · [offline app scenarios](../rules/agent-detail.md#offline-scenarios) · [logging](../rules/agent-detail.md#logging) · [ui-look-and-feel skill](../../.claude/skills/ui-look-and-feel/SKILL.md) · [desktop-change skill](../../.claude/skills/desktop-change/SKILL.md) · [app expectations](../app-expectations/README.md)
