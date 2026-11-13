"""In = out per source, per persona, for the night's rows (sa's finish-line plan, WP3 step 3; owner, 10 Nov 2026: "If we're using EURES, our search results
should always be what EURES gives + some additional sources that we have. For me it makes no sense that we get 5 while EURES gets 18"): `in` = the right
jobs a source's own search shows (the reference, tools/persona-search/reference.py → reference-jobs.json), `out` = how many of them Find jobs listed
(jobs.json by link, else judged.json by title + employer), `lost` = the others by the stage that lost them, read from the press's `Stage:` lines (src/sources/job_stage.py,
JOBADABRA_STAGE_LOG=1). Stage words (fixed list v2, sa, 10 Nov 2026): not_read, never_asked, ai_no, placed_out, double, after_kept; listed is `out`.
`double` is sent only for a job proven merged with another source's copy, which the run does not log yet, so it is 0. Counts only leave: no title or link.
Limit: the employer sites' own filter (src/sources/feeds.py scan) logs no stages yet, so a job only they read reads as not_read.
Sources: eures only; the reference's other sources' right jobs (`sources` without eures: board, web search) are left out of it until their own in = out ([mc] 5/5). Tests: tests/tooling/ci/test_search_inout.py."""
import json
import re
from pathlib import Path

from reference import same_job

LOST = ('not_read', 'never_asked', 'ai_no', 'placed_out', 'double', 'after_kept')
LINE = re.compile(r'Stage: (?P<reader>.+?) (?P<stage>read|kept|ai_no|never_asked|placed_out|no_link) (?P<url>\S+)(?: \| .*)?$')


def stages(log):
    """{url: [stage, ...]} in the order the press logged them; None when the press logged no stage at all (a build before the lines, or the flag off)."""
    seen, any_line = {}, False
    try:
        lines = Path(log).read_text(encoding='utf-8', errors='replace').splitlines()
    except OSError:
        return None
    for line in lines:
        hit = LINE.search(line)
        if hit:
            any_line = True
            seen.setdefault(hit['url'], []).append(hit['stage'])
    return seen if any_line else None


def lost_at(said):
    """The stage that lost a right job the list does not have, from its logged stages: none = not_read; read only = never_asked (read, never sorted
    before the run ended); else its last verdict, where kept means it passed every filter and still is not listed (after_kept)."""
    verdicts = [stage for stage in said or [] if stage != 'read']
    if not said or (verdicts and verdicts[-1] == 'no_link'):
        return 'not_read'
    if not verdicts:
        return 'never_asked'
    return 'after_kept' if verdicts[-1] == 'kept' else verdicts[-1]


def of(right, listed_rows, logged, listed_urls=()):
    """-> {'eures': {in, out, lost: {stage: n}}} for one persona: right = the reference's [{title, company, url}], listed_rows = judged.json's rows,
    logged = stages(...) of its press, listed_urls = the listed jobs' links (jobs.json). A job is listed when its link or its title + employer is.
    Why (review, 10 Nov 2026): the store may name the employer from the job's page (board_employers.fill_missing), so title + employer alone missed some."""
    # Why (review of [mc] 3/5): the reference also holds the board's and the web search's right jobs; EURES's in = out reads only the jobs EURES listed (an older reference has no `sources`: EURES alone)
    right = [job for job in right if 'eures' in job.get('sources', ['eures'])]
    listed, links = {same_job(row) for row in listed_rows}, set(listed_urls)
    lost = dict.fromkeys(LOST, 0)
    out = 0
    for job in right:
        if job.get('url') in links or same_job(job) in listed:
            out += 1
        else:
            lost[lost_at(logged.get(job.get('url') or ''))] += 1
    return {'eures': {'in': len(right), 'out': out, 'lost': lost}}


def attach(rows, results, reference_jobs):
    """Set row['inout'] on each verdict row whose persona has a reference, a judged list and stage lines (results = the persona artifacts' folder);
    a persona without one of them gets no key, never zeros. -> how many rows got it."""
    try:
        right_by_person = json.loads(Path(reference_jobs).read_text(encoding='utf-8'))['personas']
    except (OSError, ValueError, KeyError):
        return 0
    done = 0
    for row in rows:
        n, folder = row.get('persona'), Path(results) / f"search-personas-p{row.get('persona')}"
        if str(n) not in right_by_person:
            continue
        logged = stages(folder / 'draw' / 'run-1.log')
        try:
            judged = json.loads((folder / 'judged.json').read_text(encoding='utf-8'))['rows']
        except (OSError, ValueError, KeyError):
            continue
        if logged is None:
            continue
        try:
            links = [job.get('url') for job in json.loads((folder / 'jobs.json').read_text(encoding='utf-8')) if job.get('url')]
        except (OSError, ValueError, AttributeError):
            links = []   # an older artifact without jobs.json: title + employer only
        row['inout'] = of(right_by_person[str(n)], judged, logged, links)
        done += 1
    return done
