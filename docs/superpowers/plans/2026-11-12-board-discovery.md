# Board discovery runs by itself

Owner, 12 Nov 2026: "start new sessions, developer new processes/workflows … that will make this a constant improvement". Asked via AskUserQuestion:
"Separate lab workflow (Recommended)", "Every 2 h (Recommended)", "Stay free for now (Recommended)". Sketch (private): https://claude.ai/artifact/LP8WvwnPBuGeSKcT2Yb53j

**Outcome:** board jobs in the test profiles' lists, before and after; the in-between number is the (country, role family) cells with a board of 3+ local jobs.

## The loop
- **Pick:** the cells with the fewest measured boards first (`src/scout_board_cells.py`); the lab's private priority cells first among equals.
- **Find, free first:** facts due again → Google sites already found → the AI's memory → (Codex's web search, if its trial finds boards) → Google's free plan.
- **Measure:** the board pass as today (3+ local jobs, families from titles; the honest headless browser for boards that refuse the rules).
- **Rest:** an empty cell waits 1, 2, 4, 8, then 30 days. **Refresh:** a fact older than 20 days is read again.
- **Runs:** jobadabra-lab `board-discovery.yml`, its own concurrency group, every 2 h from the Worker timer (jobadabra-web); publish through the existing board facts.

## Progress
- [x] 1/5 jobadabra: the cell picker, rest, refresh, family search (#3913) (proof: tests/unit/sources/test_scout_board_cells.py @914c4996)
- [x] 2/5 jobadabra-lab: `board-discovery.yml`; the boards job leaves `central-scout.yml`; the Scout restores the facts copy (lab #100; its AI token, lab #101) (proof: none: lab repo; its run 43286635648 answered 7 of 7 AI calls and kept a board)
- [x] 3/5 jobadabra: a board is searched in its country's language, one word per family in turn (`src/ai/board_words.py`). Owner, 12 Nov 2026, asked via AskUserQuestion: "Scout asks once per country (Recommended)". Replaces the country seed: the first nl and sk runs showed the AI already names the general portals; 9 of 12 boards read empty, and one gave 0 jobs for the English word and 5 for its own (#3919) (proof: tests/unit/sources/test_scout_board_cells.py @0b128c5)
- [ ] 4/5 jobadabra: a board the rules read as empty is read once more by the AI page reader, PAGE_CALLS a run on one pool (`src/scout_boards.py`). Owner, 12 Nov 2026, asked via AskUserQuestion: "AI reads once, recipe after (Recommended)": sk run 43292873441 read 0 of 5 boards with the right words, one page holding 40 ads
- [ ] 5/5 jobadabra: Codex's web search as a source, only if its trial run finds boards
- [ ] The search reads measured boards first (session sa's PR)
