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

## What the first measure found (11 Nov 2026, counts only)
For each of the 18 people, 55-94% of the employers in their places have no counted kind of jobs yet (role_kinds.fits: "not read on a guess"); the central scout judges kinds for only ~255-370 of ~7,500 feeds a run (CENTRAL_AI_CAP was 40 in the checkout read, 200 now per sk; lab issue #87). N reproduced the night's logged N exactly for 6 people. This is the card's first figure.

## Progress
- [x] 1/3 The Sources card shows the night's per-source counts (verdict rows carry `sources`; guard test) (#3807) (proof: tests/tooling/ci/test_search_sources_count.py @024f7496)
- [ ] 2/3 The night records what the Central Scout's list gave each person: `scout` on each result (served, served_with_mix, in_places, for_role, kind_not_theirs, no_kind_mix, publish id, listed/right from the list), rows[].scout, a night step (`tools/persona-search/scout_list.py`, counts only, names never written)
- [ ] 3/3 Admin card "Central Scout" (jobadabra-web, on the Finish line page): first figure = the share of employers in the person's places with no counted kind, per person and the median of the 18, with the publish id; one Before | After picture and the owner's yes through sa
- Parked, not numbered: the engine writes an `origin` on a job (Work board draft, Parked/Low)
