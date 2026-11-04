"""A posting's HTML keeps its shape as text (src/sources/posting_text.py): headings, paragraphs and list items on their own lines."""
import unittest

from src.sources import ats, feeds
from src.sources.posting_text import html_to_text

HTML = ('<h2>Responsibilities</h2><ul><li>Run on-call &amp; incidents</li><li>Build <b>automation</b></li></ul>'
        '<p><strong>Requirements:</strong></p><p>Kubernetes in production.<br>Terraform.</p><p>CHF&nbsp;130&ndash;150k</p>')


class PostingTextTests(unittest.TestCase):
    def test_headings_items_and_paragraphs_keep_their_lines(self):
        self.assertEqual(html_to_text(HTML),
                         '## Responsibilities\n- Run on-call & incidents\n- Build automation\n\n## Requirements\nKubernetes in production.\nTerraform.\n\nCHF 130–150k')

    def test_a_paragraph_of_only_bold_words_is_a_heading_but_bold_in_a_sentence_is_not(self):
        self.assertIn('## Benefits', html_to_text('<p><b>Benefits</b></p><p>Good pay</p>'))
        self.assertEqual(html_to_text('<p>We value <b>kindness</b> here</p>'), 'We value kindness here')

    def test_escaped_twice_text_without_tags_and_empties(self):
        self.assertEqual(html_to_text('&lt;p&gt;Hello&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;/ul&gt;'), 'Hello\n\n- One')
        self.assertEqual(html_to_text('Just words,  already plain.'), 'Just words, already plain.')
        self.assertEqual(html_to_text(None), '')
        self.assertEqual(html_to_text('<ul><li></li><li>  </li></ul><p></p>'), '')

    def test_no_run_of_blank_lines_and_the_limit_holds(self):
        self.assertNotIn('\n\n\n', html_to_text('<p>a</p><p></p><p></p><br><br><p>b</p>'))
        self.assertEqual(len(html_to_text('<p>' + 'x' * 50 + '</p>', limit=10)), 10)

    def test_both_fetchers_read_it_the_same_way(self):
        self.assertEqual(ats.plain(HTML), html_to_text(HTML))
        self.assertEqual(feeds.plain_text(HTML), html_to_text(HTML))

    # Why (4 Nov 2026, a tester on 0.9.6): the EURES portal sends some postings as a converted web page, in markdown, not HTML.
    def test_a_posting_sent_as_a_markdown_page_loses_its_front_matter_and_marks(self):
        page = ('---base:meta-keywords:meta-viewport: width=device-width, initial-scale=1.0title: Finance Manager--- Finance Manager==============='
                'Acme is a promotion agency. ### Your tasks Plan budgets and **report** monthly.')
        text = html_to_text(page)
        self.assertEqual(text, 'Finance Manager\nAcme is a promotion agency. Your tasks Plan budgets and report monthly.')
        for junk in ('---', '===', '###', 'meta-', '**'):
            self.assertNotIn(junk, text)

    def test_a_posting_with_backslash_escaped_marks_reads_as_plain_words(self):
        page = r'\[Acme Business \\\&amp; Innovation\](\&lt; \&gt;) hires. Hands\\-on, end\\-to\\-end work. \*\*Do you enjoy it?\*\*'
        self.assertEqual(html_to_text(page), 'Acme Business & Innovation hires. Hands-on, end-to-end work. Do you enjoy it?')

    def test_markdown_headings_on_their_own_lines_become_headings_and_a_hash_in_a_word_stays(self):
        self.assertEqual(html_to_text('### Your tasks\nPlan budgets.\nWe use C# and F#. #1 team.'), '## Your tasks\nPlan budgets.\nWe use C# and F#. #1 team.')


if __name__ == '__main__':
    unittest.main()
