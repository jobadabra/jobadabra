"""A board page's links are judged by shape: a family of 3+ links of one shape is asked through 3 of them (src/ai/page_words.py link_words).
Why (owner, 13 Nov 2026, asked via AskUserQuestion by sa: "Sample per shape, AI decides (Recommended)"): c04's three Madrid boards asked 502 link
wordings in 11 calls and got their links at 96 s. Fixture: tests/fixtures/board_link_paths.json (public link paths of those three results pages,
no link text); a stand-in AI that answers by path and records every wording it was asked."""
import json
import pathlib
import re
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
    def test_a_uniform_shape_of_239_city_links_is_asked_through_three(self):
        ai = AI()
        got = judge(PAGES['trabajos'], ai)
        cities = [p for p in PAGES['trabajos'] if page_words._family(p) == '/ofertas-empleo/*']
        self.assertEqual(len(cities), 239, 'positive control: the saved page has its city links')
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

    def test_a_minority_no_sample_hits_takes_its_shapes_answer_as_the_owner_chose(self):
        """The owner's rule (13 Nov 2026): 3 samples that agree decide the rest of the shape on that page. Its cost, measured on the AI's own
        per-link answers for 4 saved board pages (571 links, PR #4022): 0 links differ. A slug-prefix key (Gitar) split one board's
        underscore-separated city slugs and asked 206 wordings instead of 116 on the three Madrid pages, so the shape stays parent + *."""
        paths = [f'/trabajo/en_{n}/' for n in ('madrid', 'murcia')] + ['/trabajo/area-de-empresa_comercial/'] + [f'/trabajo/en_{n}/' for n in ('lugo', 'leon')]
        ai = AI(odd=('area-de-empresa',))
        judge(paths, ai)
        self.assertEqual(len(ai.words()), 5, 'positive control: the samples are the 1st, 3rd and 5th; the odd link is the middle one, so the family is asked in full')
        ai = AI(odd=('area-de-empresa',))
        paths = paths[:1] + paths[2:3] + paths[1:2] + paths[3:]   # the odd link second: no sample hits it
        got = judge(paths, ai)
        self.assertEqual(got[('', '/trabajo/area-de-empresa_comercial/')], page_words.from_kind('other'), 'takes the shape\'s answer, never asked')

    def test_on_the_ais_own_answers_the_shape_rule_changes_no_verdict_and_a_split_by_last_part_asks_three_times_more(self):
        """Why (owner, 13 Nov 2026, asked via AskUserQuestion by sa: "Keep our rule (Recommended)"): Gitar proposed splitting a shape by the
        last part's slug prefix, so unlike links under one parent are not decided by 3 samples. Replayed on the AI's own per-link answers for
        4 saved board pages (tests/fixtures/board_link_answers.json, 526 paths): the shape rule asks 143 and changes 0 verdicts; the split asks
        451 and changes 0 verdicts too. A shape is the parent + *, as the owner chose."""
        def split_by_last_part(path):   # Gitar's suggested key on #4022
            parts = [part for part in page_words._shape(path).split('/') if part]
            if len(parts) < 2:
                return None
            return '/' + '/'.join(parts[:-1]) + '/' + re.sub(r'^([a-z]+_|[a-z]+-[a-z-]+_).*', r'\1', parts[-1]) + '*'

        recorded = json.loads((pathlib.Path(__file__).parents[2] / 'fixtures' / 'board_link_answers.json').read_text())['pages']
        for family, want_asked in ((page_words._family, 143), (split_by_last_part, 451)):
            asked, differ, links = 0, [], 0
            for rows in recorded.values():
                answer = {page_words._wording('', path): kind for path, kind in rows}
                ai = AI()

                def replay(topic, items, answers, task, floor=True, ai=ai, answer=answer):
                    ai.asked.append(list(items))
                    return {key: answer[wording] for key, wording in items.items()}
                with mock.patch.object(page_words, '_family', family):
                    got = judge([path for path, _ in rows], replay)
                asked, links = asked + len(ai.words()), links + len(rows)
                differ += [path for path, kind in rows if got[('', path)] != page_words.from_kind(kind)]
            self.assertEqual(links, 526, 'positive control: every saved path has the AI\'s own answer')
            self.assertEqual((asked, differ), (want_asked, []), family.__name__)

    def test_when_the_ai_answers_no_sample_the_page_is_not_asked_a_second_time(self):
        ai = AI(none=('/',))
        got = judge(PAGES['trabajos'], ai)
        self.assertEqual(len(ai.asked), 1, 'one question; its links stay unknown this run')
        self.assertTrue(all(value is None for value in got.values()))


if __name__ == '__main__':
    unittest.main()
