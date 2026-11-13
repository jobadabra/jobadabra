"""Careers-page words are the AI's call first (audit PR 7, owner 26 Oct 2026): every 'page-words' answer is placed (link-kind, title-kind or the
page reader), the AI's kind of a wording beats the old words, a capped or failed AI leaves it unknown (never a keyword's guess), and the old
words answer only with no AI at all."""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from src.ai import decide, meanings_pack, page_words  # noqa: E402
from src.sources import careers, careers_explore  # noqa: E402

PAGE = '<a href="/karriere">Karriere</a><a href="/news">Careers news</a><a href="/vagas">Vagas abertas</a><a href="/about">About us</a>'


def answering(table, default='other'):
    """A stand-in for decide.decide: the AI's fixed answer for each wording in `table` (a substring match), `default` for the rest."""
    def fake(topic, items, answers, task, *args, **kwargs):
        return {key: next((kind for word, kind in table.items() if word in text.lower()), default) for key, text in items.items()}
    return fake


class EveryAnswerIsPlaced(unittest.TestCase):
    def test_each_page_words_answer_is_ai_first_or_named_structure(self):
        answers = meanings_pack.schema()['page-words']['answers']
        self.assertEqual(sorted(answers), sorted(page_words.PLACED), 'a new page-words answer must be placed in page_words.PLACED')
        for answer in answers:
            place = page_words.PLACED[answer]
            self.assertIn(place, (page_words.LINK, page_words.TITLE, 'page-reader'), answer)
            if place != 'page-reader':
                self.assertTrue(meanings_pack.ai_first(place), f'{answer}: {place} must be an ai_first topic')

    def test_every_link_kind_answer_reads_as_words(self):
        for kind in page_words.LINK_ANSWERS:
            self.assertIsInstance(page_words.from_kind(kind), page_words.Words, kind)
        self.assertTrue(page_words.from_kind('job_list').strong)
        self.assertTrue(page_words.from_kind('not_jobs').not_jobs)
        self.assertFalse(any(page_words.from_kind('other')))


class AIFirst(unittest.TestCase):
    def setUp(self):
        self.on = mock.patch.object(page_words, 'ai_on', return_value=True)
        self.on.start()
        self.addCleanup(self.on.stop)

    def test_the_ais_kind_decides_in_any_language_and_the_words_are_never_asked(self):
        table = {'vagas abertas': 'job_list', 'careers news': 'not_jobs', 'karriere': 'careers_page'}
        with mock.patch.object(decide, 'decide', answering(table)), mock.patch.object(page_words, 'floor_words', side_effect=AssertionError('words asked')):
            found = careers.careers_links(PAGE, 'https://acme.example/')
        self.assertEqual(found, ['https://acme.example/vagas', 'https://acme.example/karriere'])

    def test_a_capped_or_failed_ai_leaves_links_unjudged_not_guessed(self):
        with mock.patch.object(decide, 'decide', return_value=None), mock.patch.object(page_words, 'floor_words', side_effect=AssertionError('words asked')):
            self.assertEqual(careers.careers_links(PAGE, 'https://acme.example/'), [])
            self.assertEqual(page_words.title_kinds(['Software Engineer']), {'Software Engineer': None})
            self.assertEqual(page_words.host_named(['jobs.acme.com']), {'jobs.acme.com': None})

    def test_titles_headings_and_unjudged_entries(self):
        with mock.patch.object(decide, 'decide', answering({'life at': 'heading', 'pflegefachfrau': 'job_title'}, default='heading')):
            kinds = page_words.title_kinds(['Life at Acme', 'Pflegefachfrau 80%'])
        self.assertEqual(kinds, {'Life at Acme': 'heading', 'Pflegefachfrau 80%': 'job_title'})

    def test_a_page_the_reader_has_not_read_is_not_known_to_be_empty(self):
        page = '<p>Leider keine offenen Stellen</p>'
        with mock.patch('src.ai.page_reader.said_no_open_jobs', return_value=False):
            self.assertFalse(careers_explore._says_no_jobs(page, 'https://acme.example/jobs'))
        with mock.patch('src.ai.page_reader.said_no_open_jobs', return_value=True):
            self.assertTrue(careers_explore._says_no_jobs(page, 'https://acme.example/jobs'))


class JobCardsByFolder(unittest.TestCase):
    """A board page's job cards (numbered links of one folder) are judged by three of them; menus are asked one by one (13 Nov 2026)."""
    CARDS = [(f'Data Analyst {n} (m/w/d)', f'/stellenangebote/data-analyst-{n}00{n}') for n in range(1, 41)]
    MENU = [('Karriere', '/karriere'), ('Über uns', '/about'), ('Jobs finden', '/jobs')]

    def setUp(self):
        self.on = mock.patch.object(page_words, 'ai_on', return_value=True)
        self.on.start()
        self.addCleanup(self.on.stop)
        self.asked = []

    def ai(self, table, default='other'):
        answer = answering(table, default)
        def fake(topic, items, *args, **kwargs):
            self.asked.append(len(items))
            return answer(topic, items, *args, **kwargs)
        return fake

    def test_forty_cards_and_a_menu_ask_six_wordings_once_and_every_card_is_a_job_page(self):
        with mock.patch.object(decide, 'decide', self.ai({'data analyst': 'job_page', 'karriere': 'careers_page', 'jobs finden': 'job_list'})):
            found = page_words.link_words(self.CARDS + self.MENU)
        self.assertEqual(self.asked, [6])   # 3 menu links + 3 sampled cards, one call
        self.assertTrue(all(found[card].job_path for card in self.CARDS))
        self.assertTrue(found[('Jobs finden', '/jobs')].strong)
        self.assertFalse(found[('Über uns', '/about')].job_path)

    def test_samples_that_disagree_get_every_link_of_the_folder_asked(self):
        with mock.patch.object(decide, 'decide', self.ai({'data analyst 1 ': 'not_jobs', 'data analyst': 'job_page'})):
            found = page_words.link_words(self.CARDS)
        self.assertEqual(self.asked, [3, 37])
        self.assertTrue(found[self.CARDS[0]].not_jobs)
        self.assertTrue(found[self.CARDS[5]].job_path)

    def test_an_unjudged_sample_never_answers_for_its_folder(self):
        with mock.patch.object(decide, 'decide', return_value=None):
            found = page_words.link_words(self.CARDS)
        self.assertEqual(set(found.values()), {None})

    def test_a_few_numbered_links_and_links_without_a_number_are_asked_one_by_one(self):
        few = self.CARDS[:5] + [(f'Team {n}', f'/team/{name}') for n, name in enumerate(['anna', 'ben', 'cleo', 'dana', 'eli', 'fay', 'gus'])]
        with mock.patch.object(decide, 'decide', self.ai({})):
            page_words.link_words(few)
        self.assertEqual(self.asked, [12])


class NoAIAtAll(unittest.TestCase):
    def test_the_old_words_answer_as_the_offline_floor(self):
        with mock.patch.object(page_words, 'ai_on', return_value=False), mock.patch.object(decide, 'decide', return_value=None):
            found = careers.careers_links(PAGE, 'https://acme.example/')
            self.assertIn('https://acme.example/karriere', found)
            self.assertNotIn('https://acme.example/about', found)
            self.assertEqual(page_words.title_kinds(['Senior Search Engineer'])['Senior Search Engineer'], 'job_title')
            self.assertTrue(careers_explore._says_no_jobs('<p>Leider keine offenen Stellen</p>'))


if __name__ == '__main__':
    unittest.main()
