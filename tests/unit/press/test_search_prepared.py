"""What a search asks before it reads anything is asked when the strategy is saved; the search that follows asks none of it again.
Why (sa, 12 Nov 2026, recorded first searches of 17 test people): the employers of a person's kind were known 22-113 s into a first search and 1-2 s
into the second; one person read 0 of 90 employer sites in the first and 89 of 90 in the second (src/search_prepared.py).
Offline: a fake model that counts its calls, a temp answers database, example words only."""
import json
import pathlib
import sqlite3
import tempfile
import threading
import unittest
from types import SimpleNamespace
from unittest import mock

from src import contribute, employer_index, paths, places, role_kinds, search_prepared
from src.ai import cost, decide, engine, meanings_pack

SEARCH = {'role_keywords': ['example role'], 'locations': {'top_tier': ['Example town'], 'country_wide': [], 'abroad': []}}


class Model:
    """Answers every item with the first allowed answer and counts the calls."""

    def __init__(self):
        self.calls, self.messages = 0, SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.calls += 1
        text = kwargs['messages'][0]['content']
        allowed = text.split('Allowed answers: ', 1)[1].split('\n', 1)[0].split(', ')
        results = {str(i): allowed[0] for i in range(text.count('### Item '))}
        return SimpleNamespace(usage=None, stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(results))])


class PreparedAtSave(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.model, self.placed = Model(), []
        for patch in (mock.patch.object(decide, '_db', lambda: sqlite3.connect(self.tmp / 'answers.db')), mock.patch.object(paths, 'DATA', self.tmp),
                      mock.patch.object(engine, 'ready', return_value=True), mock.patch.object(engine, 'client', lambda **kw: self.model),
                      mock.patch.object(engine, 'structured', lambda *a, **k: {}), mock.patch.object(cost, 'side', lambda *a, **k: None),
                      mock.patch.object(meanings_pack, 'every', lambda *a, **k: []), mock.patch.object(meanings_pack, 'queue', lambda *a, **k: None),
                      mock.patch.object(contribute, 'load_search_config', lambda matching=True: SEARCH),
                      mock.patch.object(paths, 'load_search_config', lambda matching=True: SEARCH),
                      mock.patch.object(places, 'refresh_quietly', lambda: self.placed.append(1)), mock.patch('builtins.print')):
            patch.start()
            self.addCleanup(patch.stop)
        decide.reset_run()
        self.addCleanup(decide.reset_run)

    def search_start(self):
        """What a search's first seconds ask (src/daily_helpers.py: the employers of this person's kind)."""
        employer_index.me_now()
        role_kinds.of_search(SEARCH)

    def test_a_search_after_the_save_asks_nothing_the_save_already_asked(self):
        self.assertEqual(search_prepared.prepare(out=lambda line: None), ['labels', 'kinds'])
        asked = self.model.calls
        self.assertGreater(asked, 0, 'positive control: the save asked the model about the roles and places')
        self.assertEqual(self.placed, [1], 'and worked out the place words')
        self.search_start()
        self.assertEqual(self.model.calls, asked, 'the search reads the kept answers: no call inside its 3 minutes')

    def test_without_the_save_the_search_asks_them_itself(self):
        """The fallback stays: an old install, or a save made without AI."""
        self.search_start()
        self.assertGreater(self.model.calls, 0)

    def test_a_part_that_fails_leaves_the_others_and_never_raises(self):
        with mock.patch.object(employer_index, 'me_now', side_effect=RuntimeError('example')):
            self.assertEqual(search_prepared.prepare(out=lambda line: None), ['kinds'])

    def test_a_search_started_during_the_preparation_waits_for_it(self):
        holding, release, order = threading.Event(), threading.Event(), []

        def hold():
            with paths.run_lock(name=search_prepared.LOCK):
                holding.set()
                release.wait(timeout=30)   # a hang guard, never the clock the test depends on
                order.append('prepared')

        thread = threading.Thread(target=hold)
        thread.start()
        self.addCleanup(thread.join)
        self.assertTrue(holding.wait(timeout=30))
        with mock.patch.object(paths.time, 'sleep', lambda seconds: release.set() or thread.join()):   # the search's first look finds it held; its wait lets the preparation end
            search_prepared.wait()
        order.append('search')
        self.assertEqual(order, ['prepared', 'search'])


if __name__ == '__main__':
    unittest.main()
