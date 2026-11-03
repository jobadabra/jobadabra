# Which scored jobs have an old score, read without an AI call or a write: the Re-score action's list (Find jobs never re-scores them).
"""Design (3 Nov 2026, owner, via the coordinator): "if those jobs are already in the jobs list that the users sees, and we just need to rescore, then
that should not be handled by find jobs at all". A job that already has a score is re-scored only by the Re-score action (mode rescore), so the
screens need the list of those jobs: this one function, read by Strategy's notice and by the Jobs list, so both count the same jobs.

A score is old when its posting text changed, the scoring part of the Profile was edited, or the person asked for it again (input_hash ''); NOT when
only the facts read from the posting arrived after the score (the reading step runs after scoring: counting it would mark every job old after
every search). Guarded by tests/test_score_old.py."""
from . import score


def old_ids(db, candidates, profile):
    """Ids of the candidates that have a score made from a different posting text or Profile than today's. -> set. profile: the whole Profile text.
    A candidate without a description, or without a score yet, is never in it (a job without a score is Find jobs' to score)."""
    if not profile:
        return set()
    scoring = score.scoring_profile(profile)
    rows = {row['job_id']: row for row in db.execute('SELECT job_id, scorer_version, input_hash FROM scores')}
    old = set()
    for job in candidates:
        row = rows.get(job['id'])
        if not row or not job.get('description'):
            continue
        current = {score.input_hash(job, facts, text) for facts in (job.get('ai'), None) for text in (scoring, profile)}   # profile: scores made before scoring_profile existed
        if row['scorer_version'] != score.SCORER_VERSION or row['input_hash'] not in current:
            old.add(job['id'])
    return old
