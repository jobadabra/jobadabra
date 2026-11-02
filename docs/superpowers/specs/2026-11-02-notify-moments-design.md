# Notifications are offered where they matter

Status: owner decided 2 Nov 2026 — "Let's do the same about the email/telegram notifications. We should show a card in Focus/Jobs... but we also should show a popup/dialog at the right/relevant moments"; then "Add the message, all 4 pop-ups"; "By the time he activated always on, the email/telegram notifications should be obligatory"; confirm link: "Keep it, make it painless"; wizard: "Which is AI -> CV -> Strategy... And that's it." Part 2 of 2 after `2026-11-02-waiting-message-design.md` (merged, #3008). Site part: `jobadabra-web` #333 (Resend).

## Verdict

- 🟢 One word for "can we reach you": a **working channel** = a **confirmed** e-mail address or a **connected** Telegram bot. An address that was typed but never confirmed is not one (the site sends it one mail a day, then holds it).
- 🟢 While there is none, a **card** on Focus and Jobs (the Always on card's pattern: same Suggestions row, `alsoJobs`, Not now hides it 14 days). It has the states of the address: nothing yet / "Check your inbox" + **Resend** / mail stopped / unsubscribed.
- 🟢 **Pop-ups**, each once, never in the wizard (`STEPS` stays `welcome, ai, cv, draft`), never once a channel works, **at most one connection pop-up per app open** across Gmail, Always on and this (`renderer/popup-slot.js`).
- 🟢 **Full automation** and **Always on** need a working channel: Full automation asks for it in the same step as its existing confirmation (the confirmation itself is unchanged); Always on says its matches wait for the confirm link.
- 🟡 Not built: Telegram setup inside a pop-up (the bot token flow stays in Settings → Notifications; the pop-up opens it), a "paused" state (the app has none: every stop is a hand-over).

## Delivery facts the words rely on (checked 2 Nov 2026)

| Moment | What is really sent | Source |
|---|---|---|
| An application waited for you | one message (≤ 1 an hour) to every working channel | `lib/waiting-message.js` (#3008) |
| A match ≥ 85% arrived while the app was closed | the run's e-mail (one a run) / Telegram digest; **not** pushed at once | `src/notify.py` |
| An employer replied | **interview invites at once**; other replies in the daily digest | `lib/notify-channel.js` kinds |
| A recruiter waits for your answer | Telegram **at once**, e-mail in the digest, no day count | `lib/pipeline.js` focusReminder |

## States and their one owner

Owner: `lib/notify-moments.js` (state in `settings.notifyOffer`, written only there): `{moments: {<name>: ISO}, emailAt: ISO}`. `emailAt` is when the address was first saved (the site does not return it).

| State | Set by | Effect |
|---|---|---|
| working channel | `workingChannel(state)` (pure, `renderer/notify-words.js`) from the site's answer and the bot | every offer is gone |
| card hidden | suggestion answer "Not now" | 14 days |
| moment shown | the app when the pop-up opens | that moment never opens again |
| address pending | `emailAt` set, `confirmed` false | card "Check your inbox" + Resend; day 3 and day 10 pop-up (each once) |
| mail stopped | the site's `unconfirmedStopped` (day 14) | card + one pop-up; Resend starts it again |
| channel lost | Full automation on and no working channel | card + one pop-up; **automation stays on** and says so |

## Pop-up moments and their rank (one per app open; highest rank wins, the others wait for a later open)

1. **An application waited for you** (rank 3): the window asks 3 s after load; true once #3008 shipped and no channel worked when it was handed over.
2. **A ≥ 85% match arrived while the app was closed** (rank 1).
3. **The first employer reply** found by the Gmail check (rank 1).
4. **A recruiter is waiting** (rank 1).
5. **Unconfirmed address, day 3 / day 10 / stopped day 14** (rank 2).

## Words (each true today)

- Card, nothing yet: **Get a message when something needs you** · "An application that waits for you, a good match, a reply: by e-mail or Telegram."
- Card, pending: **Check your inbox** · "Press the link in our e-mail to {address}. Nothing is sent until you do." · Resend.
- Pop-up 1: "This application waited {N} hours for you. Get a message when something needs you."
- Pop-up 2: "A {N}% match arrived at {time}. Want these on your phone?"
- Pop-up 3: "An employer replied. Interview invites reach you at once; other replies come in your daily digest."
- Pop-up 4: "A recruiter is waiting for your answer. Get a reminder by message (Telegram at once, e-mail in your digest)."

## Owner's answers (2 Nov 2026, on the light + dark previews)

- **Full automation:** the confirmation asks where to tell the person; an address typed there **counts at once** (it works when its link is pressed: card "Check your inbox", Resend). The confirmation itself (`autoConfirmedAt`) is unchanged. A state the website did not answer (offline, no install key) asks nothing: a gate that cannot judge must not lock the setting.
- **Always on:** turns on with an unconfirmed address and **says the matches wait** for the link (Settings card, the toast): `hosted-words.js` `turnedOnLine`, `model(..., mail)`.
- **Channel lost (2/2):** Full automation **stays on**; the card comes back with a clear line and one pop-up says it once; never switched off silently.
- **Previews:** "Ship 1/2".

## Plan (two PRs, each titled `[ao] n/2 …`)

1. **1/2** the definition, `popup-slot.js` (Gmail and Always on use it), the card, Resend, day 3/10/14, the Full automation and Always on gates.
2. **2/2** moments 1–4 and the channel-lost pop-up.

## 2/2 design: how each moment is detected (checked 2 Nov 2026)

One owner: `lib/notify-moments.js` (the same `settings.notifyOffer.moments`, once each, never while a channel works, never in setup, one per app open through `popup-slot.js`). The main process answers `notifyMoment`; the window shows what it is told.

| Moment (rank) | Detected from | Real numbers in the words | Gap found |
|---|---|---|---|
| **Waited** (3) | `lib/waiting-message.js` keeps each handed-over application (id, time, `open()`); at ask time one that is still open and older than 1 hour | hours = now − first hand-over | in memory only: after an app restart the controller hands the jobs over again, so hours restart (understated, never overstated) |
| **Match** (1) | the last scheduled search run on this Mac that finished after `windowSeenAt`; best `fit` ≥ 85 among jobs first seen on or after that run's date | the fit, the time the run finished | jobs carry `first_seen_at` as a **date** only; run rows carry no best score; "away" is not recorded anywhere |
| **Reply** (1) | the last Gmail check (`kind` mail) that finished after `windowSeenAt` with `updates.length > 0` | N updates | the check does not say reply vs confirmation (judging that from text is a keyword rule: not built); words say "updates", never "reply" |
| **Recruiter** (1) | the window: a Focus item of kind `reply` ("Reply today": `src/focus_items.py:110`) | none (no day count) | none |
| **Lost** (2) | Full automation on (`autoConfirmedAt`) and no working channel while the website answers | none | none: card text changes too; automation stays on |

`windowSeenAt`: **new**, one setting, stamped by the main process when the window loses focus, is hidden, or the app quits (at most once a minute); "away" = a run finished after it. Without it moments Match and Reply cannot say "while you were away" truthfully.

## Progress

- [x] Spec (proof: docs/superpowers/specs/2026-11-02-notify-moments-design.md)
- [x] Tests first: working channel, popup slot rank, card states, Resend, gates (proof: desktop/test/notify-working-channel.test.js)
- [x] Popup slot, Gmail and Always on go through it (proof: desktop/test/popup-slot.test.js)
- [x] Resend and the saved day (proof: desktop/test/notify-resend.test.js)
- [x] Card on Focus and Jobs (proof: desktop/test/notify-suggestion.test.js)
- [x] Day 3 / 10 / 14 pop-up (proof: desktop/test/notify-moments.test.js)
- [x] Full automation asks for a channel; Always on says matches wait (proof: desktop/test/hosted-words.test.js)
- [x] ⌘K commands (proof: desktop/test/notify-commands.test.js)
- [x] Side-by-side preview (light + dark), owner's yes "Ship 1/2" (proof: none: the owner's answer in the session, 2 Nov 2026)
- [x] 1/2 merged (#3011) (proof: none: merged on main, the PR record)
- [x] 2/2 tests first: when the person was away, the waited hours, the detections, the words (proof: desktop/test/window-seen.test.js, desktop/test/notify-detect.test.js, desktop/test/notify-moment-words.test.js)
- [x] 2/2 the waited and channel-lost moments, one gate for all pop-ups (proof: desktop/test/notify-moments.test.js)
- [x] 2/2 `waitedFor` from the handed-over applications (proof: desktop/test/waiting-message.test.js)
- [x] 2/2 the state says whether Full automation is on and confirmed (proof: desktop/test/notify-resend.test.js)
- [ ] 2/2 side-by-side preview (light + dark) and the owner's yes
- [ ] 2/2 PR READY
