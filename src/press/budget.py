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
    """{name: row}, read once per process."""
    return {row['name']: row for row in json.loads(TABLE.read_text(encoding='utf-8'))}


def value(name):
    """One knob's value; a name the table lacks raises KeyError (a typo never falls back to a guess)."""
    return rows()[name]['value']


def group(prefix):
    """{key: value} of the rows named <prefix>.<key>, in the table's order (time_budget.SHARE, PACE, RESERVE)."""
    start = prefix + '.'
    return {name[len(start):]: row['value'] for name, row in rows().items() if name.startswith(start)}
