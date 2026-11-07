"""A reader's titles are sorted in ONE pass, the titles in its own places first (#2920, 7 Nov 2026, p7 Dublin nurse: 104 of 106 employer titles never judged).
feeds.triage used to ask twice in turn, the local titles and then all of them: the 2-title call ended after the titles' stop (71 s of the 135 s budget), so the second pass found
"No time left" for the other 104 although they are four calls that fit in the same round. Now one decide() ranks local titles first and a round starts when
now + this computer's measured round time ends by the titles' stop. Tests here: the p7 shape on a fake clock, two call speeds, and the verdict rules on the new path."""
import contextlib
import io
import json
import math
import pathlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from src import time_budget
from src.ai import engine, title_queue, title_triage
from src.sources import feeds

PARALLEL = 4
LOCAL = ['Keep Engineer Dublin 1', 'Drop Engineer Dublin 2']
OTHERS = [f'{"Keep" if n % 2 else "Drop"} Engineer Remote {n}' for n in range(104)]
JOBS = [{'title': title, 'location': 'Dublin'} for title in LOCAL] + [{'title': title, 'location': 'Berlin'} for title in OTHERS]


class Model:
    """Says a title fits when it starts with Keep; remembers every title it was asked."""
    def __init__(self):
        self.asked, self.systems = [], []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        listed = kwargs['messages'][0]['content'].split('The titles:\n', 1)[1].split('\n')
        titles = [line.split('. ', 1)[1] for line in listed]
        self.systems.append(kwargs['system'][0]['text'])
        if kwargs['system'][0]['text'] == title_triage.SYSTEM:
            self.asked += titles
        fit = [n for n, title in enumerate(titles, 1) if title.startswith('keep')]
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps({'fit': fit}))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


