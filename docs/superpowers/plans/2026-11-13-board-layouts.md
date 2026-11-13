# Board layouts: board discovery learns a board's job cards once, every search reads them with no link questions

**Verdict:** a measured job board carries its layout (the `src/sources/page_recipes.py` shape) in its board fact; installs replay it before any AI
question about the page's links. Owner, 13 Nov 2026: "shouldn't the central scout and board discovery do that... spend those 60-90s ?"; who
publishes: the Scout, as today (owner, asked via AskUserQuestion by sa: "Scout publishes (Recommended)").

**Design:** one state, one owner. A board's layout is the `layout` on its discovery fact; board discovery writes it (derived from its own read, kept
only when a replay gives those jobs back); the Scout publishes it with the board facts; installs only replay it (`src/sources/board_layout.py`).
A replay that reads nothing on a page drops the layout for the rest of that read, says so in one line, and the page is read the usual way.

## Progress
- [x] 1/3 web: the pool keeps and serves a board's layout (jobadabra-web #620) (proof: none: merged in the private jobadabra-web as a3c50e9, its test/unit/api/employers.test.js)
- [x] 2/3 installs replay a served layout before any link question (#3982) (proof: tests/unit/sources/test_board_layouts.py @3c7c1c1)
- [x] 3/3 board discovery learns the layout and the Scout publishes it (proof: tests/unit/sources/test_scout_board_layouts.py)
- [ ] Depth (owner, 13 Nov 2026: "Yes, add depth (Recommended)"): a links layout may name 2 or 3 folders under its prefix
  - [x] 1/2 web: recipeOf keeps depth 2-3, serves depth 1 with no field (jobadabra-web #621) (proof: none: merged in the private jobadabra-web as 19ed998, its test/unit/api/employers.test.js)
  - [x] 2/2 the engine validates, replays and derives the depth; discovery learns it (proof: tests/unit/sources/test_page_recipes.py, tests/unit/sources/test_scout_board_layouts.py)
- [ ] Proof, each on the coordinator's word: one by-hand board discovery run, the Central Scout right after, one search pair on b08 + b10
  (link-kind calls and "job links" seconds before → after)
