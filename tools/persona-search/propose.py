"""Asks, once, what a first search would ask the AI before it reads a job board: the boards proposed for the person's countries and field, and the board searches
in the places' own language. The pair's draft step runs it (run.mjs --propose) so both sides of a pair read the answers from the same data folder.
Why (13 Nov 2026, sa and bl: run 43487528056, c04): "Job boards proposed for <country>" was one AI call per side, so main's side read a board that gave 19 of its 26
right jobs and the PR's side never saw it; the same code differed by 5+ jobs. Run with the person's install env (JOBADABRA_DATA_DIR, CONFIG_DIR, the AI engine).
Why (13 Nov 2026, sa from bl's c04 run 43492940213): "Job boards: a web search found ..." was one more AI call per side: main found Gremio, the PR side five boards with
Jobeka (20 of 28 right jobs). The call is asked here once and kept as the install's saved answer (web_raw.json, the resume path of src/sources/web_answers.py): each
side takes it and judges the same named boards, no new search."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


def share_web_search(search):
    """Asks the web search for trade and local boards once and leaves its answer saved, not yet judged, so a side's run takes that answer instead of asking again
    (board_web.search takes web_answers.take unless web_used names it). Returns True when both sides will see the same web search: none was asked for this search,
    or its answer is saved; False when it returned without asking or without an answer (no AI that searches the web, a failed call), so each side would ask for itself."""
    from datetime import datetime, timezone

    from src.ai import board_ideas
    from src.sources import board_web, web_answers
    asked = board_ideas.asked_for(search)
    if not asked:
        return True
    key, places = asked[0], asked[4]
    with board_ideas.STORE:
        data = board_ideas.load()
    known = [{'name': entry.get('name') or host, 'host': host} for host, entry in (data.get('boards') or {}).items()]
    board_web.search(search, known)
    saved = web_answers.take(web_answers.name(key, places), datetime.now(timezone.utc), None) is not None   # Gitar, #4030: a 0 from "not asked" and from "no boards named" looked alike
    with board_ideas.STORE:   # judged here only to name them; each side judges the saved answer itself, so its web ideas and stamp are taken back
        data = board_ideas.load()
        (data.get('web_used') or {}).pop(key, None)
        if key in (data.get('ideas') or {}):
            data['ideas'][key] = [board for board in data['ideas'][key] if board.get('origin') != 'web']
        board_ideas.save(data)
    return saved


def main():
    """Fills the install's board proposal cache (found_boards.json ideas/homes) and board_queries.json; prints what it kept."""
    from src.ai import board_ideas
    from src.paths import DATA, load_search_config
    from src.sources import boards
    search = load_search_config()
    proposed = board_ideas.ideas(search)
    queries = boards.board_queries(search)
    shared = share_web_search(search)
    print(f'Proposed once for both sides: {len(proposed)} board(s), {len(queries)} board search(es); web search for boards: '
          f"{'asked once' if shared else 'NOT shared, each side asks for itself'}")
    if shared:   # the pair reads this marker (search-pair.yml): none, and the table says the boards are not shared
        (DATA / 'web-shared.ok').write_text('')


if __name__ == '__main__':
    main()
