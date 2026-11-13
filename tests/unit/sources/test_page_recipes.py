"""Batch B: recipes learned from one AI read (src/sources/page_recipes.py), the AI link chooser, and the job-title check that tells menu
entries from jobs without AI. Fake models only."""
import json
import shutil
import sqlite3
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from src import employer_index  # noqa: E402
from src.ai import page_reader  # noqa: E402
from src.sources import ats, careers, page_recipes  # noqa: E402
from site_private import assert_site_accepts, needs_site  # noqa: E402

LISTING = ('<nav><a href="/de/about">Über uns</a><a href="/de/jobs">Jobs</a></nav>'
           '<ul><li><a href="/de/jobs/devops-engineer">DevOps Engineer 80-100%</a></li><li><a href="/de/jobs/sre">Site Reliability Engineer</a></li>'
           '<li><a href="/de/jobs/hr-lead">HR Lead</a></li></ul>')
SECTIONS = ('<h2 class="intro">Karriere bei Acme</h2><div class="job"><h3 class="job-title">DevOps Engineer (m/w/d)</h3><p>Zürich</p></div>'
            '<div class="job"><h3 class="job-title">Plattform-Ingenieur 100%</h3><p>Bern</p></div><h3 class="news">Firmenlauf 2026</h3>')
BASE = 'https://acme.ch/de/jobs'


def jobs(*pairs):
    return [ats._job(url or f'{BASE}#{i}', title, '', url or BASE) for i, (title, url) in enumerate(pairs)]


class RecipeTests(unittest.TestCase):
    def test_a_link_recipe_is_derived_from_the_models_answer_and_replays_without_it(self):
        answer = jobs(('DevOps Engineer 80-100%', 'https://acme.ch/de/jobs/devops-engineer'), ('Site Reliability Engineer', 'https://acme.ch/de/jobs/sre'))
        recipe = page_recipes.derive(LISTING, BASE, answer)
        self.assertEqual(recipe, {'kind': 'links', 'prefix': '/de/jobs'})
        titles = [title for title, _ in page_recipes.replay(recipe, LISTING, BASE)]
        self.assertEqual(titles, ['DevOps Engineer 80-100%', 'Site Reliability Engineer', 'HR Lead'])   # a new job on the page is read too

    def test_a_section_recipe_reads_jobs_written_as_headings(self):
        answer = jobs(('DevOps Engineer (m/w/d)', None), ('Plattform-Ingenieur 100%', None))
        recipe = page_recipes.derive(SECTIONS, BASE, answer)
        self.assertEqual(recipe, {'kind': 'tag', 'tag': 'h3', 'class': 'job-title'})
        self.assertEqual([t for t, _ in page_recipes.replay(recipe, SECTIONS, BASE)], ['DevOps Engineer (m/w/d)', 'Plattform-Ingenieur 100%'])

    def test_no_recipe_when_the_answer_cannot_be_replayed_or_the_pattern_grabs_everything(self):
        self.assertIsNone(page_recipes.derive(LISTING, BASE, jobs(('Something else', None))))
        many = ''.join(f'<a href="/x/{i}">Item {i}</a>' for i in range(30))
        self.assertIsNone(page_recipes.derive(many, 'https://acme.ch/x', jobs(('Item 1', 'https://acme.ch/x/1'))))

    def test_only_the_fixed_shape_is_ever_valid(self):
        for bad in ({'kind': 'links', 'prefix': '/(a|b)+'}, {'kind': 'regex', 'pattern': '.*'}, {'kind': 'tag', 'tag': 'script', 'class': 'x'},
                    {'kind': 'tag', 'tag': 'h3', 'class': 'x"><script>'}, {'kind': 'links', 'prefix': '/a', 'extra': 1}, 'links', None):
            self.assertFalse(page_recipes.valid(bad), bad)
            self.assertEqual(page_recipes.replay(bad, LISTING, BASE), [])

    def test_recipes_are_kept_per_page_and_come_from_the_index_when_not_learned_here(self):
        db = sqlite3.connect(':memory:')
        page_recipes.save(BASE, {'kind': 'links', 'prefix': '/de/jobs'}, db=db)
        self.assertEqual(page_recipes.load(BASE, db), {'kind': 'links', 'prefix': '/de/jobs'})
        page_recipes.forget(BASE, db)
        index = {'feeds': [{'ats': 'careers', 'slug': 'acme.ch__de__jobs', 'recipe': {'kind': 'links', 'prefix': '/de/jobs'}}]}
        with mock.patch.object(employer_index, '_read', return_value=index):
            self.assertEqual(page_recipes.load(BASE, db), {'kind': 'links', 'prefix': '/de/jobs'})


class NoCacheTests(unittest.TestCase):
    def test_a_cache_that_cannot_be_opened_means_no_recipe_not_a_crash(self):
        with mock.patch.object(page_recipes, '_db', side_effect=sqlite3.OperationalError('unable to open database file')):
            self.assertIsNone(page_recipes.load('https://nowhere.example/jobs'))


