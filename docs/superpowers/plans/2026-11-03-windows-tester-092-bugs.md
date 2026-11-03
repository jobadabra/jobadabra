# A Windows tester's 0.9.2 bugs (session fx, owner 3 Nov 2026)

One small PR per bug, in this order; each names its root cause (file:line) and a test that plays the tester's steps.

## Progress
- [ ] 1/5 Edit on Education / "What I told the AI" crashes (`.map` on a NodeList) and the Profile save bar freezes
- [ ] 2/5 A bad API key shows "Connected" in Settings → Connections (one owner for "this key works")
- [ ] 3/5 CV card stale after Replace CV (old size and old CV check until reload)
- [ ] 4/5 "Needed by every form" (GitHub, personal website) follows the person's field, and the "missing" badge counts only what is missing
- [ ] 5/5 Status bar "Last refresh … never finished" / "Next refresh" stale (read #3025 and #3026 first)
