"""E-mail as a channel for every Telegram message (src/notify.py, src/telegram.py): the chosen channels, one e-mail per run, urgent at once, the same card in both, and no second way to message."""
import io
import json
import os
import re
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..')))

from src import notify, telegram  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
EMAIL = {'JOBADABRA_NOTIFY': 'email', 'JOBADABRA_TRIAL_KEY': 'JPF1.install-0001.tok', 'JOBADABRA_SITE_URL': 'https://site.test'}
CARD = '📬 <b>3 new matches</b>\nFrom your search\n\n<b>Top</b>\n<a href="https://x.example/1">Data Engineer</a>'


class Site:
    """A stand-in for POST /api/notify/email; records what the run sent."""

    def __init__(self, answer=None):
        self.sent, self.answer = [], answer or {'ok': True}

    def __call__(self, request, timeout=0):
        if isinstance(self.answer, Exception):
            raise self.answer
        self.sent.append({'url': request.full_url, 'key': request.get_header('X-api-key'), 'body': json.loads(request.data)})
        return io.BytesIO(json.dumps(self.answer).encode())


def run_with(env, site, work):
    for held in notify._QUEUE.values():
        held.clear()
    with mock.patch.dict(os.environ, env, clear=True), mock.patch('src.notify.urllib.request.urlopen', site), mock.patch('src.notify.atexit.register'):
        return work()


class ChannelTests(unittest.TestCase):
    def test_unset_means_telegram_only_and_the_site_is_never_called(self):
        site = Site()
        self.assertIsNone(notify.channels({}))
        self.assertTrue(notify.wants_telegram({}) and not notify.wants_email({}))

        def work():
            with mock.patch('src.telegram.urllib.request.urlopen', lambda request, timeout=0: io.BytesIO(b'{"ok": true}')):
                telegram.send(CARD, 'tok', '1')
            return notify.flush()
        run_with({'TELEGRAM_BOT_TOKEN': 't', 'TELEGRAM_CHAT_ID': '1'}, site, work)
        self.assertEqual(site.sent, [])

    def test_email_only_needs_no_telegram_credentials(self):
        self.assertEqual(run_with({**EMAIL}, Site(), telegram.credentials), (None, None))
        both_without_bot = {**EMAIL, 'JOBADABRA_NOTIFY': 'email,telegram'}
        self.assertEqual(run_with(both_without_bot, Site(), telegram.credentials), (None, None))
        with_bot = {**both_without_bot, 'TELEGRAM_BOT_TOKEN': 't', 'TELEGRAM_CHAT_ID': '1'}
        self.assertEqual(run_with(with_bot, Site(), telegram.credentials), ('t', '1'))

    def test_email_only_hides_a_configured_bot(self):
        self.assertEqual(run_with({**EMAIL, 'TELEGRAM_BOT_TOKEN': 't', 'TELEGRAM_CHAT_ID': '1'}, Site(), telegram.credentials), (None, None))

    def test_telegram_chosen_without_a_bot_still_stops_with_the_old_message(self):
        with self.assertRaises(SystemExit):
            run_with({'JOBADABRA_NOTIFY': 'telegram'}, Site(), telegram.credentials)


