"""An application is written from the posting: a job the crawl has no text for gets it from the store, else from one read of its page the AI
judged one posting, else it stops and says why.
Why (5 Nov 2026): Apply now prepares on this computer, and a job missing from the local copy was drafted with an empty Posting, with no warning."""
import io
import sqlite3
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src import daily, daily_modes, store as job_store
from src.ai import kit, prep
from src.notion import client as notion
from src.sources import ats, describe, one_posting
from tests.unit.stores.test_kit import FakeClient, memory_stores, opener

URL = 'https://careers.birch-fixture.example/roles/42'
JOB = {'url': URL, 'title': 'Analyst', 'company': 'Birch', 'location': 'Zurich'}
NOW = datetime(2026, 11, 5, 12, tzinfo=timezone.utc)
PAGE = 'Birch runs the payments platform for Swiss banks.'
SAVED = 'You will run the payments platform and its on-call rota. ' * 5   # over prep.MIN_POSTING: a description


def draft(stores, crawl=None, read='', client=None, verdict='one_posting', url=URL, live=None):
    """Prepares the job, the AI's verdict on a read page being `verdict`; -> (the text sent to the AI, how many page reads, what the run printed)."""
    client = client or FakeClient()
    with tempfile.TemporaryDirectory() as tmp, mock.patch('src.sources.describe.read_posting', return_value=read) as reading, \
            mock.patch('src.ai.decide.one', return_value=verdict), mock.patch('src.sources.ats.posting', return_value=live):
        with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
            if crawl is not None:
                job_store.import_watch_report(db, {'jobs': [{'id': '1', 'description': crawl, **JOB, 'url': url}]})
            printed = io.StringIO()
            with redirect_stdout(printed):
                daily.prepare_kit(db, notion.job_code(url), stores, client, 'claude-sonnet-5-5', opener)
    return client.requests[0]['messages'][0]['content'], reading.call_count, printed.getvalue()


def tracked(text='', url=URL, section='🧾 Job description'):
    """A store holding the job, with this text saved in this section."""
    stores = memory_stores()
    made = stores.applications.create({**JOB, 'url': url}, 'Saved')
    if text:
        stores.applications.set_section(made['id'], section, text)
    return stores


