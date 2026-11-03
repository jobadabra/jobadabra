# A Windows tester's 0.9.2 bugs (session fx, owner 3 Nov 2026)

One small PR per bug, in this order; each names its root cause (file:line) and a test that plays the tester's steps.

## Progress
- [x] 1/5 Edit on Education / "What I told the AI" crashes (`.map` on a NodeList) and the Profile save bar freezes (#3031, merged) (proof: desktop/test/experience-editors-nodelist.test.js @15e2f22)
- [x] 2/5 A bad API key shows "Connected" in Settings → Connections (one owner for "this key works") (#3035, merged) (proof: desktop/test/ai-key-health.test.js @a291875)
- [x] 3/5 CV card stale after Replace CV (old size and old CV check until reload) (#3038, merged) (proof: desktop/test/cv-replace.test.js @fe21c2b)
- [x] 4/5 "Needed by every form" (GitHub, personal website) follows the person's field, and the "missing" badge counts only what is missing (#3043, merged) (proof: desktop/test/contact-review.test.js @c30d388)
- [ ] 5/5 Status bar "Last refresh … never finished" / "Next refresh" stale (read #3025 and #3026 first) (this PR: the footer says "due now"; the unclosed run is #3025)
