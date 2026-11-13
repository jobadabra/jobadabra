"""Recipes: how to read one careers page without AI, learned from the one time AI read it.

When Claude lists the jobs on a page (ai/page_reader.py), the rules here look at its answer and the page and derive a recipe the code can replay:
  {'kind': 'links', 'prefix': '/de/jobs'}           the jobs are the links one level under this path (title = the link text), or
  {'kind': 'links', 'prefix': '/oferta', 'depth': 2} ... 2 or 3 levels under it (/oferta/<id>/<slug>); no depth field means 1, as before, or
  {'kind': 'links', 'prefix': '/jobs', 'title': 'h4'} ... job cards: the whole card is the link, its title is the first <h4> inside it
                                                    ('label': the link's own aria-label, else its title attribute); with or without depth, or
  {'kind': 'tag', 'tag': 'h3', 'class': 'job-title'} the jobs are the texts of these elements (pages that list jobs as sections), or
  {'kind': 'state', 'path': '0.hits.list'}   the jobs are the records of this list in the JSON state the page carries (board_state.py).
A recipe is kept only when replaying it on the same page gives back what Claude found. The 4-hourly crawl then replays it with no model call,
and asks Claude again only when the replay finds nothing (the page changed).
A recipe is plain data with a fixed shape and checked values (never a pattern or code from anywhere), so it can travel in the employer index
and be shared between installs: the central scout publishes the ones it learned, every install's crawl can use them.
"""
import html
import json
import re
import sqlite3
import urllib.parse
from datetime import datetime, timezone

