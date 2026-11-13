"""A board count read from the board's own list is marked `listed_families` on its fact (src/scout_boards.py, src/scout_board_counts.py keep_fact).
Why (13 Nov 2026, bp, owner via sa): airlinejobs.com es was served `right 53, measured` for electricians = the airline's whole Spanish list; the site ranks a searched count before a list count.
Own file: tests/unit/sources/test_scout_boards.py is at the 500-line limit."""
import sqlite3
import unittest
from datetime import date
from unittest import mock

from src import scout_board_cells, scout_boards, scout_cells


def board(host):
    return {'name': host, 'host': host, 'search_url': f'https://{host}/search?q={{role}}', 'countries': ['Moldova'], 'kinds': ['any'], 'source_kind': 'general'}


def job(place, title='Developer'):
    return {'title': title, 'location': place, 'url': f'https://x/{place}/{title}'}


class ListedMarkTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        scout_cells.keep(self.db, [{'countries': [c]} for c in scout_cells.EUROPE if c != 'md' for _ in range(5)])   # Moldova has none: the thinnest
        patch = mock.patch.object(scout_boards.pool_tags, 'countries_each', lambda texts: ({t: {'md'} if 'Chi' in t else set() for t in texts}, []))
        patch.start()
        self.addCleanup(patch.stop)

    def by_cells(self, reads, labels, asked, searched, url='https://{host}/search?q={{role}}'):
        """One board-discovery pass for `asked` ({family: its words}); the fake reader says which words it searched (as found_boards does) and returns reads[host]."""
        def read_board(item, search, fetch):
            item['learn'].setdefault('terms', []).extend(searched)
            return reads[item['host']]
        with mock.patch.object(scout_boards.pool_tags, 'families_each', lambda titles: ({t: labels(t) for t in titles}, [])):
            return scout_boards.run(self.db, ideas=lambda search: [{**board(host), 'search_url': url.format(host=host)} for host in reads], read_board=read_board,
                                    out=lambda line: None, named='md', google=lambda *a: [], families=list(asked), words=lambda db, country, families: asked)

    def test_a_count_read_from_the_boards_list_is_marked_listed_and_published(self):
        """13 Nov 2026 (bp, owner via sa): airlinejobs.com es was served 'right 53, measured' for electricians = the airline's whole Spanish list; a count from a list says so."""
        jobs = [job('Chisinau', f'Cook {n}') for n in range(4)]
        got = self.by_cells({'a.md': (jobs, 'ok', None)}, lambda title: ['kitchen'], {'kitchen': ['cook'], 'nursing_care': ['nurse']}, searched=[], url='https://{host}/jobs')
        self.assertEqual(got[0]['listed_families'], ['kitchen', 'nursing_care'])
        self.assertEqual(scout_boards.facts(self.db)[0]['listed_families'], ['kitchen', 'nursing_care'], 'the publish sends the mark')

    def test_a_count_from_a_role_search_that_ran_is_not_marked_listed(self):
        jobs = [job('Chisinau', f'Cook {n}') for n in range(4)]
        got = self.by_cells({'a.md': (jobs, 'ok', None)}, lambda title: ['kitchen'], {'kitchen': ['cook']}, searched=['cook'])
        self.assertEqual(got[0]['family_jobs'], {'kitchen': 4})
        self.assertNotIn('listed_families', got[0])
        self.assertNotIn('listed_families', scout_boards.facts(self.db)[0])

    def test_a_later_search_drops_the_mark_of_its_family_and_an_unmeasured_family_keeps_it(self):
        jobs = [job('Chisinau', f'T{n}') for n in range(5)]
        self.by_cells({'a.md': (jobs, 'ok', None)}, lambda title: ['data_ai'], {'data_ai': ['data'], 'graphic_design': ['design']}, searched=[], url='https://{host}/jobs')
        self.assertEqual(scout_boards.facts(self.db)[0]['listed_families'], ['data_ai', 'graphic_design'])
        self.by_cells({'a.md': (jobs, 'ok', None)}, lambda title: ['data_ai'], {'data_ai': ['data']}, searched=['data'])
        got = scout_boards.facts(self.db)[0]
        self.assertEqual(got['family_jobs'], {'data_ai': 5, 'graphic_design': 0}, 'the searched count replaced the listed one')
        self.assertEqual(got['listed_families'], ['graphic_design'], 'data_ai was searched now; graphic_design keeps its list mark')

    def test_a_memory_without_the_listed_column_loads_and_publishes_as_before(self):
        self.db.execute('CREATE TABLE scout_board_facts (host TEXT NOT NULL, country TEXT NOT NULL, url TEXT NOT NULL, families TEXT NOT NULL, '
                        'local_jobs INTEGER NOT NULL, read_at TEXT NOT NULL, PRIMARY KEY (host, country))')
        self.db.execute("INSERT INTO scout_board_facts VALUES ('old.md', 'md', 'https://old.md/?q={role}', 'software_dev', 5, '2026-11-13')")
        got = scout_boards.facts(self.db, today=date(2026, 11, 13))
        self.assertEqual([(f['host'], f['families']) for f in got], [('old.md', ['software_dev'])])
        self.assertNotIn('listed_families', got[0])

    def test_the_lane_merge_and_the_carry_over_keep_the_listed_mark(self):
        import tempfile
        from pathlib import Path
        from src import scout_board_lanes
        jobs = [job('Chisinau', f'Cook {n}') for n in range(4)]
        self.by_cells({'a.md': (jobs, 'ok', None)}, lambda title: ['kitchen'], {'kitchen': ['cook']}, searched=[], url='https://{host}/jobs')
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / 'lane.sqlite')
            with sqlite3.connect(path) as copy:
                self.db.backup(copy)
            merged = sqlite3.connect(':memory:')
            scout_board_lanes.merge(merged, path, 'md')
            self.assertEqual(scout_boards.facts(merged)[0]['listed_families'], ['kitchen'], 'the lane merge keeps it')
            fresh = sqlite3.connect(':memory:')
            scout_board_cells.seed(fresh, path, out=lambda line: None)
            self.assertEqual(scout_boards.facts(fresh)[0]['listed_families'], ['kitchen'], 'the carry-over copy keeps it')
