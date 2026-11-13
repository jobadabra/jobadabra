"""A general job board whose link has no search word is searched through its own home-page search form first, never read as its general list when it has a search.
Why (13 Nov 2026, owner via sa, run 43473395249): kariera.si, itjobs.pt, colegios.es, airlinejobs.com were read one round as their list, 0-1 right jobs of 20-40.
A search that answered stands, even with 0 jobs; only no form, or a refused or failed one, reads the list. The link is kept per install (form_url), never as the shared
search_url; a sector board's category page is untouched. Tests: tests/unit/sources/test_board_search_first.py."""
import time

from . import board_forms, read_budget
from ..press import stage


def wanted(board, entry, proposed):
    """True for a general board whose link has no {role}, with no declared job list kept (its route is read first), not already found to have no search for this link."""
    return '{role}' not in board['search_url'] and (board.get('source_kind') or 'general') == 'general' and not entry.get('route') and entry.get('general_for') != proposed


def read(board, entry, proposed, search, fetch, judge, show, early, read_board):
    """(jobs, state, None) of the board asked through its own search form, or None when the list is to be read as before (no form, a refusal or a failure, the
    read cut). Says in one line what it did and the seconds it took (home page and form links; the form's rounds), so a slice's time is read from the log."""
    if not wanted(board, entry, proposed) or read_budget.past_cut():
        return None
    started = time.monotonic()
    page = board_forms.home(board, fetch)
    if not page[1]: 
        return None
    templates = board_forms.home_templates(board, fetch, page)
    if not templates:
        entry['general_for'] = proposed
        print(f"Job boards: {board['name']} general list, no search found ({time.monotonic() - started:.0f} s)", flush=True)
        return None
    looked = time.monotonic() - started
    for template in templates:
        if read_budget.past_cut():
            return None
        asked = time.monotonic()
        with stage.guard('found boards: own search') as caught:
            jobs, state, _ = read_board({**board, 'search_url': template}, search, fetch, None, early=early, show=show)
        if caught or state == 'browser':   # a form that failed or refused: the next one, else the list
            continue
        relevant = judge(jobs) if jobs else []
        entry['forms_tried'] = proposed   # the ladder (found_boards._another_way) skips these forms
        if relevant:
            entry['form_url'], entry['form_for'] = template, proposed   # read first next time
        print(f"Job boards: {board['name']} searched through its own search form: {len(jobs)} job(s), {len(relevant)} relevant"
              f"{'' if jobs else '; its general list is not read for it'} (home page and form links {looked:.0f} s, form rounds {time.monotonic() - asked:.0f} s)", flush=True)
        return jobs, state, None
    return None
