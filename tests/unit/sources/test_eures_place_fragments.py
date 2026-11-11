"""A place the strategy draft wrote as a letter choice ("krak[oó]w") is still the person's place (#2920; run 42386229424, persona p5 Krakow).
The draft wrote the city as a pattern with no plain page reading; EURES built its places with terms(), which drops such entries, so it asked only the country ("poland, polska"):
100 rows instead of 200 and place-right 22 -> 4. Every reader of a search's place fragments takes them from src/places.py place_words now. No network."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src import geo, places
from src.sources import aggregators, careers, eures, nuts_names

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


TABLE = {'PL21': 'Małopolskie', 'PL213': 'Miasto Kraków', 'PL92': 'Mazowiecki regionalny'}
SEARCH = {'role_keywords': ['chef'], 'locations': {'top_tier': ['krak[oó]w'], 'country_wide': ['poland', 'polska'], 'abroad': []}}   # the draft of run 42386229424, p5


class Client:
    """Answers the region question with a fixed NUTS-2 code per place word, as the AI does."""
    def __init__(self, answers):
        self.answers, self.messages, self.asked = answers, SimpleNamespace(create=self.create), []

    def create(self, **kwargs):
        words = [line.split('. ', 1)[1] for line in kwargs['messages'][0]['content'].splitlines()[1:]]
        self.asked.extend(words)
        body = {'regions': [{'n': n, 'nuts2': self.answers.get(word, '')} for n, word in enumerate(words, 1)]}
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(body))], usage=SimpleNamespace(input_tokens=0, output_tokens=0))


def resolve(words, client=None, ask=True, share=False):
    """The map knows the town under either spelling and the country under both of its names."""
    country = {'poland', 'polska'}
    return {geo.norm(w): ({'kind': 'country', 'cc': 'PL'} if geo.norm(w) in country else {'kind': 'city', 'cc': 'PL', 'lat': 50.06, 'lon': 19.94, 'r': 25}) for w in words}


class LetterChoicePlaces(unittest.TestCase):
    def test_a_letter_choice_is_the_spellings_it_names_and_a_real_regex_is_none(self):
        table = {'krak[oó]w': ['krakow', 'kraków'], 'gen[eè]ve': ['geneve', 'genève'], 'krak[oó]w|cracow': ['krakow', 'kraków', 'cracow'], 'z[uü]rich': ['zürich'],
                 'sofia|софия': ['sofia', 'софия'], 'Gothenburg|G[oö]teborg': ['Gothenburg', 'Göteborg'], 'poland': ['poland'], 'Zürich': ['Zürich'], 'Kraków': ['Kraków'],
                 'foo.*bar': [], '[a-z]+': [], 'st\\.? ?gallen': []}
        self.assertEqual({fragment: places.fragment_place_words(fragment) for fragment in table}, table)

    def test_a_searchs_place_words_come_in_group_order_each_once(self):
        self.assertEqual(places.place_words(SEARCH), ['krakow', 'kraków', 'poland', 'polska'])
        self.assertEqual(places.place_words(SEARCH, ('country_wide',), 1), ['poland'])
        self.assertEqual(places.place_words(SEARCH, ('top_tier',), first_only=True), ['krakow'])

    def test_eures_asks_the_cities_region_first_not_only_the_country(self):
        calls = []
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)

        def get(url, data=None, headers=None, timeout=None):
            calls.append(json.loads(data)['locationCodes'][0])
            return {'jvs': []}
        client = Client({'krakow': 'PL21', 'kraków': 'PL21'})
        with mock.patch.object(eures, 'STORE', Path(tmp.name) / 'eures.json'), mock.patch.object(geo, 'STORE', Path(tmp.name) / 'geo.json'), \
                mock.patch.object(nuts_names, 'names', lambda fetch=None: TABLE), mock.patch.object(geo, 'resolve', resolve):
            eures.eures(SEARCH, get=get, client=client)
        self.assertIn('krakow', client.asked, 'the city was asked about, as "krak[oó]w" was dropped before')
        self.assertEqual(calls[:2], ['pl21', 'pl'], f'the region first, the country last: {calls}')


class EveryReaderOfPlacesSeesTheCity(unittest.TestCase):
    """Review of the first version: readers still on terms() dropped the same fragment (jobs.ch asked all of Switzerland, the place triage had no city)."""
    GENEVA = {'role_keywords': ['chef'], 'locations': {'top_tier': ['gen[eè]ve'], 'country_wide': ['suisse'], 'abroad': ['z[uü]rich|zurich']}}

    def test_each_reader_gets_the_plain_words_not_nothing(self):
        from src import desktop_visits, scout_role_search
        from src.ai import few_jobs, place_triage, visit_filters
        from src.sources import boards
        self.assertIn('geneve', boards.jobsch_places(self.GENEVA))
        words = place_triage.places_words(self.GENEVA)
        self.assertEqual((words['best_places'], words['cities_abroad']), (['geneve', 'genève'], ['zürich', 'zurich']))
        self.assertEqual(scout_role_search.place_words(self.GENEVA), ['geneve', 'genève', 'suisse'])
        filters = visit_filters.facts(self.GENEVA)
        self.assertEqual((filters['places_first'], filters['places_also']), (['geneve', 'genève'], ['suisse', 'zürich', 'zurich']))
        self.assertEqual(few_jobs.facts({}, self.GENEVA)['places'], ['geneve', 'genève', 'suisse', 'zürich', 'zurich'])
        with mock.patch('src.paths.load_search_config', lambda **kw: self.GENEVA):
            context = desktop_visits._visit_context(None, {})[0]
        self.assertEqual(context['places_first'], ['geneve', 'genève'])

    def test_the_users_countries_keep_the_swiss_market_for_a_pattern_with_no_plain_reading(self):
        for fragment in ('(zurich|bern|basel)', '\\b(zurich|z[uü]rich)\\b', 'zurich.*'):
            with mock.patch.object(places, 'countries', lambda search, limit=10: []):
                self.assertIn('ch', aggregators._countries({'locations': {'top_tier': [fragment]}}), fragment)

    def test_a_pattern_does_not_use_up_a_slot_of_the_limit(self):
        self.assertEqual(places.place_words({'locations': {'top_tier': ['(a|b)', 'x', 'y']}}, ('top_tier',), 2), ['x', 'y'])


if __name__ == '__main__':
    unittest.main()
