"""Every test starts with no store chosen, and a test that leaves one chosen fails by name.

open_stores() reads JOBADABRA_STORE (and the sqlite folder JOBADABRA_DATA_DIR) from os.environ, so a value from the shell,
a developer's .env or an earlier test silently turned open_stores(tracker=fake) into sqlite/memory instead of Notion (9 Oct
2026, three times in one session). Rather than each test guarding itself, every test folder's __init__.py imports this module
(after tests/suite_ids.py) and it wraps TestCase.run for the whole suite: before each test the variables are removed, after
it a test that set them without restoring (a bare os.environ[...] =, a patcher started without addCleanup(stop)) fails and
the value is removed, so the next test is never steered by it. Set them inside a test with mock.patch.dict, as usual.

The Notion connection (NOTION_TOKEN, the NOTION_*_DB ids, the NOTION_*_PAGE* ids) is the same kind of steering, but the suite sets
fake ids on purpose (tests/suite_ids.py). So for those, every test ends with them
exactly as it found them: one it set, changed or removed is restored, and the test fails by name.
Its own tests: tests/guards/data/test_store_env.py."""
import os
import re
import sys
import unittest

STEERING = ('JOBADABRA_STORE', 'JOBADABRA_DATA_DIR')
NOTION = re.compile(r'^NOTION_(TOKEN|\w+_DB|\w*PAGE\w*)$')
_run = unittest.TestCase.run


def _clear():
    return {name: os.environ.pop(name) for name in STEERING if name in os.environ}


def _notion():
    return {name: value for name, value in os.environ.items() if NOTION.match(name)}


def _restore(before):
    for name in set(_notion()) - set(before):
        del os.environ[name]
    os.environ.update(before)


def _fail(self, result, message):
    try:
        raise AssertionError(f'{self.id()} {message}: set it with mock.patch.dict (or addCleanup(patcher.stop)) so the next test '
                             'does not open that store')
    except AssertionError:
        result.addFailure(self, sys.exc_info())


def run_without_a_chosen_store(self, result=None):
    _clear()
    before = _notion()
    outcome = _run(self, result)
    left, after = _clear(), _notion()
    if after != before:
        _restore(before)
    if result is not None:
        if left:
            _fail(self, result, f'left {left} in os.environ')
        if after != before:
            changed = {name: (before.get(name), after.get(name)) for name in set(before) | set(after) if before.get(name) != after.get(name)}
            _fail(self, result, f'changed the Notion connection in os.environ (before, after): {changed}')
    return outcome


run_without_a_chosen_store.guard = True
unittest.TestCase.run = run_without_a_chosen_store
_clear()
