"""Python checks that a rule holds across the repo, by what they protect (TESTS.md)."""
# Why (3 Nov 2026, test folders 2/3): the suite's setup loads before any test of this folder, whatever runs it
# (unittest discover, tools/py-shards.py, one module alone): the fake Notion IDs, then the store-env guard.
import sys
from pathlib import Path

if str(Path(__file__).resolve().parents[1]) not in sys.path:   # run as tests.<kind>.… from the root without PYTHONPATH=tests (tools/pre-push-check.sh)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import suite_ids  # noqa: E402,F401
import suite_store_guard  # noqa: E402,F401