class PostingOfAKit(unittest.TestCase):
    def test_a_crawled_posting_is_used_and_no_page_is_read(self):
        sent, reads, _ = draft(tracked(), crawl='Crawled text about the role.')
        self.assertIn('Crawled text about the role.', sent)
        self.assertEqual(reads, 0)

    def test_a_job_only_in_the_store_is_written_from_the_text_saved_on_it(self):
        sent, reads, _ = draft(tracked(SAVED))
        self.assertIn(SAVED.strip(), sent)
        self.assertEqual(reads, 0)

    def test_a_saved_message_is_not_a_posting_so_the_page_is_read(self):
        sent, reads, _ = draft(tracked('Call me on Tuesday.', section='🤝 Recruiter message'), read=PAGE)
        self.assertIn(PAGE, sent)
        self.assertEqual(reads, 1)

    def test_a_saved_message_with_no_readable_page_stops_the_job(self):
        client = FakeClient()
        with self.assertRaises(kit.NoPosting):
            draft(tracked('Call me on Tuesday.', section='🤝 Recruiter message'), client=client)
        self.assertEqual(client.requests, [])

    def test_a_recruiter_message_that_says_enough_is_the_posting(self):
        sent, reads, _ = draft(tracked(SAVED, section='🤝 Recruiter message'))
        self.assertIn(SAVED.strip(), sent)
        self.assertEqual(reads, 0)

    def test_a_job_missing_from_the_crawl_reads_its_page_once(self):
        sent, reads, _ = draft(tracked(), read=PAGE)
        self.assertIn(PAGE, sent)
        self.assertEqual(reads, 1)

    def test_a_crawled_job_that_came_without_text_reads_its_page_too(self):
        sent, reads, _ = draft(tracked(), crawl='', read=PAGE)
        self.assertIn(PAGE, sent)
        self.assertEqual(reads, 1)

    def test_no_text_anywhere_stops_the_job_with_no_ai_call_and_no_kit(self):
        stores, client = tracked(), FakeClient()
        with self.assertRaises(kit.NoPosting):
            draft(stores, client=client)
        self.assertEqual(client.requests, [])
        self.assertEqual(stores.applications.get(URL)['stage'], 'Saved')

    def test_a_page_the_ai_did_not_judge_one_posting_stops_the_job(self):
        for verdict in ('other', None):   # a closed job's page or a cookie notice; a busy AI or no AI: not judged = not read on a guess
            client = FakeClient()
            with self.assertRaises(kit.NoPosting):
                draft(tracked(), read=PAGE, verdict=verdict, client=client)
            self.assertEqual(client.requests, [], verdict)

    def test_a_job_known_only_from_job_matches_reads_its_page(self):
        """An unfinished search: the row reached the store's matches, the local crawl has no such job and no application exists yet."""
        stores = memory_stores()
        stores.matches.upsert({**JOB, 'fit': 70, 'status': 'Open'})
        sent, reads, _ = draft(stores, read=PAGE)
        self.assertIn(PAGE, sent)
        self.assertEqual(reads, 1)

    def test_a_job_only_in_job_matches_with_nothing_readable_stops(self):
        stores, client = memory_stores(), FakeClient()
        stores.matches.upsert({**JOB, 'fit': 70, 'status': 'Open'})
        with self.assertRaises(kit.NoPosting):
            draft(stores, client=client)
        self.assertEqual(client.requests, [])

    def test_a_board_that_answers_with_no_text_is_followed_by_its_page(self):
        """Workable, SmartRecruiters, Workday and Join list a job with no description: the board read fine, so nothing refused the page."""
        board = 'https://boards.greenhouse.io/birch-fixture/jobs/42'
        listed = {'id': '42', 'url': board, 'title': 'Analyst', 'location': 'Zurich', 'description': ''}
        sent, reads, _ = draft(tracked(url=board), read=PAGE, url=board, live=listed)
        self.assertIn(PAGE, sent)
        self.assertEqual(reads, 1)

    def test_a_stopped_job_asks_nothing_more_of_the_site(self):
        with mock.patch.object(kit, 'form_questions') as questions, self.assertRaises(kit.NoPosting):
            draft(tracked())
        questions.assert_not_called()

    def test_a_stop_writes_nothing_to_the_store(self):
        """A mark would bring a dismissed job back, and put a job nobody saved first in every later batch (apply.js best: saved first)."""
        for stage in ('Dismissed', 'Kit ready', 'Applying'):
            stores = memory_stores()
            stores.applications.create(JOB, stage)
            with self.assertRaises(kit.NoPosting):
                draft(stores)
            self.assertEqual(stores.applications.get(URL)['stage'], stage)
        nobody = memory_stores()
        with self.assertRaises(kit.NoPosting):
            draft(nobody, crawl='')
        self.assertIsNone(nobody.applications.get(URL))

    def test_what_a_person_pastes_after_a_stop_is_written_from_whatever_its_length(self):
        for pasted in ('Analyst for the payments team at Birch, Zurich. Python, Postgres and on-call, four days a week, hybrid.',
                       'Birch is a registered bank in Zurich and this analyst role runs its payments platform and on-call rota. ' * 8,
                       'Read about the analyst role at https://careers.birch-fixture.example/about and how the team works day to day. ' * 8):
            stores = tracked()
            self.assertTrue(prep.describe(stores, stores.applications.get(URL), text=pasted)['ok'])
            sent, reads, _ = draft(stores)
            self.assertIn('payments' if 'payments' in pasted else 'analyst role', sent)
            self.assertEqual(reads, 0)

    def test_a_short_description_already_saved_is_not_a_dead_end(self):
        """The Description tab shows saved text with no Paste button, so a stop here could never be cleared."""
        sent, reads, _ = draft(tracked('Short saved role note.'))
        self.assertIn('Short saved role note.', sent)
        self.assertEqual(reads, 0)

    def test_the_words_of_the_stop_name_the_way_that_exists(self):
        self.assertIn('Description tab', kit.NO_POSTING)
        self.assertNotIn('Log job activity', kit.NO_POSTING)

    def test_draft_itself_refuses_an_empty_posting(self):
        client = FakeClient()
        for empty in ('', '   \n', None):
            with self.assertRaises(kit.NoPosting):
                kit.draft(client, 'claude-sonnet-5-5', {**JOB, 'description': empty}, 'Profile', 'Answers', [])
        self.assertEqual(client.requests, [])

    def test_prepare_top_matches_counts_such_a_job_as_failed_and_goes_on(self):
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db, redirect_stdout(io.StringIO()) as printed:
            summary, drafted = kit.auto_run(db, [{'id': 7, 'fit': {'score': 90}, 'description': '', **JOB}], memory_stores(), 'claude-sonnet-5-5', 1, 0, client=FakeClient(), opener=opener)
        self.assertEqual(drafted, [])
        self.assertIn('1 failed', summary)
        self.assertIn('NoPosting', printed.getvalue())


