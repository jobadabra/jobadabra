"""A job board read after its scripts ran (headless browser), the last way of found_boards._another_way. Moved out of found_boards.py (500-line
rule) as a pure move; found_boards re-exports it. Tests: tests/unit/sources/test_board_rendered.py, tests/unit/sources/test_board_render.py."""

from . import careers, read_budget


def _rendered(board, entry, proposed, page, search, fetch, show, judge):
    """(jobs, 'ok', relevant) from the board's search page, else its home page, read after its scripts ran (headless browser), for a board whose
    list is built by scripts although the page has text (owner, 24 Oct 2026: a Moldovan board's list page held 7 menu links, 36 jobs after the scripts);
    kept as the board's way (entry['rendered']). None with no browser, a refusal or no relevant job. The job pages themselves are read as usual."""
    from . import board_paths
    from .found_boards import _places, _shaped, _terms
    if show is None:
        return None
    terms, places = _terms(search, 1), _places(search)
    for url in dict.fromkeys([*board_paths.forms(proposed, terms[0] if terms else '', places[0], entry.get('charset')), page[0]]):   # the plus form, the slug form, the page read
        if read_budget.past_cut():   # the search's read cut: the next search reads it
            return None
        try:
            markup = show(url)
            found = careers.jsonld_jobs(markup, url) or careers.read_page_from(markup, url, fetch)
        except Exception as error:  # noqa: BLE001 — refused (401/403, a bot check), not allowed or no browser: the other answers stand
            careers.note_refusal(url, error)
            continue
        shaped = _shaped(board, found) if found else []
        relevant = judge(shaped) if shaped else []
        if relevant:
            entry['rendered'] = True
            print(f"Job boards found: {board['name']} read after its scripts ran", flush=True)
            return shaped, 'ok', relevant
    return None
