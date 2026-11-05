# Report instead of leaving (design)

Status: owner said yes 5 Nov 2026 to PRs 1/7 to 6/7; 7/7 is held for the owner's yes (sketch: https://claude.ai/artifact/K7QhaLe5Q9M2dYtDSi89qK). Session `fb`.

## Verdict

- 🟢 Ask for a report only **when something just went wrong**, inline at that spot, never after a success and never as a timed popup.
- 🟢 Every report gets an automatic **"We got it. You will hear from us within 24 hours."** at send; /admin shows a due / overdue chip so the 24 hours is visible.
- 🟢 A report **we validate as a bug** earns **5 free applications**, in the "fixed" message only (a surprise, never advertised). No cap; one grant per report.
- 🟢 One owner decides whether any card may show (the ask gate); every prompt passes it.
- 🟡 Held: 7/7, the "Enjoying Jobadabra?" card (needs the e-mail types split on the site, built by `hr`), and the check-in e-mail to people who stopped applying (outside the n/7 count; needs the owner again).

Owner, 5 Nov 2026: "how we can encourage users (or tell them about the existence of send feeback button). We'd like to encourage them to report bugs/problems.." · "I'd just want to make sure that they don't stop using the app because something is nt working as expected or is hard to use" · "But instead submit bug and have the promise that it willl get fixed in 24h-48h". Answers to the sketch: promise "Within 24 hours (Recommended)"; the engagement card "First application and + 3 day fallback it's a good idae" with both news boxes ticked by default and no promotional mail before the person has seen and acknowledged the card; thank-you "As long as the feedback is validated on our side, and we acknoweledge it as a problem/bug. Then it's unlimited."

## Design:

One owner per state; the verdicts that change it.

| State | One owner | Changed only by |
|---|---|---|
| May a card show now? | `desktop/lib/asks.js` (settings `asks`: `lastAskAt`, `snoozed{kind: until}`, `done{kind}`) | `mayAsk(kind, now, context)`; `asked(kind)`; `snooze(kind)`; `answered(kind)` |
| A report's receipt and its 24 h clock | site `shared/feedback-reply.js` (derived from `feedback.at`, no new state) | `repliesFor` returns a `received` reply while the report has no owner reply; the admin chip is computed from `at` |
| The thank-you grant | site `shared/feedback-actions.js` (the only writer of feedback state) stamps `feedback.thanks_at` once, in the same write that tells the reporter (`tellOnce`); the install's bonus is the sum of `thanks_apps` over its stamped rows (no counter to drift) | the Fixed action with "thank-you" ticked (on by default; off for duplicate and false positive) |
| The extra applications an install may use | site `shared/trial.js` (`trial:bonus:<who>` in KV, added once per ref) | the grant; the app reads `bonus` from `/api/trial/status` and adds it to the limit (`desktop/lib/license.js`) |

Verdicts of `mayAsk`:

- **No** during setup, while another card is showing, within 24 hours of any ask, for a kind snoozed (14 days after "Not now") or answered, after a success.
- **Yes** only for a moment: application stuck / failed / taken over; Find jobs failed; the AI did not answer; the app crashed last time; a finished search with fewer than 5 jobs in the person's places (once a week at most; the threshold is a guess from 2 testers' searches, measured on real users for two weeks and then tuned).
- The card's button opens the existing Send feedback dialog on that screen (screenshot, redacted logs, the screen's data); nothing is typed unless the person wants to.

Words (confident): "We read every report and write back within a day." Never "help us fix our bugs", never a timed popup. The sentence ships only once the receipt card is live (1/7), so it is true on day one.

## What was measured (5 Nov 2026)

| Question | Answer |
|---|---|
| Reports ever | 8, from 1 install (3 to 5 Nov) |
| Reporter heard back within 24 h | 1 of 8 (14.8 h); 4 later (26 h to 48 h); 3 never |
| Report to marked fixed | median 26 h, 3 h to 54 h; 7 of 8 within 48 h |
| Leavers (stopped applying) | **not measurable**: telemetry has no application event; the trial KV knows 4 installs, 2 applied |
| Searches that came back thin | 27 of 28 finished searches, 2 installs, two small Swiss cities |
| Weekend replies | no data (all reports Tue to Thu) |

## Plan (PR titles `[fb] n/7 <what>`)

| # | Repo | What the owner gets |
|---|---|---|
| 1/7 | site | "We got it" receipt in the app's reply card, due / overdue chip in /admin, the overdue ping through `nt`'s registry (no new sender) |
| 1b | site | **Owner, 5 Nov 2026, "Yes, short and kind (Recommended)":** a dismissed or false-positive report gets one short closing reply (e.g. "Thanks, we looked into this and it isn't something we'll change"), editable before it goes, through the existing `feedback-update` path so the 24 h chip clears. Nothing goes to reporters automatically until the owner has seen the wording |
| 2/7 | site + app | +5 applications: tick on Fixed, `thanks_apps` / `thanks_at`, `/api/trial/status` returns `bonus`, the allowance adds it, the fixed card says it |
| 3/7 | app | The ask gate, and the card after an application that failed, stuck or was taken over (tell `ap` first: Applying is theirs) |
| 4/7 | app | Find jobs failed, AI did not answer, crash on last start: same gate, same card |
| 5/7 | app | "Were you expecting more jobs?" after a thin search; the typed role and place only on the person's own press; privacy page updated (tell `gi`) |
| 6/7 | app | A sixth tour stop on the Send feedback icon (`desktop/renderer/menu-tour.js`), after 1/7 |
| 7/7 | app | **Held.** The "Enjoying Jobadabra?" card: Yes shows the three news boxes (New releases ticked, Job digest and Tips and tricks empty), Not really shows "What got in the way?". Lands after `hr`'s four e-mail lists (web #436) and the owner's yes on the final wording |

