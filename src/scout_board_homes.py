"""Board discovery's job boards the AI names only by their home page: each is read through its own search form and kept only when measured.
Why (13 Nov 2026, sa): three live proposals named 8-9 boards a country and 4-6 of them came as a home page with no {role} in the link
(public employment services and national boards among them); src/ai/board_ideas.py valid drops those, so the pass measured 3-4 boards.
A link guessed from the first form of the page was wrong (try 1: a course search, a contact form), so a form link is kept only when it
gives MIN_LOCAL jobs in the country (the pass's own measure); else the page is read as the list it is, as a served board's page is.
Invariants: the home page is fetched once; one that answers a refusal (HTTP 401/403, a bot check) ends the board's plain read there, no
form link and no second request (the pass's browser step and its final list decide the rest, src/scout_boards.py run); at most
board_forms.MAX_TEMPLATES form links a board. Tests: tests/unit/sources/test_scout_board_homes.py."""
from .ai import board_ideas
from .sources import board_forms, board_yield, careers


def named(search, ideas=None, homes=None):
    """The boards to try by their home page for this search: `homes(search)` when given (tests), none beside given `ideas` (a fake proposal
    has no kept answer), else what the AI's proposal for this search named without a search link (board_ideas.homes)."""
    if homes is not None:
        return homes(search)
    return [] if ideas is not None else board_ideas.homes(search)


def _refusal(error):
    return getattr(error, 'code', None) in (401, 403) or type(error).__name__ == 'Refused'


def reader(read, local, enough, out=print):
    """`read` (found_boards.read_board's shape) with the home-page step for a board marked 'home'. local(jobs) -> the jobs in the pass's
    country; a form link giving `enough` of them becomes the board's link (board['search_url'], so the fact is kept with it). The mark is
    taken off at the first read: a later read of the same board (the AI page reader's) is the plain one."""
    def read_home(board, search, fetch, *rest):
        if not board.pop('home', False):
            return read(board, search, fetch, *rest)
        parts = board['search_url'].split('/', 3)
        address = f'{parts[0]}//{parts[2]}/'
        try:
            markup = str(fetch(address) or '')
        except Exception as error:  # noqa: BLE001 -- a home page that does not answer: the board's own page is read as it is
            careers.note_refusal(address, error)
            if _refusal(error):
                return [], board_yield.refused(error), None
            markup = ''
        for template in board_forms.home_templates(board, fetch, (address, markup)):
            jobs, state, route = read({**board, 'search_url': template}, search, fetch, *rest)
            if state == 'browser':
                return jobs, state, route
            if len(local(jobs)) >= enough:
                board['search_url'] = template
                out(f"Board pass: {board['host']} is read through its own search form")
                return jobs, state, route
        return read(board, search, fetch, *rest)
    return read_home
