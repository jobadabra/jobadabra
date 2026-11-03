"""Contract tests for bugs the Finder missed and only had an idea for (the Notion Bug Tracker's "e2e test idea", 5 Oct 2026): each one fails on the old code.

  - Scout: registering a Haufe Umantis feed would crash because the type had no board link: every fetcher type has one.
  - (Retired 2 Nov 2026: the beta-approval label-sync permission contract; no release script writes issues since the pinned Release channels issue went.)
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from src import scout  # noqa: E402
from src.sources import ats  # noqa: E402


class ScoutBoardTests(unittest.TestCase):
    def test_every_fetcher_type_has_a_board_link(self):
        for system in ats.FETCHERS:
            try:
                scout.board_url(system, 'tenant.wd3.site')
            except KeyError:
                self.fail(f'scout.board_url has no entry for the {system!r} fetcher: registering one would crash the scout')
            except Exception:  # noqa: BLE001  a slug this test cannot decode (careers) is not a missing entry
                pass


if __name__ == '__main__':
    unittest.main()