class ReadingWithRecipesTests(unittest.TestCase):
    def setUp(self):
        saved = careers.READER, careers.RENDER, careers.CHOOSER
        careers.RENDER = careers.CHOOSER = None
        self.addCleanup(lambda: (setattr(careers, 'READER', saved[0]), setattr(careers, 'RENDER', saved[1]), setattr(careers, 'CHOOSER', saved[2])))

    def test_a_recipe_answers_before_any_model_is_asked(self):
        careers.READER = lambda url, markup: self.fail('the recipe should answer')
        with mock.patch.object(page_recipes, 'load', return_value={'kind': 'tag', 'tag': 'h3', 'class': 'job-title'}):
            got = careers._asked(BASE, SECTIONS, [ats._job('x', 'Über uns', '', 'x')], fetch_page=lambda url: '')
        self.assertEqual([j['title'] for j in got], ['DevOps Engineer (m/w/d)', 'Plattform-Ingenieur 100%'])

    def test_menu_entries_are_told_from_jobs_without_ai(self):
        menu = [ats._job(str(i), t, '', 'x') for i, t in enumerate(['Über uns', 'Benefits', 'Kontakt'])]
        real = [ats._job(str(i), t, '', 'x') for i, t in enumerate(['Produktionsleiter (m/w) 100%', 'Konstrukteur 80-100%', 'Über uns'])]
        self.assertFalse(careers._plausible(menu))
        self.assertTrue(careers._plausible(real))


class FakeClient:
    def __init__(self, answer):
        self.calls, self.answer = [], answer
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(self.answer))], usage=None)


class ChooserTests(unittest.TestCase):
    HOME = '<a href="/produkte">Produkte</a><a href="/unternehmen/arbeiten-bei-uns">Arbeiten bei uns</a><a href="/kontakt">Kontakt</a>'

    def setUp(self):
        page_reader._reads['n'] = 0
        self.db = sqlite3.connect(':memory:')

    def test_the_model_picks_from_the_pages_own_links_and_is_asked_once_per_site(self):
        client = FakeClient({'links': ['https://acme.ch/unternehmen/arbeiten-bei-uns', 'https://evil.example/x']})
        self.assertEqual(page_reader.choose_links('https://acme.ch', self.HOME, client, self.db), ['https://acme.ch/unternehmen/arbeiten-bei-uns'])
        page_reader.choose_links('https://acme.ch', self.HOME, client, self.db)
        self.assertEqual(len(client.calls), 1)
        self.assertIn('untrusted', client.calls[0]['system'][0]['text'])

    def test_discover_follows_the_chosen_link_when_the_rules_found_nothing(self):
        careers_saved = careers.CHOOSER, careers.READER, careers.RENDER
        self.addCleanup(lambda: (setattr(careers, 'CHOOSER', careers_saved[0]), setattr(careers, 'READER', careers_saved[1]), setattr(careers, 'RENDER', careers_saved[2])))
        careers.READER = careers.RENDER = None
        careers.CHOOSER = lambda site, home: ['https://acme.ch/unternehmen/arbeiten-bei-uns']
        pages = {'https://acme.ch': self.HOME, 'https://acme.ch/unternehmen/arbeiten-bei-uns': '<script type="application/ld+json">' + json.dumps(
            {'@type': 'JobPosting', 'title': 'DevOps Engineer', 'url': '/jobs/devops', 'jobLocation': {'address': {'addressLocality': 'Zürich', 'addressCountry': 'CH'}}}) + '</script>'}
        fetch = lambda url: pages[url] if url in pages else (_ for _ in ()).throw(OSError(url))
        found = careers.discover('acme.ch', fetch)
        self.assertEqual(found['slug'], 'acme.ch__unternehmen__arbeiten-bei-uns')


