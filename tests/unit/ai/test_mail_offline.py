"""A Gmail check on a computer with no connection says so in one sentence and exits 0: being offline is not a crash (Sentry JOB-PILOTTO-APP-4Z, 4Y).
Why (7 Nov 2026): a Windows tester's check ended with a raw urllib traceback ("getaddrinfo failed", "[WinError 10051]") and was reported as a failed run."""
import contextlib
import errno
import io
import socket
import unittest
import urllib.error
from unittest import mock

from src import offline
from src.ai import mail, mail_failure


def unreachable(code, text):
    return urllib.error.URLError(OSError(code, text))


class OfflineTest(unittest.TestCase):
    def test_what_counts_as_no_connection(self):
        for error in (urllib.error.URLError(socket.gaierror(11001, 'getaddrinfo failed')), urllib.error.URLError(socket.gaierror(-2, 'Name or service not known')),
                      unreachable(10051, 'A socket operation was attempted to an unreachable network'), unreachable(errno.ENETUNREACH, 'Network is unreachable'),
                      socket.gaierror(-3, 'Temporary failure in name resolution')):
            with self.subTest(error=str(error)):
                self.assertTrue(offline.is_offline(error))
        for error in (urllib.error.HTTPError('https://x.test', 400, 'Bad Request', {}, None), ValueError('nope'), urllib.error.URLError(ConnectionRefusedError(111, 'Connection refused')),
                      urllib.error.URLError('some reason'), TimeoutError('timed out')):
            with self.subTest(error=str(error)):
                self.assertFalse(offline.is_offline(error), 'a refused local server, a timeout or a bad answer is not "no connection"')

    def test_a_bug_raised_while_handling_an_offline_error_is_not_offline(self):
        try:
            try:
                raise urllib.error.URLError(socket.gaierror(11001, 'getaddrinfo failed'))
            except urllib.error.URLError:
                raise ValueError('bug in the fallback')   # implicit context only
        except ValueError as bug:
            self.assertFalse(offline.is_offline(bug))
        try:
            try:
                raise urllib.error.URLError(socket.gaierror(11001, 'getaddrinfo failed'))
            except urllib.error.URLError as cause:
                raise RuntimeError('mail check failed') from cause
        except RuntimeError as wrapped:
            self.assertTrue(offline.is_offline(wrapped))

    def test_the_cause_and_its_words(self):
        error = urllib.error.URLError(socket.gaierror(11001, 'getaddrinfo failed'))
        self.assertEqual(mail_failure.failure_cause(error), 'offline')
        self.assertEqual(mail_failure.failure_warning(error), mail_failure.NOT_CHECKED['offline'])
        self.assertEqual(set(mail_failure.NOT_CHECKED_OPENAI), set(mail_failure.NOT_CHECKED))

    def test_a_check_without_a_connection_says_so_and_exits_0(self):
        """The tester's scenario: Gmail cannot be reached (DNS fails) while the check reads; the run ends ok with one sentence, no traceback."""
        out = io.StringIO()
        error = urllib.error.URLError(socket.gaierror(11001, 'getaddrinfo failed'))
        with mock.patch.object(mail.Google, 'from_env', return_value=object()), mock.patch.object(mail, 'open_stores', return_value=mock.MagicMock()), \
                mock.patch.object(mail, 'run', side_effect=error), contextlib.redirect_stdout(out):
            code = mail.main(['--dry-run'])
        self.assertEqual(code, 0)
        self.assertRegex(out.getvalue(), r'(?m)^Mail check skipped: no connection; it tries again at the next check$')

    def test_a_real_failure_still_raises(self):
        with mock.patch.object(mail.Google, 'from_env', return_value=object()), mock.patch.object(mail, 'open_stores', return_value=mock.MagicMock()), \
                mock.patch.object(mail, 'run', side_effect=ValueError('boom')), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(ValueError):
                mail.main(['--dry-run'])


if __name__ == '__main__':
    unittest.main()
