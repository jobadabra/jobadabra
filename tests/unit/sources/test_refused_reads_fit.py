"""Refused sites are read in the browser only when they could hire for this search (owner, 26 Oct 2026: "The AI decides"). The night of 25-26 Oct a
pilot search's "Check for new jobs" read the same 13 refused sites 4 times (a bank, an energy and a telecom company, software firms): 49 browser reads,
0 jobs matching. The queue now asks the same AI judge as the visit list (visits.relevant: names and addresses, the roles and places, once per list);
a site the person opened a job on is read whatever it says; without any AI every site is read, as before."""
import json
import sys
import tempfile
import threading
import traceback
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src.sources import host_pace, refused_reads, visits

NOW = datetime(2026, 10, 26, 1, 0, tzinfo=timezone.utc)
SEARCH = {'role_keywords': ['First Officer', 'pilot'], 'locations': {'top_tier': ['Europe'], 'country_wide': []}}
EMPLOYERS = [('A Bank', 'https://www.bank.test/careers'), ('An Energy Company', 'https://energy.test/jobs'), ('An Airline', 'https://careers.airline.test')]
PICKS = [{'name': 'A Telecom', 'url': 'https://telecom.test'}, {'name': 'An Airport', 'url': 'https://jobs.airport.test'}]
FLYING = ('Airline', 'Airport')   # the stand-in AI keeps these


class Judge:
    """A stand-in AI for visits.relevant: keeps the numbered sites whose name says they fly people.
    Why (8 Nov 2026, owner: "Scope + record"; #3601 run 42460418142): setUp patches src.ai.engine.client for the whole process, so ANY thread that asks the AI meanwhile
    (a decide() of role-kind / job-title-kind / job-region from an earlier module's worker, seen only on a loaded Linux runner) landed in `asked` and turned the count asserts red
    (8 != 2). `asked` now holds only visits.relevant's own calls; any other call is kept in `strays` with its thread name and stack, written to the real stderr (a shard that fails
    prints it), and answered with an error so the caller treats it as an AI that failed, as before. The polluting module is not found yet: the next flake names it."""
    def __init__(self):
        self.asked = []
        self.strays = []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        system, messages = kwargs.get('system') or [{}], kwargs.get('messages') or [{}]   # any call shape reaches the stray branch below, never a KeyError first (Gitar, #3623)
        text = system if isinstance(system, str) else str(system[0].get('text', ''))
        mine = visits.RELEVANT_SYSTEM in text and 'The sites:\n' in str(messages[0].get('content', ''))
        if not mine:
            thread = threading.current_thread().name
            stack = ''.join(traceback.format_stack(limit=12))
            self.strays.append({'thread': thread, 'stack': stack})
            print(f'STRAY AI CALL in test_refused_reads_fit from thread {thread!r}:\n{stack}', file=sys.__stderr__, flush=True)
            raise RuntimeError('a caller other than visits.relevant asked the stand-in judge')
        self.asked.append(kwargs)
        lines = kwargs['messages'][0]['content'].split('The sites:\n', 1)[1].split('\n')
        keep = [int(line.split('.', 1)[0]) for line in lines if any(word in line for word in FLYING)]
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps({'keep': keep}))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


class RefusedReadsFitTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.judge = Judge()
        self.patches = [mock.patch.object(visits, 'STORE', Path(self.tmp.name) / 'visits.json'),
                        mock.patch('src.ai.board_ideas.load', lambda: {'boards': {}}),
                        mock.patch.object(refused_reads, 'search_config', lambda: SEARCH),
                        mock.patch.object(visits, 'load_search_config', lambda **k: SEARCH),
                        mock.patch.object(visits, 'unread_picks', lambda *a, **k: list(PICKS)),
                        mock.patch.object(host_pace, 'FILE', Path(self.tmp.name) / 'host_pace.json'),
                        mock.patch('src.ai.engine.ready', lambda *a, **k: True),
                        mock.patch('src.ai.engine.client', lambda *a, **k: self.judge)]
        for patch in self.patches:
            patch.start()
        for name, url in EMPLOYERS:
            visits.refused(name, url, 'HTTP 403', now=NOW)

    def tearDown(self):
        for patch in self.patches:
            patch.stop()
        self.tmp.cleanup()

    def names(self, sites):
        return sorted(site['name'] for site in sites)

    def test_a_check_reads_only_the_refused_sites_that_could_hire_for_the_search(self):
        for everything in (False, True):   # True: "Check for new jobs" (desktop/lib/refused-now.js), which read every site 4 times that night
            with self.subTest(everything=everything):
                self.assertEqual(self.names(refused_reads.queue(now=NOW, everything=everything)), ['An Airline', 'An Airport'])

    def test_a_site_the_person_opened_a_job_on_is_read_whatever_the_ai_says(self):
        sites = refused_reads.queue(now=NOW, now_hosts=['www.bank.test'])
        self.assertIn('A Bank', self.names(sites))
        self.assertNotIn('An Energy Company', self.names(sites))

    def test_the_ai_is_asked_once_per_list_and_the_visit_list_keeps_its_own_answer(self):
        refused_reads.queue(now=NOW)
        visits.relevant([{'name': 'An Airline', 'url': 'https://careers.airline.test', 'kind': 'employer'}], SEARCH)   # the visit list's own, different list
        refused_reads.queue(now=NOW)
        self.assertEqual(len(self.judge.asked), 2, 'the queue and the visit list each asked once: one answer does not push the other out')

    def test_without_any_ai_every_refused_site_is_read_as_before(self):
        with mock.patch('src.ai.engine.ready', lambda *a, **k: False):
            self.assertEqual(self.names(refused_reads.queue(now=NOW)), sorted([name for name, _ in EMPLOYERS] + [p['name'] for p in PICKS]))
        self.assertEqual(self.judge.asked, [])

    def test_a_stray_ai_caller_is_not_counted_and_is_named(self):
        """The polluter's pattern: another thread asks the AI (decide) while the judge is patched in. Before 8 Nov 2026 its call was counted (3 != 1)."""
        from src.ai import decide
        fresh = ((decide.WAITING, {'n': 0, 'said': False, 'calls': {}}), (decide._calls, {'n': 0}), (decide._own, {}),
                 (decide.STOPPED, {'why': '', 'key': False, 'cause': ''}), (decide.CACHE_ONLY, {'on': False}), (decide.SCOPE, {'name': None, 'n': 0}))
        for state, values in fresh:   # a fresh run: whatever earlier modules left (a spent cap, a stopped AI), the stray reaches the judge, and leaves nothing behind (first try failed in the shard: #3623 run 42496847818)
            patch = mock.patch.dict(state, values, clear=True)
            patch.start()
            self.addCleanup(patch.stop)
        failed = decide.FAILED[0]
        self.addCleanup(decide.FAILED.__setitem__, 0, failed)
        stray = threading.Thread(target=lambda: decide.decide('role-kind', {'zzq': 'zzq unknown title'}, ('other', 'unsure'), 'Pick one.'), name='stray-worker')
        stray.start()
        stray.join()
        refused_reads.queue(now=NOW)
        self.assertEqual(len(self.judge.asked), 1, 'only the queue\'s own list was asked')
        self.assertEqual([s['thread'] for s in self.judge.strays], ['stray-worker'])
        self.assertIn('decide', self.judge.strays[0]['stack'], 'the stack names who asked')


    def test_a_stray_call_without_a_system_prompt_is_recorded_not_a_crash(self):
        """src/connection_test.py and src/ai/prep.py ask with no `system`: the stub names them like any other stray (Gitar, #3623)."""
        with self.assertRaises(RuntimeError):
            self.judge.create(model='m', messages=[{'role': 'user', 'content': 'ping'}])
        self.assertEqual(len(self.judge.strays), 1)
        self.assertEqual(self.judge.asked, [])

if __name__ == '__main__':
    unittest.main()


class NameOnlyTest(RefusedReadsFitTest):
    """26 Oct 2026, 02:09 and 02:31: the judge kept "Airbase" (spend-management software, from a tech firms' list an earlier software search
    picked) for the pilot search: it saw only the name and the address, a name that sounds like flying, and was told "When unsure, keep it"."""
    PICK = {'name': 'Skyport', 'url': 'https://www.skyport.test/careers', 'origin': 'hiring-without-whiteboards'}

    def test_the_judge_sees_where_each_site_was_found_and_an_unsure_one_is_not_read(self):
        with mock.patch.object(visits, 'unread_picks', lambda *a, **k: [dict(self.PICK)]):
            refused_reads.queue(now=NOW, everything=True)
        asked = self.judge.asked[-1]
        sites = asked['messages'][0]['content'].split('The sites:\n', 1)[1]
        self.assertIn('Skyport (https://www.skyport.test/careers) [employer] found in: hiring-without-whiteboards', sites)
        system = asked['system'][0]['text']
        self.assertIn('not by its name', system)
        self.assertIn('When unsure, leave it out', system, 'an automatic browser read of a site nobody is sure of is not made')

    def test_the_visit_list_still_keeps_an_unsure_site_for_the_person_to_choose(self):
        visits.relevant([{'name': 'Skyport', 'url': self.PICK['url'], 'kind': 'employer'}], SEARCH, label='Visit list')
        self.assertIn('When unsure, keep it', self.judge.asked[-1]['system'][0]['text'])

    def test_an_answer_kept_before_the_judge_saw_this_is_asked_again(self):
        item = {'name': 'Skyport', 'url': self.PICK['url'], 'kind': 'employer'}
        import hashlib
        old = hashlib.sha256(json.dumps([[item['url']], sorted(['First Officer', 'pilot']), ['Europe']], ensure_ascii=False).encode()).hexdigest()[:12]
        data = visits._load()
        data['relevant'] = {old: [item['url']]}   # the 02:09 answer that kept it
        visits._save(data)
        visits.relevant([item], SEARCH, label='Refused sites', failed=[], unsure='leave')
        self.assertEqual(len(self.judge.asked), 1, 'asked again, not the old answer')
