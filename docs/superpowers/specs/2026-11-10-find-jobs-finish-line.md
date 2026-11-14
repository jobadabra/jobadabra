# Find jobs finish line: the goal, the two numbers, the plan

> **Verdict:** Find jobs is finished when what it lists for a person equals what a person finds by hand on every free source. Two numbers measure it, on 18 fixed people, and fixed guardrails keep them from slipping back. The rule that keeps search work pointed at it is in CLAUDE.md "Working rules".

Design by session sa (search architect), 10 Nov 2026. Owner decisions are quoted; everything else is sa's default and says so. Rule: [CLAUDE.md](../../../CLAUDE.md) "Find jobs has a finish line"; map: [search](../../map/search.md).

## The goal, in the owner's words (10 Nov 2026)
- "The finish lines should be basically all the jobs on the market, that we can find with different sources, which are all free. So far, our formula: unique(Linkedin Jobs + Web Search + Employer Careers + Jobs Feed APIs...)"
- "If I search for 'electrical engineer in Prague'… by searching on Google, searching on Linkedin Jobs, searching on major jobs feed APIs, searching on the big employer sites, on the career… summing all the jobs I found (that's what a normal person would do without Jobadabra)… should be the number what Jobadabra finds. That should be the finish line."
- "If we're using EURES, our search results should always be what EURES gives + some additional sources that we have. For me it makes no sense that we get 5 while EURES gets 18 while we have EURES activated."
- "Save this as a goal/target/rule/skill… so that next session working on this topic knows what's the finish line."
- Asked via AskUserQuestion, options chosen: "Scoreboard first (Recommended)" · the six people EURES has no jobs for: "One public board each (Recommended)" · "Yes, as a CLAUDE.md rule (Recommended)".
- "I don't want to wait for nightly. We should trigger manually, to understand right away the direction."

