"""A job board's search link filled for one search, in the forms a board may want (structure only: where the placeholder sits in the link,
never a judgment about the page). The plus form (`quote_plus`) is what every board was read with; a board whose search is a path
(`/jobs/{role}/{place}`) often wants a slug (`sales-representative`) and answers the plus form 404. Tests: tests/unit/sources/test_board_paths.py."""
import re
import urllib.error
import urllib.parse


def _slug(text):
    return urllib.parse.quote(re.sub(r'[\s_]+', '-', text.strip().lower()), safe='-')


def forms(url, term, place=''):
    """The links to ask for this board search, in order: the plus form first (a board that works today is read as before), then, only when
    {role} or {place} sits in the link's path, the same link with those as slugs. Never more than two, never a different host or path."""
    plus = url.replace('{role}', urllib.parse.quote_plus(term)).replace('{place}', urllib.parse.quote_plus(place))
    head, sep, tail = url.partition('?')
    if '{role}' not in head and '{place}' not in head:
        return [plus]
    slug = head.replace('{role}', _slug(term)).replace('{place}', _slug(place))
    other = slug + sep + tail.replace('{role}', urllib.parse.quote_plus(term)).replace('{place}', urllib.parse.quote_plus(place))
    return [plus] if other == plus else [plus, other]


def get(fetch, links):
    """(link, page) of the first link that is not a 404; a 404 of the last link and any other error are raised as fetch raises them: a
    401/403/429 is never asked again in another form (that is a refusal, not a wrong link)."""
    for number, link in enumerate(links, 1):
        try:
            return link, fetch(link)
        except urllib.error.HTTPError as error:
            if error.code != 404 or number == len(links):
                raise
