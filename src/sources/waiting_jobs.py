"""The jobs a search read and had no time to judge, kept until the queue after the search judges them (src/daily_modes.py score_mode).

Design (12 Nov 2026, owner, asked via AskUserQuestion: "Yes, build it (Recommended)"; "All checked, 60 scored, 10 min (Recommended)"):
- A job a reader gave is listed (the AI said its title is the person's kind and its place is theirs), not for the person (the AI said no: the
  title and place stores remember it), or WAITING: the AI has not answered for its title or its place yet (job_stage 'never_asked').
- One owner of waiting: this table. Only a search adds to it (aggregators.kept, the one place a reader's jobs get their stage); only the queue
  takes from it (judge). Nothing else reads it.
- The queue asks the titles first, then the places of the ones whose title fits (a location that names no town: from its posting), and lists what both say yes to.
  A job is never listed on a guess.
- Bounded: the newest KEPT rows of the current search, for DAYS days and TRIES queue runs; an answer the AI never gives ends there.
Why (12 Nov 2026, 30 first searches on the Mac): job boards returned at 97 s (median) and the AI stops at 124 s, so 1,068 of 2,019 board jobs were
read and never asked; they were dropped, and their board was read again by the next 2 searches to get them back (owed_reads, removed with this).
Tests: tests/unit/sources/test_waiting_jobs.py."""
import json
from datetime import timedelta

TABLE = ('CREATE TABLE IF NOT EXISTS waiting_jobs (url TEXT PRIMARY KEY, source TEXT NOT NULL, search TEXT NOT NULL, job TEXT NOT NULL, '
         'seen_at TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0)')
KEPT = 500   # rows kept at most, the newest (owner, 12 Nov 2026: "newest 500 at most")
DAYS = 14    # a row older than this is dropped unasked: its posting is likely gone
SAID = 'Waiting to be checked after this search: '   # the fixed start of the line a search says when it keeps jobs waiting
TRIES = 3    # queue runs that may ask about a row; then the AI never answers for it and it is dropped


def _key(search):
    from . import aggregators
    return aggregators.search_key(search)


def _worth(name, job, places):
    """A never-asked job the queue can settle with few questions: its title is not refused and its place is not outside, and either it is in the person's
    places (only its title is open), or a reader that searched for their place gave it (a board lists the towns next to it), or its title already fits (only its place is open).
    Why (12 Nov 2026, test person 9, src/sources/places_later.py): a free job API lists the whole world; asked about all of it, 535-600 titles filled the AI for nobody."""
    from . import boards_ahead, feeds, job_stage
    judged = feeds.judged_title(job['title'])
    if judged is False or feeds.place_of(job) == 'out':
        return False
    return bool(judged or name == boards_ahead.NAME or job_stage.inside_places(job, places))


def keep(db, name, jobs, now, search=None, places=None):
    """Remembers reader `name`'s jobs that wait for the AI's answer, for this search only (a changed search starts a new list: its answers differ).
    A job already waiting keeps its tries. places: the pass's place-word answers (job_stage.inside_places), so they run once per location. Never raises into the read: a list of what to ask later is not worth a lost read (stage.guard counts it)."""
    from ..press import stage
    jobs = [job for job in jobs if job.get('url') and job.get('title') and _worth(name, job, places)]
    if not jobs:
        return 0
    with stage.guard('jobs kept waiting') as caught:
        from . import feeds
        key, stamp = _key(search if search is not None else feeds._SEARCH), now.isoformat(timespec='seconds')
        db.execute(TABLE)
        with db:
            db.execute('DELETE FROM waiting_jobs WHERE search != ? OR seen_at < ?', (key, (now - timedelta(days=DAYS)).isoformat(timespec='seconds')))
            for job in jobs:
                db.execute('INSERT INTO waiting_jobs (url, source, search, job, seen_at) VALUES (?, ?, ?, ?, ?) '
                           'ON CONFLICT(url) DO UPDATE SET source=excluded.source, job=excluded.job, seen_at=excluded.seen_at',
                           (job['url'], name, key, json.dumps(job, ensure_ascii=False, default=str), stamp))
            db.execute('DELETE FROM waiting_jobs WHERE url NOT IN (SELECT url FROM waiting_jobs ORDER BY seen_at DESC, rowid DESC LIMIT ?)', (KEPT,))
        print(f'{SAID}{len(jobs)} job(s) of {name}', flush=True)   # the app starts the queue on this line (desktop/lib/pipeline-tasks.js waitsOf)
        return len(jobs)
    print(f'Warning: {len(jobs)} job(s) of {name} were not kept waiting ({caught.reason})', flush=True)
    return 0