class DeliveryTests(unittest.TestCase):
    def test_end_user_locale_metadata_and_subject_connector_keep_raw_content(self):
        from src import notification_language
        raw = 'Fictional {count} Keychain ⌘K'
        items = [(f'<b>{raw}</b>\nRaw provider text', None)] * 3
        for locale in notification_language.LOCALES:
            site = Site()
            env = {**EMAIL, 'JOBADABRA_NOTIFICATION_LANGUAGE': locale}
            self.assertTrue(notify._post(items, urlopen=site, env=env))
            body = site.sent[0]['body']
            self.assertEqual(body['language'], locale)
            self.assertEqual(body['subject'], notification_language.render('notification.subjectMore', {'title': raw}, locale=locale, count=2))
            self.assertEqual(body['html'], notify.SEPARATOR.join(item[0] for item in items))
        with mock.patch.dict(os.environ, {'JOBADABRA_NOTIFICATION_LANGUAGE': 'ru'}, clear=True):
            self.assertEqual(notify._subject(items), raw + ' and 2 more', 'generic formatter defaults English without reading user environment')

    def test_no_language_or_unsupported_language_keeps_exact_english_subject_and_html(self):
        items = [('<b>Canonical title</b>\nRaw body', None)] * 2
        for value in (None, '', 'system', 'unsupported'):
            site = Site()
            env = dict(EMAIL)
            if value is not None:
                env['JOBADABRA_NOTIFICATION_LANGUAGE'] = value
            self.assertTrue(notify._post(items, urlopen=site, env=env))
            self.assertEqual(site.sent[0]['body']['language'], 'en')
            self.assertEqual(site.sent[0]['body']['subject'], 'Canonical title and 1 more')
            self.assertEqual(site.sent[0]['body']['html'], notify.SEPARATOR.join(item[0] for item in items))

    def test_new_matches_are_one_email_per_run_and_the_rest_goes_to_the_digest(self):
        site = Site()

        def work():
            telegram.send(CARD, None, None, kind='matches')
            telegram.send(CARD, None, None, kind='matches')
            telegram.send('🔔 <b>Budget</b>\n80% used', None, None)
            telegram.send('📮 <b>Rejection</b>\nAcme', None, None)
            self.assertEqual(site.sent, [])   # held until the run ends
            return notify.flush()
        self.assertTrue(run_with(EMAIL, site, work))
        self.assertEqual(len(site.sent), 2)
        matches, activity = site.sent
        self.assertEqual(matches['url'], 'https://site.test/api/notify/email')
        self.assertEqual(matches['key'], EMAIL['JOBADABRA_TRIAL_KEY'])
        self.assertEqual(matches['body']['subject'], '3 new matches and 1 more')
        self.assertIn('Data Engineer', matches['body']['html'])
        self.assertNotIn('kind', matches['body'], 'new matches go at once')
        self.assertEqual(activity['body']['kind'], 'activity', 'everything else waits for the digest')
        self.assertEqual(activity['body']['subject'], 'Budget and 1 more')

    def test_flushing_the_matches_leaves_the_activity_for_the_end_of_the_run(self):
        site = Site()

        def work():
            telegram.send(CARD, None, None, kind='matches')
            telegram.send('📮 <b>Rejection</b>', None, None)
            return notify.flush('matches')
        self.assertTrue(run_with(EMAIL, site, work))
        self.assertEqual(len(site.sent), 1)
        self.assertIn('Data Engineer', site.sent[0]['body']['html'])

    def test_urgent_goes_at_once_alone(self):
        site = Site()
        run_with(EMAIL, site, lambda: (telegram.send('<b>Interview reviewed</b>', None, None, urgent=True), telegram.send(CARD, None, None)))
        self.assertEqual([m['body']['subject'] for m in site.sent], ['Interview reviewed'])

    def test_link_buttons_become_links_and_callback_buttons_are_dropped(self):
        site = Site()
        markup = {'inline_keyboard': [[{'text': '➕ Next', 'callback_data': 'more'}, {'text': '🔗 Open', 'url': 'https://x.example/app'}]]}
        run_with(EMAIL, site, lambda: (telegram.send(CARD, None, None, markup), notify.flush()))
        self.assertEqual(site.sent[0]['body']['buttons'], [{'text': '🔗 Open', 'url': 'https://x.example/app'}])

    def test_both_channels_send_to_telegram_and_queue_the_email(self):
        site, posted = Site(), []
        env = {**EMAIL, 'JOBADABRA_NOTIFY': 'email,telegram'}

        def work():
            with mock.patch('src.telegram.urllib.request.urlopen', lambda request, timeout=0: (posted.append(request.full_url), io.BytesIO(b'{"ok": true}'))[1]):
                telegram.send(CARD, 'tok', '1')
            return notify.flush()
        run_with(env, site, work)
        self.assertEqual(len(posted), 1)
        self.assertIn('/bottok/sendMessage', posted[0])
        self.assertEqual(len(site.sent), 1)

    def test_nothing_held_sends_nothing(self):
        site = Site()
        self.assertTrue(run_with(EMAIL, site, notify.flush))
        self.assertEqual(site.sent, [])

    def test_a_refused_or_unreachable_site_says_so_and_does_not_crash(self):
        for answer in ({'ok': False, 'reason': 'unconfirmed'}, OSError('offline')):
            site = Site(answer)
            out = io.StringIO()
            with mock.patch('sys.stderr', out):
                ok = run_with(EMAIL, site, lambda: (telegram.send(CARD, None, None), notify.flush())[1])
            self.assertFalse(ok)
            self.assertIn('Warning: the e-mail was not sent', out.getvalue())

    def test_a_refusal_with_a_status_names_its_reason_not_just_HTTPError(self):
        """Sentry APP-4R/4V: the site refuses with a 4xx and JSON; urllib raised, and the warning said only "(HTTPError)"."""
        import urllib.error
        for status, body, said in ((401, b'{"ok": false, "error": "unauthorized"}', 'unauthorized'), (502, b'<html>Bad gateway</html>', 'HTTP 502'),
                                   (503, b'null', 'HTTP 503'), (500, b'["x"]', 'HTTP 500'), (400, b'{"error": {"a": 1}}', 'HTTP 400'), (403, ('{"error": "' + 'w' * 500 + '"}').encode(), 'w' * 80)):
            error = urllib.error.HTTPError('https://site.test/api/notify/email', status, 'x', {}, io.BytesIO(body))
            out = io.StringIO()
            with mock.patch('sys.stderr', out):
                ok = run_with(EMAIL, Site(error), lambda: (telegram.send(CARD, None, None), notify.flush())[1])
            self.assertFalse(ok)
            self.assertIn(f'Warning: the e-mail was not sent ({said}).', out.getvalue())

    def test_no_install_key_means_no_email_and_no_crash(self):
        out = io.StringIO()
        with mock.patch('sys.stderr', out):
            ok = run_with({'JOBADABRA_NOTIFY': 'email', 'JOBADABRA_SITE_URL': 'https://site.test'}, Site(), lambda: (telegram.send(CARD, None, None), notify.flush())[1])
        self.assertFalse(ok)

    def test_the_end_to_end_journey_never_reaches_the_real_site(self):
        site = Site()
        run_with({'JOBADABRA_NOTIFY': 'email', 'JOBADABRA_TRIAL_KEY': 'JPF1.a.b', 'JOBADABRA_E2E': '1'}, site, lambda: (telegram.send(CARD, None, None), notify.flush()))
        self.assertEqual(site.sent, [])

    def test_the_free_ai_key_identifies_the_run_when_there_is_no_trial_key(self):
        site = Site()
        run_with({'JOBADABRA_NOTIFY': 'email', 'ANTHROPIC_API_KEY': 'JPF1.i.t', 'JOBADABRA_SITE_URL': 'https://site.test'}, site, lambda: (telegram.send(CARD, None, None), notify.flush()))
        self.assertEqual(site.sent[0]['key'], 'JPF1.i.t')


