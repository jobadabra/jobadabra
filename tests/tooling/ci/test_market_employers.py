"""Guard: data + safety — the market count's employer sites (tools/persona-search/market_employers.py, [mc] 4/5): a short count never reads "counted" (over 100 rows, a feed
not read), its shortfall is kept as numbers (feeds_unplaced, rows_outside_by_text), a 401/403/429 ends that feed for the run with no second request, a feed two persons share is
read once, and no index means "not counted", never 0. Fakes only: no index, feed or NUTS table is downloaded."""
import sys
import tempfile
import urllib.error
import urllib.request
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import market_employers as me  # noqa: E402
from src.sources import host_pace  # noqa: E402

TABLE = {'HR05': 'Grad Zagreb', 'HR050': 'Grad Zagreb', 'HR06': 'Sjeverna Hrvatska', 'CZ01': 'Praha', 'CZ010': 'Hlavní město Praha', 'FRK2': 'Rhône-Alpes', 'FRK26': 'Rhône',
         'DK01': 'Hovedstaden', 'PT17': 'Área Metropolitana de Lisboa'}
ZAGREB = {'city': 'Zagreb', 'reference': {'nuts2': 'HR05'}}
PRAGUE = {'city': 'Prague', 'reference': {'nuts2': 'CZ01'}}


def feed(company, places, slug=None):
    return {'company': company, 'ats': 'greenhouse', 'slug': slug or company.lower(), 'places': places}


def jobs(n, location='Zagreb, Croatia', prefix='Job'):
    return [{'title': f'{prefix} {i}', 'location': location, 'url': f'https://boards.example/{prefix}/{i}'} for i in range(n)]


class Reader:
    """A fake feed reader: answers from `feeds`, raises what `refuse` names, counts every request."""
    def __init__(self, feeds, refuse=None):
        self.feeds, self.refuse, self.asked = feeds, refuse or {}, []

    def __call__(self, system, slug):
        self.asked.append(slug)
        if slug in self.refuse:
            code = self.refuse[slug]
            raise urllib.error.HTTPError(f'https://boards.example/{slug}', code, 'refused', {}, None) if isinstance(code, int) else code
        return self.feeds[slug]


def employers(index, reader, stop=lambda: False):
    return me.Employers(load=lambda: index, fetch=reader, table=lambda: TABLE, stop=stop)


class WhichPlaces(unittest.TestCase):
    def test_a_place_names_the_region_by_its_city_or_a_nuts_name_folded_as_whole_words(self):
        names = me.region_names(PRAGUE, TABLE)
        for place in ('Prague, Czechia', 'PRAHA 4', 'Hlavni mesto Praha', 'prague'):
            self.assertTrue(me.names_place(place, names), place)
        for place in ('Brno', 'Prahatown', '', None):
            self.assertFalse(me.names_place(place, names), place)


    def test_only_the_region_level_name_and_local_spellings_with_letters_nfkd_keeps_whole(self):
        """Review of [mc] 4/5: a NUTS-3 name ("Rhône") matched Bouches-du-Rhône; "Lisboa", "København" (ø) missed."""
        lyon = me.region_names({'city': 'Lyon', 'reference': {'nuts2': 'FRK2'}}, TABLE)
        self.assertFalse(me.names_place('Marseille, Bouches-du-Rhône', lyon))
        self.assertTrue(me.names_place('Villeurbanne, Rhône-Alpes', lyon))
        self.assertTrue(me.names_place('Lisboa, Portugal', me.region_names({'city': 'Lisbon', 'reference': {'nuts2': 'PT17'}}, TABLE)))
        self.assertTrue(me.names_place('København K', me.region_names({'city': 'Copenhagen', 'reference': {'nuts2': 'DK01'}}, TABLE)))
        self.assertEqual(me.fold('Łódź Ørestad'), 'lodz orestad')


