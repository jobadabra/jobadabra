"""A job page's one JobPosting title that is an unfilled template field gives way to the page's heading (careers_parse._shown_title).
Why (13 Nov 2026, sd; lab run 43502695338, Spain): a board's job pages carried JSON-LD `"title": "HV_JSON_TITULO"` (an unrendered template field), all 39 of its
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
        return [job['title'] for job in careers.jsonld_jobs(markup, URL)], out.getvalue(), asked.call_count


class JsonLdTitleTheJobPageShows(unittest.TestCase):
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
