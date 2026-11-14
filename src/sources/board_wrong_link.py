"""A job board whose search link answered 404 or 410 on every page asked (the link we built is wrong: no such address) is searched through the search form
on its own home page in the same read, in the board's lane and on the press's one clock; a refusal (401, 403, 429, a check page) is never this.
Why (14 Nov 2026, zb, sa's runs 43614387886 43614410252 43617651998): of 52 boards a search read with 0 jobs, 14 answered 404/410 to the link we built
(a guessed /jobs/<role> path, a form's action asked as a GET). The ladder that reads the home form (found_boards._another_way) runs only outside the
first-jobs slice, which ends a search's board reads, so those boards gave 0 for the whole press and their fix waited for a next search.
Tests: tests/unit/sources/test_board_wrong_link.py."""
import urllib.error
import urllib.parse

from . import board_search_first, read_budget

GONE = (404, 410)   # no such page: the link is wrong, the site did not refuse us


class Watch:
    """The board read's page reader, noting what each page asked answered: wrong() is True only when at least one page was asked and every one
    answered 404 or 410. Every other attribute (a round's listener, board_rounds) is the reader's own."""

    def __init__(self, fetch):
        self.fetch, self.codes = fetch, []

    def __call__(self, url, *args, **kwargs):
        try:
            page = self.fetch(url, *args, **kwargs)
        except urllib.error.HTTPError as error:
            self.codes.append(error.code)
            raise
        except Exception:
            self.codes.append(None)   # not reached, refused, a check page: never a wrong link
            raise
        self.codes.append(200)
        return page

    def __getattr__(self, name):
        return getattr(self.fetch, name)

    def wrong(self):
        return bool(self.codes) and all(code in GONE for code in self.codes)


def read(board, entry, proposed, search, fetch, judge, show, early, first):
    """(jobs, state, route) of `first(fetch)` (the board's read as before); when it read no job and every page it asked answered 404 or 410, the board's
    own home-page search form answers instead (board_search_first.through_form, the same fetch: the board's lane), unless the read cut came or the
    home page has no form, then the first answer stands. found_boards.read_board is the form's reader."""
    from .found_boards import read_board   # found_boards imports this module
    watch = Watch(fetch)
    result = first(watch)
    if result is None or result[0] or result[1] == 'browser' or not watch.wrong() or read_budget.past_cut():
        return result
    codes = '/'.join(str(code) for code in sorted(set(watch.codes)))
    print(f"Job boards: {board['name']}: its search link answered HTTP {codes} on every page (a wrong link, not a refusal): asked through its home page's search form", flush=True)
    return board_search_first.through_form(board, entry, proposed, search, fetch, judge, show, early, read_board,
                                           'the form answered with no job', 'its 0 stands', lambda link: elsewhere(link, board['search_url'])) or result


def elsewhere(link, wrong):
    """True when a home-page form's link is asked at another address than the link that answered 404/410.
    Why (14 Nov 2026, zb, sa): a form sent by POST (a job alert, a lead or contact form on golem, personeel, berg-it) is asked as a GET at the board's
    own search link (board_forms.templates `posted_at`), here the wrong one: it would answer 404 again, so it costs a request and is never asked."""
    def at(url):
        parts = urllib.parse.urlsplit(url)
        return ((parts.hostname or '').removeprefix('www.'), parts.path.rstrip('/'))
    return at(link) != at(wrong)
