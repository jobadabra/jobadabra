"""One queue for every reader's title batches, nearest place first (#2918; owner, 5 Nov 2026: "One clear order first", 6 Nov 2026: "Score from the nearest
batches as they land"). The owner's scenario: every slot is busy; a far reader's batches (its level FIRST) and a near reader's batch (NORMAL) wait for the next free one. Before, the level
decided (far first, the near job's score came last); now the nearest batch is asked first, whichever reader it came from. The fake model has Claude Code's own shape:
as many slots as title calls at once (engine.PARALLEL), served by level."""
import contextlib
import json
import pathlib
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest import mock

from src import geo, time_budget
from src.ai import batch_scope, engine, place_triage, slots, title_triage
from src.sources import feeds

try:
    from src.ai import title_queue
except ImportError:   # main before the queue: batches go from each reader's own pool straight to the model's slots
    title_queue = None

NEAR_KM, FAR_KM = 10, 900
BUSY = [f'Busy role {n:03d}' for n in range(60)]   # 2 batches: other AI work holds both of Claude's slots
FAR = [f'Far role {n:03d}' for n in range(90)]     # 3 batches, the employer sites', their level FIRST
NEAR = [f'Near role {n:03d}' for n in range(30)]   # 1 batch, another reader's, NORMAL


class Model:
    """A fake model: `slots` at once, served by level; the first calls hold their slot until `gate` opens (a slow answer); records the order calls got a slot in."""

    def __init__(self, slot_count, held):
        self.slots, self.held, self.gate, self.order, self.lock = slots.Slots(slot_count), held, threading.Event(), [], threading.Lock()
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        listed = kwargs['messages'][0]['content'].split('The titles:\n', 1)[1].split('\n')
        with self.slots:
            with self.lock:
                self.order.append(listed[0].split('. ', 1)[1])
                hold = len(self.order) <= self.held
            if hold:
                self.gate.wait(timeout=20)   # a hang guard, never the clock the test depends on
        answer = {'fit': list(range(1, len(listed) + 1))}
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(answer))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


class OneQueueTest(unittest.TestCase):
    def setUp(self):
        tmp = pathlib.Path(tempfile.mkdtemp())
        self.tmp = tmp
        km = {'Far town': FAR_KM, 'Near town': NEAR_KM, 'Busy town': FAR_KM}
        for patch in (mock.patch.object(place_triage, 'STORE', tmp / 'p.json'), mock.patch.object(title_triage, 'STORE', tmp / 't.json'),
                      mock.patch.object(geo, 'STORE', tmp / 'g.json'), mock.patch.object(engine, 'ready', return_value=True),
                      mock.patch.object(engine, 'PARALLEL', 2), mock.patch.object(feeds, 'wanted_location', lambda job: True),
                      mock.patch.object(feeds, 'in_my_place', lambda job: False), mock.patch.object(time_budget, 'best_first', lambda jobs: list(jobs)),
                      mock.patch.object(time_budget, 'near_best', lambda tops: lambda location: km.get(location, float('inf')), create=True),   # main has no near_best: its order ignores distance
                      mock.patch('builtins.print')):
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(self.fresh)
        self.model = Model(2, held=2)   # two slots, both held by the busy reader's two calls
        patch = mock.patch.object(engine, 'client', lambda **kw: self.model)
        patch.start()
        self.addCleanup(patch.stop)

    def fresh(self):
        for name in ('p.json', 't.json', 'g.json'):
            (self.tmp / name).unlink(missing_ok=True)
        feeds.PLACED = feeds.TRIAGED = feeds.READ = None

    def read(self, name, titles, town, level):
        with batch_scope.reader(name), slots.priority(level):
            feeds.triage([{'title': title, 'location': town} for title in titles])

    def pending(self):
        """Batches waiting for a slot: at the model (before the queue) or in the queue (src/ai/title_queue.py)."""
        return self.model.slots.waiting() + (len(title_queue._heap) if title_queue is not None else 0)

    def until(self, what, ready):
        deadline = time.monotonic() + 20
        while not ready() and time.monotonic() < deadline:
            time.sleep(0.005)
        self.assertTrue(ready(), f'positive control: {what}')

    def start(self, *args):
        thread = threading.Thread(target=self.read, args=args)
        thread.start()
        return thread

    def test_the_nearest_batch_is_asked_first_whichever_reader_it_came_from(self):
        with batch_scope.concurrent():
            busy = self.start('busy', BUSY, 'Busy town', slots.NORMAL)
            self.until('the busy reader holds both slots', lambda: len(self.model.order) == 2)
            far = self.start('employer sites', FAR, 'Far town', slots.FIRST)
            self.until('the far reader\'s batches wait', lambda: self.pending() >= 2)
            before = self.pending()
            near = self.start('boards', NEAR, 'Near town', slots.NORMAL)
            self.until('the near reader\'s batch waits too', lambda: self.pending() > before)
            self.model.gate.set()
            for thread in (busy, far, near):
                thread.join(30)
        asked = [title.split(' ')[0] for title in self.model.order]
        self.assertEqual(sorted(asked), ['busy', 'busy', 'far', 'far', 'far', 'near'], 'every batch was asked once')
        self.assertEqual(asked[2], 'near', f'the first free slot goes to the nearest batch, not to the far reader\'s level: {asked}')