## Two numbers (the whole scoreboard)
A right job = right role AND right place, judged by the blind judge (tools/persona-search/gate_judge.py), unique by title + employer. People = the 18 fixed personas.
1. **In = out, per source.** For a source that is on: the right jobs that source's own search shows for the person (in) against how many of those are in Jobadabra's list after one Find jobs search (out). The owner's invariant: out is never below in. A loss is counted at the stage that lost it: not read · read, never asked (time) · asked, the AI said no · placed out · dropped as a double · listed.
2. **Market coverage.** Market = unique(right jobs of every source on the fixed source list, each counted by that source's own search, slowly, outside the 3-minute pipeline). Coverage = right jobs Jobadabra lists after one Find jobs search / market. The goal is 100%.
sa's default (the owner may change it): "reached" = every person at 95% or more on 3 runs in a row (one run moves by about ±10 jobs for a person, so one run proves nothing).

## The fixed source list (changes only on the owner's word; this is what stops the list, and the work, from growing for ever)
| Source | In the market count | How it is counted |
|---|---|---|
| EURES | yes | exists: search-reference.yml (`eures` field) |
| One public job board per country, no login | yes (owner chose it for the 6 people EURES has nothing for; sa's default: for every country of the 18) | new, lj |
| Employer career sites | yes | the employers the index names for the person's places, read by the reference counter, not by the pipeline |
| Free job feed APIs | yes | each API's own search for role + place |
| Web search | yes | the AI's web search tool, asked for postings of role + place; never a scraped Google page (bot checks: safety rule) |
| LinkedIn Jobs | yes, **by hand** | Safety rule (CLAUDE.md): no test or automation passes a login wall or uses the owner's LinkedIn session. Owner, 10 Nov 2026: "you can use my Linkedin Jobs to see some stats? But use it with care. Not too fast, not too long...": one session reads a few result counts by hand in his own Chrome with the local skill `linkedin-jobs-baseline` (at most 9 searches a session, one page each) and the numbers are typed into Admin's by-hand field; until then the column shows "not counted" and the coverage says "without LinkedIn". Whether the app's own LinkedIn jobs feature works is checked by a dedicated session (lt). Tests, CI and the engine still never use his LinkedIn session. |

## Where we are (10 Nov 2026)
- In = out for EURES, EURES on (night 9 Nov against the reference of 6 Nov, one run each): at or above EURES for 5 of 12 people (p3, p9, p10, p12, p14); below for p5 23 of 24, p8 17 of 18, p1 14 of 19, p13 23 of 43, p17 7 of 13, p4 1 of 6, p2 0 of 1. Not yet split by stage: that is WP3's first table.
- 6 of 18 people have no reference at all (EURES shows 0): p6 Zagreb, p7 Dublin, p11 Lisbon, p15 Budapest, p16 Vienna, p18 Copenhagen; our search listed 0 right jobs for all six on 9 Nov.
- Market coverage: never measured (the market count has one source today).
- The nightly check changed its AI three times since 27 Oct; 2-4 people a night are "AI slow" unmeasured on Codex; 7 Nov measured nobody.
- 246 of 647 PRs in 30 days changed the search engine; the PR yardstick replays 13 of 16 people to 0 jobs (it catches crashes, not better or worse).

## Work packages (one session each; disjoint files)
| WP | What the owner gets | Who | Model | Files |
|---|---|---|---|---|
| 1 | The rule in CLAUDE.md, this plan as a spec with `## Progress`, the local-check skill's "3 runs a side" step | pane fl | Sonnet | CLAUDE.md, docs/superpowers/specs/, .claude/skills/check-job-search-locally |
| 2 | The market count: every source of the list counted per person, stored per source | mc | Opus | tools/persona-search/ reference files, search-reference.yml |
| 3 | In = out: the table of where EURES's right jobs are lost, then the fixes, each naming its people | sf | Opus | src/ (pipeline) |
| 4 | The Admin graph: coverage and in = out per person and over time, blind nights grey | oe | Sonnet | jobadabra-web |
| 6 | The Sources section: what share of right jobs each source brings, and what only it brings | oe (after WP4) | Sonnet | jobadabra-web + the run's rows |
| 5 | A check that measures everyone: one AI, no fallback, an unmeasured person run again once; room for by-hand runs | cr (after #3696) | Sonnet | search-personas.yml, jobadabra-web broker lane |

Order: WP1, WP2, WP3's table, WP4's picture and WP5 start now, side by side. WP3's fixes start when its table exists. WP4 shows in = out for EURES from day one and gains sources as WP2 lands them.

### WP2 detail (mc)
1. Count first, no code: what search-reference.yml and its tools count today (fields total / reachable / eures), per person; which of the list's sources have a search of their own that takes role + place.
2. Design in one page to sa: per source, the query, the cap (today: the first 100 in-region rows), the judge, the unique key, what "refused" does (a 401/403/429 or a bot check ends that source for the run: "not counted", never retried, never a guess).
3. Independence: the counter imports no pipeline stage (no title triage, no place triage, no time budget); it may share only fetch and parse helpers. A job counts for the market whoever found it; the list also records which sources showed it.
4. Build one source per PR, the six people without a reference first (one public board per country: Croatia, Ireland, Portugal, Hungary, Austria, Denmark). Each PR's outcome: "p<n> has a reference of N right jobs".
5. Runs with every check (by hand or night), stored per source in the night's rows. AI cost of the judge per run stated in the PR.

### WP3 detail (sf)
1. The table, no code: for p1, p2, p4, p13, p17 (and p5, p8), EURES's right jobs of the reference against the same night's list; each missing job at its stage. Needs the reference's job keys (title + employer) kept beside the count; ask lj for that field first.
2. From the table, the one or two stages that lose most. Each fix PR: names the people it moves, one search before and one after started in the same minute (by hand, EURES on; 3 a side until 12 Nov 2026), no loss larger than the person's usual difference, and a ledger row.
3. The count "in, out, lost at stage" is sent with the night's rows (oe's #3695 carries place and role counts; extend the same row), so in = out is on the graph every run, for every source WP2 adds.
4. Held work stays held (3/8 to 8/8, place PR b) unless the table names it as the cause.

### WP4 detail (oe)
Replaces sa's earlier chart list. Per run (night or by hand, marked): (a) market coverage % for the 18 and per person, (b) in = out per source per person (bars: in, out, lost by stage), (c) people at the line, over time, (d) people not measured as a grey band, (e) the AI the run used, (f) LinkedIn "not counted" until typed in; a field to type it. (g) **Weakest now** (owner, 10 Nov 2026: "We should be more in control of what's happening with our algorithm · what is weak"): on top of the page, the 5 worst rows of the last run: person × source × stage with the most right jobs lost, each with its trend over 7 runs and the open PR that names it (or "nobody on it"). Line broken at 11 Nov (EURES off in the night's own search; the in = out runs for EURES are by hand with EURES on). Picture to the owner first (side by side), then build.

### WP5 detail (cr)
From sf's live count (10 Nov): one night = about 560 AI calls; Codex fits one night plus one by-hand run a day; the by-hand lane's cap is 800 calls a day. (1) The check runs on Codex, with Claude as its replacement when Codex is out, never Free AI (owner, 10 Nov 2026, on #3703: "Claude should be at any times a replacement"); each row counts its calls per engine (#3703). A night no AI answered is "not run", never zeros or red (#3714); its re-dispatch is parked, and its alert comes with G6. (2) A person is unmeasured only when the run did not finish for them; an "AI slow" or "AI queue full" person is run once more at the end of the same run, marked as a second try (#3716). (3) The by-hand day cap is gone while we develop and test (owner, 10 Nov 2026: "There should be no limits/caps"; jobadabra-web #525). Site PR first where both repos change.

### WP6 detail (oe, after WP4's first graph): what each source is worth
Owner, 10 Nov 2026: "We should have in Admin also, probably a dedicated section showing what are all our sources and how much do they weight, how much do they help… on average, 30% (or x amount) of the jobs we find because of Web Search. Y amount because of the Central scout / employer sites. X amount because of Linkedin Jobs… X amount of EURES… So that we know how good/efficient/valuable are each of our sources, and so that we can continuously add new sources and increase our job results." · "let's make sure that we have enough data being collected to understand how good/fast are we moving to the finish line. We should have graphs in the Admin showing us our progress."
A section in Admin → Job search, "Sources". Per source (EURES, employer sites: central scout and index, job boards found by web search, free job feed APIs, LinkedIn Jobs, each new one), per run and averaged over the last 7 runs, for the 18 people:
- right jobs it brought, and its share of all right jobs listed (the "30% because of web search" number);
- right jobs ONLY it brought (no other source showed them): the real value of a source, and the test a new source must pass;
- fit 70+ jobs it brought; seconds it took; people for whom it brought at least one.
Data: the engine already keeps a job's source and the check's rows carry `step_yield` (employer_sites, job_boards, free_job_apis) and `counters.eu`; first step is a count of what is stored against the list above, then one row shape per source sent with the run (same sender as #3695), counts only.
LinkedIn Jobs: the 18 fictional people never read LinkedIn (safety rule). Its share comes only from real installs that turned it on: counts only, through the existing pack path, shown when at least 3 installs report (k of 3); until then "not enough installs".
Adding a source stays an owner decision; this section is the evidence for it. Owner, 10 Nov 2026: "At some point I should be able to say: Ok. Now let's add Adzuna API... And we'll have one more source, and we'll measure in some time how much that method/source is helping on top of what we have." So a new source is one reader row (cr's `src/sources/reader_rows.py`, #3696) and appears in this section by itself, with its "only it brought" number after 7 runs: no new graph, no new pipeline code per source.

## Fixed guardrails (WP7; owner, 10 Nov 2026: "Let's not forget about guardrails. Fixed guardrails")
Fixed = it does not move unless the owner's words are in the commit, like the fix ledger. Each one below would have caught at least 2 real escapes of the last 30 days (the "gate only if it pays" rule); the PR that adds it counts them.
| # | Guardrail | Where it runs | Stops | Who |
|---|---|---|---|---|
| G1 | **In = out, offline.** A fixture source with N jobs, every AI answer yes, time enough: all N are listed. One loop over every reader row, so a new source is covered by itself. A second case with a short clock: the unasked jobs are counted as `never_asked`, never silently gone. | every PR touching the search (unit, seconds, no AI, no network) | a stage that drops a source's jobs (9 Nov: 0-23 of EURES's right jobs lost per person; KeyError 'EURES' skipping first jobs; #3689 one failed page ending the read) | sf, first PR of WP3 |
| G2 | **Floors that only rise.** Per person and number (kept today: right jobs, EURES in = out, seconds to first job, where no first job reads as 180 s; not yet: in = out of the other sources and coverage, which join once the night's rows carry them per source, after sf's lanes 4/5: a Parked card on the Work board), the best level held on 3 runs in a row is kept under `refs/tags/search-floors` (tools/persona-search/floors.py; only a scheduled night writes it). A run below a floor by more than that person's spread, twice in a row, is red: Admin card + alert + the merges since the last green run named. A floor is lowered only with `Floor-change: "<owner's words>"`. | each night and each by-hand run (not per PR: one full run is about 560 AI calls) | one session's gain undone by the next (#3685's first build halved scoring; the week of 30 Oct to 5 Nov at 0) | cr (file + check), oe (card + alert) |
| G3 | **The measure itself is locked.** The 18 people, the judge's prompt, the fixed source list, the check's AI chain (Codex, Claude as its replacement): a lock file; changing any needs `Scoreboard-change: "<owner's words>"`, and the graph breaks its line there. | every PR (hash check) | numbers that stop being comparable (the check's AI changed 3 times in 2 weeks unseen; 6 people became 18) | cr |
| G4 | **Admission line.** A PR that changes search files says `Moves: p<n> <number> <before> → <after> (1 run a side, same minute, usual difference d)` (3 runs a side and their spread until 12 Nov 2026; still accepted) or `Moves: nothing (why)`; tools/pr-body-check.py refuses it otherwise. | every search PR | fixes graded by their author on one run (4 claims withdrawn on 10 Nov alone) | fl, after WP1 |
| G6 | **A source getting lost is red and alerted.** Owner, 10 Nov 2026: "If a source is getting lost · We should have red CI · We should have alerts · on the Engineering channel". Per run and per source: a source that brought right jobs on the last 3 runs and brings none, or whose in = out falls under its floor, or that was not read at all (refused, crashed, timed out for every person), turns the run red (the workflow fails, not a note) and posts one alert on the Engineering channel through the existing alert path: source, people hit, stage where the jobs stopped, the merges since the last green run. One alert per cause, one green-again message when it clears. A blind run (the check's AI out) is "not run", never a red source. | each night and each by-hand run; per PR the offline G1 is the red CI | a source silently contributing nothing | cr (red run + alert), sf (the stage counts it reads) |
| G5 | Already there, kept: the fix ledger (locked rows), Find jobs ≤ 3 min test, the one-ranker guard, the two "only shrinks" ratchets (run state, catch-alls), the blind judge. | every PR | | |
Not a guardrail: the PR yardstick (replays 13 of 16 people to 0 jobs); it stays a crash check and is named so in its PR comment.
Limit, said plainly: G2 cannot run per PR (AI budget), so between two runs a regression can sit on main for up to a day; G1 and the ledger are the per-PR net, G2 the daily one.

## Queued after WP3's table: the search in parallel, and one progress line per lane (WP8)
Owner, 10 Nov 2026: "we should try to parallelize as much as possible a job search. Instead of having one progress line that shows a sequential order... We should have as many progress lines as many parallel threads we can have in parallel."
What is known (10 Nov): the readers already run side by side (EURES from the press, employer sites, job boards), but (a) a serial start comes first: places worked out at 13-20 s, then employers named at 41-59 s on the night's AI (24 s on the Mac), and employer sites are read only after it; (b) every AI question shares 4 slots, and that is where jobs are lost: 28 to 307 titles per person were never asked when the 3 minutes ended (night 9 Nov), score calls waited 17-32 s behind other calls (Mac, 10 Nov).
So two parts, neither started before its number exists:
- Engine (sf, inside WP3): the per-person timeline in the table: each stage's start and end, what it waited for, slot occupancy. From it, the parallel fixes that move `never_asked` and seconds to first job (the serial start; more than 4 AI calls at once if the plan and the person's machine allow it: measured, not assumed; one lane per source). Each is a search PR under the admission rule.
- App (a UI session, Queued): the Find jobs card shows one progress line per lane that really runs (per source: read N of M; AI: titles asked N of M; scored N of M), fed by the same per-source counts as the run's rows. Picture first (side by side, light and dark), built after the owner's yes; it shows only lanes that exist in the engine, never a made-up one.

### WP8 Design: every source its own lane (owner, 10 Nov 2026: "Build the lanes now (Recommended)", asked via AskUserQuestion by sa; 11 Nov: "Ok. Let's fix/build it then")
Measured first (sf, 32 person-runs, yardstick replays of the night recordings, EURES on; befores to be re-measured on EURES-off tapes, owner, 11 Nov 2026: "Other 3rd parties should be just bonuses, not our core"): free job APIs ran out of time on 28 of 32 first presses, job boards on 27, both on 32 of 32 repeat presses; the employer sites' first read started at 111 s (median); 19 of 32 first presses were ended by the app's 175 s stop because a scoring call still running held the process (#3740). The sources wait for each other only by call order, never because one needs another's result (`src/daily_search.py:209` → `:220`).
```
Design:
1. One clock (the press's), one lane per source: EURES, employer sites, job boards, free job APIs, web search for boards, LinkedIn (app).
   Every lane starts at second 0; none waits for another.
2. A wait is a real need, declared in the one lane table (src/sources/reader_rows.py LANES); today only the boards the web search found need it.
   EURES is a lane like any other behind its own on(env): nothing waits or is ordered around it.
3. Calls end on the clock, not only start on it: every network and AI call gets its lane's time left as its limit, and the search never waits
   at exit for a late call (#3740: Python's exit joined a 15-64 s scoring call).
4. A lane ends in exactly one said state, a stage.Result: done / cut (time up, "N wait") / failed (why). One owner per lane writes it; the
   same state feeds step_yield, the night's `sources` rows, G6 and the card. A failing lane never ends the press (one catch-all, stage.guard).
5. Sorting and scoring take jobs as they land from every lane, on the existing AI slots. The finder keeps its 45 s.
6. Nothing a run found is dropped: a job read but not yet placed, sorted or scored stays waiting in its one owner (the jobs store), and a
   source with waiting jobs is not marked read or rested 6 h. (Owner, 11 Nov 2026: "each of the runs should provide new jobs".)
7. One owner of priority, the planner (src/press/plan.py), now applied: every run scores what waits, then sorts and places what waits, then
   reads new; a lane pauses and keeps its place when its waiting queue passes what the AI can ask in the rest of the run. A run ends saying
   "step x of y" and what waits; the next run continues there. (Owner, 11 Nov 2026: "When a find jobs run finished after 3 min, we know that
   we are at step x from the plan (which has y total steps)".)
Simplify to it: the ordering code of boards_first, boards_ahead and boards_beside is replaced; no new case is added.
```
Proofs, red today and marked `red_until(<fix>, <cause>)` (tests/unit/press/red_until.py): each is reported skipped while it fails with its stated cause, fails on any other error, and fails once it passes, so the fixing PR removes the mark: `tests/unit/press/test_lanes.py` (rules 1, 4: every source lane reading before any has finished; 3/5) and `tests/unit/press/test_press_ends.py` (rule 3: the process ends by its deadline with a call in flight, each place that leaves work running in one loop, ending as the engine does through src/run_exit.py; 2/5). The table's own guard: `tests/unit/sources/test_reader_rows.py` LanesTest.

## Rules for every search PR from now (go into CLAUDE.md with WP1)
- It names the person and the number it moves (in = out for a source, or coverage), with one search before and one after on a person the change reaches, both started in the same minute (CI or the Mac; sessions run their pairs in parallel); a loss larger than that person's usual run-to-run difference holds the PR, and a gain is claimed only with its mechanism proven by a test (owner, 12 Nov 2026: "Let's do only 1 live search before and after. not 3 (which are 6)"; until then 3 runs before and 3 after).
- The scoreboard grades it, not its author.
- A person still red after 3 PRs gets a `Design:` step, not a 4th PR.
- The source list changes only on the owner's word.
- At the line, search work stops, except bugs the owner sees.

## Parked
- Yardstick tapes at a pace that reaches jobs (low: the scoreboard is the live check; the yardstick stays a crash check).
- Re-record p9, p10, p15 on CI (same reason).
- Coverage after a day of searches, not only the first one (after the line for one search is measured).

## Progress
- [x] WP1 The rule in CLAUDE.md, this spec, the local-check skill's "3 runs a side" step (pane fl) (proof: docs/superpowers/specs/2026-11-10-find-jobs-finish-line.md, CLAUDE.md)
- [ ] WP2 (mc) The market count: every source of the list counted per person, stored per source
  - [x] 1/5 the six people without EURES get their national board (proof: tools/persona-search/market_boards.py @d54ef2d3)
  - [x] 2/5 every person's national board, 16 of 18 (proof: tools/persona-search/market-boards.json @6e43bf36)
  - [x] 3/5 web search (proof: tools/persona-search/market_web.py @0257d351)
  - [x] 4/5 employer sites (proof: tools/persona-search/market_employers.py @5a53992f)
  - [ ] 5/5 Admin rows with every check (oe's row shape): sender tools/persona-search/reference.py (this PR), receiver jobadabra-web #528
- [ ] WP3 (sf) In = out: the table of where EURES's right jobs are lost, then the fixes, each naming its people
- [ ] WP4 (oe) The Admin graph: coverage and in = out per person and over time, blind nights grey
- [ ] WP5 (cr) A check that measures everyone: Codex, then Claude, never Free AI (#3703); a night no AI answered is "not run" (#3714); an AI-slow person run again once (#3716)
- [ ] WP6 (oe, after WP4) The Admin "Sources" section: what share of right jobs each source brings, and what only it brings
- [ ] WP7 G1 (sf, first PR of WP3) In = out, offline: a fixture source loses no job at any stage, one loop over every reader row
- [ ] WP7 G2 (cr file + check, oe card + alert) Floors that only rise, per person and number
- [x] WP7 G3 (cr) The measure is locked: the 18 people, the judge's prompt, the source list, the check's AI (proof: tools/persona-search/scoreboard.py @c62f4734)
- [x] WP7 G4 (fl) Admission line: a search PR says `Moves:` with person, number, 3 runs a side and spread, or `Moves: nothing (why)` (proof: tools/pr-body-check.py, tests/tooling/ci/test_pr_moves.py)
- [x] WP7 G6 (cr red run + alert, sf stage counts) A source getting lost is red and alerted on the Engineering channel ("gone" arms once #3749 writes `sources`) (proof: tools/persona-search/lost.py, desktop/e2e/search-alert.mjs, tests/tooling/ci/test_search_lost.py)
- [ ] WP8 (sf engine timeline and parallel fixes, a UI session for the app) The search in parallel, one progress line per lane
  - [ ] 1/5 Safety net: the lane table and the two proofs, red today for their stated cause under `red_until` (this PR)
  - [ ] 2/5 Calls end on the clock, in every place that leaves background work (closes #3740)
  - [ ] 3/5 Lanes: every source starts at 0, ends in a said state (closes #3754)
  - [x] 4/5 Waiting jobs kept and asked first (wj, closes #3754; owner, 12 Nov 2026, asked via AskUserQuestion: "Places that unlock most first (Recommended)"): the free APIs' locations are placed by the jobs they decide first (rule 7), a source whose jobs wait for the AI is read again, not rested 6 h, and a read that ends after the read cut is kept when it ends (rule 6) (proof: tests/unit/ai/test_titles_with_places.py, tests/unit/sources/test_aggregators.py, tests/unit/sources/test_api_lane.py, tests/unit/press/ledger.py). Rule 5 was built before (#3649, #3685). The planner applied (rule 7's reorder of whole steps) is parked: no measured loss needs it (Work board, Parked)
  - [ ] 5/5 The card: one progress line per lane (picture first, the owner's yes before code)

## The Trello profile cards: how N is measured (14 Nov 2026)
Owner, 14 Nov 2026, asked via AskUserQuestion by sa, "How should the Trello cards be measured?": "With EURES on, 3 searches (Recommended)". Second question, "What should happen to those two cards?" (d03, d04: a target made of login-wall jobs only): "Mark them, decide later (Recommended)".
- **Changes:** a card's number N is what a user gets: EURES on (`search-profiles.yml -f eures=true`, the installed app's setting), the middle of three judged searches. "Ours alone" (EURES off) stays on the card as a second line. d03 and d04 say their target is login-wall jobs only and cannot be met by the public search; a new target from sources we may read is proposed to the owner separately, with numbers.
- **Stays:** the 18 locked people and the judge (the scoreboard lock is not touched), the 15 card people and their targets X (`profiles.py target`: "Keep EURES as X"), the source list, the 45 s validity rule. No card moves until the middle of three meets its target and the owner says so.
