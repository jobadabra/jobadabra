# Always on: one card, two ways

Owner, 4 Nov 2026: "The user should choose between these 2 options. Either going with our servers, either going with his own, which is his Notion + his Github + his API AI Key." Then: "Notion should not be inside Github. They should be siblings. Both of them are needed." and "3 things: GitHub (explain for what), Notion (explain for what), API AI Key (explain for what), and all 3 need to be set up successfully for the entire solution to work and be fully activated. There should be a test button that will do a simple test of the e2e flow."

## Design
- **States (one owner each):** the card reads the running way from two settings: `hostedSearch.on` (our servers) and `cloud.repo` (the person's own GitHub repo). `renderer/always-on-choice-words.js` turns them into: off, on our servers, on your own accounts. The picked way is only a view; nothing turns off by itself.
- **Our servers** is not pickable and says "Not open yet" while the site answers 404 for Always on (`lib/hosted-search.js` `isOpen`, asked at most every 10 minutes; a bad connection never claims it). It opens by itself once the hosted runner is live.
- **Your own accounts** shows three sibling rows, each with what it is for and its own state: Notion (where every found job is saved), the API key (pays for the AI that reads and scores jobs; the person's own, never the Free AI key), GitHub (runs the search every day in the person's private repository, with the Mac off). A line counts "N of 3 set up".
- **Deep links** (`openSetting('cloud')`, `openSetting('hosted')`) pick the way first (`settings.js` `beforeOpen`).

## Progress
- [x] 1/3 The card, the two ways, the three sibling rows (#3131) (proof: desktop/test/unit/renderer/always-on-choice-words.test.js @9a02f9d)
- [x] 2/3 The checks in the engine: `python -m src selftest github|notion|ai`, a `test` job in the workflow, `test` in the template's modes (this PR) (proof: tests/unit/engine/test_connection_test.py)
- [x] 3/3 The Test button in the card (one row under the picked way; on our servers it says there is nothing to test until the hosted runner exists): starts the test run (cloudDispatch), reads each step's result (runJobs) and selftest.json, a tick per step, the failing step in words, ⌘K entry, light and dark preview first (owner, 4 Nov 2026: "Build as sketched", sketch CfrP3ieo3n6AMAY3cZT4VN) (proof: desktop/test/unit/main/always-on-test.test.js)
  - For the button (review of 2/3, 4 Nov 2026): a missing `jobadabra-selftest` artifact means the run failed before the checks (treat it as a failure); a second press cancels the first run (show it as cancelled); link to the `test` job, not the skipped `run` job (`runLink` may pick `jobs[0]` for a moment); the AI check with `max_tokens=8` on a thinking model has never run for real, so the first real press proves it.
- [ ] Not built: the Test button for our servers (needs the hosted runner; owner, 4 Nov 2026: "the test button should be both for easiest (our servers) and for Advanced"); only one way on at a time is enforced by the card's note, not by the buttons (a turn-on press while the other way runs should offer to turn that off)
