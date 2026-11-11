"""The mark of a proof that is red today for one stated cause, until the PR that fixes it (lanes 1/5, #3740 and #3754).
Why (lanes 1/5, Gitar on #3780, 11 Nov 2026): unittest.expectedFailure accepts any exception (a typo, a renamed seam, a missing function), so a proof
marked with it could be "red" for a reason nobody named. This mark accepts only an AssertionError whose message holds the stated cause: that one is
reported as skipped with the fix named; any other failure or error is red as usual; a pass is red too, so the fixing PR must remove the mark."""
import functools
import unittest


def red_until(fix, cause):
    """Mark a test that fails today with `cause` (text its AssertionError holds) until `fix` (the PR that makes it pass and removes this mark)."""
    def mark(test):
        @functools.wraps(test)
        def run(self, *args, **kwargs):
            try:
                test(self, *args, **kwargs)
            except AssertionError as error:
                if cause not in str(error):
                    raise
                raise unittest.SkipTest(f'red until {fix}, as stated: {cause}') from error
            self.fail(f'passes now: {fix} removes its red_until mark')
        return run
    return mark
