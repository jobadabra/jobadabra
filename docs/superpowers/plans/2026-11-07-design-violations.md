# Shrink the design-system violations main already has (short name dv)

Owner, 7 Nov 2026: "It should check design system compliance. Spacing/margins, colors, buttons, cards..." → the measured check merged (#3452, #3475, #3480). Baseline on main (8 screens × 380/1100 × light/dark): spacing 64 (5 distinct) · primary>1 per card 12 (3) · ghost/link buttons 40 (8) · clipped 132 (23) · contrast 20 (1) · nested 0. Work board draft: "Design system: shrink the violations main already has".

Sorted (dv, 7 Nov 2026): clipped is the checker's, not the screens': all 132 are at 380 px, a 475 px window the app cannot have (`lib/main-window.js` MIN_WIDTH 640, owner 9 Oct 2026); they were tables in scroll wrappers, tooltip slides and one scrolling `main`. The rest are real.

## Progress
- [ ] 1/5 Checker: text a clip or a scroller holds is not "lost"; `main` scrolling sideways is one hit (`design-evaluator.mjs` `reached`)
- [ ] 2/5 Job logo initials reach AA in light (one token, `--logo-ink-l`)
- [ ] 3/5 One primary button per card: only the first row's main action is primary (Focus, suggestions)
- [ ] 4/5 No ghost/link buttons: History, Hide, Show more, full report, Technical log, Review setup, table company links
- [ ] 5/5 Strategy cards' gap on the scale (`.review .card` 10px → 12px)
- [ ] Owner's decision: the check's narrow width 380 → 640 (the real minimum window)

Every UI PR: a Preview side-by-side (before | after, light + dark, 380 + 1100) and the owner's yes before the UI commit; its body carries the measured table, counts only go down.
