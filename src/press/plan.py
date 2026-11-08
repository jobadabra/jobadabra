"""The Find jobs planner, log-only (plan P2; owner, 8 Nov 2026: "All the steps till the end goal all always planned. Even if you stop me at step 3, I know that there are steps 4-10" · "based on the fastest pathway to get those 'as many jobs as possible'").
Design: ONE owner of the step order. At each press start the planner reads what every step left (resume.load_left, counts) and how fast every step found the RIGHT local jobs
(step_yield rows of the last RUNS runs) and says the whole plan: the steps with work left, the fastest first (expected new fit 70+ local jobs per second), the steps never measured after them in
the engine's order, the steps with nothing left as done. A step with nothing left drops out; a step that never said what it left stays in (stale is not empty). The plan is saved whole in
press_plan.json and said in one line. It does NOT reorder the engine yet (owner, 8 Nov 2026: "Log first, reorder later (Recommended)"): `applied` is False; the reordering is a later PR, measured on the
recordings PR against main. rank.py keeps the order INSIDE a step (employers, titles, jobs); this file owns the order OF the steps, and nothing else decides it.
The rates here are a measurement of real runs (replay fidelity landed, #3622), not a proof of speed. Counts only, nothing about the person.
Only a timed run saves (as resume.py). Tests: tests/unit/press/test_plan.py."""
import json
import sys
from datetime import datetime, timedelta, timezone

from .. import paths
from . import resume, step_yield

FILE = 'press_plan.json'
RUNS = 5   # Why (P2, 8 Nov 2026): the rate of a step is its last 5 runs' fit 70+ local jobs over their seconds; one run is noise, older runs are another search
ENGINE_ORDER = tuple(resume.STEPS.values())   # time_budget.STAGES, the engine's order today (pinned by test_resume)
LABEL = {step: label for label, step in resume.STEPS.items()}   # said as the time-up lines say them ('free job APIs'), not as the ids
MAX_AGE_DAYS = 3   # Why (P3, 8 Nov 2026, asked via AskUserQuestion): an old plan is not shown on a run's card
SHOWN = 2   # steps the card's line names: the next one and the one after
SAID = 4   # steps named in the log line; the rest are counted


def rates(db):
    """{step: right local jobs per second over the last RUNS runs} for each step with timed runs; a step never timed has no entry."""
    jobs, seconds = {}, {}
    for row in step_yield.history(db, RUNS):
        if row['seconds']:
            jobs[row['step']] = jobs.get(row['step'], 0) + row['local_fit70']
            seconds[row['step']] = seconds.get(row['step'], 0) + row['seconds']
    return {step: jobs[step] / seconds[step] for step in seconds}


def plan(left, rate):
    """{'order': [...], 'done': [...]} from `left` (resume.load_left()) and `rate` (rates()): each item {step, left (None: never said), saved_at, per_min (None: never measured)}.
    Order: measured steps, the fastest first, then the unmeasured in the engine's order; the engine's order breaks every tie. A step that left 0 is done."""
    items = [{'step': step, 'left': left.get(step, {}).get('left'), 'saved_at': left.get(step, {}).get('saved_at'),
              'per_min': round(rate[step] * 60, 1) if step in rate else None} for step in ENGINE_ORDER]
    done = [item for item in items if item['left'] == 0]
    order = [item for item in items if item['left'] != 0]
    order.sort(key=lambda item: (item['per_min'] is None, -(item['per_min'] or 0)))   # Why (P2): the step order's only sort; sort is stable, so ties keep the engine's order
    return {'order': order, 'done': done}


def line(made, head='Plan'):
    """'Plan (logged, not applied yet): 1 employer sites 3.2 fit 70+/min, 561 left · 2 free job APIs 1.1/min · +9 more · done: scoring'."""
    said = []
    for number, item in enumerate(made['order'][:SAID], 1):
        rate = f" {item['per_min']:g} fit {step_yield.FIT}+/min" if item['per_min'] is not None else ' not measured'
        said.append(f"{number} {LABEL[item['step']]}{rate}" + (f", {item['left']} left" if item['left'] else ''))
    if len(made['order']) > SAID:
        said.append(f"+{len(made['order']) - SAID} more")
    if made['done']:
        said.append('done: ' + ', '.join(LABEL[item['step']] for item in made['done']))
    return f'{head} (logged, not applied yet): ' + ' · '.join(said)


def load():
    """The last saved plan, or None when there is no file or it is not a plan."""
    try:
        data = json.loads((paths.DATA / FILE).read_text())
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) and isinstance(data.get('order'), list) else None


def _write(data):
    """Whole or not at all, through the one atomic writer (Gitar, #3621: paths.write_whole fsyncs, keeps the file this user's only, and its temp file is left out of an export)."""
    paths.DATA.mkdir(parents=True, exist_ok=True)
    paths.write_whole(paths.DATA / FILE, json.dumps(data, indent=1) + '\n')


def run(db, now=None, head='Plan'):
    """Plan this press (head 'Plan'), or what comes after it ('Next plan', at a run's end): read, save whole, say one line; returns the plan. Never reorders the engine; a failed save is said on stderr and ignored."""
    made = plan(resume.load_left(), rates(db)) | {'planned_at': (now or datetime.now(timezone.utc)).isoformat(timespec='seconds'), 'applied': False}
    try:
        if resume._timed():   # Why (P2, as resume.save): only a timed run writes; a CLI run or a test without a budget leaves the data folder alone
            _write(made)
    except OSError as error:
        print(f'Warning: the Find jobs plan could not be saved ({type(error).__name__})', file=sys.stderr, flush=True)
    print(line(made, head), flush=True)
    return made


def next_steps(now=None):
    """What a finished run's card says comes next (plan P3; owner, 8 Nov 2026, asked via AskUserQuestion: "Yes, as drawn": "Next: employer sites (561 left to read), then job boards"):
    {'steps': [{'step', 'left'}, ...], 'planned_at'} for the first SHOWN steps of the saved plan, `left` None when it is 0 or never said; None when there is no plan, it has no step
    with work left, or it is older than MAX_AGE_DAYS."""
    made = load()
    if not made or not made['order']:
        return None
    try:
        at = datetime.fromisoformat(made['planned_at'])
    except (KeyError, TypeError, ValueError):
        return None
    if at.tzinfo is None or (now or datetime.now(timezone.utc)) - at > timedelta(days=MAX_AGE_DAYS):
        return None
    items = [item for item in made['order'] if isinstance(item, dict) and item.get('step') in ENGINE_ORDER]
    if not made.get('applied'):   # Why (P3, 8 Nov 2026, gi): the engine never reads the plan (applied is False) and its next run starts in its own order, so a card naming the plan's pick would say what the run will not do
        items.sort(key=lambda item: ENGINE_ORDER.index(item['step']))
    steps = [{'step': item['step'], 'left': item['left'] if type(item.get('left')) is int and item['left'] > 0 else None} for item in items][:SHOWN]
    return {'steps': steps, 'planned_at': made['planned_at']} if steps else None
