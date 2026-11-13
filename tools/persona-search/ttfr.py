"""Time to first relevant job (owner, 18 Oct 2026: "time to first relevant job as fast as possible"), from the first Find jobs press of a persona
install (tools/persona-search/run.mjs adds it to press 1's row): seconds until the 1st and 10th open job in the user's places appeared (the Jobs
list shows it then), and until the 1st and 10th scored fit 70+. Run from the repo root with PYTHONPATH=. and the persona's
JOBADABRA_CONFIG_DIR / JOBADABRA_DATA_DIR. Prints one JSON line. Optional: the press-1
log, for step times."""
import json
import re
import sqlite3
import sys
from datetime import datetime

from scores_rows import has, scores_rows
from src.paths import DATA, JOBS_DB
from src.sources import feeds


def ts(text):
    return datetime.fromisoformat(text.replace('Z', '+00:00')).timestamp()


def jobs_in_places():
    """One row per open job in the user's places: {title, company, location, seen_s, fit, scored_s}, seconds from the first press's start (fit and
    scored_s None while unscored); [] when the press was cut before any step opened the stores.
    Why (PR 3130, run 41807509648, 4 Nov 2026): the 3-minute stop came before the first step, the tables were missing and this died, so the row went red
    "wrote no numbers" and the persona's row was lost."""
    tracker, db = sqlite3.connect(DATA / 'tracker.sqlite'), sqlite3.connect(JOBS_DB)
    if not has(tracker, 'cron_runs') or not has(db, 'jobs'):
        return []
    starts = [ts(r[0]) for r in tracker.execute('SELECT started_at FROM cron_runs') if r[0]]
    if not starts:
        return []
    t0 = min(starts)
    rows = db.execute("SELECT j.id, j.title, j.location, j.first_seen_at, co.name FROM jobs j LEFT JOIN companies co ON co.id = j.company_id "
                      "WHERE j.state = 'open'").fetchall()
    scores = {}
    for job_id, created, data in scores_rows(db, 'SELECT job_id, created_at, data_json FROM scores'):   # none yet when the 180 s budget stopped the press first
        scores[job_id] = (created, (json.loads(data or '{}').get('score') or 0))
    out = []
    for job_id, title, location, first_seen, company in rows:
        if not first_seen or not feeds.wanted_location({'location': location or '', 'title': title}):
            continue
        created, fit = scores.get(job_id, (None, None))
        out.append({'title': title, 'company': company or '', 'location': location or '', 'seen_s': ts(first_seen) - t0, 'fit': fit,
                    'scored_s': max(ts(created), ts(first_seen)) - t0 if created else None})
    return out


def seen_and_fit(jobs=None):
    """(seconds each in-places job appeared, seconds each fit 70+ was scored), sorted, from jobs_in_places()."""
    jobs = jobs_in_places() if jobs is None else jobs
    return sorted(j['seen_s'] for j in jobs), sorted(j['scored_s'] for j in jobs if j['scored_s'] is not None and (j['fit'] or 0) >= 70)


def main():
    args = sys.argv[1:]
    jobs = jobs_in_places()
    seen, fit = seen_and_fit(jobs)
    at = lambda xs, n: round(xs[n - 1]) if len(xs) >= n else None
    out = {'first_in_places_s': at(seen, 1), 'tenth_in_places_s': at(seen, 10), 'first_fit70_s': at(fit, 1), 'tenth_fit70_s': at(fit, 10),
           'in_places': len(seen), 'fit70': len(fit)}
    if args:   # where the time went, from the press's own log lines ("[123s] ...")
        marks = {'first new job': r'New job: ', 'first jobs added': r'^Added \d+ new job', 'boards proposed': r'Job boards proposed',
                 'titles sorted (first)': r'^Titles: .* sorted', 'first digest': r'^Digest ready', 'scout start': r'Searching wider|Growing your sources|^Scout: reading'}
        steps = {}
        for line in open(args[0], encoding='utf-8', errors='replace'):
            m = re.match(r'\[(\d+)s\] (.*)', line)
            if not m:
                continue
            for name, pattern in marks.items():
                if name not in steps and re.search(pattern, m.group(2)):
                    steps[name] = int(m.group(1))
        out['steps_s'] = steps
    print(json.dumps(out))


if __name__ == '__main__':
    main()
