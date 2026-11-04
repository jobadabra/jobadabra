# Always on: one card, two ways

Owner, 4 Nov 2026: "The user should choose between these 2 options. Either going with our servers, either going with his own, which is his Notion + his Github + his API AI Key." Then: "Notion should not be inside Github. They should be siblings. Both of them are needed." and "3 things: GitHub (explain for what), Notion (explain for what), API AI Key (explain for what), and all 3 need to be set up successfully for the entire solution to work and be fully activated. There should be a test button that will do a simple test of the e2e flow."

## Design
- **States (one owner each):** the card reads the running way from two settings: `hostedSearch.on` (our servers) and `cloud.repo` (the person's own GitHub repo). `renderer/always-on-choice-words.js` turns them into: off, on our servers, on your own accounts. The picked way is only a view; nothing turns off by itself.
- **Our servers** is not pickable and says "Not open yet" while the site answers 404 for Always on (`lib/hosted-search.js` `isOpen`, asked at most every 10 minutes; a bad connection never claims it). It opens by itself once the hosted runner is live.
- **Your own accounts** shows three sibling rows, each with what it is for and its own state: Notion (where every found job is saved), the API key (pays for the AI that reads and scores jobs; the person's own, never the Free AI key), GitHub (runs the search every day in the person's private repository, with the Mac off). A line counts "N of 3 set up".
- **Deep links** (`openSetting('cloud')`, `openSetting('hosted')`) pick the way first (`settings.js` `beforeOpen`).

## Progress
- [x] 1/2 The card, the two ways, the three sibling rows (this PR) (proof: desktop/test/unit/renderer/always-on-choice-words.test.js)
- [ ] 2/2 The Test button: Notion read, one tiny AI call on the person's own key, one test run of Always on in their repository, a tick per step (needs an engine test mode and a workflow update in users' repos)
- [ ] Not built: only one way on at a time is enforced by the card's note, not by the buttons (a turn-on press while the other way runs should offer to turn that off)
