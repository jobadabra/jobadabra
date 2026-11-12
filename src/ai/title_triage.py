"""Which job titles could fit this search (owner, 7 Oct 2026: "Only the location should be strict"): the title gate in front of the AI fit
score was the search's exact role words, so "Client Advisor" at Vacheron Constantin in Geneva and Fnac's "Collaborateur Magasin" were never
scored. Now a title in the user's places that the words miss is shown to Haiku with the search (role words, words ruled out); it answers which
could fit, and each decision is kept per search (data/title_triage.json), so a title is asked about once. The fit score then grades them.

What Haiku sees: job titles and the search's own words, nothing else (no CV, no profile, no employer). Off without AI, or with
JOBADABRA_DISABLE=title_triage: the exact role words only, as before.
"""
import hashlib
import json
import threading

from ..paths import DATA
from ..press import budget as press_budget, resume
from .models import SMALL_MODEL
from .providers.contract import AiError
from . import batch_scope, providers, slots, title_queue
from ..press import rank

MODEL = SMALL_MODEL
BATCH = press_budget.value('title_triage.BATCH')   # ~30 s a batch through Claude Code (100 took ~2 min): a 3-minute search can stop between them
# Why (gp + sa, 12 Nov 2026): a step that thinks before it answers pays that once a call; 60 titles sort 7.0 a second against 4.2, the same right titles kept (budget.json's row).
BATCH_THINKING = press_budget.value('title_triage.BATCH_THINKING')
MAX_NEW = press_budget.value('title_triage.MAX_NEW')       # titles asked about in one run at most, of each kind: your own places' titles and the others (a first run on a big list is spread over the next ones)
STORE = DATA / 'title_triage.json'
LOCK = threading.Lock()
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['fit'],
          'properties': {'fit': {'type': 'array', 'items': {'type': 'integer'}, 'description': 'The numbers of the titles that could fit'}}}
# Why (#3793, 11 Nov 2026; night 42927975750): a carpenter got "Open sollicitatie / Unsolicited application" and a software engineer two pre-sales "Solutions Engineer"
# jobs; examples, not a word list, inside the owner's 7 Oct 2026 "Only the location should be strict" (a bare "Technicien" stays "when unsure, include it").
SYSTEM = """You sort job titles for one job seeker. You get their search (the role words they wrote, and words that rule a title out) and a \
numbered list of job titles, in any language. Answer with the numbers of the titles that could be the kind of job they look for: the same \
work under another name or in another language counts ("Client Advisor" or "Collaborateur Magasin" for a shop seller; "Content Creator - \
Photo" for a photographer), and so does a close neighbour of their work at a similar level. Leave out other kinds of work (software, \
finance, marketing management, legal…), and titles of the work their ruled-out words name (the same word in another sense is no reason). \
Leave out a posting that is no job of its own (an open or unsolicited application: "Open sollicitatie", "Candidature spontanée", \
"Initiativbewerbung"), and selling or demonstrating a product to customers ("Solutions Engineer", "Sales Engineer", pre-sales) for \
someone whose work is building it. \
A level, when given, is the seniority they want: leave out a title plainly far from it (an internship for a lead); a rank that only sounds like \
a level ("Senior First Officer" is a pilot rank) is judged by its work. A title with their role word can still be another job ("Pilote / Product \
Owner" is no pilot). When unsure, include it: a later step scores each job."""

PROMPT = hashlib.sha1(SYSTEM.encode()).hexdigest()   # the SYSTEM a search's kept answers were sorted under (_current)
STAMP = '#PROMPT'   # its key inside a search's entry: a kept title is lower-cased (_norm), so never this

# Why (27 Oct 2026, owner "Ask again before closing"; quality run 40508145728): Free AI said no to 'Staff Platform Engineer, Kubernetes' and 'Cloud Infrastructure
# Engineer' for an SRE/platform search after both were scored and listed; the sort's no closed them before their facts were read. A no on a title that holds
# one of the search's own role words is asked once more, alone; the job leaves only when both say no.
RECHECK_SYSTEM = """You check job titles that a first sort rejected for one job seeker. You get their search (the role words they wrote, and words \
that rule a title out) and a numbered list of job titles; each holds one of their role words. Answer with the numbers of the titles that are \
the kind of work they look for, or a close neighbour of it at a similar level. Leave out a title where the role word names another job \
("Pilote / Product Owner" is no pilot, "Infrastructure Tax Lead" is no infrastructure engineer). When unsure, include it: a later step scores each job."""


