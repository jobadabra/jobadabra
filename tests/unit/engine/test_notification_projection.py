"""Explicit end-user transport projections preserve canonical message records and English operational calls with fake HTTP only."""
import io
import json
import os
import unittest
import urllib.parse
from unittest import mock
from src import telegram


class NotificationProjectionTests(unittest.TestCase):
    def setUp(self):
        self.before = list(telegram.MESSAGES)
        telegram.MESSAGES.clear()
        self.addCleanup(self.restore_messages)

    def restore_messages(self):
        telegram.MESSAGES[:] = self.before

    def deliver(self, call):
        requests, queued = [], []
        def fake_http(request, timeout=0):
            requests.append((request.full_url, urllib.parse.parse_qs(request.data.decode()), timeout))
            return io.BytesIO(b'{"ok":true}')
        with mock.patch.dict(os.environ, {'JOBADABRA_NOTIFICATION_LANGUAGE': 'ru', 'JOBADABRA_NOTIFY': 'telegram'}, clear=True), \
                mock.patch('src.telegram.notify.queue', side_effect=lambda *args: queued.append(args)), \
                mock.patch('src.telegram.urllib.request.urlopen', side_effect=fake_http):
            answer = call()
        return answer, requests, queued

    def test_explicit_display_only_changes_transport_and_email_queue_not_messages(self):
        canonical, shown = '<b>Job digest</b>\n1 new', '<b>Подборка вакансий</b>\n1 новая'
        markup = {'inline_keyboard': [[{'text': 'Next 2', 'callback_data': 'more:7:2'}]]}
        display_markup = {'inline_keyboard': [[{'text': 'Ещё 2', 'callback_data': 'more:7:2'}]]}
        answer, requests, queued = self.deliver(lambda: telegram.send(canonical, 'fictional-token', '17', markup, kind='matches',
            display_text=shown, display_reply_markup=display_markup))
        self.assertEqual(answer, {'ok': True})
        self.assertEqual(telegram.MESSAGES, [canonical])
        self.assertEqual(queued, [(shown, display_markup, False, 'matches')])
        fields = requests[0][1]
        self.assertEqual(fields['chat_id'], ['17'])
        self.assertEqual(fields['text'], [shown])
        self.assertEqual(json.loads(fields['reply_markup'][0]), display_markup)
        self.assertEqual(fields['parse_mode'], ['HTML'])
        self.assertEqual(fields['disable_web_page_preview'], ['true'])
        self.assertEqual(requests[0][2], 20)

    def test_unprojected_operational_call_stays_english_despite_user_language_env(self):
        canonical = 'CI build failed: Fictional {count} & <diagnostic>'
        markup = {'inline_keyboard': [[{'text': 'View build', 'url': 'https://fictional.test/run'}]]}
        _, requests, queued = self.deliver(lambda: telegram.send(canonical, 'fictional-token', '17', markup, urgent=True))
        self.assertEqual(requests[0][1]['text'], [canonical])
        self.assertEqual(json.loads(requests[0][1]['reply_markup'][0]), markup)
        self.assertEqual(queued, [(canonical, markup, True, 'activity')])
        self.assertEqual(telegram.MESSAGES, [canonical])

    def test_deliver_forwards_explicit_projection_and_original_return_contract(self):
        canonical, shown = 'Canonical user note', 'Fictional localized user note'
        answer, requests, queued = self.deliver(lambda: telegram.deliver(canonical, 'fictional-token', '17', display_text=shown))
        self.assertEqual(answer, {'ok': True})
        self.assertEqual(requests[0][1]['text'], [shown])
        self.assertEqual(queued, [(shown, None, False, 'activity')])
        self.assertEqual(telegram.MESSAGES, [canonical])


if __name__ == '__main__':
    unittest.main()
