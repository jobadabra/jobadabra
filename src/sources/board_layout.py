"""A job board's layout, learned once by board discovery and served in its board fact, replayed before any AI question about the page's links.

Why (13 Nov 2026, owner: "shouldn't the central scout and board discovery do that... spend those 60-90s ?"): a first search spent 61-88 s a board page
on "job links", one AI question per link wording (src/ai/page_words.py link_words), on boards discovery had already measured. A layout is the
src/sources/page_recipes.py shape (the AI's read made it, a replay checked it); this module only replays it. The job pages it names are read by the
same fetch as the usual read (careers.read_page_from), on the same clock. A layout that reads nothing on a page the usual read finds jobs on is dropped for
the rest of this read, said in one line (an empty results page keeps it): discovery's next measure learns a new one.
Tests: tests/unit/sources/test_board_layouts.py (the replay), test_scout_board_layouts.py (board discovery learns it).
"""
from . import careers, page_recipes

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

    def read(self, markup, url, fetch, part=None):
        """The page's jobs: its JSON-LD first, then the layout's job cards, else the usual read (careers.read_page_from)."""
        declared = careers.jsonld_jobs(markup, url)
        if declared:
            return declared
        if not self.recipe:
            return self.learn(markup, url, careers.read_page_from(markup, url, fetch, part))
        items = page_recipes.replay(self.recipe, markup, url)
        links = list(dict.fromkeys(link for _, link in items if link))
        if links:   # Why (#3982, Gitar): the layout found the cards; a job page that fails to give a job is that page's failure, never the layout's
            self._note(self.recipe)
            return careers.read_page_from(markup, url, fetch, part, linked=links)
        if items:   # jobs written as sections, with no link: each its own address (the listing's, #title), or the board read's one-per-address keeps one
            self._note(self.recipe)
            return [{**job, 'url': job['id']} for job in careers.listed(items, url, markup, fetch)]
        usual = careers.read_page_from(markup, url, fetch, part)
        if usual:   # Why (#3982, Gitar): an empty results page keeps the layout; jobs the usual read finds where it found none mean it is stale
            print(f"Job board {self.host}: its served layout read nothing on {url} where the usual read found jobs; read the usual way for the rest of this read")
            self.recipe = None
            self._note(False)
        return self.learn(markup, url, usual)

    def learn(self, markup, url, found):
        """`found` unchanged; during board discovery's pass, a layout derived from the jobs a listing page gave is noted for the board's fact."""
        if self.notes is not None and found and not self.notes.get('layout'):
            self._note(page_recipes.derive(markup, url, found) or None)
        return found

    def _note(self, recipe):
        if self.notes is not None and not self.notes.get('layout') and (recipe or recipe is False and 'layout' not in self.notes):
            self.notes['layout'] = recipe
