"""The field's boards and the country slices' boards are asked together, not one after the other (#2920, 7 Nov 2026): on the Codex relay the
serial pair ended at 109-123 s of the 135 s AI budget, so 19 of 20 runs of the 7 Nov search check read no board ("Time is up for job boards: 5-6
boards wait"). The answers keep their order (field first, then the slices as listed), one call failing leaves the others. Fake client only."""
import json
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src.ai import board_ideas

COUNTRIES = ['Austria', 'Belgium', 'Croatia', 'Czechia', 'Denmark', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Ireland']
SEARCH = {'role_keywords': ['first officer'], 'locations': {'top_tier': ['Europe'], 'country_wide': [], 'abroad': []}}
WAIT = 5   # a hang guard for the barrier and the events, never a pause


def board(name):
    return {'name': name, 'search_url': f'https://{name.lower()}.example/?q={{role}}', 'countries': ['Germany'], 'kinds': ['any'], 'source_kind': 'sector'}


def label(kw):
    """Which call this is: 'field' or the first country of the slice it was asked for."""
    if kw['system'][0]['text'] == board_ideas.FIELD_SYSTEM:
        return 'field'
    return json.loads(kw['messages'][0]['content'])['countries'][0]


class Client:
    """Answers one board named after the call; `before(label)` may hold or fail a call."""
    def __init__(self, before=lambda name: None):
        self.before, self.messages = before, self

    def create(self, **kw):
        name = label(kw)
        self.before(name)
        return SimpleNamespace(stop_reason='end_turn', usage=None, content=[SimpleNamespace(type='text', text=json.dumps({'boards': [board('B' + name)]}))])


class AskedTogether(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.ai.cost.side'), mock.patch('src.ai.engine.PARALLEL', 4),
                      mock.patch('src.places.countries', return_value=COUNTRIES), mock.patch('src.places.words_of', return_value=['Europe']),
                      mock.patch('src.role_kinds.of_search', return_value={'aviation_transport'})):
            patch.start()
            self.addCleanup(patch.stop)

    def test_the_field_call_and_the_slices_are_in_flight_at_once(self):
        """Serial, the second call starts only after the first ended, so the barrier of two never fills and both calls fail."""
        meet = threading.Barrier(2, timeout=WAIT)
        found = board_ideas.ideas(SEARCH, Client(lambda name: meet.wait() if name in ('field', 'Austria') else None))
        self.assertIn('Bfield', [b['name'] for b in found])
        self.assertIn('BAustria', [b['name'] for b in found], 'the field call and the first slice met: asked together')

    def test_the_same_answers_make_the_same_list_whatever_arrives_first(self):
        """The slices' boards in their order, then the field's (three of each in turn, the countries' first), even when the last slice answers first."""
        last_done = threading.Event()
        last = board_ideas.slices(SEARCH)[-1][1][0]

        def before(name):
            if name == last:
                return
            assert last_done.wait(WAIT), 'the last slice never answered'   # every other call answers after the last slice
        client = Client(before)
        real = client.create

        def create(**kw):
            out = real(**kw)
            if label(kw) == last:
                last_done.set()
            return out
        client.create = create
        found = board_ideas.ideas(SEARCH, client)
        slices = board_ideas.slices(SEARCH)
        self.assertEqual([b['name'] for b in found], [*('B' + part[1][0] for part in slices), 'Bfield'])

    def test_one_call_failing_leaves_the_others(self):
        firsts = [part[1][0] for part in board_ideas.slices(SEARCH)]
        failing = firsts[1]   # the second slice

        def before(name):
            if name == failing:
                raise TimeoutError('past the deadline')
        found = board_ideas.ideas(SEARCH, Client(before))
        self.assertEqual([b['name'] for b in found], ['B' + firsts[0], 'B' + firsts[2], 'Bfield'], 'the failed slice is dropped, the others land in order')
        again = Client()
        self.assertEqual([b['name'] for b in board_ideas.ideas(SEARCH, again)], [*('B' + n for n in firsts), 'Bfield'], 'the failed one is asked next time')


    def test_a_call_that_raises_itself_leaves_the_others(self):
        """Not the AI's error (that is caught in _ask) but the call: a full disk under the cache write."""
        real, calls = board_ideas._proposal, []

        def proposal(part, client=None):
            calls.append(part[1][0])
            if len(calls) == 2:
                raise OSError('disk full')
            return real(part, client)
        with mock.patch('src.ai.board_ideas._proposal', proposal):
            found = board_ideas.ideas(SEARCH, Client())
        self.assertEqual(len(found), 3, 'the field and the two slices that did not raise')

    def test_a_call_keeps_the_callers_ai_level(self):
        from src.ai import slots
        seen = []

        def before(name):
            seen.append(slots.level())
        with slots.priority(slots.FIRST):
            board_ideas.ideas(SEARCH, Client(before))
        self.assertEqual(set(seen), {slots.FIRST}, 'asked from the first-jobs slice, every call keeps its place in the AI queue')

    def test_the_cache_is_written_whole_and_leaves_no_temp_file(self):
        board_ideas.ideas(SEARCH, Client())
        saved = json.loads(board_ideas._store().read_text())
        self.assertEqual(len(saved['ideas']), 4, 'the field and the three slices, all kept though they ended together')
        self.assertEqual([f.name for f in board_ideas._store().parent.iterdir()], ['found_boards.json'])


if __name__ == '__main__':
    unittest.main()
