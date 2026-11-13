# A search starts from the job boards measured to give right jobs for that role and country

Session bp (coordinator sa). Owner, 13 Nov 2026: "what can we do to bring these below target to meet the target?"; "Why ? Let's fix it."; "we know exactly: this board will give x jobs, this other board will give y jobs"; approved the plan "Yes, go on (Recommended)" with the sketch https://claude.ai/artifact/YPkXa1B2BDQg4WjDbrQLfx.

## Root cause
A Scout board fact kept the SET of role families seen once in a board's first 40 titles plus the count of ALL its local jobs (`src/scout_boards.py` kinds_of/measure, before PR 1). The site credited that count to every family of the set (jobadabra-web `api/employers.js` boardCells): airlinejobs.com/es = 178 jobs in 11 families, `measured`. The cell queue (`src/scout_board_cells.py` strength, TARGET 2) counted the same set, so two wrong boards closed (es, electrical_mechanical) and the Scout never looked for the boards that give Madrid electricians their jobs (Jobeka 19, Trabajo.org 16). `board_ideas.proven()` then trusted that set as proof.

## Design
States of a board for one (country, family), one owner each:
- **proven**: the Scout's AI put N >= 3 of the board's local jobs in that family. N is served as a number with its day. Owner: the Scout. Verdict that changes it: its next measure.
- **known**: seen, fewer than 3. Never read first.
- **unknown**: not measured (the number is absent, never 0). Only the per-search AI proposal fills the places proven boards leave.

A family is counted on a board only if the board was asked its own word (the search ran) or the board lists its jobs with no search. The count is over every job the pass read (200 titles, 50 a question). The engine orders proven boards by the number; the 3 only decides "may be read first". `rank_fit70` orders, never proves.

## Progress
- [ ] 1. jobadabra: the Scout counts jobs per family (`family_jobs`), the cell queue counts proven boards
- [ ] 2. jobadabra-web: validates and serves `right` + `day`; `measured` only at 3+ (site PR first)
- [ ] 3. jobadabra: `proven()` orders by `right`; the owner's scenario test; old Why lines updated
- [ ] 4. jobadabra: the Scout fills the pairs real searches ask first (priority derived with pool_tags)
- [ ] Proof: one c04 search a side after the fair-pair fix
