"""The market count's employer career sites: for one fictional candidate, the jobs the employers of the central index (src/employer_index.py) list in the person's region,
read from each employer's own public feed (src.sources.ats fetchers, the engine's shared readers: no pipeline stage), as rows the blind judge reads. Only finding here.
Which employers: the index's feeds whose `places` name the region; which jobs: a read feed's jobs whose location names it. "Names" = holds the city, one of its local
spellings (market-places.json) or the name of the person's NUTS-2 region (src.sources.nuts_names, the EURES helper; not its NUTS-3 parts: "Rhône" matched
Bouches-du-Rhône and "Midland" Texas, review of [mc] 4/5), case- and accent-folded, as whole words; no AI (sa, 10 Nov 2026: it only bounds what the
blind judge sees; the judge still decides role AND place), so this source is a floor and says by how much: `feeds_unplaced` (index feeds with no place, never read) and
`rows_outside_by_text` (jobs of a read feed whose location did not name the region, e.g. a suburb).
Why (owner, 10 Nov 2026: "…on the big employer sites, on the career… summing all the jobs I found… should be the number what Jobadabra finds"; spec's fixed source list:
"Employer career sites: the employers the index names for the person's places, read by the reference counter, not by the pipeline"; [mc] 4/5).
A short count never reads "counted" (sa, 10 Nov 2026, the lesson of [mc] 2/5's review): over CAP rows, or a feed not read, makes it "partial: …" with the numbers.
  python3 tools/persona-search/market_employers.py <persona n>     one person's rows, printed (no AI; downloads the index with its own install token)
Tests: tests/tooling/ci/test_market_employers.py."""
import json
import os
import re
import sys
import tempfile
import threading
import unicodedata
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from src.sources import host_pace  # noqa: E402   stdlib only; its Busy is a 429 the referee does not retry

