# Guided setup of the user's own AI plan (Claude Code, Codex): design

> **Verdict:** a Windows tester with only the Claude Desktop app saw "Not found on this PC" and a wall of folders; a second one installed Claude Code and still saw "Not signed in", and an "API key ✓ Connected" nobody set. One owner now says what the computer has; the chooser draws one calm card per state with one next step; "Connected" and "signed in" come from a real check, never from "something is saved".

**Why (2 Nov 2026, owner):** "So the user has only Claude Desktop installed, but not Claude CLI. How can we handle this properly. How can we check all the scenarios. How to guide user." · "We need to do 2 things. One to fix the bug. Second is to make sure we have a way to catch these bugs." · "It should be both Windows and Mac. Both Claude and ChatGPT. We should never show a raw error. If the user has ChatGPT desktop or Claude Desktop, we should say explicitly: we detected the app, but the CLI is still missing. Please install using this guide." · "how it can show Connected on the API key if no API is set… how on the Claude Subscription CLI is not detecting as connected when it should be".
This screen had 5 fixes in 30 days (ab13bccb, c52d1c10, 46f072cf and the two testers), so this is a redesign, not a patch: the `Design:` block below is the intended behaviour.

## Progress
- [x] 1/2 (#3014, merged 2 Nov 2026) States, detection (the chat apps, the chosen file), words, the CLI's own sign-in answer, the API-key fix, field counter, per-state tests (proof: desktop/test/plan-readiness.test.js @267b1c1)
- [ ] 2/2 In-app install with progress and Cancel (Claude Code, Codex, Git), in-app Sign in, a real Windows and Mac CI check (this PR: handlers, card, tests, `ai-setup` job; evidence = one dispatch)

## 2/2 Design: Install, Sign in, a real machine
**Two buttons, one runner (`lib/plan-install.js`).** Install (Claude Code, Codex; Git for Windows through winget, else the official page opens) and Sign in (`claude auth login`, `codex login`: the CLI opens its own page in the person's browser). One run at a time (`planInstall`, `planSignIn`, `planCancel` in `lib/plan-handlers.js`); the window gets a verdict (`ok`, or `failed | not-found | timeout | cancelled | busy | unsupported`) and the new status, never the process's text. While it runs the card shows the title, an indeterminate bar, the seconds and Cancel (`renderer/ai-plan-card.js progressCard`). A failed install is one plain sentence and the manual steps; a cancel is silent. A hang guard (10 min install, 5 min sign-in) only frees the next press. The end-to-end run and the demo never start a real installer or login.
**The verdicts that leave a state stay the same:** the install ends -> the files are read again (Windows PATH refreshed) -> `checking` -> the CLI's own answer; the sign-in ends -> `verify` -> the CLI's own answer.
**Real machines:** job `ai-setup` in `fresh-install-smoke.yml` (daily, report only; a8's asks: own timeouts, `contents: read`, first red line names row and step): Windows and macOS x Claude Code and Codex: `nothing`, `app-only` (a planted marker), and the app's own installer for real then `sign-in` from the CLI's real answer. `desktop/scripts/plan-machine.mjs`.

## Design:
**One owner.** `lib/plan-readiness.js`: `facts(family, deps)` reads the computer (files, no AI call); `readiness(facts)` is pure and returns ONE state. The chooser only draws it (`renderer/ai-plan-guide.js` words, `ai-plan-card.js` box). `family` is `claude` (Claude Code, a Claude plan) or `openai` (Codex, a ChatGPT plan); Windows and Mac behave the same, only the install line differs.

| State | What the computer has | The card says | One next step | A verdict that leaves it |
|---|---|---|---|---|
| `checking` | the CLI, never checked | "Checking Claude Code…" | none (the chooser checks by itself) | the check ends |
| `ready` | CLI found, signed in, answers | "Ready: uses your Claude plan" | none | CLI removed / signed out |
| `limit` | ready, plan limit reached | "Ready. Your plan's limit is reached for now" | none (tasks retry: today's rule) | the limit resets |
| `app-only` | the chat app (Claude Desktop, ChatGPT app), no CLI | "We found the Claude Desktop app on this computer, but Claude Code (its command-line part) is still missing." + 3 numbered steps with the official line for this system | Install (2/2: in-app; 1/2: opens the official page) | the CLI appears |
| `nothing` | neither | "Claude Code is not on this computer yet." + the same steps; "No Claude plan? Use Free AI or an API key." | Install, or Use Free AI | CLI appears / Free picked |
| `sign-in` | CLI found, its own `auth status` says signed out | "Claude Code is installed. Sign in with your Claude account." | Sign in (2/2 opens Anthropic's page; focus re-checks) | the CLI says signed in |
| `needs-git` | a real check failed with Claude Code's git-bash message (Windows) | "Claude Code needs Git for Windows." | Install Git | the next check passes |
| `elsewhere` | the file the person chose is gone | "The Claude Code file you chose is no longer there." | Choose claude.exe | a file is found/chosen |
| `broken` | the CLI file is there but `--version` fails | "Claude Code is on this computer but did not start." + install steps | Install again | it starts |
| `check-failed` | a check ended some other way (network, timeout, a contradiction) | "We could not check Claude Code just now." | Check again | the next check |

**Verdicts (only these change a state):** the files on the computer (read on open, on window focus, every few seconds while a CLI is missing); the CLI's own sign-in answer (`claude auth status --json` / `codex login status`: free, no model call; only `loggedIn` is read); one tiny AI call when signed in (proves it answers; reports the plan limit); the person's own file pick; the person's own Install / Sign in (2/2). "Choose claude.exe" is also a quiet link under `app-only`/`nothing`/`broken`: only the person knows it is installed somewhere else.
**No guessing:** signed in is never read from `~/.claude.json`; if the CLI says signed in but the AI call says signed out, that is `check-failed` with the raw words kept for "Copy details for support", not a sign-in screen.
**Git for Windows is optional** for Claude Code (code.claude.com/docs/en/setup, 2 Nov 2026: without it Claude Code uses PowerShell), so a missing Git never blocks; `needs-git` appears only when a real check says so.
**Never a raw error:** every outcome of detection, Verify, the picker and (2/2) install maps to a state above; the screen holds no path, exit code, folder list or CLI message. Raw detail lives in `settings.claudeCode.error`/`codex.error` and "Copy details for support" (folders searched, the file found, the last check's words).
**Chat apps found:** Windows `%LOCALAPPDATA%\AnthropicClaude`, `Programs\Claude`, `%ProgramFiles%\Claude`, a `Claude_*` Store package (ChatGPT: `Programs\ChatGPT`, `OpenAI.ChatGPT*`/`OpenAI.Codex*` packages); Mac `/Applications` or `~/Applications` `Claude.app` (`ChatGPT.app`, `Codex.app`). A `claude.exe` inside the chat app's own folder is never taken for Claude Code.
**Install lines (official, shown as steps; 2/2 runs them):** Claude Code — Mac `curl -fsSL https://claude.ai/install.sh | bash`, Windows `irm https://claude.ai/install.ps1 | iex`. Codex — Mac `curl -fsSL https://chatgpt.com/codex/install.sh | sh`, Windows `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"`. Per user, no administrator. Never bundled in our installer; Jobadabra never types or stores a password.

## The API key card ("✓ Connected" nobody set)
Root cause (hypothesis until the tester's `aiFree` line is seen): Free AI keeps its token `JPF1.<install>.<token>` in the same slot as the person's Anthropic key (`lib/ai-free.js:31,37`), and Settings drew "✓ Connected" and `••••CwAA · saved` from the slot being non-empty. Fix: the window state carries `ownSecrets` (a Free token is not their key) and the hint skips it (`lib/secrets.js`, `test/own-secrets.test.js`). A key the person types is checked by `checkAnthropic` before it is saved, so "Connected" on a typed key already follows a real check. Parked as JOB-225: the old GitHub "Always on" checklist (`pages/connections.js:130-150`) still says GitHub needs an API key.

## Words that were outdated
"Scheduled runs in your GitHub repository (Always on) still use your API key" → "Always on (on our servers) uses Jobadabra's own AI, not your plan" in `claude-code.js`, `ai-engine-view.js` (note, notice, Codex twins) and the two Settings lines in `index.html`; a test scans for the old sentences.

## How we catch this class
| Catch | Where | Catches |
|---|---|---|
| Per-state tests on fake computers | `test/plan-readiness.test.js` | every state from files alone, Windows + Mac, Claude + Codex; the chat app's own claude.exe; the CLI's sign-in answer beats a missing `.claude.json` |
| Words | `test/ai-plan-guide.test.js` | every state × family × system × button mode has one next step and no path, exit code, folder list or winget; the official lines; the outdated Always on sentence |
| Handlers on fake computers | `integration/app/ai-plan-states.test.js` | 20 scenarios through the real IPC; every failure kind a check can return maps to a named state; no raw text in the status; one counted event per state; the picker refuses the chat app's file |
| The CLI's answer | `test/plan-login.test.js`, `test/claude-code.test.js` | signed out makes no AI call; the contradiction is `check-failed`; the e-mail the CLI prints is never kept |
| API key card | `test/own-secrets.test.js` | a Free token is not "Connected" |
| In the field | PostHog `ai_setup_state` {family, state, os}, once per state per start, through `lib/analytics.js` (consent: the existing "Technical reports" switch, on by default, Settings → Advanced; no path, no name) | how many people sit at `app-only` before a tester tells us |
| Real machines (2/2) | machine-setup rows in `.github/workflows/fresh-install-smoke.yml` (owner, 2 Nov 2026: "yes. Let's do"; a8 owns the file and plans the rows with this session): a Windows and a macOS runner with the chat app only / nothing / the official installer run (no sign-in) for Claude Code and Codex; the installed app must show `app-only` / `nothing` / found. No new pipeline | the installers moving their folder under us; the app's states on a real machine |
| Old settings (a8) | an `upgrade-data.yml` case: a JPF1 token in the API key slot; the API key card must not say Connected | the 2 Nov "Connected" bug on an upgraded install |

**Gate math ("Gate only if it pays"):** this screen escaped on Windows 5 times since 9 Oct (ab13bccb registry PATH; c52d1c10 "Mac" words on a PC; 46f072cf installed while running; the 2 Nov tester with only the Claude app; the 2 Nov tester with a found-but-"not signed in" CLI) ≥ 2, so the real-machine job pays.
**Existing tests that asserted the opposite:** `test/claude-code.test.js` (the old "not installed" text and "signed out" via the AI call's words), `test/fresh-path.test.js` (the handlers lived in `setup-handlers.js`). Changed with the behaviour.

## Safety (unchanged, restated)
Anthropic's and OpenAI's official installers only. The CLI's sign-in is their page in the person's browser. The CLI's printed e-mail, plan and ids are never read or kept. Tests never use a real login, `~/.claude.json` or `~/.codex`.
