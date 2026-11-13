"""A job board's search link filled for one search, in the forms a board may want (structure only: where the placeholder sits in the link,
never a judgment about the page). The plus form (`quote_plus`) is what every board was read with; a board whose search is a path
(`/jobs/{role}/{place}`) often wants a slug (`sales-representative`) and answers the plus form 404. The words are written in the board's own
charset when it is known (`charset`, learned by `read` from the page it declares), else in UTF-8.
Tests: tests/unit/sources/test_board_paths.py, tests/unit/sources/test_board_search_charset.py."""
import re
import unicodedata
import urllib.error
import urllib.parse

from . import page_bytes


def words(text, charset=None, plus=True, safe=''):
    """`text` percent-encoded in the board's charset; UTF-8 when none is known or the charset cannot write one of its letters."""
    quote = urllib.parse.quote_plus if plus else urllib.parse.quote
    try:
        return quote(text, safe=safe, encoding=charset or 'utf-8')
    except (UnicodeEncodeError, LookupError):
        return quote(text, safe=safe)


def _slug(text, charset=None):
    return words(re.sub(r'[\s_]+', '-', text.strip().lower()), charset, plus=False, safe='-')


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


def forms(url, term, place='', charset=None):
    """The links to ask for this board search, in order: the plus form first (a board that works today is read as before), then, only when
    {role} or {place} sits in the link's path, the same link with those as slugs, and last the slugs without accents. Never more than three, never a different host or path.
    charset: the board's own (a codec name, board['charset']); None or one that cannot write the words: UTF-8, as before."""
    # Why (13 Nov 2026): a board's own link may hold local letters (a Cyrillic path); only the word and the place were encoded, so the
    # read died on UnicodeEncodeError before asking the board, on every round.
    url = _ascii(url)
    plus = url.replace('{role}', words(term, charset)).replace('{place}', words(place, charset))
    head, sep, tail = url.partition('?')
    if '{role}' not in head and '{place}' not in head:
        return [plus]
    def filled(role, where):
        return head.replace('{role}', _slug(role, charset)).replace('{place}', _slug(where, charset)) + sep + tail.replace('{role}', words(term, charset)).replace('{place}', words(place, charset))
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


def read(fetch, board, term, place=''):
    """(link, page) of `board`'s search for these words: in the charset kept on the board, else in UTF-8 and, when the words hold letters outside
    ASCII and the page declares another charset, once more in that one, which is then kept on the board (board['charset']) for its next searches.
    Errors are raised as `get` raises them.
    Why (13 Nov 2026, sa; lab run 43432640838): a board declaring ISO-8859-1 matched the UTF-8 bytes of 'designer gráfico' to unrelated jobs;
    the same words in its own charset gave its graphic-design jobs."""
    charset = board.get('charset')
    link, page = get(fetch, forms(board['search_url'], term, place, charset))
    if charset or f'{term}{place}'.isascii():
        return link, page
    declared = page_bytes.charset_of(page)
    again = forms(board['search_url'], term, place, declared) if declared and declared != 'utf-8' else []
    if not again or link in again:
        return link, page
    board['charset'] = declared
    return get(fetch, again)
