# Always on is offered at the right moments

Status: owner decided 2 Nov 2026 ("Ok. Let's do it at all these 3 different moments in time."), changed the same day: "It should still be always present as in the Suggestions card (Focus/Jobs screens), but we should show dialog/popups in moments it makes sense to stimulate the user."
Always on = **Always on: on our servers** (Cloudflare; code `desktop/lib/hosted-search.js`, words `desktop/renderer/hosted-words.js`; private spec `jobadabra-lab:docs/specs/2026-10-16-hosted-always-on.md`).

## Verdict

- 🟢 A Suggestions **card** on Focus and Jobs while Always on is off, from the first finished search with matches. Not now hides it 14 days, then it is back; there is no Skip that removes it for good.
- 🟢 A **dialog**, once, the next time the app opens after a scheduled check did not run ("Your 7:00 check didn't run: your Mac was asleep or off").
- 🟡 A dialog after Gmail is connected is **not built**: hosted runs no Gmail check (`src/hosted_run.py:3` "No Notion, Gmail, Telegram or user key is ever here"; private spec §2 Credentials), and the owner decided (2 Nov 2026) the Gmail check never runs on our servers: it will run on the phone (JOB-218). "Replies get tracked even when your Mac is off" would be false today. Parked as JOB-222, blocked by JOB-218.

## States and their one owner

Owner of the state: `settings.hostedSearch` (next to `skipped`), written only by `lib/hosted-search.js` and `lib/always-on-moments.js`.

| State | Key | Set by | Effect |
|---|---|---|---|
| Always on | `hostedSearch.on` | Turn on / Turn off | any offer is gone |
| Card hidden | suggestion answer `hosted:first-matches` "Not now" | the person | hidden 14 days, then the card returns |
| Moment shown | `hostedSearch.moments.missed` (ISO time) | the app when the dialog opens | that moment never opens again; the card is unaffected |

A moment's dialog opens only when: Always on is off; the install can run it (it holds the in-house key, `hosted.available`); setup is done; the moment is not already in `moments`. A missed check exists only when this Mac schedules the search itself (not GitHub Always on, which `nextAt` already leaves out).

## Detecting a missed check

`schedule.nextAt(settings)` is when this Mac's search is due. If, when the app starts or the Mac wakes (before the catch-up search runs: 30 s / 60 s later), that time is more than 30 minutes past, the check did not run on time: `{at: nextAt}`. The 30 minutes cover the 10-minute tick plus the 1-minute heads-up; a Mac that was awake with the app open never reaches it. The app cannot tell asleep from off, so the words say "asleep or off". Time shown in the person's own time zone.

## Words

Title: **Your 7:00 check didn't run** · Body: "Your Mac was asleep or off. Always on runs it on our servers, even when your Mac is off, and e-mails you the new matches." · Buttons: Turn on Always on / Not now. With no Notifications address the dialog asks for one (the same field as the card).

## Progress

- [x] Spec (proof: docs/superpowers/specs/2026-11-02-always-on-moments-design.md)
- [x] Tests: detection, one-owner state (shown once, on / unavailable never), card always present (Focus and Jobs) (proof: desktop/test/always-on-moments.test.js)
- [x] `lib/always-on-moments.js`, IPC, wiring at start and wake (proof: desktop/test/always-on-moments.test.js)
- [x] Dialog + card changes (proof: desktop/test/suggestions.test.js)
- [x] Side-by-side preview (light + dark), owner's yes (Not now hides the card 14 days) (proof: none: the owner's answer in the session, 2 Nov 2026)
- [ ] PR, READY
