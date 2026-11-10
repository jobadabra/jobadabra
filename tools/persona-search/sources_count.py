"""Right jobs per source of OUR list, per person (sa, 10 Nov 2026, stage 1 of the per-source count; the owner's sentence: "30% of the jobs we find because of Web Search.
Y because of the Central scout / employer sites. X because of Linkedin Jobs… EURES"). Sets `sources` on each person's result.json, in the spec's fixed words v1:
eures, employer_sites, job_boards, free_job_apis, web_search, linkedin, plus a counted `other` (never dropped silently). Per word: right (jobs the blind judge called
right role AND right place, one per title + employer + place), only (those no other reader of ours listed), fit70 and seconds (step_yield's local_fit70 and seconds,
only where its step is exactly that word: employer_sites; the free-API step also reads "Job boards found", so its time is not one word's).
Which readers listed a job, check side only (the engine writes no step or "found by" on a job yet: stage 2, on the Work board): the stored source and every
"also on <reader>" the store noted when another reader brought the same job (gate.extract's `also`, src/store.py upsert_job). A copy at the same link replaces the
stored source instead (src/store.py), so an earlier reader of that link is not seen here. How a reader gets its word:
- eures: the reader's name or the EURES host (gate.source_kind); the host only for the stored reader (the store keeps one link), an "also on" reader by its
  name alone, which is "EURES" for the EURES reader (src/sources/reader_rows.py), so both sides name it the same way;
- employer_sites: sources.kind 'employer feed' (src/store.py import_watch_report);
- free_job_apis vs job_boards: both are sources.kind 'job board'; a reader named in the free-API stage's own reader list (src/sources/aggregators.sources, parked
  readers included) is a free API, else a board. When that list cannot be read, free_job_apis says {"status": "inside job_boards"} and its jobs count there;
- web_search: a second fact, not a reader: right board jobs whose link is on a board this person's web search found (`origin: 'web'` entries of found_boards.json
  `ideas`, copied as found-boards.json; by host, since every found board's jobs are stored as "Job boards found"); {"status": "not measured"} when no web search ran;
- linkedin: a 'job board' reader whose name starts with LinkedIn, so the word appears once its jobs are kept;
- left out: the person's own adds (kinds 'you', 'manual', the "Imported link" reader); job alert emails ("<site> alert") and anything else are `other`.
Report only: a row it cannot read is left as it is; it never fails the night.

  python3 tools/persona-search/sources_count.py <results dir>      sets `sources` on every result.json under it (the compare job, before gate.py compare)"""
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parents[1])]
from gate import source_kind  # noqa: E402

WORDS = ('eures', 'employer_sites', 'job_boards', 'free_job_apis', 'web_search', 'linkedin')
STEPS = ('employer_sites',)   # step_yield steps whose jobs are exactly one word
OWN_KINDS, OWN_NAMES = ('you', 'manual'), ('imported link',)
INSIDE = {'status': 'inside job_boards'}
NOT_MEASURED = {'status': 'not measured'}


def free_api_names():
    """The free-API stage's reader names (the engine's own list, every keyed or parked reader as if it were set up), or None when it cannot be read."""
    try:
        from src.sources import aggregators
        env = {'ADZUNA_APP_ID': 'x', 'ADZUNA_APP_KEY': 'x', 'JOOBLE_API_KEY': 'x', 'JOBADABRA_ENABLE': 'adzuna,jooble'}
        names = {name for name, _ in aggregators.sources(env)}
    except Exception:   # noqa: BLE001 (Why: an engine that cannot be imported here leaves the split unknown, said as "inside job_boards", never guessed)
        return None
    return {name.casefold() for name in names} - {'job boards found'} or None


def host(url):
    """A link's host without 'www.', '' for none or a malformed link."""
    try:
        found = (urlsplit(str(url or '')).hostname or '').casefold()
    except ValueError:
        return ''
    return found[4:] if found.startswith('www.') else found


