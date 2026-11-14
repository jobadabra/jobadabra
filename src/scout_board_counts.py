"""How many jobs of each role family a job board gave in one country: the Central Scout's yield table (a fact's `family_jobs`, and `listed_families`: the families whose count was read from the board's own list), what a board is proven by.
Why (13 Nov 2026, bp, owner: "Why ? Let's fix it."; "we don't have only the information 3+ right jobs. But we know exactly: this board will give x jobs, this other board will give y jobs"):
a fact kept only the SET of role families seen once on a board plus the count of ALL its local jobs, and the site credited that count to every family of the set: an airline
board with 178 Spanish jobs, one of them an aircraft electrician, was "measured" for electricians (and construction, driving, data) and was the first board read for an
electrician in Madrid in 5 of 5 searches, with 0 right jobs. Now each family has its own number: the board's local jobs the AI puts in that family, over every job the pass read
(not a first 40), only for a family the board was asked for (its own search word ran, or the board lists its jobs with no search); a family never asked is absent: "not measured",
never 0. MIN_RIGHT decides only "may be read first"; the engine orders by the number itself (src/ai/board_ideas.py). Tests: tests/unit/sources/test_scout_boards.py."""
import json
from collections import Counter

from . import pool_tags

LISTED_RULE = 1      # the rule a fact is measured under: 1 = a count read from the board's own list is marked `listed` (#4067); a fact with no rule (NULL) was measured before it
# A fact carries the number of the rule it was measured under (scout_board_facts.rule, written by keep_fact), and a fact below LISTED_RULE is read again
# (src/scout_board_cells.py stale()). A future change of HOW a fact is measured bumps THIS integer: that is the mechanism for every later rule, not a one-off.
# Why (14 Nov 2026, sa for the owner: "A, build it now, test first; B is refused (it would empty searches)"): a fact measured under an old rule was served as if measured under the
# new one (airlinejobs.com es: 53 from a list, served as searched); `listed_families` is stored only when a count was read from a list, so "no mark" meant both "measured before the rule"
# and "measured under it, nothing listed", and nothing re-measured the fact before its 20-day refresh.
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


def searched(asked, terms, lists):
    """The families this read asked: all of them for a board that lists its jobs with no search of its own word (lists: a category page, or a feed it declares), else the
    ones whose own word ran (terms: the lowercase words the read searched, written by src/sources/found_boards.py). asked = {family: its words}."""
    return set(asked) if lists else {family for family, words in asked.items() if any(word.lower() in terms for word in words)}


def measured_counts(counts, asked, terms, lists):
    """{family: jobs} for the families this read asked (searched): 0 where none of its jobs are; a family never asked is absent (not measured, never 0)."""
    ran = searched(asked, terms, lists)
    return {**{family: 0 for family in sorted(ran)}, **{family: jobs for family, jobs in counts.items() if lists or family in ran}}


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


def listed_of(text):
    """[family] from a stored listed_families (JSON): the families whose count was read from the board's own list; [] for none or a damaged one, never an error."""
    try:
        value = json.loads(text) if text else []
    except ValueError:
        return []
    return sorted({family for family in value if family in pool_tags.FAMILIES}) if isinstance(value, list) else []


def keep_fact(db, fact, country, fresh, stamp):
    """Write one board's fact to scout_board_facts, merged with what an earlier pass kept within FACT_DAYS (`fresh`: the oldest read_at that still counts; `stamp`: today).
    Invariants: families and counts of an earlier pass stay; this pass's count of a family replaces the older one; a family's `listed_families` mark goes with its count."""
    # Why (13 Nov 2026, sa; counts 13 Nov, bp): a pass reads a board with its own kinds' words, so its row is one search's view of the board. Germany's data pass
    # kept a general board (76 local jobs); two hours later the pass for photography, video and design read it again and the row lost data:
    # a data analyst's first search started on a design board instead. The kinds an earlier pass measured within FACT_DAYS stay on the row, and so
    # do their job counts (family_jobs): a family's newer count replaces its older one, the families this pass did not measure keep theirs; the `listed_families` mark (a count read from the board's own list) goes with its family's count.
    held = db.execute('SELECT families, family_jobs, listed_families FROM scout_board_facts WHERE host = ? AND country = ? AND read_at >= ?', (fact['host'], country, fresh)).fetchone()
    families = list(dict.fromkeys(fact['families'] + [family for family in (held[0].split(',') if held else []) if family]))
    rights = {**_counts(held[1] if held else None), **fact.get('family_jobs', {})}   # this pass's count of a family replaces the earlier one; the others stay
    # Why (13 Nov 2026, owner via sa): a count read from the board's own list is marked `listed`, so a searched count is ranked before it (jobadabra #4045); the mark goes with the
    # family's count: a family this pass measured takes this pass's mark, the others keep theirs.
    listed = sorted((set(listed_of(held[2] if held else None)) - set(fact.get('family_jobs', {}))) | set(fact.get('listed_families', ())))
    db.execute('INSERT OR REPLACE INTO scout_board_facts (host, country, url, families, local_jobs, read_at, browser, layout, family_jobs, listed_families, rule) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
               (fact['host'], country, fact['url'], ','.join(families), fact['local_jobs'], stamp, int(bool(fact.get('browser'))),
                json.dumps(fact['layout']) if fact.get('layout') else None, json.dumps(rights, sort_keys=True) if fact.get('family_jobs') is not None else held and held[1],
                json.dumps(listed) if listed else None, LISTED_RULE))   # the row's rule is that of its latest read; counts an earlier pass kept for other families stay as kept


def kinds_line(host, counted, families, unasked, by_family):
    """One log line per board that had local jobs to sort: how many jobs were asked and put in a family, the right jobs per family (the number board discovery is about), and, when
    the AI answered but put no job in any family, the first titles it was asked (public titles), so a board dropped for "no kinds of work" shows why.
    Why (13 Nov 2026, sa: "the run log must print right jobs per board and family"; Spain run 43502695338 dropped trabajos.com 40/40 local on an empty kinds answer and the log did not say what was asked)."""
    titles = list(dict.fromkeys(str(job.get('title') or '') for job in counted if job.get('title')))
    right = ', '.join(f'{family} {jobs}' for family, jobs in sorted((by_family or {}).items())) or 'none'
    line = f"Board kinds: {host}: {len(counted)} local jobs, {len(titles[:MAX_TITLES])} distinct titles asked, {sum((families and by_family or {}).values())} job(s) put in a family, {len(unasked)} title(s) unanswered; right jobs per family: {right}"
    if len(counted) > 1 and len(titles) == 1:
        line += f'; every job has the same title {titles[0][:60]!r}'   # Why (13 Nov 2026, sd): trabajos.com pages all carried one placeholder title, so the AI saw 1 title for 40 jobs
    if not families and not unasked and titles:
        line += '; asked, no family: ' + ' | '.join(repr(title[:60]) for title in titles[:5])
    return line
