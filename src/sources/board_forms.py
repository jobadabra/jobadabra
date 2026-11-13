"""A job board's own search link, read from the search form on its home page (structure only: a form sent by GET with a text box, on the
board's own site, no password box; the Scout's pass also no e-mail, phone or file box), for a board whose proposed link gave no relevant job (owner, 18 Oct 2026: 14 of 32 boards proposed
for six candidates gave nothing or ignored the search words, e.g. warehouse jobs for "financial analyst" in Amsterdam). The first text
box takes the role, a second the place; hidden fields keep their values. found_boards.read tries it once per proposed link and keeps it
when it brings relevant jobs; with none, the job list the board declares itself (found_boards._another_way). Tests: tests/unit/ai/test_board_forms.py."""
import urllib.parse
from html.parser import HTMLParser

from .careers_parse import registrable
from ..press import stage

TEXT_BOXES = ('', 'text', 'search')   # an <input> a person types words into
PERSONAL = ('email', 'tel', 'file')   # a box for the person's own details: a form with one is a subscription or an application, never a search
MAX_TEMPLATES = 2                     # forms tried per board: the home page's search box is among the first
TOKEN = 24                            # a POST form's hidden value longer than this is a token (an anti-forgery one runs to 100+), never put in a kept link;
                                      # a short constant (lang=de, a search kind) stays, as the board's own form sends it (Gitar, #3917)


class _Forms(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.forms, self.open = [], None

    def handle_starttag(self, tag, attrs):
        attrs = {key: value or '' for key, value in attrs}
        if tag == 'form':
            self.open = {'action': attrs.get('action', ''), 'method': attrs.get('method', 'get').lower(), 'boxes': [], 'hidden': [], 'password': False, 'personal': False}
            self.forms.append(self.open)
        elif tag == 'input' and self.open is not None:
            kind = attrs.get('type', '').lower()
            if kind == 'password':
                self.open['password'] = True
            elif kind in PERSONAL:
                self.open['personal'] = True
            elif kind == 'hidden' and attrs.get('name'):
                self.open['hidden'].append((attrs['name'], attrs.get('value', '')))
            elif kind in TEXT_BOXES and attrs.get('name'):
                self.open['boxes'].append(attrs['name'])

    def handle_endtag(self, tag):
        if tag == 'form':
            self.open = None


def templates(markup, page_url, posted_at=None, search_only=False):
    """The search links the page's own forms make, with {role} (and {place} for a second text box), forms with two boxes first.
    posted_at: a form sent by POST counts too, its field names asked as a GET link at this address (the board's own search page), not at its action, which answers a POST only.
    search_only (the Scout's board pass only; Find jobs in the app is unchanged: Gitar on #4042, no live pair): a form with an e-mail, phone or file box is left out.
    Why (13 Nov 2026, bp, owner via sa: the Scout never opens a subscribe or alert form): such a form is a job alert or an application (rabota.md's home page holds a subscribe
    form with position, name and e-mail boxes sent without a method, and two apply forms), so the Scout never makes a search link of it, whatever its text boxes are called.
    Why (12 Nov 2026, ch): JobScout24's search form is a POST (SearchWhat, anti-forgery token) and its list page answers ?SearchWhat=<words> with the filtered list,
    while the guessed ?keywords= was ignored (the unfiltered 84,421 jobs, 0 right). The link stays only when it brings relevant jobs (found_boards._another_way)."""
    parser = _Forms()
    with stage.guard('job boards: form parse') as caught:
        parser.feed(str(markup or ''))
    if caught:   # a page the parser cannot read gives no form
        return []
    home = urllib.parse.urlsplit(page_url).hostname or ''
    out = []
    for found in sorted(parser.forms, key=lambda f: -min(len(f['boxes']), 2)):
        if (found['method'] != 'get' and not posted_at) or found['password'] or (search_only and found['personal']) or not found['boxes']:
            continue
        action = urllib.parse.urljoin(page_url, found['action'] or page_url)
        parts = urllib.parse.urlsplit(action)
        if parts.scheme not in ('http', 'https') or registrable(parts.hostname or '') != registrable(home):
            continue
        hidden = found['hidden']
        if found['method'] != 'get':   # sent to the board's own site, asked at its search page; Why (12 Nov 2026, ch): a POST form's long hidden values (a token) never go into a link that is kept and shared
            parts, hidden = urllib.parse.urlsplit(posted_at.split('?')[0]), [(name, value) for name, value in hidden if len(value) <= TOKEN]
        fields = [*(f'{urllib.parse.quote_plus(name)}={urllib.parse.quote_plus(value)}' for name, value in hidden),
                  f'{urllib.parse.quote_plus(found["boxes"][0])}={{role}}',
                  *([f'{urllib.parse.quote_plus(found["boxes"][1])}={{place}}'] if len(found['boxes']) > 1 else [])]
        url = urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path or '/', '&'.join([*([parts.query] if parts.query else []), *fields]), ''))
        if url not in out:
            out.append(url)
    return out[:MAX_TEMPLATES]


def home(board, fetch):
    """(address, markup) of the board's home page; markup '' when it does not answer."""
    parts = urllib.parse.urlsplit(board['search_url'])
    address = f'{parts.scheme}://{parts.netloc}/'
    with stage.guard('job boards: home page'):
        return address, str(fetch(address) or '')
    return address, ''   # a home page that does not answer: the proposed link stays


def home_templates(board, fetch, page=None, search_only=False):
    """The search links the board's home page forms make (page: home()'s answer, fetched once; search_only: see templates)."""
    address, markup = page or home(board, fetch)
    found = templates(markup, address, board['search_url'], search_only) if markup else []
    return [url for url in found if url != board['search_url']]