class PrepareRun(unittest.TestCase):
    def run_it(self, error, stores=None):
        args = SimpleNamespace(job='ab12cd34', db=':memory:', send=False, log_run=True)
        with mock.patch('src.daily_modes.prepare_kit', side_effect=error), mock.patch('src.daily_modes._gate'), redirect_stdout(io.StringIO()) as printed:
            return daily_modes.prepare_mode(args, stores or memory_stores()), printed.getvalue().strip().splitlines()

    def test_a_stopped_job_ends_on_its_own_code_and_the_reason_in_words(self):
        code, lines = self.run_it(kit.NoPosting(kit.NO_POSTING))
        self.assertEqual(code, kit.JOB_STOPPED)
        self.assertEqual(lines[-1], f'⚠️ {kit.NO_POSTING}')

    def test_the_run_row_says_it_stopped_and_why_never_done(self):
        stores = memory_stores()
        self.run_it(kit.NoPosting(kit.NO_POSTING), stores)
        row = stores.cron_runs.list()[0]
        self.assertNotIn('done', str(row.get('summary')).lower())
        self.assertIn('posting could not be read', str(row))
        self.assertEqual(row['status'], 'Failed')

    def test_a_real_press_on_a_job_with_no_text_ends_on_the_stop_code_and_the_words(self):
        stores = memory_stores()
        stores.matches.upsert({**JOB, 'fit': 70, 'status': 'Open'})
        with tempfile.TemporaryDirectory() as tmp, mock.patch('src.sources.describe.read_posting', return_value=''), mock.patch('src.daily_modes._gate'), \
                redirect_stdout(io.StringIO()) as printed:
            args = SimpleNamespace(job=notion.job_code(URL), db=str(Path(tmp) / 'jobs.sqlite'), send=False, log_run=True)
            code = daily_modes.prepare_mode(args, stores)
        self.assertEqual(code, kit.JOB_STOPPED)
        self.assertEqual(printed.getvalue().strip().splitlines()[-1], f'⚠️ {kit.NO_POSTING}')

    def test_any_other_failure_is_not_taken_for_it(self):
        with self.assertRaises(RuntimeError):
            self.run_it(RuntimeError('the AI is down'))


class Judged(unittest.TestCase):
    """The search's own question, asked of a page read at an Apply press."""

    def judged(self, verdict):
        with mock.patch('src.ai.decide.one', return_value=verdict) as asked:
            return one_posting.is_one({**JOB, 'description': PAGE}), asked.call_args.args

    def test_only_a_yes_is_a_posting(self):
        self.assertEqual([self.judged(verdict)[0] for verdict in ('one_posting', 'other', None)], [True, False, False])

    def test_it_is_the_search_s_question_with_the_job_s_title_and_the_page_s_text(self):
        topic, key, text, answers, task = self.judged('one_posting')[1]
        self.assertEqual((topic, key, answers, task), (one_posting.TOPIC, URL, one_posting.ANSWERS, one_posting.TASK))
        self.assertIn('Analyst', text)
        self.assertIn(PAGE, text)


    def test_its_answer_is_kept_nowhere_so_the_job_cache_stays_alone(self):
        with mock.patch('src.ai.decide.one', return_value='other') as asked:
            one_posting.is_one({**JOB, 'description': PAGE})
        self.assertIsInstance(asked.call_args.kwargs['db'], sqlite3.Connection)


