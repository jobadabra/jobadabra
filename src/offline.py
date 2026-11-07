"""Whether an error means this computer has no connection (no DNS, no network), which is not a bug of ours and not a crash: a job says so in one sentence and ends ok.
Only the unreachable-network family counts. A refused local server, a timeout or a bad answer is something else, and stays what it was.
Why (7 Nov 2026, Sentry JOB-PILOTTO-APP-4Z, 4Y): a Windows tester's Gmail check ended with a raw urllib traceback ("getaddrinfo failed", "[WinError 10051]") reported as a failed run."""
import errno
import socket
import urllib.error

# errno values for "the network is not there": Linux/macOS names, and the Winsock codes Windows reports (10050 down, 10051 unreachable, 10065 host unreachable, 11001-11004 name lookup).
CODES = {errno.ENETUNREACH, errno.EHOSTUNREACH, errno.ENETDOWN, 10050, 10051, 10065, 11001, 11002, 11003, 11004}


def is_offline(error):
    """True when `error` (or what it was raised `from`) is a failed name lookup or an unreachable network; False for anything else, including `None`."""
    seen = 0
    while error is not None and seen < 6:
        reason = error.reason if isinstance(error, urllib.error.URLError) else error
        if isinstance(reason, socket.gaierror) or (isinstance(reason, OSError) and not isinstance(reason, urllib.error.HTTPError) and reason.errno in CODES):
            return True
        error, seen = error.__cause__, seen + 1   # `raise X from e` only: an unrelated bug raised while handling an offline error is not offline
    return False
