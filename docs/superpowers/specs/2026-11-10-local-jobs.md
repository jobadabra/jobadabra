# Find jobs keeps only jobs the person can take, and finds local jobs where EURES is thin (short name lj, 10 Nov 2026)

Owner, 10 Nov 2026 (via session sa): "Start an Opus session and let it do the improvements"; on PR #3671: "As long as they match our location filter, why should we care about the order?". Assessment: [10 Nov search assessment](https://claude.ai/artifact/BnQ2D4Zdt6bGpPGUWoQcoq). Builds on [collect, rank once, then spend](2026-11-10-find-jobs-collect-rank-spend.md) (sf owns the order, clock and scorer; lj owns what is KEPT).

## Verdict
- 🔴 An on-site search listed and scored remote jobs in other countries (#3674: Dublin nurse 24 of 25).
- 🟡 A drafted strategy always carries the whole country as a second tier, so for an on-site trade a job 800 km away matches.
- 🟡 Where EURES is thin there are few local jobs at all.

## Plan (3 PRs, titles `[lj] n/3 …`)
1. A remote job is listed only when the AI placed it (#3674; no new screen).
2. The strategy says how far the person would go (their area, the whole country, remote within the country), drafted from the CV, editable on the Strategy page; an on-site role defaults to the area. Needs a sketch and the owner's yes before building.
3. Local jobs where EURES is thin: a plan of its own (sketch, the owner's yes); sa: oe adds no reader, job boards are sf's.

## Progress
- [ ] 1/3 A remote job is listed only when the AI placed it (proof: tests/unit/sources/test_remote_is_judged.py)
- [ ] 2/3 The strategy's distance (sketch + owner's yes first)
- [ ] 3/3 Local jobs where EURES is thin (sketch + owner's yes first)
