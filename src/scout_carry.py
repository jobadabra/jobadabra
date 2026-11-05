"""The central scout's feed slices: each run verifies the feeds not read for longest, and carries the others over from their last verified entry.
Why: 22-23 Oct 2026, re-reading every known feed on every run took 12 to 39+ minutes; the job must end in 15-20 minutes (owner).
Tests: tests/unit/engine/test_scout_carry.py."""

import json
import urllib.request
from datetime import datetime, timedelta

from . import role_kinds, scout_overrun

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
            entry = json.loads(row[0])
            entry.pop('answers', None)   # last read's marks: the run log counts this run's reads only (answers_line)
            out.append(entry)
    return out


def _judged(entry):
    """The date of this entry's mix: `judged` when the mix is older than the read (kept, or taken from the published index), else its read."""
    return str(entry.get('judged') or entry.get('checked') or '')[:10]


def _mix(entry):
    """{kinds, kind_counts}: this entry's valid judgment, each part None when it has none. Why (5 Nov 2026, #2915): one read before role_kinds.SINCE was judged on the
    old kinds, so it counts as none; `checked` is the only date a published entry carries (the site keeps fixed fields)."""
    if _judged(entry) < role_kinds.SINCE[:10]:
        return {'kinds': None, 'kind_counts': None}
    return {'kinds': role_kinds.valid(entry.get('kinds')), 'kind_counts': role_kinds.valid_counts(entry.get('kind_counts'))}


# The entry fields built from an AI answer about its places, beside the kind mix (_mix): a re-read the AI could not answer keeps them (answer_fields), and the published
# index restores them (_fill_answers). Why (6 Nov 2026, owner: "coverage is still empty"): #3310 kept the mix only, and 3,614 feeds lost their countries after 2 Nov.
ANSWER_FIELDS = ('countries', 'regions')


def mixes(db):
    """{(ats, slug): {kinds, kind_counts, judged, countries, regions}}: each kept entry's last valid judgment and its date, and its last place answers. A re-read
    the AI could not judge keeps these."""
    ensure(db)
    out = {}
    for system, slug, text in db.execute('SELECT ats, slug, entry FROM feed_entries'):
        entry = json.loads(text)
        out[(system, slug)] = {**_mix(entry), 'judged': _judged(entry), **{name: entry.get(name) or [] for name in ANSWER_FIELDS}}
    return out


def answer_fields(read, last):
    """An entry's place answers: read = {field: (ids, unanswered texts)} from this read, last = mixes() for this feed. A field with a text the AI did not answer
    keeps its last ids too (it can't tell which place they came from, so a place gone keeps its country until every place is answered again); a field all answered
    is this read's, an answer of none empties it. Also `answers` {kept, new, dropped: [fields]} for the run log (answers_line), and none: [fields] answered empty, which
    seed() never refills (dropped is only the first such read). The site keeps fixed fields: not published."""
    out, marks = {}, {'kept': [], 'new': [], 'dropped': [], 'none': []}
    for name, (ids, unanswered) in read.items():
        before = list(last.get(name) or [])
        value = sorted(set(ids) | set(before)) if unanswered else list(ids)
        out[name] = value
        if unanswered and set(before) - set(ids):
            marks['kept'].append(name)
        elif value and not before:
            marks['new'].append(name)
        elif before and not value:
            marks['dropped'].append(name)
        if not value and not unanswered:
            marks['none'].append(name)
    return {**out, 'answers': {mark: names for mark, names in marks.items() if names}}


def answers_line(feeds):
    """One log line per AI-answered field: entries with it, kept from an earlier answer, newly answered, dropped by an answer of none. A run that drops many reads so."""
    def count(name, mark):
        return sum(1 for f in feeds if name in (f.get('answers') or {}).get(mark, []))
    return 'AI answers on the feeds: ' + ', '.join(
        f"{name} {sum(1 for f in feeds if f.get(name))} ({count(name, 'kept')} from an earlier answer, {count(name, 'new')} new, {count(name, 'dropped')} dropped)" for name in ANSWER_FIELDS)


