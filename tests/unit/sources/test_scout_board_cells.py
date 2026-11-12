"""Board discovery's cells (src/scout_board_cells.py): the board pass reads the (country, role family) cells with the fewest measured boards first,
rests a cell that found nothing, and reads a fact again before the site drops it.
12 Nov 2026, owner, asked via AskUserQuestion: "Separate lab workflow (Recommended)", "Every 2 h (Recommended)": the pass picked the country with the
fewest employers, so countries with many employers and no measured board never had a turn. Fake reads only: no network, no AI."""
import os
import shutil
import sqlite3
import tempfile
import unittest
from datetime import date, timedelta
from unittest import mock

from src import pool_tags, scout, scout_board_cells as cells, scout_boards, scout_cells

TODAY = date(2026, 11, 12)
FAMILIES = list(pool_tags.FAMILIES)


def fact(db, host, country, families, read_at=TODAY, jobs=5):
    scout_boards.ensure(db)
    db.execute('INSERT OR REPLACE INTO scout_board_facts (host, country, url, families, local_jobs, read_at) VALUES (?, ?, ?, ?, ?, ?)',
               (host, country, f'https://{host}/jobs?q={{role}}', ','.join(families), jobs, read_at.isoformat()))


def cover(db, countries, read_at=TODAY):
    """Every family of these countries at its target: they leave the queue."""
    for country in countries:
        for n in range(cells.TARGET):
            fact(db, f'{country}{n}.example', country, FAMILIES, read_at)


