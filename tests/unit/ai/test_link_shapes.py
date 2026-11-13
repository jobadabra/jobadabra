"""A board page's links are judged by shape: a family of 3+ links of one shape is asked through 3 of them (src/ai/page_words.py link_words).
Why (owner, 13 Nov 2026, asked via AskUserQuestion by sa: "Sample per shape, AI decides (Recommended)"): c04's three Madrid boards asked 502 link
wordings in 11 calls and got their links at 96 s. Fixture: tests/fixtures/board_link_paths.json (public link paths of those three results pages,
no link text); a stand-in AI that answers by path and records every wording it was asked."""
import json
import pathlib
import unittest
from unittest import mock

from src.ai import page_words

PAGES = json.loads((pathlib.Path(__file__).parents[2] / 'fixtures' / 'board_link_paths.json').read_text())


class AI:
    """Answers job_page for a path under `jobs`, `odd` for a path in `odd`, else other; records the wordings of each question."""
    def __init__(self, jobs=('/ofertas/0/',), odd=(), none=()):
        self.jobs, self.odd, self.none, self.asked = jobs, odd, none, []

    def __call__(self, topic, items, answers, task, floor=True):
        self.asked.append(list(items))
        out = {}
        for key, wording in items.items():
            if any(path in wording for path in self.none):
                continue
            out[key] = 'job_list' if any(path in wording for path in self.odd) else 'job_page' if any(path in wording for path in self.jobs) else 'other'
        return out

    def words(self):
        return [w for question in self.asked for w in question]


def judge(paths, ai):
    with mock.patch.object(page_words, 'ai_on', return_value=True), mock.patch.object(page_words.decide, 'decide', ai), mock.patch('builtins.print'):
        return page_words.link_words(('', path) for path in paths)


class LinkShapes(unittest.TestCase):
    def test_a_uniform_shape_of_248_city_links_is_asked_through_three(self):
        ai = AI()
        got = judge(PAGES['trabajos'], ai)
        cities = [p for p in PAGES['trabajos'] if page_words._family(p) == '/ofertas-empleo/*']
        self.assertGreater(len(cities), 200, 'positive control: the saved page has its city links')
        self.assertEqual(len([w for w in ai.words() if '/ofertas-empleo/' in w and w.count('/') >= 2 and not w.endswith('/ofertas-empleo/')]), 3)
        self.assertTrue(all(got[('', p)] == page_words.from_kind('other') for p in cities), 'every city link has the AI\'s answer of its shape')

    def test_the_40_job_links_of_trabajos_are_all_found(self):
        got = judge(PAGES['trabajos'], AI())
        jobs = [p for p in PAGES['trabajos'] if page_words._family(p) == '/ofertas/0/*']
        self.assertEqual(len(jobs), 40)
        self.assertTrue(all(got[('', p)] == page_words.from_kind('job_page') for p in jobs))

    def test_a_shape_whose_samples_disagree_is_asked_link_by_link(self):
        paths = [f'/trabajo/sitio-{n}/' for n in 'abcdefghi']   # the middle one (e) is another kind
        ai = AI(odd=('/trabajo/sitio-e/',))
        got = judge(paths, ai)
        self.assertEqual(len(ai.asked), 2, 'the samples first, then the rest of the shape')
        self.assertEqual(sorted(w.split('path: ')[1] for w in ai.words()), sorted(paths), 'every link asked once')
        self.assertEqual(got[('', '/trabajo/sitio-e/')], page_words.from_kind('job_list'))
        self.assertEqual(got[('', '/trabajo/sitio-b/')], page_words.from_kind('other'))

    def test_a_sample_the_ai_left_unanswered_leaves_the_shape_to_its_own_links(self):
        paths = [f'/empleo/zona-{n}/' for n in 'abcde']
        ai = AI(none=('/empleo/zona-a/',))
        got = judge(paths, ai)
        self.assertEqual(len(ai.words()), 5)
        self.assertIsNone(got[('', '/empleo/zona-a/')], 'not judged: skipped this run, never its shape\'s guess')
        self.assertEqual(got[('', '/empleo/zona-c/')], page_words.from_kind('other'))

    def test_one_part_links_are_always_asked_one_by_one(self):
        paths = ['/contacto/', '/empresas/', '/login/', '/ayuda/', '/blog/']
        ai = AI()
        judge(paths, ai)
        self.assertEqual(len(ai.words()), 5)

    def test_a_family_of_two_is_asked_link_by_link(self):
        ai = AI()
        judge(['/empresa/uno/', '/empresa/dos/'], ai)
        self.assertEqual(len(ai.words()), 2)

    def test_the_three_madrid_pages_ask_a_quarter_of_their_links(self):
        asked, links = 0, 0
        for page in ('infoempleo', 'trabajos', 'infojobs'):
            ai = AI()
            judge(PAGES[page], ai)
            asked, links = asked + len(ai.words()), links + min(len(PAGES[page]), page_words.MAX_WORDINGS)
        self.assertEqual(links, 128 + 299 + 53, 'positive control: per link, the AI was asked about 480 links')
        self.assertLessEqual(asked, 130, f'{asked} wordings asked for {links} links')

    def test_without_ai_the_old_words_answer_every_link_as_before(self):
        with mock.patch.object(page_words, 'ai_on', return_value=False), mock.patch.object(page_words, '_kinds', return_value={}) as kinds:
            got = page_words.link_words([('', p) for p in PAGES['infojobs']])
        self.assertEqual(kinds.call_count, 1, 'one lookup of the kept answers, no sampling')
        self.assertTrue(all(value is not None for value in got.values()), 'the offline floor answers every link')


if __name__ == '__main__':
    unittest.main()