def _key(search):
    words = {'roles': sorted(str(w) for w in search.get('role_keywords') or []), 'out': sorted(str(w) for w in search.get('title_exclude_keywords') or [])}
    return hashlib.sha1(json.dumps(words, ensure_ascii=False).encode()).hexdigest()[:12]


def _norm(title):
    return ' '.join(str(title or '').lower().split())[:160]


def _load():
    try:
        return json.loads(STORE.read_text())
    except (OSError, ValueError):
        return {}


batch_scope.watch('titles_store', _load)


def known(search):
    """{title: True/False} decided for this search so far (for readers side by side: as it was when they began, src/ai/batch_scope.py)."""
    return _current(batch_scope.view('titles_store', _load).get(_key(search)))


def _current(entry):
    """A search's kept answers that still hold under this SYSTEM: all of them when its stamp is this PROMPT, else only its no's (the yes's are asked again).
    Why (Gitar on #3803, 11 Nov 2026): answers are kept per search, not per prompt, so a title an install sorted yes under the old SYSTEM stayed listed and the new
    leave-out examples reached only titles never seen. That change only adds leave-out cases, so a kept no stays a no; a SYSTEM change that lets more titles in must drop the no's here too."""
    entry = entry or {}
    fresh = entry.get(STAMP) == PROMPT
    return {title: fits for title, fits in entry.items() if title != STAMP and (fresh or fits is False)}


def _stamped(entry, decided):
    """The entry kept for a search after a sort: what still holds (_current), this run's answers, and this SYSTEM's stamp."""
    return {**_current(entry), **decided, STAMP: PROMPT}


def _may_start(batch, mine, forced):
    """A batch of titles starts unless the titles' clock is up (over); the exception is a batch holding titles of the user's own places (`mine`), the floor of time_budget.local_titles:
    asked past the clock while scoring keeps its time, whatever else rides in the same call (one call is made anyway). Why (#2920, 7 Nov 2026): one pass for all titles, so a call mixes the two."""
    from .. import time_budget as budget
    here = sum(1 for title in batch if title in mine)
    return not budget.over('titles', key=batch[0]) or bool(here and (forced and budget.title_room() or budget.local_titles(here) >= here))


def batch_size(client):
    """Titles in one call: BATCH_THINKING when the client's step thinks before it answers (the provider says so), else BATCH. A client without the question (a test's fake) asks BATCH."""
    thinks = getattr(client, 'thinks_first', None)
    return BATCH_THINKING if callable(thinks) and thinks() is True else BATCH


def _second_look(client, ask, decided, search, words, mine=frozenset(), forced=0, size=BATCH):
    """The titles this call rejected that hold one of the search's role words are asked once more, alone (RECHECK_SYSTEM); a yes keeps the job.
    When that call fails or the clock is up they are dropped from `decided`: unknown, asked again next refresh, never a guessed no."""
    from . import cost, engine
    from .. import time_budget as budget
    from ..paths import keyword_regex
    roles = keyword_regex(search.get('role_keywords'))
    doubted = [title for title in ask if decided.get(title) is False and roles.search(title)]
    for start in range(0, len(doubted), size):
        batch = doubted[start:start + size]
        try:
            if not _may_start(batch, mine, forced):   # as the sort's own exemption
                raise TimeoutError('the refresh\'s time is up')
            listed = '\n'.join(f'{n}. {title}' for n, title in enumerate(batch, 1))
            response = client.messages.create(model=MODEL, max_tokens=1500, system=[{'type': 'text', 'text': RECHECK_SYSTEM}],
                                              messages=[{'role': 'user', 'content': f'The search (JSON): {json.dumps(words, ensure_ascii=False)}\nThe titles:\n{listed}'}],
                                              output_config=engine.structured(SCHEMA, MODEL, 'low'))
            cost.side(MODEL, response.usage)
            fit = {int(n) for n in json.loads(next(b.text for b in response.content if b.type == 'text')).get('fit') or [] if str(n).isdigit()}
        except Exception as error:  # noqa: BLE001 — any failure of the extra look leaves its titles unknown for the next refresh
            print(f'Titles: second look at {len(batch)} title(s) not done ({type(error).__name__}); they stay unjudged until the next refresh', flush=True)
            for title in batch:
                decided.pop(title, None)
            continue
        for n, title in enumerate(batch, 1):
            decided[title] = n in fit


