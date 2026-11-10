"""The market count's national job boards: for one fictional candidate, the jobs the country's largest public, no-login board lists for the role in the city, read the way a person
reads them (the board's own search, page by page), as rows the blind judge reads (title, employer, place, link). Only fetching and reading here: no judging, no keeping, no ranking.
Why (owner, 10 Nov 2026, via sa: "summing all the jobs I found (that's what a normal person would do without Jobadabra)… should be the number what Jobadabra finds"; the six people EURES
has nothing for: asked via AskUserQuestion, "One public board each (Recommended)"): EURES lists 0 right jobs for Zagreb, Dublin, Lisbon, Budapest, Vienna and Copenhagen; sa's default extends it to every country of the 18 ([mc] 2/5: 16 of 18; Belgium and the
Netherlands "none (no board)": every public board refused or needs a browser, listed in market-boards.json `_refused` so no session tries them again).
Why data rows with each board's card shape, never code per site (sa, 10 Nov 2026, decision B): the referee must give the same number on the same page every run, so no AI reads the
page; a board is one row of market-boards.json (country, search address, the people it serves, where a job card's fields are), and a page whose cards are no longer where the row
says is "not counted: no cards", visible, never a guess. The product's own readers stay universal (src/sources): this file is the referee's, outside the pipeline.
Safety (CLAUDE.md, never relaxed): an honest user agent, one page at a time with a pause, no cookies, no login; a 401/403/429 ends that board for the run, never retried.
  python3 tools/persona-search/market_boards.py <persona n>     the board rows for one candidate, printed (a by-hand look; no AI)
Tests: tests/tooling/ci/test_market_boards.py."""
import html
import html.parser
import http.client
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
BOARDS = json.loads((HERE / 'market-boards.json').read_text(encoding='utf-8'))['boards']
USER_AGENT = 'jobadabra-reference'   # the same honest name as the EURES read (reference.py): never a browser's
CAP = 100        # rows per board per person, the EURES reference's cap (sa's design, 10 Nov 2026)
MAX_PAGES = 6    # pages per role word; a board shows 20-25 cards a page, so 100 rows fit in 5
PAUSE_S = 2.0    # between two pages of one board
REFUSED = (401, 403, 429)
CLOSES_P = frozenset('address article aside div dl fieldset footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p section table ul'.split())
VOID = frozenset('area base br col embed hr img input link meta source track wbr'.split())


class Node:
    """One element of a page: tag, attributes, children (elements and text, in order)."""
    __slots__ = ('tag', 'attrs', 'children', 'parent')

    def __init__(self, tag, attrs, parent):
        self.tag, self.attrs, self.children, self.parent = tag, attrs, [], parent

    def text(self):
        """All text under the element, spaces folded."""
        out, stack = [], [self]
        while stack:
            node = stack.pop()
            if isinstance(node, str):
                out.append(node)
            else:
                stack.extend(reversed(node.children))
        return ' '.join(' '.join(out).split())

    def walk(self):
        """Every element under this one, document order (not itself)."""
        stack = list(reversed([c for c in self.children if isinstance(c, Node)]))
        while stack:
            node = stack.pop()
            yield node
            stack.extend(reversed([c for c in node.children if isinstance(c, Node)]))


