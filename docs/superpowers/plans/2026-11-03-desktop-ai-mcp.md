# Plan: the Claude (and ChatGPT) desktop app helps through MCP

Spec: [2026-11-03-desktop-ai-mcp-design.md](../specs/2026-11-03-desktop-ai-mcp-design.md). Owner decisions (3 Nov 2026): D1 a file the app builds, D2 answers apply at once with Undo, D3 never change a confirmed value, D4 support ChatGPT too, with a privacy note.
Each PR is titled `[mc] n/6 <what it does for the user>` and carries the template's "Plan progress" block. Tier 2 (store writes, engine-facing): the fast loop locally, CI runs e2e.

## Progress
- [x] 0/6 Spec + plan (docs only, this PR) (proof: docs/superpowers/plans/2026-11-03-desktop-ai-mcp.md @f1d22e86)
- [x] 1/6 Spike: does a built `.mcpb` open Claude Desktop's install dialog on Mac and Windows; does Claude ask before a tool call (a tester's Windows PC; measured, written into the spec) (proof: desktop/scripts/desktop-ai-spike/build.mjs @4b7bdda7)
- [x] 2/6 Claude can read: local MCP route, token, pairing, read tools, redaction, the bridge `.mcpb` (proof: desktop/lib/desktop-ai-server.js @4c6f6c05)
- [x] 3/6 Claude can fill: write tools, Changes by Claude list with Undo, shared validation (proof: desktop/lib/desktop-ai-writes.js @382c7252)
- [x] 4/6 Connect Claude on the banner, Settings card, privacy note, ⌘K, shorter instruction (proof: desktop/lib/desktop-ai-connect.js @75be2661)
- [x] 5/6 Spike: ChatGPT through OpenAI's Secure MCP Tunnel, from the docs: no-go (spec "Result of the ChatGPT spike"); the owner chose not to run it hands-on (proof: docs/superpowers/specs/2026-11-03-desktop-ai-mcp-design.md)
- [ ] 6/6 Connect ChatGPT: parked as JOB-258 (5/6 says a normal person cannot finish it)

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
2. **2/6 read.** `desktop/lib/desktop-ai-server.js` (route family `/desktop-ai/v1/*`, MCP streamable HTTP at `/mcp`, token, `Host` and `Origin` checks, version `426`), `desktop-ai-pairing.js` (one-time 10-minute code, token hash in the app's secret store as `DESKTOP_AI_TOKEN_HASH`; the bridge keeps the token in the Keychain (`security` CLI) or a DPAPI blob on Windows; Disconnect kills both), `desktop-ai-tools.js` (the fixed list, one entry per tool, each calling the existing function), `desktop-ai-bridge/` (the stdio bridge + manifest, packed at press time). Reads use `answersData`, `jobsData`, `readScreenData`, `profileText`, `buildLogs` and `redact()`; the main process asks the window for the registry through `window.jobadabraScreenData` (`webContents.executeJavaScript`, the key passed as JSON). Tests: `desktop/test/desktop-ai-server.test.js` (auth, Host, Origin, version, unknown tool), `desktop-ai-pairing.test.js`, `desktop-ai-tools.test.js` (redaction of every tool, a guard that fails on a tool name outside the spec table), `desktop-ai-handlers.test.js`, `desktop-ai-bridge.test.js` (the helper against the real handler on a free port, never 47111).
3. **3/6 write (backend only, mac-07 3 Nov 2026).** `desktop-ai-changes.js` (the one writer of `settings.desktopAiChanges`: id, time, client, tool, target, question, before, after, undone, plus the 60 writes / 10 minutes cap), `desktop-ai-writes.js` (`checkAnswer` on wq's pure helpers `question-sense.js` and `question-values.js`, `answer_question` and `dismiss_question` against the list the window loaded (renderer registry entry `questions`, `questionsData`), refusal of a confirmed, two-answers or review item, the Undo function that refuses when the person changed the value since), `question-answer.js` (the drawer's save, now shared by the IPC and the tools; `home` = a Your details section the AI client chose, validated against `SECTIONS`, no AI call; none given = the no-AI path, the answer stays on the answers page), `questions.rawOf` / `questions.restore`. The saved line is marked New (`withState`); the source "Claude Desktop" lives in the change list. **Moved out:** `update_detail` (needs Undo designed per Your-details review kind: parked as JOB-249) and the visible "Changes by Claude" strip + Undo button (4/6). Tests: the tester's scenario (a label as value), Undo after an edit, rate cap, a place chosen by the AI, every tool redacted.
4. **4/6 Connect Claude.** Banner stage 2 (`desktop-ai-words.js` gains the connect, connected and disconnect words), Settings → Connections card, the privacy note (one words file for both AIs), ⌘K entry, instruction v2, the shared Suggestions key unchanged, **plus the "Changes by Claude" strip with its Undo button on What we learned** (moved here from 3/6: it is a screen). Preview first (`npm run side-by-side`), ship on the owner's yes.
5. **5/6 ChatGPT spike.** Install `tunnel-client` on a test PC with a throwaway OpenAI account (never the owner's), point it at the 2/6 route, record steps, accounts, roles, whether the desktop app lists the tunnel, whether the bearer token can be sent. Output: a table and a recommendation to the owner.
6. **6/6 Connect ChatGPT.** Designed from 5/6's result; same tools, same tests over HTTP, the ChatGPT variant of the privacy note.

## Parked (Linear)
- JOB-236 Codex config for the ChatGPT app · JOB-237 screenshot tool · JOB-238 "Find jobs" tool.

## Safety net (before any code)
- Guard test that fails on a tool name outside the spec table; secrets loop over every tool; route refuses without token, with a foreign `Host`, with any `Origin`; tests and the demo never open 47111 or start Claude Desktop (`testWithoutOwnPort`).
- Every PR: `Recorded-unneeded:` (no page acting), `Pool-row: none` trailers.
