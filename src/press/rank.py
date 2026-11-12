"""The one place that decides what a Find jobs run reads, asks and scores first (plan 5/6 docs/superpowers/plans/2026-11-07-the-press.md; owner, 7 Nov 2026: "one agent fixes an
issue, then comes another agent and tries to improve the speed and moves that logic" · "we overwrite one another and we never get it right"; 8 Nov 2026: "Start 3/6 now").
Before this file, "X first" was decided in 11 places with their own sort keys (places-first alone was built in 7 places in 20 days). Now each key is a named weight below, and
three entry points sort with them: sources(feeds, *weights), titles(titles, *weights) and jobs(jobs, *weights). A call site names the weights it uses; it never sorts itself
(guard tests/guards/rules/test_press_one_ranker.py). A weight is a function item -> comparable, the smallest first; the entry points keep the order given between equals.
A PURE MOVE: every weight reproduces the key it replaced, named in its doc; making the orders agree (case E: first_jobs.pick vs employer_index.relevant) is a later, measured
behaviour PR, one weight at a time, an owner decision with the yardstick numbers. Where a job is (place_class: city, region, country only, remote naming the country) stays a
FILTER in its readers, never a weight: worldwide remote never counts, whatever the weights say. This file imports nothing of the pipeline (the facts a weight needs are passed in).
Tests: tests/unit/press/test_rank.py."""
import heapq


# --- the entry points ---------------------------------------------------------------------------------------------------------------------------------------------

def sources(feeds, *weights):
    """Employer feeds, boards or EURES areas in read order: sorted by the weights in turn, the order given kept between equals."""
    return _by(feeds, weights)


def titles(titles, *weights, reverse=False):
    """Job titles (or batches of them) in the order they are asked about: sorted by the weights in turn, the order given kept between equals."""
    return _by(titles, weights, reverse)


def jobs(jobs, *weights, reverse=False):
    """Jobs in the order they are enriched or scored: sorted by the weights in turn, the order given kept between equals (`reverse`: the weights' largest first, equals still in the order given)."""
    return _by(jobs, weights, reverse)


def _by(items, weights, reverse=False):
    return sorted(items, key=lambda item: tuple(weight(item) for weight in weights), reverse=reverse)


# --- the weights ------------------------------------------------------------------------------------------------------------------------------------------------

def in_your_places(is_mine):
    """0 for an item `is_mine(item)` says is in one of your places, else 1. Reproduces: time_budget.best_first's first key (Claude's place answer, else the best places' words),
    title_triage.decide's `title not in mine` (your places' titles before the others), feed_order._Nearness._key's first part (#2918, #3336, #3550, #3422), and
    feeds.triage_places's `not mentions(PLACE, location)` (the locations your place words name are placed first, 7 Oct 2026; with `-count` as the next key: the most closeness-weighted jobs)."""
    return lambda item: 0 if is_mine(item) else 1


def km_to_best_place(km):
    """The km from the item to the nearest of your best places: `km(item)`, inf when it is not placed (so an unplaced one sorts after the placed, as before). Reproduces:
    time_budget.best_first's second key (geo's stored answers, else Eurostat's point of a EURES area: near_best, #3670) and title_triage.decide's `nearness(title)` (#2918)."""
    return km


def seen_hiring_there(feed):
    """0 for a feed whose places name one of yours, 1 for a feed with no place information (kept, not dropped). Reproduces: employer_index.relevant's tail, `out + unplaced` (#3551, #2920)."""
    return 0 if feed.get('places') else 1


def fast_to_read(kinds):
    """0 for a feed whose ats is one of `kinds` (a JSON list in one request: first_jobs.FAST), else 1. Reproduces: first_jobs.pick's `fast + the others` (16 Oct 2026)."""
    return lambda source: 0 if source.get('ats', 'greenhouse') in kinds else 1


def left_last_time(left, key):
    """The place of the item in `left` ({key: n}, the sites the last timed read did not reach, in the order it left them). Reproduces: read_budget.left_first's `waited` sort (26 Oct 2026)."""
    return lambda item: left[key(item)]


def role_closeness(closeness):
    """Minus `closeness(job)`, so the job closest to your search (src/job_rank.py: your role words, level and skills) is first. Reproduces: time_budget.best_first's third key (18 Oct 2026)."""
    return lambda job: -closeness(job)


