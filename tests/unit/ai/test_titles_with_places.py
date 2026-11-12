"""A reader's place call does not hold its titles, nor the other readers' (#2920; runs 42386229424 vs 42315566393, p10 Amsterdam and p14 Gothenburg).
The shape recorded there: the employer sites' new locations went to one place call that took 20-21 s; the hub thread sat in it, so EURES's hand-over (in the hub's box) and the
employer sites' own titles were first asked at 101-124 s instead of 57-60 s, and the press's 2:15 clock allowed 2 title calls instead of ~8. A late place answer must still be applied."""
import json
import pathlib
import tempfile
import threading
import unittest
from types import SimpleNamespace
from unittest import mock

from src import geo, store
from src.ai import batch_scope, engine, place_triage, title_queue, title_triage
from src.sources import feed_places, feed_scan, feeds

KNOWN = [f'Known role {n}' for n in range(3)]   # jobs in a town the place words name: in your places by the words, its place asked like any other unless a test places it
LATE = [f'Late role {n}' for n in range(3)]     # jobs in a town only this press's place call places "in": in your places once its answer lands
EURES = [f'Eures role {n}' for n in range(3)]   # another reader, handed over to the hub while the place call runs


class Model:
    """A fake model: a place call waits for `gate` (a slow answer); a title call answers at once; records every call in order."""

    def __init__(self):
        self.gate, self.log, self.lock, self.vague, self.out = threading.Event(), [], threading.Lock(), False, set()
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        content = kwargs['messages'][0]['content']
        if kwargs['system'][0]['text'] == place_triage.VAGUE_SYSTEM:   # which of these name no town: none, unless a test says all
            listed = content.split('The job locations:\n', 1)[-1].split('\n') if self.vague else []
            answer = {'vague': list(range(1, len(listed) + 1))}
        elif 'The job locations:' in content:
            with self.lock:
                self.log.append('place asked')
            self.gate.wait(timeout=30)   # a hang guard, never the clock the test depends on
            with self.lock:
                self.log.append('place answered')
            lines = content.split(':\n', 1)[1].split('\n')
            answer = {'locations': [{'n': int(line.split('.', 1)[0]), 'where': '', 'country': 'France', 'nearest': 'none', 'km': -1,
                                     'answer': 'out' if line.split('. ', 1)[-1].lower() in self.out else 'inside'} for line in lines]}
        elif 'The titles:' not in content:
            answer = {'vague': [], 'visa': [], 'places': []}   # the other place questions (work rights): nothing to say
        else:
            lines = content.split('The titles:\n', 1)[1].split('\n')
            with self.lock:
                self.log.extend(f"titles {line.split('. ', 1)[1]}" for line in lines)
            answer = {'fit': list(range(1, len(lines) + 1))}
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(answer))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))

    def asked(self, word):
        with self.lock:
            return [entry for entry in self.log if word.lower() in entry]   # the sort keeps titles lower-cased

    def index(self, entry):
        with self.lock:
            return self.log.index(entry) if entry in self.log else None


