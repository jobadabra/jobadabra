"""Employers whose jobs the scout SAW in your places are read before employers it has no place information for (#2920, 7 Nov 2026, p6 Zagreb marketing, run 42386229424:
the 15 first employer reads came from a pool where 372 of 413 passing feeds had no place information, and 0 of their 21 role matches were in Zagreb). A feed with no place
information is still kept (rank, not drop): after the feeds with evidence it fills the slice and the full crawl reads it. The shape is the real one: 41 feeds with
place information that name the search's place, 372 without, 100 elsewhere; the matcher is the test's own, the product holds no place word."""
import unittest
import unittest.mock

from src import employer_index, first_jobs


def feed(name, places):
    return {'company': name, 'ats': 'lever', 'slug': name.lower(), 'places': places}


def zagreb_shaped_index():
    """No-information feeds first and interleaved with the evidence ones: the order a scout that never ranked them would publish."""
    known = [feed(f'Known{n}', ['Zagreb, Croatia', 'Berlin, Germany'] if n % 2 else ['Split, Croatia']) for n in range(41)]
    unknown = [feed(f'Unknown{n}', None) for n in range(372)]
    elsewhere = [feed(f'Elsewhere{n}', ['Lisbon, Portugal']) for n in range(100)]
    index = []
    for n in range(372):
        index.append(unknown[n])
        if n < 41:
            index.append(known[n])
        if n < 100:
            index.append(elsewhere[n])
    return index


def croatia(job):
    return 'croatia' in job['location'].lower()


class IndexPlaceRankTest(unittest.TestCase):
    def test_feeds_with_place_information_come_first_and_none_is_dropped(self):
        out = employer_index.relevant(zagreb_shaped_index(), croatia)
        self.assertEqual(len(out), 41 + 372, 'rank, not drop: the feeds with no place information are kept')
        self.assertTrue(all(f['places'] for f in out[:41]), 'the 41 feeds that name the place come first')
        self.assertFalse(any(f['places'] for f in out[41:]))
        self.assertEqual([f['company'] for f in out[:41]], [f'Known{n}' for n in range(41)], 'the index order is kept inside each group')
        self.assertEqual([f['company'] for f in out[41:44]], ['Unknown0', 'Unknown1', 'Unknown2'])

    def test_the_first_reads_are_the_feeds_that_name_the_place(self):
        merged = employer_index.merge([], employer_index.relevant(zagreb_shaped_index(), croatia))
        picked = first_jobs.pick(merged)
        self.assertEqual(len(picked), first_jobs.SLICE)
        self.assertTrue(all(source['places'] for source in picked), [s['company'] for s in picked if not s['places']][:3])

    def test_where_few_feeds_name_the_place_the_slice_fills_from_the_others(self):
        # Moldova-shaped: 6 feeds name it, 372 do not: the 15 reads are the 6, then 9 of the others (nothing starves)
        index = [feed(f'Unknown{n}', None) for n in range(372)] + [feed(f'Known{n}', ['Chisinau, Moldova']) for n in range(6)]
        picked = first_jobs.pick(employer_index.merge([], employer_index.relevant(index, lambda job: 'moldova' in job['location'].lower())))
        self.assertEqual([s['company'] for s in picked[:6]], [f'Known{n}' for n in range(6)])
        self.assertEqual(len(picked), first_jobs.SLICE)

    def test_fast_kinds_still_come_first_and_the_place_order_holds_inside_each_group(self):
        # reviewer, 7 Nov 2026: pick() puts the feeds that answer in one request ahead of the others (the slice's speed rule, unchanged); the place order is inside each group
        slow_known = [{**feed(f'SlowKnown{n}', ['Zagreb, Croatia']), 'ats': 'workday'} for n in range(3)]
        fast_unknown = [feed(f'FastUnknown{n}', None) for n in range(20)]
        fast_known = [feed(f'FastKnown{n}', ['Zagreb, Croatia']) for n in range(4)]
        with unittest.mock.patch.object(first_jobs.ats, 'FETCHERS', {'lever': None, 'workday': None}):
            picked = first_jobs.pick(employer_index.merge([], employer_index.relevant(slow_known + fast_unknown + fast_known, croatia)))
        names = [source['company'] for source in picked]
        self.assertEqual(names[:4], [f'FastKnown{n}' for n in range(4)], 'inside the fast group, the feeds that name the place first')
        self.assertEqual(names[4:6], ['FastUnknown0', 'FastUnknown1'])
        self.assertNotIn('SlowKnown0', names, 'a slower kind still waits behind the fast ones, as before: the speed rule is the slice\'s')

    def test_no_place_information_anywhere_keeps_the_index_order(self):
        index = [feed(f'Unknown{n}', None) for n in range(5)]
        self.assertEqual(employer_index.relevant(index, croatia), index)


if __name__ == '__main__':
    unittest.main()
