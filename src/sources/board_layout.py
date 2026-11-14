"""A job board's layout, learned once by board discovery and served in its board fact, replayed before any AI question about the page's links.

Why (13 Nov 2026, owner: "shouldn't the central scout and board discovery do that... spend those 60-90s ?"): a first search spent 61-88 s a board page
on "job links", one AI question per link wording (src/ai/page_words.py link_words), on boards discovery had already measured. A layout is the
src/sources/page_recipes.py shape (the AI's read made it, a replay checked it); this module only replays it. The job pages it names are read by the
same fetch as the usual read (careers.read_page_from), on the same clock. A layout that reads nothing on a page the usual read finds jobs on is dropped for
the rest of this read, said in one line (an empty results page keeps it): discovery's next measure learns a new one.
Why (14 Nov 2026, owner via sa: "Why not fixing right away?"; eo's #4139: a board read through its layout gave fewer jobs than the usual read on 18 of 76 hosts, edutalent.es 4 vs 38):
a layout that names links is no proof it reads jobs. At read time the pages it sent the read to are counted (read_page_from stats): a layout whose postings are under 1 in
MAX_FACTOR of the pages read is checked against the usual read: where the usual read finds more, that page is read the usual way, and the layout is retired for the rest of the read on the
second such page (a failed fetch is that page's failure and is not counted). At learn time the same bound holds on the
page the layout was learned from, and a layout with no structure (an empty prefix: any link under the root) must give MATCH_SHARE jobs. Both numbers are page_recipes'.
Tests: tests/unit/sources/test_board_layouts.py (the replay), test_board_layout_yield.py (the yield), test_scout_board_layouts.py (board discovery learns it).
"""
import functools

from . import careers, page_recipes

# Why (14 Nov 2026, Gitar on #4143): one sparse page, or the posting judge's run-to-run difference, must not retire a layout that works on the board's other pages: a page where the usual read
# finds more is read the usual way (that page alone pays), and the layout is retired on a repeat. 2 is "a repeat", the smallest count that is not one page's luck, not a tuned threshold.
SHORTFALLS = 2

