# Desktop AI spike (PR 1/6): does Claude Desktop install our helper, and can the helper keep a secret?

> **Verdict:** a 3 KB test helper (`jobadabra-spike.mcpb`, one tool `ping`, changes nothing, reads no Jobadabra data) answers three questions the
> [MCP spec](../../../docs/superpowers/specs/2026-11-03-desktop-ai-mcp-design.md) could not: (1) does opening the file start Claude's own install window,
> (2) does Claude ask before running a tool, (3) can a helper started by Claude use the computer's secret store.
> Mac side measured without opening Claude. **Windows side needs one person with the Claude desktop app and 5 minutes.**

## For the person on Windows (5 minutes, nothing to install, no account of ours)

1. Put this whole folder (or just `jobadabra-spike.mcpb` and `windows-spike.ps1`) on the PC.
2. Open PowerShell in the folder and run: `powershell -ExecutionPolicy Bypass -File .\windows-spike.ps1`
3. The script prints facts, tests Windows' secret protection, then **opens the helper file**. Answer its 4 questions. When Claude shows its install window, read it, then press **Install**.
4. In a new Claude chat type: `Use the ping tool from the Jobadabra spike.` Paste the result when the script asks.
5. Send back `spike-result.txt` from your Desktop. Remove the helper: Claude → Settings → Extensions → Jobadabra spike → Uninstall.

It does not sign in anywhere, does not change Claude's settings and leaves nothing in your user folder.

### What you should see (and what each answer decides)

| Step | Expected | If not |
|---|---|---|
| `Claude Desktop found` | a path or a Store package | install Claude Desktop first; the test cannot run |
| `File type .mcpb` | `.mcpb=...` (Claude registers it) | the Connect button must show "drag the file into Claude" instead of opening it |
| `DPAPI round trip: OK; blob hides the value: yes` | OK, yes | the bridge cannot use DPAPI at all: ask the owner (file fallback needs his sign-off) |
| Q1 | an install window appears by itself | "Claude opened but no install window": Connect = open the file **and** say "press Install in Claude" |
| Q2 | tool name `ping`, what it can do | whatever it lists is what the person sees before Install: our wording must match |
| Q3 | any answer, we just record it | "no": we cannot rely on Claude as a second gate; our own checks stay the only gate (they already are) |
| Q4 ping JSON | `secretStore.ok: true`, `loopback.reached: true` | `secretStore.ok: false` means Claude's sandbox blocks PowerShell for the helper: the fallback needs the owner's sign-off |

## For us (Mac and CI)

- Build: `node build.mjs --out <folder>` → `jobadabra-spike.mcpb` (jszip, same as the app; `manifest.json` is the one source; the Windows script packs the same file).
- Test: `node --test desktop/test/desktop-ai-spike.test.js` (bundle shape, tools/list, tools/call; the secret store probe is off in tests).
- **Never open the built file in the owner's Claude Desktop** and never sign in to it: the Mac side is measured without it (below).

## Measured so far (3 Nov 2026)

| Unknown | Mac | Windows |
|---|---|---|
| Is the `.mcpb` type registered to Claude? | **Yes.** `Claude.app` declares document types `mcpb` and `dxt` with rank **Owner** (read from its Info.plist and LaunchServices; nothing was opened). So `shell.openPath(file.mcpb)` goes to Claude. | pending (script line `File type .mcpb`) |
| Does opening it show the install window? | **Not measured** (needs a Claude account that is not the owner's) | pending (Q1) |
| Does Claude ask before each tool call? | not measured | pending (Q3) |
| Can the bridge's code use the OS secret store? | **Yes**, when the bridge runs under plain Node: add, read back and delete a Keychain item with `/usr/bin/security`, no leftover (the same probe `ping` runs). **Inside Claude's sandbox: not measured.** | DPAPI line + Q4 pending |
| Can the bridge reach `127.0.0.1`? | **Yes** under plain Node (connection refused by a closed port = the call left the process). Inside Claude: not measured. | Q4 pending |
| Does `@anthropic-ai/mcpb validate` accept the manifest? | **Not run**: running the package from npm was blocked by the session's permission check. The manifest follows MANIFEST.md (required fields, `server.type: node`, `tools`, `compatibility.platforms`); the owner may run `npx @anthropic-ai/mcpb validate manifest.json` himself. | n/a |
