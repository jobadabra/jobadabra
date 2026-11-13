"""The press's fix ledger, run (tests/unit/press/ledger.py): one test per past fix, named for it, running the tests that prove it.
A red here names the fix a change undid ("L17 · #3336 · …"), its owner's words and the proof that failed; read the fix's PR before changing anything.
The lock (ledger.lock.json) holds each fix's words and proofs' source: a fix added, changed or removed without the lock updated is red here, and a
changed or removed one needs the owner's words in the PR (tools/press-ledger-check.py)."""
import io
import json
import unittest

from tests.unit.press import ledger
# Every proof's module, imported here so the PR test picker (tools/affected-tests.py) sees what the ledger reaches: a change to any file a proof reaches runs it.
from tests.unit.ai import (test_boards_asked_together, test_decide_gate, test_daily_search_beside, test_daily_search_phases, test_first_press_boards_early, test_score_floor,  # noqa: F401
                           test_search_budget, test_step_pace_failures, test_title_one_pass, test_title_queue, test_title_triage_local,
                           test_titles_with_places)
from tests.unit.engine import test_score_first_from_start, test_scout_carry  # noqa: F401
from tests.unit.press import test_home_region_first, test_ledger_scenarios, test_one_scorer, test_resume, test_resume_run  # noqa: F401
from tests.unit.stores import test_store_beside  # noqa: F401
from tests.unit.sources import (test_aggregators, test_api_lane, test_boards_beside, test_boards_early, test_boards_first, test_eures, test_eures_place_fragments, test_eures_titles_in_time,  # noqa: F401
                                test_board_lane_clock, test_first_jobs, test_first_jobs_hub, test_first_jobs_slow_boards, test_first_press_order, test_index_place_rank,
                                test_job_rank, test_read_budget, test_read_cut, test_three_minutes, test_titles_ai_first, test_unread_systems, test_waiting_jobs)


def _run(proof):
    """Run one proof -> '' when it passed, else its failure's last lines."""
    resolved = ledger.resolve(proof)
    if resolved is None:   # a node test: the desktop suite runs it; here its text must still be there (ledger.source raises when it is gone)
        ledger.source(proof)
        return ''
    cls, name = resolved
    out = io.StringIO()
    result = unittest.TextTestRunner(stream=out, verbosity=0).run(unittest.TestSuite([cls(name)]))
    if result.wasSuccessful():
        return ''
    trace = (result.failures + result.errors)[0][1].strip().splitlines()
    return '\n    '.join(trace[-6:])


def _fix_test(fix):
    def test(self):
        broken = [(proof, why) for proof in fix.proofs for why in [_run(proof)] if why]
        if broken:
            said = f' Owner: "{fix.owner}".' if fix.owner else ''
            self.fail(f'{fix.id} · {fix.since} · {fix.gets} — undone by this change?{said}\n' +
                      '\n'.join(f'  {proof}\n    {why}' for proof, why in broken) +
                      '\n  Read that fix\'s PR first. Changing what it promises needs the owner\'s yes (tests/unit/press/ledger.py).')
    test.__doc__ = f'{fix.id} · {fix.since}: {fix.gets}'
    return test


class FixLedger(unittest.TestCase):
    """One test per fix: test_L01 … (added below from ledger.FIXES)."""


for _fix in ledger.FIXES:
    setattr(FixLedger, f'test_{_fix.id}', _fix_test(_fix))


class LedgerKept(unittest.TestCase):
    def test_ids_are_unique_and_in_order(self):
        ids = [fix.id for fix in ledger.FIXES]
        self.assertEqual(ids, sorted(set(ids)), 'each fix has its own L<nn>, in order, never reused')

    def test_every_fix_has_a_proof_and_says_what_the_person_gets(self):
        for fix in ledger.FIXES:
            self.assertTrue(fix.proofs and fix.gets and fix.since, fix.id)

    def test_every_proof_module_is_imported_here_so_a_pr_reaching_it_runs_the_ledger(self):
        imported = {value.__name__ for value in globals().values() if isinstance(value, type(unittest))}
        wanted = {proof.split('::')[0][:-3].replace('/', '.') for fix in ledger.FIXES for proof in fix.proofs if not proof.startswith('desktop/')}
        self.assertEqual(sorted(wanted - imported), [], 'import these proof modules at the top of this file (tools/affected-tests.py follows imports)')

    def test_the_lock_matches_the_ledger(self):
        kept = json.loads(ledger.LOCK.read_text())
        now = ledger.lock()
        removed = sorted(set(kept) - set(now))
        changed = sorted(i for i in set(kept) & set(now) if kept[i]['hash'] != now[i]['hash'])
        added = sorted(set(now) - set(kept))
        self.assertFalse(removed or changed or added,
                         f'the ledger and its lock differ: removed {removed}, changed {changed}, added {added}. A new fix: run '
                         '`python3 -m tests.unit.press.ledger --write-lock`. A changed or removed one also needs the owner\'s yes in the PR: '
                         '`Ledger-change: L<nn> "<owner\'s words>"` (tools/press-ledger-check.py).')


if __name__ == '__main__':
    unittest.main()
