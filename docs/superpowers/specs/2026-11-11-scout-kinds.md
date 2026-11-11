# Find jobs reads the employers in a person's places: the scout's kind counts (sk)
Short name `sk`. The numbers behind it (private list) are in `jobadabra/jobadabra-lab` issue 87, never here.

## Design
- States of a feed in the index: **empty** (no open job; nothing to judge, never counted as "no mix"), **unjudged** (open jobs, no mix), **mix** (whole-employer kinds; an install reads it through `role_kinds.located`), **counted** (per-country `kind_counts`).
- One owner of a feed's mix: `scout_carry.mix_fields`. A read the AI could not answer changes nothing (kept).
- The scout's AI calls a run are few: they go by need (unjudged feeds first, then the rest by age), and per job (titles and places have their own allowance), one answer per place string.
- Measure (agreed with the measure session): N = fit + kind_not_theirs + no_mix + empty; no-mix share = no_mix / (N - empty); a mix-only feed has a mix.
- The central scout's candidate probe (employer checks, in worker threads) asks on one allowance of its own, `decide.CENTRAL_PROBE_CALLS` (30), counting its decide() calls and its page reads; the feed pass that counts the known employers keeps the rest. The 30 are one pool for the whole run, shared by every probe thread; once it is spent the probe's later asks wait for the next run (unknown, never guessed). What the owner gives up: a few new sources a run; what he gets: counted feeds.
- Not built: reading an uncounted employer last (it changes the 26 Oct 2026 rule "read an employer only when its jobs in your countries are your kind"; the owner's call).

## Progress
- [x] 1/4 The scout reads employers with open jobs and no mix first (`scout_carry.order`) (#3811, merged) (proof: tests/unit/engine/test_scout_order.py @7280163)
- [x] 2/4 Titles and places keep their own AI allowance; a place is judged once (#3812, merged) (proof: tests/unit/ai/test_kind_counts.py @af7220d)
- [x] 3/4 The title seed arrives (jobadabra-lab#88, merged), and a missing seed says so (#3813, merged) (proof: tests/tooling/ci/test_recount_title_kinds.py @c7aad2c)
- [ ] 4/5 The candidate probe asks the AI on its own 30-call allowance; the feed pass keeps the rest of the run's 200 (this PR)
- [ ] 5/5 Owner's call, not built: read uncounted employers last