def _workers(budget):
    """Title calls at once: every slot of the engine in use, or half of them (at least 1) while a scorer runs beside the search on an engine whose calls share
    one slot queue (Claude Code 4 -> 2, Codex 2 -> 1); an API engine (your key, Free AI) has no shared slots to leave free, so the titles keep all their threads."""
    from . import engine
    n = max(1, engine.at_once())
    return max(1, n // 2) if engine.queued() and budget.scored_beside() else n


def decide(titles, search, client=None, local=False, nearness=None, land=None):
    """Ask about the titles not decided yet for this search, keep the answers; returns {title: fits} for all known. At most MAX_NEW of your places' titles and MAX_NEW others.
    local: True (all of `titles` are of jobs in the user's own places) or the titles that are: asked first in the same call, and the search's first few of them are sorted whatever the clock says (src/time_budget.py).
    nearness: title -> a comparable key, the nearest smallest (src/sources/feeds.py): the batches are cut from the nearest titles first and src/ai/title_queue.py asks
    them nearest first across every reader. land(fit titles, batch): called in this thread as each batch lands (a job can reach scoring after one batch)."""
    resume.ran('title sorting')   # this process ran the step: its end-of-run count may say 0 (src/press/resume.py)
    from . import engine
    from .. import time_budget as budget
    key, decided = _key(search), dict(known(search))
    mine = {_norm(t) for t in (titles if local is True else local or ())}
    ask = list(dict.fromkeys(t for t in (_norm(t) for t in titles) if t and t not in decided))
    ask = [t for t in ask if t in mine][:MAX_NEW] + [t for t in ask if t not in mine][:MAX_NEW]   # as the two passes did: each kind capped at MAX_NEW (Gitar on #3550: all-local input stops at MAX_NEW)
    # The rounds of calls that end by the titles' stop (src/time_budget.py); the rest is asked next time. 18 Oct 2026, persona runs: paced per title (0.5 s at least), a refresh
    # planned "28 of 600 titles" for its 3 minutes, sorted them in one 7 s call and left 572 waiting. 7 Nov 2026 (#2920): one pass for all, a round that fits starts.
    if not ask:
        return decided
    client = client or engine.client(action='title_triage')
    size = batch_size(client)
    taken = budget.in_calls('title_rounds', len(ask), size, engine.at_once(), noun='title(s)', stop='titles')
    nearest_mine = sum(1 for t in ask if t in mine)
    forced = budget.local_titles(nearest_mine - taken) if taken < nearest_mine else 0   # past the clock: the titles of your own places only
    if nearness:
        ask = rank.titles(ask, rank.in_your_places(lambda title: title in mine), rank.km_to_best_place(nearness))   # stable: your places first, then the nearest; the caller's order within the same nearness
    ask = ask[:taken + forced]
    if not ask:
        return decided
    from ..notion.search_settings import terms
    from .. import levels   # the level is said as a level: its skip words (src/levels.py) are the no-AI floor, never words the AI must obey
    skips, level = set(terms(levels.title_skips(search.get('level')))), levels.level_of(search.get('level'))
    words = {'role_words': terms(search.get('role_keywords'))[:20], 'words_ruled_out': [w for w in terms(search.get('title_exclude_keywords')) if w not in skips][:20],
             **({'level': level} if level else {})}
    from . import cost
    from ..progress import Ticker
    batches = [ask[start:start + size] for start in range(0, len(ask), size)]
    nearest = [(rank.batch_nearest(map(nearness, batch)) if nearness else (1, 0.0), batch) for batch in batches]
    # Said before the first answer, then after each batch with the time left (owner, 7 Oct 2026: 6 batches ran ~2 min each with only
    # "Still running · no new output" on screen). Batches run side by side; Claude Code still takes engine.at_once() at a time.
    print(f'Titles: asking {providers.who()} about {len(ask)} job title(s) in your places, in {len(batches)} batch(es) of up to {size}', flush=True)
    ticker, lock, sorted_ = Ticker('Sorting job titles with AI', len(ask), every=0), threading.Lock(), [0]

    spent = [0.0]   # seconds the AI took, summed over the asks (not the queue's waiting, nor the scoring the hub does meanwhile: #2918 review)
    late = [0]   # titles of batches not started: the search's time was up (src/time_budget.py); the next search asks about them

    def one(batch):
        """Asked in a queue worker (src/ai/title_queue.py) -> the numbers of the titles that fit, or None when the search's time is up for this batch."""
        if not _may_start(batch, mine, forced):
            with lock:
                late[0] += len(batch)
            return None
        listed = '\n'.join(f'{n}. {title}' for n, title in enumerate(batch, 1))
        asked_at = budget.now()
        try:
            response = client.messages.create(model=MODEL, max_tokens=1500, system=[{'type': 'text', 'text': SYSTEM}],
                                              messages=[{'role': 'user', 'content': f'The search (JSON): {json.dumps(words, ensure_ascii=False)}\nThe titles:\n{listed}'}],
                                              output_config=engine.structured(SCHEMA, MODEL, 'low'))
        except AiError:
            # Why (sa, 11 Nov 2026, local p10 search): a batch that got no AI slot before the search's time was up (cli_base refuses it) failed the whole
            # sort: the answers of the 12 batches that had landed were not kept and 417 titles read "not sorted". Past the time it is a late batch, as _may_start's.
            if not budget.ended():
                raise
            with lock:
                late[0] += len(batch)
            return None
        cost.side(MODEL, response.usage)
        with lock:
            spent[0] += budget.now() - asked_at
        return {int(n) for n in json.loads(next(b.text for b in response.content if b.type == 'text')).get('fit') or [] if str(n).isdigit()}

    def landed(batch, fit):
        if fit is None:
            return
        for n, title in enumerate(batch, 1):
            decided[title] = n in fit
        sorted_[0] += len(batch)
        ticker.tick(sorted_[0])
        if land:
            land({title for n, title in enumerate(batch, 1) if n in fit}, batch)
    # Why half the AI slots while a scorer runs beside the search (sa, 11 Nov 2026, three local p10 searches): a title call takes the next free slot (slots.TITLES), so with as many title workers as slots
    # the scores got none: 1,056 titles asked and 13 jobs scored instead of 32. Behind the scores instead, a batch waited 42-56 s and ~750 titles were never asked.
    # Half the slots are the titles', at once; the other half stay with the scores and the board reads (_workers: of the engine in use, and only where slots are shared).
    title_queue.serve(nearest, one, landed, _workers(budget), rank=getattr(nearness, 'rank', lambda batch: rank.batch_nearest(map(nearness, batch))) if nearness else None)
    budget.record('title_rounds', spent[0] / max(1, engine.at_once()), -(-sorted_[0] // (size * max(1, engine.at_once()))))
    with slots.priority(slots.TITLES):   # the second look is title work too: no reader's level (src/ai/title_queue.py)
        _second_look(client, ask, decided, search, words, mine, forced, size)
    with LOCK:
        data = _load()
        data[key] = _stamped(data.get(key), decided)
        for old in list(data)[:-3]:   # the last few searches only
            data.pop(old)
        STORE.parent.mkdir(parents=True, exist_ok=True)
        STORE.write_text(json.dumps(data, ensure_ascii=False))
    if batch_scope.active():   # this reader's own answers, for its next call
        view = batch_scope.view('titles_store', _load)
        view[key] = _stamped(view.get(key), decided)
    asked = [t for t in ask if t in decided]
    if late[0]:
        print(budget.left_line('titles', late[0], 'title(s)'), flush=True)
    print(f'Titles: {providers.who()} sorted {len(asked)} new title(s) in your places; {sum(1 for t in asked if decided[t])} could fit your search')
    return decided
