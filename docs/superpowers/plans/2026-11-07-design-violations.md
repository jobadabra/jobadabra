# Shrink the design-system violations main already has (short name dv)

Owner, 7 Nov 2026: "It should check design system compliance. Spacing/magins,colors,buttons, cards..." → the measured check merged (#3452, #3475, #3480). Baseline on main (8 screens × 380/1100 × light/dark): spacing 64 (5 distinct) · primary>1 per card 12 (3) · ghost/link buttons 40 (8) · clipped 132 (23) · contrast 20 (1) · nested 0. Work board draft: "Design system: shrink the violations main already has".

Sorted (dv, 7 Nov 2026): clipped is the checker's, not the screens': all 132 are at 380 px, a 475 px window the app cannot have (`lib/main-window.js` MIN_WIDTH 640, owner 9 Oct 2026); they were tables in scroll wrappers, tooltip slides and one scrolling `main`. The rest are real.

## Progress
Finished at 4/5 (7 Nov 2026): #3486, #3489, #3500, #3503 merged; 5/5 skipped by the owner's choice.

- [x] 1/5 Checker: text a clip or a scroller holds is not "lost"; `main` scrolling sideways is one hit (`design-evaluator.mjs` `reached`); the narrow width is 640 (proof: desktop/scripts/design-check.mjs @4917d27d)
- [x] 2/5 Job logo initials reach AA in light (one token, `--logo-ink-l`) (proof: desktop/renderer/tokens.css)
- [x] 3/5 The check counts one primary per ROW of a list of peer rows (Focus, suggestions), one per card elsewhere; screens keep today's look (owner, 7 Nov 2026: "One amber per row (Recommended)", reversing the first 3/5, #3492 closed) (proof: desktop/scripts/design-evaluator.mjs)
- [x] 4/5 No ghost/link buttons: History, Hide, Show more, full report, Technical log, Review setup become the small secondary button; table company names plain dark links (owner, 7 Nov 2026: "Small buttons; names as links (Recommended)") (proof: desktop/renderer/index.html)
- ~~5/5 Strategy cards' gap on the scale (`.review .card` 10px → 12px)~~ Skipped by the owner, 7 Nov 2026: "Skip it (Recommended)" ("No one would notice 2px, so a PR here only pleases the check"); 10px stays as known, allowed debt in the spacing baseline
- [x] Owner's decision, 7 Nov 2026 "Yes, 640 (Recommended)": the check's narrow width 380 → 640 (the real minimum window), in this PR (proof: desktop/scripts/design-check.mjs)

Every UI PR: a Preview side-by-side (before | after, light + dark, 640 + 1100) and the owner's yes before the UI commit; its body carries the measured table, counts only go down.
