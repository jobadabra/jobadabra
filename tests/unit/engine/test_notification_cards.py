"""Known authored card projections keep canonical strings, raw values and controls through fake end-user delivery only."""
from datetime import datetime, timezone
from html import escape
import json
import os
import unittest
from types import SimpleNamespace
from unittest import mock
from src import trial, focus, notification_language, notification_cards as cards


class NotificationCardsTests(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
