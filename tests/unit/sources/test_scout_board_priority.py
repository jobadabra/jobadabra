"""The order board discovery fills cells in (src/scout_board_priority.py): the lab's cells, the b and c profiles' pairs derived from their role titles, the pairs installs
really searched, then every country for the most searched fields. 13 Nov 2026, owner via sa: "Searched pairs first (Recommended)". Fake reads only: no network, no AI."""
import json
import shutil
import sqlite3
import tempfile
import unittest
from collections import Counter
from pathlib import Path

from src import scout_board_cells as cells, scout_board_priority as priority, scout_cells

TITLES = {'Electrician': 'electrical_mechanical', 'Truck Driver (Class CE)': 'driving_delivery', 'Data Analyst': 'data_ai', 'Marketing Manager': 'marketing_social'}


def families(texts):   # the pool's AI, stood in: role titles -> their families
    return [TITLES[text] for text in texts if text in TITLES]


def person(name, title, country):
    return {'id': name, 'family': 'x', 'title': title, 'city': 'c', 'country': country, 'language': 'l'}


class Profiles(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.folder, ignore_errors=True)
        self.path = self.folder / 'profiles.json'

    def write(self, *people):
        self.path.write_text(json.dumps({'profiles': list(people)}))

    def test_the_b_and_c_profiles_give_their_pair_from_the_role_title_and_the_country_name(self):
        self.write(person('c04', 'Electrician', 'Spain'), person('b01', 'Truck Driver (Class CE)', 'Bulgaria'), person('c04', 'Electrician', 'Spain'))
        self.assertEqual(priority.profile_pairs(self.path, families), [('es', 'electrical_mechanical'), ('bg', 'driving_delivery')], 'in the file\'s order, each pair once')

    def test_profiles_added_on_13_nov_2026_are_held_out(self):
        self.write(person('c04', 'Electrician', 'Spain'), person('d01', 'Data Analyst', 'Germany'), person('d05', 'Data Analyst', 'Switzerland'), person('p3', 'Data Analyst', 'Germany'))
        self.assertEqual(priority.profile_pairs(self.path, families), [('es', 'electrical_mechanical')])

    def test_a_country_or_title_no_list_knows_is_left_out_and_a_missing_file_gives_none(self):
        self.write(person('b02', 'Electrician', 'Atlantis'), person('b03', 'Wizard', 'Spain'), person('b04', 'Data Analyst', 'Germany'))
        self.assertEqual(priority.profile_pairs(self.path, families), [('de', 'data_ai')])
        self.assertEqual(priority.profile_pairs(self.folder / 'none.json', families), [])


class Order(unittest.TestCase):
    def cell(self, family, country, installs, **more):
        return {'family': family, 'country': country, 'installs': installs, 'in_places': 5, 'fit70': 0, **more}

    def test_installs_pairs_count_and_the_scouts_own_cells_do_not(self):
        facts = {'board': {'a.example': {'relevant': [self.cell('data_ai', 'de', 3), self.cell('data_ai', 'de', 1, right=7), self.cell('teaching', 'es', 1, measured=True), self.cell('teaching', 'xx', 2)]},
                           'b.example': {'relevant': [self.cell('data_ai', 'de', 2), self.cell('nonsense', 'de', 9)]}}}
        self.assertEqual(priority.searched_pairs(facts), Counter({('de', 'data_ai'): 5}))
        self.assertEqual(priority.searched_pairs(None), Counter())

    def test_the_order_is_the_labs_cells_then_the_profiles_then_installs_pairs_then_every_country_for_the_most_searched_field(self):
        demand = Counter({('pt', 'graphic_design'): 4, ('de', 'data_ai'): 9, ('es', 'data_ai'): 9})
        got = priority.order(named=[('sk', 'nursing_care')], profiles=[('es', 'electrical_mechanical'), ('de', 'data_ai')], demand=demand)
        self.assertEqual(got[:5], [('sk', 'nursing_care'), ('es', 'electrical_mechanical'), ('de', 'data_ai'), ('es', 'data_ai'), ('pt', 'graphic_design')],
                         'lab, profiles, then installs pairs: the most installs first, ties by country')
        wide = got[5:]
        self.assertEqual(len(got), len(set(got)), 'each cell once')
        left = len(scout_cells.EUROPE) - 2   # data_ai in de and es is already placed by the profiles and installs pairs
        self.assertEqual({family for _, family in wide[:left]}, {'data_ai'}, 'every other country for the most searched field (9 + 9 installs + one profile) first')
        self.assertEqual(list(dict.fromkeys(family for _, family in wide)), ['data_ai', 'graphic_design', 'electrical_mechanical'], 'then the next fields by how many searched them')

    def test_priority_reads_the_profiles_and_the_index(self):
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder, ignore_errors=True)
        path = folder / 'p.json'
        path.write_text(json.dumps({'profiles': [person('c04', 'Electrician', 'Spain')]}))
        got = priority.priority(named=[('sk', 'nursing_care')], path=path, families=families, facts={'board': {'a.example': {'relevant': [self.cell('data_ai', 'de', 3)]}}})
        self.assertEqual(got[:3], [('sk', 'nursing_care'), ('es', 'electrical_mechanical'), ('de', 'data_ai')])


class PickUsesTheOrder(unittest.TestCase):
    def test_among_cells_with_the_same_number_of_proven_boards_the_earlier_in_the_list_goes_first_and_fewer_proven_boards_always_first(self):
        db = sqlite3.connect(':memory:')
        today = cells.date(2026, 11, 13)
        first = [('pt', 'graphic_design'), ('es', 'electrical_mechanical'), ('at', 'b2b_sales')]
        country, picked, _ = cells.pick(db, today, priority=first)
        self.assertEqual((country, picked[0]), ('pt', 'graphic_design'), 'the first cell of the list, not the first of the country list')
        country, picked, _ = cells.pick(db, today, priority=list(reversed(first)))
        self.assertEqual((country, picked[0]), ('at', 'b2b_sales'), 'the order of the list decides, not membership')


if __name__ == '__main__':
    unittest.main()
