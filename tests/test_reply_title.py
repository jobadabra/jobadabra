"""A job an email introduces is never titled with the email's subject (owner, 2 Nov 2026: a Windows tester's Jobs list showed
"RE: Keeping in Touch – Finance Opportunities in Switzerland" as a job with no company). Writers: src/ai/mail_leads.py interview_lead,
src/ai/reassign.py _new_job; the shared title: src/ai/opportunity.py reply_title."""
import tempfile
import unittest
from unittest import mock

from src.ai import mail_leads, opportunity
from src.stores import sqlite

SUBJECT = 'RE: Keeping in Touch – Finance Opportunities in Switzerland'
EMAIL = {'id': 'h9', 'from': 'Marta Keller <marta@fincruit.com>', 'subject': SUBJECT, 'date': '2026-10-24T09:00:00+00:00',
         'body': 'Thanks for coming back to me. Let us talk next week.'}


class ReplyTitleTests(unittest.TestCase):
    def test_who_wrote_never_the_subject(self):
        self.assertEqual(opportunity.reply_title('Fincruit', 'Marta Keller'), 'Reply from Fincruit')
        self.assertEqual(opportunity.reply_title('', 'Marta Keller'), 'Reply from Marta Keller')
        self.assertEqual(opportunity.reply_title('', ''), 'Email reply')
        self.assertEqual(opportunity.label({'title': 'Reply from Fincruit', 'recruiter_company': 'Fincruit'}), 'Reply from Fincruit')   # never "… via Fincruit" twice

    def test_an_interview_email_with_no_role_is_titled_by_sender_and_keeps_its_subject_in_the_note(self):
        with tempfile.TemporaryDirectory() as folder:
            stores = sqlite.open_store({'JOBADABRA_DATA_DIR': folder})
            with mock.patch.object(opportunity, 'extract', return_value={}):
                row = mail_leads.interview_lead(stores, None, 'm', EMAIL, [], {'role': ''}, {})
            self.assertIsNotNone(row)
            job = stores.applications.get(row['url'])
            self.assertEqual(job['title'], 'Reply from Fincruit')
            self.assertNotIn('Keeping in Touch', job['title'])
            notes = [e['note'] for e in stores.events.list(app_id=job['id'])]
            self.assertTrue(any(SUBJECT in note for note in notes), notes)   # the subject stays where it belongs: the event's note

    def test_a_role_the_ai_read_still_wins(self):
        with tempfile.TemporaryDirectory() as folder:
            stores = sqlite.open_store({'JOBADABRA_DATA_DIR': folder})
            with mock.patch.object(opportunity, 'extract', return_value={'title': 'Audit Manager', 'company': 'PwC'}):
                row = mail_leads.interview_lead(stores, None, 'm', EMAIL, [], {'role': ''}, {})
            self.assertEqual(stores.applications.get(row['url'])['title'].split(' · ')[0], 'Audit Manager')


if __name__ == '__main__':
    unittest.main()
