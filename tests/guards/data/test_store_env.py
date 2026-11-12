"""The store-env guard of tests/suite_store_guard.py: every test starts with no store chosen, and one that leaves a store or changes the Notion connection fails by name."""
import os
import unittest

from suite_store_guard import STEERING

class StoreEnvGuardTests(unittest.TestCase):
    def test_the_guard_wraps_every_test(self):
        self.assertTrue(getattr(unittest.TestCase.run, 'guard', False), 'TestCase.run is no longer the store-env guard')

    def test_a_test_starts_without_a_chosen_store(self):
        for name in STEERING:
            self.assertNotIn(name, os.environ)

    def test_a_leaking_test_fails_and_the_next_one_is_not_steered(self):
        class Leaks(unittest.TestCase):
            def test_leak(self):
                os.environ['JOBADABRA_STORE'] = 'sqlite'

            def test_tidy(self):
                from unittest import mock
                with mock.patch.dict(os.environ, {'JOBADABRA_STORE': 'memory'}):
                    pass

        result = unittest.TestResult()
        unittest.defaultTestLoader.loadTestsFromTestCase(Leaks).run(result)
        self.assertEqual([test.id().rsplit('.', 1)[-1] for test, _ in result.failures], ['test_leak'])
        self.assertIn("'JOBADABRA_STORE': 'sqlite'", result.failures[0][1])
        self.assertNotIn('JOBADABRA_STORE', os.environ)

    def test_a_search_run_cache_never_reaches_the_next_test(self):
        """#3874, the shape that reddened #3862's shard: one test leaves feeds.TRIAGED = {}, the next patches it to that same dict and the run marks
        it asked, the "restore" puts it back mutated, and a later test's wanted_title reads the mark. Through the guard the reader sees None."""
        import suite_store_guard
        from unittest import mock
        from src.sources import feeds

        class Order(unittest.TestCase):
            seen = []

            def test_a_fills(self):
                feeds.TRIAGED = {}

            def test_b_patches_to_the_same_dict(self):
                with mock.patch.object(feeds, 'TRIAGED', feeds.TRIAGED):
                    feeds._triaged_shared()[feeds.ASKED] = True

            def test_c_reads(self):
                Order.seen.append(feeds.TRIAGED)

        def run(through):
            Order.seen = []
            with mock.patch.object(unittest.TestCase, 'run', through):
                unittest.defaultTestLoader.loadTestsFromTestCase(Order).run(unittest.TestResult())
            return Order.seen[0]

        before = feeds.TRIAGED
        try:
            self.assertEqual(run(suite_store_guard._run), {feeds.ASKED: True}, 'positive control: without the guard the asked mark leaks')
        finally:
            feeds.TRIAGED = before
        self.assertIsNone(run(suite_store_guard.run_without_a_chosen_store), 'through the guard each test starts with the run caches empty')
        self.assertIs(feeds.TRIAGED, before, 'and the cache is left as this test found it')

    def test_a_test_that_changes_the_notion_connection_fails_and_it_is_put_back(self):
        from unittest import mock
        class Leaks(unittest.TestCase):
            def test_set(self):
                os.environ['NOTION_TOKEN'] = 'secret_leaked'

            def test_changed(self):
                os.environ['NOTION_APPLICATIONS_DB'] = 'another-db'

            def test_removed(self):
                os.environ.pop('NOTION_MATCHES_DB', None)

            def test_tidy(self):
                with mock.patch.dict(os.environ, {'NOTION_APPLICATIONS_DB': 'its-own', 'NOTION_TOKEN': 't'}):
                    pass

        start = {'NOTION_APPLICATIONS_DB': 'apps', 'NOTION_MATCHES_DB': 'matches'}
        with mock.patch.dict(os.environ, start):
            os.environ.pop('NOTION_TOKEN', None)
            result = unittest.TestResult()
            unittest.defaultTestLoader.loadTestsFromTestCase(Leaks).run(result)
            self.assertEqual(sorted(test.id().rsplit('.', 1)[-1] for test, _ in result.failures), ['test_changed', 'test_removed', 'test_set'])
            self.assertIn("'NOTION_APPLICATIONS_DB': ('apps', 'another-db')", ' '.join(text for _, text in result.failures))
            self.assertEqual({name: os.environ.get(name) for name in (*start, 'NOTION_TOKEN')}, {**start, 'NOTION_TOKEN': None})


if __name__ == '__main__':
    unittest.main()
