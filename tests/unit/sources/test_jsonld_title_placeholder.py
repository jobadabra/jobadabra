"""A job page's one JobPosting title must be a title the page shows (careers_parse._shown_title).
Why (13 Nov 2026, sd; lab run 43502695338, Spain): a board's job pages carried JSON-LD `"title": "HV_JSON_TITULO"` (an unrendered template field), all 39 of its
local jobs shared that one title, the kinds-of-work question saw one title and the board was "no kinds of work from the AI: not kept". Pages of that recorded
shape with example names; no AI call, no live site."""
import io
import json
import unittest
from contextlib import redirect_stdout

from src.sources import careers

URL = 'https://jobs.example/ofertas/1196594063/mozo-a-de-montaje/'


def page(ld_title, heading='Mozo/a de montaje - Exampletown', head_title=None, extra_postings=0):
    """A job page of the recorded shape: JSON-LD JobPosting data in <head>, the job's real title in the <h1> and <title>."""
    postings = [{'@type': 'JobPosting', 'title': ld_title, 'description': 'HV_JSON_FUNCIONES'}] + [{'@type': 'JobPosting', 'title': f'Other {n}'} for n in range(extra_postings)]
    head = f'<title>{head_title or "Ofertas de empleo: " + heading + " - Example Jobs"}</title>'
    body = f'<h1>{heading}</h1>' if heading else ''
    return f'<html><head>{head}<script type="application/ld+json">{json.dumps(postings if extra_postings else postings[0])}</script></head><body>{body}<p>Exampletown</p></body></html>'


def titles(markup):
    out = io.StringIO()
    with redirect_stdout(out):
        return [job['title'] for job in careers.jsonld_jobs(markup, URL)], out.getvalue()


class JsonLdTitleTheJobPageShows(unittest.TestCase):
    def test_a_template_placeholder_title_gives_way_to_the_pages_heading(self):
        """Three job pages of one board, all with the same placeholder: three different titles, not one shared one."""
        got = [titles(page('HV_JSON_TITULO', heading=h))[0][0] for h in ('Electricista de mantenimiento', 'Mozo/a de montaje', 'Profesor/a de matemáticas')]
        self.assertEqual(got, ['Electricista de mantenimiento', 'Mozo/a de montaje', 'Profesor/a de matemáticas'])

    def test_the_whole_heading_is_the_title_not_its_part_before_a_dash(self):
        got, _ = titles(page('HV_JSON_TITULO', heading='Carnicero /a - Dependiente /a de Supermercado (Tenerife)'))
        self.assertEqual(got, ['Carnicero /a - Dependiente /a de Supermercado (Tenerife)'])

    def test_the_log_says_which_title_was_replaced(self):
        _, said = titles(page('HV_JSON_TITULO'))
        self.assertIn("'HV_JSON_TITULO', which the page never shows", said)

    def test_a_title_the_page_shows_is_kept(self):
        got, said = titles(page('Mozo/a de montaje', heading='Mozo/a de montaje'))
        self.assertEqual((got, said), (['Mozo/a de montaje'], ''))

    def test_a_page_with_no_heading_keeps_the_structured_title_never_an_empty_one(self):
        """A script-rendered page: its heading is not in the markup, so the JSON-LD title stays."""
        got, _ = titles('<html><head><script type="application/ld+json">' + json.dumps({'@type': 'JobPosting', 'title': 'Welder'}) + '</script></head><body><div id="app"></div></body></html>')
        self.assertEqual(got, ['Welder'])

    def test_a_listing_page_of_several_postings_is_not_touched(self):
        """Its postings' titles are the list's rows, which a script may draw: only a page of ONE posting is a job page."""
        got, _ = titles(page('Welder', heading='Jobs in Exampletown', extra_postings=2))
        self.assertEqual(got, ['Welder', 'Other 0', 'Other 1'])


if __name__ == '__main__':
    unittest.main()
