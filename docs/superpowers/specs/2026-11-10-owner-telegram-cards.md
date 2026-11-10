# Owner Telegram messages: one card

🟢 Every message the owner's bots receive reads like the Central scout alert: a dot and a bold headline, a bar, "Why" rows, one verdict line, one link.

**Why (owner, 10 Nov 2026):** "let's make this telegram message have a better readability. Better text/style format. Better visual representations. ASCII. COlors..."; "DO an inventary of all the telegram notifications and improve them all."; on the Central scout message: "This is a model: how I should like to see all the others, in terms of readability".

## Design
- One builder: `desktop/e2e/lib/tg-card.mjs` (`card()` builds, `checkCard()` checks). Telegram cannot colour text: the colour is the dot (🔴 needs you, 🟠 degraded, 🟢 fine or back, ⚪ information); bars are block characters; a long list is "top 3 + N more".
- One check for every sender: a test builds a sample of each kind from fictional data and runs `checkCard` (dot + bold headline, ≤ 12 lines, one link, no raw JSON, no secret or e-mail address).
- Scope: the owner's CI-alert, Build Log and switchboard messages. Not changed: the job seeker's digest and Always-on notices (localized), the Brain bot, alert triggers (thresholds, schedules).
- Two repeats fixed at the cause, not by a retry: (1) a send that timed out may have arrived, so it is `unsure` and keeps its claim (the Store watcher told "once" twice on 8 Nov: runs 42466803520, 42471046179); (2) a red main sends `state` = the red steps + the UTC day, and the old-bot fallback reports that state, so "changes only" holds a new commit with the same failed step (8 Nov, 18:25 and 23:01).

## Progress
- [x] 1/2 `jobadabra`: the card, the CI / AI / release / Store / test messages, the two repeat fixes (this PR)
- [ ] 2/2 `jobadabra-web`: the Worker messages (Sentry, probes, night search, employer list, Free AI, feedback, forms, e-mail, Build Log) on the same card; the switchboard records the fallback's state
