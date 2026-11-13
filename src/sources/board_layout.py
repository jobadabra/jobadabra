"""A job board's layout, learned once by board discovery and served in its board fact, replayed before any AI question about the page's links.

Why (13 Nov 2026, owner: "shouldn't the central scout and board discovery do that... spend those 60-90s ?"): a first search spent 61-88 s a board page
on "job links", one AI question per link wording (src/ai/page_words.py link_words), on boards discovery had already measured. A layout is the
src/sources/page_recipes.py shape (the AI's read made it, a replay checked it); this module only replays it. The job pages it names are read by the
same fetch as the usual read (careers.read_page_from), on the same clock. A layout that reads nothing on a page is dropped for the rest of this read,
said in one line, and the page is read the usual way: discovery's next measure learns a new one.
Tests: tests/unit/sources/test_board_layouts.py.
"""
from . import careers, page_recipes


class Layout:
    """One board read's layout: `read` gives a listing page's jobs as the usual read does, with no link question while the layout holds."""

    def __init__(self, board):
        recipe = board.get('layout')
        self.recipe = recipe if page_recipes.valid(recipe) else None
        self.host = board.get('host') or ''

    def read(self, markup, url, fetch, part=None):
        """The page's jobs: its JSON-LD first, then the layout's job cards, else the usual read (careers.read_page_from)."""
        declared = careers.jsonld_jobs(markup, url)
        if declared or not self.recipe:
            return declared or careers.read_page_from(markup, url, fetch, part)
        items = page_recipes.replay(self.recipe, markup, url)
        links = list(dict.fromkeys(link for _, link in items if link))
        if links:
            found = careers.read_page_from(markup, url, fetch, part, linked=links)
            if found:
                return found
        elif items:   # a layout of titles with no link (jobs written as sections): the listing's own titles, as careers._from_recipe gives them
            return careers.listed(items, url, markup, fetch)
        print(f"Job board {self.host}: its served layout read nothing on {url}; read the usual way for the rest of this read")
        self.recipe = None
        return careers.read_page_from(markup, url, fetch, part)