class OneRefusalRecord(unittest.TestCase):
    """A board's 403, a page's 403 and Fetch original share one week-long record, on a real file."""

    BOARD = 'https://acme-fixture.wd3.myworkdayjobs.com/en-US/careers/job/Zurich/Analyst_R42'

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(folder.name)), mock.patch.object(describe.read_routes, 'record'),
                      mock.patch('src.sources.visits.pool_facts', return_value={})):
            patch.start()
            self.addCleanup(patch.stop)

    def press(self, board):
        # The board's list read (ats.ONE_JOB emptied): a Workday link is otherwise read as one job, tests/unit/sources/test_ats_one_job.py.
        with mock.patch.object(ats, 'ONE_JOB', {}), mock.patch.object(ats, '_board', side_effect=board) as asked, \
                mock.patch.object(describe, 'fetch', return_value=PAGE) as fetched:
            found = ats.posting(self.BOARD)
            return found, asked.call_count, describe.read_posting(self.BOARD), fetched.call_count

    def refused(self, *_):
        raise urllib.error.HTTPError(self.BOARD, 403, 'Forbidden', {}, None)

    def test_a_board_s_403_is_asked_once_and_never_again_this_week(self):
        self.assertEqual(self.press(self.refused), (None, 1, '', 0))
        self.assertEqual(self.press(self.refused), (None, 0, '', 0))

    def test_one_company_s_403_never_blocks_another_company_on_the_same_platform(self):
        """Greenhouse, Lever and Ashby serve every company from one job host, so a board's refusal is that board's alone (Gitar, #3314)."""
        ours = 'https://boards.greenhouse.io/birch-fixture/jobs/42'
        other = 'https://boards.greenhouse.io/alder-fixture/jobs/7'
        with mock.patch.object(ats, '_board', side_effect=self.refused) as asked:
            self.assertIsNone(ats.posting(ours))
            self.assertIsNone(ats.posting(ours))
        self.assertEqual(asked.call_count, 1)
        self.assertTrue(describe.refused_lately(ours))
        self.assertFalse(describe.refused_lately(other))
        with mock.patch.object(ats, '_board', return_value=()) as asked, mock.patch.object(describe, 'fetch', return_value=PAGE):
            ats.posting(other)
            self.assertEqual(describe.read_posting(other), PAGE)
        self.assertEqual(asked.call_count, 1)

    def test_a_board_s_refusal_is_not_counted_as_the_shared_host_s_route(self):
        with mock.patch.object(ats, '_board', side_effect=self.refused):
            ats.posting('https://boards.greenhouse.io/birch-fixture/jobs/42')
        describe.read_routes.record.assert_not_called()

    def test_a_board_that_failed_another_way_leaves_the_page_readable(self):
        def down(*_):
            raise TimeoutError('slow')
        self.assertEqual(self.press(down), (None, 1, PAGE, 1))

    def test_fetch_original_does_not_ask_a_host_that_refused(self):
        describe.keep_refusal(URL, describe.Refused('HTTP 403'))
        stores = tracked()
        with mock.patch('src.ai.prep.ledger.page_meta') as read:
            said = prep.describe(stores, stores.applications.get(URL), url=URL)
        self.assertFalse(said['ok'])
        read.assert_not_called()


class ReadPosting(unittest.TestCase):
    """The limits of the search's own reads hold for a read from one Apply press."""

    def read(self, url=URL, fetched=PAGE, refused=None, closed=False):
        refused = {} if refused is None else refused
        with mock.patch.object(describe, 'fetch', side_effect=fetched if isinstance(fetched, Exception) else None, return_value=fetched) as fetch, \
                mock.patch.object(describe, '_refused_hosts', return_value=refused), mock.patch.object(describe, '_keep_refused') as keep, \
                mock.patch('src.sources.visits.pool_facts', return_value={}), mock.patch.object(describe.read_routes, 'skip', return_value=closed), \
                mock.patch.object(describe.read_routes, 'record'):
            return describe.read_posting(url, NOW), fetch.call_count, keep

    def test_a_readable_page_gives_its_text(self):
        self.assertEqual(self.read()[:2], (PAGE, 1))

    def test_a_sign_in_site_is_never_read(self):
        self.assertEqual(self.read(url='https://www.linkedin.com/jobs/view/42')[:2], ('', 0))

    def test_a_host_that_refused_this_week_is_not_asked_again(self):
        host = 'careers.birch-fixture.example'
        self.assertEqual(self.read(refused={host: {'at': (NOW - timedelta(days=1)).isoformat(), 'why': 'HTTP 403'}})[:2], ('', 0))

    def test_a_site_other_installs_found_closed_is_not_asked(self):
        self.assertEqual(self.read(closed=True)[:2], ('', 0))

    def test_a_refusal_is_kept_for_the_week_and_read_once(self):
        text, reads, keep = self.read(fetched=describe.Refused('HTTP 403'))
        self.assertEqual((text, reads), ('', 1))
        self.assertIn('careers.birch-fixture.example', keep.call_args.args[0])

    def test_a_board_s_own_refused_code_is_kept_for_the_week_too(self):
        text, reads, keep = self.read(fetched=urllib.error.HTTPError(URL, 403, 'Forbidden', {}, None))
        self.assertEqual((text, reads), ('', 1))
        self.assertIn('careers.birch-fixture.example', keep.call_args.args[0])

    def test_a_gone_page_or_a_slow_down_is_no_refusal(self):
        for code in (404, 429):
            text, reads, keep = self.read(fetched=urllib.error.HTTPError(URL, code, 'No', {}, None))
            self.assertEqual((text, reads), ('', 1), code)
            keep.assert_not_called()

    def test_a_failed_read_gives_no_text(self):
        self.assertEqual(self.read(fetched=TimeoutError('slow'))[:2], ('', 1))

    def test_a_broken_pool_file_gives_no_text_not_a_crash(self):
        with mock.patch('src.sources.visits.pool_facts', side_effect=ValueError('bad json')), redirect_stdout(io.StringIO()):
            self.assertEqual(describe.read_posting(URL, NOW), '')


if __name__ == '__main__':
    unittest.main()
