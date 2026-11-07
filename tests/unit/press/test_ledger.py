"""The press's fix ledger, run (tests/unit/press/ledger.py): one test per past fix, named for it, running the tests that prove it.
A red here names the fix a change undid ("L17 · #3336 · …"), its owner's words and the proof that failed; read the fix's PR before changing anything.
The lock (ledger.lock.json) holds each fix's words and proofs' source: a fix added, changed or removed without the lock updated is red here, and a
changed or removed one needs the owner's words in the PR (tools/press-ledger-check.py)."""
import io
import json
import unittest

from tests.unit.press import ledger


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
