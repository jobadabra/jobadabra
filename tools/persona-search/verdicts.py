"""The blind judge's place and role verdicts of one persona's found jobs, as counts for the Night search tab (tools/persona-search/gate.py puts them in each verdict row).
Why (10 Nov 2026, owner: "How can I follow to understand if our search algoritm finds jobs out of the location", after a Dublin search listed 24 of 25 jobs in other countries): the row kept only `local`
(right role AND place together), so a wrong place could not be told from a wrong role. Counts only, in fixed words: no title, employer or place text leaves the run.
A job the judge left without a verdict ('missing', 'not-judged', anything else) is `unjudged`, never "right"; each set adds up to the jobs found, which is what the site checks (jobadabra-web admin/search-night.js).
Guard: tests/tooling/ci/test_search_step_counters.py (TheRightPlaceCounts)."""

PLACE = ('yes', 'no', 'remote', 'unknown')
ROLE = ('yes', 'no')


def counts(rows):
    """{'place': {yes, no, remote, unknown, unjudged}, 'role': {yes, no, unjudged}} over the judged rows of one persona (gate_judge.py rows carry `place` and `role`)."""
    def tally(key, words):
        got = [r.get(key) for r in rows]
        out = {word: sum(1 for v in got if v == word) for word in words}
        out['unjudged'] = len(got) - sum(out.values())
        return out
    return {'place': tally('place', PLACE), 'role': tally('role', ROLE)}
