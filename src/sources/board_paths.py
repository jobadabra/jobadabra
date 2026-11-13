"""A job board's search link filled for one search, in the forms a board may want (structure only: where the placeholder sits in the link,
never a judgment about the page). The plus form (`quote_plus`) is what every board was read with; a board whose search is a path
(`/jobs/{role}/{place}`) often wants a slug (`sales-representative`) and answers the plus form 404. Tests: tests/unit/sources/test_board_paths.py."""
import re
import unicodedata
import urllib.error
import urllib.parse


def _slug(text):
    return urllib.parse.quote(re.sub(r'[\s_]+', '-', text.strip().lower()), safe='-')


def _ascii(url):
    """The same link with its own letters outside ASCII percent-encoded (UTF-8), and such a host in its IDNA form; an ASCII link is unchanged.
    Invariant: placeholders, `%xx` already in the link and every ASCII character stay as they are."""
    scheme, sep, rest = url.partition('://')
    host, slash, tail = rest.partition('/')
    if sep and not host.isascii():
        try:
            host = host.encode('idna').decode('ascii')
        except UnicodeError:
            pass   # left as it is: the read fails as before and says so
    return scheme + sep + host + slash + re.sub(r'[^\x00-\x7f]+', lambda found: urllib.parse.quote(found.group()), tail)


def _plain(text):
    """The text without its accents (é to e); letters with no accent form (Cyrillic, ł) stay as they are."""
    return ''.join(letter for letter in unicodedata.normalize('NFKD', text) if not unicodedata.combining(letter))


def forms(url, term, place=''):
    """The links to ask for this board search, in order: the plus form first (a board that works today is read as before), then, only when
    {role} or {place} sits in the link's path, the same link with those as slugs, and last the slugs without accents. Never more than three, never a different host or path."""
    # Why (13 Nov 2026): a board's own link may hold local letters (a Cyrillic path); only the word and the place were encoded, so the
    # read died on UnicodeEncodeError before asking the board, on every round.
    url = _ascii(url)
    plus = url.replace('{role}', urllib.parse.quote_plus(term)).replace('{place}', urllib.parse.quote_plus(place))
    head, sep, tail = url.partition('?')
    if '{role}' not in head and '{place}' not in head:
        return [plus]
    def filled(role, where):
        return head.replace('{role}', _slug(role)).replace('{place}', _slug(where)) + sep + tail.replace('{role}', urllib.parse.quote_plus(term)).replace('{place}', urllib.parse.quote_plus(place))
    # Why (13 Nov 2026, a chef in Krakow): a path-style board answered 404 to the place with its accent and had the jobs under the plain
    # letters; the plain form is asked last, and only when a word in the path carries an accent.
    return list(dict.fromkeys([plus, filled(term, place), filled(_plain(term), _plain(place))]))


def get(fetch, links):
    """(link, page) of the first link that is not a 404; a 404 of the last link and any other error are raised as fetch raises them: a
    401/403/429 is never asked again in another form (that is a refusal, not a wrong link)."""
    for number, link in enumerate(links, 1):
        try:
            return link, fetch(link)
        except urllib.error.HTTPError as error:
            if error.code != 404 or number == len(links):
                raise
