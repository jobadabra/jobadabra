"""The queue's steps before the scores, off the search's 3 minutes (src/daily_modes.py score_mode): the jobs the search had no time to judge are judged
and listed (src/sources/waiting_jobs.py), the towns it noted are placed (src/sources/places_later.py), and the postings a score needs are read.
Design (12 Nov 2026, owner, asked via AskUserQuestion: "Yes, build it (Recommended)"; "All checked, 60 scored, 10 min (Recommended)"; "Yes, one bar, a count (Recommended)"):
titles, places, postings, then the scores; each step guarded, so one failing costs no score. Says two fixed lines the app reads
(desktop/renderer/pages/score-queue.js): `Check queue: {"waiting": n, "done": k}` as title batches land, and `Check queue: done`.
Spec: docs/superpowers/specs/2026-11-12-judge-after-the-search.md. Tests: tests/unit/ai/test_score_mode.py, tests/unit/sources/test_waiting_jobs.py."""
import json
from contextlib import closing

from . import stage

POSTINGS = 60   # postings read at most by one queue, as many as it may score (owner, 12 Nov 2026: "up to 60 postings read and 60 scored")


def run(args, db, search, out=print):
    """Runs the three steps on the store's `db` -> how many waiting jobs were listed. Never raises: a failed step is said and the scores go on."""
    from .. import store, time_budget
    from ..sources import describe, feeds, places_later, waiting_jobs
    listed = 0
    with stage.guard('waiting jobs judged') as caught:
        with closing(feeds.database(args.db)) as feed_db:   # the seen history lives beside the store's tables in the same file (feeds.database)
            waiting = waiting_jobs.count(feed_db, search)
            if waiting:
                done = [0]

                def landed(_fit, batch):
                    done[0] = min(waiting, done[0] + len(batch))
                    out('Check queue: ' + json.dumps({'waiting': waiting, 'done': done[0]}))
                out('Check queue: ' + json.dumps({'waiting': waiting, 'done': 0}))
                _, items = waiting_jobs.judge(feed_db, search, time_budget.wall(), out=out, land=landed)
                listed = len(items)
        if listed:
            store.import_watch_report(db, {'jobs': items})
    if caught.error:
        out(f'Warning: the jobs your last search had no time for were not checked ({caught.reason}); they wait for the next queue')
    out('Check queue: done')
    with stage.guard('places asked after the search') as caught:
        places_later.ask(search, out=out)
    if caught.error:
        out(f'Warning: the locations of the last search were not asked about ({caught.reason}); they wait for the next queue')
    with stage.guard('postings read after the search') as caught:
        note = describe.backfill(db, limit=POSTINGS)
        if note:
            out(note)
    if caught.error:
        out(f'Warning: the postings of the last search were not read ({caught.reason}); their jobs wait for the next queue')
    return listed