class TheShapesAroundIt(unittest.TestCase):
    """The capped-AI, no-AI and failing-batch shapes: a title is only ever handed on when the AI said it fits, and the rest stays unknown, never guessed."""
    def setUp(self):
        tmp = pathlib.Path(tempfile.mkdtemp())
        self.tmp = tmp
        for patch in (mock.patch.object(place_triage, 'STORE', tmp / 'p.json'), mock.patch.object(title_triage, 'STORE', tmp / 't.json'),
                      mock.patch.object(geo, 'STORE', tmp / 'g.json'), mock.patch('builtins.print')):
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(lambda: setattr(feeds, 'TRIAGED', None))

    def test_a_batch_the_clock_refuses_is_not_asked_not_handed_and_stays_unknown(self):
        asked, handed = [], []
        model = Model(2, held=0)
        model.messages = SimpleNamespace(create=lambda **kw: asked.append(kw) or Model.create(model, **kw))
        with mock.patch.object(time_budget, 'over', return_value=True), mock.patch.object(time_budget, 'left_line', return_value='time is up'):
            decided = title_triage.decide(NEAR, {'role_keywords': ['x']}, model, land=lambda fit, batch: handed.append(fit))
        self.assertEqual((asked, handed, decided), ([], [], {}), 'no call, nothing handed on, no title decided')

    def test_without_ai_nothing_is_asked_or_handed(self):
        handed = []
        with mock.patch.object(engine, 'ready', return_value=False), mock.patch.object(engine, 'client', side_effect=AssertionError('no AI call')), \
                title_queue.handing_to(handed.append):
            feeds.triage([{'title': 'Engineer', 'location': 'Town'}])
        self.assertEqual(handed, [])

    def test_a_failing_batch_is_raised_after_the_others_landed(self):
        landed = []

        def ask(titles):
            if titles == ['bad']:
                raise OSError('refused')
            return titles
        with self.assertRaises(OSError):
            title_queue.serve([((0, 1.0), ['good']), ((0, 2.0), ['bad']), ((0, 3.0), ['also good'])], ask, lambda titles, result: landed.append(titles), 2)
        self.assertEqual(sorted(landed), [['also good'], ['good']], 'the other batches still landed')


class TheSlotsKeepTheQueuesOrder(unittest.TestCase):
    def test_a_near_batch_takes_a_freed_slot_before_a_far_one_that_was_popped_earlier(self):
        """Review of #2918: the far batch is already waiting at the model's slot (popped), held by something that is not the queue (a score); the near one arrives later."""
        gate, got, pool = slots.Slots(1), [], []
        holder_in, holder_out = threading.Event(), threading.Event()

        def holder():
            with gate:
                holder_in.set()
                holder_out.wait(20)

        def take(name, rank):
            with slots.ranked(rank), gate:
                got.append(name)
        threading.Thread(target=holder).start()
        holder_in.wait(20)
        for name, rank in (('far', (1, 900.0)), ('near', (0, 5.0))):
            thread = threading.Thread(target=take, args=(name, rank))
            thread.start()
            pool.append(thread)
            deadline = time.monotonic() + 20
            while gate.waiting() < len(pool) and time.monotonic() < deadline:
                time.sleep(0.005)
        holder_out.set()
        for thread in pool:
            thread.join(20)
        self.assertEqual(got, ['near', 'far'])


