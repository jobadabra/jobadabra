"""Clock mode and partial place answers for split search part 2, without the board-pass implementation."""
import contextlib
import io
import pathlib
import tempfile
import threading
import unittest
from unittest import mock

from src import geo, time_budget
from src.ai import batch_scope, engine, place_triage, slots, title_queue
from src.sources import feed_places, feeds
from tests.unit.ai.test_titles_with_places import Model


class EndClock(unittest.TestCase):
    def setUp(self):
        time_budget.start(180, now=1000)
        self.addCleanup(time_budget.start, 0)
        patch = mock.patch.object(time_budget, '_paces', lambda: {**time_budget.PACE, 'title_rounds': 7.0})
        patch.start()
        self.addCleanup(patch.stop)

    def test_default_reserve_and_share_then_opt_in_until_the_existing_tail(self):
        self.assertTrue(time_budget.over('titles', now=1150))
        self.assertEqual(time_budget.batch('title_rounds', 3, now=1150, say=False), 0)
        with time_budget.to_the_end():
            self.assertFalse(time_budget.over('titles', now=1150))
            self.assertEqual(time_budget.batch('title_rounds', 3, now=1150, say=False), 2)
            self.assertTrue(time_budget.over('titles', now=1165))
            self.assertEqual(time_budget.batch('title_rounds', 3, now=1165, say=False), 0)
        self.assertTrue(time_budget.over('titles', now=1150))
        self.assertEqual(time_budget.batch('title_rounds', 3, now=1150, say=False), 0)

    def test_only_carried_workers_inherit_and_restore_the_mode(self):
        seen = {}
        def record(name):
            seen[name] = time_budget.over('titles', now=1150)
        with time_budget.to_the_end():
            with time_budget.to_the_end():
                self.assertTrue(time_budget.at_the_end())
            workers = [threading.Thread(target=lambda: record('other')),
                       threading.Thread(target=time_budget.carried(lambda: record('carried'))),
                       threading.Thread(target=slots.carry(lambda: record('pool')))]
            for worker in workers:
                worker.start()
                worker.join(timeout=5)
                self.assertFalse(worker.is_alive())
            outside = time_budget.carried(lambda: record('late'))
        outside()
        self.assertFalse(time_budget.at_the_end())
        self.assertEqual(seen, {'other': True, 'carried': False, 'pool': False, 'late': False})
        with self.assertRaisesRegex(RuntimeError, 'fixture'):
            with time_budget.to_the_end():
                raise RuntimeError('fixture')
        self.assertFalse(time_budget.at_the_end())

    def test_title_queue_workers_use_each_callers_mode(self):
        for enabled in (True, False):
            landed = []
            def serve():
                title_queue.serve([((), ['Example role'])], lambda titles: time_budget.over('titles', now=1150),
                                  lambda titles, answer: landed.append(answer), parallel=1)
            if enabled:
                with time_budget.to_the_end():
                    serve()
            else:
                serve()
            self.assertEqual(landed, [not enabled])

    def test_map_lookup_keeps_the_default_log_quiet(self):
        from tests.unit.ai.test_geo import Client
        output = io.StringIO()
        time_budget.start(0)
        with contextlib.redirect_stdout(output):
            found = geo._ask(Client(), ['fictional town'])
        self.assertEqual(found['fictional town']['kind'], 'unknown')
        self.assertEqual(output.getvalue(), '')

    def test_stage_end_and_untimed_runs_keep_their_limits(self):
        time_budget.start(180, now=1000, stage=60)
        with time_budget.to_the_end():
            self.assertFalse(time_budget.over('titles', now=1044))
            self.assertTrue(time_budget.over('titles', now=1045))
        time_budget.start(0)
        with time_budget.to_the_end():
            self.assertFalse(time_budget.over('titles', now=9999))
            self.assertEqual(time_budget.batch('title_rounds', 3, now=9999, say=False), 3)


