# Find jobs keeps only jobs the person can take, and finds local jobs where EURES is thin (short name lj, 10 Nov 2026)

Owner, 10 Nov 2026 (via session sa): "Start an Opus session and let it do the improvements"; on PR #3671: "As long as they match our location filter, why should we care about the order?". Assessment: [10 Nov search assessment](https://claude.ai/artifact/BnQ2D4Zdt6bGpPGUWoQcoq). Builds on [collect, rank once, then spend](2026-11-10-find-jobs-collect-rank-spend.md) (sf owns the order, clock and scorer; lj owns what is KEPT).

## Verdict
- 🔴 An on-site search listed and scored remote jobs in other countries (#3674: Dublin nurse 24 of 25).
- 🟡 A drafted strategy always carries the whole country as a second tier, so for an on-site trade a job 800 km away matches.
- 🟡 Where EURES is thin there are few local jobs at all.

## Plan (4 PRs, titles `[lj] n/4 …`)
Owner, 10 Nov 2026 (asked via AskUserQuestion on the sketch): "A: 'How far would you go?' switch" and "Only under 'Any remote'" (a bare Remote or Worldwide counts only when the person picks Any remote).
1. A remote job is listed only when the AI placed it (#3674, #3676, merged d24b6d0e).
2. The engine and the draft: "Remote jobs" gets a third word, Country; the draft sets Remote jobs (No / Country / Yes) and country_wide from the work it drafts (an on-site trade: area only). No screen.
3. The Strategy page's "How far would you go?" switch over those two settings (My area / Remote in my country / Whole country / Any remote), its side-by-side preview and the owner's yes, ⌘K and the language catalogs.
4. Local jobs where EURES is thin: a plan of its own (sketch, the owner's yes); sa: oe adds no reader, job boards are sf's.

## Progress
- [x] 1/4 A remote job is listed only when the AI placed it (proof: tests/unit/sources/test_remote_is_judged.py @d24b6d0e). Mac proof of the merged patch: listed 25 to 3, 33 to 19, 17 to 6, 24 to 9; wrong-country remote 0.
- [ ] 2/4 Remote jobs: Country, and the draft sets it (proof: tests/unit/sources/test_remote_country_only.py, desktop/test/unit/main/strategy-reach.test.js)
- [x] 3/4 A third Remote work button, My country, "?" tooltips on Preferred and Acceptable, no whole-word box on places (owner 10 Nov 2026, via AskUserQuestion: "Small: add a third Remote work button", "No box on locations") (proof: desktop/test/unit/renderer/locations-card.test.js)
- [ ] 4/4 Local jobs where EURES is thin (sketch + owner's yes first)
