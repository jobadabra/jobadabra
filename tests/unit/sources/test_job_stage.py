"""G1, in = out offline (sa's finish-line plan, fixed guardrails; owner, 10 Nov 2026: "If a source is getting lost · We should have red CI"): a reader's jobs are
never silently gone. For every reader row (src/sources/reader_rows.py, so a new source is covered by itself): with every AI answer yes and time enough, all N
of its jobs are kept; with a short clock the jobs left unjudged are counted as never asked; the stages of one pass always add up to what was read; and at the
first-jobs slice's end, a reader that has read is imported whatever the order the readers end in (night 9 Nov 2026, p1: KeyError 'EURES', #3700).
Limit: a reader's own paging is behind its network seam here, so a page that fails inside a reader (#3689) is not seen; the night's per-source count (G6) is.
No AI, no network. Code: src/sources/job_stage.py, src/sources/aggregators.py kept."""
import io
import tempfile
from pathlib import Path
import unittest
from concurrent.futures import Future
from contextlib import redirect_stdout
from unittest import mock

from src import first_jobs
from src.ai import engine, title_queue, title_triage
from src.sources import aggregators, careers, eures, feeds, reader_rows

from tests.unit.sources.test_reader_rows import SEAMS

N = 6
_READER = careers.READER


def setUpModule():   # no page read reaches a real model from this file (tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


def database():
    """A feed database as the run's (feeds.database: its feed_jobs table), in a folder of its own."""
    db = feeds.database(Path(tempfile.mkdtemp()) / 'jobs.sqlite')
    db.execute(aggregators.TABLE)
    return db


def listed(name, n=N):
    """`n` jobs as a reader lists them, each with its own link, all in the person's town."""
    return [{'id': f'{name}:{i}', 'title': f'Electrician {i}', 'company': f'Employer {i}', 'location': 'Lyon, France', 'url': f'https://example.test/{name}/{i}',
             'date_posted': '', 'description': '', 'remote': False, 'salary': ''} for i in range(n)]