TAGS = ('h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'a', 'strong', 'b', 'span', 'div', 'p', 'td', 'dt')
MATCH_SHARE = 0.8          # a replay must give back at least this share of what the model found
MAX_FACTOR = 3             # ... and not more than this many times as many items (a pattern that grabs every link is no recipe)
# Why (13 Nov 2026, owner: "Yes, add depth (Recommended)"): three job boards put each job 2 folders under one prefix (/oferta/<id>/<slug>, or
# /<id>/<slug> at the root), so no one-level links recipe fitted them and every install asked the AI about their links. Depth 1 has no field, so a
# recipe learned before depth replays exactly as before, and an install older than depth refuses a recipe that has it (its valid wants 2 keys).
MAX_DEPTH = 3
# Why (13 Nov 2026, #4061; owner-approved fix #1 design, "Yes, approve (Recommended)"): job cards whose link holds the whole card (title, place, date: over 140 characters,
# so dropped) or no text (the title is its aria-label) got no layout. A card's title is its link's own name or the first heading inside it; no title field means the link
# text, as before, and an install older than titles refuses the field. The measurement is in #4061's body.
TITLES = ('label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6')
TABLE = 'CREATE TABLE IF NOT EXISTS page_recipes (url TEXT PRIMARY KEY, recipe_json TEXT NOT NULL, learned_at TEXT NOT NULL, source TEXT NOT NULL, broken_at TEXT)'


def valid(recipe):
    """The recipe has exactly the fixed shape and safe values."""
    if not isinstance(recipe, dict):
        return False
    if recipe.get('kind') == 'links':
        depth = recipe.get('depth', 1)
        return (set(recipe) - {'depth', 'title'} == {'kind', 'prefix'} and isinstance(recipe['prefix'], str)
                and bool(re.fullmatch(r'(/[\w.%~-]+){0,6}', recipe['prefix'])) and type(depth) is int and 1 <= depth <= MAX_DEPTH
                and recipe.get('title', 'label') in TITLES)
    if recipe.get('kind') == 'tag':
        return (set(recipe) == {'kind', 'tag', 'class'} and recipe['tag'] in TAGS and isinstance(recipe['class'], str)
                and bool(re.fullmatch(r'[\w -]{1,60}', recipe['class'])))
    if recipe.get('kind') == 'state':
        return (set(recipe) == {'kind', 'path'} and isinstance(recipe['path'], str)
                and bool(re.fullmatch(r'\d{1,2}(\.[\w$-]{1,40}){0,12}', recipe['path'])))
    return False


def _text(fragment):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', fragment))).strip()


def _links(markup, base):
    out = []
    for href, inner in re.findall(r'<a\b[^>]*?href=["\']([^"\'#][^"\']*)["\'][^>]*>(.*?)</a>', markup, re.S | re.I):
        out.append((urllib.parse.urljoin(base, html.unescape(href)), _text(inner)))
    return out


def _card_links(markup, base, title):
    """[(address, title)] of every link, its title read as `title` says (TITLES): the link's aria-label or title attribute, or its first heading."""
    out = []
    for attrs, inner in re.findall(r'<a\b((?:[^>"\']|"[^"]*"|\'[^\']*\')*)>(.*?)</a>', markup, re.S | re.I):   # a `>` inside a quoted attribute is not the tag's end
        href = re.search(r'(?<![\w-])href=["\']([^"\'#][^"\']*)["\']', attrs, re.I)
        if not href:
            continue
        if title == 'label':
            # Why (13 Nov 2026, #4061): match the attribute name whole; `\b` also matched data-title / data-aria-label, which tracking code puts on cards.
            named = re.search(r'(?<![\w-])aria-label=["\']([^"\']*)["\']', attrs, re.I) or re.search(r'(?<![\w-])title=["\']([^"\']*)["\']', attrs, re.I)
            text = _text(named.group(1)) if named else ''
        else:
            heading = re.search(r'<{0}\b[^>]*>(.*?)</{0}>'.format(title), inner, re.S | re.I)
            text = _text(heading.group(1)) if heading else ''
        out.append((urllib.parse.urljoin(base, html.unescape(href.group(1))), text))
    return out


def replay(recipe, markup, base):
    """[(title, address or None)] the recipe reads from the page, once each."""
    if not valid(recipe):
        return []
    found = []
    if recipe['kind'] == 'state':
        from . import board_state   # the page's embedded JSON: the list at the path (a title and a link each)
        found = [(r['title'], r['url']) for r in board_state.at_path(markup, base, recipe['path'])]
    elif recipe['kind'] == 'links':
        host = urllib.parse.urlsplit(base).hostname
        depth = len([part for part in recipe['prefix'].split('/') if part]) + recipe.get('depth', 1)
        for url, text in (_card_links(markup, base, recipe['title']) if 'title' in recipe else _links(markup, base)):
            parts = urllib.parse.urlsplit(url)
            segments = [part for part in parts.path.split('/') if part]
            if parts.hostname == host and parts.path.startswith(recipe['prefix'] + '/') and len(segments) == depth and text:
                found.append((text, url.split('#')[0]))
    else:
        pattern = r'<{0}\b[^>]*class=["\'][^"\']*\b{1}\b[^"\']*["\'][^>]*>(.*?)</{0}>'.format(recipe['tag'], re.escape(recipe['class']))
        found = [(_text(inner), None) for inner in re.findall(pattern, markup, re.S | re.I)]
    seen, out = set(), []
    for title, url in found:
        if title and 3 <= len(title) <= 140 and (title, url) not in seen:
            seen.add((title, url))
            out.append((title, url))
    return out


def _fits(recipe, markup, base, titles, links):
    got = replay(recipe, markup, base)
    if not got or len(got) > MAX_FACTOR * max(len(titles), 1):
        return False
    got_titles, got_links = {t.lower() for t, _ in got}, {u for _, u in got if u}
    hits = sum(1 for title, link in zip(titles, links) if title.lower() in got_titles or (link and link in got_links))
    return hits >= MATCH_SHARE * len(titles)


def derive(markup, base, jobs):
    """A recipe that reads these jobs (as the model listed them) from this page, or None."""
    titles = [job['title'] for job in jobs]
    links = [job['url'] if job['url'].split('#')[0].rstrip('/') != base.rstrip('/') else None for job in jobs]
    if not titles:
        return None
    from . import board_state   # jobs the page carries as JSON state: the path to the list that holds them
    for path, records in board_state.candidates(markup, base):
        recipe = {'kind': 'state', 'path': path}
        if valid(recipe) and _fits(recipe, markup, base, titles, links):
            return recipe
    paths = [urllib.parse.urlsplit(link).path.rstrip('/') for link in links if link]
    linked = len(paths) >= max(1, len(titles) // 2)
    if linked:
        parents = {path.rsplit('/', 1)[0] for path in paths}
        if len(parents) == 1:
            recipe = {'kind': 'links', 'prefix': parents.pop()}
            if valid(recipe) and _fits(recipe, markup, base, titles, links):
                return recipe
    # Deeper links come after every recipe derived before depth (one level, then sections): a page that had a recipe keeps the same one, so an
    # install older than depth is never served a recipe it refuses in place of one it reads.
    # Cards come last for the same reason: every recipe derived before titles stays the one derived.
    recipe = _sections(markup, base, titles)
    if recipe or not linked:
        return recipe
    return _deeper(markup, base, titles, links, paths) or _cards(markup, base, titles, links, paths)


def _parent(paths, depth):
    """The one folder every path sits `depth` levels under ('' is the root), or None when they sit under different ones or are shorter."""
    parts = [[part for part in path.split('/') if part] for path in paths]
    if any(len(segments) < depth for segments in parts):
        return None
    parents = {'/'.join([''] + segments[:-depth]) for segments in parts}
    return parents.pop() if len(parents) == 1 else None


def _deeper(markup, base, titles, links, paths):
    """A links recipe 2 or 3 levels under one prefix that reads these jobs, or None."""
    for depth in range(2, MAX_DEPTH + 1):
        prefix = _parent(paths, depth)
        recipe = {'kind': 'links', 'prefix': prefix, 'depth': depth}
        if prefix is not None and valid(recipe) and _fits(recipe, markup, base, titles, links):
            return recipe
    return None


def _cards(markup, base, titles, links, paths):
    """A links recipe (any depth) whose title is the link's own name or a heading inside it (TITLES) that reads these jobs, or None."""
    for depth in range(1, MAX_DEPTH + 1):
        prefix = _parent(paths, depth)
        for title in TITLES if prefix is not None else ():
            recipe = {'kind': 'links', 'prefix': prefix, **({'depth': depth} if depth > 1 else {}), 'title': title}
            if valid(recipe) and _fits(recipe, markup, base, titles, links):
                return recipe
    return None


def _sections(markup, base, titles):
    """A recipe for jobs written as sections: the element that holds each title, if they all share one tag and class; or None."""
    shapes = set()
    for title in titles:
        words = r'\s+'.join(re.escape(html.escape(word, quote=False)) for word in title.split())
        # The innermost element around the title: only inline wrappers (a link, a span) may sit between it and the text.
        match = re.search(r'<(%s)\b([^>]*)>\s*(?:<(?:a|span|strong|b|em)\b[^>]*>\s*)*%s' % ('|'.join(TAGS), words), markup, re.I)
        classes = re.search(r'class=["\']([^"\']+)["\']', match.group(2)) if match else None
        if not classes:
            return None
        shapes.add((match.group(1).lower(), classes.group(1).split()[0]))
    if len(shapes) != 1:
        return None
    tag, css = shapes.pop()
    recipe = {'kind': 'tag', 'tag': tag, 'class': css}
    return recipe if valid(recipe) and _fits(recipe, markup, base, titles, [None] * len(titles)) else None


# ---------- kept on this computer, and from the employer index ----------

def _ready(db):
    db.execute(TABLE)
    if 'broken_at' not in {row[1] for row in db.execute('PRAGMA table_info(page_recipes)')}:
        db.execute('ALTER TABLE page_recipes ADD COLUMN broken_at TEXT')   # a cache made before feed health (3 Oct 2026)
    return db


def _db(db=None):
    if db is not None:
        return _ready(db), False
    from ..paths import jobs_db
    jobs_db().parent.mkdir(parents=True, exist_ok=True)   # a fresh checkout or runner has no data/ folder yet
    return _ready(sqlite3.connect(jobs_db(), timeout=30)), True


def mark_broken(url, db=None):
    """The recipe for this page read nothing although the page was there: flagged (counted on /intel) and, until a new read learns a new one,
    not used. Never raises."""
    try:
        db, own = _db(db)
        try:
            db.execute('UPDATE page_recipes SET broken_at = ? WHERE url = ? AND broken_at IS NULL', (datetime.now(timezone.utc).isoformat(timespec='seconds'), url))
            db.commit()
        finally:
            if own:
                db.close()
    except sqlite3.Error:
        pass


def save(url, recipe, source='learned', db=None):
    if not valid(recipe):
        return
    db, own = _db(db)
    try:
        db.execute('INSERT OR REPLACE INTO page_recipes (url, recipe_json, learned_at, source, broken_at) VALUES (?, ?, ?, ?, NULL)',
                   (url, json.dumps(recipe), datetime.now(timezone.utc).isoformat(timespec='seconds'), source))
        db.commit()
    finally:
        if own:
            db.close()


def forget(url, db=None):
    db, own = _db(db)
    try:
        db.execute('DELETE FROM page_recipes WHERE url = ?', (url,))
        db.commit()
    finally:
        if own:
            db.close()


def load(url, db=None):
    """The recipe for this page: learned here, else one the employer index carries for it, else None. Never raises: a cache that
    cannot be opened (no data folder, locked by another run) means no recipe, and the page is read the usual way."""
    try:
        db, own = _db(db)
        try:
            row = db.execute('SELECT recipe_json FROM page_recipes WHERE url = ? AND broken_at IS NULL', (url,)).fetchone()
        finally:
            if own:
                db.close()
    except sqlite3.Error:
        row = None
    if row:
        recipe = json.loads(row[0])
        return recipe if valid(recipe) else None
    return from_index(url)


def from_index(url):
    try:
        from .. import employer_index
        from . import careers
        slug = careers.encode(url)
        stored = employer_index._read(employer_index.CACHE) or {}
        for feed in stored.get('feeds') or []:
            if feed.get('ats') == 'careers' and feed.get('slug') == slug and valid(feed.get('recipe')):
                return feed['recipe']
    except Exception:  # noqa: BLE001 — no index, no recipe
        pass
    return None
