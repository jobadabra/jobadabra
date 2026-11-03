# A Windows tester's 0.9.2 bugs (session fx, owner 3 Nov 2026)

One small PR per bug, in this order; each names its root cause (file:line) and a test that plays the tester's steps.

## Progress
- [x] 1/5 Edit on Education / "What I told the AI" crashes (`.map` on a NodeList) and the Profile save bar freezes (#3031, merged) (proof: desktop/test/experience-editors-nodelist.test.js @15e2f22)
- [x] 2/5 A bad API key shows "Connected" in Settings → Connections (one owner for "this key works") (#3035, merged) (proof: desktop/test/ai-key-health.test.js @a291875)
- [x] 3/5 CV card stale after Replace CV (old size and old CV check until reload) (#3038, merged) (proof: desktop/test/cv-replace.test.js @fe21c2b)
- [x] 4/5 "Needed by every form" (GitHub, personal website) follows the person's field, and the "missing" badge counts only what is missing (#3043, merged) (proof: desktop/test/contact-review.test.js @c30d388)
- [x] 5/5 Status bar "Last refresh … never finished" / "Next refresh" stale (#3050, merged) (proof: desktop/test/next-refresh-words.test.js @fafe218)

The tester's third report (b1f620ee429ddb0c) added seven more, numbered 6-12:
- [x] 6/12 Add another CV version at the limit says so (#3064, merged) (proof: desktop/test/experience-limit.test.js @53bdf44)
- [x] 7/12 Remove on a CV version asks first (#3067, merged) (proof: desktop/test/experience-remove-confirm.test.js @089d8fb)
- [x] 8/12 Extra CV details a job has no room for are listed (#3070, merged) (proof: desktop/test/experience-extras-cap.test.js @30f6dc6)
- [x] 9/12 A word split at a ligature stays one word in the CV check (#3077, merged) (proof: desktop/test/cv-check.test.js @c893215)
- [x] 10/12 A second copy of the app quits quietly (#3075, merged) (proof: desktop/test/lifecycle.test.js @ff77d86)
- [ ] 11/12 Scoring backlog pace (#3058; pane fj owns it)
- [ ] 12/12 Misleading "AI limit reached" message (#3059; waits for the run errors in the feedback bundle, #3071, fd)
