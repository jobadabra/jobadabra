"""Whether a job board's read left jobs waiting for an answer the AI owes them, so the next press reads it again (at most owed_reads.MOST times).
The one question; the bound is aggregators.mark_read_unless_waiting's, the same as the free APIs' (#3893). Tests: tests/unit/sources/test_board_owed.py."""
from contextlib import closing
from datetime import datetime

from .. import paths
from ..press import stage


def waiting(found, relevant):
    """The jobs of a read that no answer settled (job_stage 'never_asked': the AI had none for their place or title in time); the relevant ones are kept, so none of them."""
    from . import job_stage
    kept, places = {job.get('url') for job in relevant}, {}
    return [job for job in found if job.get('url') not in kept and job_stage.of(job, places) == 'never_asked']


def waits(host, search, found, relevant, stamp):
    """True when board `host`'s read left jobs waiting and the bound allows another read of it (False: it rests as before). stamp: the read's ISO time.
    Why (12 Nov 2026, bj 2/2, sa; #3893 for the free APIs): keep() stamped every read, so the jobs a run could not judge in time (never_asked, kept nowhere) waited 6 h
    with their board; mark_read_unless_waiting counts the re-reads (owed_reads.another_read) so a board the AI never answers for rests after the bound too."""
    from . import aggregators, feeds
    owed = waiting(found, relevant)
    with stage.guard('job boards: owed reads'), closing(feeds.database(paths.DATA / 'jobs.sqlite')) as db:   # no store: the board rests as before
        return aggregators.mark_read_unless_waiting(db, f'Job board {host}', datetime.fromisoformat(stamp), search, owed)
    return False
