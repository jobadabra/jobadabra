# LinkedIn Easy Apply on the person's computer: plan

Verdict: the owner picked "Also auto-apply on the Mac" (13 Nov 2026). Before any sending, a chip marks the jobs that need an account, and a spec puts the sending decisions to the owner.

Owner's words (13 Nov 2026): "What about the \"Easy apply\" jobs or the ones that don't have a real employer site job posting, but only the linkedin ad..." · "Can we handle those ones ?" · "Let's somehow mark the jobs that requires an account. Especially the ones requiring user's Linkedin account for applying. Let's add a chip to that job."

## PRs (`[ea] n/N`)
| # | What the person gets | Waits on |
|---|---|---|
| ✅ 1/3 (#3997) | An amber "Account needed" chip on jobs whose application page asks for a sign-in or a new account (list, board, job page); checked rows keep their check after a restart | nothing |
| 2/3 | A "LinkedIn account" chip on Easy Apply jobs, from the moment they are found | lg's Easy Apply marker on the found rows (one marker, never a second) |
| 3/3 | The Easy Apply spec `docs/superpowers/specs/2026-11-13-linkedin-easy-apply-design.md` with the owner's D1–D6 answers (13 Nov 2026): follow the Apply mode, 15/day 2 min apart, stop 24 h on LinkedIn's first warning (the one shared pause, lib/linkedin-session.js), the full warning text, the Answers setting, jobs in an Apply batch. The sending PRs are named next | nothing |

## Rules that bind every PR
- The LinkedIn session stays on the person's computer; Easy Apply runs only in the desktop app, never in Always on or on a server.
- No live Easy Apply send by an agent, ever; tests use a fake Easy Apply flow on a stand-in host.
- The CLAUDE.md "LinkedIn jobs" line changes only with the owner's words in the commit.
