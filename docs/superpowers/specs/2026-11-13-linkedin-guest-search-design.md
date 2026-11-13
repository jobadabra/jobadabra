# LinkedIn's public job search on every Find jobs (the guest read)

> **Verdict:** each Find jobs in the Mac/Windows app also reads LinkedIn's public, logged-out job search (JobSpy's method): page 1 of up to 3 searches first, ≤ 4 search pages a press, 20-40 s apart, ≤ 6 requests in any 10 minutes per computer, from the person's own address, no cookie, no proxy, our own honest user agent; it stops for the run at the first 429/999/check/sign-in page and never retries. Proven by hand on 13 Nov 2026: our honest user agent got 200 and 10 cards; the job page has its description.

## Problem
LinkedIn is one of the finish line's sources (spec 2026-11-10-find-jobs-finish-line.md), and most people never turn on the signed-in LinkedIn jobs switch (opt-in, a sign-in, a browser download). So for most people Find jobs reads 0 LinkedIn jobs, while the same search on linkedin.com logged out lists many. JobSpy reads that logged-out list with plain GETs.

## Owner's decisions (13 Nov 2026)
- On the JobSpy vs Jobadabra table: "let's implement this method. Start an opus session, announce session 96/sa".
- Asked via AskUserQuestion, "Where should the logged-out LinkedIn reads run?": "On each person's Mac (Recommended)": "Each Find jobs reads a few pages from the person's own internet address, with JobSpy's pace (3-7 s between pages) and a stop at the first 429 or check. Small volume per person, no proxies, nothing to pay, no account at risk."
- The 2 Nov "LinkedIn should know nothing" hold is lifted: "LInkedin approved already Data protability API.... Also, our repo i'll make them private in the future..." (relayed by the coordinator).
- "For now let's keep it Mac/Windows-only... But let's mention it somewhere in the app, in the Settings -> Automations that it is disabled for Always on" (relayed by the coordinator); then, asked via AskUserQuestion, "Both desktop-only (Recommended)": the signed-in read and the guest read run only in the desktop app, never in Always on. The cloud probe (`desktop/lib/linkedin-cloud-probe.js`) stays an experiment; the Always on LinkedIn step is parked.
- Then, asked via AskUserQuestion, "Try both, session with the spare account" (relayed by the coordinator, 13 Nov 2026), replacing "Both desktop-only" for Always on: the guest read gets an **Always on trial for the owner's install only** (gated like `api/ready-linkedin.js`), JobSpy pace, a few pages a day, stop at the first 429/999/check with no retry, from the Always on runner and NEVER from a Cloudflare Worker (its requests carry a CF-Worker header naming our domain); every answer is recorded so the owner decides on everyone after about a week. No session read in the cloud at all (owner, 13 Nov 2026: "lets' keep Linkedin and Google sessions/credentials windows/mac only"; the 1/6 probe is not run). Evidence: the benchmark's JobSpy round from GitHub's servers got 180 of at most 200 jobs (run 43357080026).

## Behaviour
1. A Find jobs press in the desktop app starts the **LinkedIn (public search)** lane at second 0, beside the other lanes (owner 10 Nov 2026: one lane per source), on the press's one deadline (`src/press/clock.py`).
2. The searches are the strategy's own words, the same list the signed-in read uses (`visits_portals.linkedin_searches()`, up to 3): one per role in the first place, or one role in each place.
3. Each search: GET `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=<role>&location=<place>&start=0,10,20`; page 1 of each search first, then page 2, at most 4 search pages a press (`SEARCH_PAGES`); a random 20-40 s gap before every request after the first (`GAP_S`, Decision 6); a page with fewer than 10 cards or no new card ends that search.
4. A card gives title, company, location, posted date and the job id; the job's address is `https://www.linkedin.com/jobs/view/<id>/` (the one canonical form, `job_alerts.canonical`), so a job the signed-in read, a job-alert e-mail or the guest read found is one job.
5. Titles and places are judged by the AI like every other source's (title triage, `feeds.wanted_location`); no keyword filter on cards.
6. Descriptions: only for jobs the title step kept, through the existing description fetcher (`src/sources/describe.py`), at the lane's pace and stop rule; at most 10 a press inside the search, the rest by the scoring queue after it.
   **One gap for the whole host** (sa, 13 Nov 2026): search pages and job pages are the same host and take turns in the same queue, never side by side; at most 6 requests in any 10 minutes on one computer, every press together (`WINDOW_MAX`, `WINDOW_S`, Decision 5): job pages get what the search pages leave, the rest waits in the describe queue for a later run. Every read checks the press deadline (`src/press/clock.py`) before it starts; what does not fit goes to the scoring queue, never a longer search (test: a slow stand-in host, the lane ends by the deadline).
