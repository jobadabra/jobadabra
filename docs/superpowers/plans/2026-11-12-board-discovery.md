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
- [ ] 1/3 jobadabra: the cell picker, rest, refresh, family search
- [ ] 2/3 jobadabra-lab: `board-discovery.yml`; the boards job leaves `central-scout.yml`; the Scout restores the facts copy
- [ ] 3/3 jobadabra: Codex's web search as a source, only if its trial run finds boards
- [ ] The search reads measured boards first (session sa's PR)
