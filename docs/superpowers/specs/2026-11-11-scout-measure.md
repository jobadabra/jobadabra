# Scout measure: how much the Central Scout's list helps a person's Find jobs

> **Verdict:** the owner sees, per night and per test person, how many right jobs the shared employer list brought and where the rest of the list was lost. Built from the saved night first; the 18 fixed people only.

Pane sm (of session sa), 11 Nov 2026. Owner's words (11 Nov 2026, to sa): "How much the Central Scout is helping us? Do we measure this ?" then "Ok. Let's improve the measuremenet. Start a session on this."

## What the first EURES-off night showed (run 42927975750)
- 61 jobs listed, 15 right, 5 of 18 people with a right job, from 7 employers. Every job came from the employer sites step.
- The list is mostly lost to the role-and-place cut, not to the clock: 11 of 18 people have 7 or fewer employers for their role in their places (426 → 1 for the truck driver). Time bites p8, p10, p11 only (58, 231, 156 employers, 15 read).
- Nothing on a job says which reader's feed it came from. In a press 1 on a fresh data folder the list is the only reader, so the origin is provable by construction for the 18 people, not on a real install.

## Design
- **The list as the press saw it** (owner: `tools/persona-search/scout_list.py`, the engine's own `employer_index.relevant` and `role_kinds` on the press's cached list; the log's numbers, also when K == N): `generated` (the publish id), feeds served, with a counted mix, N in the person's places, K for the role, N - K split into "the scout counted their kind and it is not theirs" and "no kind mix yet" (missing data, not a no); right jobs of employers on the list. Counts only: employers' names are joined in memory and never written (the list is private learned data, the night's artifacts are downloadable). No log line, no engine file.
- **Not in this plan:** the first-slice / read / unread funnel (funnel.py parses most of it already; the engine's "unread" looks overstated: a hypothesis for sf).
- **Verdict rows carry what the Admin reads** (owner: `gate.compare`): `sources` now, `scout` with 2/3.
- **A publish is compared on** the per-person cells (N, K, read, listed, right, employers right) before and after, with the spread of 3 runs.
- **Not built:** the engine writing an `origin` on a job (real installs): parked, the question is the night's 18.

## What the first measure found (11 Nov 2026, counts only; corrected with sk the same day)
The first reading said 55-94% of the employers in a person's places have no counted kind. That was wrong: it counted ~363 feeds that list no open job and carry no place, which sit in every person's N. Agreed with sk (lab issue #87): the N employers fall in four classes per person, whatever their kind: empty feed (no open job), open jobs and no kind counted (the real gap, 17-40% of the employers with open jobs per sk's count), the whole employer's mix only (READ:  falls back to it), counted per country. K (what the engine reads for the person's kind) and "the scout counted it and it is not theirs" depend on the person's kind. N reproduced the night's logged N exactly for 6 people.

## Progress
- [x] 1/3 The Sources card shows the night's per-source counts (verdict rows carry `sources`; guard test) (#3807) (proof: tests/tooling/ci/test_search_sources_count.py @024f7496)
- [ ] 2/3 The night records what the Central Scout's list gave each person: `scout` on each result (in_places, empty_feeds, no_kind_mix, mix_only, counted_per_country, for_role, kind_not_theirs, listed/right from the list), rows[].scout, a night step (`tools/persona-search/scout_list.py`, counts only, names never written)
- [ ] 3/3 Admin card "Central Scout" (jobadabra-web, on the Finish line page): first figure = the share of the person's employers with open jobs that have no counted kind (no_kind_mix over N - empty_feeds), per person and the median of the 18, empty feeds shown apart; one Before | After picture and the owner's yes through sa
- Parked, not numbered: the engine writes an `origin` on a job (Work board draft, Parked/Low)
