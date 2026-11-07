# Microsoft Store: one submission a week (ms)

Owner, 7 Nov 2026: "To release less often on Microsoft store" / "And guide our users if they want more frequent updates, to download the exe". Chosen: weekly, a fixed day, from a stable that has run a day on the .exe without a red.

## Plan (3 PRs)
1. Weekly Store submission: the Worker starts `msix-store.yml` once a week; a picker chooses the tag; `release-stable.sh` no longer starts it per release.
2. Store watcher: a missing broken-streak tag is not an error (the 422 behind the hourly red).
3. record-sites pool-pr: the bot branch is based on current main, not the run's old SHA.

## Progress
- [ ] 1/3 weekly Store submission
- [ ] 2/3 Store watcher 422
- [ ] 3/3 record-sites pool-pr base
