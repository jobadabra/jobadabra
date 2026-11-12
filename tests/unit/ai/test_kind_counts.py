"""An employer is read only when its jobs in the person's countries are their kind of work (owner, 26 Oct 2026, audit PR 4: "Not read" for an
employer not judged yet; old mostly-"other" mixes the same; the countries of job places judged by every install's AI and by the central scout).
The scout counts each feed's jobs by country and kind (`kind_counts`); a job whose title or place is not judged is left out, never guessed."""
import unittest
from unittest import mock

from src import employer_index, geo, pool_tags, role_kinds, scout, scout_core, scout_kind_counts
from src.ai import meanings
from src.ai import decide

KIND = {'First Officer': 'aviation_transport', 'Cabin Crew': 'aviation_transport', 'Backend Engineer': 'software', 'Accountant': 'finance_admin'}
PLACE = {'zurich': {'kind': 'city', 'cc': 'CH', 'lat': 47.37, 'lon': 8.54, 'r': 20}, 'frankfurt': {'kind': 'city', 'cc': 'DE', 'lat': 50.1, 'lon': 8.68, 'r': 20},
         'remote': {'kind': 'remote'}, 'somewhere': {'kind': 'unknown'}}


def judged(titles, topic='role-kind'):
    return {t: KIND[t] for t in titles if t in KIND}


class Fixtures(unittest.TestCase):
    def setUp(self):
        self.asked = []

        def resolve(strings, client=None, ask=True, share=False):
            keys = [geo.norm(s) for s in strings if s]
            if ask:
                self.asked.append(list(keys))
            return {k: PLACE[k] for k in keys if k in PLACE and (ask or k != 'frankfurt')}   # Frankfurt: only the AI knows it

        decide._calls['n'] = 0
        for patch in (mock.patch.object(role_kinds, 'judged', judged), mock.patch.object(geo, 'resolve', resolve),
                      mock.patch('src.ai.engine.ready', lambda *a, **k: True)):
            patch.start()
            self.addCleanup(patch.stop)


class ScoutCountsTest(Fixtures):
    def test_jobs_are_counted_by_their_country_and_kind(self):
        jobs = [{'title': 'First Officer', 'location': 'Zurich'}, {'title': 'Cabin Crew', 'location': 'Zurich'},
                {'title': 'Backend Engineer', 'location': 'Frankfurt'}, {'title': 'Accountant', 'location': 'Remote'},
                {'title': 'Backend Engineer', 'location': 'Somewhere'}]
        self.assertEqual(scout_kind_counts.kind_counts(jobs), {'ch': {'aviation_transport': 2}, 'de': {'software': 1}},
                         'remote and unknown places count nowhere (local jobs only)')
        self.assertEqual(self.asked, [['frankfurt']], 'the AI is asked only for places the cache and the shared pack do not know')
        self.assertEqual(decide._calls['n'], 1, 'its calls come out of the same per-run cap as every other AI answer')

    def test_past_the_cap_an_unplaced_job_is_left_out_never_guessed(self):
        decide._calls['n'] = decide.MAX_CALLS_PER_RUN
        jobs = [{'title': 'First Officer', 'location': 'Zurich'}] * 6 + [{'title': 'Backend Engineer', 'location': 'Frankfurt'}]
        self.assertEqual(scout_kind_counts.kind_counts(jobs), {'ch': {'aviation_transport': 6}})
        self.assertEqual(self.asked, [])

    def test_too_few_jobs_judged_publish_no_counts(self):
        decide._calls['n'] = decide.MAX_CALLS_PER_RUN
        jobs = [{'title': 'First Officer', 'location': 'Zurich'}] + [{'title': 'Backend Engineer', 'location': 'Frankfurt'}] * 4
        self.assertIsNone(scout_kind_counts.kind_counts(jobs), '1 of 5 jobs judged on both says little about the employer')



