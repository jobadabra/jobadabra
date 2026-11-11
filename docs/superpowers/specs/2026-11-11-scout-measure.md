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
The first reading said 55-94% of the employers in a person's places have no counted kind. That was wrong: it counted ~363 feeds that list no open job and carry no place, which sit in every person's N. Agreed with sk (lab issue #87): the N employers fall in four classes per person, whatever their kind: empty feed (no open job), open jobs and no kind counted (the real gap, 17-40% of the employers with open jobs per sk's count), the whole employer's mix only (READ: `role_kinds.located` falls back to it), counted per country. K (what the engine reads for the person's kind) and "the scout counted it and it is not theirs" depend on the person's kind. N reproduced the night's logged N exactly for 6 people.

## Progress
- [x] 1/3 The Sources card shows the night's per-source counts (verdict rows carry `sources`; guard test) (#3807) (proof: tests/tooling/ci/test_search_sources_count.py @024f7496)
- [x] 2/3 The night records what the Central Scout's list gave each person: `scout` on each result (in_places, empty_feeds, no_kind_mix, mix_only, counted_per_country, for_role, fit_their_kind, kind_not_theirs, listed/right from the list), rows[].scout, a night step (`tools/persona-search/scout_list.py`, counts only, names never written) (proof: tools/persona-search/scout_list.py @61f48e9c)
- [x] 3/3 Admin card "Central Scout" (jobadabra-web, on the Finish line page): first figure = the share of the person's employers with open jobs that have no counted kind (no_kind_mix over N - empty_feeds), per person and the median of the 18, empty feeds shown apart; one Before | After picture and the owner's yes through sa (jobadabra-web #556, 03de0c9) (proof: docs/superpowers/specs/2026-11-11-scout-measure.md)
- Parked, not numbered: the engine writes an `origin` on a job (Work board draft, Parked/Low)

## Proof: the by-hand run of all 18 (fill-18, main, run 43088269080, 11 Nov 2026; counts only, no employer name, no list-wide number)
- **Rows carry the fields:** 15 of 18 rows carry `scout` and `sources`; the 3 that do not (p13, p14, p15) are the people whose job failed in GitHub's incident (kind `fault`), so they carry neither and the card says "not measured", never 0.
- **The four classes add up:** on all 15 rows empty feeds + no kind counted + whole mix only + counted per country = the employers in places (the check the card's clean step makes; a record that failed it would show "not sent").
- **The card, drawn from that verdict through the Admin's own clean step:** 15 bars, 3 "not measured", 0 "not sent", no employer name. Median gap 25% of the employers with open jobs (15 people with a gap). Per-person gap, p1..p18: 25 22 39 32 25 23 26 25 18 22 25 31 - - - 28 33 30 (%), a gap between 18% and 39% for everyone measured, as the first measure found.
- **`sources` (1/3) on the same verdict:** employer sites brought right jobs to 6 of the 15 people, job boards to 1 person, free job APIs and web search to nobody (all 0, which the card reads as "0 right jobs for 15 people").
- **Found while reading it (reported to sa, owned by the Work board card "[sm] Morning line: keep Free job APIs and Web search at 0, or watch only the 3 finder steps?", not changed here):** the per-source chart's rule (jobadabra-web #559, #561) would tell "Free job APIs" and "Web search" at 0 on the first night that carries these numbers. The engine's own `unread` cause (`lost.py`) already says the same for free job APIs; web search at 0 follows from the job boards running out of time (their jobs carry the web-search fact). A row with 0 jobs cannot yet tell "read, found nothing" from "not read" (the night does not send `sources[word].read`, parked).
