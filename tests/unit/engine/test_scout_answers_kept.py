"""An employer keeps every AI answer when a re-read can't ask: countries and regions, like the kind mix (#3310), and the published index restores them all.
Why (6 Nov 2026, owner: "coverage is still empty"): 3,614 feeds lost their countries after 2 Nov, as a place the capped AI did not answer dropped out of a rebuilt entry."""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import geo, role_kinds, scout, scout_carry, scout_core, store as job_store
from src.ai import decide

ANSWERS = {'pool-country': 'fr', 'job-region': 'europe'}   # what the AI says about the one place below
FIELDS = {'countries': ['fr'], 'regions': ['europe']}      # the entry fields those answers make


def job():
    return [{'id': '1', 'title': 'Engineer', 'location': 'Lyon', 'url': 'u', 'date_posted': '2099-01-01', 'description': '', 'remote': False, 'salary': ''}]


class AnswersKeptTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.db = job_store.connect(Path(tmp.name) / 'j.sqlite').__enter__()
        self.db.executescript(scout.TABLES)
        self.starter = [{'company': f'Co {i}', 'ats': 'lever', 'slug': f'co{i}'} for i in range(5)]   # fictional
        self.out = io.StringIO()

    def read(self, today, answer, starter=None):
        """One run. answer: 'yes' (the AI names the place), 'none' (it answers: none of these), 'capped' (it is not asked: busy or past the cap)."""
        def judged(topic, items, answers, instructions, **kwargs):
            if answer == 'capped' or topic not in ANSWERS:
                return None
            return {key: ANSWERS[topic] if answer == 'yes' else 'none' for key in items}
        with mock.patch.object(decide, 'decide', judged), mock.patch('src.ai.meanings_pack.every', lambda *a, **k: []), mock.patch.object(scout_core, 'CENTRAL', True), \
                mock.patch.object(role_kinds, 'judged', lambda texts, topic='role-kind': {}), mock.patch.object(geo, 'resolve', lambda strings, **_: {}), \
                contextlib.redirect_stdout(self.out):
            return scout.build_index(self.db, self.starter if starter is None else starter, lambda s, slug: job(), today=today, carry=True)[0]

    def test_a_re_read_the_ai_could_not_answer_keeps_every_answer(self):
        for field, value in FIELDS.items():
            with self.subTest(field=field):
                self.assertEqual([f.get(field) for f in self.read('2026-11-04', 'yes')], [value] * 5)
                self.assertEqual([f.get(field) for f in self.read('2026-11-05', 'capped')], [value] * 5, 'the owner\'s scenario: kept')
                self.assertEqual([f.get(field) for f in self.read('2026-11-06', 'capped')], [value] * 5, 'and the run after it')

    def test_a_real_answer_of_none_still_empties_it(self):
        self.read('2026-11-04', 'yes')
        for field in FIELDS:
            with self.subTest(field=field):
                self.assertEqual([f.get(field) or [] for f in self.read('2026-11-05', 'none')], [[]] * 5)

    def test_an_empty_cache_gets_every_answer_back_from_the_published_index(self):
        published = [{'company': f'Co co{i}', 'ats': 'lever', 'slug': f'co{i}', 'quality': 40, 'checked': '2026-11-01', 'places': ['Lyon'], **FIELDS} for i in range(5)]
        scout_carry.seed(self.db, 'https://index.example/api/index', 'key', get=lambda request: {'feeds': published})
        feeds = self.read('2026-11-02', 'capped', starter=[])
        for field, value in FIELDS.items():
            with self.subTest(field=field):
                self.assertEqual([f.get(field) for f in feeds], [value] * 5)

    def test_a_stored_entry_that_lost_an_answer_takes_it_from_the_published_index(self):
        self.read('2026-11-04', 'capped')   # stored with no answers at all
        published = [{'company': f'Co {i}', 'ats': 'lever', 'slug': f'co{i}', 'checked': '2026-11-01', **FIELDS} for i in range(5)]
        with contextlib.redirect_stdout(self.out):
            scout_carry.seed(self.db, 'https://index.example/api/index', 'key', get=lambda request: {'feeds': published})
        stored = [json.loads(r[0]) for r in self.db.execute('SELECT entry FROM feed_entries')]
        for field, value in FIELDS.items():
            with self.subTest(field=field):
                self.assertEqual([e.get(field) for e in stored], [value] * 5)
        self.assertIn('0 mixes, 5 place answers', self.out.getvalue(), 'place answers are not counted as mixes')

    def test_the_published_index_never_undoes_an_answer_of_none(self):
        self.read('2026-11-04', 'yes')
        self.read('2026-11-05', 'none')   # stored empty, and not published yet (a stopped run)
        self.read('2026-11-06', 'none')   # and again: already empty before this read (Gitar on #3324)
        published = [{'company': f'Co {i}', 'ats': 'lever', 'slug': f'co{i}', 'checked': '2026-11-04', **FIELDS} for i in range(5)]
        scout_carry.seed(self.db, 'https://index.example/api/index', 'key', get=lambda request: {'feeds': published})
        stored = [json.loads(r[0]) for r in self.db.execute('SELECT entry FROM feed_entries')]
        for field in FIELDS:
            with self.subTest(field=field):
                self.assertEqual([e.get(field) or [] for e in stored], [[]] * 5)

    def test_a_feed_this_run_did_not_read_is_not_counted_as_kept(self):
        self.read('2026-11-04', 'yes')
        self.read('2026-11-05', 'capped')   # stored with its marks: kept
        carried = scout_carry.carried(self.db, [('lever', f'co{i}') for i in range(5)], '2026-11-06')
        self.assertEqual([f.get('countries') for f in carried], [['fr']] * 5)
        self.assertIn('countries 5 (0 from an earlier answer, 0 new, 0 dropped)', scout_carry.answers_line(carried))

    def test_the_run_log_says_per_field_what_was_kept_and_dropped(self):
        self.read('2026-11-04', 'yes')
        feeds = self.read('2026-11-05', 'capped')
        line = scout_carry.answers_line(feeds)
        self.assertIn('countries 5 (5 from an earlier answer, 0 new, 0 dropped)', line)
        self.assertIn('regions 5 (5 from an earlier answer, 0 new, 0 dropped)', line)
        feeds = self.read('2026-11-06', 'none')
        self.assertIn('countries 0 (0 from an earlier answer, 0 new, 5 dropped)', scout_carry.answers_line(feeds))
        self.assertIn('AI answers on the feeds: countries 0', scout.published_line(5, [], feeds))


if __name__ == '__main__':
    unittest.main()
