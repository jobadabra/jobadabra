"""Board discovery in several lanes at once (src/scout_board_lanes.py): one round reads different countries side by side, each lane in its own copy
of the memory, and only a lane's own country comes back into the one memory.
13 Nov 2026, owner: "Maybe we just need to run the Board discovery" "many times in parallel": two runs at once would have saved over each other's
memory (one file). Fake reads only: no network, no AI."""
import json
import os
import shutil
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import date, timedelta
from unittest import mock

from src import pool_tags, scout, scout_board_cells as cells, scout_board_lanes as lanes, scout_boards, scout_cells

TODAY = date(2026, 11, 13)
FAMILIES = list(pool_tags.FAMILIES)


def fact(db, host, country, families, read_at=TODAY, jobs=5, right=scout_boards.MIN_RIGHT):
    """A kept fact: each family has `right` jobs (None: a fact kept before 13 Nov 2026, with no count per family)."""
    scout_boards.ensure(db)
    db.execute('INSERT OR REPLACE INTO scout_board_facts (host, country, url, families, local_jobs, read_at, family_jobs) VALUES (?, ?, ?, ?, ?, ?, ?)',
               (host, country, f'https://{host}/jobs?q={{role}}', ','.join(families), jobs, read_at.isoformat(),
                None if right is None else json.dumps({family: right for family in families})))


def cover(db, countries):
    """Every family of these countries at its target: they leave the queue."""
    for country in countries:
        for n in range(cells.TARGET):
            fact(db, f'{country}{n}.example', country, FAMILIES)


class Countries(unittest.TestCase):
    def setUp(self):
        patch = mock.patch('src.scout_board_priority.priority', lambda named=(), **kwargs: list(named))   # the lab's cells alone: no profile titles asked of the AI (13 Nov 2026)
        patch.start()
        self.addCleanup(patch.stop)
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)

    def test_a_round_s_lanes_are_different_countries_in_the_order_single_passes_would_take_them(self):
        cover(self.db, [c for c in scout_cells.EUROPE if c not in ('sk', 'nl', 'si')])
        first = cells.pick(self.db, TODAY)[0]
        round_ = lanes.countries(self.db, 3, TODAY)
        self.assertEqual(round_[0], first, 'the first lane is the country a single pass would read')
        self.assertEqual(sorted(round_), ['nl', 'si', 'sk'], 'no country twice: two lanes on one country would both write its cells')

    def test_fewer_countries_than_lanes_gives_fewer_lanes_and_none_when_every_cell_rests(self):
        cover(self.db, [c for c in scout_cells.EUROPE if c != 'sk'])
        self.assertEqual(lanes.countries(self.db, 4, TODAY), ['sk'])
        cover(self.db, ['sk'])
        self.assertEqual(lanes.countries(self.db, 4, TODAY), [])

    def test_a_lane_reads_its_own_country_even_when_another_is_weaker_or_due_for_a_refresh(self):
        cover(self.db, [c for c in scout_cells.EUROPE if c not in ('sk', 'nl')])
        fact(self.db, 'nl-one.example', 'nl', FAMILIES)   # nl has a board in every family; sk has none and would go first
        fact(self.db, 'old.example', 'ee', ['kitchen'], TODAY - timedelta(days=cells.REFRESH_DAYS + 1))   # ee has a fact due: first in a single pass
        self.assertEqual(cells.pick(self.db, TODAY)[0], 'ee')
        country, families, again = cells.pick(self.db, TODAY, only={'nl'})
        self.assertEqual((country, again), ('nl', []))
        self.assertEqual(families, FAMILIES[:cells.PER_RUN])
        self.assertIsNone(cells.pick(self.db, TODAY, only={'de'}), 'a lane whose country has nothing open reads nothing, never another lane\'s country')

    def test_a_lane_never_reads_cells_or_a_country_named_for_another_lane(self):
        self.assertIsNone(cells.pick(self.db, TODAY, named=[('nl', FAMILIES[0])], only={'sk'}), 'its merge would drop them: nothing is read')
        self.assertEqual(cells.pick(self.db, TODAY, named=[('nl', FAMILIES[0]), ('sk', FAMILIES[1])], only={'sk'})[:2], ('sk', [FAMILIES[1]]))
        with tempfile.TemporaryDirectory() as folder, mock.patch.dict(os.environ, {lanes.ONLY_ENV: 'sk', 'SCOUT_BOARD_COUNTRY': 'nl'}), \
                mock.patch.object(scout_boards, 'run') as run, self.assertRaises(SystemExit):
            scout.board_pass(os.path.join(folder, 'boards.sqlite'))
        run.assert_not_called()

    def test_the_lane_s_country_comes_from_the_environment_and_an_unknown_one_stops_the_pass(self):
        self.assertIsNone(lanes.only(''))
        self.assertEqual(lanes.only('Slovakia'), {'sk'})
        with self.assertRaises(ValueError):
            lanes.only('Atlantis')


