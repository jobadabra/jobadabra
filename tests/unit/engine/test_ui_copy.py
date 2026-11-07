"""Guard: data — UI localization retains canonical Focus fields, raw values and control identities."""
import json
import unittest

from src.ui_copy import text, join, wire


class UiCopyTests(unittest.TestCase):
    def test_wire_keeps_canonical_fields_and_captures_only_authored_parts(self):
        raw = 'Apply to your next role. {count} <raw>'
        title = text('focusCards.reply', 'Reply to {who}', {'who': raw})
        item = {'kind': 'reply', 'stage': 'Applied', 'title': title,
                'meta': [raw, text('focusCards.today', 'today')],
                'actions': [{'do': 'apply', 'value': raw}]}
        packed = json.loads(json.dumps(wire(item)))
        self.assertEqual(packed['title'], 'Reply to ' + raw)
        self.assertEqual(packed['kind'], 'reply')
        self.assertEqual(packed['stage'], 'Applied')
        self.assertEqual(packed['actions'], item['actions'])
        self.assertEqual(packed['displayCopy']['title']['key'], 'focusCards.reply')
        self.assertEqual(packed['displayCopy']['title']['values']['who'], {'value': raw})
        self.assertNotIn('displayCopy', item)

    def test_nested_copy_and_raw_variables_are_snapshots_and_interpolated_once(self):
        who = text('focusCards.recruiter', 'the recruiter')
        value = text('focusCards.reply', 'Reply to {who}', {'who': who})
        combined = join(' · ', [value, '{who}'])
        self.assertEqual(str(combined), 'Reply to the recruiter · {who}')
        packed = wire({'summary': combined})
        self.assertEqual(packed['summary'], str(combined))
        self.assertEqual(packed['displayCopy']['summary']['join'][0]['values']['who']['key'], 'focusCards.recruiter')


if __name__ == '__main__':
    unittest.main()
