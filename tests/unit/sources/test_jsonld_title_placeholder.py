"""A job page's one JobPosting title that is an unfilled template field gives way to the page's heading (careers_parse._shown_title).
Why (13 Nov 2026, sd; jobadabra-lab board-discovery run 43502695338, Spain): a board's job pages carried JSON-LD `"title": "HV_JSON_TITULO"` (an unrendered template field), all 39 of its
local jobs shared that one title, the kinds-of-work question saw one title and the board was "no kinds of work from the AI: not kept". Gitar on #4046: a title
the page does not show is not always a template field, so the AI judges it (a fake answer here). Pages of that recorded shape with example names; no live site."""
import io
import json
import unittest
from contextlib import redirect_stdout
from unittest import mock

from src.sources import careers

URL = 'https://jobs.example/ofertas/1196594063/mozo-a-de-montaje/'


def page(ld_title, heading='Mozo/a de montaje - Exampletown', head_title=None, extra_postings=0):
    """A job page of the recorded shape: JSON-LD JobPosting data in <head>, the job's real title in the <h1> and <title>."""
    postings = [{'@type': 'JobPosting', 'title': ld_title, 'description': 'HV_JSON_FUNCIONES'}] + [{'@type': 'JobPosting', 'title': f'Other {n}'} for n in range(extra_postings)]
    head = f'<title>{head_title or "Ofertas de empleo: " + heading + " - Example Jobs"}</title>'
    body = f'<h1>{heading}</h1>' if heading else ''
    return f'<html><head>{head}<script type="application/ld+json">{json.dumps(postings if extra_postings else postings[0])}</script></head><body>{body}<p>Exampletown</p></body></html>'


def titles(markup, answer='template_field'):
    """(titles, log, asks): the page's titles when the AI answers `answer` to "is this title a template field" (None: no AI), and how often it was asked."""
    out = io.StringIO()
    with mock.patch('src.ai.decide.one', return_value=answer) as asked, redirect_stdout(out):
        return [job['title'] for job in careers.jsonld_jobs(markup, URL, job_page=True)], out.getvalue(), asked.call_count


