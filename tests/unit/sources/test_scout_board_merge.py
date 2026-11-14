"""Board facts live in two databases (the Scout's, jobs.sqlite, and board discovery's own, boards.sqlite, each an Actions cache); discovery merges the Scout's newer facts in at the start of EVERY pass.
14 Nov 2026, es discovery 43544069411: the airline board's es 53 (older rule) lived only in the Scout's database, discovery re-read nothing and the order fixes (#4140, #4152, #4158) never reached it.
Owner, asked via AskUserQuestion 14 Nov 2026 (relayed by sa): "Merge at every pass now, one copy next (Recommended)". The cases play the workflow's entry (scout.board_pass -> discover) over a pair of files
shaped like the restored caches; the board read and the site are fakes, nothing is published."""
import json
import os
import sqlite3
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

from src import scout, scout_board_candidates, scout_board_cells as cells, scout_board_counts, scout_boards, scout_cells, scout_core

TODAY = date(2026, 11, 14)
FAMILY = 'electrical_mechanical'


def put(path, host, country, right, age, rule=None, layout=None):
    """One fact in the database at `path`: `right` jobs of FAMILY, read `age` days ago, measured under `rule` (None: before the rules were numbered)."""
    with sqlite3.connect(path) as db:
        scout_boards.ensure(db)
        db.execute('INSERT OR REPLACE INTO scout_board_facts (host, country, url, families, local_jobs, read_at, layout, family_jobs, rule) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                   (host, country, f'https://{host}/s?q={{role}}', FAMILY, right, (TODAY - timedelta(days=age)).isoformat(), layout, json.dumps({FAMILY: right}), rule))


def row(path, host, country='es'):
    with sqlite3.connect(path) as db:
        db.row_factory = sqlite3.Row
        found = db.execute('SELECT * FROM scout_board_facts WHERE host = ? AND country = ?', (host, country)).fetchone()
        return dict(found) if found else None


class TwoDatabases(unittest.TestCase):
    def setUp(self):
        folder = tempfile.mkdtemp()
        self.addCleanup(__import__('shutil').rmtree, folder, True)
        self.scout_path, self.own_path = os.path.join(folder, 'jobs.sqlite'), os.path.join(folder, 'boards.sqlite')
        put(self.scout_path, 'small.example', 'es', 4, 9)
        put(self.own_path, 'small.example', 'es', 4, 9)
        put(self.scout_path, 'airline.example', 'es', 53, 1, layout=json.dumps({'kind': 'links', 'prefix': '/o'}))   # the Scout's own pass kept it after discovery was first seeded
        self.addCleanup(setattr, scout_core, 'CENTRAL', scout_core.CENTRAL)

    def pass_(self, reads=lambda db, **ask: []):
        """The workflow's entry, `python -m src scout --board-pass --db <discovery>`; returns the log lines and what the pass was asked to read again."""
        lines, asked = [], []

        def run(db, **ask):
            asked.extend(board['host'] for board in ask['again'])
            return reads(db, **ask)
        env = {'SCOUT_BOARD_CELLS': f'es:{FAMILY}', 'SCOUT_BOARD_SEED_DB': self.scout_path, 'SCOUT_BOARD_COUNTRY': '', 'SCOUT_BOARD_PRIORITY': '', 'SCOUT_BOARD_LANES': ''}
        with mock.patch.dict(os.environ, env), mock.patch.object(cells, 'date', mock.Mock(today=lambda: TODAY)), mock.patch.object(scout_boards, 'run', run), \
                mock.patch.object(scout_board_candidates, 'fetch', lambda out=print, **k: []), mock.patch('builtins.print', lambda *a, **k: lines.append(' '.join(map(str, a)))):
            self.assertEqual(scout.board_pass(self.own_path), 0)
        return lines, asked

    def test_a_fact_only_the_scout_holds_is_read_again_first_by_its_count(self):
        """Fails on e5c6df72: seeded once, discovery never sees the 53, so it is asked to re-read the 4 only."""
        _, asked = self.pass_()
        self.assertEqual(asked, ['airline.example', 'small.example'], 'the 53 first, then the older 4')

    def test_a_fact_newer_in_discovery_is_not_overwritten_and_the_rule_layout_and_counts_travel_with_a_merged_row(self):
        put(self.own_path, 'fresh.example', 'es', 7, 0, rule=scout_board_counts.LISTED_RULE)   # discovery read it today
        put(self.scout_path, 'fresh.example', 'es', 99, 5)   # the Scout's copy is older and bigger
        self.pass_()
        self.assertEqual(row(self.own_path, 'fresh.example')['local_jobs'], 7, 'newest read wins: discovery keeps its own')
        merged = row(self.own_path, 'airline.example')
        self.assertEqual((merged['rule'], merged['layout'], json.loads(merged['family_jobs']), merged['local_jobs']), (None, json.dumps({'kind': 'links', 'prefix': '/o'}), {FAMILY: 53}, 53))

    def test_on_the_same_day_a_layout_the_scout_dropped_beats_the_one_discovery_kept(self):
        """bl on the merge: read_at is a DATE, so two jobs that read a board the same day tie. A Scout row with no layout (dropped: it read fewer jobs than the usual read, #4139) must not lose to discovery's layout and be
        published again (discovery's copy goes last). A tie otherwise keeps discovery's row."""
        layout = json.dumps({'kind': 'links', 'prefix': '/x'})
        put(self.own_path, 'tie.example', 'es', 9, 0, layout=layout)
        put(self.scout_path, 'tie.example', 'es', 9, 0, layout=None)
        put(self.own_path, 'same.example', 'es', 9, 0, layout=layout)
        put(self.scout_path, 'same.example', 'es', 9, 0, layout=layout)
        put(self.own_path, 'plain.example', 'es', 9, 0, layout=None)
        put(self.scout_path, 'plain.example', 'es', 12, 0, layout=layout)
        self.pass_()
        self.assertIsNone(row(self.own_path, 'tie.example')['layout'], 'a drop beats a keep on a tie')
        self.assertEqual(row(self.own_path, 'same.example')['layout'], layout)
        self.assertIsNone(row(self.own_path, 'plain.example')['layout'], 'a tie where discovery has none keeps discovery row: the Scout\'s layout does not come in on a tie')

    def test_a_merged_row_is_not_counted_as_read_by_the_merge(self):
        """The merge itself (the function the pass calls first) leaves the Scout's read_at and stamps nothing: the fact is still due. (The pass that then re-reads it stamps it, as for any re-read.)"""
        with sqlite3.connect(self.own_path) as db:
            self.assertEqual(cells.seed(db, self.scout_path, out=lambda line: None), 1, 'only the airline row is new; the small one is the same read')
            self.assertEqual(row(self.own_path, 'airline.example')['read_at'], (TODAY - timedelta(days=1)).isoformat(), "the read_at stays the Scout's")
            self.assertEqual(scout_cells._meta(db, cells.REREAD, {}) or {}, {}, 'no read stamp: it was merged in, not read')
            self.assertEqual(cells.rule_line(db, TODAY), 'Board pass: facts at an older rule: 2 of 2')
            self.assertEqual(cells.seed(db, self.scout_path, out=lambda line: None), 0, 'merged again: nothing newer, nothing taken')

    def test_the_second_pass_merges_again_and_the_site_keeps_the_re_read_count_not_the_old_53(self):
        def read(db, **ask):   # the pass re-reads the airline board: 12 right jobs now, under the current rule
            scout_board_counts.keep_fact(db, {'host': 'airline.example', 'url': 'https://airline.example/s?q={role}', 'families': [FAMILY], 'local_jobs': 12,
                                              'family_jobs': {FAMILY: 12}, 'listed_families': [FAMILY]}, 'es', (TODAY - timedelta(days=30)).isoformat(), TODAY.isoformat())
            return []
        self.pass_(read)
        put(self.scout_path, 'airline.example', 'es', 53, 1)   # the Scout's own copy still holds the old count: the next pass must not bring it back over the newer read
        _, asked = self.pass_()
        self.assertEqual(row(self.own_path, 'airline.example')['local_jobs'], 12)
        self.assertEqual(asked, [], 'both were re-read by the first pass and wait REREAD_DAYS: the old 53 coming over again is not due, it is older than discovery\'s read')
        with sqlite3.connect(self.scout_path) as scout_db:
            published = scout_boards.facts(scout_db, TODAY) + cells.facts_beside(self.own_path, TODAY)
        last = {(fact['host'], fact['country']): fact for fact in published}   # the site keeps the last fact per host and country, discovery's copy last
        self.assertEqual(last[('airline.example', 'es')]['local_jobs'], 12, 'the union published no longer ends on the old 53')


if __name__ == '__main__':
    unittest.main()
