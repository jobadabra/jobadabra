"""Engine files reading a person's raw place lists or Remote jobs words only shrink: new code asks src/my_places.py (owner, 11 Nov 2026:
"how we can fix this forever? How we can prevent fixing the location so many times?").
Why (rj 1/2, 11 Nov 2026): each of nine deciders read `locations` / `remote_jobs` its own way, so a fix landed in one and the next symptom
came from another (#3792 whole country, #3808 "None" read as yes by the place step; 87 place-named commits in 30 days). A new raw read fails
(a lower count passes and says which line to lower): read my_places.lists / words_regex / remote_word instead."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RAW = re.compile(r"""\[['"](?:locations|remote_jobs)['"]\]|get\(['"](?:locations|remote_jobs)['"]\)""")
HOME = 'src/my_places.py'

# Measured on rj-places (main 024f7496 + 1/2), 11 Nov 2026: raw `['locations']` / `.get('locations')` / the same for `remote_jobs`, per file.
# Some are writers or query builders (they may stay); a few are other things named `locations` (an AI answer's field). Only shrinks.
KNOWN = {
    'src/ai/few_jobs.py': 1,
    'src/ai/locations.py': 3,
    'src/ai/place_triage.py': 2,
    'src/ai/role_ideas.py': 1,
    'src/ai/scout_ideas.py': 1,
    'src/ai/visit_filters.py': 1,
    'src/desktop.py': 1,
    'src/desktop_strategy.py': 2,
    'src/desktop_visits.py': 1,
    'src/field_redraft.py': 1,
    'src/geo.py': 1,
    'src/notion/matches.py': 1,
    'src/paths.py': 2,
    'src/places.py': 3,
    'src/scout_candidates.py': 3,
    'src/scout_hiring.py': 1,
    'src/scout_probe.py': 2,
    'src/scout_run.py': 1,
    'src/search_report.py': 1,
    'src/sources/aggregators.py': 3,
    'src/sources/ats_eightfold.py': 1,
    'src/sources/ats_sites.py': 2,
    'src/sources/boards.py': 2,
    'src/sources/careers.py': 1,
    'src/sources/feed_order.py': 1,
    'src/sources/google_jobs.py': 8,
    'src/sources/visits_portals.py': 3,
    'src/stores/matches_sync.py': 1,
    'src/suggestions_search.py': 1,
    'src/time_budget.py': 1,
    'src/tune.py': 1,
}


def raw_reads():
    """{engine file: raw place reads} outside the one home."""
    found = {}
    for path in sorted((ROOT / 'src').rglob('*.py')):
        name = path.relative_to(ROOT).as_posix()
        count = len(RAW.findall(path.read_text(encoding='utf-8')))
        if count and name != HOME:
            found[name] = count
    return found


class PlacesOneHomeTest(unittest.TestCase):
    def test_raw_place_reads_only_shrink(self):
        for name, count in raw_reads().items():
            with self.subTest(file=name):
                self.assertLessEqual(count, KNOWN.get(name, 0), f'{name} reads the raw place lists or Remote jobs {count}x: ask src/my_places.py instead')

    def test_a_lower_count_lowers_its_line(self):
        found = raw_reads()
        for name, count in KNOWN.items():
            with self.subTest(file=name):
                self.assertEqual(found.get(name, 0), count, f'{name} now reads {found.get(name, 0)}x: lower its line in KNOWN')


if __name__ == '__main__':
    unittest.main()