class PartialPlaces(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.model = Model()
        self.model.gate.set()
        time_budget.start(0)
        self.addCleanup(time_budget.start, 0)
        self.search = {'role_keywords': ['Example role'], 'preferences': {'locations': {'best': ['Known town']}}}
        for patch in (mock.patch.object(place_triage, 'STORE', pathlib.Path(folder.name) / 'places.json'),
                      mock.patch.object(place_triage, '_preferences', return_value={}),
                      mock.patch.object(geo, 'verdicts', return_value={}),
                      mock.patch.object(engine, 'client', return_value=self.model),
                      mock.patch.object(engine, 'ready', return_value=True), mock.patch.object(engine, 'PARALLEL', 2),
                      mock.patch.object(feeds, '_SEARCH', self.search), mock.patch.object(feeds, 'PLACED', {}),
                      mock.patch('builtins.print')):
            patch.start()
            self.addCleanup(patch.stop)

    def test_map_answers_publish_only_inside_places_before_the_next_round(self):
        landed, seen = [], []
        create = self.model.create
        def answer(**kwargs):
            seen.extend(landed)
            return create(**kwargs)
        self.model.messages.create = answer
        with mock.patch.object(geo, 'verdicts', return_value={'map town': 'best', 'outside': 'out'}):
            got = place_triage.decide(['Map town', 'Outside', 'Late town'], self.search, land=landed.append)
        self.assertEqual(seen, [{'map town': 'best'}])
        self.assertEqual(landed, [{'map town': 'best'}, {'late town': 'in'}])
        self.assertEqual(got, {'map town': 'best', 'outside': 'out', 'late town': 'in'})

    def test_feed_opt_in_publishes_a_batch_in_the_readers_view_before_a_slow_batch(self):
        for early in (False, True):
            with self.subTest(land=early), tempfile.TemporaryDirectory() as folder:
                gate, first, slow = threading.Event(), threading.Event(), threading.Event()
                self.addCleanup(gate.set)
                feeds.PLACED = {}
                seen, errors = [], []
                create = self.model.create
                def answer(**kwargs):
                    if 'slow town' in kwargs['messages'][0]['content']:
                        slow.set()
                        gate.wait(timeout=5)
                    return create(**kwargs)
                self.model.messages.create = answer
                def place():
                    try:
                        with batch_scope.using(views):
                            feed_places.place_jobs([{'title': 'Example role', 'location': town} for town in ('Late town', 'Slow town')], chosen=True,
                                                   **({'land': True} if early else {}))
                    except BaseException as error:
                        errors.append(error)
                with batch_scope.concurrent(), batch_scope.reader('fictional reader'):
                    views = batch_scope.current()
                    placed = feeds.placed()
                    update = place_triage.decide
                    def decide(*args, **kwargs):
                        callback = kwargs.get('land')
                        def land(got):
                            callback(got)
                            seen.append(dict(placed))
                            first.set()
                        if callback:
                            kwargs['land'] = land
                        return update(*args, **kwargs)
                    with mock.patch.object(place_triage, 'STORE', pathlib.Path(folder) / 'places.json'), mock.patch.object(place_triage, 'BATCH', 1), \
                         mock.patch.object(place_triage, 'decide', decide):
                        worker = threading.Thread(target=place)
                        worker.start()
                        try:
                            self.assertTrue(slow.wait(timeout=5))
                            if early:
                                self.assertTrue(first.wait(timeout=5))
                                self.assertEqual(placed.get('late town'), 'in')
                            else:
                                self.assertEqual(placed, {})
                            self.assertNotIn('slow town', placed)
                        finally:
                            gate.set()
                            worker.join(timeout=5)
                        self.assertFalse(worker.is_alive())
                        self.assertEqual(errors, [])
                        self.assertEqual(placed, {'late town': 'in', 'slow town': 'in'})
                self.assertEqual(bool(seen), early)

    def test_empty_and_unreadable_answers_do_not_publish_a_place(self):
        landed = []
        self.assertEqual(place_triage.decide([], self.search, land=landed.append), {})
        from types import SimpleNamespace
        self.model.messages.create = lambda **kwargs: SimpleNamespace(content=[SimpleNamespace(type='text', text='unreadable')], usage=None)
        with self.assertRaises(ValueError):
            place_triage.decide(['Late town'], self.search, land=landed.append)
        self.assertEqual(landed, [])

    def test_visa_return_overwrites_the_early_inside_answer(self):
        landed = []
        create = self.model.create
        def answer(**kwargs):
            if kwargs['system'][0]['text'] == place_triage.VISA_SYSTEM:
                self.assertEqual(landed, [{'late town': 'in'}])
                from types import SimpleNamespace
                return SimpleNamespace(content=[SimpleNamespace(type='text', text='{"visa": ["France"]}')], usage=None)
            return create(**kwargs)
        self.model.messages.create = answer
        with mock.patch.object(place_triage, '_preferences', return_value={'work_eligibility': 'Example permit'}), \
             mock.patch.object(place_triage, 'places_words', return_value={'work_rights': ['Example permit']}):
            got = place_triage.decide(['Late town'], self.search, land=landed.append)
        self.assertEqual(got, {'late town': 'in:visa'})