class PlaceCallBesideTitles(unittest.TestCase):
    def setUp(self):
        tmp = pathlib.Path(tempfile.mkdtemp())
        self.model = Model()
        for patch in (mock.patch.object(place_triage, 'STORE', tmp / 'p.json'), mock.patch.object(title_triage, 'STORE', tmp / 't.json'),
                      mock.patch.object(geo, 'STORE', tmp / 'g.json'), mock.patch.object(engine, 'ready', return_value=True),
                      mock.patch.object(engine, 'client', lambda **kw: self.model), mock.patch.object(engine, 'PARALLEL', 4),
                      mock.patch.object(feeds, 'wanted_title', lambda title: True),
                      mock.patch.object(feeds, 'wanted_location', lambda job: job['location'] == 'Known town' or feeds.place_of(job) in ('best', 'in')),
                      mock.patch.object(feeds, 'in_my_place', lambda job: job['location'] == 'Known town'),
                      mock.patch.object(geo, 'verdicts', lambda *args, **kw: {}),   # no map: the model places, as on a first press
                      mock.patch('builtins.print')):
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(lambda: setattr(feeds, 'PLACED', None) or setattr(feeds, 'TRIAGED', None) or setattr(feeds, 'READ', None))
        feeds.PLACED = feeds.TRIAGED = feeds.READ = None

    def jobs(self, titles, town):
        return [{'title': title, 'location': town} for title in titles]

    def test_the_other_reader_is_served_while_the_place_call_is_held_and_the_late_answer_is_applied_before_the_reader_sorts_its_titles(self):
        employer = self.jobs(KNOWN, 'Known town') + self.jobs(LATE, 'Late town')
        seen = {}

        def release_when_eures_is_served():
            """Open the place call's gate only once it is in flight AND EURES's titles have been asked, in whichever order (a hang guard bounds the wait; the positive control fails on it)."""
            ready = False
            for _ in range(2000):   # 5 s of 2.5 ms polls: a hang guard
                if self.model.asked('Eures role 0') and self.model.asked('place asked'):
                    ready = True
                    break
                threading.Event().wait(0.0025)
            seen['served'], seen['log_at_release'] = ready, list(self.model.log)
            self.model.gate.set()
        releaser = threading.Thread(target=release_when_eures_is_served)
        eures_ran = []

        def eures_hands_over():   # the hub takes a reader that has read, in its own thread (src/first_jobs.py _Readers.join)
            with batch_scope.seen_by('EURES'):
                feeds.triage(self.jobs(EURES, 'Known town'))
            eures_ran.append(True)

        with title_queue.hub() as hub, batch_scope.concurrent():
            releaser.start()
            hub.post(eures_hands_over)   # waiting in the hub's box while the employer reader places its locations
            with batch_scope.reader('employer sites'):
                feed_places.triage_with_places(employer)
                late_verdict = feeds.place_of(employer[-1])
        releaser.join(30)

        self.assertTrue(seen['served'], f'positive control: EURES\'s titles were asked while the place call was still held; log at release: {seen["log_at_release"]}')
        beside = {f'titles {t.lower()}' for t in KNOWN + LATE}   # the held jobs' own titles, asked beside the place call
        self.assertEqual(sorted(entry for entry in seen['log_at_release'] if entry not in beside), sorted(['place asked'] + [f"titles {t.lower()}" for t in EURES]),
                         'EURES\'s titles were asked while the place call was in flight (held), and no answer yet')
        self.assertEqual(eures_ran, [True], 'EURES\'s hand-over ran in the hub while the place call was held')
        self.assertEqual(late_verdict, 'in', 'a place answer that arrives late is applied to the reader')
        for title in KNOWN + LATE:   # both towns are asked about: their titles are sorted beside the call, once; no job is handed on the words (the next test)
            self.assertEqual(len(self.model.asked(title)), 1, f'{title}: asked once')


    def test_jobs_at_a_known_place_go_on_while_the_place_call_holds_only_the_jobs_it_asks_about(self):
        """sf place PR a (#3676 then sa's Mac run of p9 Lyon, 10 Nov 2026): 4 remote locations nobody had placed went to the place call (asked at 51 s,
        answered at 73 s) and the reader's ~100 jobs at Lyon, placed on earlier presses, waited behind it: first job 66 s instead of 20 s."""
        place_triage._keep(place_triage._key(feeds._SEARCH), {place_triage.norm('Known town'): 'in'})   # placed on an earlier press
        feeds.PLACED = None
        mapped = [f'Mapped role {n}' for n in range(2)]   # a town only the map's cache knows (geo.resolve ask=False): no model call for it either
        employer = self.jobs(KNOWN, 'Known town') + self.jobs(LATE, 'Late town') + self.jobs(mapped, 'Map town')
        log_at_answer, handed, handed_at_answer = [], [], []
        map_asked = []

        def the_map(locations, words, client=None, ask=True):
            map_asked.append((sorted(locations), ask))
            return {place_triage.norm('Map town'): 'in'} if place_triage.norm('Map town') in locations else {}

        def release_when_known_titles_are_asked():
            for _ in range(2000):   # 5 s of 2.5 ms polls: a hang guard
                if len(handed) >= len(KNOWN + mapped) and self.model.asked('place asked'):
                    break
                threading.Event().wait(0.0025)
            log_at_answer.extend(self.model.log)
            handed_at_answer.extend(handed)
            self.model.gate.set()
        releaser = threading.Thread(target=release_when_known_titles_are_asked)
        with title_queue.hub(), batch_scope.concurrent(), mock.patch.object(geo, 'verdicts', the_map):
            releaser.start()
            with batch_scope.reader('employer sites'), title_queue.handing_to(lambda jobs: handed.extend(job['title'] for job in jobs)):
                feed_places.triage_with_places(employer)
        releaser.join(30)
        self.assertEqual(sorted(handed_at_answer), sorted(KNOWN + mapped), 'the jobs at known places reached the list while the place call was held, and only they')
        self.assertNotIn(place_triage.norm('Map town'), [where for locations, ask in map_asked if ask for where in locations], 'the map\'s answer is not asked again')
        self.assertTrue({f'titles {t.lower()}' for t in KNOWN + mapped} <= set(log_at_answer), f'the known place\'s titles were asked while the place call was held: {log_at_answer}')
        self.assertEqual(sorted(handed), sorted(KNOWN + mapped + LATE), 'the asked place\'s jobs are handed after its answer')
        self.assertEqual(self.model.asked('place asked'), ['place asked'], 'one place call, for the asked place only')

    def test_the_held_jobs_titles_are_sorted_while_the_place_call_runs_and_handed_only_after_its_answer(self):
        """sa's read of CI run before-3, p10 Amsterdam (11 Nov 2026): one place call asked at 30.4 s answered at 95.7 s (65.3 s); the titles of the jobs at its locations were
        asked only after it, and at 116 s "81 title(s) wait for the next one". They are asked beside the call now; a job is still handed only once its place is known (#3512: "Paris, Texas")."""
        far = [f'Far role {n}' for n in range(2)]
        self.model.out = {'far town'}
        employer = self.jobs(LATE, 'Late town') + self.jobs(far, 'Far town')
        handed, at_answer = [], {}

        def release_when_held_titles_are_asked():
            for _ in range(2000):   # 5 s of 2.5 ms polls: a hang guard
                if self.model.asked('place asked') and all(self.model.asked(title) for title in LATE + far):
                    break
                threading.Event().wait(0.0025)
            at_answer['log'], at_answer['handed'] = list(self.model.log), list(handed)
            self.model.gate.set()
        releaser = threading.Thread(target=release_when_held_titles_are_asked)
        with title_queue.hub(), batch_scope.concurrent():
            releaser.start()
            with batch_scope.reader('employer sites'), title_queue.handing_to(lambda jobs: handed.extend(job['title'] for job in jobs)):
                feed_places.triage_with_places(employer)
        releaser.join(30)
        self.assertNotIn('place answered', at_answer['log'], 'positive control: the place call was still held when the log was read')
        self.assertEqual(sorted(entry for entry in at_answer['log'] if entry.startswith('titles')), sorted(f'titles {t.lower()}' for t in LATE + far),
                         'the held jobs\' titles were asked while the place call was in flight')
        self.assertEqual(at_answer['handed'], [], 'no held job was handed before its place was known')
        self.assertEqual(sorted(handed), sorted(LATE), 'after the answer: the jobs placed inside are handed, the ones placed outside never, though their titles fit')
        for title in LATE + far:
            self.assertEqual(len(self.model.asked(title)), 1, f'{title}: asked once')

    def test_a_kept_plain_out_this_run_finds_names_no_town_is_still_sorted(self):
        """Code review of sf place PR a: a place kept as plain 'out' (its "names no town" question not asked yet) was taken as known, its jobs sorted at once and
        skipped; this run's answer made it 'out:vague' (its postings are read) and the job was never sorted: dropped for the run, where main sorted it."""
        place_triage._keep(place_triage._key(feeds._SEARCH), {'switzerland': 'out'})
        feeds.PLACED = None
        self.model.gate.set()
        job = {'title': 'Vague role 1', 'location': 'Switzerland'}
        self.model.vague = True
        with mock.patch.object(place_triage, 'cannot_hold_places', lambda *a: False), mock.patch.object(place_triage, 'excluded_remote', lambda *a: False), \
                mock.patch.object(geo, 'cannot_hold', lambda *a: False), mock.patch.object(feeds, 'wanted_location', lambda job: feeds.place_of(job) not in (None, 'out')), \
                title_queue.hub(), batch_scope.concurrent(), batch_scope.reader('employer sites'):
            feed_places.triage_with_places([job])
        self.assertEqual(len(self.model.asked('vague role 1')), 1, f'its title is sorted after the answer: {self.model.log}')

    def test_a_map_that_cannot_be_read_leaves_its_jobs_waiting_and_the_read_goes_on(self):
        """Code review of sf place PR a: the map read moved into the reader's thread, and feed_scan calls triage_with_places without a try."""
        self.model.gate.set()
        with mock.patch.object(place_triage, 'known_now', side_effect=AttributeError('a map entry of an old shape')), title_queue.hub(), batch_scope.concurrent(), \
                batch_scope.reader('employer sites'):
            feed_places.triage_with_places(self.jobs(LATE, 'Late town'))
        self.assertEqual(len(self.model.asked('place asked')), 1, 'the place call still asked')
        self.assertTrue(all(len(self.model.asked(title)) == 1 for title in LATE), 'and the titles sorted after it')

    def test_a_free_job_api_read_asks_where_its_remote_jobs_are_and_keeps_the_answers(self):
        """WP8 rule 7 (#3754, wj; p10 Amsterdam on main, 12 Nov 2026): the free APIs' lane judged only titles, so 695 of 708 waiting jobs of Jobicy, Himalayas and Arbeitnow stayed at a
        location nobody placed (Jobicy: 250 jobs at 38 locations, "Remote (Europe)" among them) press after press: no other reader asks the places of jobs that are not in the list yet."""
        from src.sources import api_lane
        jobs = [{'company': 'A', 'id': str(n), 'title': f'Role {n}', 'url': f'https://x.test/{n}', 'location': 'Remote (Europe)', 'remote': True, 'salary': '', 'description': '', 'date_posted': ''}
                for n in range(3)]
        self.model.gate.set()
        with title_queue.hub(), batch_scope.concurrent():
            found, views = api_lane._read('Jobicy', lambda search: jobs, {})
            with batch_scope.using(views):
                verdicts = {feeds.place_of(job) for job in found}
        self.assertTrue(self.model.asked('place asked'), 'the lane sent its jobs\' locations to the place call')
        self.assertEqual(verdicts, {'in'}, 'and the answers are in the views the stage keeps its jobs with')


