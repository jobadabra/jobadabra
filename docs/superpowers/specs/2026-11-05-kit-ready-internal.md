# Kit ready is internal

Owner, 5 Nov 2026: "remove completley the concept of "Kit ready" in the ui… The user cares only about applying."
Sketch and the owner's picks: https://claude.ai/artifact/QwtRVUWzCYDQddX1WvRKTZ

## What the person sees
- A job goes Saved → Applying → Applied. A job stored at Kit ready reads Saved everywhere.
- The kit is made when Apply is pressed. Nothing offers to prepare one on its own.
- No new review step: the person checks the filled form before Submit, as today.
- Tailor CV + cover letter for top matches stays (owner: "Keep it").
- Interview prep kits are a different thing and are left out.

## What stays internal
- The stored stage `Kit ready`, `STARTABLE_STAGES`, Cancel and "Not submitted" going back to it.
- The `📝 Application kit` section, the engine's `prepare` and `kits` modes.
- `NO_ANSWER`: the extension and the app compare it by equality, across versions.
- `📝 Kit ready` in Next step: `ready_jobs` reads it as data. Someone who opens their Notion still sees these.

## Design
`columnOf` and `stageLabel` (`desktop/renderer/jobs-board-rules.js`) are the one place a stored stage becomes a word, so the Board, the filter, the view counts and every label follow them.

## Progress
- [x] 1/2 The words and screens (proof: desktop/integration/app/screen-jobs-kit-internal.test.js)
- [ ] 2/2 One press to apply: the Draft applications setting goes; with Always on, Apply prepares on this computer