class MailRowTests(unittest.TestCase):
    """The person's switch per e-mail (hr 4/8): each mail the engine can name carries its row, and a row they turned off is not sent."""

    def test_each_mail_names_its_row_and_a_message_with_no_row_names_none(self):
        site = Site()

        def work():
            telegram.send(CARD, None, None, kind='matches')
            telegram.send('📊 <b>Weekly report</b>\nA quiet week', None, None, kind='weekly')
            telegram.send('🔔 <b>Budget</b>\n80% used', None, None)
            telegram.send('<b>Interview reviewed</b>', None, None, urgent=True)
            notify.main(['Jobadabra daily run failed: https://example.test/run/1'])
            return notify.flush()
        self.assertTrue(run_with(EMAIL, site, work))
        rows = {message['body']['subject']: message['body'].get('mail') for message in site.sent}
        self.assertEqual(rows, {'3 new matches': 'app-matches', 'Weekly report': 'app-weekly', 'Budget': None,
                                'Interview reviewed': None, 'Jobadabra daily run failed: https://example.test/run/1': 'app-stopped'})

    def test_the_weekly_report_is_its_own_mail_with_its_row_and_still_held_for_the_digest_as_before(self):
        site = Site()
        run_with(EMAIL, site, lambda: (telegram.send('<b>Weekly report</b>', None, None, kind='weekly'), notify.flush()))
        self.assertEqual((site.sent[0]['body']['kind'], site.sent[0]['body']['mail']), ('activity', 'app-weekly'))   # Why (6 Nov 2026, review): the site's own change decides what a held mail with a row becomes; this PR keeps today's delivery

    def test_a_row_the_person_turned_off_is_not_sent_and_is_not_a_failure(self):
        site = Site()
        off = {**EMAIL, 'JOBADABRA_MAIL_OFF': 'app-matches, app-stopped'}

        def work():
            telegram.send(CARD, None, None, kind='matches')
            telegram.send('<b>Weekly report</b>', None, None, kind='weekly')
            telegram.send('<b>Budget</b>', None, None)
            notify.main(['the run failed'])
            return notify.flush()
        self.assertTrue(run_with(off, site, work))
        self.assertEqual(sorted(m['body']['subject'] for m in site.sent), ['Budget', 'Weekly report'], 'the other rows and the row-less digest still go')

    def test_an_urgent_message_with_no_row_ignores_the_off_list(self):
        site = Site()
        run_with({**EMAIL, 'JOBADABRA_MAIL_OFF': 'app-matches,app-weekly,app-stopped'}, site, lambda: telegram.send('<b>Interview reviewed</b>', None, None, urgent=True))
        self.assertEqual(len(site.sent), 1)

    def test_the_weekly_mode_sends_its_report_as_the_weekly_kind_and_the_daily_insight_as_activity(self):
        from types import SimpleNamespace
        from src import daily_modes
        for mode, kind in (('weekly', 'weekly'), ('insight', 'activity')):
            sent = []

            def make(db, stores, send=None, stats=None, **_):
                send('<b>Report</b>', None)
                return 'done'
            args = SimpleNamespace(mode=mode, send=True, db=':memory:', if_due=False)
            with mock.patch.object(telegram, 'credentials', lambda: ('tok', '1')), mock.patch.object(telegram, 'deliver', lambda *a, **k: sent.append(k.get('kind'))), \
                    mock.patch.object(daily_modes.insights, 'weekly', make), mock.patch.object(daily_modes.insights, 'run', make), mock.patch.object(daily_modes.store, 'connect', mock.MagicMock()), \
                    mock.patch.object(daily_modes, 'new_cron_run', lambda name: {'warnings': []}), mock.patch.object(daily_modes, 'log_ai_run', lambda *a, **k: None), mock.patch.object(daily_modes, '_run_store', lambda stores, message: object()), \
                    mock.patch.object(daily_modes.insights, 'category_of', lambda text: ''):
                daily_modes.insight_mode(args)
            self.assertEqual(sent, [kind], mode)


class OneMechanismTests(unittest.TestCase):
    """The class: every message the engine sends to a person goes through telegram.send, so each has its e-mail form."""

    def test_only_telegram_py_talks_to_the_bot_api(self):
        talkers = [str(p.relative_to(ROOT)) for p in (ROOT / 'src').rglob('*.py') if 'api.telegram.org' in p.read_text(encoding='utf-8')]
        self.assertEqual(talkers, ['src/telegram.py'])

    def test_every_send_call_passes_through_telegram_send_or_to_app(self):
        for path in (ROOT / 'src').rglob('*.py'):
            text = path.read_text(encoding='utf-8')
            for match in re.finditer(r'\burlopen\(.*sendMessage', text):
                self.fail(f'{path} posts sendMessage itself: use telegram.send')


if __name__ == '__main__':
    unittest.main()
