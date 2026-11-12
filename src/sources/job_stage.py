"""Where a reader's job stopped on its way to the list, said by the run (sa's finish-line plan, WP3 step 3; owner, 10 Nov 2026: "If we're using EURES, our
search results should always be what EURES gives + some additional sources that we have"): every job a reader read gets one stage in aggregators.kept,
from the verdicts feeds already holds; the run prints one count line per reader and pass, and with JOBADABRA_STAGE_LOG=1 (the Search check only, never a
user's run) one line per job with its link, no title. tools/persona-search/inout.py matches the reference's right jobs against these lines.
Stages here: kept, ai_no, never_asked, placed_out, no_link (a job without a link is never listed). The check adds not_read, after_kept and listed.
Invariant: read = the sum of the stages of one pass; no job leaves kept without one. Tests: tests/unit/sources/test_job_stage.py (G1)."""
import os

ORDER = ('kept', 'ai_no', 'never_asked', 'placed_out', 'no_link')


def inside_places(job, places=None):
    """Whether the job is in the person's places as far as anyone has said: Claude's answer for it, else the place words (once per location in a pass: `places`)."""
    from . import feeds
    key = ((job.get('location') or '').strip(), bool(job.get('remote')))
    verdict = feeds.place_of(job)   # Claude's, per posting for a vague place: never shared between jobs
    if verdict is not None:
        return verdict != 'out'
    if places is not None and key in places:
        return places[key]
    inside = feeds.wanted_location(job)   # unplaced: the place words, which read only the location and remote
    if places is not None:
        places[key] = inside
    return inside


def of(job, places=None):
    """The stage of a job that aggregators.kept did not keep: placed_out (Claude placed it outside; no place call runs and the words say no; or it
    names no place at all), never_asked (its place or its title had no answer when kept looked: no call reached it in time, or none asks on this
    path), ai_no (the title sort said no; the words, with no AI), no_link. Never 'kept': an answer that lands after kept looked was not there in time.
    `places`: one kept() pass's {(location, remote): the place words' answer}, so their regex runs once per unplaced location, not per job.
    Why (review of sf's step 3, 10 Nov 2026): a verdict landing between kept's check and this one made a dropped job read as kept; and the place
    words cost ~150 µs a job (#3709's yardstick: p5 and p13 slower; aggregators.kept() on 20,000 title-dropped jobs over 200 places, median of 3:
    3.38 s per job, 0.40 s per location, #3723), so they run once per unplaced location in a pass."""
    from . import feeds
    if not job.get('url'):
        return 'no_link'
    title = job.get('title') or ''
    key = ((job.get('location') or '').strip(), bool(job.get('remote')))
    verdict, inside = feeds.place_of(job), inside_places(job, places)
    if not inside:
        return 'never_asked' if verdict is None and feeds.placing() and key[0] else 'placed_out'
    if not feeds.wanted_title(title):
        return 'never_asked' if feeds.judged_title(title) is None and feeds.asked() else 'ai_no'
    return 'never_asked'


def listing():
    """Whether the run prints one line per job (JOBADABRA_STAGE_LOG=1, the Search check's artifact)."""
    return os.environ.get('JOBADABRA_STAGE_LOG') == '1'


def say_one(reader, stage, job):
    """One job's stage, link only, when listing()."""
    if listing():
        print(f"Stage: {reader} {stage} {job.get('url') or '-'}\n", end='', flush=True)   # one write: lines from two reader threads never run together


def say_read(reader, jobs):
    """Each job a reader read, before any filter, when listing(): a reference job with no line at all was never read."""
    if listing():
        for job in jobs:
            print(f"Stage: {reader} read {job.get('url') or '-'}\n", end='', flush=True)


def say(reader, read, stages):
    """The pass's count line: `Stages: EURES read 200 · kept 40 · ai_no 60 · never_asked 80 · placed_out 20` (the stages that occurred, in ORDER)."""
    if read:
        parts = ' · '.join(f'{stage} {stages[stage]}' for stage in ORDER if stages.get(stage))
        print(f'Stages: {reader} read {read} · {parts}', flush=True)
