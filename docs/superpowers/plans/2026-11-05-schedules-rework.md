# Schedules rework (sc)

> **Verdict:** Settings → Schedules shows what a person cares about, finding jobs and Gmail; the employer search and Insights are not rows. Three PRs.

Owner, 5 Nov 2026: "The user just cares about finding jobs." · "The user should NOT see in his UI the action of 'Find new employers'… It's up to algorithm when to do and what to do." · Insights: "How about Reports (but also they should be on Focus/Jobs under suggestions card)... + Tips mails (tips) + Weekly Summary (digest)", so no switch.

## Progress
- [ ] 1/3 Schedules loses More employers and Insights; the text people act on says "Search wider"; Reports → Insights unchanged. When the employer search runs is NOT changed (`scoutDue`, `pinScoutSchedule`, `scout.yml`, saved settings).
- [ ] 2/3 Two rows, visible but not usable, with a "Coming soon" chip and no control: "Ready to send" (forms filled ahead, you check and press Submit) and "Apply for me" (applies on a schedule, with the Full automation checks). No word on where they run. New preview first.
- [ ] 3/3 The Insights card on Focus/Jobs suggestions (what it is today comes first).

## Not here
- When Find jobs decides by itself to search wider: its own design with gi.
- Gmail & Calendar row: a separate brief.
- The engine keeps reading the saved insights choice (`lib/pipeline-args.js`, `lib/github.js`); nobody's saved choice changes.
