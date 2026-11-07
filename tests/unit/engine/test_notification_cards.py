"""Known authored card projections keep canonical strings, raw values and controls through fake end-user delivery only."""
from datetime import datetime, timezone
from html import escape
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path
import unittest
from types import SimpleNamespace
from unittest import mock
from src.ai import rejection, budget, insights, mail_lines, mail_calendar
from src import notify, notification_notices as notices, scout, doctor, trial, focus, notification_language, notification_cards as cards


class NotificationCardsTests(unittest.TestCase):
    def setUp(self):
        self.forbidden = []
        def blocked(*args, **kwargs):
            self.forbidden.append('unexpected live network or AI')
            raise AssertionError('unexpected live network or AI')
        for target in ('urllib.request.urlopen', 'src.ai.engine.client'):
            patcher = mock.patch(target, side_effect=blocked)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.addCleanup(lambda: self.assertEqual(self.forbidden, [], 'tripwires checked outside production catches'))

    def test_composition_is_immutable_and_single_pass_with_unknown_text_unchanged(self):
        raw = 'A&B <Fictional> {count}'
        message = cards.card(cards.words('focus.title'), cards.words('focus.waitingCount', count=2),
                             [cards.block(cards.raw(escape(raw)), cards.words('focus.waiting'))], emoji='🧭')
        canonical = str(message)
        self.assertEqual(json.dumps(message), json.dumps(canonical))
        for locale in notification_language.LOCALES:
            shown, markup = notification_language.projection(message, locale=locale)
            self.assertIn(escape(raw), shown)
            self.assertNotIn('&amp;lt;', shown)
            self.assertIn(notification_language.render('focus.title', locale=locale), shown)
            self.assertIsNone(markup)
        self.assertEqual(cards.delivery('Operational CI English'), {})

    def test_actual_focus_reminder_projects_with_canonical_records_and_fixed_conditions(self):
        now = datetime(2026, 11, 7, 12, tzinfo=timezone.utc)
        state = {'today': {'applied': 1, 'target': 5}, 'items': [
            {'kind': 'reply', 'company': 'A&B <Labs> {count}'},
            {'kind': 'prepare', 'priority': 1, 'company': 'Fictional Interview'},
            {'kind': 'feedback', 'company': 'Fictional Learning'}]}
        before = json.dumps(state)
        message = focus.reminder_card(state, now)
        self.assertIn('Your focus', message)
        for locale in notification_language.LOCALES:
            with mock.patch.dict(os.environ, {'JOBADABRA_NOTIFICATION_LANGUAGE': locale}):
                kwargs = cards.delivery(message)
            self.assertIn(notification_language.render('focus.title', locale=locale), kwargs.get('display_text', str(message)))
            self.assertIn('A&amp;B &lt;Labs&gt; {count}', kwargs.get('display_text', str(message)))
        self.assertEqual(json.dumps(state), before)


    def test_actual_trial_callback_keeps_canonical_line_and_claim_while_projecting(self):
        for locale in notification_language.LOCALES:
            delivered = []
            with mock.patch.dict(os.environ, {'JOBADABRA_NOTIFICATION_LANGUAGE': locale, 'JOBADABRA_TRIAL_KEY': 'fictional-install'}), \
                    mock.patch('src.daily_helpers.url_stages', return_value={}), \
                    mock.patch.object(trial, 'paused', return_value={'ended': True, 'notify': True}) as status, \
                    mock.patch('src.telegram.credentials', return_value=('fake-token', '17')), \
                    mock.patch('src.telegram.deliver', side_effect=lambda *args, **kwargs: delivered.append((args, kwargs))):
                self.assertTrue(trial.pause_run(SimpleNamespace(mode='scheduled', send=True), object()))
            self.assertEqual(status.call_args.kwargs, {'claim': True})
            args, kwargs = delivered[0]
            self.assertEqual(args, (trial.OVER_LINE, 'fake-token', '17'))
            self.assertEqual(kwargs.get('display_text', args[0]), notification_language.render('trial.over', locale=locale))


    def test_insight_and_weekly_actual_constructors_keep_raw_ai_and_callbacks(self):
        insight = {'headline': 'Fictional <AI> {count}', 'evidence': ['A&B evidence'], 'action': 'Raw action <review>',
                   'confidence': 'high', 'basis': 'Applications', 'sample_size': 2, 'category': 'Raw category'}
        report = {'headline': insight['headline'], 'finding': 'Raw finding', 'summary': 'Raw <summary>',
                  'worked': ['Raw worked'], 'change': ['Raw change'], 'focus': 'Raw focus'}
        markup = insights.keyboard('fictional-id')
        for message, key in ((insights.message(insight), 'insight.title'), (insights.weekly_message(report, 'https://fictional.test/?a=1&b=2'), 'weekly.title')):
            self.assertIsNotNone(notification_language.projection(message, locale='ru'))
            for locale in notification_language.LOCALES:
                shown, _ = notification_language.projection(message, locale=locale)
                self.assertIn(notification_language.render(key, locale=locale), shown)
                self.assertIn(escape(insight['headline']), shown)
                self.assertNotIn('&amp;lt;', shown)
        tagged = cards.with_buttons(insights.message(insight), markup, [['insight.useful', 'insight.notUseful', 'insight.act']])
        for locale in notification_language.LOCALES:
            _, shown_buttons = notification_language.projection(tagged, locale=locale)
            self.assertEqual([b['callback_data'] for b in shown_buttons['inline_keyboard'][0]], [b['callback_data'] for b in markup['inline_keyboard'][0]])


    def test_actual_unknown_mail_job_keeps_event_payload_and_localizes_only_card(self):
        stores = SimpleNamespace(events=SimpleNamespace(add=mock.Mock()))
        email = {'id': 'fictional-message', 'subject': 'Raw <Subject> {count}', 'date': '2026-11-07'}
        result = {'kind': 'Other', 'company': 'A&B <Labs>', 'summary': 'Raw <AI> summary'}
        index, lines, stats = [set()], [], {}
        mail_lines.ask(stores, email, result, None, index, lines, stats)
        self.assertEqual(stores.events.add.call_args.args[:3], ('', 'Other', email['date']))
        self.assertEqual(stores.events.add.call_args.kwargs['note'], 'Raw <AI> summary (email: "Raw <Subject> {count}")')
        self.assertEqual(index, [{'fictional-message'}])
        for locale in notification_language.LOCALES:
            shown, _ = notification_language.projection(lines[0], locale=locale)
            self.assertIn(notification_language.render('mail.whichJob', locale=locale), shown)
            self.assertIn('A&amp;B &lt;Labs&gt;', shown)
            self.assertIn('Raw &lt;AI&gt; summary', shown)


    def test_actual_calendar_prep_keeps_raw_event_and_explicit_recording_consent(self):
        stores = SimpleNamespace(link=lambda page: 'https://fictional.test/?a=1&b=2')
        row = {'id': 'fictional-app', 'company': 'A&B <Labs>', 'title': 'Raw role', 'next_step': 'Raw next step'}
        event = {'summary': 'Raw <Interview> {count}', 'attendees': [{'displayName': 'Raw <Person>'}], 'hangoutLink': 'https://fictional.test/call'}
        with mock.patch.object(mail_calendar, 'interview_stats', return_value={'topics_answered_weakly': {'Raw <Topic>': 2}}) as reads:
            message = mail_calendar.prep_message(stores, row, event, datetime(2026, 11, 8, 12, tzinfo=timezone.utc), 'Tomorrow')
        self.assertEqual(reads.call_count, 1)
        for locale in notification_language.LOCALES:
            shown, _ = notification_language.projection(message, locale=locale)
            self.assertIn(notification_language.render('calendar.consent', locale=locale), shown)
            self.assertIn('Raw &lt;Interview&gt; {count}', shown)
            self.assertIn('Raw &lt;Person&gt;', shown)
            self.assertIn('Raw &lt;Topic&gt;', shown)
            self.assertIn('https://fictional.test/?a=1&amp;b=2', shown)


    def test_actual_budget_callback_preserves_refusal_retry_and_monthly_once_only(self):
        info = {'level': 'pause', 'pct': .95, 'spent': 95, 'budget': 100, 'source': 'Raw <Source> {count}'}
        with sqlite3.connect(':memory:') as db:
            sent = []
            def send(text):
                sent.append(text)
                return len(sent) > 1
            now = datetime(2026, 11, 7, tzinfo=timezone.utc)
            self.assertFalse(budget.alert_once(db, info, send, now))
            self.assertTrue(budget.alert_once(db, info, send, now))
            self.assertFalse(budget.alert_once(db, info, send, now))
            self.assertEqual(len(sent), 2)
            self.assertEqual(str(sent[0]), str(sent[1]))
            for locale in notification_language.LOCALES:
                shown, _ = notification_language.projection(sent[0], locale=locale)
                self.assertIn('JOBADABRA_MONTHLY_BUDGET_USD', shown)
                self.assertIn(escape(info['source']), shown)
                self.assertIn('$95.00', shown)
                self.assertIn(notification_language.render('budget.title', locale=locale), shown)


    def test_actual_health_callback_keeps_check_details_and_one_read(self):
        check = doctor.Check('Health', 'Raw <check>', doctor.FAIL, 'Raw detail {count}', 'Raw <fix>')
        delivered = []
        with mock.patch.object(doctor, 'health_checks', return_value=[check]) as reads:
            result = doctor.alert(object(), delivered.append)
        self.assertEqual(reads.call_count, 1)
        self.assertEqual(str(delivered[0]), str(result))
        self.assertIn('Jobadabra health', result)
        for locale in notification_language.LOCALES:
            shown, _ = notification_language.projection(delivered[0], locale=locale)
            self.assertIn(notification_language.render('health.title', locale=locale), shown)
            self.assertIn('Raw &lt;check&gt;', shown)
            self.assertIn('Raw detail {count}', shown)
            self.assertIn('Raw &lt;fix&gt;', shown)


    def test_actual_rejection_callback_keeps_logs_and_raw_review(self):
        from tests.unit.stores.test_rejection import stores_with
        stores, rows = stores_with(('A&B <Labs>', 'Raw role', 'Rejected', {}))
        raw = {'verdict': 'Unclear', 'confidence': 'medium', 'summary': 'Raw <AI> {count}'}
        summary = rejection.line(rows[0], raw)
        sent, logs = [], []
        with mock.patch.object(rejection, 'open_stores', return_value=stores), \
                mock.patch.object(rejection, 'pending', return_value=rows), \
                mock.patch.object(rejection, 'review', return_value=(raw, summary)), \
                mock.patch.object(rejection.run_log, 'auto_begin'), \
                mock.patch.object(rejection.run_log, 'log_run', side_effect=lambda store, run: logs.append(run)), \
                mock.patch('src.telegram.credentials', return_value=('fake-token', '17')), \
                mock.patch('src.telegram.deliver', side_effect=lambda *args, **kwargs: sent.append((args, kwargs))), \
                mock.patch.dict(os.environ, {'JOBADABRA_NOTIFICATION_LANGUAGE': 'ru'}):
            self.assertEqual(rejection.main(['--pending', '--send']), 0)
        self.assertEqual(logs[0]['updates'], [str(summary)])
        self.assertIn('Why rejected', logs[0]['updates'][0])
        self.assertEqual(sent[0][0][1:], ('fake-token', '17'))
        shown = sent[0][1]['display_text']
        self.assertIn(notification_language.render('rejection.title', locale='ru'), shown)
        self.assertIn('Raw &lt;AI&gt; {count}', shown)
        self.assertIn('Unclear (medium)', shown)


    def test_actual_scout_summary_freezes_results_and_preserves_source_values(self):
        summary = {'checked': 2, 'first_time': 1, 'left': 1, 'ideas': {'companies': 2, 'directories': 1, 'note': 'Raw <note> {count}'},
                   'total_feeds': 5, 'queued': 3, 'harvested': 2}
        outcomes = [({'name': 'A&B <Labs> {count}', 'tier': 'Tier 1'}, {'status': 'found', 'quality': 87,
            'stats': {'relevant': 2, 'preferred': 1, 'places': ['Raw <Place>'],}, 'ats': 'lever'})]
        before = json.dumps([summary, outcomes])
        message = scout.telegram_summary(summary, outcomes)
        self.assertEqual(json.dumps([summary, outcomes]), before)
        self.assertIn('Source quality 87', message)
        outcomes.clear()
        for locale in notification_language.LOCALES:
            shown, _ = notification_language.projection(message, locale=locale)
            self.assertIn(notification_language.render('scout.title', locale=locale), shown)
            self.assertIn('A&amp;B &lt;Labs&gt; {count}', shown)
            self.assertIn('Raw &lt;Place&gt;', shown)
            self.assertIn('Raw &lt;note&gt; {count}', shown)
            self.assertIn(notification_language.render('scout.footer', locale=locale), shown)


    def test_typed_failed_run_email_localizes_raw_mode_url_once_and_generic_text_stays_english(self):
        mode, url = 'Raw mode {count}', 'https://fictional.test/?x=<raw>&v={mode}'
        for locale in notification_language.LOCALES:
            with mock.patch.dict(os.environ, {'JOBADABRA_NOTIFY': 'email', 'JOBADABRA_NOTIFICATION_LANGUAGE': locale}, clear=True), \
                    mock.patch.object(notify, 'queue') as queue:
                self.assertEqual(notify.main(['--failure', 'run', mode, url]), 0)
            shown = queue.call_args.args[0]
            expected = notification_language.render('failure.run', {'mode': mode, 'url': url}, locale=locale)
            self.assertEqual(shown, escape(expected))
            self.assertEqual(queue.call_args.kwargs, {'urgent': True, 'mail': 'app-stopped'})
        with mock.patch.dict(os.environ, {'JOBADABRA_NOTIFY': 'email', 'JOBADABRA_NOTIFICATION_LANGUAGE': 'ru'}, clear=True), \
                mock.patch.object(notify, 'queue') as queue:
            self.assertEqual(notify.main(['Operational CI English']), 0)
        self.assertEqual(queue.call_args.args[0], 'Operational CI English')


    def test_actual_workflow_failure_bodies_use_fake_curl_and_preserve_gate_and_fallback(self):
        root = Path(__file__).resolve().parents[3]
        for workflow, step, kind in [('daily', 'Report failure to Telegram', 'run'), ('mail', 'Report failure', 'mail')]:
            source = (root / '.github' / 'workflows' / f'{workflow}.yml').read_text()
            body = source.split(f'      - name: {step}\n', 1)[1].split('        run: |\n', 1)[1].split('      - name:', 1)[0]
            script = '\n'.join(line[10:] for line in body.splitlines() if line.startswith('          '))
            with tempfile.TemporaryDirectory(prefix='.tmp-notices-', dir=root) as tmp:
                folder = Path(tmp)
                capture = folder / 'curl.json'
                (folder / 'curl').write_text('#!' + sys.executable + '\nimport json,os,sys\nfrom pathlib import Path\nPath(os.environ["CAPTURE"]).write_text(json.dumps(sys.argv[1:]))\n')
                (folder / 'curl').chmod(0o755)
                (folder / 'python').write_text('#!/bin/sh\n[ "$FORMAT_FAIL" != 1 ] || exit 1\nexec ' + str(root / '.venv/bin/python') + ' "$@"\n')
                (folder / 'python').chmod(0o755)
                env = {'PATH': str(folder) + ':/usr/bin:/bin', 'JOBADABRA_NOTIFY': 'telegram',
                       'TELEGRAM_BOT_TOKEN': 'fake-token', 'TELEGRAM_CHAT_ID': '17', 'MODE': 'Raw mode {count}',
                       'RUN_URL': 'https://fictional.test/?a=1&b={mode}', 'CAPTURE': str(capture)}
                for locale in notification_language.LOCALES:
                    result = subprocess.run(['/bin/bash', '-e', '-c', script], cwd=root, env={**env, 'JOBADABRA_NOTIFICATION_LANGUAGE': locale}, capture_output=True, text=True, timeout=10)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    args = json.loads(capture.read_text())
                    self.assertIn('chat_id=17', args)
                    expected = '❌ ' + notification_language.render('failure.' + kind, {'mode': env['MODE'], 'url': env['RUN_URL']}, locale=locale)
                    self.assertIn('text=' + expected, args)
                capture.unlink()
                result = subprocess.run(['/bin/bash', '-e', '-c', script], cwd=root, env={**env, 'JOBADABRA_NOTIFICATION_LANGUAGE': 'ru', 'FORMAT_FAIL': '1'}, capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('text=❌ ' + notification_language.render('failure.' + kind, {'mode': env['MODE'], 'url': env['RUN_URL']}), json.loads(capture.read_text()))
                capture.unlink()
                result = subprocess.run(['/bin/bash', '-e', '-c', script], cwd=root, env={**env, 'JOBADABRA_NOTIFY': 'off'}, capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertFalse(capture.exists())


if __name__ == '__main__':
    unittest.main()
