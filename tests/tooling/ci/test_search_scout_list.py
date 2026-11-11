"""Guard: privacy — the night records what the Central Scout's list gave each person (scout measure, sm, 11 Nov 2026) from the press's cached list, which is private learned data and the
night's artifacts are downloadable: tools/persona-search/scout_list.py may write per-person counts only, never an employer's name or a list-wide number (feeds served, the publish id); it stops unless both of the persona's own folders are
set (never the owner's app); and a person whose list or kind is unknown reads None, never 0."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools/persona-search'))
import scout_list as sl  # noqa: E402

SECRET = 'Zorblax Hidden Employer'
FEEDS = [
    {'company': SECRET, 'ats': 'greenhouse', 'slug': 'zorblax', 'places': ['Lyon'], 'kinds': {'trades': 1.0}},
    {'company': 'Other Co', 'ats': 'lever', 'slug': 'other', 'places': ['Lyon'], 'kinds': {'software': 1.0}, 'kind_counts': {'fr': {'software': 5}}},
    {'company': 'No Mix Co', 'ats': 'lever', 'slug': 'nomix', 'places': ['Lyon']},
    {'company': 'Faraway Co', 'ats': 'lever', 'slug': 'far', 'places': ['Oslo'], 'kinds': {'trades': 1.0}},
    {'company': 'Empty Co', 'ats': 'lever', 'slug': 'empty', 'fresh': {'ok': '2026-11-10', 'fails': 0, 'jobs': 0, 'trend': 'flat', 'new': None}},   # no open job, no place: in every person's places
]


def here(job):
    return 'lyon' in str(job.get('location') or '').lower()


def judged(*rows):
    return [{'title': t, 'company': c, 'location': 'Lyon', 'provider': c, 'kind': 'employer feed', 'role': role, 'place': place} for t, c, role, place in rows]


class Counts(unittest.TestCase):
    def test_n_k_and_the_four_classes_of_the_rest(self):
        out, kept = sl.split(FEEDS, here, {'trades'}, ['fr'])
        self.assertEqual((out['in_places'], out['for_role'], len(kept)), (4, 1, 1))
        self.assertEqual((out['empty_feeds'], out['no_kind_mix'], out['mix_only'], out['counted_per_country']), (1, 1, 1, 1), 'no open job; no kind counted; whole mix only (read); counted per country')
        self.assertEqual(out['kind_not_theirs'], 1, 'Other Co has a mix and it is software, not trades')
        self.assertEqual(out['in_places'], out['empty_feeds'] + out['no_kind_mix'] + out['mix_only'] + out['counted_per_country'], 'every employer of N is in one class')

    def test_a_feed_with_no_open_job_is_never_a_scout_gap(self):
        out, _ = sl.split([FEEDS[-1]], here, {'trades'}, None)
        self.assertEqual((out['empty_feeds'], out['no_kind_mix']), (1, 0), 'sk, lab#87: 363 empty feeds read as "no kind counted" for every person')

    def test_an_undecided_kind_is_not_measured_never_zero(self):
        for kinds in (None, {'unknown'}):   # role_kinds.UNKNOWN: every word of the search unsure, no list is read in bulk whatever the scout counted (Gitar on #3809)
            out, kept = sl.split(FEEDS, here, kinds, ['fr'])
            self.assertEqual((out['in_places'], out['kinds_known'], kept), (4, False, []))
            self.assertTrue(all(out[word] is None for word in ('for_role', 'kind_not_theirs')))
            self.assertEqual((out['empty_feeds'], out['no_kind_mix'], out['mix_only'], out['counted_per_country']), (1, 1, 1, 1), 'the classes do not depend on the person\'s kind')
            self.assertNotIn('served', out, 'a list-wide number never leaves the press')

    def test_the_join_counts_right_jobs_of_listed_employers_in_memory(self):
        rows = judged(('Welder', SECRET, 'yes', 'yes'), ('Welder II', SECRET, 'yes', 'no'), ('Dev', 'Other Co', 'yes', 'yes'), ('Cook', 'Not Listed', 'yes', 'yes'))
        rows.append({**rows[0], 'title': 'Board job', 'kind': 'job board', 'company': SECRET, 'provider': SECRET})   # a board's job is not an employer-feed job of the list
        with mock.patch('src.store.label', side_effect=lambda text: text):
            out = sl.join(FEEDS, {SECRET.casefold()}, rows)
        self.assertEqual(out, {'listed_from_list': 3, 'right_from_list': 2, 'employers_right_from_list': 2, 'right_from_role': 1})


class Written(unittest.TestCase):
    def run_measure(self, tmp, env, cached):
        env = {**env, 'JOBADABRA_CONFIG_DIR': tmp}
        Path(tmp, 'search.json').write_text('{}', encoding='utf-8')
        result, judged_path = Path(tmp, 'result.json'), Path(tmp, 'judged.json')
        result.write_text(json.dumps({'persona': 1, 'found': 2}), encoding='utf-8')
        judged_path.write_text(json.dumps({'rows': judged(('Welder', SECRET, 'yes', 'yes'))}), encoding='utf-8')
        with mock.patch.dict(os.environ, env), mock.patch('src.employer_index._read', return_value=cached), mock.patch('src.employer_index.me_now', return_value={}), \
                mock.patch('src.role_kinds.of_search', return_value={'trades'}):
            done = sl.annotate(str(result), str(judged_path), here)
        return done, result.read_text(encoding='utf-8')

    def test_only_counts_and_the_publish_id_are_written_never_a_name(self):
        env = {'JOBADABRA_DATA_DIR': tempfile.gettempdir(), 'JOBADABRA_CONFIG_DIR': tempfile.gettempdir()}
        with tempfile.TemporaryDirectory() as tmp:
            done, text = self.run_measure(tmp, env, {'feeds': FEEDS, 'generated': '2026-11-10T22:12:43.611Z'})
        self.assertTrue(done)
        self.assertNotIn(SECRET, text)
        self.assertNotIn('Other Co', text)
        scout = json.loads(text)['scout']
        self.assertEqual(set(scout), set(sl.WORDS))
        self.assertTrue(all(isinstance(value, (int, bool)) for value in scout.values()), 'per-person counts and a flag: nothing else leaves')
        self.assertNotIn('2026-11-10', text, 'the publish id is list-wide: it stays out of the public artifact')
        self.assertEqual((scout['in_places'], scout['for_role'], scout['right_from_list']), (4, 1, 1))

    def test_no_cached_list_claims_nothing(self):
        env = {'JOBADABRA_DATA_DIR': tempfile.gettempdir(), 'JOBADABRA_CONFIG_DIR': tempfile.gettempdir()}
        with tempfile.TemporaryDirectory() as tmp:
            done, text = self.run_measure(tmp, env, None)
        self.assertFalse(done)
        self.assertNotIn('scout', json.loads(text))

    def test_it_stops_unless_both_of_the_persona_s_own_folders_are_set(self):
        for missing in ('JOBADABRA_DATA_DIR', 'JOBADABRA_CONFIG_DIR'):
            env = {name: tempfile.gettempdir() for name in ('JOBADABRA_DATA_DIR', 'JOBADABRA_CONFIG_DIR') if name != missing}
            with mock.patch.dict(os.environ, env, clear=True), self.assertRaises(SystemExit):
                sl.measure([])


if __name__ == '__main__':
    unittest.main()
