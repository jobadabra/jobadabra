# Find jobs finish line: the goal, the two numbers, the plan

> **Verdict:** Find jobs is finished when what it lists for a person equals what a person finds by hand on every free source. Two numbers measure it, on 18 fixed people. The rule that keeps search work pointed at it is in CLAUDE.md "Working rules".

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
| LinkedIn Jobs | yes, **by hand** | Safety rule (CLAUDE.md): no test or automation passes a login wall or uses the owner's LinkedIn session. So the owner (or a person) types the count for a person into Admin; until then the column shows "not counted" and the coverage says "without LinkedIn". Lifting this is an owner decision, not a session's. |

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
| 2 | The market count: every source of the list counted per person, stored per source | lj | Opus | tools/persona-search/ reference files, search-reference.yml |
| 3 | In = out: the table of where EURES's right jobs are lost, then the fixes, each naming its people | sf | Opus | src/ (pipeline) |
| 4 | The Admin graph: coverage and in = out per person and over time, blind nights grey | oe | Sonnet | jobadabra-web |
| 5 | A check that measures everyone: one AI, no fallback, an unmeasured person run again once; room for by-hand runs | cr (after #3696) | Sonnet | search-personas.yml, jobadabra-web broker lane |

Order: WP1, WP2, WP3's table, WP4's picture and WP5 start now, side by side. WP3's fixes start when its table exists. WP4 shows in = out for EURES from day one and gains sources as WP2 lands them.

### WP2 detail (lj)
1. Count first, no code: what search-reference.yml and its tools count today (fields total / reachable / eures), per person; which of the list's sources have a search of their own that takes role + place.
2. Design in one page to sa: per source, the query, the cap (today: the first 100 in-region rows), the judge, the unique key, what "refused" does (a 401/403/429 or a bot check ends that source for the run: "not counted", never retried, never a guess).
3. Independence: the counter imports no pipeline stage (no title triage, no place triage, no time budget); it may share only fetch and parse helpers. A job counts for the market whoever found it; the list also records which sources showed it.
4. Build one source per PR, the six people without a reference first (one public board per country: Croatia, Ireland, Portugal, Hungary, Austria, Denmark). Each PR's outcome: "p<n> has a reference of N right jobs".
5. Runs with every check (by hand or night), stored per source in the night's rows. AI cost of the judge per run stated in the PR.

### WP3 detail (sf)
1. The table, no code: for p1, p2, p4, p13, p17 (and p5, p8), EURES's right jobs of the reference against the same night's list; each missing job at its stage. Needs the reference's job keys (title + employer) kept beside the count; ask lj for that field first.
2. From the table, the one or two stages that lose most. Each fix PR: names the people it moves, 3 runs before and 3 after (by hand, EURES on), a difference larger than the spread, and a ledger row.
3. The count "in, out, lost at stage" is sent with the night's rows (oe's #3695 carries place and role counts; extend the same row), so in = out is on the graph every run, for every source WP2 adds.
4. Held work stays held (3/8 to 8/8, place PR b) unless the table names it as the cause.

### WP4 detail (oe)
Replaces sa's earlier chart list. Per run (night or by hand, marked): (a) market coverage % for the 18 and per person, (b) in = out per source per person (bars: in, out, lost by stage), (c) people at the line, over time, (d) people not measured as a grey band, (e) the AI the run used, (f) LinkedIn "not counted" until typed in; a field to type it. Line broken at 11 Nov (EURES off in the night's own search; the in = out runs for EURES are by hand with EURES on). Picture to the owner first (side by side), then build.

### WP5 detail (cr)
From sf's live count (10 Nov): one night = about 560 AI calls; Codex fits one night plus one by-hand run a day; the by-hand lane's cap is 800 calls a day. (1) The check runs on one engine with no fallback (Codex now: measured to fit); a night whose engine is out is "not run" and is dispatched again, never finished on another AI. (2) A person is unmeasured only when the run did not finish for them; an "AI slow" person is run once more at the end of the same run. (3) Say what by-hand cap gives two full runs a day and bring that number to sa (the owner decides limits). Site PR first where both repos change.

## Rules for every search PR from now (go into CLAUDE.md with WP1)
- It names the person and the number it moves (in = out for a source, or coverage), with 3 runs before and 3 after; a difference counts only when larger than the spread of those runs.
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
- [ ] WP2 (lj) The market count: every source of the list counted per person, stored per source
- [ ] WP3 (sf) In = out: the table of where EURES's right jobs are lost, then the fixes, each naming its people
- [ ] WP4 (oe) The Admin graph: coverage and in = out per person and over time, blind nights grey
- [ ] WP5 (cr) A check that measures everyone: one AI, no fallback, an unmeasured person run again once
