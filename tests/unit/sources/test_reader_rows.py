"""The reader rows (src/sources/reader_rows.py, contract C3 of docs/superpowers/specs/2026-11-10-find-jobs-code-shape.md): one loop over every row, each lists its
source's jobs as the source gave them (never scored, sorted or kept), and the free-API stage's list reads EURES through its row, in today's place and behind
today's gate (#3678). The lanes (WP8 of docs/superpowers/specs/2026-11-10-find-jobs-finish-line.md) stay true: each row in one engine lane, each wait declared,
each source's "Time is up" name in one lane. No network, no AI."""
import io
import re
import unittest
from pathlib import Path
from unittest import mock

from src.press import step_yield
from src.press.clock import Clock
from src.sources import aggregators, eures, reader_rows

ROOT = Path(__file__).resolve().parents[3]

LISTED = [{'id': f'eures:{n}', 'title': title, 'location': 'Lyon, France', 'url': f'https://example.test/{n}'} for n, title in enumerate(('Électricien', 'Aide', 'Chef'))]
# Each row's network seam, patched with the jobs it lists: a new row adds its own here (the loop below fails on a row it does not know).
SEAMS = {'EURES': 'src.sources.eures.eures', 'Platsbanken': 'src.sources.national.read', 'Le Forem': 'src.sources.national.read', 'arbeidsplassen.no': 'src.sources.national.read', 'Job-Room': 'src.sources.national.read', 'LinkedIn': 'src.sources.linkedin_guest.read'}


class ReaderRowsTest(unittest.TestCase):
    def setUp(self):
        eures._early.clear()   # no read started with a search: each row reads now
        self.addCleanup(eures._early.clear)

    def test_every_row_lists_its_sources_jobs_as_given_and_never_scores(self):
        self.assertEqual(sorted(row.name for row in reader_rows.ROWS), sorted(SEAMS), 'a new row names its network seam in SEAMS')
        for row in reader_rows.ROWS:
            with self.subTest(row.name), mock.patch(SEAMS[row.name], return_value=list(LISTED)), \
                    mock.patch('src.daily_search_scoring.score_jobs', side_effect=AssertionError('a reader scored')) as score, \
                    mock.patch('sys.stdout', new_callable=io.StringIO):
                found = row.read(None, {'roles': ['Électricien'], 'locations': ['Lyon']})
            self.assertEqual(found, LISTED, 'the same jobs in the same order: a reader never sorts or keeps')
            score.assert_not_called()

    def test_the_free_api_list_reads_eures_through_its_row_in_todays_place(self):
        on = {'JOBADABRA_EURES': '1'}
        names = [name for name, _ in aggregators.sources(on)]
        self.assertEqual(names[names.index('jobs.ch') + 1:names.index('Job boards found') + 1], ['EURES', 'Platsbanken', 'Le Forem', 'arbeidsplassen.no', 'Job-Room', 'Job boards found'],
                         'the rows after jobs.ch, before the found boards, in the table\'s order')
        with mock.patch.object(eures, 'read', return_value=LISTED[:1]) as read:
            self.assertEqual(dict(aggregators.sources(on))['EURES']({'roles': ['x']}), LISTED[:1])
        read.assert_called_once_with({'roles': ['x']})
        for off in ({}, {'JOBADABRA_EURES': '1', 'JOBADABRA_DISABLE': 'eures'}, {'JOBADABRA_EURES': '1', 'JOBADABRA_DISABLE': 'aggregators'}):
            with self.subTest(off=off):
                self.assertFalse(reader_rows.ROWS[0].on(off))
                self.assertNotIn('EURES', [name for name, _ in aggregators.sources(off)])


class LanesTest(unittest.TestCase):
    """The lane table is the one place a wait is declared: a new `needs` changes the pin below in the same PR, with its reason."""
    SOURCES = ('web search', 'job boards', 'employer sites', 'free job APIs', 'Google Jobs', 'job-alert emails')   # Clock.STAGES that read a source

    def test_lanes_are_unique_each_on_one_side_and_every_row_is_in_an_engine_lane(self):
        self.assertEqual(len(reader_rows.BY_LANE), len(reader_rows.LANES))
        for lane in reader_rows.LANES:
            with self.subTest(lane.id):
                self.assertIn(lane.side, ('engine', 'app'))
        for row in reader_rows.ROWS:
            with self.subTest(row.name):
                self.assertIn(row.lane, reader_rows.BY_LANE, 'a row names a lane of the table')
                self.assertEqual(reader_rows.BY_LANE[row.lane].side, 'engine', 'an app lane has no engine reader')

    def test_the_only_declared_wait_is_the_found_boards_on_the_web_search_and_none_loops(self):
        needs = {lane.id: lane.needs for lane in reader_rows.LANES if lane.needs}
        self.assertEqual(needs, {'boards_found': ('board_web',)}, 'a new wait is a real need, declared here with its reason (design rule 2)')
        for lane in reader_rows.LANES:
            seen, todo = set(), list(lane.needs)
            while todo:
                other = todo.pop()
                with self.subTest(lane.id, needs=other):
                    self.assertIn(other, reader_rows.BY_LANE)
                    self.assertNotEqual(other, lane.id, f'{lane.id} waits for itself')
                if other not in seen:
                    seen.add(other)
                    todo.extend(reader_rows.BY_LANE[other].needs)
        self.assertNotIn('eures', {other for lane in reader_rows.LANES for other in lane.needs}, 'nothing waits for EURES (owner, 11 Nov 2026: "Other 3rd parties should be just bonuses")')

    def test_each_sources_time_up_name_and_measured_step_is_in_exactly_one_lane(self):
        said = [name for lane in reader_rows.LANES if lane.side == 'engine' for name in lane.clock]
        self.assertEqual(sorted(said), sorted(self.SOURCES))
        self.assertLessEqual(set(self.SOURCES), set(Clock.STAGES), 'the names the clock says')
        self.assertLessEqual(set(step_yield.STEPS) - {'scoring'}, set(reader_rows.BY_LANE), 'step_yield measures a source step under its lane id')

    def test_the_finders_lane_is_the_apps_scout_step(self):
        stages = (ROOT / 'desktop' / 'lib' / 'press-stages.js').read_text()
        scout = re.search(r"scout: \{what: '([^']+)'", stages)
        self.assertIsNotNone(scout, 'desktop/lib/press-stages.js names the scout step')
        self.assertEqual(reader_rows.BY_LANE['finder'].clock, (scout.group(1),))


if __name__ == '__main__':
    unittest.main()
