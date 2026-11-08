"""The job boards' employer discovery (jobs.ch, SwissDevJobs, TechTree: src/sources/boards.py discover) run inside the search, in its own thread beside
the employer sites, on the search's clock (owner, 8 Nov 2026: "One process, discovery inside (Recommended)"; then "If there are jobs waiting to be scored,
that should be the first new thing a repeated press does"). A press after the first ran it as its own engine step in front of the search, which the
run lock (src/paths.py run_lock) made wait: the step took ~50-60 s, the employer read's cut is 67.5 s from the press, so employer sites got ~4 s
(run 42411469318, p7). The found boards it also read are the search's own (src/sources/boards_first.py, boards_ahead.py), so beside it skips them.
Its employers are written to reports/companies.json, which this search imports after the read (daily_search.filter_jobs). Tests: tests/unit/sources/test_boards_beside.py."""
import os
from concurrent.futures import ThreadPoolExecutor

from ..ai import slots

PAGES, MAX_COMPANIES = 5, 40   # the app's discover step (desktop/lib/search-steps.js) asked the same


class Beside:
    def __init__(self, work):
        from ..ai import batch_scope

        def run():
            with batch_scope.reader('board discovery'):   # its title answers stay its own until it ends, as every side-by-side reader's
                return work()
        self.pool = ThreadPoolExecutor(max_workers=1)
        self.future = self.pool.submit(slots.carry(run))

    def finish(self):
        """Waits for the discovery until the read's cut, as the employer sites are waited for (read_budget.result); a failure is one warning
        line, never the search's: the next search discovers again. Past the cut its employers land when it ends (the next search reads them)."""
        from . import read_budget
        try:
            if read_budget.result(self.future, read_budget.cut_at()) is read_budget.LEFT:
                from .. import time_budget
                time_budget.later('job boards', 1, 'board discovery')   # still running at the cut: not "0 left" in press_left.json (Gitar on #3605)
                print("Job boards: finding employers goes on past the read's time; the employers it finds are read by the next search", flush=True)
        except Exception as error:  # noqa: BLE001 — an add-on to the search, as the separate step was
            print(f'Warning: job boards employer discovery stopped ({type(error).__name__}: {error}): the next search tries again', flush=True)
        finally:
            self.pool.shutdown(wait=False)

def start(search=None, work=None):
    """A Beside discovering the fixed boards' employers now, or None when there is nothing to do: no fixed board for these roles and places, the
    step turned off (JOBADABRA_DISABLE includes discover), or the end-to-end fixture mode (no live site). Call it inside batch_scope.concurrent()."""
    from ..features import disabled
    from . import boards
    if disabled('discover') or os.getenv('JOBADABRA_FIXTURE_DIR') or not boards.boards(search or boards._SEARCH):
        return None
    # Not 'Searching job boards…': the app clears the live log on that line, which starts a press (desktop/renderer/pages/jobs.js)
    print('Job boards: finding employers beside the employer sites', flush=True)
    return Beside(work or (lambda: boards.discover(PAGES, MAX_COMPANIES, beside=True)))
