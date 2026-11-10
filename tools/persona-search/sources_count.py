"""Right jobs per source of OUR list, per person (sa, 10 Nov 2026, stage 1 of the per-source count; the owner's sentence: "30% of the jobs we find because of Web Search.
Y because of the Central scout / employer sites. X because of Linkedin Jobs… EURES"). Sets `sources` on each person's result.json, in the spec's fixed words v1:
eures, employer_sites, job_boards, free_job_apis, web_search, linkedin, plus a counted `other` (never dropped silently). Per word: right (the blind judge's right role
AND right place), only (right jobs no other word of ours listed, by title + employer), fit70 and seconds (the run's step_yield, only where a step is that word).
How a job gets its word, check side only (the engine writes no step or "found by" on a job yet: stage 2, on the Work board):
- eures: the stored source's name or the EURES host (gate.source_kind);
- employer_sites: sources.kind 'employer feed' (src/store.py import_watch_report);
- free_job_apis vs job_boards: both are sources.kind 'job board'; a source named in the free-API stage's own reader list (src/sources/aggregators.sources) is a free API,
  else a board. When that list cannot be read, free_job_apis says {"status": "inside job_boards"} and the count goes to job_boards: never a zero;
- web_search: a second fact, not a reader: right board jobs whose link is on a board this person's web search found (`origin: 'web'` entries of
  found_boards.json `ideas`, copied as found-boards.json; told by host, since every found board's jobs are stored as "Job boards found"); without the file,
  {"status": "not measured"};
- linkedin: the source's name, so the word appears once its jobs are kept (lt's #3710);
- the person's own adds (kinds 'you', 'manual') are left out; anything else is `other`.

  python3 tools/persona-search/sources_count.py <results dir>      sets `sources` on every result.json under it (the compare job, before gate.py compare)"""
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parents[1])]
from gate import source_kind  # noqa: E402

WORDS = ('eures', 'employer_sites', 'job_boards', 'free_job_apis', 'web_search', 'linkedin')
STEPS = ('employer_sites', 'job_boards', 'free_job_apis')   # step_yield's finder steps that are one word each
OWN = ('you', 'manual')
INSIDE = {'status': 'inside job_boards'}
NOT_MEASURED = {'status': 'not measured'}


def free_api_names():
    """The free-API stage's reader names (the engine's own list, every keyed reader as if its key were set), or None when it cannot be read."""
    try:
        from src.sources import aggregators
        names = {name for name, _ in aggregators.sources({'ADZUNA_APP_ID': 'x', 'ADZUNA_APP_KEY': 'x', 'JOOBLE_API_KEY': 'x'})}
    except Exception:   # noqa: BLE001 (Why: an engine that cannot be imported here leaves the split unknown, said as "inside job_boards", never guessed)
        return None
    return {name.casefold() for name in names} - {'job boards found'} or None


def host(url):
    """A link's host without 'www.', '' for none."""
    found = (urlsplit(str(url or '')).hostname or '').casefold()
    return found[4:] if found.startswith('www.') else found


def web_boards(out):
    """The hosts of the boards this person's web search found (found_boards.json `ideas` entries marked origin 'web', src/sources/board_web.py), or None
    without the file."""
    try:
        data = json.loads((Path(out) / 'found-boards.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    ideas = (data or {}).get('ideas') or {} if isinstance(data, dict) else {}
    return {host(f"https://{board.get('host')}") for boards in ideas.values() if isinstance(boards, list)
            for board in boards if isinstance(board, dict) and board.get('origin') == 'web' and board.get('host')}


def word(job, free):
    """One listed job's word, None for the person's own adds."""
    provider, kind = str(job.get('provider') or ''), str(job.get('kind') or '')
    if kind in OWN:
        return None
    if source_kind(job) == 'eures':
        return 'eures'
    if provider.casefold() == 'linkedin':
        return 'linkedin'
    if kind == 'employer feed':
        return 'employer_sites'
    if kind == 'job board':
        return 'free_job_apis' if free and provider.casefold() in free else 'job_boards'
    return 'other'


def key(job):
    """A job's identity across readers: title + employer, case-folded."""
    return (str(job.get('title') or '').strip().casefold(), str(job.get('company') or '').strip().casefold())


def count(listed, judged, step_yield, free, web):
    """-> {word: {right, only, fit70, seconds} | {status}} for one person. listed = jobs.json rows (provider, kind), judged = judged.json rows."""
    words_of = {}
    for job in listed:
        found = word(job, free)
        if found:
            words_of.setdefault(key(job), set()).add(found)
            if web and found == 'job_boards' and host(job.get('url')) in web:
                words_of[key(job)].add('web_search')
    right = [key(r) for r in judged if r.get('role') == 'yes' and r.get('place') == 'yes']
    steps = {s.get('step'): s for s in step_yield or [] if isinstance(s, dict)}
    out = {}
    for name in (*WORDS, 'other'):
        hits = [k for k in right if name in words_of.get(k, ())]
        # web_search is a second fact on a board's job, never a rival reader: a job is "only" this word when no OTHER reader of ours listed it
        only = sum(1 for k in hits if len(words_of[k] - {'web_search', name}) == 0 or name == 'web_search' and len(words_of[k] - {'web_search'}) <= 1)
        step = steps.get(name) if name in STEPS else None
        out[name] = {'right': len(hits), 'only': only, 'fit70': step.get('fit70') if step else None, 'seconds': step.get('seconds') if step else None}
    if not free:
        out['free_job_apis'] = INSIDE   # word() already gave every free-API job to job_boards: the count is there, never a zero here
    if web is None:
        out['web_search'] = NOT_MEASURED
    if not out['linkedin']['right'] and not any('linkedin' in w for w in words_of.values()):
        del out['linkedin']   # the word appears by itself once LinkedIn's jobs are kept
    return out


def annotate(results):
    """Set `sources` on every person's result.json under a folder (its jobs.json, judged.json, found-boards.json beside it); returns the persons set."""
    free, done = free_api_names(), []
    for path in sorted(Path(results).rglob('result.json')):
        try:
            row = json.loads(path.read_text(encoding='utf-8'))
            listed = json.loads((path.parent / 'jobs.json').read_text(encoding='utf-8'))
            judged = json.loads((path.parent / 'judged.json').read_text(encoding='utf-8'))['rows']
        except (OSError, ValueError, KeyError, TypeError):
            continue
        row['sources'] = count(listed, judged, row.get('step_yield'), free, web_boards(path.parent))
        path.write_text(json.dumps(row, ensure_ascii=False), encoding='utf-8')
        done.append(row.get('persona'))
    return done


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    print(f'sources counted: {annotate(sys.argv[1]) or "none"}')