class IndexCarriesRecipesTests(unittest.TestCase):
    def test_jobs_two_folders_under_a_prefix_or_the_root_get_a_links_recipe_with_their_depth(self):
        """Owner, 13 Nov 2026: "Yes, add depth (Recommended)": job boards whose cards link /oferta/<id>/<slug>, or /<id>/<slug> at the root."""
        for prefix in ('/oferta', ''):
            with self.subTest(prefix=prefix or 'root'):
                base = 'https://board.example/pesquisa?q=x'
                cards = ''.join(f'<li><a href="{prefix}/{100 + i}/vaga-{i}">Analista de Dados {i}</a></li>' for i in range(4))
                page = f'<nav><a href="/sobre">Sobre</a><a href="/empresas/lista">Empresas</a></nav><ul>{cards}</ul>'
                answer = jobs(*[(f'Analista de Dados {i}', f'https://board.example{prefix}/{100 + i}/vaga-{i}') for i in range(3)])
                recipe = page_recipes.derive(page, base, answer)
                self.assertEqual(recipe, {'kind': 'links', 'prefix': prefix, 'depth': 2})
                read = [t for t, _ in page_recipes.replay(recipe, page, base)]
                self.assertEqual([t for t in read if t.startswith('Analista')], [f'Analista de Dados {i}' for i in range(4)], 'a new card is read too')
                # Under the root every 2-folder link fits, a menu entry included (as every 1-folder link fits a one-level root recipe today):
                # _fits' MAX_FACTOR caps it, and the jobs' titles are judged after the read.
                self.assertEqual([t for t in read if not t.startswith('Analista')], ['Empresas'] if not prefix else [])

    def test_a_recipe_without_depth_replays_and_derives_exactly_as_before(self):
        nested = LISTING + '<a href="/de/jobs/team/lead">Team Lead</a>'   # a link one folder deeper is not read by a one-level recipe
        self.assertEqual([t for t, _ in page_recipes.replay({'kind': 'links', 'prefix': '/de/jobs'}, nested, BASE)],
                         ['DevOps Engineer 80-100%', 'Site Reliability Engineer', 'HR Lead'])
        self.assertEqual(page_recipes.replay({'kind': 'links', 'prefix': '/de/jobs', 'depth': 1}, nested, BASE),
                         page_recipes.replay({'kind': 'links', 'prefix': '/de/jobs'}, nested, BASE))
        both = SECTIONS.replace('</h3>', '</h3>', 1) + ''.join(f'<a href="/x/{i}/y">DevOps Engineer (m/w/d)</a>' for i in range(1))
        self.assertEqual(page_recipes.derive(both, BASE, jobs(('DevOps Engineer (m/w/d)', 'https://acme.ch/x/0/y'), ('Plattform-Ingenieur 100%', None))),
                         {'kind': 'tag', 'tag': 'h3', 'class': 'job-title'}, 'a page that had a sections recipe keeps it: old installs read it')

    def test_a_depth_is_a_whole_number_from_1_to_3_and_only_on_links(self):
        for bad in ({'kind': 'links', 'prefix': '/a', 'depth': 0}, {'kind': 'links', 'prefix': '/a', 'depth': 4}, {'kind': 'links', 'prefix': '/a', 'depth': '2'},
                    {'kind': 'links', 'prefix': '/a', 'depth': True}, {'kind': 'links', 'prefix': '/a', 'depth': 2.0}, {'kind': 'links', 'prefix': '/a', 'depth': None},
                    {'kind': 'tag', 'tag': 'h3', 'class': 'x', 'depth': 2}):
            self.assertFalse(page_recipes.valid(bad), bad)
        for good in ({'kind': 'links', 'prefix': '/a', 'depth': 3}, {'kind': 'links', 'prefix': '', 'depth': 2}):
            self.assertTrue(page_recipes.valid(good), good)

    def test_the_engine_keeps_a_valid_recipe_from_the_index_and_drops_a_bad_one(self):
        served = [{'company': 'A', 'ats': 'careers', 'slug': 'a.ch__jobs', 'recipe': {'kind': 'links', 'prefix': '/jobs'}},
                  {'company': 'B', 'ats': 'careers', 'slug': 'b.ch__jobs', 'recipe': {'kind': 'regex', 'pattern': '.*'}}]
        self.assertEqual([f.get('recipe') for f in employer_index.clean(served)], [{'kind': 'links', 'prefix': '/jobs'}, None])

    @needs_site
    @unittest.skipUnless(shutil.which('node'), 'node is not installed')
    def test_the_website_accepts_every_recipe_the_engine_accepts(self):
        samples = [{'kind': 'links', 'prefix': '/de/jobs'}, {'kind': 'tag', 'tag': 'h3', 'class': 'job-title'}, {'kind': 'links', 'prefix': '/(a)+'},
                   {'kind': 'tag', 'tag': 'script', 'class': 'x'}, {'kind': 'tag', 'tag': 'h3', 'class': 'job', 'x': 1},
                   {'kind': 'links', 'prefix': '/oferta', 'depth': 2}, {'kind': 'links', 'prefix': '', 'depth': 3}, {'kind': 'links', 'prefix': '/a', 'depth': 4}]
        script = ("import {recipeOf} from './api/employers.js'; console.log(JSON.stringify(JSON.parse(process.argv[1]).map(r => !!recipeOf(r))));")
        out = subprocess.run(['node', '--input-type=module', '-e', script, json.dumps(samples)], cwd=ROOT, capture_output=True, text=True, timeout=60)
        site_accepts = json.loads(out.stdout)
        # one way (owner, 21 Oct 2026): a recipe the engine takes, the site takes; the site may take more (it lands first)
        assert_site_accepts(self, [i for i, r in enumerate(samples) if page_recipes.valid(r)], [i for i, ok in enumerate(site_accepts) if ok], 'recipe samples')


if __name__ == '__main__':
    unittest.main()
