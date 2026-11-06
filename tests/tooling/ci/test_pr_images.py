# Guard: release — a PR description whose Before/After images 404 ships a broken page to the reviewer; tools/pr-screens.py must catch a dead image URL, with no network in the test.
import importlib.util
import pathlib
import unittest

SPEC = importlib.util.spec_from_file_location('pr_screens', pathlib.Path(__file__).resolve().parents[3] / 'tools' / 'pr-screens.py')
screens = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(screens)

BASE = 'https://github.com/jobadabra/'


def body(*urls):
    rows = ''.join(f'| The card says "Start date" under the dropdown {n} | ![before]({u}) | ![after]({u}) |\n' for n, u in enumerate(urls))
    return '| What changed | Before | After |\n|---|---|---|\n' + rows


def answers(table):
    return lambda url: table.get(url, 200)


class ImageUrlsLoad(unittest.TestCase):
    # The three real escapes of the week of 6 Nov 2026: the URL typed by hand pointed at a name that is not the published tag.
    def test_3321_tag_equal_to_its_branch_404s(self):
        url = BASE + 'jobadabra/raw/fb-tour-bars/after.png'
        errors, notes = screens.image_report(body(url), answers({url: 404}))
        self.assertEqual(len(errors), 1)
        self.assertIn(url, errors[0])
        self.assertIn('tools/pr-assets.mjs', errors[0])
        self.assertIn('never retype the tag', errors[0])
        self.assertEqual(notes, [])

    def test_web450_typed_tag_missing_its_number_404s(self):
        typed, real = BASE + 'jobadabra-web/raw/pr-assets-hr-28/a.png', BASE + 'jobadabra-web/raw/pr-assets-hr-28-2/a.png'
        errors, _ = screens.image_report(body(typed, real), answers({typed: 404}))
        self.assertEqual([url in errors[0] for url in (typed, real)], [True, False])
        self.assertEqual(len(errors), 1)

    def test_web420_before_images_under_the_wrong_tag_404(self):
        wrong, right = BASE + 'jobadabra-web/raw/pr-assets-em-footer/before.png', BASE + 'jobadabra-web/raw/pr-assets-em-footer-3/after.png'
        text = f'| What changed | Before | After |\n|---|---|---|\n| The footer shows the e-mail kinds under the logo | ![b]({wrong}) | <img src="{right}" width="400"> |\n'
        errors, _ = screens.image_report(text, answers({wrong: 404}))
        self.assertEqual(len(errors), 1)
        self.assertIn(wrong, errors[0])

    def test_loading_images_pass(self):
        url = BASE + 'jobadabra/raw/pr-assets-x/a.png'
        self.assertEqual(screens.image_report(body(url), answers({})), ([], []))

    def test_no_answer_is_could_not_check_never_broken(self):
        url = BASE + 'jobadabra/raw/pr-assets-x/a.png'
        errors, notes = screens.image_report(body(url), lambda _: None)
        self.assertEqual(errors, [])
        self.assertIn('could not check', notes[0])

    def test_http_status_retries_a_blip_and_reports_a_404_at_once(self):
        calls = []

        def fake(url, timeout=0):
            calls.append(url)
            raise screens.urllib.error.HTTPError(url, 404, 'Not Found', {}, None)
        original, sleep = screens.urllib.request.urlopen, screens.time.sleep
        screens.urllib.request.urlopen, screens.time.sleep = lambda request, timeout=0: fake(request.full_url), lambda _: None
        try:
            self.assertEqual(screens.http_status('https://x/y.png'), 404)
            self.assertEqual(len(calls), 1)   # a 404 is an answer: no retry
            calls.clear()

            def blip(url, timeout=0):
                calls.append(url)
                raise screens.urllib.error.URLError('down')
            screens.urllib.request.urlopen = lambda request, timeout=0: blip(request.full_url)
            self.assertIsNone(screens.http_status('https://x/y.png'))
            self.assertEqual(len(calls), screens.TRIES)
        finally:
            screens.urllib.request.urlopen, screens.time.sleep = original, sleep

    def test_rate_limit_and_odd_urls_are_could_not_check_never_a_crash(self):
        original, sleep = screens.urllib.request.urlopen, screens.time.sleep

        def limited(request, timeout=0):
            raise screens.urllib.error.HTTPError(request.full_url, 429, 'Too Many Requests', {}, None)
        screens.time.sleep = lambda _: None
        try:
            calls = []
            screens.urllib.request.urlopen = lambda request, timeout=0: (calls.append(1), limited(request))[1]
            self.assertIsNone(screens.http_status('https://x/y.png'))
            self.assertEqual(len(calls), 1)   # a 429 is never retried
            screens.urllib.request.urlopen = lambda request, timeout=0: (_ for _ in ()).throw(screens.http.client.InvalidURL('bad'))
            self.assertIsNone(screens.http_status('https://x/a\x00b.png'))
            seen = []
            screens.urllib.request.urlopen = lambda request, timeout=0: (seen.append(request.full_url), (_ for _ in ()).throw(OSError('x')))[1]
            screens.http_status('https://x/é.png')
            self.assertEqual(seen[0], 'https://x/%C3%A9.png')
        finally:
            screens.urllib.request.urlopen, screens.time.sleep = original, sleep

    def test_a_404_in_a_repo_we_cannot_read_is_could_not_check(self):
        url = BASE + 'private-repo/raw/pr-assets-x/a.png'
        table = {url: 404, 'https://api.github.com/repos/jobadabra/private-repo': 404}
        self.assertEqual(screens.image_report(body(url), answers(table))[0], [])
        self.assertIn(url, screens.image_report(body(url), answers(table))[1][0])
        table['https://api.github.com/repos/jobadabra/private-repo'] = 200   # a public repo: the 404 stands
        self.assertEqual(len(screens.image_report(body(url), answers(table))[0]), 1)

    def test_urls_come_from_markdown_and_img_tags_once(self):
        text = '![a](https://h/a.png) ![b](<https://h/b.png>) <img alt="c" src="https://h/c.png"> ![a](https://h/a.png) ![local](shot.png)'
        self.assertEqual(screens.image_urls(text), ['https://h/a.png', 'https://h/b.png', 'https://h/c.png'])


if __name__ == '__main__':
    unittest.main()
