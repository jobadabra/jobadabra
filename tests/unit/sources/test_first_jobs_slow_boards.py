"""A slow job-boards step never holds the first jobs (#2913, 2 Nov 2026: on the Codex relay the boards' proposal took 73 s, the employer sites were
read, and nothing was imported or scored until it ended). The employer sites' jobs are imported and scored while the boards are still running;
the boards' jobs join when they finish. Since lanes 4a the job boards read in their own lane (src/sources/boards_first.py Beside) and the slice
never waits for them; a slow reader here is any other reader started with the search (EURES's early read), the same `_Readers` path.
Tests: this file, tests/unit/sources/test_first_jobs.py."""
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest import mock

from src import first_jobs
from src.sources import careers

_READER = careers.READER
WAIT = 10   # a hang guard only: the test releases the boards itself


def setUpModule():   # the guard in tests/unit/sources/test_found_boards_ai.py: no page read reaches a real model from this file
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


def reader(boards):
    """A reader started with the search, as the run starts EURES's early read (src/first_jobs.py _others): its jobs as read, in a thread of its own."""
    return {'boards': ThreadPoolExecutor(max_workers=1).submit(boards, lambda line: None)}


def taken(feed_db, search, readers=None, early=False, shown=None, **kw):
    """The free-API stage's taking of one reader (aggregators.scan), as the hub calls it: every job it read is kept."""
    (_name, read), = readers
    return {'jobs': list(read(search))}


JOBS = [{'id': str(i), 'title': 'Engineer', 'company': 'A', 'location': 'Zurich', 'url': f'https://x/{i}'} for i in range(3)]
BOARD_JOB = {'id': 'b1', 'title': 'Engineer', 'company': 'B', 'location': 'Zurich', 'url': 'https://b/1'}


class TheBoardsJoinWhenTheyFinish(unittest.TestCase):
    def run_slice(self, boards, release=None):
        events, imported = [], []

        def scorer(db, candidates, profile, model, max_jobs, workers=5, stats=None, on_scored=None, every=10, only_ids=None, **kw):
            events.append('scored')
            if release:
                release.set()   # the employer jobs are scored: the boards may end
            stats.update(done=len(only_ids))
            on_scored()

        def import_jobs(report):
            events.append(f'import {len(report["jobs"])}')
            imported.append([job['id'] for job in report['jobs']])
        with mock.patch.object(first_jobs.score, 'queue', return_value=JOBS), mock.patch.object(first_jobs, 'to_score', return_value=JOBS), \
                mock.patch('src.sources.aggregators.scan', side_effect=taken), mock.patch('src.paths.load_search_config', return_value={}):
            first_jobs.run(mock.MagicMock(), mock.MagicMock(), [{'company': 'A', 'ats': 'greenhouse', 'slug': 'a'}], profile='p', hidden=frozenset(),
                           sync=lambda: None, say=lambda line: None, scan=lambda sources, feed_db, **kw: {'jobs': [dict(j) for j in JOBS], 'sources': []},
                           scorer=scorer, fits=lambda db: {}, import_jobs=import_jobs, others=reader(boards))
        return events, imported

    def test_the_employer_jobs_are_scored_before_a_slow_boards_step_ends(self):
        release, scored_first = threading.Event(), []

        def boards(say):
            scored_first.append(release.wait(WAIT))   # True only when the slice scored while this step still ran
            return [BOARD_JOB]
        events, imported = self.run_slice(boards, release)
        self.assertEqual(scored_first, [True], 'the boards step was still running when the employer jobs were scored')
        self.assertEqual(events[:2], ['import 3', 'scored'], events)
        self.assertEqual(imported[-1], ['b1'], 'the boards joined after, when they finished')

    def test_a_late_board_job_is_scored_when_the_employer_sites_gave_nothing(self):
        """Gitar on #2928: the late join imported the board jobs but nothing scored them, and the slice said 'none to score yet' (the card's end)."""
        release, queue, scored, said = threading.Event(), [], [], []

        def boards(say):
            release.wait(WAIT)
            return [BOARD_JOB]

        def scorer(db, candidates, profile, model, max_jobs, workers=5, stats=None, on_scored=None, every=10, only_ids=None, **kw):
            scored.append(sorted(only_ids))
            stats.update(done=len(only_ids))

        def import_jobs(report):
            queue.extend(job['id'] for job in report['jobs'])   # the store gains the jobs the slice imports

        def say(line):
            said.append(line)
            if line == 'First jobs: 0 found':
                release.set()   # the employer sites' import is over, nothing to score: the boards end now
        with mock.patch.object(first_jobs.score, 'queue', side_effect=lambda *a, **k: [{'id': i} for i in queue]), \
                mock.patch.object(first_jobs, 'to_score', return_value=[]), \
                mock.patch('src.sources.aggregators.scan', side_effect=taken), mock.patch('src.paths.load_search_config', return_value={}):
            first_jobs.run(mock.MagicMock(), mock.MagicMock(), [{'company': 'A', 'ats': 'greenhouse', 'slug': 'a'}], profile='p', hidden=frozenset(),
                           sync=lambda: None, say=say, scan=lambda sources, feed_db, **kw: {'jobs': [], 'sources': []}, scorer=scorer,
                           fits=lambda db: {}, import_jobs=import_jobs, others=reader(boards))
        self.assertEqual(scored, [['b1']], 'the board job was scored in the slice')
        self.assertFalse([line for line in said if 'none to score yet' in line], said)
        self.assertIn('First jobs: 1 found on the job boards', said, 'the app re-reads its job list on this wording (LIST_CHANGED, desktop/test/unit/renderer/live-count.test.js)')

    def test_boards_that_finish_at_once_are_imported_once_whichever_side_of_the_scan_they_end(self):
        events, imported = self.run_slice(lambda say: [BOARD_JOB])
        self.assertEqual(sorted(job for batch in imported for job in batch), ['0', '1', '2', 'b1'], 'every job once, none twice')


if __name__ == '__main__':
    unittest.main()
