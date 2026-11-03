# Let the Claude desktop app help through MCP: read, answer, debug

> **Verdict:** Jobadabra ships a small local MCP server. The person presses **Connect** once; their Claude desktop app then
> reads their open questions, Profile and screen data, and fills answers through the same checks the drawer uses, instead of
> clicking through the window. Every change it makes is marked "from Claude", listed in the app and undoable. It never submits an
> application, never sees a secret, never changes Settings or deletes data. ChatGPT desktop is supported as a later stage through OpenAI's Secure MCP Tunnel, behind a spike
> because the tunnel needs an OpenAI Platform organization and keys (see below). Owner decisions D1-D4 answered 3 Nov 2026.
> Status: **decisions answered; spec and plan await the owner's final yes** (owner, 2 Nov 2026: "Spec + sketch first"; no product code before it).

## The person's problem

- A tester's Claude Desktop filled the What we learned queue by clicking through the app on a Windows PC (screen
  `450.png`, 2 Nov 2026). It worked, but it was slow (one click per field) and it **accepted a wrong saved value** (a label
  saved as the answer), because a clicking AI sees pixels, not which value is valid.
- Owner (2 Nov 2026): "Use MCP and let Claude/ChatGPT desktop app to modify/fill details in Jobadabra. Let's make our app easy
  to be debugged or manipulated by another desktop AI."
