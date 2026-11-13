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


RECORDED = json.loads((pathlib.Path(__file__).parents[2] / 'fixtures' / 'board_link_answers.json').read_text())['pages']
JOBISH = ('job_list', 'job_page', 'careers_page')
LINKS, ASKED, LIFTED = 4737, 3338, 14   # the 80 recorded pages: links, wordings asked, non-job links a job-agreed shape lifts


def replayed(rows):
    """(link_words' answers, wordings asked) for one recorded page: the stand-in AI gives each link the AI's own per-link answer."""
    answer, asked = {}, []
    for path, kind in rows:
        answer.setdefault(page_words._wording('', path), kind)

    def replay(topic, items, answers, task, floor=True):
        asked.extend(items.values())
        return {key: answer[wording] for key, wording in items.items()}
    return judge([path for path, _ in rows], replay), asked


class LinkShapes(unittest.TestCase):
    def test_a_uniform_shape_of_239_city_links_is_asked_through_three(self):
        ai = AI(odd=('/ofertas-empleo/',))   # each city link is a list of that city's jobs, as the AI answered it link by link (board_link_answers.json)
        got = judge(PAGES['trabajos'], ai)
        cities = [p for p in PAGES['trabajos'] if page_words._family(p) == '/ofertas-empleo/*']
        self.assertEqual(len(cities), 239, 'positive control: the saved page has its city links')
        self.assertEqual(len([w for w in ai.words() if '/ofertas-empleo/' in w and w.count('/') >= 2 and not w.endswith('/ofertas-empleo/')]), 3)
        self.assertTrue(all(got[('', p)] == page_words.from_kind('job_list') for p in cities), 'every city link has the AI\'s answer of its shape')

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
        asked = links = 0
        for page in ('infoempleo', 'trabajos', 'infojobs'):
            _, words = replayed(RECORDED[page])
            asked, links = asked + len(words), links + len(RECORDED[page])
        self.assertEqual(links, 128 + 288 + 53, 'positive control: the three Madrid pages with the AI\'s own answer for each link')
        self.assertLessEqual(asked, 130, f'{asked} wordings asked for {links} links')

    def test_without_ai_the_old_words_answer_every_link_as_before(self):
        with mock.patch.object(page_words, 'ai_on', return_value=False), mock.patch.object(page_words, '_kinds', return_value={}) as kinds:
            got = page_words.link_words([('', p) for p in PAGES['infojobs']])
        self.assertEqual(kinds.call_count, 1, 'one lookup of the kept answers, no sampling')
        self.assertTrue(all(value is not None for value in got.values()), 'the offline floor answers every link')

    def test_a_job_link_among_non_job_sections_keeps_its_own_answer(self):
        """Why (owner, 13 Nov 2026, asked via AskUserQuestion by sa: "Only job verdicts spread (Recommended)", issue #4038): a site's menu
        sections under one parent are one shape; 3 non-job samples gave their verdict to the section that lists jobs (jobup.ch's new offers)."""
        paths = ['/fr/job-coach/', '/fr/nouveaux-offres-emplois/', '/fr/professions/', '/fr/contact/', '/fr/sitemap/']   # the job list is no sample
        got = judge(paths, AI(odd=('nouveaux-offres',)))
        self.assertEqual(got[('', '/fr/nouveaux-offres-emplois/')], page_words.from_kind('job_list'), 'asked link by link, never the shape\'s "other"')
        ai = AI(jobs=('/offres/',))
        judge([f'/offres/electricien-{n}/' for n in 'abcdefghi'], ai)
        self.assertEqual(len(ai.words()), 3, 'positive control: a shape whose 3 samples are job pages still answers the rest')

    def test_the_boards_that_lost_job_links_keep_them_on_the_ais_own_answers(self):
        """Issue #4038: the job links the shape rule of #4022 gave a "not jobs" verdict, on the recorded pages (paths only)."""
        lost = {'jobup.ch 1': ['/fr/nouveaux-offres-emplois/'], 'villamedia.nl 1': ['/vacatures/P25'],
                'kimeta.de 1': ['/StaticPage/Stellenangebote', '/StaticPage/JobsBeiKimeta', '/StaticPage/EinstiegVertrieb', '/StaticPage/EinstiegSoftwareentwicklung']}
        for page, paths in lost.items():
            kinds = dict(RECORDED[page])
            got, _ = replayed(RECORDED[page])
            for path in paths:
                self.assertIn(kinds[path], JOBISH, f'positive control: the AI called {path} a job link')
                self.assertEqual(got[('', path)], page_words.from_kind(kinds[path]), f'{page} {path}')

    def test_on_80_recorded_pages_no_job_link_takes_a_non_job_verdict_from_its_shape(self):
        """Why (owner, 13 Nov 2026: "Only job verdicts spread (Recommended)"; issue #4038): the AI's own per-link answers for 80 saved board
        pages (tests/fixtures/board_link_answers.json: #4022's 4 and the wider measure's 76, 37 boards, 9 countries). Only a job verdict spreads,
        so no job link is lost; a shape of job pages can still lift a link the AI called not a job (it is then read and its page decides)."""
        asked = links = 0
        lost, lifted = [], []
        for page, rows in RECORDED.items():
            got, words = replayed(rows)
            asked, links = asked + len(words), links + len(rows)
            for path, kind in rows:
                now = got[('', path)]
                if kind in JOBISH and now != page_words.from_kind(kind):
                    lost.append((page, path))
                elif kind not in JOBISH and now != page_words.from_kind(kind):
                    lifted.append((page, path))
        self.assertEqual(len(RECORDED), 80, 'positive control: every recorded page')
        self.assertEqual(lost, [], 'no job link takes another verdict from its shape')
        self.assertEqual((links, asked, len(lifted)), (LINKS, ASKED, LIFTED))

    def test_when_the_ai_answers_no_sample_the_page_is_not_asked_a_second_time(self):
        ai = AI(none=('/',))
        got = judge(PAGES['trabajos'], ai)
        self.assertEqual(len(ai.asked), 1, 'one question; its links stay unknown this run')
        self.assertTrue(all(value is None for value in got.values()))


if __name__ == '__main__':
    unittest.main()
