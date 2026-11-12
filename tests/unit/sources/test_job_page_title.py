"""A job page with no job data is read by its heading (careers.job_from_page). Its title is the first <h1> that is not the site's own name as the
page declares it (og:site_name, the WebSite/Organization JSON-LD name); a page whose only heading is the site's name is a failed read, said in
the log, never a job (#3901, 12 Nov 2026: a board's job pages put the site's logo in the first <h1>, so 20 rows were titled with the site's name).
Pages of that recorded shape with example names; no AI call, no live site."""
import io
import json
import re
import unittest
from contextlib import redirect_stdout
from unittest import mock

from src.sources import careers

FAILED_READ = "Job page: its only heading is the site's own name, not a job title; not read as a job:"
URL = 'https://jobs.example/vacancies/maths-teacher-secondary-1211'


def page(*headings, og=None, ld=None, title='Maths teacher for secondary school - Example Teachers'):
    """A job page of the recorded shape: no JobPosting; the site's logo or name in a heading, the job's title in a later one."""
    meta = f'<meta property="og:site_name" content="{og}">' if og else ''
    data = f'<script type="application/ld+json">{json.dumps(ld)}</script>' if ld else ''
    body = ''.join(f'<h1 class="h{n}">{text}</h1>' for n, text in enumerate(headings))
    return (f'<html><head><title>{title}</title>{meta}{data}</head><body><header>{body[:body.index("</h1>") + 5] if headings else ""}</header>'
            f'<main>{body[body.index("</h1>") + 5:] if headings else ""}<p>A school in Exampletown looks for a maths teacher.</p></main></body></html>')


SITE_LD = {'@context': 'https://schema.org', '@graph': [{'@type': 'WebSite', 'name': 'Example Teachers'},
                                                        {'@type': 'Organization', 'name': 'Example Teachers'}]}


class AJobPageWithNoJobData(unittest.TestCase):
    def setUp(self):
        patch = mock.patch.object(careers, '_places', return_value=re.compile(r'exampletown', re.I))
        patch.start()
        self.addCleanup(patch.stop)

    def read(self, markup):
        with redirect_stdout(io.StringIO()) as said:
            job = careers.job_from_page(markup, URL)
        return job, said.getvalue()

    def test_the_sites_name_in_the_first_heading_is_not_the_title_when_its_json_ld_names_the_site(self):
        job, _ = self.read(page('<a href="/"><img alt="Example Teachers"> Example Teachers</a>', 'Maths teacher for secondary school', ld=SITE_LD))
        self.assertEqual((job['title'], job['location']), ('Maths teacher for secondary school', 'Exampletown'))

    def test_the_sites_name_in_the_first_heading_is_not_the_title_when_og_site_name_names_it(self):
        job, _ = self.read(page('Example Teachers', 'Maths teacher for secondary school', og='Example Teachers'))
        self.assertEqual(job['title'], 'Maths teacher for secondary school')

    def test_a_page_whose_only_heading_is_the_sites_name_is_a_failed_read_said_in_the_log(self):
        job, said = self.read(page('Example Teachers', ld=SITE_LD))
        self.assertIsNone(job, 'never a job titled with the site\'s name')
        self.assertIn(f'{FAILED_READ} {URL}', said)

    def test_a_page_that_declares_no_site_name_keeps_its_first_heading(self):
        """Positive control: the rule reads only the page's own declared name; without one, the first heading stands as before."""
        job, said = self.read(page('Maths teacher for secondary school', 'Apply now'))
        self.assertEqual(job['title'], 'Maths teacher for secondary school')
        self.assertEqual(said, '')


if __name__ == '__main__':
    unittest.main()