7. The jobs are labelled "LinkedIn" (source) and go through the same dedup, scoring and digest as any source.
8. **Stop rule (one rule, shared with the signed-in read):** a 401/403/429/999, a sign-in or check page, or a page that is neither cards nor LinkedIn's empty end (`<!DOCTYPE html>\n\n<!---->`) ends LinkedIn (both reads) for that run, with no retry; a 429 or 999 also pauses LinkedIn for a day (the signed-in read's `pausedUntil`, `desktop/lib/linkedin-session.js`, one copy). The empty end is the normal end of a search, not a stop.
9. **One LinkedIn read a press:** when the signed-in switch is on and its session is usable, the signed-in read runs and the guest lane does not (no doubled requests from one address); otherwise the guest lane runs.
10. Recent activity and the Find jobs log say one line: `LinkedIn: 23 jobs from the public search`, `LinkedIn asked us to slow down: left alone until tomorrow`, `LinkedIn: could not be read this time`.
11. Settings → Automations (Always on) says, in about these words: Always on reads LinkedIn's public job search (trial); your LinkedIn and Google sign-ins are used only on your computer (UI: previewed light + dark, owner's yes before commit).

## Where it lives
- `src/sources/linkedin_guest.py` (new): search-page reader, card parser, stop verdicts, pace. Our own code, written from JobSpy's method (speedyapply/JobSpy, MIT); no JobSpy code copied, so no notice needed; the method is credited in the module's docstring.
- `src/sources/reader_rows.py`: one Row `LinkedIn` in a new engine lane `linkedin_guest` (clock name "LinkedIn"); gate `JOBADABRA_LINKEDIN_GUEST=1`.
- `desktop/lib/pipeline-env.js` + a small `desktop/lib/linkedin-guest-on.js`: the app sets the flag for its own runs when no signed-in read happens and LinkedIn is not paused; the engine's stop line comes back and the app writes the shared pause. CI, tests, the Night search, the pairs and Always on never set it (guard: `tests/guards/safety/test_linkedin_guest_desktop_only.py`, no workflow or cloud file sets the flag).
- `src/sources/describe.py`: a LinkedIn job page's description (`.show-more-less-html__markup`) at the lane's pace and stop rule.

## Safety
- Honest user agent: `ats.USER_AGENT` ("Jobadabra/0.1 …"), never a Chrome string from a plain reader (CLAUDE.md: never disguise). Proven to work on 13 Nov 2026. If LinkedIn ever refuses it, the lane stops; a disguise is a new owner decision.
- No cookie (a fresh `urllib` opener with no cookie jar), never the signed-in session, no proxy, no login, no check solved, no retry after a stop, never more than 9 search pages + 10 job pages a press.
- `host_pace.open` is not used: it retries a 429 up to 3 times; this lane's owner rule is no retry. The lane keeps its own, stricter gap (20-40 s, one request at a time, `PACE`); `host_pace.answer` judges a 429 / 503 + Retry-After and records it, so any other reader of linkedin.com sees the wider gap (Gitar on #3995: the spec said `turn` too, which the code does not use).
- CLAUDE.md Safety's LinkedIn paragraph gets one sentence for the guest read (owner's words above) in PR 1/4 (sa: the same PR as the reader).
- Tests and CI never reach linkedin.com: recorded fixtures only (cards page, empty end, blocked page, sign-in redirect, job page); a stand-in opener asserts no request leaves.

