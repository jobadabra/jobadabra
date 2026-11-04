"""A confirmation the Gmail check could not place, answered "A new job" (src/ai/reassign.py _new_job): the job keeps what the AI read in the email.

gv's Google film (4 Nov 2026): the row read "Reply from <sender>", company and role N/A, under Inbound, not Applied. The company and role the AI had read
were dropped in two places: ask() (src/ai/mail_lines.py) kept them nowhere on the event, and _new_job built the job from the sender alone, always as a
recruiter's lead. Scenario: ask() with the AI's reading, then the person's answer."""
import tempfile
import unittest
from datetime import datetime, timezone

from src.ai import opportunity, reassign
from src.ai.mail_lines import ask
from src.notion import origin
from src.stores import memory, sqlite

NOW = datetime(2026, 11, 4, 9, 0, tzinfo=timezone.utc)
EMAIL = {'id': 'g1', 'from': 'Google Careers <no-reply@google.com>', 'subject': 'Thank you for applying to Google', 'date': '2026-11-04T08:00:00+01:00',
         'body': 'We received your application for Site Reliability Engineer.'}
READ = {'kind': 'Confirmation received', 'company': 'Google', 'role': 'Site Reliability Engineer', 'summary': 'Application received', 'relevant': True}


def asked(stores, email=EMAIL, result=READ):
    ask(stores, email, result, None, [set()], [], {})
    return stores.events.list()[0]


class NewJobKeepsTheReading(unittest.TestCase):
    def check(self, stores):
        question = asked(stores)
        self.assertTrue(reassign.move(stores, question['id'], reassign.NEW, now=NOW)['ok'])
        job = stores.applications.get('https://mail.google.com/mail/u/0/#all/g1')
        self.assertEqual((job['title'], job['company']), ('Site Reliability Engineer', 'Google'), 'the role and company the AI read')
        self.assertNotIn('Reply from', job['title'])
        # A confirmation is the person's own application: Outbound (under Applied), never a recruiter's lead under Inbound.
        self.assertEqual(origin.stored(job.get('origin')), origin.OUTBOUND)
        self.assertNotEqual(job['stage'], opportunity.LEAD_STAGE)
        self.assertEqual(job['applied_on'], '2026-11-04', 'the email\'s day: Focus waits-7-days and the week flag need it')
        return job

    def test_on_this_macs_store(self):
        with tempfile.TemporaryDirectory() as folder:
            self.check(sqlite.open_store({'JOBADABRA_DATA_DIR': folder}))

    def test_on_the_memory_store(self):
        self.check(memory.open_store())

    def test_a_real_sender_does_not_lose_the_role_either(self):
        stores = memory.open_store()
        email = {**EMAIL, 'from': 'Marta Keller <marta@fincruit.com>', 'subject': 'Your application', 'id': 'g2'}
        question = asked(stores, email, {**READ, 'kind': 'Interview scheduled', 'company': 'Fincruit', 'role': 'Finance Controller'})
        self.assertTrue(reassign.move(stores, question['id'], reassign.NEW, now=NOW)['ok'])
        job = stores.applications.get('https://mail.google.com/mail/u/0/#all/g2')
        self.assertEqual((job['title'], job['company']), ('Finance Controller', 'Fincruit'))

    def test_a_confirmation_that_names_only_the_employer_is_still_the_persons_application(self):
        stores = memory.open_store()
        question = asked(stores, EMAIL, {**READ, 'role': ''})
        self.assertTrue(reassign.move(stores, question['id'], reassign.NEW, now=NOW)['ok'])
        job = stores.applications.get('https://mail.google.com/mail/u/0/#all/g1')
        self.assertEqual((job['title'], job['company']), ('Application to Google', 'Google'))
        self.assertEqual(origin.stored(job.get('origin')), origin.OUTBOUND)

    def test_no_reading_stays_as_before(self):
        # Positive control for the old path: an email the AI could not name still becomes "Reply from <sender>".
        stores = memory.open_store()
        question = asked(stores, EMAIL, {**READ, 'company': '', 'role': ''})
        self.assertTrue(reassign.move(stores, question['id'], reassign.NEW, now=NOW)['ok'])
        job = stores.applications.get('https://mail.google.com/mail/u/0/#all/g1')
        self.assertEqual(job['title'], 'Reply from Google Careers')


if __name__ == '__main__':
    unittest.main()
