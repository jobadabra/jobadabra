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
from src.ai import cost, interviews_blocks, rejection, budget, insights, mail_lines, mail_calendar
from src.stores import memory
from src import ledger_store, daily_helpers, daily_modes, notify, notification_notices as notices, scout, doctor, trial, focus, notification_language, notification_cards as cards


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
        nested = cards.safe(cards.canonical('Canonical <record> {count}', cards.words('focus.title')))
        self.assertEqual(str(nested), 'Canonical &lt;record&gt; {count}')
        self.assertEqual(json.dumps(nested), json.dumps(str(nested)))
        for locale in notification_language.LOCALES:
            shown, _ = notification_language.projection(nested, locale=locale)
            self.assertEqual(shown, escape(notification_language.render('focus.title', locale=locale)))

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
            original_render = notification_language.render
            with mock.patch.object(notification_language, 'render', side_effect=lambda key, *args, **kwargs: 'Fictional <Budget> {count}' if key == 'budget.title' else original_render(key, *args, **kwargs)):
                for locale in notification_language.LOCALES:
                    shown, _ = notification_language.projection(sent[0], locale=locale)
                    self.assertIn('Fictional &lt;Budget&gt; {count}', shown)
            self.assertIn('AI budget', str(sent[0]))


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
        for workflow, step, kind in [('daily', 'Report failure to Telegram', 'run'), ('mail', 'Report failure', 'mail'), ('scout', 'Report failure to Telegram', 'scout')]:
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


    def test_actual_apply_command_callback_preserves_action_records_and_raw_values(self):
        job = {'title': 'Raw <Role> {count}', 'company': 'A&B <Labs>', 'url': 'https://fictional.test/job'}
        found = {'id': 'fictional-id'}
        stores = SimpleNamespace(name='sqlite', link=lambda page: '')
        for locale in notification_language.LOCALES:
            sent = []
            with mock.patch.dict(os.environ, {'JOBADABRA_NOTIFICATION_LANGUAGE': locale}, clear=True), \
                    mock.patch.object(daily_helpers, 'find_job', return_value=job), \
                    mock.patch.object(daily_helpers.rules, 'mark', return_value=(found, 'updated')) as mark, \
                    mock.patch('src.ledger_store.add_event') as event, mock.patch('src.ledger_store.record') as record, \
                    mock.patch.object(daily_helpers, 'queue_mail_check') as queued, \
                    mock.patch.object(daily_modes.store, 'connect'), \
                    mock.patch('src.telegram.credentials', return_value=('fake-token', '17')), \
                    mock.patch('src.telegram.deliver', side_effect=lambda *args, **kwargs: sent.append((args, kwargs))), \
                    mock.patch('builtins.print'):
                self.assertEqual(daily_modes.apply_mode(SimpleNamespace(job='code', action='applied', send=True, db='fake-db'), stores), 0)
            self.assertEqual(mark.call_args.args, (stores, job, 'Applied'))
            self.assertEqual(event.call_args.args, (stores, found, 'Applied', 'Telegram'))
            self.assertEqual(record.call_args.args, (stores, job['url']))
            self.assertEqual(queued.call_count, 1)
            canonical = str(sent[0][0][0])
            self.assertIn('Marked applied', canonical)
            shown = sent[0][1].get('display_text', canonical)
            self.assertEqual(shown, notification_language.render('apply.applied', {'title': escape(job['title']) + '\n' + escape(job['company']),
                'link': notification_language.render('notice.app', locale=locale), 'next': notification_language.render('notice.nextStep', locale=locale)}, locale=locale))
            self.assertIn('Raw &lt;Role&gt; {count}', shown)
            self.assertIn('A&amp;B &lt;Labs&gt;', shown)


    def test_actual_interview_command_callback_preserves_raw_review_and_urgent_flag(self):
        review = {'company': 'A&B <Labs>', 'round': 'Raw <Round> {count}', 'summary': 'Raw <Summary>',
                  'questions': [{'quality': 'weak', 'topic': 'Raw <Topic>', 'better': 'Raw <Better>', 'question': 'Raw question'}],
                  'strengths': ['Raw <Strong>'], 'practice': ['Raw <Practice>'], 'next_step': 'Raw <Step>'}
        app = {'company': 'A&B <Labs>', 'title': 'Raw role', 'via': '', 'url': 'https://fictional.test/job'}
        merged = {'filled': [{'label': 'Raw <label>', 'value': 'Raw <value>'}], 'differs': [{'label': 'Raw <label2>', 'value': 'Raw <call>', 'current': 'Raw <record>'}]}
        before = json.dumps(merged)
        message = interviews_blocks.message(review, app, 'https://fictional.test/?a=1&b=2', .123, truncated=True, merged=merged)
        self.assertEqual(json.dumps(merged), before)
        for locale in notification_language.LOCALES:
            sent, logged = [], []
            def fake_review(**kwargs):
                self.assertEqual(kwargs['note'], 'raw note')
                kwargs['send'](message)
                return 'Interview analysed again: canonical result'
            with mock.patch.dict(os.environ, {'JOBADABRA_NOTIFICATION_LANGUAGE': locale}, clear=True), \
                    mock.patch('src.telegram.credentials', return_value=('fake-token', '17')), \
                    mock.patch('src.telegram.deliver', side_effect=lambda *args, **kwargs: sent.append((args, kwargs))), \
                    mock.patch.object(daily_modes.interviews, 'run', side_effect=fake_review), \
                    mock.patch.object(daily_modes, 'log_ai_run', side_effect=lambda stores, run, args: logged.append(run)), \
                    mock.patch('builtins.print'):
                args = SimpleNamespace(mode='interview', file=None, send=True, note='raw note', job=app['url'], interview=None)
                self.assertEqual(daily_modes.interview_mode(args, SimpleNamespace(name='sqlite')), 0)
            self.assertEqual(logged[0]['headline'], 'Interview analysed again: canonical result')
            self.assertTrue(sent[0][1]['urgent'])
            shown = sent[0][1].get('display_text', str(message))
            self.assertIn(notification_language.render('interview.title', locale=locale), shown)
            self.assertIn(notification_language.render('interview.truncated', locale=locale), shown)
            self.assertIn('Raw &lt;Summary&gt;', shown)
            self.assertIn('Raw &lt;Better&gt;', shown)
            self.assertIn('Raw &lt;call&gt;', shown)
            self.assertIn('Raw &lt;record&gt;', shown)
            self.assertIn('$0.123', shown)


    def test_explicit_cost_pause_keeps_raw_error_and_unprojected_diagnostics(self):
        for cli in (False, True):
            error = RuntimeError('Raw <Provider> {count}')
            error.ai_limit = cli
            for kind, what in [('interview', 'the interview review'), ('insight', 'the insight report'), ('weekly', 'the weekly report')]:
                canonical = cost.limit_message(error, what)
                message = cost.limit_message(error, what, notice=kind)
                self.assertEqual(str(message), canonical)
                for locale in notification_language.LOCALES:
                    shown, _ = notification_language.projection(message, locale=locale)
                    self.assertIn(notification_language.render('limit.' + ('cli.' if cli else 'api.') + kind, {'error': escape(str(error)), 'retry': ''}, locale=locale), shown)
                    if cli:
                        self.assertIn('Raw &lt;Provider&gt; {count}', shown)
            with mock.patch.dict(os.environ, {'JOBADABRA_NOTIFICATION_LANGUAGE': 'ru'}):
                self.assertEqual(cards.delivery(cost.limit_message(error, 'Operational check')), {})


    def test_actual_track_link_callback_keeps_store_fields_and_canonical_log(self):
        stores = memory.open_store()
        meta = {'title': 'Raw <Role> {count}', 'company': 'A&B <Labs>', 'description': 'Raw posting text'}
        sent, logs = [], []
        args = SimpleNamespace(mode='add', job='https://fictional.test/job', note='2026-11-07', job_title=None,
            job_company=None, job_text=None, origin=None, from_app=False, send=True, db='fake-db')
        with mock.patch.dict(os.environ, {'JOBADABRA_NOTIFICATION_LANGUAGE': 'ru'}, clear=True), \
                mock.patch.object(daily_modes.ledger, 'page_meta', return_value=dict(meta)), \
                mock.patch.object(daily_modes.added, 'process', return_value=None), \
                mock.patch.object(ledger_store, 'record', return_value=(None, 'recorded')), \
                mock.patch.object(daily_modes.store, 'connect'), mock.patch.object(daily_modes.store, 'track_applied') as track, \
                mock.patch.object(daily_modes, 'queue_mail_check'), mock.patch.object(daily_modes, 'log_store_job'), \
                mock.patch.object(daily_modes, 'log_ai_run', side_effect=lambda stores, run, args, **kwargs: logs.append(run)), \
                mock.patch('src.telegram.credentials', return_value=('fake-token', '17')), \
                mock.patch('src.telegram.deliver', side_effect=lambda *args, **kwargs: sent.append((args, kwargs))), \
                mock.patch('builtins.print'):
            self.assertEqual(daily_modes.add_link_mode(args, stores), 0)
        row = stores.applications.get(args.job)
        self.assertEqual((row['stage'], row['title'], row['company'], row['applied_on']), ('Applied', meta['title'], meta['company'], '2026-11-07'))
        self.assertEqual(track.call_args.args[1], args.job)
        self.assertIn('Tracked:', logs[0]['headline'])
        message = sent[0][0][0]
        for locale in notification_language.LOCALES:
            shown, _ = notification_language.projection(message, locale=locale)
            self.assertIn('Raw &lt;Role&gt; {count}', shown)
            self.assertIn('A&amp;B &lt;Labs&gt;', shown)
            self.assertIn('2026-11-07', shown)
        self.assertNotEqual(sent[0][1]['display_text'], str(message))


    def test_actual_pasted_message_receipt_keeps_state_ai_reads_and_english_records(self):
        from tests.unit.ai.test_inbox import Inbox, row, job, reading, Client, NOW
        from tests.mail_fakes import stores_for
        tracker = Inbox([row('p1', 'https://fictional.test/1', 'Raw <Role>', 'A&B <Labs>')],
                        [job('https://fictional.test/1', 'Raw <Role>', 'A&B <Labs>', 'Applied')])
        client = Client(reading('Rejected', 0, summary='Raw <AI> {count}'))
        message = daily_modes.inbox.log(stores_for(tracker), text='Fictional rejection message: thank you for applying; we will not proceed with your application.', client=client, now=NOW)
        self.assertEqual(len(client.calls), 1)
        self.assertIn(('p1', {'Stage': {'select': {'name': 'Rejected'}}}), tracker.updates)
        self.assertTrue(str(message).startswith('❌ Updated:'))
        sent = []
        with mock.patch.dict(os.environ, {'JOBADABRA_NOTIFICATION_LANGUAGE': 'ru'}, clear=True), \
                mock.patch.object(daily_modes.inbox, 'log', return_value=message), \
                mock.patch.object(daily_modes.added, 'hook', return_value=None), \
                mock.patch.object(daily_modes, 'queue_mail_check'), mock.patch.object(daily_modes, 'log_ai_run'), \
                mock.patch('src.telegram.credentials', return_value=('fake-token', '17')), \
                mock.patch('src.telegram.deliver', side_effect=lambda *args, **kwargs: sent.append((args, kwargs))), \
                mock.patch('builtins.print'):
            args = SimpleNamespace(mode='add', file=None, from_app=False, send=True, propose=False, reading=None,
                                   note='Fictional rejection message', action=None, target=None, db='fake-db')
            self.assertEqual(daily_modes.add_message_mode(args, SimpleNamespace(name='sqlite')), 0)
        canonical = sent[0][0][0]
        self.assertEqual(str(canonical), escape(str(message)))
        for locale in notification_language.LOCALES:
            shown, _ = notification_language.projection(canonical, locale=locale)
            self.assertIn('A&amp;B &lt;Labs&gt;', shown)
            self.assertNotIn('A&amp;amp;B', shown)
            self.assertIn('Raw &lt;AI&gt; {count}', shown)
        self.assertEqual(len(client.calls), 1)


    def test_all_literal_authored_producer_keys_are_registered(self):
        import ast
        root = Path(__file__).resolve().parents[3]
        files = ['src/focus.py', 'src/trial.py', 'src/doctor.py', 'src/notification_notices.py', 'src/daily_helpers.py',
                 'src/daily_modes.py', 'src/ledger_store.py', 'src/scout.py', 'src/ai/insights.py', 'src/ai/insights_text.py',
                 'src/ai/interviews_blocks.py', 'src/ai/mail.py', 'src/ai/mail_calendar.py', 'src/ai/mail_inbox.py',
                 'src/ai/mail_leads.py', 'src/ai/mail_lines.py', 'src/ai/rejection.py', 'src/ai/inbox.py',
                 'src/ai/inbox_events.py', 'src/ai/inbox_fields.py', 'src/ai/inbox_notion.py', 'src/ai/opportunity.py']
        def keys_of(node):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                yield node.value
            elif isinstance(node, ast.IfExp):
                yield from keys_of(node.body)
                yield from keys_of(node.orelse)
        for file in files:
            for call in ast.walk(ast.parse((root / file).read_text())):
                if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and call.func.attr == 'words' and call.args:
                    for key in keys_of(call.args[0]):
                        for locale in notification_language.LOCALES:
                            self.assertNotEqual(notification_language.render(key, locale=locale), key, (file, locale, key))


if __name__ == '__main__':
    unittest.main()