def web_boards(out):
    """The hosts of the boards this person's web search found (found_boards.json `ideas` entries marked origin 'web', src/sources/board_web.py); None without the
    file or when no web search ran (no `web_used`), so "found none" is never confused with "never searched"."""
    try:
        data = json.loads((Path(out) / 'found-boards.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or not data.get('web_used'):
        return None
    ideas = data.get('ideas') if isinstance(data.get('ideas'), dict) else {}
    return {host(f"https://{board['host']}") for boards in ideas.values() if isinstance(boards, list)
            for board in boards if isinstance(board, dict) and board.get('origin') == 'web' and board.get('host')}


def word(name, kind, url, free):
    """One reader's word for a job (its name and sources.kind; url for EURES), None for the person's own adds."""
    name, kind = str(name or ''), str(kind or '')
    if kind in OWN_KINDS or name.casefold() in OWN_NAMES:
        return None
    if source_kind({'provider': name, 'url': url}) == 'eures':
        return 'eures'
    if kind == 'employer feed':
        return 'employer_sites'
    if kind == 'job board' and name.casefold().startswith('linkedin'):
        return 'linkedin'
    if kind == 'job board' and not name.casefold().endswith(' alert'):
        return 'free_job_apis' if free and name.casefold() in free else 'job_boards'
    return 'other'


def readers(job, free, web):
    """Every word of ours that listed this job: its stored source, each "also on" reader, and web_search when its link is on a web-found board."""
    found = {word(job.get('provider'), job.get('kind'), job.get('url'), free)}
    found |= {word(pair[0], pair[1], '', free) for pair in job.get('also') or [] if isinstance(pair, list) and len(pair) == 2}
    found.discard(None)
    link = host(job.get('url'))
    if web and link and 'job_boards' in found and any(link == board or link.endswith('.' + board) for board in web):
        found.add('web_search')
    return found


def count(judged, step_yield, free, web):
    """-> {word: {right, only, fit70, seconds} | {status}} for one person. judged: judged.json rows (the listed jobs with the judge's role and place)."""
    words_of = {}
    for job in judged:
        if isinstance(job, dict) and job.get('role') == 'yes' and job.get('place') == 'yes':
            key = tuple(str(job.get(k) or '').strip().casefold() for k in ('title', 'company', 'location'))
            words_of.setdefault(key, set()).update(readers(job, free, web))
    steps = {s.get('step'): s for s in step_yield or [] if isinstance(s, dict)}
    out = {}
    for name in (*WORDS, 'other'):
        rivals = [words - {'web_search'} for words in words_of.values() if name in words]   # web_search is a second fact on a board's job, never a rival reader
        only = sum(1 for rest in rivals if (len(rest) <= 1 if name == 'web_search' else rest <= {name}))
        step = steps.get(name) if name in STEPS else None
        out[name] = {'right': len(rivals), 'only': only, 'fit70': step.get('local_fit70') if step else None, 'seconds': step.get('seconds') if step else None}
    if not free:
        out['free_job_apis'] = INSIDE   # word() already gave every free-API job to job_boards: the count is there, never a zero here
    if web is None:
        out['web_search'] = NOT_MEASURED
    if not out['linkedin']['right']:
        del out['linkedin']   # the word appears by itself once LinkedIn's jobs are kept and judged right
    return out


def annotate(results):
    """Set `sources` on every person's result.json under a folder (its judged.json and found-boards.json beside it); returns the persons set."""
    free, done = free_api_names(), []
    for path in sorted(Path(results).rglob('result.json')):
        try:
            row = json.loads(path.read_text(encoding='utf-8'))
            judged = json.loads((path.parent / 'judged.json').read_text(encoding='utf-8'))['rows']
            if not isinstance(judged, list):
                raise TypeError('judged rows are not a list')   # zeros would claim a count it never made
            row['sources'] = count(judged, row.get('step_yield'), free, web_boards(path.parent))
        except Exception as error:   # noqa: BLE001 (Why: report only; one person's odd file never costs the night its compare, floors and send)
            print(f'sources: {path.parent.name} not counted ({type(error).__name__})', flush=True)
            continue
        path.write_text(json.dumps(row, ensure_ascii=False), encoding='utf-8')
        done.append(row.get('persona'))
    return done


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    print(f'sources counted: {annotate(sys.argv[1]) or "none"}')
