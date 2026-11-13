"""One add-by-link reads the one job, not the board's whole list (#4005 follow-up, 13 Nov 2026: a Workday link took ~45 s)."""
import io
import json
import os
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from src.sources import ats, describe, host_pace  # noqa: E402

LINK = 'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Network-Site-Reliability-Engineer_JR2029104'
RECORDED = (Path(__file__).resolve().parents[2] / 'fixtures' / 'job_pages' / 'nvidia-workday-JR2029104.cxs.json').read_bytes()


class Site:
    """The Workday site's stand-in: a recorded one-job answer, and a search that always has a full page of other jobs (a big board)."""
    def __init__(self, gone=False):
        self.requests, self.gone = [], gone

    def __call__(self, request, timeout=15):
        self.requests.append(request.full_url)
        if '/job/' in request.full_url:
            return io.BytesIO(b'{}' if self.gone else RECORDED)
        listed = [{'title': f'Other job {n}', 'externalPath': f'/job/Elsewhere/Other-job-{n}_JR{n}', 'locationsText': 'Elsewhere'} for n in range(20)]
        return io.BytesIO(json.dumps({'total': 4000, 'jobPostings': listed}).encode())


class OneJobTests(unittest.TestCase):
    def setUp(self):
        ats._board.cache_clear()
        host_pace.reset()
        self.site = Site()
        for patch in (mock.patch.object(urllib.request, 'urlopen', self.site), mock.patch.object(host_pace, 'sleep', lambda _s: None),
                      mock.patch.object(ats, 'workday_terms', lambda *_a: ['site reliability', 'devops', 'platform'])):
            patch.start()
            self.addCleanup(patch.stop)

    def test_a_workday_link_is_read_with_one_request(self):
        job = ats.posting(LINK)
        self.assertLessEqual(len(self.site.requests), 2, self.site.requests)
        self.assertEqual((job['title'], job['location'], job['date_posted']), ('Network Site Reliability Engineer', 'US, CA, Santa Clara', '2026-11-04'))
        self.assertGreater(len(job['description']), 1000)

    def test_a_workday_job_that_is_gone_is_none_without_walking_the_list(self):
        self.site.gone = True
        self.assertIsNone(ats.posting(LINK))
        self.assertEqual(len(self.site.requests), 1)

    def test_a_workday_job_that_answers_404_is_none_and_not_a_refusal(self):
        def gone(request, timeout=15):
            self.site.requests.append(request.full_url)
            raise urllib.error.HTTPError(request.full_url, 404, 'Not Found', {}, None)

        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        with mock.patch('src.paths.DATA', Path(folder.name)), mock.patch.object(urllib.request, 'urlopen', gone):
            self.assertIsNone(ats.posting(LINK))
            self.assertFalse(describe.refused_lately(LINK))
        self.assertEqual(len(self.site.requests), 1)

    def test_a_fixture_run_reads_its_recorded_route_and_never_the_network(self):
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__('shutil').rmtree(folder, ignore_errors=True))
        (folder / 'routes.json').write_text(json.dumps({'/job/US-CA-Santa-Clara/': 'job.json'}))
        (folder / 'job.json').write_bytes(RECORDED)
        with mock.patch.dict(os.environ, {'JOBADABRA_FIXTURE_DIR': str(folder)}):
            job = ats.posting(LINK)
            self.assertEqual(job['title'], 'Network Site Reliability Engineer')
            (folder / 'routes.json').write_text('{}')
            self.assertIsNone(ats.posting(LINK), 'no route fails like an unreachable feed')
        self.assertEqual(self.site.requests, [], 'nothing left the computer')

    def test_a_403_on_the_one_job_read_is_kept_like_a_board_refusal(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)

        def refused(request, timeout=15):
            self.site.requests.append(request.full_url)
            raise urllib.error.HTTPError(request.full_url, 403, 'Forbidden', {}, None)

        with mock.patch('src.paths.DATA', Path(folder.name)), mock.patch.object(urllib.request, 'urlopen', refused):
            self.assertIsNone(ats.posting(LINK))
            self.assertIsNone(ats.posting(LINK))
            self.assertTrue(describe.refused_lately(LINK))
        self.assertEqual(len(self.site.requests), 1, 'asked once, never again this week')


if __name__ == '__main__':
    unittest.main()
