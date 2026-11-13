"""Guard: release — tools/gh_retry.py gives GitHub's own 500/502/503/504 one more try and nothing else, so an outage never decides a release check or the PR e2e start, and a real refusal still does.
Why (13 Nov 2026, #4008): "steps this PR reaches" went red on `HTTP 500: Failed to run workflow dispatch` with no step run; the same code passed later. Before: 502/503/504 only."""
import importlib.util
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('gh_retry', Path(__file__).resolve().parents[3] / 'tools' / 'gh_retry.py')
gh_retry = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gh_retry)

DISPATCH_500 = 'could not create workflow dispatch event: HTTP 500: Failed to run workflow dispatch'


def done(code, err='', out=''):
    return subprocess.CompletedProcess(['gh'], code, stdout=out, stderr=err)


class GhRetry(unittest.TestCase):
    def run_with(self, *answers):
        with patch.object(gh_retry.subprocess, 'run', side_effect=list(answers)) as fake, patch.object(gh_retry.time, 'sleep') as nap:
            result = gh_retry.run(['workflow', 'run', 'e2e.yml'])
        return result, fake.call_count, nap.call_count

    def test_a_dispatch_500_then_success_is_green_after_one_retry(self):
        result, calls, naps = self.run_with(done(1, DISPATCH_500), done(0, out='ok'))
        self.assertEqual((result.returncode, result.stdout, calls, naps), (0, 'ok', 2, 1))

    def test_every_gateway_status_gets_one_retry(self):
        for said in ('non-200 OK status code: 504 Gateway Timeout', 'HTTP 503: Service Unavailable', 'HTTP 502: Bad Gateway'):
            with self.subTest(said=said):
                result, calls, _ = self.run_with(done(1, said), done(0))
                self.assertEqual((result.returncode, calls), (0, 2))

    def test_a_second_500_stays_red_after_exactly_one_retry(self):
        result, calls, _ = self.run_with(done(1, DISPATCH_500), done(1, DISPATCH_500))
        self.assertEqual((result.returncode, calls), (1, 2))
        self.assertIn('HTTP 500', result.stderr)

    def test_refusals_and_other_errors_are_never_retried(self):
        for said in ('HTTP 401: Bad credentials', 'HTTP 403: Resource not accessible', 'HTTP 429: rate limit', 'HTTP 422: Unexpected inputs provided: ["pr_steps"]', 'HTTP 5000: made up', 'HTTP 501: Not Implemented'):
            with self.subTest(said=said):
                result, calls, naps = self.run_with(done(1, said))
                self.assertEqual((result.returncode, calls, naps), (1, 1, 0))


if __name__ == '__main__':
    unittest.main()
