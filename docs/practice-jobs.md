# Practice jobs: Full automation end to end, no real application

> **Verdict:** to see Full automation go from Apply to Submit without sending anything to an employer, run `cd desktop && npm run practice`. Dev builds only; not in any installer. (Owner, 7 Nov 2026: "how can we simulate the full automation, but without sending real applications?")

A second, throwaway app (its own window, port and folder in the temp folder) whose Jobs list holds 12 practice jobs made from our recorded employer pages. Full automation runs for real, Submit included; the Submit lands in a catcher on this computer, and the job's **Application → Practice** shows what it received.

## Try it
1. `cd desktop && npm run practice` (the terminal prints "host rule proven", then where the jobs are).
2. Jobs → filter **Saved**: the 12 "Practice · …" jobs (the default New matches list is for jobs a search found).
3. Settings → AI: choose the AI that answers (the practice app starts with none chosen unless Claude Code is signed in); Settings → Apply → **Full automation** (you confirm it, as in the real app).
4. Press Apply on a practice job. When it submits: the terminal prints `CAUGHT <host><path>: field=value, …`, and the job's **Application → Practice** lists when, how and every field as sent (a password shows `[hidden]`).
5. Ctrl-C ends it and removes its lock and certificate files.

## What is real and what is not
| | In practice |
|---|---|
| The app, the extension, the fill, Full automation's checks and its Submit press | real |
| The employer's page | a recorded page served from this computer at its recorded address |
| The Submit | caught by `desktop/practice/server.js`; never leaves this computer |
| The AI | the person's own (a Claude Code session or Free AI): real calls, real cost |
| Find jobs, engine page fetches | **not confined**: they read public sites (never submit) |
| The owner's app, Chrome, Keychain, store, port 47111 | never touched (own folder; the e2e-mode isolation) |

## Why it is safe
- **Folder:** starts only on `<temp>/jobadabra-practice`, refused on any real data folder (`practice/gate.js`).
- **Names:** every job's pages are on names the IANA keeps for examples (`example.com/.org/.net`, `*.example`, `*.test`, `*.invalid`), at addresses no other job uses (`practice/jobs.js`).
- **Resolver:** the hidden browser maps those names to the local server and every other name fails to resolve; at start a real public name must fail and a practice page must load, or practice refuses to start (`practice/launch.mjs`).
- **Chrome:** `open` and `osascript` are replaced by stand-ins, so the person's own Chrome is not driven.
- **Release:** `practice/` is not in `build.files`; the banner and the Practice part need an e2e-mode, unpackaged app started with the launcher's ledger variable (`lib/practice-mode.js`). Guards: `test/guards/safety/practice-isolation.test.js`, `practice-catcher.test.js`.

## Limits
- IP-literal addresses are not probed; a system proxy could bypass the resolver rule; the engine's own fetching is not confined.
- A Submit seen only as the form's own POST (no script report) matches its job only by path.
- Parked as one Work board draft: "Practice jobs: harden isolation (realpath, HOME, proxy, IP literals, engine network)".

## For Claude Desktop (testing through the app's own screens)
Same steps as "Try it", in the practice window. Report what the job's Application → Practice shows. A practice run proves the Submit step; it does not prove a real employer's form accepts it.

## Where the code is
`desktop/practice/` (server, shim, gate, jobs, launcher), `desktop/lib/practice-mode.js` (the window's side), `desktop/renderer/practice.js` and `renderer/job-drawer/application-practice.js` (the banner and the Practice part). Spec: [2026-11-07-practice-jobs-design.md](superpowers/specs/2026-11-07-practice-jobs-design.md).