class Merge(unittest.TestCase):
    def setUp(self):
        patch = mock.patch('src.scout_board_priority.priority', lambda named=(), **kwargs: list(named))   # the lab's cells alone: no profile titles asked of the AI (13 Nov 2026)
        patch.start()
        self.addCleanup(patch.stop)
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.path = os.path.join(self.dir, 'boards.sqlite')
        with closing(sqlite3.connect(self.path)) as db:
            cover(db, [c for c in scout_cells.EUROPE if c not in ('sk', 'nl')])
            scout_cells._set(db, cells.CELLS, {'de|kitchen': {'tries': 2, 'until': '2026-11-20', 'asked': '2026-11-12'}})
            db.commit()

    def lane(self, country, kept):
        """One lane's pass on its own copy of the memory: discovery with a fake board pass that keeps `kept`. Returns the copy's path."""
        copy = os.path.join(self.dir, f'lane-{country}.sqlite')
        shutil.copyfile(self.path, copy)

        def run(db, named=None, families=None, **_):
            for host, found in kept:
                fact(db, host, named, found)
            db.execute('INSERT OR REPLACE INTO scout_browser_final (host, why, at) VALUES (?, ?, ?)', (f'refused-{named}.example', 'refused', 'now'))
            scout_cells._set(db, cells.WORDS, {**scout_cells._meta(db, cells.WORDS, {}), f'{named}|{families[0]}': {'words': ['x'], 'at': TODAY.isoformat()}})
            return [{'host': host, 'families': found} for host, found in kept]
        with closing(sqlite3.connect(copy)) as db, mock.patch.dict(os.environ, {lanes.ONLY_ENV: country, 'SCOUT_BOARD_SEED_DB': '', 'SCOUT_BOARD_CELLS': ''}):
            scout.discover(db, run=run, out=lambda line: None, today=TODAY)
        return copy

    def test_two_lanes_results_both_reach_the_memory(self):
        sk, nl = self.lane('sk', [('sk-jobs.example', FAMILIES[:2])]), self.lane('nl', [])
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(lanes.merge(db, sk, 'sk'), 1)
            self.assertEqual(lanes.merge(db, nl, 'nl'), 0)
            strength, memory = cells.strength(db, TODAY), scout_cells._meta(db, cells.CELLS, {})
            self.assertEqual(strength[('sk', FAMILIES[0])], 1, "the first lane's board is kept")
            self.assertEqual(memory[f'sk|{FAMILIES[2]}']['tries'], 1, "the first lane's empty cell rests")
            self.assertEqual(memory[f'nl|{FAMILIES[0]}']['tries'], 1, "the second lane's rest did not write over the first lane's")
            self.assertEqual(memory['de|kitchen']['tries'], 2, 'a country no lane read keeps its memory')
            self.assertEqual(sorted(scout_cells._meta(db, cells.WORDS, {})), [f'nl|{FAMILIES[0]}', f'sk|{FAMILIES[0]}'])
            stops = {row[0] for row in db.execute('SELECT host FROM scout_browser_final')}
            self.assertEqual(stops, {'refused-sk.example', 'refused-nl.example'}, 'a stop is final: every lane\'s stops are kept')

    def test_only_the_lane_s_own_country_is_copied(self):
        sk = self.lane('sk', [('sk-jobs.example', FAMILIES[:1])])
        with closing(sqlite3.connect(sk)) as db:   # a lane's copy holds every other country as it was at the start: stale by the time it comes back
            db.execute("DELETE FROM scout_board_facts WHERE country = 'de'")
            scout_cells._set(db, cells.CELLS, {**scout_cells._meta(db, cells.CELLS, {}), 'de|kitchen': {'tries': 0, 'until': '', 'asked': ''}})
            db.commit()
        with closing(sqlite3.connect(self.path)) as db:
            lanes.merge(db, sk, 'sk')
            self.assertEqual(cells.strength(db, TODAY)[('de', FAMILIES[0])], cells.TARGET)
            self.assertEqual(scout_cells._meta(db, cells.CELLS, {})['de|kitchen']['tries'], 2)

    def test_a_lane_that_left_no_file_changes_nothing(self):
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(lanes.merge(db, os.path.join(self.dir, 'missing.sqlite'), 'sk'), 0)
            self.assertFalse(os.path.exists(os.path.join(self.dir, 'missing.sqlite')))


if __name__ == '__main__':
    unittest.main()