class JsonLdTitleTheJobPageShows(unittest.TestCase):
    def test_a_probe_of_a_listing_page_never_asks_and_never_rewrites(self):
        """Gitar on #4081: the default call is a pure parse, also on a page of one posting under the board's own heading: no AI, the title as published."""
        with mock.patch('src.ai.decide.one', return_value='template_field') as asked:
            got = careers.jsonld_jobs(page('HV_JSON_TITULO', heading='Careers at Example'), URL)
        self.assertEqual((asked.call_count, [job['title'] for job in got]), (0, ['HV_JSON_TITULO']))

    def test_a_title_with_no_three_letter_word_is_kept_with_no_question(self):
        """Gitar on #4081: QA / a two-character title shares no 3+ letter word with anything, which is no doubt, not a reason to ask."""
        for ld_title in ('QA', 'IT', '工人'):
            got, _, asks = titles(page(ld_title, heading='Careers at Example'), 'template_field')
            self.assertEqual((got, asks), ([ld_title], 0), ld_title)

    def test_the_job_page_readers_ask_the_probes_do_not(self):
        """The reads of one job page from its own link pass job_page=True (careers one-page reads, board routes, board employers); the probes do not."""
        import inspect
        from src.sources import board_employers, board_routes
        for module in (careers, board_routes, board_employers):
            self.assertIn('job_page=True', inspect.getsource(module), module.__name__)
        from src.sources import board_layout, board_rendered, board_sections, careers_explore, visits_read
        for module in (board_layout, board_rendered, board_sections, careers_explore, visits_read):
            self.assertNotIn('job_page=True', inspect.getsource(module), module.__name__)

    def test_one_placeholder_on_forty_pages_is_one_question(self):
        """Gitar on #4066: the key is the title wording, not title+heading: a board's pages share a placeholder and differ in heading, so asking per pair was 40 calls."""
        keys = []

        def one(topic, key, *rest):
            keys.append(key)
            return 'template_field'
        with mock.patch('src.ai.decide.one', side_effect=one):
            got = [careers.jsonld_jobs(page('HV_JSON_TITULO', heading=f'Puesto numero {n} de montaje'), URL, job_page=True)[0]['title'] for n in range(40)]
        self.assertEqual(len(set(keys)), 1)
        self.assertEqual(len(set(got)), 40)

    def test_the_ai_sees_the_pages_heading_beside_the_title(self):
        """Gitar on #4062: a list page's "Careers" heading must not be read as the job's title on the strength of the title alone: the question holds both lines."""
        with mock.patch('src.ai.decide.one', return_value='job_title') as asked:
            careers.jsonld_jobs(page('Welder', heading='Careers at Example'), URL, job_page=True)
        self.assertEqual(asked.call_count, 1)
        self.assertEqual(asked.call_args.args[2], 'title: Welder\nheading: Careers at Example')

    def test_a_template_placeholder_title_gives_way_to_the_pages_heading(self):
        """Three job pages of one board, all with the same placeholder: three different titles, not one shared one."""
        got = [titles(page('HV_JSON_TITULO', heading=h))[0][0] for h in ('Electricista de mantenimiento', 'Mozo/a de montaje', 'Profesor/a de matemáticas')]
        self.assertEqual(got, ['Electricista de mantenimiento', 'Mozo/a de montaje', 'Profesor/a de matemáticas'])

    def test_the_whole_heading_is_the_title_not_its_part_before_a_dash(self):
        got, _, _ = titles(page('HV_JSON_TITULO', heading='Carnicero /a - Dependiente /a de Supermercado (Tenerife)'))
        self.assertEqual(got, ['Carnicero /a - Dependiente /a de Supermercado (Tenerife)'])

    def test_the_log_says_which_title_was_replaced(self):
        _, said, _ = titles(page('HV_JSON_TITULO'))
        self.assertIn("'HV_JSON_TITULO', which is not a job title", said)

    def test_the_ai_unsure_or_absent_keeps_the_structured_title_never_a_guess(self):
        for answer in (None, 'job_title'):
            self.assertEqual(titles(page('HV_JSON_TITULO'), answer)[0], ['HV_JSON_TITULO'], answer)

    def test_a_title_the_page_shows_is_kept_with_no_question(self):
        got, said, asks = titles(page('Mozo/a de montaje', heading='Mozo/a de montaje'))
        self.assertEqual((got, said, asks), (['Mozo/a de montaje'], '', 0))

    def test_a_title_worded_differently_from_the_heading_is_kept_with_no_question(self):
        """Gitar on #4046: JSON-LD "Sr. Engineer" against a shown "Senior Engineer (m/w/d)": they share a word, nothing is replaced."""
        got, _, asks = titles(page('Sr. Engineer Controls', heading='Senior Engineer (m/w/d) - Controls'))
        self.assertEqual((got, asks), (['Sr. Engineer Controls'], 0))

    def test_a_real_title_drawn_by_script_is_kept_when_the_ai_says_it_is_a_title(self):
        """A one-posting page whose heading is "Careers" and whose title is nowhere in the markup: asked, answered a job title, kept."""
        got, _, asks = titles(page('Welder', heading='Careers at Example'), 'job_title')
        self.assertEqual((got, asks), (['Welder'], 1))

    def test_a_page_with_no_heading_keeps_the_structured_title_with_no_question(self):
        got, _, asks = titles('<html><head><script type="application/ld+json">' + json.dumps({'@type': 'JobPosting', 'title': 'Welder'}) + '</script></head><body><div id="app"></div></body></html>')
        self.assertEqual((got, asks), (['Welder'], 0))

    def test_a_listing_page_of_several_postings_is_not_touched(self):
        got, _, asks = titles(page('Welder', heading='Jobs in Exampletown', extra_postings=2))
        self.assertEqual((got, asks), (['Welder', 'Other 0', 'Other 1'], 0))


if __name__ == '__main__':
    unittest.main()
