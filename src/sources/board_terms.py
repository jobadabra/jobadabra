"""The words a found job board is searched with: the person's own board searches and, beside them, the AI-worked searches in the language the jobs of their places use.
Why (12 Nov 2026, ch, Zurich warehouse operator): a board was asked the person's English "warehouse operator" and listed 3 jobs in Zurich; the same site asked
"Lagerist" listed 10 and "Logistikmitarbeiter" 31. jobs.ch's reader already asks those words (boards.jobsch_terms); a found board never did, so every found board in a
non-English country was asked in English. The words are the AI's (boards.board_queries, kept once per set of roles and places: no second call for a person jobs.ch
already worked out), never a list here; the first-jobs slice (early) uses only the ones already kept, so it never waits for the AI.
Order: the person's first search, the first local word, their second, the second local word, ... so a board asked for two words (the slice) or five (the full read) gets
both languages. Tests: tests/unit/sources/test_board_terms.py."""


def merged(own, local, limit):
    """own and local searches interleaved, each once (case-insensitive), at most `limit`."""
    out, seen = [], set()
    for pair in zip(*[list(own) + [None] * (len(local) - len(own)), list(local) + [None] * (len(own) - len(local))]):
        for term in pair:
            if term and term.lower() not in seen:
                seen.add(term.lower())
                out.append(term)
    return out[:limit]


def terms(search, limit, early=False):
    """The searches a found board is asked: the person's own, then (full read) the AI's local-language ones beside them; own only when none are kept or the AI is off."""
    from ..notion.search_settings import terms as listed
    from . import boards
    own = listed(search.get('jobs_board_search_queries')) or listed(search.get('role_keywords'))
    local = boards.kept_queries(search) if early else boards.board_queries(search)
    return merged(own, local, limit)


def told(board, term=None):
    """Board discovery's notes (board['learn']) say which search words this read asked (term: one more, lowercase); no term: the jobs came as
    a list, not from any word. Moved from found_boards._told (500-line rule)."""
    notes = board.get('learn')
    if isinstance(notes, dict):
        if term is None:
            notes.pop('terms', None)
        elif term.lower() not in notes.setdefault('terms', []):   # once: the read that goes on after the slice asks its words again
            notes['terms'].append(term.lower())