def mix_fields(kinds, counts, last):
    """An entry's {kinds, kind_counts, mix_kept, judged}, each only when it has one: this read's judgment, else `last` (mixes) for a part the AI could not judge. Counts
    of {} are a judgment, none local, so they clear the old ones. mix_kept feeds the run log's count (published_line); judged keeps a kept mix dated by its judgment,
    not by today's read, so a later role_kinds.SINCE still drops it. The site keeps fixed fields: neither is published."""
    kept = {'kinds': last.get('kinds') if not kinds else None, 'kind_counts': last.get('kind_counts') if counts is None else None}
    fields = {'kinds': kept['kinds'] or kinds, 'kind_counts': kept['kind_counts'] or counts, 'mix_kept': any(kept.values())}
    fields['judged'] = last.get('judged') if fields['mix_kept'] else None
    return {name: value for name, value in fields.items() if value}


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
    filled = {**{name: value for name, value in entry.items() if name not in have or have[name]}, **missing, 'judged': str(published['checked'])[:10]}   # a stale part goes: `judged` must not make it new
    db.execute('UPDATE feed_entries SET entry = ? WHERE ats = ? AND slug = ?', (json.dumps(filled, ensure_ascii=False), *key))
    return 1


def _fill_answers(db, key, stored, published):
    """Give a stored entry the place answers it lacks from the published entry; one it has, or one its last read answered none, is never replaced. Returns 1 when filled."""
    entry = json.loads(stored)
    none = (entry.get('answers') or {}).get('none') or []
    missing = {name: published[name] for name in ANSWER_FIELDS if name not in none and not entry.get(name) and isinstance(published.get(name), list) and published[name]}
    if not missing:
        return 0
    db.execute('UPDATE feed_entries SET entry = ? WHERE ats = ? AND slug = ?', (json.dumps({**entry, **missing}, ensure_ascii=False), *key))
    return 1


def seed(db, url, key, get=None):
    """The index published now is the backup of what this scout stored: a first slice run, or a cache lost, must never drop a feed or a mix (24 Oct 2026: the first slice
    run left 1250 feeds out of the index; 2 Nov 2026: a new repo's empty cache took 6,833 feeds to 3,848, as a feed with an entry but no source is neither read nor carried).
    Adds the entries this scout lacks, dated by their own read; the sources it lacks; the mix parts its entries lack.
    Returns the number of entries added; a download that fails adds none (said), and stops the run when this scout has no entry of its own."""
    ensure(db)
    db.commit()   # Why (5 Nov 2026, #2915): main's `with connect` rolls back on a stop, and the run's finds are worth keeping; an index read halfway is not
    empty = not db.execute('SELECT 1 FROM feed_entries LIMIT 1').fetchone()

    def default_get(request):
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    try:
        published = (get or default_get)(urllib.request.Request(url, headers={'Authorization': f'Bearer {key}', 'User-Agent': 'jobadabra-scout'}))
        have = {(r[0], r[1]): r[2] for r in db.execute('SELECT ats, slug, entry FROM feed_entries')}
        added = sources = filled = answered = 0
        for entry in published['feeds']:
            if not isinstance(entry, dict) or not entry.get('ats') or not entry.get('slug') or not entry.get('checked'):
                continue
            feed = (entry['ats'], entry['slug'])
            sources += _restore_source(db, entry)
            if feed in have:
                filled += _fill_mix(db, feed, have[feed], entry)
                stored = db.execute('SELECT entry FROM feed_entries WHERE ats = ? AND slug = ?', feed).fetchone()[0]   # after the mix, so neither undoes the other
                answered += _fill_answers(db, feed, stored, entry)
                continue
            db.execute('INSERT OR IGNORE INTO feed_entries (ats, slug, entry, verified_at) VALUES (?, ?, ?, ?)',
                       (*feed, json.dumps(entry, ensure_ascii=False), str(entry['checked'])[:10]))
            added += 1
        db.commit()
        if added or sources or filled or answered:
            print(f'Scout: restored from the published index: {added} entries, {sources} sources, {filled} mixes, {answered} place answers')
        return added
    except Exception as error:  # noqa: BLE001 — with entries of its own the run goes on; with none it stops below
        db.rollback()
        print(f'Warning: the published index was not read for carrying ({type(error).__name__}: {error})')
        if empty:   # Why (5 Nov 2026, #2915): the last count is unknown, so any publish could shrink the index; the site only refuses a loss of more than half (2 Nov: 6,833 to 3,848)
            scout_overrun.stop_run('Scout: stopped, nothing published: no stored feeds and the published index was not read, so this run could lose feeds')
        return 0
