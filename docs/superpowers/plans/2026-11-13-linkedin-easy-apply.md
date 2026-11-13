# LinkedIn Easy Apply on the person's computer: plan

Verdict: the owner picked "Also auto-apply on the Mac" (13 Nov 2026). Before any sending, a chip marks the jobs that need an account, and a spec puts the sending decisions to the owner.

Owner's words (13 Nov 2026): "What about the \"Easy apply\" jobs or the ones that don't have a real employer site job posting, but only the linkedin ad..." · "Can we handle those ones ?" · "Let's somehow mark the jobs that requires an account. Especially the ones requiring user's Linkedin account for applying. Let's add a chip to that job."

## PRs (`[ea] n/N`)
| # | What the person gets | Waits on |
|---|---|---|
| ✅ 1/3 (#3997) | An amber "Account needed" chip on jobs whose application page asks for a sign-in or a new account (list, board, job page); checked rows keep their check after a restart | nothing |
| 2/3 | A "LinkedIn account" chip on Easy Apply jobs, from the moment they are found | lg's Easy Apply marker on the found rows (one marker, never a second) |
| ✅ 3/3 (#4001) | The Easy Apply spec `docs/superpowers/specs/2026-11-13-linkedin-easy-apply-design.md` with the owner's D1–D6 answers (13 Nov 2026): follow the Apply mode, 15/day 2 min apart, stop 24 h on LinkedIn's first warning (the one shared pause, lib/linkedin-session.js), the full warning text, the Answers setting, jobs in an Apply batch. The sending PRs are named next | nothing |

## Sending PRs (`[ea] n/5`; owner, 13 Nov 2026: "Start 1/5 now (Recommended)")
| # | What the person gets | Waits on |
|---|---|---|
| 1/5 (#4008) | A "LinkedIn Easy Apply" switch in Settings → Connections beside LinkedIn jobs and in ⌘K, off by default; the D4 warning once; LinkedIn jobs first when it holds no sign-in; dev builds only until 4/5 (owner, 13 Nov 2026: "Dev builds only until 4/5", "LinkedIn jobs first", "Yes, build it") | nothing |
| 2/5 (this) | The limits: 15 sends a day, 2 min apart (D2); any LinkedIn warning stops all LinkedIn 24 h through the shared pause, a second stop turns Easy Apply off (D3); `notePause` keeps the later time and switching LinkedIn jobs off keeps the pause (lg agreed, 13 Nov 2026) | 1/5 |
| 3/5 | One real Easy Apply page recorded with the owner's account, stopped before Send (owner: "You an use mine, but avodiing sending"); the recorded stand-in for the tests | none: recorded 13 Nov 2026 after one guest probe returned 200 (owner: "we can do a small test/request to see if the blocking is still there"); `desktop/e2e/recorded/linkedin-easy-apply-dialog-1` |
| 4a-1 (this) | The panel stays on top of anything a page shows, any popup, where the person can press it (owner, 13 Nov 2026: "it should be always on top of anything else on the website" · "on any popop"): every Jobadabra layer is a top-layer popover, raised again after a page popover, modal or fullscreen, and moved into an open modal dialog (LinkedIn opens Easy Apply with `showModal()`, which made the panel inert behind it; `extension/panel-top-layer.js`); there the panel shows as its pill until the person opens it, so the card never covers the dialog's Next (owner, 13 Nov 2026, asked via AskUserQuestion: "Lift the panel above modals", then with screenshots "3. As a pill (Recommended)"); #4026's Gitar suggestions (owner: "push the suggestions from this PR in the next one") | 3/5 |
| 4a-2 | Fill to ready, never send: an Easy Apply job runs in all 3 apply modes like any other site (owner, 13 Nov 2026: "Background browser + Extesion... It should just support all 3 apply modes. like any other website. nothing custom/special here"); Background and Full automation in the hidden browser with the LinkedIn session copied into the batch's short-lived profile, Standard in the person's Chrome; D3's stop wired; the panel says which step it is on, never "Ready to submit" before the step whose button sends (the stand-in's step 2 of 4 reads "Ready to submit" today, seen 13 Nov 2026 in 4a-1's replay); the row shown in every build (owner: "4a fill, 4b send (Recommended)") | 4a-1 |
| 4b | Sending: D1's "LinkedIn may send" confirmation stamped on each Full automation item (owner: "In 4/5, with the sending"); LinkedIn's turn in the Submit permit; the 15 a day count (D2); Submit only through the existing gate | 4a-2 |
| 5/5 | The owner's proof run on his account, no send; the CLAUDE.md LinkedIn line quoting D1–D6 | 4b |

## Rules that bind every PR
- The LinkedIn session stays on the person's computer; Easy Apply runs only in the desktop app, never in Always on or on a server.
- No live Easy Apply send by an agent, ever; tests use a fake Easy Apply flow on a stand-in host. The one by-hand proof (3/5, 5/5) uses the owner's account and stops before Send, enforced in code (no Submit permit).
- The CLAUDE.md "LinkedIn jobs" line changes only with the owner's words in the commit.
