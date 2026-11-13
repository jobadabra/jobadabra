#!/usr/bin/env python3
"""One gh call that GitHub's own 500/502/503/504 may get one more try, shared by every CI tool that reads or labels through gh.

  python3 tools/gh_retry.py <gh args...>     same stdout, stderr and exit code as `gh <args>`; only the deciding call's stdout is printed
  import gh_retry; gh_retry.run([...])       a subprocess.CompletedProcess (text)

Why (3 Nov 2026, owner chose "One retry on GitHub errors", then "Both (Recommended)" for the release checks): 5 of ~400 Gitar label runs since 31 Oct and the
Windows release job of beta run 41639241372 went red on GitHub's "504 Gateway Timeout" / "503 Service Unavailable" (12:56-13:06 UTC), not on anything of ours.
Why 500 too (13 Nov 2026, #4008): its "steps this PR reaches" job went red on `could not create workflow dispatch event: HTTP 500: Failed to run workflow dispatch`
(run 43475011635), no step run, and the same code passed later: GitHub's own server error, not ours. A dispatch is the one call here that is not idempotent: if GitHub made
the run and still answered 500, the retry starts a second run of the same steps (costs minutes, changes no verdict).
Invariants: only a 500/502/503/504 in gh's error is retried, once, after ~10 s; a second failure is returned as it is (still red); a 401/403/429 or any other error
is never retried (CLAUDE.md: no retry of a 401/403/429). A safety step stays strict: this changes no verdict, only whether GitHub's outage decides it.
"""
import re
import subprocess
import sys
import time

GATEWAY = re.compile(r'(?:status code:|HTTP)\s*50[0234](?!\d)')   # gh's words: "non-200 OK status code: 504 Gateway Timeout", "HTTP 503: Service Unavailable", "HTTP 500: Failed to run workflow dispatch"


RETRY_SECONDS = 10


def run(args):
    """`gh <args>`; tried once more after RETRY_SECONDS when GitHub answered 500/502/503/504. -> the CompletedProcess that decides.
    subprocess.run is read at call time, so a test that patches it (tests/tooling/release/test_e2e_gate.py) reaches the call."""
    first = subprocess.run(['gh', *args], capture_output=True, text=True)
    said = first.stderr if isinstance(first.stderr, str) else ''
    if first.returncode == 0 or not GATEWAY.search(said):
        return first
    sys.stderr.write(said)
    sys.stderr.write(f'gh_retry: GitHub answered {GATEWAY.search(said).group(0)}; trying once more in {RETRY_SECONDS} s\n')
    time.sleep(RETRY_SECONDS)
    return subprocess.run(['gh', *args], capture_output=True, text=True)


def main(argv):
    done = run(argv)
    sys.stdout.write(done.stdout or '')
    sys.stderr.write(done.stderr or '')
    return done.returncode


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
