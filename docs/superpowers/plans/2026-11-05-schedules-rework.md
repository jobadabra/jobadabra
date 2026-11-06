# Schedules rework (sc)

> **Verdict:** Settings → Schedules shows what a person cares about, finding jobs and Gmail; the employer search and Insights are not rows. Three PRs.

Owner, 5 Nov 2026: "The user just cares about finding jobs." · "The user should NOT see in his UI the action of 'Find new employers'… It's up to algorithm when to do and what to do." · Insights: "How about Reports (but also they should be on Focus/Jobs under suggestions card)... + Tips mails (tips) + Weekly Summary (digest)", so no switch.

## Progress
- [x] 1/4 (#3312) Schedules loses More employers and Insights; the text people act on says "Search wider"; Reports → Insights unchanged. When the employer search runs is NOT changed (`scoutDue`, `pinScoutSchedule`, `scout.yml`, saved settings). (proof: desktop/test/unit/renderer/schedules-two-rows.test.js @41111d14)
- [x] 2/4 (#3329) Two rows, visible but not usable, with a "Coming soon" chip and no control: "Ready to send" and "Apply for me"; each job says where it really runs (Find jobs: our servers or GitHub, your Mac can be off; Gmail: this Mac, while open). Room left in each row for a later e-mail on/off. (proof: desktop/test/unit/renderer/schedules-two-rows.test.js @0584a07)
- [x] 3/4 (#3331) One place searches: with Always on on our servers the Mac stops its own scheduled search (the Find jobs button still works), and insights get their own once-a-day trigger while the app is open (unforced engine entry; at most one insight a day, tested). (proof: desktop/test/unit/main/one-place-searches.test.js @226cc60)
- [x] 4/4 The Insights card on Focus and Jobs suggestions (shown beside what Jobs already has). (proof: desktop/test/unit/renderer/suggestions.test.js)

## Not here
- When Find jobs decides by itself to search wider: its own design with gi.
- Gmail & Calendar row: a separate brief.
- The engine keeps reading the saved insights choice (`lib/pipeline-args.js`, `lib/github.js`); nobody's saved choice changes.
