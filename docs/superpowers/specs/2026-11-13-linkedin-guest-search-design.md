# LinkedIn's public job search on every Find jobs (the guest read)

> **Verdict:** each Find jobs in the Mac/Windows app also reads LinkedIn's public, logged-out job search (JobSpy's method): up to 3 searches × 3 pages, 3-7 s apart, from the person's own address, no cookie, no proxy, our own honest user agent; it stops for the run at the first 429/999/check/sign-in page and never retries. Proven by hand on 13 Nov 2026: our honest user agent got 200 and 10 cards; the job page has its description.

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
3. Each search: GET `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=<role>&location=<place>&start=0,10,20`; up to 3 pages (30 cards) a search; a random 3-7 s gap before every request after the first; a page with fewer than 10 cards or no new card ends that search.
4. A card gives title, company, location, posted date and the job id; the job's address is `https://www.linkedin.com/jobs/view/<id>/` (the one canonical form, `job_alerts.canonical`), so a job the signed-in read, a job-alert e-mail or the guest read found is one job.
5. Titles and places are judged by the AI like every other source's (title triage, `feeds.wanted_location`); no keyword filter on cards.
6. Descriptions: only for jobs the title step kept, through the existing description fetcher (`src/sources/describe.py`), at the lane's pace and stop rule; at most 10 a press inside the search, the rest by the scoring queue after it.
   **One gap for the whole host** (sa, 13 Nov 2026): search pages and job pages are the same host and take turns in the same 3-7 s queue, never side by side; worst case ~19 GETs ≈ 60-135 s. Every read checks the press deadline (`src/press/clock.py`) before it starts; what does not fit goes to the scoring queue, never a longer search (test: a slow stand-in host, the lane ends by the deadline).
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
- `host_pace.open` is not used: it retries a 429 up to 3 times; this lane's owner rule is no retry. The lane keeps its own, stricter gap (3-7 s, one request at a time, `PACE`); `host_pace.answer` judges a 429 / 503 + Retry-After and records it, so any other reader of linkedin.com sees the wider gap (Gitar on #3995: the spec said `turn` too, which the code does not use).
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
- A press on the Mac with the flag reads ≤ 9 search pages, 3-7 s apart, and lists LinkedIn jobs labelled "LinkedIn" (fixture test + one by-hand press).
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

## Plan (4 PRs)
1/4 `[lg] 1/4 Find jobs can read LinkedIn's public job search` — engine lane, parser, stop rules, row, describe route (≤ 10 job pages), CLAUDE.md sentence, fixtures, tests; off unless the flag (no user change yet; the measure runs with the flag by hand).
2/4 `[lg] 2/4 Every Find jobs reads LinkedIn's public job search` — the app sets the flag, one read a press, shared pause, activity lines, guard; the before/after Mac search.
3/4 `[lg] 3/4 Settings says where LinkedIn is read` — the Automations note (after the owner's yes on the preview); it is also the LinkedIn part of 6/6 "Always On says what it does not read" of spec 2026-11-11-always-on-parity-design.md (one change, ticked there).

4/4 `[lg] 4/4 Always on tries LinkedIn's public search for the owner` — site PR first (jobadabra-web: the owner-only gate in the run payload, the answers kept), then `src/hosted_run.py` sets the flag only when the payload says so; a daily cap of a few pages; the answers table the owner reads after a week.

## Follow-ups (not in these PRs)
- Remove the LinkedIn cloud probe code (`desktop/lib/linkedin-cloud-probe.js`, its IPC, web #547's route): it sends a session to the site, which the owner's 13 Nov rule ends; a separate small cleanup PR, proposed to the coordinator.

## Progress
- [x] Positive control: one search page + one job page, logged out, honest user agent: 200, 10 cards, description present (13 Nov 2026) (proof: none: two by-hand requests from this Mac)
- [x] Owner's answers to the 4 decisions, all as recommended (13 Nov 2026) (proof: none: AskUserQuestion answers, quoted in Decisions)
- [ ] PR 1/4 engine lane (proof: tests/unit/sources/test_linkedin_guest.py)
- [ ] PR 2/4 app turns it on + shared stop + measure
- [ ] PR 3/4 Automations note
- [ ] PR 4/4 Always on trial, owner's install only (site PR first)