class CountriesFromPlaceAnswersTest(Fixtures):
    """Why (sk 2/4, 11 Nov 2026): the scout judged an employer's places three times (kind counts, country, region); the country is now read from the kind counts' place answers."""
    def setUp(self):
        super().setUp()
        self.pack = []

        def labels(topic, texts, choices, task):
            self.pack.append((topic, list(texts)))
            return ({}, list(texts))   # the pack knows none of them (labels_read and the scout's region asks both come here)
        patch = mock.patch.object(meanings, 'labels_each', labels)
        patch.start()
        self.addCleanup(patch.stop)

    def test_countries_come_from_the_place_answers_and_remote_or_unknown_name_none(self):
        found = pool_tags.countries_read(['Zurich', 'Frankfurt', 'Remote', 'Somewhere'], scout_kind_counts.country_ids)
        self.assertEqual(found, (['ch', 'de'], []))
        self.assertEqual(self.asked, [['frankfurt']], 'asked once, only what the cache and the pack do not know')
        self.assertEqual(self.pack, [], 'every word was answered by a place answer: no pool-country question')

    def test_a_place_past_the_cap_gets_the_pack_answer_only_and_is_otherwise_unanswered(self):
        decide._calls['n'] = decide.MAX_CALLS_PER_RUN
        self.assertEqual(pool_tags.countries_read(['Zurich', 'Frankfurt'], scout_kind_counts.country_ids), (['ch'], ['Frankfurt']))
        self.assertEqual((self.asked, self.pack), ([], [('pool-country', ['Frankfurt'])]), "the pack's old-list answers still count; nothing else is asked")

    def test_a_long_location_is_one_place_for_the_counts_and_the_country(self):
        long = 'Frankfurt am Main, Hessen, Deutschland, Europe, Mainzer Landstrasse 1, 60329 Frankfurt'
        self.assertGreater(len(long), 60)
        known, asked = {}, []

        def resolve(strings, client=None, ask=True, share=False):   # a cache that learns what it is asked
            keys = [geo.norm(s) for s in strings if s]
            if ask:
                asked.append(keys)
                known.update({k: {'kind': 'city', 'cc': 'DE', 'lat': 50.1, 'lon': 8.68, 'r': 20} for k in keys})
            return {k: known[k] for k in keys if k in known}
        with mock.patch.object(geo, 'resolve', resolve):
            scout_kind_counts.kind_counts([{'title': 'Backend Engineer', 'location': long}] * 3)
            found = pool_tags.countries_read([long], scout_kind_counts.country_ids)
        self.assertEqual(found, (['de'], []))
        self.assertEqual(asked, [[geo.norm(long)]], 'the full location is one cache key: asked once, not twice')

    def test_the_scouts_index_build_reads_the_full_location_for_countries(self):
        import tempfile
        from pathlib import Path
        from src import store
        long = 'Frankfurt am Main, Hessen, Deutschland, Europe, Mainzer Landstrasse 1, 60329 Frankfurt'
        PLACE[geo.norm(long)] = {'kind': 'city', 'cc': 'DE', 'lat': 50.1, 'lon': 8.68, 'r': 20}
        self.addCleanup(PLACE.pop, geo.norm(long))
        job = [{'id': '1', 'title': 'Backend Engineer', 'location': long, 'url': 'u', 'date_posted': '2099-01-01', 'description': '', 'remote': False, 'salary': ''}]
        with tempfile.TemporaryDirectory() as tmp, store.connect(Path(tmp) / 'j.sqlite') as db, mock.patch.object(scout_core, 'CENTRAL', True):
            db.executescript(scout.TABLES)
            feeds, _ = scout.build_index(db, [{'company': 'Co', 'ats': 'lever', 'slug': 'co'}], lambda s, slug: job, today='2026-11-11')
        self.assertEqual(feeds[0]['countries'], ['de'])
        self.assertEqual([t for t in self.pack if t[0] == 'pool-country'], [], 'no pool-country question for a place the place answers cover')


class RegionsFromPlaceAnswersTest(Fixtures):
    """Why (sa-pane-kp, 12 Nov 2026): the scout asked job-region about every place string the place answers (geo) had already put in a country: 93 of a run's
    200 calls judged places twice (jobadabra-lab #87). A placed place's region is now the AI's region answer for its country, asked once."""
    def setUp(self):
        super().setUp()
        self.regions, self.known = [], {'switzerland': 'europe', 'remote - emea': 'europe', 'frankfurt': 'europe'}
        PLACE['geneva'] = {'kind': 'city', 'cc': 'CH', 'lat': 46.2, 'lon': 6.14, 'r': 20}
        PLACE['remote - emea'] = {'kind': 'remote'}
        self.addCleanup(PLACE.pop, 'geneva')
        self.addCleanup(PLACE.pop, 'remote - emea')
        self.kept = {}

        def judged(topic, items, answers, instructions, **kwargs):   # the AI and decide's own cache: an answer kept is never asked again
            if topic != 'job-region':
                return None
            todo = sorted(k for k in items if k not in self.kept)
            if todo:
                self.regions.append(todo)
                self.kept.update({k: self.known[k] for k in todo if k in self.known})
            return {k: self.kept[k] for k in items if k in self.kept}
        for patch in (mock.patch.object(decide, 'decide', judged), mock.patch('src.ai.meanings_pack.every', lambda *a, **k: [])):
            patch.start()
            self.addCleanup(patch.stop)

    def build(self, places):
        import tempfile
        from pathlib import Path
        from src import store
        jobs = {slug: [{'id': str(n), 'title': 'Backend Engineer', 'location': where, 'url': f'u{n}', 'date_posted': '2099-01-01', 'description': '', 'remote': False,
                        'salary': ''} for n, where in enumerate(spots)] for slug, spots in places.items()}
        with tempfile.TemporaryDirectory() as tmp, store.connect(Path(tmp) / 'j.sqlite') as db, mock.patch.object(scout_core, 'CENTRAL', True):
            db.executescript(scout.TABLES)
            feeds, _ = scout.build_index(db, [{'company': slug, 'ats': 'lever', 'slug': slug} for slug in places], lambda s, slug: jobs[slug], today='2026-11-12', workers=1)
        return {f['slug']: f.get('regions') for f in feeds}

    def test_places_in_one_country_ask_its_region_once_for_every_feed(self):
        regions = self.build({'a': ['Zurich', 'Zurich', 'Remote - EMEA'], 'b': ['Geneva']})
        self.assertEqual(self.regions, [['switzerland'], ['remote - emea']],
                         'one ask for the country both places are in; a remote place is asked as before (its words may name a region)')
        self.assertEqual(regions, {'a': ['europe'], 'b': ['europe']})

    def test_a_country_with_no_region_answer_asks_its_places_as_before(self):
        del self.known['switzerland']   # the AI did not answer for the country (busy, past the cap)
        self.assertEqual(scout_kind_counts.region_ids(['Zurich']), ([], ['Zurich']), 'no region guessed from the country')
        self.assertEqual(self.regions, [['switzerland'], ['zurich']])

    def test_a_place_the_place_answers_lack_is_asked_as_before(self):
        self.assertEqual(scout_kind_counts.region_ids(['Frankfurt', 'remote']), (['europe', 'remote'], []), "'remote': the feed's own flag, never asked")
        self.assertEqual(self.regions, [['frankfurt']])


