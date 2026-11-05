"""The central scout's feed slices: each run verifies the feeds not read for longest, and carries the others over from their last verified entry.
Why: 22-23 Oct 2026, re-reading every known feed on every run took 12 to 39+ minutes; the job must end in 15-20 minutes (owner).
Tests: tests/unit/engine/test_scout_carry.py."""

import json
import urllib.request
from datetime import datetime, timedelta

from . import role_kinds

CARRY_DAYS = 7   # a feed not verified for this long leaves the index until it answers again


def ensure(db):
    db.execute('CREATE TABLE IF NOT EXISTS feed_entries (ats TEXT NOT NULL, slug TEXT NOT NULL, entry TEXT NOT NULL, verified_at TEXT NOT NULL, '
               'PRIMARY KEY (ats, slug))')


def order(db, items):
    """The known feeds, never-verified first, then the longest unverified: a run that stops early has read the ones most due."""
    ensure(db)
    seen = {(r[0], r[1]): r[2] for r in db.execute('SELECT ats, slug, verified_at FROM feed_entries')}
    return sorted(items, key=lambda item: seen.get(item[0], ''))


def keep(db, entries, at):
    """Remember the verified, published entries (each with its freshness) so the next runs can carry them."""
    ensure(db)
    for entry in entries:
        db.execute('INSERT OR REPLACE INTO feed_entries (ats, slug, entry, verified_at) VALUES (?, ?, ?, ?)',
                   (entry['ats'], entry['slug'], json.dumps(entry, ensure_ascii=False), at))
    db.commit()


def carried(db, skipped, at):
    """The kept entries of feeds this run did not reach, when verified within CARRY_DAYS: [entry]."""
    ensure(db)
    cutoff = (datetime.fromisoformat(at) - timedelta(days=CARRY_DAYS)).date().isoformat()
    out = []
    for key in skipped:
        row = db.execute('SELECT entry, verified_at FROM feed_entries WHERE ats = ? AND slug = ?', key).fetchone()
        if row and row[1] >= cutoff:
            out.append(json.loads(row[0]))
    return out


def _mix(entry):
    """{kinds, kind_counts}: this entry's valid judgment, each part None when it has none. Why (5 Nov 2026, #2915): one read before role_kinds.SINCE was judged on the
    old kinds, so it counts as none; `checked` is the date a published entry carries (the site keeps fixed fields only)."""
    if str(entry.get('checked') or '')[:10] < role_kinds.SINCE[:10]:
        return {'kinds': None, 'kind_counts': None}
    return {'kinds': role_kinds.valid(entry.get('kinds')), 'kind_counts': role_kinds.valid_counts(entry.get('kind_counts'))}


def mixes(db):
    """{(ats, slug): {kinds, kind_counts}}: each kept entry's last valid judgment. A re-read the AI could not judge keeps these."""
    ensure(db)
    return {(system, slug): _mix(json.loads(text)) for system, slug, text in db.execute('SELECT ats, slug, entry FROM feed_entries')}


def _restore_source(db, entry):
    """Make a published feed a known source again: build_index reads and carries only those. A row already there is left as it is, so a feed switched off stays off.
    Returns 1 when added."""
    if not entry.get('company'):
        return 0
    before = db.total_changes
    db.execute('INSERT OR IGNORE INTO feed_sources (ats, slug, company, tier, quality, added_at) VALUES (?, ?, ?, ?, ?, ?)',
               (entry['ats'], entry['slug'], str(entry['company'])[:120], entry.get('tier') or 'Standard', entry.get('quality'), str(entry['checked'])[:10]))
    return db.total_changes - before


def _fill_mix(db, key, stored, published):
    """Give a stored entry the parts of the published mix it lacks, and nothing else: a part it has is never replaced, and its own read stays. Returns 1 when filled."""
    entry = json.loads(stored)
    have, offered = _mix(entry), _mix(published)
    missing = {part: offered[part] for part in have if not have[part] and offered[part]}
    if not missing:
        return 0
    db.execute('UPDATE feed_entries SET entry = ? WHERE ats = ? AND slug = ?', (json.dumps({**entry, **missing}, ensure_ascii=False), *key))
    return 1


def seed(db, url, key, get=None):
    """The index published now is the backup of what this scout stored: a first slice run, or a cache lost, must never drop a feed or a mix (24 Oct 2026: the first slice
    run left 1250 feeds out of the index; 2 Nov 2026: a new repo's empty cache took 6,833 feeds to 3,848, as a feed with an entry but no source is neither read nor carried).
    Adds the entries this scout lacks, dated by their own read; the sources it lacks; the mix parts its entries lack.
    Returns the number of entries added; a download that fails adds none (said, never fatal)."""
    ensure(db)

    def default_get(request):
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    try:
        published = (get or default_get)(urllib.request.Request(url, headers={'Authorization': f'Bearer {key}', 'User-Agent': 'jobadabra-scout'}))
        have = {(r[0], r[1]): r[2] for r in db.execute('SELECT ats, slug, entry FROM feed_entries')}
        added = sources = filled = 0
        for entry in published.get('feeds') or []:
            if not isinstance(entry, dict) or not entry.get('ats') or not entry.get('slug') or not entry.get('checked'):
                continue
            feed = (entry['ats'], entry['slug'])
            sources += _restore_source(db, entry)
            if feed in have:
                filled += _fill_mix(db, feed, have[feed], entry)
                continue
            db.execute('INSERT OR IGNORE INTO feed_entries (ats, slug, entry, verified_at) VALUES (?, ?, ?, ?)',
                       (*feed, json.dumps(entry, ensure_ascii=False), str(entry['checked'])[:10]))
            added += 1
        db.commit()
        if added or sources or filled:
            print(f'Scout: restored from the published index: {added} entries, {sources} sources, {filled} mixes')
        return added
    except Exception as error:  # noqa: BLE001 — without it the run still goes on, with what it stored itself
        print(f'Warning: the published index was not read for carrying ({type(error).__name__}: {error})')
        return 0
