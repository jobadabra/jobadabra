"""Actual digest fixtures and fake delivery localize only outbound snapshots without changing reads, records, raw values or callbacks."""
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
import urllib.parse
from unittest import mock
from html import escape
from src import daily_search_reporting, digest, digest_render, notification_language, notify, store, telegram


class DigestNotificationLanguageTests(unittest.TestCase):
    def setUp(self):
        self.saved_messages = list(telegram.MESSAGES)
        telegram.MESSAGES.clear()
        self.addCleanup(lambda: telegram.MESSAGES.__setitem__(slice(None), self.saved_messages))
        self.forbidden = []
        patcher = mock.patch('urllib.request.urlopen', side_effect=lambda *args, **kwargs: self.blocked('unexpected network'))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(lambda: self.assertEqual(self.forbidden, [], 'forbidden calls checked outside production catches'))

    def blocked(self, kind):
        self.forbidden.append(kind)
        raise AssertionError(kind)

    def build(self, count=2, page=1):
        raw_title = 'Fictional <Platform> & {count} Keychain ⌘K'
        raw_company = 'A&B <Labs> {first}'
        jobs = [{'id': str(i), 'company': raw_company, 'title': raw_title, 'location': 'Zurich {total}',
                 'work_mode': 'Hybrid (stated)', 'url': f'https://fictional.test/{i}?x="a"&name={{count}}'} for i in range(count)]
        with tempfile.TemporaryDirectory() as tmp, store.connect(Path(tmp) / 'jobs.sqlite') as db:
            store.import_watch_report(db, {'jobs': jobs})
            with mock.patch.object(digest, 'eligible_jobs', wraps=digest.eligible_jobs) as reads, \
                    mock.patch.object(digest.score, 'load', wraps=digest.score.load) as scores:
                result = digest.build_digest(db, page=page, seed=7)
            self.assertEqual(reads.call_count, 1)
            self.assertEqual(scores.call_count, 1)
        return result, jobs

    def test_all_seven_languages_project_frozen_real_digest_with_no_more_reads(self):
        (messages, new_count, keyboards), jobs = self.build()
        canonical = str(messages[0])
        original_json = json.dumps(messages, ensure_ascii=False)
        self.assertEqual(new_count, 2)
        self.assertIn('2 new', canonical)
        self.assertIn(escape(jobs[0]['title']), canonical)
        with mock.patch.object(digest, 'eligible_jobs', side_effect=lambda *args: self.blocked('store reread')), \
                mock.patch.object(digest.score, 'load', side_effect=lambda *args: self.blocked('score reread')):
            for locale in notification_language.LOCALES:
                shown, keyboard = digest.notification_projection(messages[0], keyboards[0], locale)
                self.assertIn(notification_language.render('digest.title', locale=locale), shown)
                self.assertIn(escape(jobs[0]['title']), shown)
                self.assertIn(escape(jobs[0]['company']), shown)
                self.assertIn('href="' + escape(jobs[0]['url'], quote=True) + '"', shown)
                self.assertNotIn('&amp;lt;', shown)
                self.assertEqual(keyboard, keyboards[0])
                if locale == 'en':
                    self.assertEqual(shown, canonical)
                else:
                    self.assertNotEqual(shown, canonical)
        self.assertEqual(json.dumps(messages, ensure_ascii=False), original_json)
        self.assertEqual(json.dumps(messages[0]), json.dumps(canonical))
        with self.assertRaises(AttributeError):
            messages[0]._snapshot = ()

    def test_counts_and_paging_keep_callback_ids_and_localize_fixed_next_caption(self):
        (messages, _, keyboards), _ = self.build(21)
        for locale in notification_language.LOCALES:
            shown, keyboard = digest.notification_projection(messages[0], keyboards[0], locale)
            self.assertIn(notification_language.render('digest.new', locale=locale, count=21), shown)
            self.assertEqual([[b['callback_data'] for b in row] for row in keyboard['inline_keyboard']],
                             [[b['callback_data'] for b in row] for row in keyboards[0]['inline_keyboard']])
            self.assertEqual(keyboard['inline_keyboard'][-1][0]['callback_data'], 'more:7:2')
            self.assertEqual(keyboard['inline_keyboard'][-1][0]['text'], notification_language.render('digest.next', locale=locale, count=10))
        (empty, _, empty_keys), _ = self.build(1, page=2)
        for locale in notification_language.LOCALES:
            shown, markup = digest.notification_projection(empty[0], empty_keys[0], locale)
            self.assertIn(notification_language.render('digest.noMore', locale=locale), shown)
            self.assertIsNone(markup)

    def test_zero_one_two_five_twenty_one_and_romanian_nineteen_twenty(self):
        for count in (0, 1, 2, 5, 19, 20, 21):
            (messages, _, keyboards), _ = self.build(count)
            for locale in notification_language.LOCALES:
                shown, _ = digest.notification_projection(messages[0], keyboards[0], locale)
                self.assertIn(notification_language.render('digest.new', locale=locale, count=count), shown)
        self.assertEqual(notification_language.render('digest.jobs', locale='ro', count=19), '19 posturi')
        self.assertEqual(notification_language.render('digest.jobs', locale='ro', count=20), '20 de posturi')

    def test_enriched_facts_are_frozen_and_raw_ai_reason_is_escaped_once(self):
        reason = 'Fictional <AI> & {count} reason'
        ai = {'english_is_enough': {'value': 'yes'}, 'languages': [{'language': 'Portuguese', 'level': 'required'}],
              'salary': {'stated': True, 'text': 'EUR 70-90k'}, 'employer_type': {'value': 'recruiter'},
              'seniority': {'value': 'senior'}, 'work_mode': {'value': 'remote'}, 'visa_sponsorship': {'value': 'offered'}}
        job = {'title': 'Fictional <Role>', 'company': 'A&B', 'url': '', 'location': '', 'saved': True,
               'ai': ai, 'fit': {'score': 87, 'reason': reason}}
        facts = digest._job_facts(1, job)
        ai['languages'].clear()
        job['fit']['reason'] = 'mutated'
        for locale in notification_language.LOCALES:
            shown = digest_render.render_job(facts, locale)
            self.assertIn(escape(reason), shown)
            self.assertNotIn('&amp;lt;', shown)
            self.assertIn('EUR 70-90k', shown)
            self.assertIn(notification_language.render('job.signal.sponsorshipOffered', locale=locale), shown)
            self.assertIn(notification_language.render('job.language.Portuguese', locale=locale), shown)
            self.assertIn(notification_language.render('job.saved', locale=locale), shown)
        job['fit']['reason'] = None
        self.assertIn('87/100', digest._job_block(1, job))
        with self.assertRaises(TypeError):
            notification_language.projected_text('canonical', job, lambda facts, locale: facts)

    def test_unknown_strings_have_no_render_identity_or_automatic_translation(self):
        raw = 'Job digest: Fictional employer {count} <not markup>'
        markup = {'inline_keyboard': [[{'text': 'Raw button', 'callback_data': 'canonical:id'}]]}
        shown, buttons = digest.notification_projection(raw, markup, 'ru')
        self.assertEqual(shown, raw)
        self.assertIs(buttons, markup)

    def test_real_reporting_send_preserves_messages_records_and_telegram_flags(self):
        (messages, _, keyboards), _ = self.build()
        requests = []
        def fake_http(request, timeout=0):
            requests.append((request.full_url, urllib.parse.parse_qs(request.data.decode()), timeout))
            return io.BytesIO(b'{"ok":true}')
        for locale in notification_language.LOCALES:
            requests.clear()
            with mock.patch.dict(os.environ, {'JOBADABRA_NOTIFICATION_LANGUAGE': locale, 'JOBADABRA_NOTIFY': 'telegram'}, clear=True), \
                    mock.patch('urllib.request.urlopen', side_effect=fake_http):
                self.assertIsNone(daily_search_reporting.send_messages(messages, keyboards, 'fictional-token', '17'))
            fields = requests[0][1]
            self.assertEqual(fields['chat_id'], ['17'])
            self.assertEqual(fields['parse_mode'], ['HTML'])
            self.assertEqual(fields['disable_web_page_preview'], ['true'])
            self.assertIn(notification_language.render('digest.title', locale=locale), fields['text'][0])
            self.assertEqual(telegram.MESSAGES[-1], str(messages[0]))

    def test_email_only_queues_projected_digest_and_keeps_canonical_messages(self):
        (messages, _, keyboards), _ = self.build()
        requests = []
        def fake_site(request, timeout=0):
            requests.append(json.loads(request.data))
            return io.BytesIO(b'{"ok":true}')
        for held in notify._QUEUE.values():
            held.clear()
        self.addCleanup(lambda: [held.clear() for held in notify._QUEUE.values()])
        with mock.patch.dict(os.environ, {'JOBADABRA_NOTIFICATION_LANGUAGE': 'ru', 'JOBADABRA_NOTIFY': 'email', 'JOBADABRA_TRIAL_KEY': 'fictional-install', 'JOBADABRA_SITE_URL': 'https://fictional.test'}, clear=True), \
                mock.patch('urllib.request.urlopen', side_effect=fake_site), mock.patch('src.notify.atexit.register'):
            self.assertIsNone(daily_search_reporting.send_messages(messages, keyboards, None, None))
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0]['subject'], 'Подборка вакансий')
        self.assertIn('Подборка вакансий', requests[0]['html'])
        self.assertEqual(requests[0]['mail'], 'app-matches')
        self.assertEqual(telegram.MESSAGES, [str(messages[0])])


if __name__ == '__main__':
    unittest.main()
