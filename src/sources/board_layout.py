"""A job board's layout, learned once by board discovery and served in its board fact, replayed before any AI question about the page's links.

Why (13 Nov 2026, owner: "shouldn't the central scout and board discovery do that... spend those 60-90s ?"): a first search spent 61-88 s a board page
on "job links", one AI question per link wording (src/ai/page_words.py link_words), on boards discovery had already measured. A layout is the
src/sources/page_recipes.py shape (the AI's read made it, a replay checked it); this module only replays it. The job pages it names are read by the
same fetch as the usual read (careers.read_page_from), on the same clock. A layout that reads nothing on a page the usual read finds jobs on is dropped for
the rest of this read, said in one line (an empty results page keeps it): discovery's next measure learns a new one.
Why (14 Nov 2026, owner via sa: "In the Scout only (Recommended)", asked via AskUserQuestion; eo's #4139: a board read through its served layout gave fewer jobs than the usual read on some hosts): a layout
that names links is no proof it reads the board's jobs. Where board discovery runs (board['learn'] is set: the Scout's pass, with time to spare) a layout is kept only while reading through it gives at least the
jobs the usual read finds on the same page, at learn time and at every re-read of a kept one; one that gives fewer is dropped from the board's fact, so the next publish stops serving it. A search's own read
(no board['learn']) never compares: no second read, no new seconds in a person's first minute (a local before/after on Madrid: 16 -> 20 jobs in places, first relevant 11 s -> 33 s).
Tests: tests/unit/sources/test_board_layouts.py (the replay), test_scout_board_layouts.py (board discovery learns it), test_board_layout_yield.py (the comparison).
"""
import threading

from . import careers, page_recipes
from ..press import stage


class _Uncounted:
    """A details sink that counts nothing: `_once` only keeps a failure, and the page read's own guard counts it once when it is raised again."""
    @staticmethod
    def failed(where, reason):
        pass


_UNCOUNTED = _Uncounted()