CAP = 100   # rows per person to the judge (sa's design, 10 Nov 2026); more is "partial: first 100 of N", the stable order below decides which
REFUSED = (401, 403, 429)
LOCAL = json.loads((Path(__file__).resolve().parent / 'market-places.json').read_text(encoding='utf-8'))['local']
UNSPLIT = str.maketrans({'ø': 'o', 'Ø': 'O', 'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'æ': 'ae', 'Æ': 'AE', 'ß': 'ss', 'œ': 'oe', 'Œ': 'OE'})   # letters NFKD keeps whole


def fold(text):
    """Lower case, no accents, words separated by single spaces: "Île-de-France" -> "ile de france"."""
    plain = ''.join(c for c in unicodedata.normalize('NFKD', str(text or '').translate(UNSPLIT)) if not unicodedata.combining(c))
    return ' '.join(re.sub(r'[^\w]+', ' ', plain.casefold()).split())


def region_names(persona, table):
    """The folded names that place a job in the person's region: the city, its local spellings, and its NUTS-2 region's name (each side of an "A / B" name)."""
    names = {fold(persona['city']), *(fold(n) for n in LOCAL.get(persona['city'], ()))}
    names.update(fold(part) for part in str(table.get(persona['reference']['nuts2']) or '').split('/'))
    return {n for n in names if len(n) >= 3}


def names_place(text, names):
    """Whether a place string holds one of the names as whole words."""
    folded = f' {fold(text)} '
    return any(f' {name} ' in folded for name in names)


def _index():
    """The central index's feeds, downloaded with this run's own install id and token into a temporary cache, or None when it could not be had
    (also in a fixture run, where the engine's load answers [] by design: no index, never a count of 0)."""
    if os.getenv('JOBADABRA_FIXTURE_DIR'):
        return None
    from src import employer_index
    with tempfile.TemporaryDirectory() as folder:
        feeds = employer_index.load(cache=Path(folder) / 'employer_index.json')
    return None if employer_index.problem else feeds


def _fetch(system, slug):
    """One feed through the engine's shared reader, with its slow-down retries off for this process: a 429 (or host_pace's "403 right after a burst") is final
    for the feed here, raised as host_pace.Busy. Why (sa, 10 Nov 2026): the engine's pace (host_pace.open, 20 Oct 2026, kept by the owner on 10 Nov 2026) waits and asks a 429
    again up to 3 times; a count must not lean on retries: the same page read the same way every run, a site that asks us to slow down is that feed refused. The switch lives only in the referee's own process
    (reference.py run, this file's command line), set at its first feed read, never on import: no engine run imports this file, so the engine keeps its 3."""
    from src.sources import ats, host_pace
    host_pace.RETRIES = 0
    return ats.fetch(system, slug)


def _names_table():
    from src.sources import nuts_names
    return nuts_names.names()


class Employers:
    """Reads the employer sites for any number of persons in one run: the index downloaded once, each feed read once (a feed two persons share is one read),
    safe to call from several threads. `stop()` true = the run's time is up: feeds not yet read are counted as not read (a partial count), never waited for."""

    def __init__(self, load=_index, fetch=_fetch, table=_names_table, stop=lambda: False):
        self.load, self.fetch, self.table, self.stop = load, fetch, table, stop
        self.lock, self.feeds, self.index, self.loaded = threading.Lock(), {}, None, False

    def _the_index(self):
        with self.lock:
            if not self.loaded:
                self.index, self.loaded = self.load(), True
            return self.index

    def _read(self, feed):
        """('read', jobs) | ('refused', code) | ('failed', why) | ('time', ''), once per feed for the run: a refusal ends that feed, never retried."""
        key = (feed['ats'], feed['slug'])
        with self.lock:
            slot = self.feeds.setdefault(key, {'lock': threading.Lock(), 'got': None})
        with slot['lock']:
            if slot['got'] is None:
                if self.stop():
                    return ('time', '')   # the run's time is up: not read for this person (nor any later one: the clock only moves on)
                try:
                    slot['got'] = ('read', list(self.fetch(*key)))
                except urllib.error.HTTPError as error:
                    slot['got'] = ('refused' if error.code in REFUSED else 'failed', str(error.code))
                except host_pace.Busy:   # a slow-down with no retry (see _fetch): refused for the run
                    slot['got'] = ('refused', '429')
                except Exception as error:   # noqa: BLE001 - one feed that fails is that feed not read, never the end of the person or the run
                    slot['got'] = ('failed', type(error).__name__)
            return slot['got']

    def __call__(self, persona):
        """-> {"source": "employer_sites", "status", "rows", feeds_*, rows_*}. Status: "counted" (every feed naming the region read, all its in-region jobs under CAP),
        "partial: <what is short>" (still counted, with its numbers), or "not counted: index not downloaded"."""
        index = self._the_index()
        if index is None:
            return {'source': 'employer_sites', 'status': 'not counted: index not downloaded', 'rows': []}
        table = self.table()
        names = region_names(persona, table)
        placed = [f for f in index if f.get('places')]
        tried = sorted((f for f in placed if any(names_place(p, names) for p in f['places'])), key=lambda f: (f['company'].casefold(), f['ats'], f['slug']))
        rows, seen, outside, read, refused, failed, late = [], set(), 0, 0, 0, 0, 0
        for feed in tried:
            outcome, jobs = self._read(feed)
            if outcome != 'read':
                refused += outcome == 'refused'
                failed += outcome == 'failed'
                late += outcome == 'time'
                continue
            read += 1
            for job in jobs:
                if not names_place(job.get('location'), names):
                    outside += 1
                    continue
                key = job.get('url') or (fold(job.get('title')), fold(feed['company']))
                if key not in seen:
                    seen.add(key)
                    rows.append({'title': job.get('title') or '', 'company': feed['company'], 'location': job.get('location') or '', 'url': job.get('url') or ''})
        rows.sort(key=lambda r: (fold(r['company']), fold(r['title']), r['url']))
        numbers = {'feeds_tried': len(tried), 'feeds_read': read, 'feeds_refused': refused, 'feeds_failed': failed, 'feeds_late': late,
                   'feeds_unplaced': len(index) - len(placed), 'rows_in_region': len(rows), 'rows_outside_by_text': outside}
        if tried and not read:   # nothing read is no count, never 0 (review of [mc] 4/5)
            return {'source': 'employer_sites', 'status': f'not counted: 0 of {len(tried)} feeds read', 'rows': [], **numbers}
        short = [f'first {CAP} of {len(rows)} rows'] if len(rows) > CAP else []
        if read < len(tried):
            short.append(f'{read} of {len(tried)} feeds')
        if persona['reference']['nuts2'] not in table:
            short.append('city names only (no NUTS table)')
        return {'source': 'employer_sites', 'status': f"partial: {' · '.join(short)}" if short else 'counted', 'rows': rows[:CAP], **numbers}


if __name__ == '__main__':
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from gate import PERSONAS  # noqa: E402
    got = Employers()(PERSONAS[int(sys.argv[1]) - 1])
    print({k: v for k, v in got.items() if k != 'rows'})
    for row in got['rows']:
        print(' |', row['title'][:60], '|', row['company'][:40], '|', row['location'][:40], '|', row['url'][:80])
