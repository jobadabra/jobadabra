"""Focus on the store on this Mac (src/focus.py load): its reads run in turn, since a sqlite connection refuses another thread, while a
store reached over the network (Notion, caps CLOUD) still reads side by side. 9 Oct 2026: Focus and Reports → Funnel failed on SQLite."""
import json
import tempfile
import threading
import unittest
from datetime import datetime, timezone

from src import focus
from src.stores import base, open_stores
from unittest.mock import patch
from tests.unit.notion.test_focus import NOW, row, event


class FocusOnTheStoreTests(unittest.TestCase):
    def test_focus_reads_a_sqlite_store_with_its_funnel(self):
        with tempfile.TemporaryDirectory() as tmp:
            stores = open_stores({'JOBADABRA_STORE': 'sqlite', 'JOBADABRA_DATA_DIR': tmp})
            self.assertNotIn(base.CLOUD, stores.caps)
            stores.applications.create({'url': 'https://jobs.test/a', 'title': 'SRE', 'company': 'Acme', 'applied_on': '2026-10-08'}, 'Applied')
            stores.applications.create({'url': 'https://jobs.test/b', 'title': 'SRE', 'company': 'Beta'}, 'Kit ready')
            result = focus.load(stores, target=5, now=datetime(2026, 10, 9, tzinfo=timezone.utc), gmail=False)
        steps = {step['step']: step['reached'] for step in result['funnel']['steps']}
        self.assertEqual(steps['📨 Applied'], 1)
        self.assertTrue(result['funnel']['summary'])

    def test_a_networked_store_still_reads_side_by_side(self):
        threads = set()
        class Entity:   # every read notes the thread it ran on
            def list(self, **_):
                threads.add(threading.get_ident())
                return []
        stores = base.Stores(name='fake', applications=Entity(), events=Entity(), matches=Entity(), interviews=Entity(), insights=Entity(),
                             employers=Entity(), agent_runs=Entity(), cron_runs=Entity(), texts=Entity(), caps=frozenset({base.CLOUD}))
        focus.load(stores, target=5, now=datetime(2026, 10, 9, tzinfo=timezone.utc), gmail=False)
        self.assertNotIn(threading.get_ident(), threads)


    def test_a_rejection_insight_names_its_job(self):
        """Its Suggestions entry opens the job's Review tab when there is no Notion page (renderer/suggestions.js open_rejection)."""
        with tempfile.TemporaryDirectory() as tmp:
            stores = open_stores({'JOBADABRA_STORE': 'sqlite', 'JOBADABRA_DATA_DIR': tmp})
            app = stores.applications.create({'url': 'https://jobs.test/r', 'title': 'SRE', 'company': 'Acme'}, 'Rejected')
            stores.applications.update(app['id'], {'rejection': 'Hard skills', 'rejection_lesson': 'Lead with Go. Then SLOs.'})
            found = focus.load(stores, target=5, now=datetime.now(timezone.utc), gmail=False)['suggestions']
        action, = [e for e in found if e['kind'] == 'rejection'][0]['actions']
        self.assertEqual((action['do'], action['url'], action['title'], action['company'], action['link']),
                         ('open_rejection', 'https://jobs.test/r', 'SRE', 'Acme', ''))