class OnePassTest(unittest.TestCase):
    """The press is 58 s in (employers named), a budget of 135 s: the titles' stop is 135 - 0.75 * (70 + 15) = 71.25 s. A round of calls takes `ROUND` seconds."""

    def setUp(self):
        self.clock, self.round = [58.0], 12.0
        data = pathlib.Path(tempfile.mkdtemp())
        self.model, self.out = Model(), io.StringIO()
        real_serve = title_queue.serve

        def serve(batches, ask, land, parallel, rank=None):
            real_serve(batches, ask, land, parallel, rank=rank)
            self.clock[0] += self.round * math.ceil(len(batches) / parallel)   # the calls of one round ran side by side
        patches = [mock.patch.object(title_triage, 'STORE', data / 't.json'), mock.patch('src.paths.DATA', data), mock.patch.object(engine, 'PARALLEL', PARALLEL),
                   mock.patch('time.monotonic', lambda: self.clock[0]), mock.patch.object(title_queue, 'serve', serve),
                   mock.patch.object(feeds, 'TRIAGED', {}), mock.patch.object(feeds, 'TITLES', feeds.keyword_regex(['engineer'])),
                   mock.patch.object(feeds, 'EXCLUDED_TITLES', feeds.keyword_regex(['(?!x)x'])), mock.patch.object(feeds, 'wanted_location', return_value=True),
                   mock.patch.object(feeds, 'in_my_place', lambda job: job['location'] == 'Dublin'), mock.patch('src.ai.engine.ready', lambda *a, **k: True),
                   mock.patch('src.ai.engine.client', lambda **k: self.model), mock.patch('src.time_budget.best_first', lambda jobs: list(jobs)),
                   mock.patch('src.time_budget.near_best', lambda tops: lambda location: float('inf'))]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        time_budget.start(135, now=0.0)
        self.addCleanup(lambda: setattr(time_budget, 'DEADLINE', None))
        self.data = data

    def triage(self, seconds_a_round):
        """feeds.triage over the p7 jobs with the measured round time `seconds_a_round`; returns what it printed."""
        self.round = seconds_a_round
        (self.data / 'step_pace.json').write_text(json.dumps({'title_rounds': seconds_a_round}))
        with contextlib.redirect_stdout(self.out):
            feeds.triage(JOBS)
        return self.out.getvalue()

    def waiting(self):
        every = {title_triage._norm(job['title']) for job in JOBS}
        return every - set(self.model.asked)

    def test_p7_the_local_titles_and_the_others_are_sorted_in_the_same_round(self):
        # Red on main: pass 1 (2 local titles) ended at 70 s, pass 2 found "No time left" and 104 titles waited. Measured: a call is ~12 s.
        said = self.triage(12.0)
        self.assertEqual(len(self.waiting()), 0, said)
        self.assertNotIn('No time left', said)

    def test_calls_twice_as_fast_still_sort_every_title(self):
        self.triage(6.0)
        self.assertEqual(len(self.waiting()), 0)

    def test_calls_twice_as_slow_sort_the_local_titles_and_say_the_rest_wait(self):
        # a round of 24 s started at 58 s ends at 82 s, after the stop (71 s): it does not start; the local titles are the floor and are asked whatever the clock
        said = self.triage(24.0)
        self.assertEqual(set(self.model.asked), {title_triage._norm(title) for title in LOCAL})
        self.assertEqual(len(self.waiting()), 104)
        self.assertIn('title(s) wait for the next one', said, 'the titles left for the next search are said, never silently dropped')

    def test_a_round_that_fits_the_stop_starts_whatever_the_speed(self):
        def rounds(seconds):
            (self.data / 'step_pace.json').write_text(json.dumps({'title_rounds': seconds}))
            return time_budget.in_calls('title_rounds', 106, title_triage.BATCH, PARALLEL, now=58.0, stop='titles')
        for seconds in (3.0, 6.0, 12.0, 13.0):   # 58 + 13 = 71 <= 71.25: one round fits, so it starts: all 106 titles are in it
            with self.subTest(seconds=seconds):
                self.assertEqual(rounds(seconds), 106)
        self.assertEqual(rounds(13.5), 0, '58 + 13.5 ends after the stop at 71.25 s: no round starts')

    def test_a_round_that_fits_before_the_stop_is_never_refused_by_the_share(self):
        # the share (0.2 of the time left) gives 0 rounds to a 25 s round at 20 s, though the stop is 71 s away: never "0 rounds when one fits", at any speed or moment
        (self.data / 'step_pace.json').write_text(json.dumps({'title_rounds': 25.0}))
        self.assertEqual(time_budget.in_calls('title_rounds', 106, title_triage.BATCH, PARALLEL, now=20.0, stop='titles'), 106)
        self.assertEqual(time_budget.in_calls('title_rounds', 106, title_triage.BATCH, PARALLEL, now=20.0), 0, 'without the stop the share alone says none (every other step)')
        for now in (0.0, 10.0, 20.0, 40.0, 58.0, 65.0):
            for pace in (1.0, 3.0, 6.0, 12.0, 24.0, 48.0):
                (self.data / 'step_pace.json').write_text(json.dumps({'title_rounds': pace}))
                with self.subTest(now=now, pace=pace):
                    if now + pace <= 71.25:
                        self.assertGreater(time_budget.in_calls('title_rounds', 106, title_triage.BATCH, PARALLEL, now=now, stop='titles'), 0)

    def test_with_no_room_only_the_local_titles_are_asked_up_to_their_floor(self):
        # the `local=<titles>` path: the floor is the search's first LOCAL_TITLES local titles; the others wait (a reviewer found no test of this path)
        local = [f'Keep Engineer Dublin {n}' for n in range(time_budget.LOCAL_TITLES + 20)]
        with mock.patch.object(time_budget, 'in_calls', return_value=0), contextlib.redirect_stdout(self.out):
            title_triage.decide(local + OTHERS, {'role_keywords': ['engineer']}, self.model, local=local)
        self.assertEqual(len(self.model.asked), time_budget.LOCAL_TITLES)
        self.assertTrue(all('dublin' in title for title in self.model.asked), 'no other title rides in a call the floor alone pays for')

    def test_with_the_floor_spent_nothing_is_asked_past_the_clock(self):
        with mock.patch.object(time_budget, 'in_calls', return_value=0), mock.patch.object(time_budget, 'over', return_value=True), \
                mock.patch.object(time_budget, 'local_titles', return_value=0), contextlib.redirect_stdout(self.out):
            title_triage.decide(LOCAL + OTHERS, {'role_keywords': ['engineer']}, self.model, local=LOCAL)
        self.assertEqual(self.model.asked, [])

    def test_the_cap_per_run_is_as_before_for_each_kind(self):
        # reviewer, 7 Nov 2026: one pass must not turn "600 local + 600 others" into 600 in all (no deadline: a CLI or cloud run asks all it may)
        time_budget.DEADLINE = None
        local = [f'Keep Engineer Dublin {n}' for n in range(300)]
        others = [f'Keep Engineer Remote {n}' for n in range(900)]
        with contextlib.redirect_stdout(self.out):
            title_triage.decide(local + others, {'role_keywords': ['engineer']}, self.model, local=local)
        self.assertEqual(len(self.model.asked), 300 + title_triage.MAX_NEW)

    def test_all_local_input_is_capped_at_the_per_kind_cap_as_the_old_local_pass_was(self):
        # Gitar on #3550: local=True makes every title local, so a cap of "MAX_NEW + MAX_NEW" asked 1,200 where the old local pass stopped at 600
        time_budget.DEADLINE = None
        titles = [f'Keep Engineer Dublin {n}' for n in range(title_triage.MAX_NEW + 100)]
        with contextlib.redirect_stdout(self.out):
            title_triage.decide(titles, {'role_keywords': ['engineer']}, self.model, local=True)
        self.assertEqual(len(self.model.asked), title_triage.MAX_NEW)

    def test_the_second_look_is_asked_for_a_role_word_no_on_the_one_pass(self):
        with mock.patch.object(feeds, '_SEARCH', {'role_keywords': ['engineer'], 'title_exclude_keywords': []}), contextlib.redirect_stdout(self.out):
            self.round = 1.0
            (self.data / 'step_pace.json').write_text(json.dumps({'title_rounds': 1.0}))
            feeds.triage(JOBS)
        self.assertTrue(any(system == title_triage.RECHECK_SYSTEM for system in self.model.systems), 'the narrow second call ran for the role-word nos')
        self.assertFalse(feeds.wanted_title('Drop Engineer Remote 0'), 'both nos: the job stays out')

    def test_the_verdict_rules_are_unchanged_on_the_one_pass(self):
        # the "Paris, Texas" class (#3512's first design): the AI's no beats a role word, and a title it did not judge is never kept on the words' guess
        self.triage(12.0)
        self.assertTrue(feeds.wanted_title('Keep Engineer Dublin 1'))
        self.assertFalse(feeds.wanted_title('Drop Engineer Dublin 2'), 'a role-word hit the AI said no to never reaches scoring')
        self.assertFalse(feeds.wanted_title('Drop Engineer Remote 0'))

    def test_a_title_the_clock_left_unjudged_is_not_kept_on_a_guess_and_is_said(self):
        said = self.triage(24.0)
        self.assertIn('wait for the next', said)
        self.assertFalse(feeds.wanted_title('Keep Engineer Remote 1'), 'its words match, the AI never judged it: unknown, never kept')
        self.assertTrue(feeds.sure_title('Keep Engineer Remote 1'), 'still shown at once, as before')


if __name__ == '__main__':
    unittest.main()
