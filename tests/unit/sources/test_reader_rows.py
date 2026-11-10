"""The reader rows (src/sources/reader_rows.py, contract C3 of docs/superpowers/specs/2026-11-10-find-jobs-code-shape.md): one loop over every row, each lists its
source's jobs as the source gave them (never scored, sorted or kept), and the free-API stage's list reads EURES through its row, in today's place and behind
today's gate (#3678). No network, no AI."""
import io
import unittest
from unittest import mock

from src.sources import aggregators, eures, reader_rows

LISTED = [{'id': f'eures:{n}', 'title': title, 'location': 'Lyon, France', 'url': f'https://example.test/{n}'} for n, title in enumerate(('Électricien', 'Aide', 'Chef'))]
# Each row's network seam, patched with the jobs it lists: a new row adds its own here (the loop below fails on a row it does not know).
SEAMS = {'EURES': 'src.sources.eures.eures'}


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
        self.assertEqual(names[names.index('jobs.ch') + 1:names.index('EURES') + 2], ['EURES', 'Job boards found'], 'after jobs.ch, before the found boards, as before')
        with mock.patch.object(eures, 'read', return_value=LISTED[:1]) as read:
            self.assertEqual(dict(aggregators.sources(on))['EURES']({'roles': ['x']}), LISTED[:1])
        read.assert_called_once_with({'roles': ['x']})
        for off in ({}, {'JOBADABRA_EURES': '1', 'JOBADABRA_DISABLE': 'eures'}, {'JOBADABRA_EURES': '1', 'JOBADABRA_DISABLE': 'aggregators'}):
            with self.subTest(off=off):
                self.assertFalse(reader_rows.ROWS[0].on(off))
                self.assertNotIn('EURES', [name for name, _ in aggregators.sources(off)])


if __name__ == '__main__':
    unittest.main()
