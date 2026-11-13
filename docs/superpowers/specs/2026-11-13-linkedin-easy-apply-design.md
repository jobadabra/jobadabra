# LinkedIn Easy Apply, sent by the app on the person's computer: design

> **Verdict (owner's answers, 13 Nov 2026):** Easy Apply jobs go through the same Apply batch and the same three modes as every other job. Only the desktop app does it, in the person's own LinkedIn session, which never leaves their computer. Off by default, behind one LinkedIn switch with a one-time warning. At most 15 sends a day, 2 min apart. Any LinkedIn warning stops all LinkedIn work for 24 h, through the one shared LinkedIn pause; a second stop turns the switch off.

Owner (13 Nov 2026): "What about the \"Easy apply\" jobs or the ones that don't have a real employer site job posting, but only the linkedin ad..." · "Can we handle those ones ?" · picked **"Also auto-apply on the Mac"** (asked via AskUserQuestion: "The app fills and sends Easy Apply in the person's own signed-in LinkedIn on their computer (LazyApply and AIApply do this). Its own project with a spec. LinkedIn's terms forbid automation, and it can restrict the person's account; we'd own that risk.").
Plan: [`docs/superpowers/plans/2026-11-13-linkedin-easy-apply.md`](../plans/2026-11-13-linkedin-easy-apply.md).

## Problem
- Some jobs exist only as a LinkedIn ad with Easy Apply: there is no employer page to apply on. Today the app cannot apply to them. The page sketch refuses "applying through another site's account (LinkedIn, Indeed, Google)" (`desktop/lib/ladder/rung2-sketch.js:79`), so such a job ends at "Needs you" or "no form".
- Competitors (LazyApply, AIApply, JobCopilot) sell exactly this: Easy Apply filled and sent in the person's LinkedIn. (From their public pages; the Notion "Market & Competitors" page was not read in this session.)
- How many jobs this serves is **not measured yet**. It needs lg's marker to say `linkedin` on found rows (lg adds that value after it has recorded one real Easy Apply page). The count for the 18 fixed people is the first line of PR 3/3's "who gets what". Until then, value is unknown.

## Behaviour
- **Where:** only the desktop app (Mac/Windows). Never Always on, never a server, never the cloud browser (owner, 13 Nov 2026: credentials stay on the device).
- **Session:** the same LinkedIn session the LinkedIn jobs read already holds (Keychain, `lib/linkedin-session.js`). It enters only a short-lived profile the step owns (`lib/linkedin-browser.js` READ_FOLDER) and is deleted with it, as the read does today.
- **Browser:** honest user agent, no stealth plugin, no disguise. If LinkedIn will not let an honest browser send, we STOP and ask the owner. We never work around it.
- **Filling:** the same fill as every form. Fields are seen, the AI judges each meaning, then the field is filled. The Easy Apply dialog is a multi-step form, and each step is a page of the ladder. No LinkedIn-specific rule tree; a wrong answer is fixed as data.
- **Sending:** only through the existing Submit gate (`lib/submit-proof.js`, the item's own mode stamp), plus the LinkedIn cap and stops below.
- **The one-time warning:** shown when the switch is turned on (D4). The switch lives in Settings → Connections, beside "LinkedIn jobs".
- **Who sees what:** each sent or stopped Easy Apply job is listed in Recent activity. A LinkedIn stop says why and until when.

## The owner's decisions (13 Nov 2026, asked via AskUserQuestion with the decision sketch open; exact labels)
| # | Decision | Owner's answer | What it means |
|---|---|---|---|
| D1 | Review before send, or send on its own | "Follow the Apply mode (Recommended)" | Standard and Background wait for the person's Submit. Full automation sends, after one extra "LinkedIn may send" confirmation (stamped like `autoConfirmedAt`). |
| D2 | Daily cap and pacing | "15/day, 2 min apart (Recommended)" | At most 15 sends a day per install, at least 2 min between sends. A fixed gap, never a random human-like delay (that would be disguise). |
| D3 | What stops it | "Stop 24 h" (not the recommended 7 days) | Any LinkedIn warning, checkpoint, "unusual activity", sign-in page or 401/403/429/999 stops ALL LinkedIn work (reads and sends) for 24 h and tells the person. A second stop turns the switch off. |
| D4 | The warning, once | "Full text (Recommended)" | "Easy Apply sends applications from your own LinkedIn account. LinkedIn's terms do not allow automated applying, and LinkedIn may limit or restrict your account. Jobadabra sends at most 15 a day and stops at LinkedIn's first warning. Off by default. Turn on?" with "Turn on" / "Not now". |
| D5 | A question the profile cannot answer | "Follow the Answers setting (Recommended)" | "Only facts" waits for the person (job in "Needs you" with its questions, the answer saved for next time); "Let AI guess" lets the AI answer judgement questions from the profile, never invent a fact (years, salary, a licence, a visa). |
| D6 | Which jobs | "Jobs in an Apply batch (Recommended)" | The jobs the person puts in an Apply batch, like any job; Full automation's own picks keep the fit bar. |

## One LinkedIn pause (D3)
- The one owner is `desktop/lib/linkedin-session.js`: one `pauseUntil` time, written by `notePause(storage, until)` and read by `pausedUntil(storage)` (lg's #3998: a 429/999 on either LinkedIn read pauses both). The guest read (`lib/linkedin-guest-on.js`) and the signed-in read (`lib/linkedin-headless.js`) both check it before their first request.
- Easy Apply adds no second pause. A D3 stop calls `notePause(now + 24 h)` and checks `pausedUntil` before its first request, so it also pauses both reads, and a read's pause also holds Easy Apply.
- "A second stop turns the switch off" is Easy Apply's own state: its switch and a stop count kept beside it in the Easy Apply settings, not in the pause. The person turns the switch on again and sees the warning again.
- A later shorter pause never shortens a longer one in practice: no LinkedIn step runs while `pausedUntil` is in the future, so none writes a pause then.

## States of one Easy Apply application (one owner: a new `desktop/lib/linkedin-easy-apply.js` controller; verdicts from the AI)
`queued` → `opening` (the job page in the owned browser) → `step k` (the dialog's step, filled) → `ready` (the page proof holds: every required field filled, a send button, no check) → `sent` (the AI reads LinkedIn's confirmation) — or `needs-you` (D5, a check, an unknown step) — or `stopped` (D3: the shared LinkedIn pause, 24 h; Recent activity says until when).
- Verdicts that move it: the form judge (`lib/form-judge.js`) for each step, the Submit gate for `ready → sent`, and LinkedIn's own answer for `stopped`.
- One cap counter per install (sends today, last send time) in settings, read by the controller only.

## Acceptance criteria
- An Easy Apply job in a batch reaches `sent` in Full automation, and `ready` with the person's Submit press in Standard/Background. Proven on a recorded fake Easy Apply flow on a stand-in host; never on LinkedIn by an agent.
- The 16th send in a day waits until the next day, and the cap test plays it.
- Every stop page in D3 (recorded stand-ins) sets the shared LinkedIn pause to 24 h; a guard test asserts no retry and no LinkedIn request from any step (guest read, signed-in read, Easy Apply) until it ends; a second stop turns the switch off.
- The session is never in a log, the store, an upload or a disk profile after the step (the existing LinkedIn guards extend to this step).
- Off by default; the switch shows the warning once, and turning it off deletes the session as today.

## Non-goals
- "Apply with LinkedIn" buttons on employer sites (Workday etc.): the ladder keeps refusing third-party account routes.
- Indeed, Glassdoor or any other site account.
- Messages to recruiters; LinkedIn profile edits.
- A live Easy Apply send by an agent or a test, ever. The owner's own first send is on a job he picks.

## What changes outside code
- CLAUDE.md "LinkedIn jobs" line gains the Easy Apply exception in the PR that builds the sending (not this spec PR), quoting the D1–D6 answers above.
- `rung2-sketch.js:79` stays as it is; Easy Apply is its own route, picked from lg's marker, never from the sketch.

## Progress
- [x] 1/3 "Account needed" chip, checks kept on restart (#3997) (proof: desktop/integration/app/screen-jobs-stored-check.test.js @fdf71c58)
- [ ] 2/3 "LinkedIn account" chip on lg's marker
- [x] Owner's answers to D1–D6 (13 Nov 2026) (proof: none: the owner's answers, asked via AskUserQuestion by the coordinator, quoted word for word in the table above)
- [x] The shared pause's owner: `lib/linkedin-session.js` notePause / pausedUntil (#3998, merged) (proof: desktop/lib/linkedin-session.js @d2c36a8)
- [ ] 3/3 this spec (this PR), then the sending PRs