class TheCount(unittest.TestCase):
    def test_feeds_naming_the_region_are_read_their_jobs_there_are_rows_and_the_gaps_are_numbers(self):
        index = [feed('Infobip', ['Zagreb, Croatia', 'London']), feed('Rimac', ['Sveta Nedelja']), feed('Unplaced', None), feed('Unplaced2', [])]
        reader = Reader({'infobip': jobs(2) + jobs(3, 'London', 'Ldn')})
        got = employers(index, reader)(ZAGREB)
        self.assertEqual(got['status'], 'counted')
        self.assertEqual(reader.asked, ['infobip'], 'a feed whose places do not name the region is not read; nor one with no places')
        self.assertEqual([r['title'] for r in got['rows']], ['Job 0', 'Job 1'])
        self.assertEqual(got['rows'][0], {'title': 'Job 0', 'company': 'Infobip', 'location': 'Zagreb, Croatia', 'url': 'https://boards.example/Job/0'})
        self.assertEqual({k: got[k] for k in ('feeds_tried', 'feeds_read', 'feeds_unplaced', 'rows_in_region', 'rows_outside_by_text')}, {
            'feeds_tried': 1, 'feeds_read': 1, 'feeds_unplaced': 2, 'rows_in_region': 2, 'rows_outside_by_text': 3})

    def test_over_the_cap_is_partial_with_n_and_the_same_rows_every_run(self):
        index = [feed('Zeta', ['Zagreb']), feed('Alpha', ['Zagreb'])]
        reader = Reader({'zeta': jobs(80, prefix='Z'), 'alpha': jobs(70, prefix='A')})
        first, again = employers(index, reader)(ZAGREB), employers(list(reversed(index)), reader)(ZAGREB)
        self.assertEqual(first['status'], f'partial: first {me.CAP} of 150 rows')
        self.assertEqual((len(first['rows']), first['rows_in_region']), (me.CAP, 150))
        self.assertEqual(first['rows'], again['rows'], 'a stable order: the index order does not change which rows the judge sees')
        self.assertEqual(first['rows'][0]['company'], 'Alpha')

    def test_a_refused_feed_ends_for_the_run_and_the_count_says_how_many_feeds_were_read(self):
        index = [feed('Ok', ['Zagreb']), feed('Shut', ['Zagreb']), feed('Busy', ['Zagreb']), feed('Broken', ['Zagreb'])]
        reader = Reader({'ok': jobs(1)}, {'shut': 403, 'busy': 429, 'broken': ValueError('not JSON')})
        read = employers(index, reader)
        got = read(ZAGREB)
        self.assertEqual(got['status'], 'partial: 1 of 4 feeds')
        self.assertEqual((got['feeds_refused'], got['feeds_failed'], len(got['rows'])), (2, 1, 1))
        read(dict(ZAGREB))
        self.assertEqual(sorted(reader.asked), ['broken', 'busy', 'ok', 'shut'], 'one request per feed in the run: a refusal is never asked again, a shared feed is read once')

    def test_a_429_is_one_request_and_refused_never_waited_out_and_tried_again(self):
        """sa, 10 Nov 2026 (CLAUDE.md safety: never retry a 401/403/429): the engine's pace tries a 429 again up to 3 times; the referee's reader sends one request."""
        folder = tempfile.mkdtemp()
        sent = []

        def opener(request, timeout):
            sent.append(request.full_url)
            raise urllib.error.HTTPError(request.full_url, 429, 'Too Many Requests', {}, None)

        def fetch(system, slug):   # the real _fetch's switch, then the engine's real pace with a fake network
            with mock.patch('src.sources.ats.fetch', lambda *a: host_pace.open(urllib.request.Request(f'https://boards.example/{slug}'), 5, opener)):
                return me._fetch(system, slug)
        with mock.patch.object(host_pace, 'FILE', Path(folder) / 'pace.json'), mock.patch.object(host_pace, 'RETRIES', host_pace.RETRIES), \
                mock.patch.object(host_pace, 'turn', lambda url: None):
            got = employers([feed('Busy', ['Zagreb'])], fetch)(ZAGREB)
        self.assertEqual(len(sent), 1, 'one request, no retry')
        self.assertEqual((got['status'], got['feeds_refused']), ('not counted: 0 of 1 feeds read', 1))

    def test_importing_the_referee_leaves_the_engines_retries_as_they_are(self):
        """sa, 10 Nov 2026: the no-retry switch must never leak into an engine run; it is set at the referee's first feed read only."""
        import subprocess
        code = 'import sys; sys.path[:0] = [sys.argv[1], sys.argv[2]]; import market_employers; from src.sources import host_pace; print(host_pace.RETRIES)'
        done = subprocess.run([sys.executable, '-c', code, str(ROOT / 'tools' / 'persona-search'), str(ROOT)], capture_output=True, text=True, timeout=60)
        self.assertEqual(done.stdout.strip(), '3', done.stderr)

    def test_time_up_leaves_the_feeds_not_read_as_partial_never_a_wait(self):
        index = [feed('A', ['Zagreb']), feed('B', ['Zagreb'])]
        reader = Reader({'a': jobs(1), 'b': jobs(1)})
        got = employers(index, reader, stop=lambda: len(reader.asked) >= 1)(ZAGREB)
        self.assertEqual((got['status'], got['feeds_late']), ('partial: 1 of 2 feeds', 1))

    def test_without_the_nuts_table_the_count_says_it_used_city_names_only(self):
        read = me.Employers(load=lambda: [feed('A', ['Zagreb'])], fetch=Reader({'a': jobs(1)}), table=lambda: {})
        self.assertEqual(read(ZAGREB)['status'], 'partial: city names only (no NUTS table)')

    def test_no_index_is_not_counted_never_zero(self):
        got = employers(None, Reader({}))(ZAGREB)
        self.assertEqual((got['status'], got['rows']), ('not counted: index not downloaded', []))
        with mock.patch.dict('os.environ', {'JOBADABRA_FIXTURE_DIR': '/nonexistent'}):
            self.assertIsNone(me._index(), 'a fixture run has no index: never a count of 0')


if __name__ == '__main__':
    unittest.main()
