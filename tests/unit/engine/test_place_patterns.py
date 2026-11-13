"""A place the strategy draft writes as a pattern is every plain spelling it stands for, through ONE function (src/places.py spellings), and a place
that cannot be spelled out is said by name, never dropped in silence.
Origin (owner, 13 Nov 2026: "let's dig it so deep, until we find and we start to be best and consistent"): benchmark run 43328194035, person 10 (UX designer,
Lisbon): the draft wrote places ["lisb(on|oa)"]; fragment_place_words split it on "|" inside the group ("lisb(on" + "oa)"), judged both a regex and gave [];
no place word, no country (Portugal), no board web search ("Job boards: no web search: this search names no places or roles") and the place AI was given no
places, so Lisbon jobs were "outside your places". The third fix of that function: #2977 ("sofia|софия") and #3520 ("krak[oó]w") each added one shape."""
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from src import places
from src.ai import board_ideas
from tests.unit.engine.test_places_alternation import DRAWS, Answers, known, search


class EveryShapeIsItsSpellings(unittest.TestCase):
    def test_the_three_historical_shapes_and_the_group_shape(self):
        for fragment, words in (('sofia|софия', ['sofia', 'софия']),        # #2977
                                ('krak[oó]w', ['krakow', 'kraków']),       # #3520
                                ('z[uü]rich', ['zürich']),                  # the page's own accent form: one word, as before
                                ('lisb(on|oa)', ['lisbon', 'lisboa']),      # run 43328194035 p10
                                ('(sofia|софия)', ['sofia', 'софия']),
                                ('z(?:ü|ue)rich', ['zürich', 'zuerich']),
                                (r'\bgen(?:e|è)ve\b', ['geneve', 'genève']),
                                ('m(ü|ue)nchen|munich', ['münchen', 'muenchen', 'munich']),
                                ('[Ll]isbon|lisboa', ['Lisbon', 'lisbon', 'lisboa'])):
            with self.subTest(fragment=fragment):
                self.assertEqual(places.spellings(fragment), words)
                self.assertEqual(places.fragment_place_words(fragment), words)

    def test_every_city_the_draw_can_pick_in_every_pattern_shape_finds_its_country(self):
        """The class: any city of the persona draw, written by the draft in any shape that stands for a few names."""
        for entry in DRAWS['cities']:
            city, country = entry['city'].lower(), entry['country']
            stem, end = city[:-2], city[-2:]
            for fragment in (f'{stem}({end}|{end}x)', f'{stem}(?:{end}|{end}x)', rf'\b{stem}(?:{end}|{end}x)\b', f'({city}|{city}x)', f'{city}|{city}x'):
                with self.subTest(fragment=fragment):
                    found, asked = known(search(top=[fragment]), lambda word, country=country: country)
                    self.assertIn(city, asked, 'the city itself is asked')
                    self.assertEqual(found, [country])

    def test_p10s_search_gets_portugal_and_its_board_web_search(self):
        find = search(top=['lisb(on|oa)'], roles=('ux designer',))
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'places.json'
            places.refresh(find, Answers(lambda word: 'Portugal'), file)
            with mock.patch.object(places, 'load', return_value=places.load(file)):
                self.assertEqual(board_ideas.asked_for(find)[1], ['Portugal'])
        self.assertEqual(places.place_words(find), ['lisbon', 'lisboa'], 'EURES, the employer-site reads and the place AI get both spellings')

    def test_an_open_or_unsafe_pattern_has_no_spelling(self):
        for fragment in ('lisb.*', 'l[a-z]+', '(?=x)lisbon', 'sofia|', '|sofia', 'a|(b)', '[^x]isbon', r'\w+bon', 'lisb(on|oa', 'x{2}', '(a|b)(c|d)(e|f)', r'st\.? ?gallen', 'cluj(-napoca)?'):
            with self.subTest(fragment=fragment):
                self.assertIsNone(places.spellings(fragment))
                self.assertEqual(places.fragment_place_words(fragment), [])


class AnUnreadPlaceIsSaid(unittest.TestCase):
    def test_a_place_with_no_spelling_is_named_in_the_run_lines(self):
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as tmp, redirect_stdout(out):
            places.refresh(search(top=['lisb.*', 'porto']), Answers(lambda word: 'Portugal'), Path(tmp) / 'places.json')
        said = out.getvalue()
        self.assertIn('Places: not read as a place: lisb (written as a pattern', said, 'named as the Strategy page shows it, never the raw pattern')
        self.assertNotIn('porto', said.split('Places: not read')[1].split('\n')[0], 'only the unread place is named')

    def test_every_place_spelled_says_nothing_more(self):
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as tmp, redirect_stdout(out):
            places.refresh(search(top=['lisb(on|oa)']), Answers(lambda word: 'Portugal'), Path(tmp) / 'places.json')
        self.assertNotIn('not read as a place', out.getvalue())

    def test_the_web_search_says_why_it_did_not_start(self):
        from src.sources import board_web
        cases = ((search(top=['lisb.*'], roles=('ux designer',)), 'this search names no place it can read (lisb)'),
                 (search(top=['lisbon'], roles=()), 'this search names no roles'),
                 (search(top=['lisbon'], roles=('ux designer',)), 'the countries of your places are not known yet (lisbon)'))
        for find, why in cases:
            with self.subTest(why=why):
                self.assertEqual(board_web.not_asked(find, own=find), why)

    def test_the_patterns_the_crawl_adds_are_never_named_only_the_persons_own_entries(self):
        """Gitar on #3953: the crawl's config (load_search_config()) carries region and place patterns the engine added; the line names the person's words only."""
        from src.sources import board_web
        own = search(top=['lisb.*'], roles=('ux designer',))
        from src import regions
        crawl = search(top=['lisb.*', places.pattern(['Lisbon', 'Lisboa', 'Porto']), *regions.expand(['romandie'])], roles=('ux designer',))   # what load_search_config() adds
        self.assertEqual(board_web.not_asked(crawl, own=own), 'this search names no place it can read (lisb)')


if __name__ == '__main__':
    unittest.main()