class Pick(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')

    def test_a_country_with_many_employers_and_no_board_gets_its_turn(self):
        scout_cells.keep(self.db, [{'countries': ['gb']} for _ in range(500)])   # the old pass read the thinnest country by employers: never this one
        cover(self.db, [c for c in scout_cells.EUROPE if c != 'gb'])
        country, families, again = cells.pick(self.db, TODAY)
        self.assertEqual((country, families, again), ('gb', FAMILIES[:cells.PER_RUN], []))

    def test_the_cells_with_fewest_boards_go_first_and_priority_cells_first_among_equals(self):
        cover(self.db, [c for c in scout_cells.EUROPE if c not in ('nl', 'cz')])
        for family in FAMILIES:
            if family != 'teaching':
                fact(self.db, f'nl-{family}.example', 'nl', [family])   # nl: one board in every family but teaching
        self.assertEqual(cells.pick(self.db, TODAY)[0], 'cz', 'cz has no board at all')
        country, families, _ = cells.pick(self.db, TODAY, priority=[('nl', 'teaching')])
        self.assertEqual(country, 'nl', "a priority cell goes first among cells with as few boards (none)")
        self.assertEqual(families[0], 'teaching')

    def test_an_empty_cell_rests_longer_each_time_and_a_kept_board_clears_it(self):
        cover(self.db, [c for c in scout_cells.EUROPE if c != 'si'])
        country, families, _ = cells.pick(self.db, TODAY)
        cells.record(self.db, country, families, [], TODAY)
        memory = scout_cells._meta(self.db, cells.CELLS, {})
        self.assertEqual(memory[f'si|{FAMILIES[0]}']['until'], (TODAY + timedelta(days=cells.REST_DAYS[0])).isoformat())
        self.assertEqual(cells.pick(self.db, TODAY)[1], FAMILIES[3:6], 'resting cells wait; the next families get the turn')
        self.assertFalse(cells._resting(scout_cells._meta(self.db, cells.CELLS, {}), ('si', FAMILIES[0]), TODAY + timedelta(days=1)),
                         'after its rest the cell is back in the queue, behind the cells never asked')
        cells.record(self.db, 'si', [FAMILIES[0]], [], TODAY)
        self.assertEqual(scout_cells._meta(self.db, cells.CELLS, {})[f'si|{FAMILIES[0]}']['until'],
                         (TODAY + timedelta(days=cells.REST_DAYS[1])).isoformat(), 'the second empty try rests longer')
        self.assertEqual(memory[f'si|{FAMILIES[0]}']['tries'], 1)
        cells.record(self.db, 'si', [FAMILIES[0]], [{'families': [FAMILIES[0]]}], TODAY)
        self.assertEqual(scout_cells._meta(self.db, cells.CELLS, {})[f'si|{FAMILIES[0]}'], {'tries': 0, 'until': '', 'asked': TODAY.isoformat()})

    def test_nothing_to_read_when_every_open_cell_rests(self):
        cover(self.db, scout_cells.EUROPE)
        self.assertIsNone(cells.pick(self.db, TODAY))

    def test_a_fact_due_for_a_refresh_is_read_again_first_and_then_waits(self):
        cover(self.db, scout_cells.EUROPE)
        fact(self.db, 'old.example', 'ee', ['kitchen'], TODAY - timedelta(days=cells.REFRESH_DAYS + 1))
        fact(self.db, 'gone.example', 'lv', ['kitchen'], TODAY - timedelta(days=scout_boards.FACT_DAYS + 1))
        country, families, again = cells.pick(self.db, TODAY)
        self.assertEqual((country, [board['host'] for board in again]), ('ee', ['old.example']), 'a dropped fact is not read again')
        self.assertEqual(again[0]['search_url'], 'https://old.example/jobs?q={role}')
        cells.record(self.db, country, families, [], TODAY, again=again)
        self.assertIsNone(cells.pick(self.db, TODAY), 'read again and still under the floor: it waits REREAD_DAYS, never every run')

    def test_cells_named_by_hand(self):
        self.assertEqual(cells.parse('sk:nursing_care, Slovenia:construction, xx:kitchen, sk:not_a_family'), [('sk', 'nursing_care'), ('si', 'construction')])
        self.assertEqual(cells.pick(self.db, TODAY, named=cells.parse('sk:nursing_care,si:kitchen,sk:teaching'))[:2], ('sk', ['nursing_care', 'teaching']))


class Discover(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        cover(self.db, [c for c in scout_cells.EUROPE if c != 'sk'])

    def test_the_board_pass_asks_for_the_cells_families_and_reads_facts_again_first(self):
        fact(self.db, 'again.example', 'sk', ['nursing_care'], TODAY - timedelta(days=cells.REFRESH_DAYS + 2))
        asked, read, out = [], [], []
        google = mock.Mock(return_value=[{'name': 'g', 'host': 'g.example', 'search_url': 'https://g.example/x', 'countries': ['Slovakia'],
                                          'kinds': [FAMILIES[0]], 'source_kind': 'sector'}])

        def run(db, **options):
            return scout_boards.run(db, ideas=lambda search: asked.append(search) or [], google=google, out=out.append,
                                    read_board=lambda board, *rest: read.append(board['host']) or ([], 'ok', None), **options)
        with mock.patch.dict('os.environ', {'SCOUT_BOARD_CELLS': '', 'SCOUT_BOARD_PRIORITY': ''}):
            scout.discover(self.db, run=lambda db, **options: run(db, **{k: v for k, v in options.items() if k != 'out'}), out=out.append, today=TODAY)
        words = pool_tags.FAMILIES[FAMILIES[0]].split(',')[0].strip()
        self.assertIn(words, asked[0]['role_keywords'], "the AI is asked for the families' own words")
        self.assertEqual(asked[0]['locations']['country_wide'], ['Slovakia'])
        self.assertEqual(google.call_args.args[2], FAMILIES[:cells.PER_RUN])
        self.assertEqual(read, ['again.example', 'g.example'], 'the fact due again first, then Google, then the AI')
        self.assertTrue(any(line.startswith(f"Board pass: Slovakia ({', '.join(FAMILIES[:cells.PER_RUN])})") for line in out), out)
        self.assertTrue(out[-1].startswith('Board cells: '), out[-1])
        self.assertEqual(scout_cells._meta(self.db, scout_boards.ASKED_KINDS, None), None, "cells keep their own turns: the kinds' turn list is untouched")


class OwnDatabase(unittest.TestCase):
    """Discovery keeps its own database so it never saves over the Scout's memory; it starts once from the Scout's facts, and the Scout publishes both."""
    def setUp(self):
        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder, True)
        self.scout_path, self.own_path = os.path.join(folder, 'jobs.sqlite'), os.path.join(folder, 'boards.sqlite')
        with sqlite3.connect(self.scout_path) as scout_db:
            fact(scout_db, 'a.example', 'fr', ['kitchen'])
            scout_cells._set(scout_db, 'serp_waiting', {'ee': [{'host': 'wait.example'}]})
            scout_db.commit()

    def test_it_starts_from_the_scout_s_facts_once(self):
        own = sqlite3.connect(self.own_path)
        self.assertEqual(cells.seed(own, self.scout_path, out=lambda line: None), 1)
        self.assertEqual(cells.strength(own, TODAY)[('fr', 'kitchen')], 1, 'a covered cell is not read first again')
        self.assertEqual(scout_cells._meta(own, 'serp_waiting', {}), {'ee': [{'host': 'wait.example'}]}, "Google's sites waiting to be judged come along")
        fact(own, 'b.example', 'de', ['kitchen'])
        own.commit()
        self.assertEqual(cells.seed(own, self.scout_path, out=lambda line: None), 0, 'only while it holds no fact')
        self.assertEqual(cells.seed(sqlite3.connect(':memory:'), os.path.join(os.path.dirname(self.own_path), 'none.sqlite'), out=lambda line: None), 0)

    def test_the_scout_publishes_the_discovery_s_facts_too(self):
        own = sqlite3.connect(self.own_path)
        fact(own, 'b.example', 'de', ['kitchen'])
        own.commit()
        self.assertEqual([item['host'] for item in cells.facts_beside(self.own_path, TODAY)], ['b.example'])
        self.assertEqual(cells.facts_beside(''), [])


if __name__ == '__main__':
    unittest.main()