def held(db, search):
    """[(source, job)] waiting for this search, the newest first."""
    db.execute(TABLE)
    rows = db.execute('SELECT source, job FROM waiting_jobs WHERE search = ? ORDER BY seen_at DESC, rowid DESC', (_key(search),)).fetchall()
    return [(row[0], json.loads(row[1])) for row in rows]


def count(db, search):
    """How many jobs wait for this search."""
    db.execute(TABLE)
    return db.execute('SELECT count(*) FROM waiting_jobs WHERE search = ?', (_key(search),)).fetchone()[0]


def judge(db, search, now, out=print, land=None):
    """The queue's first step: asks the AI about the waiting jobs' titles, then about the places of the ones whose title fits, and hands back the
    ones both say yes to, in the report's shape (aggregators._item, recorded in the seen history) -> (checked, items to list). land(fit titles, batch): as each title batch lands.
    A row leaves the list when it is listed, when an answer says no, or after TRIES runs; one still unanswered stays for the next queue."""
    from ..ai import title_triage
    from . import aggregators, feed_places, feeds
    rows = held(db, search)
    if not rows:
        return 0, []
    jobs = [job for _, job in rows]
    # Titles first, whatever the place words say: a board searched for the person's place lists the towns next to it, and the place answer comes second.
    open_titles = [job['title'] for job in jobs if feeds.place_of(job) != 'out']
    if open_titles and feeds.placing():
        feeds._triaged()[feeds.ASKED] = True
        feeds._triaged().update(title_triage.decide(open_titles, search, local=True, land=land))
    fitting = [job for job in jobs if feeds.wanted_title(job['title'])]
    feed_places.place_jobs(fitting, chosen=True)
    # A location that names no town (only a country): the posting's own words say where the job is, before it is listed.
    # Why (12 Nov 2026, Tallinn proof on this branch): 8 jobs located "Estonia" were listed by the queue; their postings, read after, put none of them in the person's places.
    vague = [job for job in fitting if feeds.place_of(job) == 'vague' and job.get('description')]
    if vague and feeds.placing():
        from ..ai import place_triage
        feeds.read_places().update(place_triage.read(vague, search))
    items, refused = [], []
    with db:
        for name, job in rows:
            if feeds.wanted_title(job['title']) and feeds.wanted_location(job) and feeds.place_of(job) != 'vague':
                items.append(aggregators._item(db, name, job, now))
            elif feeds.judged_title(job['title']) is False or feeds.place_of(job) == 'out':   # an answer said no
                refused.append(job['url'])
        db.executemany('DELETE FROM waiting_jobs WHERE url = ?', [(item['url'],) for item in items] + [(url,) for url in refused])
        db.execute('UPDATE waiting_jobs SET tries = tries + 1 WHERE search = ?', (_key(search),))
        db.execute('DELETE FROM waiting_jobs WHERE tries >= ?', (TRIES,))
    left = count(db, search)
    out(f"Checked {len(rows)} job(s) your last search had no time for: {len(items)} listed, {len(refused)} not for you"
        f"{f', {left} still wait' if left else ''}")
    return len(rows), items
