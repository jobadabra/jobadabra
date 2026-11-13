"""A web page's bytes become text with the charset the reply names, else the one the page declares itself, else UTF-8 (src/sources/page_bytes.py).
Why (13 Nov 2026, #3989): a job board replied "Content-Type: text/html" with no charset and declared ISO-8859-1 only in its <meta>, past its first
4 KB; read as UTF-8, every accented job title reached the person garbled ("T�cnico de Farm�cia")."""
import io
import os
import tempfile
import unittest
from email.message import Message
from pathlib import Path
from unittest import mock

from src.sources import careers, page_bytes

TITLE = 'Técnico de Farmácia (m/f) – Lisboa'
HEAD = '<html><head>' + '<link rel="stylesheet" href="/css/site.css?v=1">' * 120   # the meta comes late, as on the board that showed it


def page(meta):
    return (f'{HEAD}{meta}</head><body><h1>{TITLE}</h1></body></html>').encode('cp1252')


class PageBytesTest(unittest.TestCase):
    def test_a_latin_1_page_whose_only_charset_is_its_meta_tag_keeps_its_accents(self):
        for meta in ('<meta charset="ISO-8859-1">', '<meta http-equiv="content-type" content="text/html; charset=iso-8859-1" />',
                     "<meta charset='windows-1252'>"):
            with self.subTest(meta=meta):
                self.assertIn(TITLE, page_bytes.text(page(meta)))

    def test_the_replys_own_charset_comes_first(self):
        self.assertIn(TITLE, page_bytes.text(page('<meta charset="utf-8">'), 'iso-8859-1'))

    def test_with_no_charset_anywhere_a_page_is_utf_8_as_before(self):
        raw = f'<html><body><h1>{TITLE}</h1></body></html>'.encode('utf-8')
        self.assertEqual(page_bytes.text(raw), raw.decode('utf-8'))

    def test_an_unknown_charset_name_falls_back_and_never_raises(self):
        self.assertIn('Lisboa', page_bytes.text(page('<meta charset="x-no-such-charset">'), 'also-unknown'))

    def test_get_text_reads_a_page_whose_reply_names_no_charset(self):
        """The shared reader every board and careers page goes through (careers.get_text)."""
        class Reply(io.BytesIO):
            headers = Message()
            headers['Content-Type'] = 'text/html'

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False
        with mock.patch.object(careers, '_public', return_value=True), mock.patch.object(careers.host_pace, 'open', return_value=Reply(page('<meta charset="ISO-8859-1">'))):
            self.assertIn(TITLE, careers.get_text('https://jobs.example/vaga/1'))

    def test_a_recorded_page_is_read_the_same_way(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(careers.ats, '_fixture', return_value=page('<meta charset="ISO-8859-1">')), \
                mock.patch.dict(os.environ, {'JOBADABRA_FIXTURE_DIR': str(Path(folder))}):
            self.assertIn(TITLE, careers.get_text('https://jobs.example/vaga/1'))


if __name__ == '__main__':
    unittest.main()