def _once(fetch):
    """`fetch` asked once per address, its answer or its failure kept: the usual read beside a layout read re-asks nothing, a failed address included (a refused page is never asked again).
    Why (14 Nov 2026, Gitar on #4154): functools.lru_cache keeps no call that raised, so a timeout or a 429 on a job page was requested again, on a host already struggling."""
    seen, lock = {}, threading.Lock()

    def get(address):
        with lock:
            hit = seen.get(address)
        if hit is None:
            with stage.guard('employer sites: linked page', _UNCOUNTED) as caught:
                hit = (fetch(address), None)
            if caught:   # kept and raised again to every asker: the caller's own guard (careers.read_page_from) counts it and decides what a failed page means
                hit = (None, caught.error)
            with lock:
                hit = seen.setdefault(address, hit)
        if hit[1] is not None:
            raise hit[1]
        return hit[0]
    return get


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
        self.page = None   # the fetch (kept answers) of the last read in board discovery's pass: `learn` reads through a derived layout with it

    def read(self, markup, url, fetch, part=None):
        """The page's jobs: its JSON-LD first, then the layout's job cards, else the usual read (careers.read_page_from)."""
        if self.notes is not None:
            fetch = self.page = _once(fetch)
        declared = careers.jsonld_jobs(markup, url)
        if declared:
            self.why_none('its jobs are JSON-LD, read with no question')
            return declared
        if not self.recipe:
            return self.learn(markup, url, careers.read_page_from(markup, url, fetch, part))
        items = page_recipes.replay(self.recipe, markup, url)
        links = list(dict.fromkeys(link for _, link in items if link))
        if links:   # Why (#3982, Gitar): the layout found the cards; a job page that fails to give a job is that page's failure, never the layout's
            if self.notes is not None:
                return self._compared(links, markup, url, part)
            self._note(self.recipe)
            return careers.read_page_from(markup, url, fetch, part, linked=links)
        if items:   # jobs written as sections, with no link: each its own address (the listing's, #title), or the board read's one-per-address keeps one
            self._note(self.recipe)
            return [{**job, 'url': job['id']} for job in careers.listed(items, url, markup, fetch)]
        usual = careers.read_page_from(markup, url, fetch, part)
        if usual:   # Why (#3982, Gitar): an empty results page keeps the layout; jobs the usual read finds where it found none mean it is stale
            print(f"Job board {self.host}: its served layout read nothing on {url} where the usual read found jobs; read the usual way for the rest of this read")
            self._drop()
        return self.learn(markup, url, usual)

    def _drop(self):
        """The layout is stale for the rest of this read and, in board discovery's pass, in the board's fact.
        Why (14 Nov 2026, Gitar on #4161; sa's class check): `_note` writes only over a falsy value, so a drop on a later page could not undo an earlier page's keep and the read dropped the layout while the
        fact kept it; both drops (nothing read where the usual read found jobs, fewer jobs than the usual read) go through here. `_note`'s first write wins for a keep (the same recipe) and a learned layout."""
        self.recipe = None
        if self.notes is not None:
            self.notes['layout'] = False

    def _compared(self, links, markup, url, part):
        """Board discovery's re-read of a kept layout: the jobs through it, kept while the usual read finds no more on this page (a tie keeps it); else it is dropped from the board's fact and
        a new one is learned from the usual read's jobs. Both reads share the pass's fetched pages (`self.page`), so a job page is asked once."""
        jobs = careers.read_page_from(markup, url, self.page, part, linked=links)
        usual = careers.read_page_from(markup, url, self.page, part)
        if len(usual) <= len(jobs):
            self._note(self.recipe)
            return jobs
        print(f"Job board {self.host}: layout not kept: reading through it gave {len(jobs)} jobs on {url} where the usual read found {len(usual)}")
        self._drop()
        return self.learn(markup, url, usual)

    def _reads(self, recipe, markup, url, found):
        """Whether the recipe reads the jobs `found` (the usual read's, or the AI's) on the page it was derived from, and why not: reading through it gives at least as many jobs; and a layout with no
        structure (links, prefix '', depth 1: every one-segment link of the page) names at least MATCH_SHARE jobs among its links, because nothing tells its job links from the rest as a page grows
        past the MAX_JOB_PAGES it reads (Jobeka: 28 links on the Scout's page, all read, 58 on a Madrid page, 40 read). A layout naming no link has nothing to read.
        The pages are read with `self.page`, the kept answers of this board read's last `read` (found_boards reads a page with `Layout.read` before it asks the AI reader and calls `learn`, so
        the AI reader's jobs are checked the same way; the cache is by address, so another listing page's answers are the same pages). Before any read nothing is claimed beyond the share rule."""
        links = list(dict.fromkeys(link for _, link in page_recipes.replay(recipe, markup, url) if link))
        if not links:
            return True, ''
        norm = lambda address: address.split('#')[0].rstrip('/')   # the same on both sides: a found job's url may carry a fragment or a slash the link does not
        urls = {norm(job['url']) for job in found}
        bare = recipe['kind'] == 'links' and recipe['prefix'] == '' and recipe.get('depth', 1) == 1
        if bare and sum(1 for link in links if norm(link) in urls) < page_recipes.MATCH_SHARE * len(links):
            return False, 'its one shape names links that are not jobs'
        if self.page is not None and len(careers.read_page_from(markup, url, self.page, None, linked=links)) < len(found):
            return False, 'its layout reads fewer jobs than the usual read found'
        return True, ''

    def learn(self, markup, url, found):
        """`found` unchanged; during board discovery's pass, a layout derived from the jobs a listing page gave is noted for the board's fact, when reading through it gives those jobs."""
        if self.notes is not None and found and not self.notes.get('layout'):
            recipe, why = page_recipes.derive(markup, url, found), 'no one shape reads its job cards'
            if recipe:
                reads, reason = self._reads(recipe, markup, url, found)
                recipe, why = (recipe, why) if reads else (None, reason)
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
