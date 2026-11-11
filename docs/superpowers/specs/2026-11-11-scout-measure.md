# Scout measure: how much the Central Scout's list helps a person's Find jobs

> **Verdict:** the owner sees, per night and per test person, how many right jobs the shared employer list brought and where the rest of the list was lost. Built from the saved night first; the 18 fixed people only.

Pane sm (of session sa), 11 Nov 2026. Owner's words (11 Nov 2026, to sa): "How much the Central Scout is helping us? Do we measure this ?" then "Ok. Let's improve the measuremenet. Start a session on this."

## What the first EURES-off night showed (run 42927975750)
- 61 jobs listed, 15 right, 5 of 18 people with a right job, from 7 employers. Every job came from the employer sites step.
- The list is mostly lost to the role-and-place cut, not to the clock: 11 of 18 people have 7 or fewer employers for their role in their places (426 → 1 for the truck driver). Time bites p8, p10, p11 only (58, 231, 156 employers, 15 read).
- Nothing on a job says which reader's feed it came from. In a press 1 on a fresh data folder the list is the only reader, so the origin is provable by construction for the 18 people, not on a real install.

## Design
- **The list as the run saw it** (owner: the engine's own `employer_index.json`): `generated` (the publish id), feeds served in the search's regions, N in the person's places, K for the role. Written once per press into the check's per-run record (no user-facing text: log lines show in Live updates).
- **The funnel per person** (owner: `tools/persona-search/funnel.py`, the one parser): list_in_places, kept_for_role, first_slice, read, unread_engine, jobs_read, titles_in_places, listed, right, employers_listed, employers_right, list_generated. Null when not seen, never 0. N → K split into "the AI says not their kind of role" and "kind unknown for this employer" where the data can tell.
- **Verdict rows carry what the Admin reads** (owner: `gate.compare`): `sources` now, `scout` with 2/3.
- **A publish is compared on** the per-person cells (N, K, read, listed, right, employers right) before and after, with the spread of 3 runs.
- **Not built:** the engine writing an `origin` on a job (real installs): parked, the question is the night's 18.

## Progress
- [ ] 1/3 The Sources card shows the night's per-source counts (verdict rows carry `sources`; guard test)
- [ ] 2/3 The night records what the Central Scout's list gave each person (funnel + list record) and the Admin card "Central Scout" (site PR, one Before | After picture, the owner's yes through sa)
- [ ] 3/3 Parked: the engine records a feed's origin on the job (Work board draft)
