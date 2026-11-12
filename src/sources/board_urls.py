"""How a job board's proposed search link is filled and trimmed (moved out of found_boards.py, 500-line rule; the link is structure, never a judgment).
Tests: tests/unit/sources/test_found_boards.py (found_boards._bare)."""
import urllib.parse


def _bare(url):
    """The proposed link with only the query parts that carry {role} or {place}, or None when it has nothing else: a filter the proposer added
    can empty every search (owner, 19 Oct 2026: Arbeitsagentur's "&branche=Medien" gave "Keine Ergebnisse" for Musiker in Berlin)."""
    parts = urllib.parse.urlsplit(url)
    pairs = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
    kept = [(key, value) for key, value in pairs if '{role}' in value or '{place}' in value]
    if len(kept) == len(pairs):
        return None
    return urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(kept, safe='{}')))
