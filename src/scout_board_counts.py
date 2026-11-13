"""How many jobs of each role family a job board gave in one country: the Central Scout's yield table (a fact's `family_jobs`), what a board is proven by.
Why (13 Nov 2026, bp, owner: "Why ? Let's fix it."; "we don't have only the information 3+ right jobs. But we know exactly: this board will give x jobs, this other board will give y jobs"):
a fact kept only the SET of role families seen once on a board plus the count of ALL its local jobs, and the site credited that count to every family of the set: an airline
board with 178 Spanish jobs, one of them an aircraft electrician, was "measured" for electricians (and construction, driving, data) and was the first board read for an
electrician in Madrid in 5 of 5 searches, with 0 right jobs. Now each family has its own number: the board's local jobs the AI puts in that family, over every job the pass read
(not a first 40), only for a family the board was asked for (its own search word ran, or the board lists its jobs with no search); a family never asked is absent: "not measured",
never 0. MIN_RIGHT decides only "may be read first"; the engine orders by the number itself (src/ai/board_ideas.py). Tests: tests/unit/sources/test_scout_boards.py."""
import json
from collections import Counter

from . import pool_tags

MIN_RIGHT = 3        # jobs of ONE role family, located in the country, before a board is proven for that family (the site checks it again)
KIND_BATCH = 50      # titles a kinds-of-work question holds (the places' batch is the same size)
MAX_TITLES = 200     # distinct titles one board's jobs are asked about: 4 questions a board at most (src/scout_boards.py KIND_CALLS)


def kinds_of(local):
    """(families, unanswered, counts) of these jobs: counts is {family: jobs the AI put in it}, over every job whose title was asked (the first MAX_TITLES distinct
    titles, KIND_BATCH a question); families = the ones with a job. Unanswered titles mean "not asked", never "no kinds"."""
    titles = list(dict.fromkeys(str(job.get('title') or '') for job in local if job.get('title')))[:MAX_TITLES]
    each, unanswered = {}, []
    for start in range(0, len(titles), KIND_BATCH):
        got, missed = pool_tags.families_each(titles[start:start + KIND_BATCH])
        each.update(got)
        unanswered += missed
    counts = Counter(family for job in local for family in each.get(str(job.get('title') or '').strip(), ()))
    return sorted(counts), unanswered, dict(sorted(counts.items()))


def measured_counts(counts, asked, searched, lists):
    """{family: jobs} for the families this read measured: a board that lists its jobs with no search of its own word (a category page, or a feed it declares: lists)
    measured every family asked (0 where none of its list is); a board with a search box only the families whose own word ran (searched: the lowercase words that did),
    asked = {family: its words}. Others are absent."""
    if lists:
        return {**{family: 0 for family in asked}, **counts}
    ran = {family for family, words in asked.items() if any(word.lower() in searched for word in words)}
    return {family: counts.get(family, 0) for family in sorted(ran)}


def proven_families(fact):
    """The families a fact proves the board for: MIN_RIGHT+ jobs of it in its country (a fact with no count, kept before 13 Nov 2026, proves none)."""
    return sorted(family for family, jobs in (fact.get('family_jobs') or {}).items() if jobs >= MIN_RIGHT)


def _counts(text):
    """{family: jobs} from a stored family_jobs (JSON); {} for none or a damaged one, never an error."""
    try:
        value = json.loads(text) if text else {}
    except ValueError:
        return {}
    return {family: jobs for family, jobs in value.items() if family in pool_tags.FAMILIES and isinstance(jobs, int)} if isinstance(value, dict) else {}