## Edge cases
| Case | What happens |
|---|---|
| Throttled: 429 / 999 | lane ends, LinkedIn paused a day, one activity line |
| Blocked: a page with no cards that is not the empty end | lane ends for the run, "could not be read" |
| Sign-in or check page (redirect to `/authwall`, `/checkpoint`, `/login`) | lane ends for the run, no retry |
| Empty end on page 1 | that search found nothing; next search |
| No network / timeout | that search fails; the lane goes on to the next one; all failed = "could not be read" |
| Country with few jobs | a short page ends the search early: fewer requests |
| Deadline reached mid-lane | "⏱ Time is up … for LinkedIn"; what was read is kept |
| No role words | no search, "LinkedIn: no search to read for your strategy" |

## Acceptance criteria
- A press on the Mac with the flag reads ≤ 4 search pages (page 1 of each search first), 20-40 s apart, ≤ 6 requests in any 10 minutes across presses, and lists LinkedIn jobs labelled "LinkedIn" (fixture test + one by-hand press).
- Each stop case above ends the lane after exactly one request to the stopping page (fixture tests, a stand-in opener counts requests).
- No request carries a Cookie header; the user agent is `ats.USER_AGENT` (test).
- No workflow, CI job or cloud file sets `JOBADABRA_LINKEDIN_GUEST` (guard).
- The signed-in switch on with a usable session: the guest lane does not run (app test).
- Measured: right jobs for one fictional person from the LinkedIn lane, before (flag off) and after (flag on), same minute, on this Mac.

## Measure
CI rounds (Night search, `search-pair.yml`) stay without LinkedIn: a GitHub address is not a person's Mac. The proof is one by-hand Mac search before (flag off) and one after (flag on), started in the same minute, for one fictional person the lane reaches (skill `check-job-search-locally`, the Claude plan, $0), counting right jobs and how many came from LinkedIn; plus one person it could hurt (a small-city search where LinkedIn adds time to the lane but few jobs).

## Non-goals
- Always on for everyone (the owner decides after the trial); the session read in the cloud.
- Proxies, more than 3 searches, filters (posted-within, remote, easy apply), salary parsing.
- Replacing the signed-in read.