class _Tree(html.parser.HTMLParser):
    """A forgiving page tree: an end tag closes up to its open element; one with no open element is ignored; scripts and styles keep no text."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node('#root', {}, None)
        self.at = self.root

    def handle_starttag(self, tag, attrs):
        if tag in CLOSES_P:   # HTML's implied ends, as browsers apply them: a block closes an open paragraph (through inline elements, not past a table cell or button),
            node = self.at     # a list item closes the open item of its list (pages that leave them open: infoempleo's cards nested and borrowed the next card's employer)
            while node is not self.root and node.tag not in ('p', 'td', 'th', 'table', 'button'):
                node = node.parent
            if node.tag == 'p':
                self.at = node.parent
        if tag == 'li':
            node = self.at
            while node is not self.root and node.tag not in ('li', 'ul', 'ol'):
                node = node.parent
            if node.tag == 'li':
                self.at = node.parent
        node = Node(tag, {k: v or '' for k, v in attrs}, self.at)
        self.at.children.append(node)
        if tag not in VOID:
            self.at = node

    def handle_endtag(self, tag):
        node = self.at
        while node is not self.root and node.tag != tag:
            node = node.parent
        if node is not self.root:
            self.at = node.parent

    def handle_data(self, data):
        if self.at.tag not in ('script', 'style'):
            self.at.children.append(data)


def tree(markup):
    """The page as a Node tree."""
    parser = _Tree()
    parser.feed(markup)
    parser.close()
    return parser.root


def matches(node, sel):
    """Whether an element fits a selector: {tag?, class? (one class word), attr? {name: value, or "" for any value}, has? (a selector one of its elements fits)}."""
    if sel.get('tag') and node.tag != sel['tag']:
        return False
    if sel.get('class') and sel['class'] not in node.attrs.get('class', '').split():
        return False
    for name, value in (sel.get('attr') or {}).items():
        if name not in node.attrs or (value and node.attrs[name] != value):
            return False
    return not sel.get('has') or any(matches(inner, sel['has']) for inner in node.walk())


def _take(card, spec, base):
    """One field of a card: the element `in` names inside it (else the card; a list of selectors is a path; `index` picks the n-th), then its text or one attribute ("@href");
    links made absolute; a script link (javascript:) is no link."""
    found, chain = [card], spec.get('in') or []
    for step in chain if isinstance(chain, list) else [chain]:   # a list is a path: the first element fitting step 1, then inside it step 2 ...
        found = [n for n in (found[0].walk() if found else ()) if matches(n, step)]
    index = spec.get('index', 0)   # the n-th element that fits (from the end when negative): for cards whose fields share one class
    if not -len(found) <= index < len(found):
        return ''
    node = found[index]
    take = spec.get('take', 'text')
    value = node.text() if take == 'text' else html.unescape(node.attrs.get(take[1:], ''))
    value = ' '.join(value.split())
    if take == '@href':
        return urllib.parse.urljoin(base, value) if value and not value.lower().startswith('javascript:') else ''
    return value


def cards(markup, shape, base):
    """The job rows a page shows, by the board row's shape: {title, company, location, url} each; a card without a title is not a job."""
    if shape.get('state'):
        return _state_rows(markup, shape, base)
    rows = []
    for card in tree(markup).walk():
        if not matches(card, shape['card']) or (shape.get('skip') and matches(card, shape['skip'])):
            continue
        row = {field: _take(card, shape[field], base) if field in shape else '' for field in ('title', 'company', 'location', 'url')}
        if row['title']:
            rows.append(row)
    return rows


def _state_rows(markup, shape, base):
    """Rows from the JSON a page carries after a fixed marker (`state.after`), at a dotted path, each field a key of a record (dotted for nested keys)."""
    state = shape['state']
    at = markup.find(state['after'])
    if at < 0:
        return []
    try:
        node = json.JSONDecoder().raw_decode(markup[at + len(state['after']):].lstrip())[0]
        for part in state['path'].split('.'):
            node = node[int(part)] if isinstance(node, list) else node[part]
    except (ValueError, KeyError, IndexError, TypeError):
        return []

    def field(record, path):
        for part in path.split('.'):
            record = record.get(part) if isinstance(record, dict) else None
        return ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', str(record or ''))).split())
    rows = [{k: field(r, shape[k]) if k in shape else '' for k in ('title', 'company', 'location', 'url')} for r in node if isinstance(r, dict)] if isinstance(node, list) else []
    for row in rows:
        row['url'] = urllib.parse.urljoin(base, row['url']) if row['url'] else ''
    return [row for row in rows if row['title']]