class CentralCapAndSampleTest(Fixtures):
    """Owner, 26 Oct 2026 ("Higher cap + sample"): after the recount only 9 of 2,517 employers had counts, the 60 calls a run shared by titles
    and places. The central scout gets its own cap; a big employer is judged on a sample of its titles and the counts scaled to all its jobs."""
    def test_the_central_scout_has_a_larger_cap_installs_keep_theirs(self):
        from src import scout_core
        self.assertEqual(decide.limit(), decide.MAX_CALLS_PER_RUN)
        decide._calls['n'] = decide.MAX_CALLS_PER_RUN
        with mock.patch.object(scout_core, 'CENTRAL', True):
            self.assertEqual(decide.limit(), decide.CENTRAL_MAX_CALLS)
            self.assertGreater(decide.CENTRAL_MAX_CALLS, decide.MAX_CALLS_PER_RUN)
            jobs = [{'title': 'Backend Engineer', 'location': 'Frankfurt'}] * 5
            self.assertEqual(scout_kind_counts.kind_counts(jobs), {'de': {'software': 5}}, "past an install's cap the central scout still asks")

    def test_a_big_employer_is_judged_on_a_sample_and_counted_for_all_its_jobs(self):
        asked = []
        spy = lambda titles, topic='role-kind': asked.append(len(titles)) or judged(titles, topic)
        jobs = [{'title': 'First Officer', 'location': 'Zurich'}, {'title': 'Backend Engineer', 'location': 'Frankfurt'}] * 300
        with mock.patch.object(role_kinds, 'judged', spy):
            kinds, counts = scout_kind_counts.of_jobs(jobs)
        self.assertEqual(set(counts), {'ch', 'de'}, 'a sample sees both halves of a list that alternates')
        self.assertEqual(counts['ch']['aviation_transport'] + counts['de']['software'], 600, 'scaled to all 600 jobs')
        self.assertAlmostEqual(counts['ch']['aviation_transport'], 300, delta=60)
        self.assertAlmostEqual(kinds['aviation_transport'], 0.5, delta=0.1)
        self.assertEqual(scout_kind_counts.sample(jobs), scout_kind_counts.sample(jobs), 'the same jobs each run: kept answers are reused')
        self.assertTrue(asked and max(asked) <= scout_kind_counts.SAMPLE, f'titles sent to the AI: {asked}')
        self.assertEqual(len(scout_kind_counts.sample(jobs[:7])), 7, 'a small employer: every job')

    def test_a_job_leaving_a_big_employer_keeps_the_sample_so_kept_answers_still_hit(self):
        for size in (100, 500, 2000):
            jobs = [{'id': str(n), 'title': f'Role {n}', 'location': 'Zurich'} for n in range(size)]
            before = {job['id'] for job in scout_kind_counts.sample(jobs)}
            after = {job['id'] for job in scout_kind_counts.sample(jobs[1:])}
            self.assertGreaterEqual(len(before & after), scout_kind_counts.SAMPLE - 1, f'{size} jobs: only the job that left may change')

    def test_the_run_log_says_how_many_employers_have_counts(self):
        from src.scout_index import published_line
        line = published_line(2, [], [{'ats': 'lever', 'kind_counts': {'ch': {'software': 3}}}, {'ats': 'lever'}])
        self.assertIn('Kind counts by country on 1 of 2 feeds', line)

    def test_the_run_log_says_how_many_employers_with_open_jobs_have_no_mix(self):
        # Why (12 Nov 2026, jobadabra-lab #87): the gap itself had no line; only feeds with open jobs and neither kinds nor counts are in it.
        from src.scout_index import published_line
        feeds = [{'ats': 'lever', 'fresh': {'jobs': 4}}, {'ats': 'lever', 'fresh': {'jobs': 0}},
                 {'ats': 'lever', 'fresh': {'jobs': 9}, 'kinds': {'software': 1.0}, 'checked': '2026-11-12'},
                 {'ats': 'lever', 'fresh': {'jobs': 2}, 'kind_counts': {'ch': {'software': 2}}, 'checked': '2026-11-12'}]
        self.assertIn('Open jobs, no mix: 1 of 4 feeds', published_line(4, [], feeds))


