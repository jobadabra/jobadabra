"""The Jobs list on a store that is not Notion (src/desktop_store_jobs.py): Tracker.notion_jobs()'s shape from the store's matches
and applications, and src/desktop.py using it only when such a store is chosen."""
import io
import json
import unittest
from contextlib import redirect_stdout
from unittest import mock

from src import desktop
from src.desktop_store_jobs import store_jobs
from src.notion import client
from src.stores import memory


def notion_page(url, kind):
    rt = lambda value: {'rich_text': [{'plain_text': value}]}
    if kind == 'match':
        props = {'Job URL': {'url': url}, 'Job': {'title': [{'plain_text': 'SRE'}]}, 'Company': rt('Acme'), 'Score': {'number': 81},
                 'Status': {'select': {'name': 'Open'}}}
    else:
        props = {'Job URL': {'url': url}, 'Job': {'title': [{'plain_text': 'SRE'}]}, 'Company': rt('Acme'), 'Stage': {'select': {'name': 'Applied'}},
                 'Applied on': {'date': {'start': '2026-10-08'}}}
    return {'id': f'{kind}-1', 'url': f'https://notion.so/{kind}', 'created_time': '2026-10-01T00:00:00Z', 'properties': props}


class StoreJobsTests(unittest.TestCase):
    def stores(self):
        stores = memory.open_store()
        stores.matches.upsert({'url': 'https://jobs.test/a', 'title': 'SRE', 'company': 'Acme', 'fit': 81, 'reason': 'good',
                               'status': 'Open', 'first_seen': '2026-10-01', 'fit_detail': {'strengths': 's', 'gaps': 'g', 'parts': {'role_fit': 9}}})
        stores.matches.upsert({'url': 'https://jobs.test/b/', 'title': 'Platform', 'company': 'Beta', 'fit': 55, 'status': 'Open'})
        stores.applications.set_stage({'url': 'https://jobs.test/b', 'title': 'Platform', 'company': 'Beta'}, 'Applied', '2026-10-08')
        stores.applications.set_stage({'url': 'https://jobs.test/lead', 'title': 'Staff SRE', 'company': 'Gamma', 'fit': 70}, 'Recruiter lead')
        return stores

    def test_a_scored_match_and_an_application_appear_with_their_fit_and_stage(self):
        rows = {row['url']: row for row in store_jobs(self.stores())}
        self.assertEqual((rows['https://jobs.test/a']['fit'], rows['https://jobs.test/a'].get('stage')), (81, None))
        self.assertEqual(rows['https://jobs.test/a']['fit_detail']['parts'], {'role_fit': 9})
        merged = rows['https://jobs.test/b/']   # one row per job, whatever URL form each side keeps
        self.assertEqual((merged['fit'], merged['stage'], merged['applied_on'], merged['match_status']), (55, 'Applied', '2026-10-08', 'Open'))
        self.assertEqual((rows['https://jobs.test/lead']['stage'], rows['https://jobs.test/lead']['fit']), ('Recruiter lead', 70))
        self.assertEqual(len(rows), 3)

    def test_an_empty_score_is_none_not_a_weak_match(self):
        stores = memory.open_store()
        stores.applications.set_stage({'url': 'https://jobs.test/e', 'title': 'SRE', 'company': 'Acme', 'fit': ''}, 'Saved')
        self.assertIsNone(store_jobs(stores)[0]['fit'])   # SQLite keeps an unscored fit as '': the app would show "Weak match"

    def test_the_same_keys_as_notion_jobs(self):
        tracker = object.__new__(client.Tracker)
        pages = {None: [notion_page('https://jobs.test/a', 'match')], 'apps': [notion_page('https://jobs.test/b', 'app')]}
        with mock.patch.object(client, 'MATCHES_DATABASE_ID', 'matches-db'), \
                mock.patch.object(client.Tracker, '_query', lambda self, *args: pages[None] if args and args[1] == 'matches-db' else pages['apps'], create=True):
            from_notion = {row['url']: set(row) for row in tracker.notion_jobs()}
        from_store = {row['url']: set(row) for row in store_jobs(self.stores())}
        self.assertEqual(from_store['https://jobs.test/a'], from_notion['https://jobs.test/a'], 'a match alone')
        self.assertEqual(from_store['https://jobs.test/lead'], from_notion['https://jobs.test/b'], 'an application alone')

    def test_each_row_carries_its_stored_apply_check_on_both_stores(self):
        """Owner, 13 Nov 2026 ("Fix it in this PR"): a row keeps "Needs you" and "Account needed" after a restart, so the list carries the stored check (desktop/lib/apply-readiness.js reads it)."""
        stores = self.stores()
        stores.applications.update(stores.applications.get('https://jobs.test/lead')['id'], {'apply_readiness': '{"v": 1}'})
        rows = {row['url']: row for row in store_jobs(stores)}
        self.assertEqual((rows['https://jobs.test/lead']['apply_readiness'], rows['https://jobs.test/b/']['apply_readiness']), ('{"v": 1}', ''))
        tracker, page = object.__new__(client.Tracker), notion_page('https://jobs.test/b', 'app')
        page['properties']['Apply readiness'] = {'rich_text': [{'plain_text': '{"v": 1}'}]}
        with mock.patch.object(client, 'MATCHES_DATABASE_ID', 'matches-db'), \
                mock.patch.object(client.Tracker, '_query', lambda self, *args: [] if args and args[1] == 'matches-db' else [page], create=True):
            self.assertEqual(tracker.notion_jobs()[0]['apply_readiness'], '{"v": 1}')

    def test_desktop_jobs_reads_the_chosen_store_and_never_without_one(self):
        stores = self.stores()
        def listed(env):
            out = io.StringIO()
            with mock.patch.dict('os.environ', env, clear=False), mock.patch.object(client.Tracker, 'from_env', return_value=None), \
                    mock.patch('src.stores.open_stores', return_value=stores), \
                    mock.patch.object(desktop, 'jobs', side_effect=lambda db, limit, notion_jobs=None, **kw: {'jobs': notion_jobs}), \
                    mock.patch.object(desktop.store, 'connect', create=True), redirect_stdout(out):
                desktop.main(['jobs'])
            return json.loads(out.getvalue().strip().splitlines()[-1])['jobs']
        self.assertEqual(len(listed({'JOBADABRA_STORE': 'sqlite'})), 3)
        with mock.patch.dict('os.environ', {}, clear=False):
            import os
            os.environ.pop('JOBADABRA_STORE', None)
            self.assertIsNone(listed({}), 'no store chosen: the list is the cache, as before')

    def test_a_token_left_from_before_a_move_never_reaches_notion(self):
        # The data moved to this Mac's store; a Notion token is still set. The list and a kit's current inputs are the store's own.
        stores = self.stores()
        stores.applications.set_stage({'url': 'https://jobs.test/kit', 'title': 'SRE', 'company': 'Delta'}, 'Kit ready')
        stores.texts.set('profile', 'My profile')
        stores.texts.set('answers', 'My answers')
        tracker = mock.Mock(spec=client.Tracker)
        for name in ('notion_jobs', 'page_text', '_request', 'query_database'):
            getattr(tracker, name).side_effect = AssertionError(f'Notion read on this Mac\'s store: {name}')
        seen, out = {}, io.StringIO()
        def jobs(db, limit, notion_jobs=None, kit_inputs=None, **kw):
            seen['inputs'] = kit_inputs
            return {'jobs': notion_jobs}
        with mock.patch.dict('os.environ', {'JOBADABRA_STORE': 'sqlite'}), mock.patch.object(client.Tracker, 'from_env', return_value=tracker), \
                mock.patch('src.stores.open_stores', return_value=stores), mock.patch.object(desktop, 'jobs', side_effect=jobs), \
                mock.patch.object(desktop.store, 'connect', create=True), redirect_stdout(out):
            desktop.main(['jobs'])
        listed = json.loads(out.getvalue().strip().splitlines()[-1])
        self.assertEqual(len(listed['jobs']), 4)
        self.assertNotIn('stale', listed)
        from src.ai import kit, provenance
        self.assertEqual(seen['inputs'], provenance.kit_inputs('My profile', kit.standard_answers(stores)))


    def test_the_jobs_list_carries_each_applications_store_id(self):
        """The window finds a job by it (an interview's job, a meeting's Dismiss): on SQLite a job has no Notion page and its list `id`
        (the search cache's) is null, so page_id is the one key (renderer/jobs-view.js jobOfApplication)."""
        import tempfile
        from pathlib import Path
        from src import store as job_store
        stores = memory.open_store()
        app = stores.applications.create({'url': 'https://jobs.test/added', 'title': 'SRE', 'company': 'Acme'}, 'Applied')
        with tempfile.TemporaryDirectory() as tmp:
            db = job_store.connect(Path(tmp) / 'jobs.sqlite')
            listed = desktop.jobs(db, 50, notion_jobs=store_jobs(stores))['jobs']
            db.close()
        row = next(job for job in listed if job['url'] == 'https://jobs.test/added')
        self.assertEqual((row['page_id'], row['notion_url']), (app['id'], ''))

