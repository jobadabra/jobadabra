# Jobadabra MCP: what Claude Desktop can read and change

> **Verdict:** 6 read tools and 3 write tools. It is **not installed automatically**: the person presses **Connect Claude** (Profile → What we learned, Settings → Connections, or ⌘K), and presses **Install** in Claude's own window. Disconnect stops it at once.

Spec: [desktop-ai-mcp-design.md](superpowers/specs/2026-11-03-desktop-ai-mcp-design.md). Plan: [desktop-ai-mcp.md](superpowers/plans/2026-11-03-desktop-ai-mcp.md). Tool list in code: `desktop/lib/desktop-ai-tools.js` (the one source: the helper's manifest, the privacy note and this page's test read it).

## Is it installed with the app?

| Question | Answer |
|---|---|
| Installed automatically with Jobadabra? | **No.** Nothing is added to Claude Desktop until the person asks |
| How does it get there? | **Connect Claude** builds a small helper file (`.mcpb`) and opens it; Claude Desktop shows **its own** install window listing every tool; the person presses Install there |
| Who presses Install? | Always the person, in Claude's window, never Jobadabra |
| When is it "connected"? | Only after the helper reached the app with its one-time code (10 minutes). Until then: "Waiting for install" |
| How does it stop? | **Disconnect** (banner, Settings card, ⌘K): the token stops working at once |
| Windows and Mac? | Both; the helper file is deleted once its code expired |
| ChatGPT? | Not yet (5/6 spike, 6/6 Connect ChatGPT) |

## Read tools (nothing changes)

| Tool | What it returns | Never |
|---|---|---|
| `get_open_questions` | Open questions of both drawers: key, list, wording, kind, options, saved value, what to check | Needs the app to have read the questions once |
| `get_profile` | The CV and Experience bank held on this Mac | Details, answers, strategy (other tools carry those) |
| `get_jobs` | The Jobs list as last shown: ids, title, company, source, fit, status | A posting's text |
| `get_strategy` | The job-search strategy as last shown | — |
| `get_screen_data` | What a screen holds now (`current`, `jobs`, `focus`, `strategy`, `profile:answers`, `questions`) | Settings and other Profile tabs |
| `get_support_report` | Support state, last runs, last log lines, redacted (same as Send feedback) | Secrets, keys, the LinkedIn session |

## Write tools (every change is listed and can be undone)

| Tool | What it does | Refuses |
|---|---|---|
| `answer_question` `{key, value, home?}` | Saves an answer to a **What we learned** question, marked **New** for the person to confirm | Empty answer, a field label, a value the field cannot read, anything the person already confirmed. `home` files a fact in a Your details section (not auto-undoable) |
| `dismiss_question` `{key}` | Hides a question ("not for me"); nothing is deleted | A question that is not open |
| `list_my_changes` | The AI's own changes: id, time, question, before → after, undone or not | — (read-only) |

**Your details** questions cannot be answered by the AI yet, only dismissed (update tool parked as JOB-249).

## Limits and safety

- 60 write calls per 10 minutes (accepted or refused), so a looping AI is stopped.
- The change list keeps the last 200 changes; each shows before → after and an **Undo** button (refused if the person changed the value since).
- The AI never submits an application, never changes Settings, never sees passwords, keys or the LinkedIn session, never reads job posting texts.
- Tests, the demo and the smoke run never start the helper file.
- A refusal text from the app is shown to the AI as untrusted data.

## Where the person sees it

| Screen | What |
|---|---|
| Profile → What we learned | Banner: Connect Claude → waiting → "Claude is connected · Last used…" with Disconnect; strip **Changes by Claude** with Undo |
| Settings → Connections | Card "Claude desktop app" with the state, Connect or Disconnect |
| ⌘K | Connect Claude, Disconnect Claude |