class Layout:
    """One board read's layout: `read` gives a listing page's jobs as the usual read does, with no link question while the layout holds."""

    def __init__(self, board):
        recipe = board.get('layout')
        self.recipe = recipe if page_recipes.valid(recipe) else None
        self.host = board.get('host') or ''
        # board['learn']: board discovery's notes for this board (src/scout_boards.py), never an install's. notes['layout'] is what the read found: a
        # recipe (the given one held, or one derived from the jobs the usual read found: page_recipes.derive keeps it only when its replay gives them
        # back), or False (the given one read nothing where the usual read found jobs, and none was derived); absent: no layout was tested.
        notes = board.get('learn')
        self.notes = notes if isinstance(notes, dict) else None
        self.short = 0   # pages where the usual read found more jobs than the layout

    def read(self, markup, url, fetch, part=None):
        """The page's jobs: its JSON-LD first, then the layout's job cards, else the usual read (careers.read_page_from)."""
        declared = careers.jsonld_jobs(markup, url)
        if declared:
            self.why_none('its jobs are JSON-LD, read with no question')
            return declared
        if not self.recipe:
            return self.learn(markup, url, careers.read_page_from(markup, url, fetch, part))
        items = page_recipes.replay(self.recipe, markup, url)
        links = list(dict.fromkeys(link for _, link in items if link))
        if links:   # Why (#3982, Gitar): the layout found the cards; a job page that fails to give a job is that page's failure, never the layout's
            return self._by_links(links, markup, url, fetch, part)
        if items:   # jobs written as sections, with no link: each its own address (the listing's, #title), or the board read's one-per-address keeps one
            self._note(self.recipe)
            return [{**job, 'url': job['id']} for job in careers.listed(items, url, markup, fetch)]
        usual = careers.read_page_from(markup, url, fetch, part)
        if usual:   # Why (#3982, Gitar): an empty results page keeps the layout; jobs the usual read finds where it found none mean it is stale
            print(f"Job board {self.host}: its served layout read nothing on {url} where the usual read found jobs; read the usual way for the rest of this read")
            self.recipe = None
            self._note(False)
        return self.learn(markup, url, usual)

    def _by_links(self, links, markup, url, fetch, part):
        """The jobs of the job pages the layout named: its own when at least 1 page in MAX_FACTOR gave a posting, else the usual read's when it found more.
        Both reads share one cache of fetched pages, so the check costs the usual read's own fetches only. The layout is retired for the rest of this read
        on the SHORTFALLS-th page where the usual read found more (board discovery then notes it stale and learns a new one from these jobs)."""
        page = functools.lru_cache(maxsize=None)(fetch)
        stats = {}
        jobs = careers.read_page_from(markup, url, page, part, linked=links, stats=stats)
        if stats['gave'] * page_recipes.MAX_FACTOR >= stats['read']:   # no page read (all failed) is no low yield; at the learn-time bound it holds
            self._note(self.recipe)
            return jobs
        # Under the bound the usual read decides, so a busy posting judge (no page judged, in either read) never makes a layout stale: only more jobs from the usual read do.
        usual = careers.read_page_from(markup, url, page, part)
        if len(usual) <= len(jobs):
            self._note(self.recipe)
            return jobs
        self.short += 1
        retired = self.short >= SHORTFALLS
        print(f"Job board {self.host}: its served layout named {len(links)} links on {url}, {stats['gave']} gave a posting of the {stats['read']} read where the usual read "
              f"found {len(usual)} jobs; read the usual way for {'the rest of this read' if retired else 'this page'}")
        if not retired:   # not held yet either: a later clean page notes it held, a second short one stale
            return usual
        self.recipe = None
        self._note(False)
        return self.learn(markup, url, usual)

    def learn(self, markup, url, found):
        """`found` unchanged; during board discovery's pass, a layout derived from the jobs a listing page gave is noted for the board's fact."""
        if self.notes is not None and found and not self.notes.get('layout'):
            recipe, why = page_recipes.derive(markup, url, found), 'no one shape reads its job cards'
            if recipe and not _reads_the_jobs(recipe, markup, url, found):
                recipe, why = None, 'its one shape names links that are not jobs'
            self._note(recipe)
            if not recipe:
                self.why_none(why)
        return found

    def why_none(self, text):
        """Why discovery's read learned no layout, for its pass line (notes['why']; the first reason stays)."""
        if self.notes is not None:
            self.notes.setdefault('why', text)

    def _note(self, recipe):
        if self.notes is not None and not self.notes.get('layout') and (recipe or recipe is False and 'layout' not in self.notes):
            self.notes['layout'] = recipe


def _reads_the_jobs(recipe, markup, url, found):
    """Whether the recipe, replayed on the page it was learned from, names job links: of the first MAX_JOB_PAGES links the read would fetch, at least 1 in MAX_FACTOR are
    the jobs the usual read found there (the bound `read` holds it to); a recipe with no structure, every link one segment under the root, at least MATCH_SHARE of them.
    A recipe that names no link (sections) has nothing to fetch: it passes."""
    named = [(title, link) for title, link in page_recipes.replay(recipe, markup, url) if link][:careers.MAX_JOB_PAGES]
    if not named:
        return True
    norm = lambda address: address.split('#')[0].rstrip('/')   # the same on both sides: a found job's url may carry a fragment or a slash the link does not
    urls, titles = {norm(job['url']) for job in found}, {job['title'].lower() for job in found}
    jobs = sum(1 for title, link in named if norm(link) in urls or title.lower() in titles)
    bare = recipe['kind'] == 'links' and recipe['prefix'] == '' and recipe.get('depth', 1) == 1
    return jobs >= page_recipes.MATCH_SHARE * len(named) if bare else jobs * page_recipes.MAX_FACTOR >= len(named)
