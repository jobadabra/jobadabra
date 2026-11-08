# [mw] An e-mail for every automation, and its switch on every Schedules row

Status: owner approved the pictures and wording, 8 Nov 2026. Spec: jobadabra-web `docs/superpowers/specs/2026-11-05-service-mail-rules-design.md` (§2 one stored value, §4 two screens, §11 "room left").
Owner, in their words: "We're missing the email notifications switch for each automation." · "Let's wire all the unwired and siwthem them on on every row".

## Design: what each Schedules row mails, who sends it, who owns the switch

| Row | Mail (id) | Sent by | Trigger | State today |
|---|---|---|---|---|
| Find jobs | New matches (`app-matches`) | the run | a run finds jobs | wired |
| Check Gmail & Calendar | Interview reminder (`app-reminder`) | the Mac's Gmail check (engine `src/ai/mail_calendar.py reminders()`) | the evening before (after 17:00) or the morning of | **sent with no row**, held for the digest, no switch |
| Ready to send | Forms ready to check (`app-ready`) | our site, when the night ends (`api/ready-tick.js`) | a night finished with forms to check; counts only, no job names | no mail |
| Apply for me | Applied for you (`app-applied`) | the Mac (Full automation) | Full automation sent an application; a 60 s window groups a burst | row exists, **no sender** |
| Apply for me | An application needs you (`app-needs-you`) | the Mac | an application waits | wired |

- **One stored value per mail** (`mail_on` / `mail_off`, list = row id): Schedules, Notifications and the footer link write the same one.
- **Defaults (owner, 8 Nov 2026, "On everywhere")**: a new row starts on in both modes once e-mail is on. This replaces 6 Nov's "Mac only starts off" for the four automation rows (`app-reminder`, `app-ready`, `app-applied`, `app-needs-you`). A choice a person made is never reset.
- Parked (owner, 8 Nov 2026): "Replies found" (Gmail is read only on the Mac, so "a reply came while the Mac was off" cannot exist), "Nothing found for days" (nothing writes it). Both are Work board drafts, status Parked.
- The mail wording is the pictures' (`mw-mail-picture.png`), except the Interview reminder: its body is the engine's existing prep card (attendees, weak topics, next step), not the sketch.

## Pull requests (site first, then the public repo)

| # | Repo | What | Who gets what | Depends on |
|---|---|---|---|---|
| 1/5 | web | registry: `app-reminder`, `app-ready`; defaults on; template `ready-forms`; the choices route answers both | the owner: both rows in Admin's list; people's switches can be saved | none; deploys the site |
| 2/5 | web | Ready's night end sends `ready-forms` (counts only), obeying the row | a person with Ready to send: a morning mail with the Mac off | 1/5 |
| 3/5 | public | every Schedules row has its switch (Gmail, Ready, Apply); Notifications lists the new rows; labels | a person: a switch beside each automation | 1/5 deployed, sc #3601 merged |
| 4/5 | public | the Interview reminder goes at once under `app-reminder` and obeys its switch | a person: the reminder arrives before the interview, not in tomorrow's digest | 1/5 |
| 5/5 | public | Applied for you: the Mac mails each Full automation batch under `app-applied` | a person: a list of what was sent | 1/5 |

Tests: one per mail rule (who gets it, when, switch off = no mail, the 10 a day safety net holds); a test loops every Schedules row and finds a switch.
Never a real mail from a test: fictional addresses, fake sender.

## Progress

| Row | State | PRs |
|---|---|---|
| Pictures and wording | ✅ owner yes, 8 Nov 2026 | — |
| 1/5 | ✅ merged | web #495 |
| 2/5 | ✅ green, Gitar-approved; the owner merges | web #496 |
| 3/5 | ▶️ in review | this PR |
| 4/5 | ✅ merged | #3609 |
| 5/5 | ✅ in review | #3614 |