class DelayedMapOrdering(unittest.TestCase):
    def test_a_failed_priority_refresh_fails_its_reader_without_stranding_other_work(self):
        asked = []

        def rank(batch):
            if batch == ['bad']:
                raise ValueError('bad geography')
            return (0, 1.0)

        errors, done = [], threading.Event()

        def run():
            try:
                title_queue.serve([((0, 1.0), ['good']), ((0, 2.0), ['bad'])],
                                  lambda batch: asked.extend(batch), lambda batch, result: None, 1, rank=rank)
            except ValueError as error:
                errors.append(str(error))
            finally:
                done.set()
        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        self.assertTrue(done.wait(10), 'a failed refresh must not strand the reader')
        thread.join(10)
        self.assertEqual(errors, ['bad geography'])
        self.assertEqual(asked, ['good'])

    def test_refresh_uses_the_originating_reader_view_and_keeps_unknown_arrival_order(self):
        """A queue worker must not rank using a different reader's geographic snapshot."""
        order, seen = [], []
        views = {'reader': 'own'}

        def rank(batch):
            seen.append(batch_scope.current())
            return (1, float('inf'))

        with batch_scope.using(views):
            title_queue.serve([((1, float('inf')), ['first']), ((1, float('inf')), ['second'])],
                              lambda batch: order.append(batch[0]), lambda batch, result: None, 1, rank=rank)
        self.assertTrue(seen, 'waiting priorities were refreshed')
        self.assertTrue(all(view is views for view in seen), 'ranking sees its own reader, including in queue worker threads')
        self.assertEqual(order, ['first', 'second'], 'still-unknown locations retain arrival order')

    def test_waiting_reader_moves_ahead_when_its_location_becomes_known(self):
        """EURES hands jobs over before map resolution: a learned near location must update waiting title priority."""
        from src.sources import feed_order
        entered, release, queued = threading.Event(), threading.Event(), threading.Event()
        order, errors, threads = [], [], []
        point = lambda lat, lon: {'kind': 'city', 'cc': 'FR', 'lat': lat, 'lon': lon, 'r': 25}
        data = {'home': point(45.75, 4.85), 'far town': point(48.85, 2.35)}
        search = {'locations': {'top_tier': ['Home']}}
        jobs = [{'title': 'Near role', 'location': 'Near region'}, {'title': 'Far role', 'location': 'Far town'}]
        original_push = title_queue.heapq.heappush

        def push(heap, entry):
            original_push(heap, entry)
            if entry[2] == ['near role']:
                queued.set()

        def ask(batch):
            order.append(batch[0])
            if batch == ['busy']:
                entered.set()
                if not release.wait(10):
                    raise TimeoutError('test did not release occupied queue')
            return batch

        def run(titles):
            try:
                title_triage.decide(titles, search, client=model, nearness=key)
            except BaseException as error:
                errors.append(error)

        def create(**kwargs):
            titles = [line.split('. ', 1)[1] for line in kwargs['messages'][0]['content'].split('The titles:\n')[1].splitlines()]
            ask(titles)
            return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps({'fit': list(range(1, len(titles) + 1))}))],
                                   usage=SimpleNamespace(input_tokens=1, output_tokens=1))

        model = SimpleNamespace(messages=SimpleNamespace(create=create))
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(geo, 'load', return_value=data), \
                mock.patch.object(title_triage, 'STORE', pathlib.Path(tmp) / 'titles.json'), mock.patch.object(engine, 'PARALLEL', 1), \
                mock.patch.object(time_budget, 'DEADLINE', None), mock.patch.object(title_queue.heapq, 'heappush', side_effect=push):
            key = feed_order.nearness(jobs, search, lambda job: True)
            try:
                busy = threading.Thread(target=run, args=(['busy'],))
                threads.append(busy)
                busy.start()
                self.assertTrue(entered.wait(10), 'positive control: the only worker is occupied')
                waiting = threading.Thread(target=run, args=(['Far role', 'Near role'],))
                threads.append(waiting)
                with mock.patch.object(title_triage, 'BATCH', 1):
                    waiting.start()
                    self.assertTrue(queued.wait(10), 'positive control: both reader batches are queued')
                    data['near region'] = point(45.76, 4.84)
                    release.set()
                    for thread in threads:
                        thread.join(10)
            finally:
                release.set()
                for thread in threads:
                    thread.join(10)
        self.assertFalse(any(thread.is_alive() for thread in threads), 'queue workers finished')
        self.assertEqual(errors, [])
        self.assertEqual(order, ['busy', 'near role', 'far role'])


if __name__ == '__main__':
    unittest.main()
