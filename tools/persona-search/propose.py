"""Asks, once, what a first search would ask the AI before it reads a job board: the boards proposed for the person's countries and field, and the board searches
in the places' own language. The pair's draft step runs it (run.mjs --propose) so both sides of a pair read the answers from the same data folder.
Why (13 Nov 2026, sa and bl: run 43487528056, c04): "Job boards proposed for <country>" was one AI call per side, so main's side read a board that gave 19 of its 26
right jobs and the PR's side never saw it; the same code differed by 5+ jobs. Run with the person's install env (JOBADABRA_DATA_DIR, CONFIG_DIR, the AI engine)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


def main():
    """Fills the install's board proposal cache (found_boards.json ideas/homes) and board_queries.json; prints what it kept."""
    from src.ai import board_ideas
    from src.paths import load_search_config
    from src.sources import boards
    search = load_search_config()
    proposed = board_ideas.ideas(search)
    queries = boards.board_queries(search)
    print(f'Proposed once for both sides: {len(proposed)} board(s), {len(queries)} board search(es)')


if __name__ == '__main__':
    main()