class RealTitleWordsStillSeeTheNewLocations(unittest.TestCase):
    """Review of #3512: beside the sort, the place call raced feeds.ASKED (after it `wanted_title` stops using the role words) and, on a few thousand jobs, placed nothing."""

    def test_a_big_list_of_word_matching_unjudged_titles_still_gets_its_locations_placed(self):
        tmp, model, towns = pathlib.Path(tempfile.mkdtemp()), Model(), [f'Town {n}' for n in range(50)]
        model.gate.set()
        jobs = [{'title': f'Role {n}', 'location': towns[n % 50]} for n in range(3000)]
        with mock.patch.object(place_triage, 'STORE', tmp / 'p.json'), mock.patch.object(title_triage, 'STORE', tmp / 't.json'), mock.patch.object(geo, 'STORE', tmp / 'g.json'), \
                mock.patch.object(engine, 'ready', return_value=True), mock.patch.object(engine, 'client', lambda **kw: model), mock.patch.object(geo, 'verdicts', lambda *args, **kw: {}), \
                mock.patch.object(feeds, 'TITLES', feeds.keyword_regex(['role'])), mock.patch('builtins.print'), \
                title_queue.hub(), batch_scope.concurrent(), batch_scope.reader('employer sites'):
            feeds.PLACED = feeds.TRIAGED = feeds.READ = None
            self.addCleanup(lambda: setattr(feeds, 'PLACED', None) or setattr(feeds, 'TRIAGED', None) or setattr(feeds, 'READ', None))
            feed_places.triage_with_places(jobs)
            placed = {feeds.place_of(job) for job in jobs}
        self.assertTrue(model.asked('place asked'), 'the new locations were sent to the place call')
        self.assertEqual(placed, {'in'}, 'and every location\'s answer applied')


class TheEmployerReaderUsesIt(unittest.TestCase):
    def test_the_employer_scan_places_and_sorts_through_the_one_function_not_one_after_the_other(self):
        """The caller wiring (src/sources/feed_scan.py): a scan that went back to feeds.triage_places() then feeds.triage() would hold the hub again."""
        with tempfile.TemporaryDirectory() as tmp, store.connect(pathlib.Path(tmp) / 'jobs.sqlite') as db, \
                mock.patch.object(feed_places, 'triage_with_places') as beside, mock.patch.object(feeds, 'triage_places') as places, mock.patch.object(feeds, 'triage') as titles, \
                mock.patch.object(feeds, 'wanted_location', return_value=False), mock.patch.object(feeds, 'sure_title', return_value=False):
            feed_scan.scan([{'company': 'Skyair', 'ats': 'lever', 'slug': 'skyair'}], db,
                           fetcher=lambda source: [{'id': 1, 'title': 'Pilot', 'location': 'Berlin', 'url': 'https://x.test/1'}])
        self.assertEqual([call.args[0][0]['title'] for call in beside.call_args_list], ['Pilot'], 'the jobs read go to the one function, once')
        places.assert_not_called()
        titles.assert_not_called()


if __name__ == '__main__':
    unittest.main()
