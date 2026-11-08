"""Every second and count of a Find jobs run, read from budget.json (one row: name, value, unit s|s/item|count|share, why, pr).
The stage files keep their names (time_budget.FLOOR, read_budget.READ_SECONDS, ...) as module attributes read from here, so a test that patches
one still does. A change of a row is a pipeline PR: it carries the yardstick's three numbers (plan 2026-11-07-the-press, Rules for every PR).
The app's own numbers (desktop/lib) stay in JavaScript, the packaged app runs them; their rows here are pinned equal by tests/unit/press/test_budget.py."""
import functools
import json
from pathlib import Path

TABLE = Path(__file__).with_name('budget.json')


@functools.lru_cache(maxsize=1)
def rows():
    """{name: row}, read once per process; a name written twice raises (review of ps 3/6)."""
    table = json.loads(TABLE.read_text(encoding='utf-8'))
    named = {row['name']: row for row in table}
    if len(named) != len(table):   # two PRs that each add or change a row, merged with both lines: the later row would win unseen
        seen = [row['name'] for row in table]
        raise ValueError(f'budget.json names a knob twice: {sorted({n for n in seen if seen.count(n) > 1})}')
    return named


def value(name):
    """One knob's value; a name the table lacks raises KeyError (a typo never falls back to a guess)."""
    return rows()[name]['value']


def group(prefix):
    """{key: value} of the rows named <prefix>.<key>, in the table's order (time_budget.SHARE, PACE, RESERVE)."""
    start = prefix + '.'
    return {name[len(start):]: row['value'] for name, row in rows().items() if name.startswith(start)}
