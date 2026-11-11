# Find jobs reads the employers in a person's places: the scout's kind counts (sk)
Short name `sk`. The numbers behind it (private list) are in `jobadabra/jobadabra-lab` issue 87, never here.

## Design
- States of a feed in the index: **empty** (no open job; nothing to judge, never counted as "no mix"), **unjudged** (open jobs, no mix), **mix** (whole-employer kinds; an install reads it through `role_kinds.located`), **counted** (per-country `kind_counts`).
- One owner of a feed's mix: `scout_carry.mix_fields`. A read the AI could not answer changes nothing (kept).
- The scout's AI calls a run are few: they go by need (unjudged feeds first, then the rest by age), and per job (titles and places have their own allowance), one answer per place string.
- Measure (agreed with the measure session): N = fit + kind_not_theirs + no_mix + empty; no-mix share = no_mix / (N - empty); a mix-only feed has a mix.
- Not built: reading an uncounted employer last (it changes the 26 Oct 2026 rule "read an employer only when its jobs in your countries are your kind"; the owner's call).

## Progress
- [ ] 1/4 The scout reads employers with open jobs and no mix first (`scout_carry.order`)
- [ ] 2/4 Titles and places keep their own AI allowance; a place is judged once
- [ ] 3/4 The title seed arrives (jobadabra-lab), and a missing seed says so (owner's yes for plan quota first)
- [ ] 4/4 Owner's call, not built: read uncounted employers last
