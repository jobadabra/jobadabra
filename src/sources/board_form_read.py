"""Reading a job board through the search links its own forms make (src/sources/board_forms.py), the one loop of both ways that try them: a board whose proposed link gave no
relevant job (found_boards._another_way) and one whose list gave only a few (found_boards._fuller_section). Moved out of found_boards.py (500-line rule).
Why (12 Nov 2026, ch): JobScout24 ignored the guessed ?q= and listed the unfiltered 84,421 jobs; a few of them were relevant by chance (2), so only its section was tried, never
its form, whose field name (SearchWhat) gives the filtered list. A form link is kept only when it gives MORE relevant jobs than the list it replaces (`beat`).
Tests: tests/unit/ai/test_board_forms.py."""
from ..press import stage

CUT = object()   # the read cut came: no further link is asked


def through_forms(board, entry, search, fetch, judge, show, read, templates, beat, refused, cut):
    """(jobs, state, relevant) of the first form link giving more than `beat` relevant jobs, kept as the board's link in `entry` (the pool share sends it, src/contribute.py);
    CUT when the search's read cut came first (`cut()`); None when no link did. `read` is found_boards.read_board; a link that fails is skipped; `refused` collects those that
    answered with a refusal (state 'browser')."""
    for template in templates:
        if cut():
            return CUT
        with stage.guard('found boards: form link') as caught:
            again, state, _ = read({**board, 'search_url': template}, search, fetch, None, show=show)
        if caught:   # a form link that fails: the next one, or the proposed link's result
            continue
        relevant = judge(again) if again else []
        if state == 'browser':
            refused.append(template)
        if len(relevant) > beat:
            entry['form_url'] = entry['search_url'] = template
            print(f"Job boards found: {board['name']} read through its own search form", flush=True)
            return again, state, relevant
    return None