if __name__ == '__main__':
    unittest.main()


class ApplyRouteListTests(unittest.TestCase):
    """Owner, 14 Nov 2026 (asked via AskUserQuestion: "LinkedIn Easy Apply"): a job LinkedIn's page marked Easy Apply carries apply_route 'linkedin' in the Jobs list,
    from this Mac's store, from Notion, and from the cache before its sync; that draws the "LinkedIn Easy Apply" chip (desktop/renderer/account-chip.js)."""

    def test_both_stores_carry_the_column_and_the_list_turns_it_into_its_key(self):
        import tempfile
        from pathlib import Path
        from src import store
        stores = memory.open_store()
        stores.matches.upsert({'url': 'https://jobs.test/ea', 'title': 'SRE', 'company': 'Acme', 'fit': 80, 'status': 'Open', 'apply_route': 'LinkedIn Easy Apply'})
        self.assertEqual(store_jobs(stores)[0]['apply_route'], 'LinkedIn Easy Apply')
        tracker, page = object.__new__(client.Tracker), notion_page('https://jobs.test/ea', 'match')
        page['properties']['Apply route'] = {'select': {'name': 'LinkedIn Easy Apply'}}
        with mock.patch.object(client, 'MATCHES_DATABASE_ID', 'matches-db'), \
                mock.patch.object(client.Tracker, '_query', lambda self, *args: [page] if args and args[1] == 'matches-db' else [], create=True):
            item = tracker.notion_jobs()[0]
        self.assertEqual(item['apply_route'], 'LinkedIn Easy Apply')
        with tempfile.TemporaryDirectory() as directory:
            db = store.connect(Path(directory) / 'cache.sqlite')
            self.addCleanup(db.close)
            self.assertEqual(desktop.jobs(db, notion_jobs=[item])['jobs'][0]['apply_route'], 'linkedin')
            # Found by a search, not synced yet: the cache's own value.
            job_id, _ = store.upsert_job(db, {'title': 'SRE', 'company': 'Acme', 'url': 'https://www.linkedin.com/jobs/view/1/', 'location': 'Zurich'}, 'Acme', source_kind='linkedin')
            db.execute("UPDATE jobs SET apply_route='linkedin' WHERE id=?", (job_id,))
            db.commit()
            self.assertEqual([row['apply_route'] for row in desktop.jobs(db)['jobs']], ['linkedin'])