class ScoutUsesTheBrokerTest(unittest.TestCase):
    def test_the_run_cap_is_one_env_value_and_items_past_it_stay_unjudged(self):
        import os
        from unittest import mock

        from src import scout_core
        with mock.patch.object(scout_core, 'CENTRAL', True):
            with mock.patch.dict('os.environ', {'JOBADABRA_CENTRAL_MAX_CALLS': '40'}):
                self.assertEqual(decide.limit(), 40)
            with mock.patch.dict('os.environ', {'JOBADABRA_CENTRAL_MAX_CALLS': 'not a number'}):
                self.assertEqual(decide.limit(), decide.CENTRAL_MAX_CALLS)
            with mock.patch.dict('os.environ'):
                os.environ.pop('JOBADABRA_CENTRAL_MAX_CALLS', None)
                self.assertEqual(decide.limit(), decide.CENTRAL_MAX_CALLS)
        with mock.patch.dict('os.environ', {'JOBADABRA_CENTRAL_MAX_CALLS': '40'}):
            self.assertEqual(decide.limit(), decide.MAX_CALLS_PER_RUN, "an install never reads the scout's cap")


class LocatedFitTest(unittest.TestCase):
    PILOT = {'aviation_transport'}

    def test_an_employer_is_judged_by_its_jobs_in_your_countries(self):
        airline = {'company': 'Airline', 'places': ['Zurich'], 'kinds': {'software': 0.8, 'aviation_transport': 0.2},
                   'kind_counts': {'ch': {'aviation_transport': 9}, 'de': {'software': 60}}}
        tech = {'company': 'Tech with a hangar abroad', 'places': ['Zurich'], 'kinds': {'aviation_transport': 0.6, 'software': 0.4},
                'kind_counts': {'ch': {'software': 30}, 'de': {'aviation_transport': 45}}}
        kept = employer_index.relevant([airline, tech], lambda job: True, self.PILOT, countries=['ch'])
        self.assertEqual([f['company'] for f in kept], ['Airline'])

    def test_with_none_of_your_countries_counted_its_whole_mix_decides(self):
        airline = {'company': 'Airline', 'places': ['Zurich'], 'kinds': {'aviation_transport': 0.7, 'other': 0.3}, 'kind_counts': {'de': {'software': 3}}}
        self.assertEqual(len(employer_index.relevant([airline], lambda job: True, self.PILOT, countries=['ch'])), 1)

    def test_not_judged_or_an_old_mostly_other_mix_is_not_read(self):
        index = [{'company': 'Not counted yet', 'places': ['Zurich']},
                 {'company': 'Old mix, other unjudged', 'places': ['Zurich'], 'kinds': {'other': 0.9, 'legal': 0.1}, 'checked': '2026-10-25'}]
        self.assertEqual(employer_index.relevant(index, lambda job: True, self.PILOT, countries=['ch']), [])
        self.assertEqual(len(employer_index.relevant(index, lambda job: True, None)), 2, 'the search\'s kinds not known (no AI): nothing skipped by kind')

    def test_the_downloaded_index_keeps_only_fixed_counts(self):
        feed = {'company': 'Airline', 'ats': 'lever', 'slug': 'airline',
                'kind_counts': {'ch': {'aviation_transport': 9, 'hacking': 2, 'legal': 0, 'trades': True}, 'xx': {'software': 4}}}
        self.assertEqual(employer_index.clean([feed])[0]['kind_counts'], {'ch': {'aviation_transport': 9}})
        self.assertNotIn('kind_counts', employer_index.clean([{**feed, 'kind_counts': [['ch', 3]]}])[0])


if __name__ == '__main__':
    unittest.main()
