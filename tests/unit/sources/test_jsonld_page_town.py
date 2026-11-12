"""A list page whose JSON-LD gives a posting's country only, but whose app data names its town (12 Nov 2026, ch: jobup.ch, jobs.ch's sibling: 13 ads read, 3 with a town in JSON-LD,
10 with the page data's towns; 2 jobs in the person's places). Example ids and names only."""
import json
import unittest

from src.sources import careers

A, B, C = '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000c'


def posting(ident, title, locality=None):
    address = {'@type': 'PostalAddress', 'addressCountry': 'CH', **({'addressLocality': locality} if locality else {})}
    return {'@type': 'JobPosting', 'title': title, 'identifier': {'@type': 'PropertyValue', 'value': ident}, 'url': f'https://board.example/jobs/detail/{ident}/',
            'hiringOrganization': {'@type': 'Organization', 'name': 'Example AG'}, 'jobLocation': {'@type': 'Place', 'address': address}}


def page(*postings, data=''):
    ld = json.dumps({'@context': 'https://schema.org', '@type': 'ItemList', 'itemListElement': [{'@type': 'ListItem', 'item': p} for p in postings]})
    return f'<html><script type="application/ld+json">{ld}</script><script>window.__DATA__ = {data};</script><body>list</body></html>'


APP_DATA = f'{{"id":"{A}","title":"Lagerist","place":"Dietikon"}},{{"id":"{B}","title":"Kommissionierer","place":""}}'


class PageTown(unittest.TestCase):
    def where(self, markup):
        return {job['title']: job['location'] for job in careers.jsonld_jobs(markup, 'https://board.example/jobs/')}

    def test_a_country_only_address_takes_its_town_from_the_page_data(self):
        found = self.where(page(posting(A, 'Lagerist'), posting(B, 'Kommissionierer'), posting(C, 'Staplerfahrer'), data=f'[{APP_DATA}]'))
        self.assertEqual(found, {'Lagerist': 'Dietikon, Switzerland', 'Kommissionierer': 'Switzerland', 'Staplerfahrer': 'Switzerland'},
                         'an empty place, or an id the data does not hold, stays the country: never a guess')

    def test_an_address_with_its_own_town_keeps_it(self):
        self.assertEqual(self.where(page(posting(A, 'Lagerist', 'Zürich'), data=f'[{APP_DATA}]')), {'Lagerist': 'Zürich, Switzerland'})

    def test_a_posting_with_no_id_or_a_page_with_no_data_is_as_before(self):
        plain = posting(A, 'Lagerist')
        del plain['identifier']
        self.assertEqual(self.where(page(plain, data=f'[{APP_DATA}]')), {'Lagerist': 'Switzerland'})
        self.assertEqual(self.where(page(posting(A, 'Lagerist'))), {'Lagerist': 'Switzerland'})


if __name__ == '__main__':
    unittest.main()
