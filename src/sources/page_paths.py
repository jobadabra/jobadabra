"""A page's job links found by the path of tags and classes above them (page_recipes kind 'path'): the link and its 1-4 nearest ancestors, each a tag and one class.
Why (13 Nov 2026, sa for the owner's approved fix #1 design; ot measured open-source readers on the 58 saved pages): AutoScraper's rule shape (the chain of tags and
classes above a job link, learned from the AI's own job list, no AI call) read 26 of 30 boards against 23 for links/cards; adopting no tool, only this idea, in a stdlib
parser with a fixed shape the site validates. No ids, no data-* attributes, no href text in the shape; a path that matches more links than the recipe's `max` reads nothing.
Tests: tests/unit/sources/test_page_paths.py."""
import html
import functools
import re
import urllib.parse
from html.parser import HTMLParser

PATH_TAGS = ('a', 'div', 'ul', 'ol', 'li', 'article', 'section', 'main', 'span', 'p', 'td', 'tr', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6')
MAX_CHAIN = 5   # the link and its 4 nearest ancestors
# Why (13 Nov 2026, sa: "how often 3x refuses a correct read"; "a page of 50 or 100 real job links is common"): 3x the learned jobs refused 10 of 103 correct cross-page reads on the 58
# saved pages (a recipe learned on 3-4 jobs, a page of 18-20), and a fixed floor is fitted to pages that never list more than 25. Past 3x the matches must be one URL shape (SAME_SHAPE
# of them share the first path segment and segment count): a page of 100 real jobs does, a path that grabs menus, footers and jobs does not.
SAME_SHAPE = 0.8
VOID = frozenset('area base br col embed hr img input link meta param source track wbr'.split())
HEADINGS = ('h1', 'h2', 'h3', 'h4', 'h5', 'h6')
# Why (Gitar on #4055): HTML lets these end without an end tag; the next one of the same tag, inside the same container, closes the open one, so a link never gets the previous item's tags as ancestors.
IMPLIED_END = {'li': ('ul', 'ol'), 'dt': ('dl',), 'dd': ('dl',), 'tr': ('table',), 'td': ('tr', 'table'), 'p': ('div', 'section', 'article', 'main', 'li', 'td')}
CLASS = re.compile(r'[\w-]{1,40}')


class Anchor:
    """One link of the page: its address, its own texts (link text, label, first heading of each kind) and the (tag, classes) of itself and its ancestors, nearest first."""
    __slots__ = ('href', 'chain', 'text', 'label', 'headings')

    def __init__(self, href, chain, label):
        self.href, self.chain, self.label, self.text, self.headings = href, chain, label, [], {}


class _Tree(HTMLParser):
    def __init__(self, base):
        super().__init__(convert_charrefs=True)
        self.base, self.stack, self.anchors, self.open, self.heading = base, [], [], None, None   # open: the Anchor being read; heading: the tag of the heading being read inside it

    def _pop(self, until):
        """Pop the stack through the element at index `until`, finishing the open link when it goes with it."""
        while len(self.stack) > until:
            if self.stack.pop()[0] == 'a' and self.open is not None:   # an `a` that never ended: its text so far is its own
                self.anchors.append(self.open)
                self.open = self.heading = None

    def handle_starttag(self, tag, attrs):
        attrs = {name: value or '' for name, value in attrs}
        classes = tuple(c for c in (attrs.get('class') or '').split() if CLASS.fullmatch(c))
        if tag in VOID:
            return
        if tag in IMPLIED_END:
            for index in range(len(self.stack) - 1, -1, -1):
                if self.stack[index][0] in IMPLIED_END[tag]:
                    break
                if self.stack[index][0] == tag:
                    self._pop(index)
                    break
        self.stack.append((tag, classes))
        if tag == 'a' and attrs.get('href') and not attrs['href'].startswith('#') and self.open is None:
            label = attrs.get('aria-label') or attrs.get('title') or ''
            self.open = Anchor(urllib.parse.urljoin(self.base, attrs['href']), tuple(reversed(self.stack[-MAX_CHAIN:])), label)
        elif self.open is not None and tag in HEADINGS and self.heading is None and tag not in self.open.headings:
            self.heading, self.open.headings[tag] = tag, []

    def handle_endtag(self, tag):
        names = [name for name, _ in self.stack]
        if tag in VOID or tag not in names:
            return
        self._pop(len(names) - 1 - names[::-1].index(tag))   # the nearest open element of that name, and what was left open inside it
        if self.heading == tag:
            self.heading = None

    def handle_data(self, data):
        if self.open is not None:
            self.open.text.append(data)
            if self.heading:
                self.open.headings[self.heading].append(data)


def _squash(parts):
    return re.sub(r'\s+', ' ', html.unescape(' '.join(parts))).strip()


@functools.lru_cache(maxsize=4)   # one parse for the ~40 titles and chains a learn tries on one page
def anchors(markup, base):
    """Every link of the page (Anchor), in page order."""
    tree = _Tree(base)   # html.parser reads any text without raising (3.5+), so a broken page gives the links it holds
    tree.feed(markup)
    tree.close()
    if tree.open is not None:   # a link still open at the end of the page (a cut-off page): its text so far is its own
        tree.anchors.append(tree.open)
    return tuple(tree.anchors)


def title_of(anchor, title):
    """The anchor's title as `title` says (page_recipes.TITLES, or None: the link's own text)."""
    if title is None:
        return _squash(anchor.text)
    if title == 'label':
        return _squash([anchor.label])
    return _squash(anchor.headings.get(title, []))


def matches(anchor, chain):
    """Whether the link and its nearest ancestors are `chain` ([[tag, class], ...], outermost first): each tag equal, each class one of the element's classes ('' = any)."""
    if len(anchor.chain) < len(chain):
        return False
    return all(tag == name and (not css or css in classes) for (tag, css), (name, classes) in zip(chain, reversed(anchor.chain[:len(chain)])))


def valid(recipe):
    """The path recipe has exactly the fixed shape: 1-5 [tag, class] entries ending in the link itself, the cap `max`, an optional `title`."""
    chain, cap = recipe.get('chain'), recipe.get('max')
    return (isinstance(chain, list) and 1 <= len(chain) <= MAX_CHAIN and type(cap) is int and 1 <= cap <= 1000
            and all(isinstance(entry, list) and len(entry) == 2 and entry[0] in PATH_TAGS and isinstance(entry[1], str)
                    and (entry[1] == '' or CLASS.fullmatch(entry[1])) for entry in chain)
            and chain[-1][0] == 'a')


def _one_shape(found):
    """Whether SAME_SHAPE of the links share one shape: the first path segment and the number of segments (/o/123 and /o/456 are one; /about and /o/123 are not)."""
    shapes = {}
    for a in found:
        parts = [part for part in urllib.parse.urlsplit(a.href).path.split('/') if part]
        key = (parts[0] if parts else '', len(parts))
        shapes[key] = shapes.get(key, 0) + 1
    return bool(found) and max(shapes.values()) >= SAME_SHAPE * len(found)


def replay(recipe, markup, base, titles):
    """[(title, address)] of the links the path matches, or [] when it matches more than `max` links that are not one URL shape (a path that grabs too much reads nothing, never a trimmed list).
    `titles`: the page_recipes.TITLES of the recipe's `title` (or None)."""
    found = [a for a in anchors(markup, base) if matches(a, recipe['chain'])]
    if len(found) > recipe['max'] and not _one_shape(found):
        return []
    host, out, seen = urllib.parse.urlsplit(base).hostname, [], set()
    for a in found:   # one entry per address, the first link of the page's order: a card's title link before its "Apply" button
        url = a.href.split('#')[0]
        if urllib.parse.urlsplit(url).hostname == host and url not in seen:
            seen.add(url)
            out.append((title_of(a, titles), url))
    return out


def _groups(found):
    """Each set of the links' anchors sharing one own class list, largest first, then all of them (a job with two links, its title and a button, learns from each kind alone:
    the one path over both would read the button as a job)."""
    own = {}
    for anchor in found:
        own.setdefault(anchor.chain[0][1], []).append(anchor)
    return (sorted(own.values(), key=len, reverse=True)[:3] if len(own) > 1 else []) + [found]


def candidates(markup, base, links, cap=None):
    """Recipe bodies ({'chain', 'max'}, chain outermost first) that could read the page's links `links` (job addresses): for each group of their anchors (_groups) the
    shortest chain first, each level the class every anchor of the group shares that the fewest page elements of that tag carry (else no class). The caller adds `title`
    and checks the fit; `max` is 3 times the number of links."""
    page = anchors(markup, base)
    wanted = {link.split('#')[0].rstrip('/') for link in links}
    found = [a for a in page if a.href.split('#')[0].rstrip('/') in wanted]
    for group in _groups(found) if found else ():
        for size in range(1, MAX_CHAIN + 1):
            if any(len(a.chain) < size for a in group):
                break
            levels = []
            for level in range(size):
                tags = {a.chain[level][0] for a in group}
                if len(tags) != 1 or next(iter(tags)) not in PATH_TAGS:
                    break
                tag = tags.pop()
                shared = set.intersection(*(set(a.chain[level][1]) for a in group))
                popular = {css: sum(1 for p in page if len(p.chain) > level and p.chain[level][0] == tag and css in p.chain[level][1]) for css in shared}
                levels.append([tag, min(sorted(shared), key=popular.get) if shared else ''])
            else:
                if levels[0][0] == 'a':
                    yield {'chain': levels[::-1], 'max': min(1000, max(1, 3 * len(links)))}
