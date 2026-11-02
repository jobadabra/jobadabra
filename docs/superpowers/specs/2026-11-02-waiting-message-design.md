# An application waiting for you is sent by e-mail or Telegram

Status: owner decided 2 Nov 2026 ("Add the message, all 4 pop-ups"): "First, the app sends one e-mail/Telegram message when an application is stuck waiting for you (at most one an hour). Then all four pop-ups, each telling the truth." Part 1 of 2; part 2 is the notification card and pop-ups (`2026-11-02-notify-moments-design.md`, after this lands).

## Verdict

- 🟢 When a background application is handed to the person (a CAPTCHA, a result nobody confirmed, the app closed while it held one: `background-apply-controller.js` `markManual`, `handOverInterrupted`), the person's chosen channels (e-mail, Telegram) get one message. Until now only the app's own notification and toast said it (the person who is away heard nothing).
- 🟢 At most one message an hour; several waiting applications become one message.
- 🟡 Not for a Claude session's own question: `app-reminders.js` `sessionNeedsYou` stays app-only (1 Oct 2026: a 4-hour loop of Telegram pings).
- 🟡 "Full automation paused": the app has no separate paused state; every Full-automation stop that needs the person is one of the handoffs above, so one mechanism covers it.

## States and their one owner

Owner: `lib/waiting-message.js`; its only persisted state is `settings.waitingMessageAt` (when the last message went).

| State | Set by | Verdict that changes it |
|---|---|---|
| waiting (in memory: id, title, reason) | a handoff in the controller | the person handles it (`outcome` set) or the message goes |
| collecting | the first waiting item | a 60 s window, so a burst (10 jobs handed over at start) is one message |
| sent | the window ends and an hour has passed since `waitingMessageAt` | next waiting item starts a new window; the send waits until the hour is over |
| dropped | no channel works (no confirmed-or-given address, no connected bot) | nothing consumed: `waitingMessageAt` stays, the app's own notification already showed it |

Channels: `notify-channel.js` `channelsOf` (e-mail needs an address, Telegram a connected bot); e-mail goes at once, not in the digest (`kind` other than `activity`); an unconfirmed address is held by the site's own rules (one a day, then the digest).

## Words

Title: **1 application is waiting for you** / **3 applications are waiting for you** · one line each: `<job title> at <company>: <what it needs>` (the controller's own `NOTICES` words) · last line: "Open Jobadabra to finish it."

## Progress

- [x] Spec (proof: docs/superpowers/specs/2026-11-02-waiting-message-design.md)
- [x] Tests first: hourly cap, batching, no channel, handled meanwhile, both channels (proof: desktop/test/waiting-message.test.js)
- [x] `lib/waiting-message.js`, wired from the controller's two handoff sites (proof: desktop/test/background-apply-controller.test.js)
- [ ] PR READY
