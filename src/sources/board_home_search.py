"""A board the AI named with no search link is read through its home page's own plain GET search, or not at all (owner, 14 Nov 2026: "yes", on sa's row "Board named without a
link, never read"; measured by hand on the 14 Nov baseline: Sofia +12-15 right jobs on 4 named boards, Amsterdam +5, Ljubljana 0).
The home page is fetched once with the plain reader; the form is found by structure only (board_forms.templates(plain=True): a GET form, text boxes, nothing personal, no message
box, no bot check, on the board's own site), the words go in the charset the page declares, and the result list is read through the board read path like any board's.
Never: a POST, a form that is not a plain search, a browser (show=None), a click or typing, the home page as a list, a retry of a 401/403, an AI call to find the form.
Invariants: read() always answers (it never falls back to reading the home page as a list); the ladder (found_boards._another_way: bare link, AI page reader, any home form, section,
routes) never runs for a named board, so no form that is not a plain search is ever tried. Tests: tests/unit/sources/test_board_home_search.py."""
import time
import urllib.error

from . import board_forms, board_yield, careers, host_pace, page_bytes, read_budget


def wanted(board):
    """True for a board the AI named with no search link (marked 'home' by board_ideas._homes) whose link still has no {role}; once a search worked its link has one and the board reads as any other."""
    return bool(board.get('home')) and '{role}' not in board['search_url']


def _say(board, started, what):
    print(f"Job boards: {board['name']} named without a search link: {what} ({time.monotonic() - started:.0f} s)", flush=True)


def read(board, entry, proposed, search, fetch, judge, show, early, read_board):
    """(jobs, state, None) of the named board asked through its own plain GET search; ([], state, None) with one line saying why when it has none or refused. Never None."""
    from . import found_boards
    entry['form_for'], entry['ladder'] = proposed, found_boards.LADDER   # Why (14 Nov 2026, owner "yes" via sa): never the ladder: its home-form step also sends POST forms and its other ways ask the AI
    started = time.monotonic()
    if read_budget.past_cut():
        return [], 'empty', None
    address = f"https://{board['host']}/"
    try:
        markup = str(fetch(address) or '')
    except urllib.error.HTTPError as error:   # a 401/403 is final for this board: never asked again in another form
        careers.note_refusal(address, error)
        _say(board, started, f'its home page refused (HTTP {error.code}), not asked again' if error.code in host_pace.REFUSED else f'its home page answered HTTP {error.code}, not read')
        return [], board_yield.refused(error) if error.code in host_pace.REFUSED else 'empty', None
    except (urllib.error.URLError, OSError, ValueError) as error:
        if type(error).__name__ == 'Refused':
            _say(board, started, 'its home page refused the reader, not asked again')
            return [], board_yield.refused(error), None
        _say(board, started, 'its home page did not answer, not read')
        return [], 'empty', None
    templates = board_forms.templates(markup, address, None, True, True) if markup else []
    if not templates:
        _say(board, started, 'no plain GET search on its home page, not read')
        return [], 'empty', None
    declared = page_bytes.charset_of(markup)
    if declared and declared != 'utf-8':
        board['charset'] = declared   # the board's own words go in it (board_paths.read); kept per board by found_boards
    best = None   # (jobs, state, template, relevant) of the form that listed the most when none gave a relevant job
    for template in templates:   # Why (14 Nov 2026, run on Sofia's named boards): a home page's first form can be another search (a courses search before the jobs one): the next form is asked while none gave a relevant job
        if read_budget.past_cut():
            break
        jobs, state, _ = read_board({**board, 'search_url': template}, search, fetch, None, early=early, show=None)
        if state == 'browser':   # refused or script-only: the next form, never the browser here
            continue
        relevant = judge(jobs) if jobs else []
        entry['forms_tried'] = proposed
        if relevant:
            entry['form_url'], entry['form_for'] = template, proposed   # read first next time, as any board's own search form
            best = (jobs, state, template, relevant)
            break
        if best is None or len(jobs) > len(best[0]):
            best = (jobs, state, template, relevant)
    if best:
        _say(board, started, f'found its own search ({best[2]}), {len(best[0])} job(s) read, {len(best[3])} relevant')
        return best[0], best[1], None
    _say(board, started, 'its own search was refused or needs scripts, not read')
    return [], 'empty', None
