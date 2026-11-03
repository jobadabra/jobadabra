# Plan: the Claude (and ChatGPT) desktop app helps through MCP

Spec: [2026-11-03-desktop-ai-mcp-design.md](../specs/2026-11-03-desktop-ai-mcp-design.md). Owner decisions (3 Nov 2026): D1 a file the app builds, D2 answers apply at once with Undo, D3 never change a confirmed value, D4 support ChatGPT too, with a privacy note.
Each PR is titled `[mc] n/6 <what it does for the user>` and carries the template's "Plan progress" block. Tier 2 (store writes, engine-facing): the fast loop locally, CI runs e2e.

## Progress
- [ ] 0/6 Spec + plan (docs only, this PR)
- [ ] 1/6 Spike: does a built `.mcpb` open Claude Desktop's install dialog on Mac and Windows; does Claude ask before a tool call (a tester's Windows PC; measured, written into the spec)
- [ ] 2/6 Claude can read: local MCP route, token, pairing, read tools, redaction, the bridge `.mcpb`
- [ ] 3/6 Claude can fill: write tools, Changes by Claude list with Undo, shared validation
- [ ] 4/6 Connect Claude on the banner, Settings card, privacy note, ⌘K, shorter instruction
- [ ] 5/6 Spike: ChatGPT through OpenAI's Secure MCP Tunnel with a personal account on the desktop app (measured; stop and ask the owner if it needs a Platform organization)
- [ ] 6/6 Connect ChatGPT (only if 5/6 says a normal person can finish it)

## Order and dependencies

| PR | Needs | Unblocks | Owner proof |
|---|---|---|---|
| 1/6 | nothing | the install design is real, not assumed | Screen recording from the Windows tester PC, spec table filled |
| 2/6 | 1/6 | everything below | A fake MCP client lists exactly the read tools; secrets-seeded loop finds none |
| 3/6 | 2/6 and wq's shared answer validation (open question-validation fix) | the tester's scenario | Test plays the tester's wrong value and gets a refusal; Undo restores |
| 4/6 | 3/6 | what the person sees | One side-by-side preview (banner, Settings card, Changes list), light + dark, on the owner's yes |
| 5/6 | 2/6 | ChatGPT go/no-go | Written result: steps, accounts needed, desktop yes/no |
| 6/6 | 5/6 + 4/6 | ChatGPT users | Same acceptance tests over HTTP |

## What each PR holds

1. **1/6 spike (no product code shipped).** A throwaway `.mcpb` with one `ping` tool built by a script (`jszip`, `esbuild` already in desktop/); `shell.openPath` on it on Mac and Windows; note whether the install dialog opens, how many clicks, whether a tool call prompts. Result goes into the spec's "Risks and unknowns" table. Never run on the owner's Claude account or app data.
2. **2/6 read.** `desktop/lib/desktop-ai-server.js` (route family `/desktop-ai/v1/*`, MCP streamable HTTP at `/mcp`, token, `Host` and `Origin` checks, version `426`), `desktop-ai-pairing.js` (one-time 10-minute code, token hash in the Keychain as `jobadabra.desktop-ai.token-hash`; the bridge keeps the token in the Keychain (`security` CLI) or a DPAPI blob on Windows; Disconnect kills both), `desktop-ai-tools.js` (the fixed list, one entry per tool, each calling the existing function), `desktop-ai-bridge/` (the stdio bridge + manifest, packed at press time). Reads use `answersData`, `jobsData`, `readScreenData`, `profileText`, `buildLogs` and `redact()`; a new IPC `screenData` asks the window for the registry. Tests: `desktop/test/desktop-ai-server.test.js` (auth, Host, Origin, unknown tool, closed app), `desktop/integration/app/desktop-ai-tools.test.js` (a fake client over HTTP on a free port; secrets seeded in settings, Keychain stand-in and logs; assert none appear), a guard that fails on a tool name outside the spec table.
3. **3/6 write.** `desktop-ai-changes.js` (the one writer of `settings.desktopAiChanges`: id, time, client, tool, target, before, after, refused reason), `answer_question`, `dismiss_question`, `update_detail` through `questions.answerAll` / `detailsReview.answer` and the shared validator, `new` learning with source "Claude", refusal on a `confirmed` value, 60 writes / 10 minutes, Undo (refuses when the value changed since). Strip "Changes by Claude" on What we learned. Tests: the tester's scenario (a label as value), Undo after an edit, rate cap, every Apply mode untouched.
4. **4/6 Connect Claude.** Banner stage 2 (`desktop-ai-words.js` gains the connect, connected and disconnect words), Settings → Connections card, the privacy note (one words file for both AIs), ⌘K entry, instruction v2, the shared Suggestions key unchanged. Preview first (`npm run side-by-side`), ship on the owner's yes.
5. **5/6 ChatGPT spike.** Install `tunnel-client` on a test PC with a throwaway OpenAI account (never the owner's), point it at the 2/6 route, record steps, accounts, roles, whether the desktop app lists the tunnel, whether the bearer token can be sent. Output: a table and a recommendation to the owner.
6. **6/6 Connect ChatGPT.** Designed from 5/6's result; same tools, same tests over HTTP, the ChatGPT variant of the privacy note.

## Parked (Linear)
- JOB-236 Codex config for the ChatGPT app · JOB-237 screenshot tool · JOB-238 "Find jobs" tool.

## Safety net (before any code)
- Guard test that fails on a tool name outside the spec table; secrets loop over every tool; route refuses without token, with a foreign `Host`, with any `Origin`; tests and the demo never open 47111 or start Claude Desktop (`testWithoutOwnPort`).
- Every PR: `Recorded-unneeded:` (no page acting), `Pool-row: none` trailers.