def fetch(url, opener=urllib.request.urlopen):
    """-> (status, page text). A refusal or failure is its status (0 = no answer), never raised."""
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'en'})
    try:
        with opener(request, timeout=30) as response:
            raw = response.read()
            charset = getattr(getattr(response, 'headers', None), 'get_content_charset', lambda: None)()
            if not charset:
                meta = re.search(rb'<meta[^>]+charset=["\']?([\w-]+)', raw[:4000], re.I)
                charset = meta.group(1).decode() if meta else 'utf-8'
            return getattr(response, 'status', 200), raw.decode(charset, errors='replace')
    except urllib.error.HTTPError as error:
        return error.code, ''
    except (urllib.error.URLError, OSError, ValueError, LookupError, http.client.HTTPException):   # a connection cut mid-page (IncompleteRead) is no answer too (review of #mc 1/5)
        return 0, ''


def slug(text):
    """A role or place as a board's path part: lower case, any language's letters kept, other runs of characters as one dash."""
    return re.sub(r'[\W_]+', '-', text.lower()).strip('-')


def address(board, word, place, page):
    """The board's own search address for one role word, the person's place token and a page (0 = the first): `search`, or `next` for later pages when the board's
    later pages have another form (its own rel=next link: praca.pl's "_2.html")."""
    fill = {'role': urllib.parse.quote_plus(word), 'role_slug': urllib.parse.quote(slug(word)), 'place': urllib.parse.quote_plus(place), 'page': str(1 + page)}
    form = board.get('next') if page and board.get('next') else board['search']
    return re.sub(r'\{(\w+)\}', lambda m: fill[m.group(1)], form)


def board_for(n):
    """The board row serving persona n, or None (a country with no row yet)."""
    return next((b for b in BOARDS if str(n) in b['people']), None)


def read(n, words, fetch=fetch, sleep=time.sleep, cap=CAP):
    """-> {"source": "public_board", "board", "status", "rows"}: the first `cap` rows the board's own search lists for the role words in the person's place, in the board's order,
    one row per link (else per title + employer + place); a row's `note` (e.g. "first page only") goes with the result, so a short read is never shown as whole. Status: "counted"; "not counted: refused <code>" (that board ends for this run); "not counted: no answer"; "not counted: no cards"
    (page 1 of every word had none: the board changed its page, or listed nothing; never read as 0 jobs); "not counted: page answered <code>" (any page failed: a short read is
    no count); "none (no board)" for a country with no row."""
    board = board_for(n)
    if board is None:
        return {'source': 'public_board', 'board': None, 'status': 'none (no board)', 'rows': []}
    place, rows, seen, pages, carded = board['people'][str(n)], [], set(), 0, False
    for word in words:
        for page in range(board.get('max_pages', MAX_PAGES)):   # Why (review of [mc] 2/5): a row says it reads one page (an API's single answer, or a board whose later pages load by script)
            if len(rows) >= cap:
                break
            if pages:
                sleep(PAUSE_S)
            url = address(board, word, place, page)
            status, markup = fetch(url)
            pages += 1
            if status in REFUSED:
                return {'source': 'public_board', 'board': board['board'], 'status': f'not counted: refused {status}', 'rows': []}
            if status != 200:   # Why (review, 10 Nov 2026): a page that failed after others were read would leave a short count reading "counted"; the board is not counted, its code shown
                why = 'no answer' if not status else f'page answered {status}'
                return {'source': 'public_board', 'board': board['board'], 'status': f'not counted: {why}', 'rows': [], 'pages': pages}
            found, new = cards(markup, board['shape'], url), 0
            carded = carded or bool(found)
            for row in found:
                key = row['url'] or (row['title'].lower(), row['company'].lower(), row['location'].lower())
                if key in seen or len(rows) >= cap:
                    continue
                seen.add(key)
                rows.append(row)
                new += 1
            if not new:
                break
    status = 'counted' if carded else 'not counted: no cards'
    return {'source': 'public_board', 'board': board['board'], 'status': status, 'rows': rows if carded else [], 'pages': pages, **({'note': board['note']} if board.get('note') else {})}


if __name__ == '__main__':
    from gate import PERSONAS   # beside this file: the script's own folder is first on sys.path
    number = int(sys.argv[1])
    got = read(number, PERSONAS[number - 1]['reference']['words'])
    print(json.dumps({k: v for k, v in got.items() if k != 'rows'}), len(got['rows']), 'rows')
    for row in got['rows']:
        print(' |', row['title'][:60], '|', row['company'][:40], '|', row['location'][:40])
