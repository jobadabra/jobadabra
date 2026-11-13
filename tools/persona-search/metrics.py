"""One persona's job cache as numbers for the persona search check (tools/persona-search/run.mjs): open jobs, those in the places (the engine's own
place check), scored, fit 70+, the top 10 with their fit, and the last run's yield per source (src/source_yield.py). Prints one JSON line.
Run with the persona's JOBADABRA_CONFIG_DIR / JOBADABRA_DATA_DIR set (run.mjs does), from the repository root.
--countries: only {"countries": [...]}, the countries of the search's places as the engine reads them (src/places.py countries), for run.mjs's search summary.
"""
import json
import sqlite3
import sys

from collections import Counter

from scores_rows import scores_rows, table_rows
from src import country_codes, source_yield
from src.paths import JOBS_DB
from src.sources import feeds

LIST_LOCATION = 60   # a longer location names many places: not counted as local


def countries():
    """The countries of the person's places, read the way the engine reads them (places.countries over their own words and the places cache).
    Why (13 Nov 2026, #3953): run.mjs matched places.json by the raw fragment, so "sofia|софия" or "krak[oó]w" showed countries [] when the engine knew them."""
    from src import places
    from src.paths import load_search_config
    return places.countries(load_search_config(matching=False), limit=None)


def main():
    if '--countries' in sys.argv:
        print(json.dumps({'countries': countries()}, ensure_ascii=False))
        return
    db = sqlite3.connect(JOBS_DB)
    # Why (PR 3130, run 41807509648, 4 Nov 2026): a press cut by the 3-minute stop before any step opened the store has no tables; that is zero jobs, not a crash,
    # so run.mjs still writes the press row (zeros) instead of losing the whole persona to "the press wrote no numbers".
    rows = table_rows(db, 'jobs', "SELECT j.id, j.title, j.location, COALESCE(c.name, ''), j.url FROM jobs j LEFT JOIN companies c ON c.id = j.company_id "
                                  "WHERE j.state = 'open'")
    scores = {job_id: json.loads(data or '{}') for job_id, data in scores_rows(db, 'SELECT job_id, data_json FROM scores')}
    source_names = dict(table_rows(db, 'jobs', 'SELECT j.id, COALESCE(s.name, \'\') FROM jobs j LEFT JOIN sources s ON s.id = j.source_id'))
    in_places = [row for row in rows if feeds.wanted_location({'location': row[2] or '', 'title': row[1]})]
    # Located in the user's places by their own words (a city or country in the job's place), never remote anywhere: what a place check counts (24 Oct 2026, memory feedback-local-jobs-only-no-worldwide-remote)
    local = [row for row in in_places if len(row[2] or '') <= LIST_LOCATION and feeds.mentions(feeds.PLACE, country_codes.name(row[2] or ''))]   # a place list ("Moldova, Romania, Poland") is not one place
    scored = sorted(((scores[row[0]].get('score') or 0, row) for row in in_places if row[0] in scores), key=lambda pair: -pair[0])
    print(json.dumps({
        'open': len(rows), 'in_places': len(in_places), 'local_jobs': len(local),
        'local_by_source': dict(Counter(source_names.get(row[0], '') for row in local)), 'scored_in_places': len(scored),
        'fit70_in_places': sum(1 for fit, _ in scored if fit >= source_yield.FIT),
        'top10': [{'fit': fit, 'title': row[1], 'company': row[3], 'location': row[2], 'url': row[4], 'reason': scores[row[0]].get('reason', '')}
                  for fit, row in scored[:10]],
        'sources': source_yield.latest(db)[:15],
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