## Decisions (owner, 13 Nov 2026, asked via AskUserQuestion; sketch https://claude.ai/artifact/QFBQ2En4j3UUpTL93bQ74o)
1. "Public for all, sign-in replaces (Recommended)": every Find jobs reads the public search; when the signed-in switch is on, the signed-in read runs instead.
2. "3 searches × 3 pages (Recommended)": up to 90 cards, about 1 minute.
3. "Only kept jobs, ≤10 (Recommended)": job pages only for jobs the AI kept, at most 10 inside the search; the rest by the scoring queue.
4. "Shared 1-day pause (Recommended)", option text: "Both LinkedIn reads pause a day. Consequence: a logged-out throttle would then switch off a person's signed-in LinkedIn for a day."
5. "≤6 in any 10 min (Recommended)" (asked with the measurement after sa's review: LinkedIn answered 429 to this Mac after ~11 guest requests in ~10 min, so 2.'s 9 search pages + 3.'s 10 job pages would reach it in one press): at most 6 requests in any 10 minutes per computer, counted across presses; search pages first (≤ 4), job pages with what is left. Unknown yet: whether job pages count against the same limit; they share the window until measured.
6. "20–40 s random (Recommended)" (after the coordinator relayed "pace pages as single requests, not bursts"): JobSpy's 3-7 s read 9 pages in 45 s; single requests spread over the press instead.
7. Always on (relayed by the coordinator): "Start at 30/day, raise on clean days": see Caps.
8. "Measure, then set the pause" (relayed by the coordinator, after JobSpy's README: "LinkedIn rate limits bursts of requests with a 429, which clears within about a minute", while this Mac's 429 still held 8 min later): one request at 1 h, 3 h and 6 h after the 429, stop at the first OK; the pause becomes the measured clear time doubled, 24 h the ceiling, a second 429 the same day always 24 h. Log under Caps.

## Caps (Always on; owner, 13 Nov 2026: "And let's leave only the linkedin public/guest search being Always on..." · "But with some limits/restrications/caps to avoid the IP blocking")
Approved (owner, 13 Nov 2026, asked via AskUserQuestion): the caps "Approve as written"; the shared cache "Yes, 6 h cache" (6 h for search pages, 24 h for job pages, Always on runs only).
Every Always on user shares the cloud runner's few addresses, so LinkedIn sees one heavy reader, not many people. Each cap has one owner, is a named constant with a Why line, and rises only with a measured reason. The guest read is the ONLY LinkedIn read in Always on; the signed-in read and Gmail/Calendar stay disabled rows ("credentials stay on device").

| Cap | Always on (shared addresses) | Mac/Windows (the person's own address) | Owner |
|---|---|---|---|
| One request at a time | across ALL users: one lease at the site, 20-40 s random gap after the last request began (`GAP_S`) | per process (`linkedin_guest.PACE`) | site lease (D1 row or Durable Object); the runner asks before each GET |
| Searches | ≤ 2 searches × 3 pages a person a day (`CLOUD_SEARCHES_A_DAY`, `PAGES`) | ≤ 4 search pages a press, page 1 of each of ≤ 3 searches first, each search ≤ once per 6 h (`SEARCH_PAGES`, `aggregators.SPACING_HOURS`) | site counter / engine |
| Job pages | ≤ 5 a person a day, kept jobs only (`CLOUD_JOB_PAGES_A_DAY`) | what the window leaves, kept jobs only; the rest waits for a later run | site counter / engine |
| All requests | starts at 30 a day for all users together, spread over the day (`CLOUD_REQUESTS_START`), raised step by step only after days with no block, each raise shown to the owner; 200 a day the ceiling (`CLOUD_REQUESTS_A_DAY`). Why (owner, 13 Nov 2026, asked via AskUserQuestion with the 429 measurement, relayed by the coordinator): "Start at 30/day, raise on clean days" | ≤ 6 in any 10 minutes per computer, every press together (`WINDOW_MAX`, `WINDOW_S`; Decision 5) | site counter / engine (`data/linkedin_guest.json`, request times only) |
| Shared cache | the same keywords + place + page within 6 h (`CACHE_HOURS`) is read once and served to every user who asks; a job page within 24 h | none (one person) | site cache |
| Stop | the first 429/999, sign-in wall, check page or unexpected page stops ALL guest reads for 24 h (`STOP_HOURS`), logged, shown in Admin; no retry, no proxy, ever | the run stops; a 429/999 pauses both LinkedIn reads a day on that computer | site stop row / app `pausedUntil` |

How a cloud read goes: the runner's engine (never a Cloudflare Worker: its requests carry a CF-Worker header naming our domain) asks the site for a turn with the run token. The site answers `cached` (the cards, no request), `wait <s>` (another user holds the lease), `go` (a lease for one GET) or `no` (a cap reached or the 24 h stop; the reason is said once in the run's log). After the GET the runner reports what LinkedIn answered (status, cards, ms) and the parsed cards; the site keeps them for `CACHE_HOURS` and writes one row per answer (the trial's evidence; an Admin chart of answers per day). The engine module is the Mac's; only `_get`'s turn comes from the site (`JOBADABRA_LINKEDIN_GUEST=cloud`, `JOBADABRA_LINKEDIN_GUEST_SITE`).
Numbers at the start: 30 requests a day ≈ 3 people at 2 × 3 search pages + 5 job pages (200 a day, the ceiling, ≈ 18), more as the cache serves shared searches. The benchmark round of 13 Nov 2026 (run 43357080026) read LinkedIn's guest search from GitHub's servers without a block (180 of at most 200 jobs); nothing is known yet about a day of steady reads from one address, which is what the trial measures.
The shared cache (approved) keeps LinkedIn's public job cards on our site for 6 h (the cards anyone sees logged out), served only to Always on runs, never to the index, the pack or the benchmark.
Tests (site PR first, then this repo): a fake LinkedIn that answers 429 after N requests: the global stop holds for every user, no request after it for 24 h; two users asking the same search within 6 h: the second gets the cache and LinkedIn sees one request; two runners at once never overlap and keep the gap; each daily cap ends at its number.
Rollout: the owner's install only (trial), then everyone, only after about a week of trial with no 429/999/wall and the owner's yes on the answers chart.

**429 clear time (Decision 8), this Mac, one logged-out request a slot, stop at the first OK:**
| When | Time (CET) | Answer |
|---|---|---|
| The 429 | 13 Nov 2026 ~16:47:40 | p10's first guest request, after 2 + 9 requests in the 10 min before |
| +1 h | 17:47:40 | (to measure) |
| +3 h | 19:47:40 | (to measure) |
| +6 h | 22:47:40 | (to measure) |
The pause after a 429 (`linkedin-guest-on.js`, today 1 day) becomes this clear time doubled, 24 h the ceiling; a second 429 the same day always 24 h.

## Plan (4 PRs)
1/4 `[lg] 1/4 Find jobs can read LinkedIn's public job search` — engine lane, parser, stop rules, row, describe route (≤ 10 job pages), CLAUDE.md sentence, fixtures, tests; off unless the flag (no user change yet; the measure runs with the flag by hand).
2/4 `[lg] 2/4 Every Find jobs reads LinkedIn's public job search` — the app sets the flag, one read a press, shared pause, activity lines, guard; the before/after Mac search.
3/4 `[lg] 3/4 Settings says where LinkedIn is read` — the Automations note (after the owner's yes on the preview); it is also the LinkedIn part of 6/6 "Always On says what it does not read" of spec 2026-11-11-always-on-parity-design.md (one change, ticked there).

4/4 `[lg] 4/4 Always on tries LinkedIn's public search for the owner` — site PR first (jobadabra-web: the owner-only gate in the run payload, the answers kept), then `src/hosted_run.py` sets the flag only when the payload says so; the Caps above (lease, daily caps, shared cache, 24 h stop) at the site; the answers chart the owner reads after a week.

## Follow-ups (not in these PRs)
- Done: the LinkedIn cloud probe code is removed (web #624, #3999); it never ran (0 batches in production).

## Progress
- [x] Positive control: one search page + one job page, logged out, honest user agent: 200, 10 cards, description present (13 Nov 2026) (proof: none: two by-hand requests from this Mac)
- [x] Owner's answers to the 4 decisions, all as recommended (13 Nov 2026) (proof: none: AskUserQuestion answers, quoted in Decisions)
- [x] PR 1/4 engine lane (#3995, merged 13 Nov 2026) (proof: tests/unit/sources/test_linkedin_guest.py)
- [ ] PR 2/4 app turns it on + shared stop + ≤ 6 requests in any 10 min, 20-40 s apart + measure (proof: tests/unit/sources/test_linkedin_guest.py window and round-robin tests)
- [ ] 429 clear time measured (1 h / 3 h / 6 h) and the pause set from it
- [ ] PR 3/4 Automations note
- [x] Caps numbers and the 6 h cache: owner's yes (13 Nov 2026) (proof: none: AskUserQuestion answers relayed by the coordinator, quoted in Caps)
- [ ] PR 4/4 Always on trial with the Caps, owner's install only (site PR first)
- [ ] Trial read after about a week: no 429/999/wall, then the owner's yes, then the Always on guest read for everyone
