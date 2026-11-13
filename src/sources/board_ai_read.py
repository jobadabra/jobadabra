"""A found job board's jobs in the shape every source has, and its first search page read by the AI page reader. Moved out of found_boards.py
(500-line rule) as a pure move; found_boards re-exports them. Tests: tests/unit/sources/test_found_boards.py, tests/unit/sources/test_found_boards_ai.py."""
from ..press import stage
from . import board_paths, careers


def _own_country(board):
    """The one country a general job board was proposed for, as the place of its jobs that name none (24 Oct 2026: the AI page reader read a Moldovan
    board's IT field as 8 jobs with no place, and every one failed the place check). A sector or remote board lists jobs from anywhere: no place."""
    countries = board.get('countries') or []
    return countries[0] if board.get('source_kind') == 'general' and len(countries) == 1 else ''


def _shaped(board, found):
    from .aggregators import _job
    return [_job(board['host'], job['id'] or job['url'], job['title'], job.get('employer') or f"via {board['name']}", job['location'] or _own_country(board), job['url'],
                 job.get('date_posted', ''), job.get('description', ''), job.get('remote'), job.get('salary', '')) for job in found]


def _read_by_ai(board, search, fetch):
    """The board's first search page read by the AI page reader (a recipe from an earlier answer first, src/sources/page_recipes.py), for a
    board whose page rules gave jobs but none relevant (owner, 19 Oct 2026: a music board's menu, "Berufe beginnend mit a: ... z:", was
    read as 30 jobs). [] with the reader off or no answer."""
    from .found_boards import _places, _terms
    if careers.READER is None:   # the page reader is off (tests, a user who keeps pages from the AI): nothing is fetched
        return []
    place = (_places(search) or [''])[0] if '{place}' in board['search_url'] else ''
    with stage.guard('found boards: AI page read') as caught:
        url, page = board_paths.read(fetch, board, _terms(search, 1)[0], place)   # in the board's own charset (board_paths.read)
    if caught:   # the page does not answer now: the other ways stand
        return []
    return _shaped(board, careers._asked(url, page, [], fetch)) if page and not careers._shell(page) else []