class FocusDisplayCopyTest(unittest.TestCase):
    def setUp(self):
        # These fictional notes never need a model/provider decision.
        booking = patch('src.focus.meanings.asks_to_book', return_value=False)
        booking.start()
        self.addCleanup(booking.stop)

    def test_json_carries_authored_copy_without_changing_raw_payload(self):
        import json
        raw = 'Northwind {company} <b>Привет</b>'
        data = focus.build([row('copy', raw, 'Engineer', stage='Saved')], [], now=NOW)
        payload = json.loads(json.dumps(data))
        item = next(item for item in payload['items'] if item['kind'] == 'apply')
        self.assertEqual(item['title'], 'Apply to 5 more jobs today')
        self.assertEqual(item['best'], [raw])
        self.assertEqual(item['displayCopy']['headline']['key'][:11], 'focusCards.')
        self.assertIn('summary', payload['displayCopy'])
        self.assertNotIn('kind', item['displayCopy'])
        self.assertNotIn('best', item['displayCopy'])

    def test_reply_copy_preserves_provider_note_and_identifiers(self):
        import json
        raw = 'Raw {who} <tag> Русский'
        data = focus.build([row('copy', raw, 'Engineer')],
                           [event('copy', 'Reply received', '2026-09-28T14:00:00Z', note=raw, source_id='fake-id')], now=NOW)
        payload = json.loads(json.dumps(data))
        item = next(item for item in payload['items'] if item['kind'] == 'reply')
        self.assertEqual(item['company'], raw)
        self.assertEqual(item['detail'], 'They wrote today. ' + raw)
        self.assertEqual(item['link'], 'https://mail.google.com/mail/u/0/#all/fake-id')
        self.assertIn('detail', item['displayCopy'])
        self.assertNotIn('company', item['displayCopy'])

    def test_each_card_kind_has_authored_metadata_without_tagging_controls(self):
        from src.focus_items import _item, present
        from src.ui_copy import wire
        kinds = ('reply', 'book', 'offer', 'prepare', 'review', 'follow_up', 'nudge', 'feedback',
                 'feedback_wait', 'feedback_review', 'which_job', 'details', 'apply', 'happened', 'waiting')
        for kind in kinds:
            with self.subTest(kind=kind):
                original = _item(2, kind, 'x', 'Raw provider title', 'Raw provider detail',
                                 row('copy', 'Raw {who}', 'Raw role', stage='Screening'), quiet=3)
                item = json.loads(json.dumps(wire(present(original))))
                self.assertIn('badge', item['displayCopy'])
                self.assertNotIn('kind', item['displayCopy'])
                self.assertNotIn('stage', item['displayCopy'])
                self.assertEqual(item['kind'], kind)
                self.assertEqual(item['company'], 'Raw {who}')
                self.assertEqual(item['detail'], 'Raw provider detail')
                if kind not in ('which_job', 'waiting'):
                    self.assertIn('headline', item['displayCopy'])

    def test_stale_prep_detail_keeps_both_recipes_and_retention_warning_without_price(self):
        from tests.unit.notion.test_focus import reviewed_interview
        app = row('prep', 'Northwind', 'Engineer', stage='Interview scheduled',
                  interview='2026-09-29T12:00:00Z', Interview_prep='2026-09-24')
        data = focus.build([app], [], [reviewed_interview('prep', '2026-09-25')], now=NOW)
        item = next(item for item in data['items'] if item['kind'] == 'prepare')
        self.assertIn('build a new kit for this round', item['detail'])
        self.assertNotIn('$0.04', item['detail'])
        self.assertIn("the earlier one stays on the job's page", item['detail'])
        recipe = item['displayCopy']['detail']['join']
        self.assertEqual(len(recipe), 2)
        self.assertEqual(recipe[0]['key'], 'focusCards.build.m028')
        self.assertEqual(recipe[1]['key'], 'focusCards.build.m029')
        self.assertEqual(item['prep_why'], 'reviewed')

    def test_suggestions_keep_action_lists_keys_and_raw_evidence(self):
        from src import suggestions
        from src.ui_copy import wire
        raw = 'Raw {label} <b>Данные</b>'
        tune = suggestions.tune_entry({'ok': True, 'proposals': [
            {'id': 'x', 'kind': 'exclude_title', 'label': raw, 'why': raw},
            {'id': 'y', 'kind': 'drop_place', 'label': 'Elsewhere', 'why': raw}]})
        item = json.loads(json.dumps(wire(tune)))
        self.assertEqual(item['key'], 'tune:x|y')
        self.assertEqual(item['detail'], 'Leave out "' + raw + '" titles, drop Elsewhere')
        self.assertEqual(item['evidence'], [raw, raw])
        self.assertNotIn('evidence', item['displayCopy'])
        self.assertEqual(item['actions'][0]['do'], 'tune')
        self.assertIn('label', item['actions'][0]['displayCopy'])
        weekly = {'id': 'week', 'day': NOW.date().isoformat(), 'category': suggestions.WEEKLY,
                  'title': raw, 'fields': {}}
        entry = suggestions.week_entry([weekly], NOW, set())
        self.assertIsInstance(entry['actions'], list)
        self.assertEqual(entry['actions'][0]['do'], 'read_week')
        self.assertEqual(entry['title'], raw)

    def test_funnel_descriptors_leave_canonical_steps_and_notion_content_alone(self):
        from src.notion import funnel
        from src.ui_copy import wire
        steps = funnel.funnel([{'stage': 'Applied', 'seen': {'Applied'}}])
        displayed = wire(steps)
        self.assertEqual([step['step'] for step in displayed], [step[0] for step in funnel.STEPS])
        self.assertIn('step', displayed[0]['displayCopy'])
        self.assertNotIn('reached', displayed[0]['displayCopy'])
        self.assertIn('advice', displayed[1]['displayCopy'])
        persisted = json.dumps(funnel.blocks(steps, 'fictional date'))
        self.assertNotIn('displayCopy', persisted)
        self.assertIn('Drafted kits are piling up unsent.', json.dumps(steps))


if __name__ == '__main__':
    unittest.main()
