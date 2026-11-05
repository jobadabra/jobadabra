"""One finished Find jobs run as a record of counts and seconds (owner, 18 Oct 2026: "register real users' job searches and see their results"):
the app sends it as a technical report when the user has reports on (desktop/lib/search-report.js, which holds the allowed field list). It is
measured the way tools/persona-search/ttfr.py measures a persona: seconds from the run's start until the 1st and 10th open job in the user's
places appeared, and until the 1st scored 70+. Fields: a role FAMILY (fixed list in src/role_kinds.py, 'other' when unknown), a country code and a
city candidate (shown on the site only when 3+ installs share it), counts, seconds. Never a job, title, company, link, CV or typed word beyond
that city candidate. Prints one JSON line: `python -m src search_report --since <ISO time of the run's start>`.
Tests: tests/unit/engine/test_search_report.py."""
import json
import sqlite3
import sys
from collections import Counter
from datetime import datetime

FIT = 70


def _ts(text):
    return datetime.fromisoformat(str(text).replace('Z', '+00:00')).timestamp()


def timings(db, since, wanted):
    """{counts and seconds} for the open jobs first seen after `since` (an ISO time) that are in the user's places (`wanted(location, title)`)."""
    t0 = _ts(since)
    rows = [r for r in db.execute("SELECT id, title, location, first_seen_at FROM jobs WHERE state = 'open'") if r[3] and _ts(r[3]) >= t0 - 1]
    places = [r for r in rows if wanted(r[2] or '', r[1])]
    ids = {r[0]: _ts(r[3]) for r in places}
    scored = {}
    for job_id, created, data in db.execute('SELECT job_id, created_at, data_json FROM scores'):
        if job_id in ids and created:
            scored[job_id] = (_ts(created), (json.loads(data or '{}').get('score') or 0))
    seen = sorted(t - t0 for t in ids.values())
    fit = sorted(max(scored[i][0], ids[i]) - t0 for i in scored if scored[i][1] >= FIT)
    at = lambda xs, n: max(0, round(xs[n - 1])) if len(xs) >= n else None
    return {'in_places': len(seen), 'scored': len(scored), 'fit70': len(fit), 'first_s': at(seen, 1), 'tenth_s': at(seen, 10), 'first_fit70_s': at(fit, 1)}


def open_in_places(db, wanted):
    """How many open jobs the user has in their places right now (`wanted(location, title)`), whenever each was first seen. fb 5/7: `timings` counts only the jobs first seen in this run, so a repeat press reads 0."""
    return sum(1 for title, location in db.execute("SELECT title, location FROM jobs WHERE state = 'open'") if wanted(location or '', title))


def family(search):
    """The role family of the search: the commonest known kind among its role words (src/role_kinds.py), else 'other'."""
    from . import role_kinds
    words = (search or {}).get('role_keywords') or []
    kinds = Counter(k for k in role_kinds.kinds_of([w for w in words][:30]).values() if k != 'other')
    return kinds.most_common(1)[0][0] if kinds else 'other'


def place(search):
    """(country code, city candidate) of the search's first place, from the places already placed on this Mac (no new AI question): ('', '') when unknown."""
    from . import geo
    top = ((search or {}).get('locations') or {}).get('top_tier') or []
    for entry in geo.resolve(top[:5], ask=False).values():
        if entry.get('kind') in ('city', 'area', 'country') and entry.get('cc'):
            city = geo.norm(top[0]) if entry['kind'] == 'city' and geo.resolve(top[:1], ask=False) else ''
            return entry['cc'], city
    return '', ''


def reads(since):
    """How this search's sources were read (src/read_methods.py): read_<method>_<measure> counts, plus the sites the user's own tab read since the last report."""
    from . import read_methods
    fields = read_methods.saved(since)
    sites, jobs = read_methods.take_extension()
    if sites:
        fields = fields or {f'read_{m}_{x}': 0 for m in read_methods.METHODS for x in read_methods.MEASURES}
        fields['read_extension_tab_sources'], fields['read_extension_tab_jobs'] = sites, jobs
    return fields


def build(since, db, search, wanted):
    country, city = place(search)
    return {'family': family(search), 'country': country, 'city': city, **timings(db, since, wanted), **reads(since)}


def main(argv=None, opener=None):
    argv = sys.argv[1:] if argv is None else argv
    if '--open-count' in argv:   # fb 5/7: only that count, read-only; the full report below also takes the extension's read counters, which a second call would steal
        print(json.dumps({'open_in_places': opener() if opener else _count_in_store()}))
        return 0
    since = argv[argv.index('--since') + 1] if '--since' in argv else ''
    if not since:
        print('Give the time the search started (--since, an ISO time).', file=sys.stderr)
        return 2
    from .paths import jobs_db, load_search_config
    from .sources import feeds
    db = sqlite3.connect(jobs_db())
    print(json.dumps(build(since, db, load_search_config(), lambda location, title: feeds.wanted_location({'location': location, 'title': title}))))
    return 0


def _count_in_store():
    """The count from the job cache, opened read-only: a missing or unreadable cache is None (unknown), never an error and never a new empty file. Why (code review of fb 5/7, 5 Nov 2026): connect() made an empty jobs.sqlite and the failure counted as a failed run."""
    from .paths import jobs_db
    from .sources import feeds
    path = jobs_db()
    if not path.exists():
        return None
    try:
        db = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
        return open_in_places(db, lambda location, title: feeds.wanted_location({'location': location, 'title': title}))
    except sqlite3.Error:
        return None


if __name__ == '__main__':
    raise SystemExit(main())