def yield_history(stat):
    """A proven source's key from the shared ranking: jobs per minute (none sorts last), then 70+ fits, then jobs per run, then its name. Reproduces: source_rank.ranked_sources's
    sort (18 Oct 2026). `stat` is its {per_min, fit70, per_run, source} row."""
    return (-(stat['per_min'] if stat['per_min'] is not None else -1), -stat['fit70'], -stat['per_run'], stat['source'])


def yield_place(place, key):
    """The place of the item in the shared ranking `place` ({(kind, source): n}), by `key(item)`. Reproduces: source_rank.order's `proven` sort (18 Oct 2026)."""
    return lambda item: place[key(item)]


def feed_quality(scored):
    """Minus the score of a (score, item) pair: the employer that worked best for people like you first. Reproduces: employer_index.for_you's sort (outcome totals of 3+ installs)."""
    return -scored[0]


def fresh(job):
    """The day the job was first seen; with jobs(..., reverse=True) the newest is first, so a capped run spends its budget on what the next digest shows. Reproduces: score.pending_jobs's
    and enrich.pending_jobs's `first_seen_at` sort (18 Oct 2026); a job with none sorts as the oldest (enrich used to raise on a missing day)."""
    return job.get('first_seen_at') or ''


def fit_before_neighbour(is_near):
    """0 for a job whose title is the person's own kind of work, 1 for a close neighbour of it (src/ai/title_triage.py near): a search's scores go to the fit ones first,
    since a neighbour is listed only once it is scored (owner, 12 Nov 2026: "Three answers, neighbours wait")."""
    return lambda job: 1 if is_near(job) else 0


def waiting_for_score(group):
    """The group of the job in `group` ({id(job): key}): a new job (0, 0), a changed one (1, 0), a Profile edit's best previous score first (2, -score). Reproduces: score.pending_jobs's
    last stable sort (3 Nov 2026, #3074, #3089)."""
    return lambda job: group[id(job)]


# --- keys of a title and of a batch of titles -----------------------------------------------------------------------------------------------------------------------

def title_nearness(jobs_of_title, in_my_place, near):
    """A title's key: the nearest of its jobs, (0 in one of your places else 1, km to the best place), (1, inf) for a title with no job. Reproduces: feed_order._Nearness._key (#3336)."""
    return min(((0 if in_my_place(job) else 1, near(job.get('location'))) for job in jobs_of_title), default=(1, float('inf')))


def batch_nearest(keys):
    """A batch's key: its nearest title's (`keys` is never empty). Reproduces: title_triage.decide's `min(map(nearness, batch))` (the key the queue is served by) and feed_order._Nearness.rank's `min(...)` (#3422)."""
    return min(keys)


def areas(codes):
    """EURES areas in the order asked: the regions in the person's place order (their `codes` longer than a country's), then each country, always last, each once. Reproduces:
    eures._areas's `dict.fromkeys(regions + countries)` (#3305: "nearest first")."""
    return list(dict.fromkeys([code for code in codes if len(code) > 2] + [code[:2] for code in codes]))


# --- the title queue and the AI slots: a heap served smallest first ------------------------------------------------------------------------------------------------

def waiting_entry(key, turn, seq, *rest):
    """A waiting batch: nearest key first (km_to_best_place), then its turn in its own reader's list (reader_turn: readers alternate, #3482), then arrival. Reproduces: title_queue's heap tuple."""
    return (key, turn, seq, *rest)


def slot_ticket(level, nearest, arrival):
    """A caller waiting for an AI slot: its level first (slots.FIRST before SCORE before NORMAL before LATER: a first run's local boards go first, 27 Oct 2026; a Kept job's score before the calls that bring more jobs, ts 10 Nov 2026), then the nearness of the batch it asks
    (#2918), then arrival. Reproduces: slots.Slots's ticket."""
    return (level, nearest, arrival)


def push(heap, entry):
    """Add a waiting entry to a heap served smallest first."""
    heapq.heappush(heap, entry)


def pop(heap):
    """Take the entry to serve next."""
    return heapq.heappop(heap)


def reorder(heap, entries=None):
    """Put `entries` (default: the heap's own, after a key changed) in heap order, in place."""
    if entries is not None:
        heap[:] = entries
    heapq.heapify(heap)