class InEqualsOut(unittest.TestCase):
    def setUp(self):
        eures._early.clear()
        aggregators.TAKEN.clear()
        self.addCleanup(eures._early.clear)
        self.addCleanup(aggregators.TAKEN.clear)
        self.verdicts = {}   # title -> the AI's answer; a title missing here was not reached before the clock
        self.places = {}     # link -> Claude's place; missing = 'in'
        saved = feeds.TRIAGED
        feeds.TRIAGED = {}
        self.addCleanup(setattr, feeds, 'TRIAGED', saved)
        for patch in (mock.patch.object(engine, 'ready', return_value=True),
                      mock.patch.object(engine, 'client', side_effect=AssertionError('AI forbidden')),
                      mock.patch.object(title_triage, 'decide', side_effect=self.decide),
                      mock.patch.object(feeds, 'place_of', side_effect=lambda job: self.places.get(job.get('url'), 'in')),
                      mock.patch('socket.socket.connect', side_effect=AssertionError('network forbidden'))):
            patch.start()
            self.addCleanup(patch.stop)

    def decide(self, titles, search, **kw):
        """The title sort: the answers of the titles it reached (a short clock leaves the others out)."""
        return {feeds.title_key(title): self.verdicts[title] for title in titles if title in self.verdicts}

    def scan(self, row):
        """One pass of the free-API stage over this row, through the row's own read (its network seam patched) -> (jobs kept, output)."""
        out = io.StringIO()
        with mock.patch(SEAMS[row.name], return_value=listed(row.name)), redirect_stdout(out):
            report = aggregators.scan(database(), {'roles': ['Electrician']}, readers=[(row.name, lambda search: row.read(None, search))])
        return report['jobs'], out.getvalue()

    def test_every_readers_jobs_are_all_kept_when_the_ai_says_yes_to_each_in_time(self):
        for row in reader_rows.ROWS:
            with self.subTest(row.name):
                self.verdicts = {job['title']: True for job in listed(row.name)}
                jobs, said = self.scan(row)
                self.assertEqual(sorted(job['url'] for job in jobs), sorted(job['url'] for job in listed(row.name)), 'in = out: every job read is kept')
                self.assertIn(f'Stages: {row.name} read {N} · kept {N}\n', said)

    def test_a_short_clock_counts_the_unjudged_jobs_as_never_asked_none_silently_gone(self):
        for row in reader_rows.ROWS:
            with self.subTest(row.name):
                self.verdicts = {job['title']: True for job in listed(row.name)[:2]}   # the clock ended after 2 titles
                jobs, said = self.scan(row)
                self.assertEqual(len(jobs), 2)
                self.assertIn(f'Stages: {row.name} read {N} · kept 2 · never_asked {N - 2}\n', said)

    def test_the_stages_of_one_pass_add_up_to_what_was_read(self):
        for row in reader_rows.ROWS:
            with self.subTest(row.name):
                jobs = listed(row.name)
                self.verdicts = {jobs[0]['title']: True, jobs[1]['title']: False, jobs[3]['title']: True}   # 2 not reached; 3 placed out
                self.places = {jobs[3]['url']: 'out'}
                with mock.patch.dict('os.environ', {'JOBADABRA_STAGE_LOG': '1'}):
                    kept, said = self.scan(row)
                self.assertIn(f'Stages: {row.name} read {N} · kept 1 · ai_no 1 · never_asked 3 · placed_out 1\n', said)
                per_job = [line.split(' ')[2] for line in said.splitlines() if line.startswith(f'Stage: {row.name} ') and ' read ' not in line]
                self.assertEqual(len(per_job), N, 'one line per job, its link only')
                self.assertNotIn('Electrician', ''.join(line for line in said.splitlines() if line.startswith('Stage: ')), 'no title in the per-job lines')

    def test_a_never_asked_line_carries_the_place_text_and_no_other_stage_does(self):
        """Why (13 Nov 2026, sa): 317 never-asked board jobs could not be told apart by place; the place text is public posting data."""
        from src.sources import job_stage
        job = {'title': 'Welder', 'url': 'https://x.example/1', 'location': '  Stuttgart,\n DE '}
        with mock.patch.dict('os.environ', {'JOBADABRA_STAGE_LOG': '1'}), mock.patch('builtins.print') as out:
            job_stage.say_one('Arbeitnow', 'never_asked', job)
            job_stage.say_one('Arbeitnow', 'kept', job)
        self.assertEqual([call.args[0] for call in out.call_args_list], ['Stage: Arbeitnow never_asked https://x.example/1 | Stuttgart, DE\n', 'Stage: Arbeitnow kept https://x.example/1\n'])

    def test_a_dropped_job_is_never_counted_kept_and_a_job_with_no_place_is_placed_out(self):
        """Review, 10 Nov 2026: a verdict that lands after kept looked must not turn a dropped job into "kept" (it reads as after_kept downstream)."""
        from src.sources import job_stage
        job = listed('EURES')[0]
        self.verdicts = {}
        feeds._triaged()[feeds.ASKED] = True
        feeds._triaged()[feeds.title_key(job['title'])] = True   # the answer landed after kept() looked
        self.assertEqual(job_stage.of(job), 'never_asked')
        self.places = {job['url']: None}
        with mock.patch.object(feeds, 'placing', return_value=True):
            self.assertEqual(job_stage.of(dict(job, location='')), 'placed_out', 'no place to ask about')

    def test_the_place_words_run_once_per_location_in_a_pass_not_once_per_job(self):
        """#3709's yardstick (10 Nov 2026): staging every dropped job ran the place words' regex (~150 µs) per job: aggregators.kept()
        on 20,000 title-dropped jobs over 200 places took 3.38 s, 0.40 s once per location (median of 3 on a Mac, #3723's body)."""
        jobs = [dict(job, url=f"{job['url']}-{n}") for n in range(50) for job in listed('EURES')]   # 300 jobs at one location
        self.verdicts, self.places = {}, {job['url']: None for job in jobs}   # no title answered, no place placed: the words decide each
        with mock.patch.object(feeds, 'wanted_location', wraps=feeds.wanted_location) as words, mock.patch.object(feeds, 'triage'), redirect_stdout(io.StringIO()):
            aggregators.kept(database(), 'EURES', jobs)
        self.assertEqual(words.call_count, 1, 'one location, one look by the place words (kept drops these by title before their place)')

    def test_at_the_slices_end_every_reader_that_has_read_is_imported_whatever_order_they_end_in(self):
        for row in reader_rows.ROWS:
            with self.subTest(row.name):
                imported = []
                boards, read = Future(), Future()
                boards.set_result(listed('boards'))
                read.set_result(listed(row.name))
                self.verdicts = {job['title']: True for job in listed('boards') + listed(row.name)}
                feed_db = database()
                with title_queue.hub() as hub, mock.patch('src.paths.load_search_config', return_value={'roles': ['Electrician']}), redirect_stdout(io.StringIO()):
                    readers = None

                    def hand(items):   # the slice's hand: a score step, which first looks at the hub (_Scoring.step -> before -> take_ready)
                        readers.take_ready()
                    readers = first_jobs._Readers(hub, {'boards': boards, row.name: read}, feed_db,
                                                  first_jobs._Imports(lambda report: imported.extend(job['url'] for job in report['jobs'])), hand, lambda line: None)
                    self.assertEqual(hub.box.qsize(), 2, 'positive control: both readers had read and wait in the hub')
                    readers.finish()
                self.assertEqual(sorted(imported), sorted(job['url'] for job in listed('boards') + listed(row.name)), 'every job of both readers reached the list')


if __name__ == '__main__':
    unittest.main()
