"""A link written without quotes (href=/16165566/designer/) is read like a quoted one by every reader of a page's links (src/sources/anchors.py;
14 Nov 2026, zb, sa's run 43614387886: a Lisbon job board's 13 offers were written so and its read gave 0 jobs, the AI page reader being handed none of them)."""
import unittest

from src.ai import page_reader
from src.sources import anchors, board_pages, careers, job_alerts, page_recipes

BASE = 'https://board.example/pesquisa?chaves=designer&cidade=lisboa'
OFFERS = [(16165566, 'UX Designer'), (16165570, 'Product Designer'), (16165588, 'Designer de Interação')]
PAGE = ('<html><body><nav><a href="/sobre">Sobre</a><a href="#top">Topo</a></nav><h3>3 ofertas encontradas</h3>'
        + ''.join(f'<div class="job-item"><h2><a class=oferta-link href=/{n}/{t.lower().replace(" ", "-")}/>{t}</a></h2></div>' for n, t in OFFERS)
        + '<a rel=next href=/pesquisa?chaves=designer&cidade=lisboa&page=2>Seguinte</a></body></html>')
OFFER_URLS = [f'https://board.example/{n}/{t.lower().replace(" ", "-")}/' for n, t in OFFERS]


class Anchors(unittest.TestCase):
    def test_the_three_ways_html_writes_an_href(self):
        markup = '<a href="/a">A</a> <a href=\'/b\'>B</a> <a class=x href=/c/7/>C</a> <a href = /d >D</a>'
        self.assertEqual([href for href, _ in anchors.anchors(markup)], ['/a', '/b', '/c/7/', '/d'])

    def test_not_data_href_not_a_bare_fragment_and_a_quoted_gt_is_not_the_tag_end(self):
        markup = '<a data-href="/no">x</a><a href="#top">t</a><a title="a > b" href=/yes>y</a>'
        self.assertEqual(anchors.anchors(markup), [('/yes', 'y')])
        self.assertEqual([href for href, _ in anchors.anchors(markup, fragments=True)], ['#top', '/yes'])

    def test_the_ai_page_reader_is_handed_the_offers_written_without_quotes(self):
        handed = page_reader.text_for(PAGE, BASE)
        for title, url in zip((t for _, t in OFFERS), OFFER_URLS):
            self.assertIn(f'{title} -> {url}', handed)

    def test_every_reader_of_a_pages_links_reads_them(self):
        self.assertEqual([url for url, _ in careers.links(PAGE, BASE) if url in OFFER_URLS], OFFER_URLS)
        self.assertEqual([url for url, _ in page_recipes._links(PAGE, BASE) if url in OFFER_URLS], OFFER_URLS)
        self.assertEqual([url for url, _ in page_recipes._card_links(PAGE, BASE, 'label') if url in OFFER_URLS], OFFER_URLS)
        self.assertEqual(board_pages.next_link(BASE, PAGE, []), 'https://board.example/pesquisa?chaves=designer&cidade=lisboa&page=2')
        mail = ''.join(f'<a href={url}>{t}</a>' for url, (_, t) in zip(OFFER_URLS, OFFERS))   # an alert e-mail's links are whole addresses
        self.assertEqual([url for _, url in job_alerts.links(mail, '', 'board.example')], OFFER_URLS)


if __name__ == '__main__':
    unittest.main()