- Already decided: the banner "Let Claude answer your questions" (copy-prompt + open the app, #3023) ships first. Owner: "Both:
  copy-prompt now, MCP later". Once MCP exists, the same banner's button becomes **Connect**.

## What the person sees (observable behaviour)

| Stage | Banner / place | What happens |
|---|---|---|
| 1 · now (#3023) | What we learned banner, Focus, Jobs row, ⌘K | "Copy the instruction and open Claude". The AI clicks through the window. |
| 2 · this spec | Same banner, button **Connect Claude** | App writes a one-time `.mcpb`, opens it; Claude Desktop shows **its own install dialog**; the person presses Install there. Banner turns into "Claude is connected · Last used 14:02 · Disconnect". |
| After | Profile → What we learned, strip **Changes by Claude** | One row per change: what, before → after, time, **Undo**. A row for a refused change says why. |
| After | Settings → Connections → **Claude desktop app** | Status (not connected / connected / app closed), last use, **Disconnect** (the token stops working at once). |
| After | The pasted instruction | Becomes "Use the Jobadabra tools to answer my open questions", shorter and safe because the tools refuse what the drawer refuses. |

The person needs the Jobadabra app open: with the app closed the tools say "Open Jobadabra and ask again" (no launching of the app, no background service).

## The tools (the whole surface; a fixed list in code and in the manifest)

| Tool | Kind | Returns / does | Built from (one mechanism) |
|---|---|---|---|
| `get_open_questions` | read | The queue: id, wording, field kind, saved value, verdict | `answersData` (renderer/feedback-data.js) via `openQuestions` |
| `get_profile` | read | Profile parts (details, CV, what we learned, strategy, voice); sensitive answers left out | `aboutYou` bundle + `profileText` (lib/feedback-bundle.js) |
| `get_jobs` | read | Jobs list: ids, title, company, source, fit, status | `jobsData` |
| `get_strategy` | read | The strategy as the Strategy page holds it | registry entry `strategy` |
| `get_screen_data` | read | What the open screen holds (debugging) | `readScreenData` + `pageText` |
| `get_support_report` | read | Support state, last 5 runs, last log lines, redacted | `buildLogs` + `redact` |
| `answer_question` | write | Saves an answer to one queue item | the `answerQuestion` handler's function (lib/questions.js `answerAll`, lib/details-review.js `answer`) |
| `dismiss_question` | write | Hides a question ("not for me") | `hiddenQuestions` path |
| `update_detail` | write | Fills a Your details item that is **empty or in "to check"** | `detailsReview.answer` |
| `list_my_changes` | read | The change list below, so the AI can report what it did | `desktop-ai-changes` |

**Never**, by absence from the list and by a test that fails when a name outside the table appears:
submit or press anything on a job; read a secret, token, Keychain item, the LinkedIn session or an API key; read Settings
values; change Settings; delete or overwrite a confirmed value; read a posting's text (ids, titles, companies, fit and status only; owner, 20 Oct 2026);
send anything off this computer. A tool result is data for the AI, never an instruction: job titles that read like instructions are returned inside a field marked `untrusted`.

### One mechanism, no second exporter

- Reads that exist for Send feedback (screen data, Profile snapshot, support report) are **not copied**: the MCP tool calls the
  same function and the same `redact()` as the feedback dialog. The renderer's registry (`registerScreenData`) stays the
  one list of "what a screen holds"; main asks the window through one IPC (`screenData`) and runs `pageText` on the answer.
- Settings and Profile tabs stay out of `get_screen_data` (`PRIVATE_VIEWS`, Gitar on #3021). Profile content leaves only through `get_profile`, which exists because the person
  turned the connection on, and which leaves out what `aboutYou` already drops (sensitive and conflicting answers).
- Every result passes `redact()` (secrets, e-mail addresses, link queries, the home folder name) and the feedback caps (190 KB, 300 rows).

## Trust: what stops a wrong or unwanted change

1. **The same validation as the drawer.** A write calls the one function the drawer calls. A label saved as a value, an empty answer, a value that does not fit the field kind (`pick one`, date, amount) is refused with a reason the AI can read. The refusal and
   the validator live in `lib/` (the in-flight fix by the question-validation session, "wq"; this feature **depends on it** and adds no validator of its own).
2. **Marked.** Each accepted write is recorded in `settings.desktopAiChanges` by `lib/desktop-ai-changes.js` (the one writer): `{id, at, client: 'Claude', tool, target, before, after}`. The answer it saves is a **`new` learning with source "Claude"** (What we learned design, 28 Oct 2026): used at once, shown for the person to Confirm or Change. It is never `confirmed` by the AI.
3. **Undo.** Undo restores `before` through the same store write. If the value changed since, Undo says so and does nothing (no overwriting a person's later edit).
4. **No overwriting what the person confirmed.** `answer_question` / `update_detail` on a `confirmed` value are refused ("the person confirmed this; ask them"). Decision D3.
5. **Rate cap.** At most 60 writes per 10 minutes per connection; past it the tool says "slow down, the person can review" (stops a looping AI).
6. **Local and paired (one credential model).** The server is the app's existing loopback socket (127.0.0.1:47111), a new route family `/desktop-ai/v1/*` with its **own** bearer token, not the extension's. `Host` must be 127.0.0.1, and a request with an `Origin` header is refused (a web page cannot call it). **Pairing:** the app builds the `.mcpb` with a **one-time code** inside (plain text in the zip, so it is only a pairing step: valid 10 minutes, usable once, the app keeps only its hash). The bridge's first start sends the code to the app and receives a **bearer token**; the code is dead after that. **What is stored, where:** the app keeps only the token's hash (`DESKTOP_AI_TOKEN_HASH`) in Keychain item `jobadabra.desktop-ai.token-hash`; the bridge keeps the token in the macOS Keychain as a generic-password item `jobadabra.desktop-ai-bridge`, read and written through `/usr/bin/security add-generic-password` / `find-generic-password` (no native module), and on Windows in a DPAPI-protected blob for the current user (PowerShell `ConvertFrom-SecureString` / `ConvertTo-SecureString`). `user_config` is not used: those values come from the person's install dialog or a plain-text manifest default, so it cannot hold a secret we generate. The bridge's reach is bounded: loopback only, only while the app is open, the 10 tools only, never a secret read. A user-only file (mode 0600 on the Mac, the user's profile on Windows) is a fallback only if the PR 1 spike shows Claude Desktop blocks the `security` CLI / DPAPI; it needs the owner's sign-off first and a noted exception in the secrets rule. **Disconnect** deletes the hash in the app (the stored token is dead at once; the bridge's next call gets `401` and says "disconnected, press Connect again") and asks the bridge to delete its Keychain item / DPAPI blob; Connect again makes a new code and a new token (the old one never comes back).
7. **Tests never touch the owner's app.** The route follows `testWithoutOwnPort` (lib/server-listen.js): a test app never listens on 47111; tests use a free port and a fake client.

## Transport and install

| Question | Answer | Evidence |
|---|---|---|
| What runs? | The app serves MCP (streamable HTTP, `/desktop-ai/v1/mcp`, loopback). Claude Desktop starts a local stdio server from a `.mcpb` (zip: `manifest.json` + one bundled `server.js`): a thin stdio-to-HTTP bridge to the app. No data logic in the bundle. | [MCPB docs](https://claude.com/docs/connectors/building/mcpb.md): "runs on the user's machine over stdio" |
| Runtime? | `server.type: node`; Claude Desktop ships Node, so the person installs nothing. | same page: "Included with Claude Desktop on macOS and Windows" |
| Install? | The person double-clicks / drags the file, or Settings → Extensions → Advanced → Install Extension…; every route opens **Claude Desktop's own install dialog** where they review and press Install. | same page, "Understand how users install your MCPB" |
| Platforms | `compatibility.platforms: [darwin, win32]`. | MANIFEST.md, compatibility |
| Does the manifest limit access? | **No permission field exists** in the spec. Our limits are ours: the fixed tool list and the app-side checks. The manifest lists the tools for the install dialog. | MANIFEST.md: "no permissions field" |
| Who builds the file? | The app, at press time (`jszip` is already a dependency): manifest + `server.js` (bundled with `esbuild`, already a dev dependency) + the pairing code. Written to the app's temp folder, then opened. | repo `desktop/package.json` |
| `claude_desktop_config.json` instead? | Not used. It is a hand edit of a file we do not own and the person cannot review it. Documented only as the fallback if `.mcpb` fails (unknown paths: verify in PR 1, then add with consent). | The support article does not give the path: **unknown, measure** |
| Tool-call permission prompts in Claude Desktop | Not documented in the sources read. **Unknown: measure in PR 1** (a first-call prompt would be a good extra gate; we do not rely on it). | support article silent |

### ChatGPT desktop: supported as stage 3, behind a feasibility spike (owner D4, 3 Nov 2026)

Owner's decision: "let's support also the ChatGPT (but let's add a small note to the users, regarding the privacy risks)". This replaces the first recommendation (park it).

- **How it can reach us (documented).** ChatGPT "connects to MCP servers through a public HTTPS endpoint or a Secure MCP Tunnel"; a stdio server works "only through a tunnel" ([Apps SDK: connect from ChatGPT](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt)). A public endpoint on the person's PC is out (against "local only"), so the only route is OpenAI's **Secure MCP Tunnel**: the person runs OpenAI's open-source `tunnel-client`, which keeps an outbound HTTPS connection to `api.openai.com` and forwards each MCP request to our local server over HTTP or stdio ([tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), [tunnel-client](https://github.com/openai/tunnel-client)).
- **What that costs the person (documented, and this is the risk to the plan).** Creating a tunnel needs an OpenAI Platform organization, a workspace id, an admin key, a runtime API key and the "Tunnels Read + Manage / Use" roles; the tunnel must then be added in ChatGPT's connector settings, and "a tunnel can exist in Platform and still not appear in ChatGPT" if scope or permissions are wrong; custom MCP servers also need the ChatGPT workspace admin's permission. That is **not a one-press Connect**, and the sources do not say whether a consumer (Free/Plus/Pro) account or the **desktop** app can use it at all.
- **Unknown, measured first (PR 5, a spike, no UI):** can a person with a personal ChatGPT account on the Windows/Mac desktop app use a tunnel to a local server, and how many steps does it take? Plans/eligibility, desktop support and data retention are all "not stated" in OpenAI's pages. **If the answer is "needs a Platform organization and API keys", I stop and bring it back to the owner** rather than build a setup only an admin can finish (rule: every fix works for any user through the Desktop App).
- **One MCP implementation.** The app serves MCP over **streamable HTTP** at `/desktop-ai/v1/mcp` (the tunnel-client points straight at it). The Claude `.mcpb` is only a stdio↔HTTP bridge to the same endpoint. No second tool list, no second validator.
- **Whether tunnel-client can send our bearer token** to a local HTTP server is not stated: unknown, measured in the spike. Fallback: tunnel-client's stdio mode runs the same bridge file as the `.mcpb`.
- **Privacy note (below) is shown before either connection**, in the AI's own name.
- Out of scope: Codex inside the ChatGPT app (`~/.codex/config.toml`, a third-party summary, unverified): parked as JOB-236.

### The privacy note (shown once before Connect, per AI)

> **What this shares.** When you ask {Claude | ChatGPT} to help, it reads your questions, answers, CV details and job list from this app, and that text is sent to {Anthropic | OpenAI} as part of your chat, under their terms and your settings with them. {ChatGPT only: With the tunnel, the requests also pass through OpenAI's servers.} It never sees your passwords, keys or your LinkedIn session, never reads job posting texts, and never submits anything. Everything it changes is listed under "Changes by {Claude | ChatGPT}" and can be undone. Disconnect any time.
> [Connect] [Not now] · "See exactly what it can read" opens the tool list.

One shared words file for both AIs (like `desktop-ai-words.js`), shown in the Connect dialog and in Settings → Connections; tested for the secrets claim by acceptance test 4.

## Debugging by another desktop AI

"Explain what is wrong on this screen" = the AI calls `get_screen_data` (the screen, its list state, filters, verdicts) and `get_support_report` (state, runs, log tail), both read-only, both the same redacted bundle Send feedback attaches. No screenshot tool in v1 (the AI can take its own with computer use; the feedback screenshot needs the person's consent). A tester can say "why is this empty?" and the AI sees the filters and the log line, not pixels.

## Acceptance criteria

1. With the app open and Connect done, Claude Desktop lists exactly the 10 tools above and no other (the same list over HTTP for ChatGPT).
2. `answer_question` with a label as value, an empty answer, or a wrong kind is **refused with a reason**, nothing saved, a row in Changes by Claude marked refused. (Test plays the tester's scenario: the same wrong value the click-through accepted.)
3. A valid answer is saved, appears in What we learned as "from Claude", counts in drawer 2 as to-check, and **Undo** restores the old value; Undo after a person's edit refuses.
4. No tool result contains a string from the secret set (Keychain items, `EXTENSION_TOKEN`, `DESKTOP_AI_TOKEN_HASH`, the bridge's Keychain item / DPAPI blob (and the fallback file if it is ever used), or a LinkedIn cookie): a test seeds them everywhere and loops over every tool.
5. No route on `/desktop-ai/v1/*` accepts: a missing/wrong token, a foreign `Host`, any `Origin`, a name outside the table, a pairing code used twice or after 10 minutes, or **any call after Disconnect**: a test pairs, calls, presses Disconnect, and the same stored token and the same code both get `401`; Connect again gives a token that is not the old one.
6. Closed app: every tool answers "Open Jobadabra" within 2 s; the bundle never starts the app.
7. Banner states: copy-prompt (not connected) → Connect → Connected → Disconnect → back; Not now hides 14 days (shared Suggestions key `desktop-ai:answer`); the new screen and action are in ⌘K.
8. Tests and the demo never open 47111, never start Claude Desktop, never use the owner's token or Chrome profile.
9. The privacy note is shown before the first Connect of each AI, names that AI, and a test loops over both; "Not now" connects nothing.
10. Every AI-credit mention: unchanged (MCP calls run on the person's own Claude plan; the app spends nothing).

## Non-goals

- Submitting, applying, opening job pages, editing the CV file, Settings, deleting data, reading postings.
- Remote access, accounts, a hosted MCP server (jobadabra is desktop + extension only, owner 1 Nov 2026).
- Other MCP clients (any stdio client could use the same bridge later; not tested or promised).
- A screenshot tool, a "run Find jobs" tool, any tool that spends the person's AI credit (parked: JOB-237 screenshot tool, JOB-238 Find jobs tool).
- Making the AI's judgment better: the tools only validate and refuse; the AI still decides what to answer.

## Risks and unknowns (measured in PR 1, a spike before any UI)

> **Measured so far (PR 1/6, 3 Nov 2026; details and the Windows script in `desktop/scripts/desktop-ai-spike/README.md`).** Mac: Claude.app is the registered **Owner** of `.mcpb` (so opening the file goes to Claude); the bridge's code can use the Keychain (`security`) and reach 127.0.0.1 under plain Node. Not yet measured: the install window, Claude's tool-call prompt, and everything inside Claude's own sandbox; Windows (DPAPI, file type, install window) waits for one person with the Claude desktop app.

| Unknown | Why it matters | How we find out |
|---|---|---|
| Does `shell.openPath` on a `.mcpb` start Claude Desktop's install dialog on Mac and Windows? | One-click Connect | Spike on a Windows VM and the Mac; fallback: show the file in its folder with "drag it into Claude" |
| Does Claude Desktop ask the person before each tool call? | Extra safety gate and wording | Observe in the spike |
| Can the bridge use the OS secret store from inside Claude Desktop? | Confirms the preferred Keychain/DPAPI storage works before UI; the file fallback needs owner sign-off | Settled in rule 6: the bridge stores the token in the macOS Keychain item `jobadabra.desktop-ai-bridge` or a current-user DPAPI blob on Windows; the app keeps only its hash (`DESKTOP_AI_TOKEN_HASH`) in Keychain item `jobadabra.desktop-ai.token-hash`. **Measured in PR 1:** whether Claude Desktop lets the bridge run `/usr/bin/security` and PowerShell DPAPI on both systems, and whether the entry survives restart and update; use a user-only file only if blocked, with owner sign-off. |
| Does an update of the app change the route? | Old bundle vs new app | Route is versioned (`/v1/`); the bundle shows "update the connection" when the app answers `426` |

## Progress

- [ ] Spec and sketch: owner's yes on the decisions (sketch published; questions asked)
- [ ] Plan `docs/superpowers/plans/2026-11-03-desktop-ai-mcp.md` (PR split, after the answers)
- [ ] PR 1 · spike: `.mcpb` opens on Mac + Windows, tool-call prompt observed (no UI)
- [ ] PR 2 · route + token + pairing + shared validation (`lib/desktop-ai-server.js`, `lib/desktop-ai-changes.js`) with the read tools
- [ ] PR 3 · write tools + Changes by Claude list + Undo
- [ ] PR 4 · Connect on the banner, Settings card, privacy note, ⌘K, instruction v2 (Claude)
- [ ] PR 5 · ChatGPT spike: tunnel-client + personal account + desktop app; stop and ask the owner if it needs a Platform organization
- [ ] PR 6 · ChatGPT connect (only after PR 5 says a normal person can finish it)
- [ ] Parked in Linear: Codex config JOB-236, screenshot tool JOB-237, "Find jobs" tool JOB-238