Held, each needs the owner again:

- **7/7 "Enjoying Jobadabra?" card** (first application, or 3 separate days of use; Yes shows **New releases** (ticked), **Job digest** and **Tips and tricks** (both empty); Not really shows "What got in the way?"). Owner, 5 Nov 2026: "we should not treat all the emails as one box. There are 1. service mails (user own activity, kind of functional mails, not promotaionl/marketing) 2. New releases 3. Tips and Tricks (these are the most promotional/marketing ones)", then "this should be on by default. Only \"Tips and tricks\" should be disabled by default". So three kinds of e-mail, three lists: `service` (as today, #3282's switch), `releases` (**on by default**: the card and Settings show it on) and `tips` (**off by default**, nothing sent until the person ticks it). Save on the card is the answer.
  - **A fourth kind, Job digest (owner via the coordinator, 5 Nov 2026, journey sketch):** "Its own kind, off until ticked (Recommended)": its own list `jobdigest`, **off by default**, nothing sent until the person ticks it, shown in the card and in Settings beside the other two. And the first release mail goes only after the person has answered the card: "After they've seen the card (Recommended)" (the `newsAnswered` gate, added by `hr` to web #436; release mail is held until `newsAnswered` is true, or the person is a website waitlist signup under the new wording; `GET releases` still shows true for a confirmed address, so the card opens ticked).
  - **Field names, agreed with `hr` (5 Nov 2026):** list ids `service`, `releases`, `tips` and `jobdigest` (the fourth kind; `hr` did not call it `digest` because the site already has a `digest` template and a `cadence` field for the Always on digest). `GET /api/account/email` returns flat `releases: bool`, `tips: bool`, `jobdigest: bool`, `newsAnswered: bool`; `PUT` takes `releases`, `tips` and/or `jobdigest` plus `newsVia: 'card' | 'settings'`; a missing field changes nothing; `marketing` stays only for apps already out. The site keeps one row per address and type (yes or no, when, via), so "asked, all off" differs from "never asked"; `newsAnswered` is true once a `releases` or `tips` row exists (a `jobdigest` row never counts: it is its own switch, only on a confirmed address, and its stop link stops it alone, as `hr` confirmed 5 Nov). A card answer PUTs all three fields (`releases`, `tips`, `jobdigest`), and only after the person's press: opening or closing the card sends nothing. Each mail's stop link stops its own type.
  - **The app keeps no tick key**: the site owns the answer and the card never returns once `newsAnswered`. An app-side record in the shape of `emailConsent` (date, wording shown, `given: 'default'` when the releases tick was left as it started) is a record only and never decides what a box shows.
  - **Settled with `hr` (5 Nov 2026, owner: New releases on by default everywhere):** `GET` returns `releases: true` for an address with no answer stored and `tips: false` until a real yes; a missing row is a default and nothing is backfilled, so `newsAnswered: false` tells those people apart later; "no news to an address that has not answered" holds for `tips` only; the card shows the three values from `GET` (`releases` true, `tips` and `jobdigest` false until a real yes) and PUTs all three on Save, which sets `newsAnswered`.
  - **Open, the owner's call (neither changes a field name):** whether unconfirmed addresses count for `releases`, and whether a waitlist signup does: it was promised "One email when Pro is ready. No newsletter." (`pricing.html:161`, `privacy.html:131`) and the 28 Oct `mail.js` rule says it agrees to news.
- **Check-in e-mail** to people who stopped applying: #3282's consent sentence ("E-mail me when an application needs me or a strong match comes in. We only write when something needs you.") does not cover it. Needs the wording agreed with `co`, and first the "last applied" date next to the trial's applied count so we can see who stopped.

## Non-goals

No AI spend in any step (every word is fixed). No new gate, hook or CI check. No reply back and forth with the reporter. No fix-time promise yet (measure two weekends first).

## Acceptance

- A new report shows the receipt in the app within one reply-card refresh; a report with an owner reply shows that reply, not the receipt.
- /admin shows "due in N h" and "overdue" from `at` alone; a report older than 24 h with no owner reply is overdue; one with a reply is not.
- Fixed with the thank-you ticked adds 5 to that install's bonus exactly once for that report; Fixed again, Reopen then Fixed, or the release workflow telling it adds nothing; duplicate and false positive grant nothing.
- `mayAsk` returns No for every row of the No list (a loop over the table) and Yes only for the listed moments; a success never asks.
- The failed-application card opens the Send feedback dialog with the screen's data included.
- The tour has six stops when the feedback icon is on screen.

## Progress

- [x] Inventory, measurements and sketch (5 Nov 2026) (proof: none: the numbers are in the "What was measured" table above and the sketch is the Claude Artifact linked at the top; no file of this PR holds more)
- [x] Owner's yes on 1/7 to 6/7 (proof: none: the owner's answers were given in the session on 5 Nov 2026 and are quoted in the Verdict)
- [x] Spec merged (proof: none: #3295 merged 5 Nov 2026 as 2be53d0c; this change only updates the e-mail section)
- [x] 1/7 site: receipt, 24 h chip, overdue ping (proof: none: jobadabra-web #439 merged 5 Nov 2026 as cf720f2; its tests ran on that PR, not on this one)
- [ ] 1b site: closing reply for dismissed and false-positive reports
- [ ] 2/7 site + app: +5 applications
- [ ] 3/7 app: ask gate, failed application card
- [ ] 4/7 app: run failed, AI error, crash
- [ ] 5/7 app: "Were you expecting more jobs?"
- [ ] 6/7 app: tour stop
- [ ] 7/7 held: "Enjoying Jobadabra?" card (after `hr`'s four lists and the owner's yes)
- [ ] Held, outside n/7: check-in e-mail
