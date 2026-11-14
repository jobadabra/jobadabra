"""Guard: privacy — the CI feed to the site's `ci_boards` door carries board host names, country ids and one count per board (`local`, jobs kept: owner via sa, 13 Nov 2026: "a count, fixed shape, validator both ends, capped") and nothing else ("board names only (no person, no job)");
without it a profile id, a job title or a run id could reach the site, a Mac or a test could post as "CI", and a refused post could turn a search run red."""
import io
import json
import os
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import report_boards  # noqa: E402

CI = {'GITHUB_ACTIONS': 'true'}


def run_folder(root, name, sources):
    """A run folder with one press record whose sources are `sources` ({'source','kind','local'})."""
    draw = Path(root) / name / 'draw'
    draw.mkdir(parents=True)
    record = {'sources': sources, 'title': 'Electrician Madrid secret-title', 'job': 'https://example.test/job/1'}
    (draw / 'presses.jsonl').write_text(json.dumps(record) + '\n', encoding='utf-8')
    return Path(root) / name


def board(host, kind='job board', local=3):
    return {'source': host, 'kind': kind, 'local': local}


class Post:
    """A stand-in for urlopen: remembers the request, answers `status` or raises."""

    def __init__(self, status=200, error=None):
        self.status, self.error, self.requests = status, error, []

    def __call__(self, request, timeout=None):
        self.requests.append(request)
        if self.error:
            raise self.error
        return mock.MagicMock(__enter__=lambda s: mock.MagicMock(status=self.status), __exit__=lambda *a: False)


def main(argv, post, env):
    with mock.patch.dict(os.environ, env, clear=False), mock.patch('sys.stdout', new=io.StringIO()):
        return report_boards.main(argv, post=post)


class ReportBoards(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        for name in ('GITHUB_ACTIONS', 'JOBADABRA_FIXTURE_DIR'):
            self.addCleanup(os.environ.pop, name, None)
            os.environ.pop(name, None)

    def test_body_is_host_and_country_only(self):
        folder = run_folder(self.tmp.name, 'search-profile-b01', [board('jobeka.com'), board('trabajo.org')])
        post = Post()
        main([str(folder), '--person', 'b01', '--run', '123456'], post, CI)
        self.assertEqual(len(post.requests), 1)
        sent = json.loads(post.requests[0].data)
        self.assertEqual(sent, {'v': 2, 'install': 'ci-search-123456', 'ci_boards': [
            {'host': 'jobeka.com', 'countries': ['bg'], 'local': 3}, {'host': 'trabajo.org', 'countries': ['bg'], 'local': 3}]})
        text = post.requests[0].data.decode()
        for private in ('b01', 'secret-title', 'example.test/job', 'Electrician'):
            self.assertNotIn(private, text)

    def test_every_job_board_the_search_read_even_with_no_job_kept(self):
        folder = run_folder(self.tmp.name, 'b01', [
            board('good.example.com'), board('none.example.com', local=0), board('feed.example.com', kind='employer feed'),
            board('Display Name'), board('')])
        self.assertEqual(report_boards.collect(folder, 'b01'), {('good.example.com', 'bg'): {'local': 3, 'url': None, 'fine': False}, ('none.example.com', 'bg'): {'local': 0, 'url': None, 'fine': False}})

    def test_the_night_people_add_nothing(self):
        root = self.tmp.name
        run_folder(root, '17--main-1', [board('jobeka.com')])
        run_folder(root, 'zz99--main-1', [board('jobeka.com')])
        self.assertEqual(report_boards.collect(root), {})
        self.assertEqual(report_boards.collect(Path(root) / '17--main-1', '17'), {})

    def test_a_folder_of_pair_folders_names_each_person_from_its_folder(self):
        root = self.tmp.name
        run_folder(root, 'b01--main-1', [board('a.example.com')])
        run_folder(root, 'b02--pr-1', [board('b.example.com')])
        self.assertEqual(report_boards.collect(root), {('a.example.com', 'bg'): {'local': 3, 'url': None, 'fine': False}, ('b.example.com', 'ro'): {'local': 3, 'url': None, 'fine': False}})

    def test_the_body_carries_the_jobs_kept_per_host_the_highest_over_rows_and_folders_as_a_capped_count(self):
        """13 Nov 2026, owner via sa: the press row's `local` (jobs kept in the person's place) goes with the host so the Scout reads Jobeka (19) before an alphabetical neighbour."""
        root = self.tmp.name
        run_folder(root, 'b01--main-1', [board('jobeka.es', local=19), board('jobeka.es', local=4), board('apiem.org', local=0), board('wild.example.com', local=5000),
                                         board('text.example.com', local='19'), board('neg.example.com', local=-2), board('half.example.com', local=2.5), board('bool.example.com', local=True),
                                         {'source': 'none.example.com', 'kind': 'job board'}])
        run_folder(root, 'b01--pr-1', [board('jobeka.es', local=7), board('trabajo.org', local=16)])
        found = report_boards.collect(root)
        self.assertEqual(found[('jobeka.es', 'bg')]['local'], 19, 'the highest over a folder\'s rows and over folders')
        post = Post()
        main([root, '--run', '9'], post, CI)
        items = {item['host']: item for item in json.loads(post.requests[0].data)['ci_boards']}
        self.assertEqual({host: item['local'] for host, item in items.items()}, {'jobeka.es': 19, 'apiem.org': 0, 'trabajo.org': 16, 'wild.example.com': 0, 'text.example.com': 0,
                         'neg.example.com': 0, 'half.example.com': 0, 'bool.example.com': 0, 'none.example.com': 0})
        self.assertTrue(all(sorted(item) == ['countries', 'host', 'local'] for item in items.values()), 'fixed shape: host, countries, local')
        self.assertTrue(all(isinstance(item['local'], int) and 0 <= item['local'] <= 999 for item in items.values()))

    def test_a_board_the_search_read_at_an_address_carries_that_template_never_a_word_of_the_profile(self):
        """14 Nov 2026, owner via sa ("CI report carries it"): the template comes from the run's found-boards.json (the AI's answer with {role} and {place}), not from run.log, whose filled links hold the person's words."""
        template = 'https://es.jobeka.example/empleos-{role}-provincia-de-{place}'
        folder = run_folder(self.tmp.name, 'search-profile-b01', [board('jobeka.example', local=19), board('plain.example'), board('filled.example'), board('other.example')])
        (folder / 'draw' / 'run-1.log').write_text("Job boards: Jobeka round 'zxqvrole' in zxqvplace: 20 job(s) on the page · https://es.jobeka.example/empleos-zxqvrole-provincia-de-zxqvplace\n", encoding='utf-8')
        (folder / 'found-boards.json').write_text(json.dumps({'boards': {
            'es.jobeka.example': {'search_url': template, 'state': 'ok', 'countries': ['Bulgaria']},
            'filled.example': {'search_url': 'https://filled.example/empleos-zxq%C3%A1vrole?q={role}', 'state': 'ok'},      # an encoded word: dropped
            'other.example': {'search_url': 'https://elsewhere.example/s?q={role}', 'state': 'ok'},                       # not this board's host: dropped
            'plain.example': {'state': 'ok'}}}), encoding='utf-8')
        self.assertEqual(report_boards.addresses(folder, {'jobeka.example', 'plain.example', 'filled.example', 'other.example'}), {'jobeka.example': (True, template)})
        post = Post()
        main([str(folder), '--person', 'b01', '--run', '5'], post, CI)
        sent = {item['host']: item for item in json.loads(post.requests[0].data)['ci_boards']}
        self.assertEqual(sent['jobeka.example'], {'host': 'jobeka.example', 'countries': ['bg'], 'local': 19, 'url': template})
        for host in ('plain.example', 'filled.example', 'other.example'):
            self.assertNotIn('url', sent[host], f'{host}: no valid address, still a host-only candidate')
        text = post.requests[0].data.decode()
        for private in ('zxqv', 'b01', 'secret-title', 'Electrician'):
            self.assertNotIn(private, text)

    def test_the_address_is_left_out_without_the_file_or_with_a_file_that_is_not_readable(self):
        for content in (None, 'not json', '[]', '{"boards": []}', '{"boards": {"es.jobeka.example": 5}}'):
            folder = run_folder(self.tmp.name, f'b01--main-{abs(hash(content))}', [board('jobeka.example')])
            if content is not None:
                (folder / 'found-boards.json').write_text(content, encoding='utf-8')
            self.assertEqual(report_boards.collect(folder, 'b01'), {('jobeka.example', 'bg'): {'local': 3, 'url': None, 'fine': False}}, repr(content))

    def test_two_addresses_for_one_board_go_as_two_items_and_the_one_the_search_read_fine_is_taken(self):
        folder = run_folder(self.tmp.name, 'b01', [board('jobeka.example')])
        (folder / 'found-boards.json').write_text(json.dumps({'boards': {
            'a.jobeka.example': {'search_url': 'https://a.jobeka.example/s?q={role}', 'state': 'empty'},
            'z.jobeka.example': {'search_url': 'https://z.jobeka.example/s?q={role}', 'state': 'ok'}}}), encoding='utf-8')
        self.assertEqual(report_boards.addresses(folder, {'jobeka.example'}), {'jobeka.example': (True, 'https://z.jobeka.example/s?q={role}')})
        body = report_boards.body({('jobeka.example', 'bg'): {'local': 4, 'url': 'https://z.jobeka.example/s?q={role}', 'fine': True}, ('jobeka.example', 'ro'): {'local': 9, 'url': None, 'fine': False}}, '1')
        self.assertEqual(body['ci_boards'], [{'host': 'jobeka.example', 'countries': ['bg'], 'local': 4, 'url': 'https://z.jobeka.example/s?q={role}'}, {'host': 'jobeka.example', 'countries': ['ro'], 'local': 9}])

    def test_a_board_on_a_two_label_suffix_is_matched_by_its_company_domain_never_to_co_uk(self):
        """Gitar on #4127: registrable('es.indeed.co.uk') is 'co.uk'. An entry belongs to a press-row host when its company domain is that host (careers_explore.company_domain), and the address is checked against it."""
        boards = {'es.indeed.co.uk': {'search_url': 'https://es.indeed.co.uk/jobs?q={role}&l={place}', 'state': 'ok'},
                  'www.infojobs.com.br': {'search_url': 'https://www.infojobs.com.br/empregos/{role}', 'state': 'ok'},
                  'evil.co.uk': {'search_url': 'https://evil.co.uk/s?q={role}', 'state': 'ok'},                               # another company on the same suffix
                  'sub.indeed.co.uk': {'search_url': 'https://other.co.uk/s?q={role}', 'state': 'ok'}}                        # an address on another domain than its entry
        folder = run_folder(self.tmp.name, 'b01', [board('indeed.co.uk', local=7), board('infojobs.com.br', local=2)])
        (folder / 'found-boards.json').write_text(json.dumps({'boards': boards}), encoding='utf-8')
        self.assertEqual(report_boards.addresses(folder, {'indeed.co.uk', 'infojobs.com.br'}), {
            'indeed.co.uk': (True, 'https://es.indeed.co.uk/jobs?q={role}&l={place}'), 'infojobs.com.br': (True, 'https://www.infojobs.com.br/empregos/{role}')})
        self.assertEqual(report_boards.collect(folder, 'b01')[('indeed.co.uk', 'bg')]['url'], 'https://es.indeed.co.uk/jobs?q={role}&l={place}')
        # what source_yield writes today for these boards (careers_parse.registrable keeps two labels): the press row is keyed 'co.uk' / 'com.br'; no address is reported for it, never a loose one
        keyed = run_folder(self.tmp.name, 'b02', [board('co.uk', local=7), board('com.br', local=2)])
        (keyed / 'found-boards.json').write_text(json.dumps({'boards': boards}), encoding='utf-8')
        self.assertEqual(report_boards.addresses(keyed, {'co.uk', 'com.br'}), {})
        self.assertEqual({key: value['url'] for key, value in report_boards.collect(keyed, 'b02').items()}, {('co.uk', 'ro'): None, ('com.br', 'ro'): None})

    def test_across_folders_the_address_the_search_read_fine_wins_over_one_that_gave_nothing(self):
        """Gitar on #4127: the first folder's address (state empty) must not beat a later folder's address that gave jobs."""
        root = self.tmp.name
        for name, state, url in (('b01--main-1', 'empty', 'https://a.jobeka.example/s?q={role}'), ('b01--pr-1', 'ok', 'https://z.jobeka.example/s?q={role}'), ('b01--pr-2', 'empty', 'https://m.jobeka.example/s?q={role}')):
            folder = run_folder(root, name, [board('jobeka.example')])
            (folder / 'found-boards.json').write_text(json.dumps({'boards': {url.split('/')[2]: {'search_url': url, 'state': state}}}), encoding='utf-8')
        self.assertEqual(report_boards.collect(root)[('jobeka.example', 'bg')]['url'], 'https://z.jobeka.example/s?q={role}')
        only_empty = os.path.join(self.tmp.name, 'only')
        for name, url in (('b01--main-1', 'https://a.jobeka.example/s?q={role}'), ('b01--pr-1', 'https://z.jobeka.example/s?q={role}')):
            folder = run_folder(only_empty, name, [board('jobeka.example')])
            (folder / 'found-boards.json').write_text(json.dumps({'boards': {url.split('/')[2]: {'search_url': url, 'state': 'empty'}}}), encoding='utf-8')
        self.assertEqual(report_boards.collect(only_empty)[('jobeka.example', 'bg')]['url'], 'https://a.jobeka.example/s?q={role}', 'none read fine: the first found, as before')

    def test_nothing_is_sent_off_github_actions_or_with_a_fixture(self):
        folder = run_folder(self.tmp.name, 'b01', [board('jobeka.com')])
        post = Post()
        main([str(folder), '--person', 'b01'], post, {})
        main([str(folder), '--person', 'b01'], post, {**CI, 'JOBADABRA_FIXTURE_DIR': self.tmp.name})
        self.assertEqual(post.requests, [])

    def test_no_board_means_no_post(self):
        folder = run_folder(self.tmp.name, 'b01', [board('x.example.com', kind='employer feed')])
        post = Post()
        main([str(folder), '--person', 'b01'], post, CI)
        self.assertEqual(post.requests, [])

    def test_a_refused_or_failed_post_never_raises(self):
        folder = run_folder(self.tmp.name, 'b01', [board('jobeka.com')])
        for post in (Post(status=403), Post(error=OSError('network down')), Post(error=TimeoutError())):
            self.assertEqual(main([str(folder), '--person', 'b01'], post, CI), 0)
            self.assertEqual(len(post.requests), 1)

    def test_the_run_id_is_cleaned_and_capped(self):
        self.assertEqual(report_boards.body({}, 'a b/c?9')['install'], 'ci-search-abc9')
        self.assertEqual(report_boards.body({}, '')['install'], 'ci-search-run')
        self.assertLessEqual(len(report_boards.body({}, 'x' * 99)['install']), len('ci-search-') + 40)


class OneShareForARun(unittest.TestCase):
    """14 Nov 2026 (rp, owner via sa: "let's fix what we learn"): run 43531622998 sent one share per SEARCH, 34 in one UTC hour against the site's 30 an hour (jobadabra-web api/ci-boards.js PER_HOUR), and the
    last three came back 429 and were lost with only a warning. One share per run, sent by the job that holds every artifact; a share that does not arrive is a line in the run's summary."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        for name in ('GITHUB_ACTIONS', 'JOBADABRA_FIXTURE_DIR', 'GITHUB_STEP_SUMMARY'):
            self.addCleanup(os.environ.pop, name, None)
            os.environ.pop(name, None)

    def artifacts(self, people):
        """The folder the table job downloads: one `search-profile-<id>` folder per search, each reading the same board plus one of its own."""
        root = Path(self.tmp.name) / 'results'
        for index, person in enumerate(people):
            run_folder(root, f'search-profile-{person}', [board('shared.example', local=index), board(f'own{index}.example', local=1)])
        return root

    def test_fifteen_searches_make_one_post_and_a_shared_board_keeps_its_highest_count_and_its_address(self):
        people = ['b01', 'b02', 'b03', 'b04', 'b05', 'b06', 'b07', 'b08', 'b09', 'b10', 'c01', 'c02', 'c03', 'c04', 'c05']
        root = self.artifacts(people)
        template = 'https://shared.example/s?q={role}&l={place}'
        (root / 'search-profile-b03' / 'found-boards.json').write_text(json.dumps({'boards': {'shared.example': {'search_url': template, 'state': 'ok'}}}), encoding='utf-8')
        post = Post()
        self.assertEqual(main([str(root), '--run', '77'], post, CI), 0)
        self.assertEqual(len(post.requests), 1, 'one share for the whole run, never one per search')
        items = json.loads(post.requests[0].data)['ci_boards']
        shared = [item for item in items if item['host'] == 'shared.example']
        self.assertEqual(sum(len(item['countries']) for item in shared), len({report_boards.country_of(person) for person in people}))
        self.assertEqual(max(item['local'] for item in shared), 14, 'the highest count over the searches that named it')
        self.assertTrue(any(item.get('url') == template for item in shared), 'the address one search read fine')

    def test_a_one_profile_run_has_no_profile_folder_and_its_person_comes_from_its_row(self):
        """14 Nov 2026 (rp, run 43600783345): download-artifact puts ONE artifact straight into `results/` (log: "Found 1 artifact(s) ... download of artifact to: .../results"), so the folder name says no person and the
        share told 0 boards for d01 whose search read 3. The artifact's own row.json (`id`, written by profiles.py row) names the person whatever the folder is called."""
        root = Path(self.tmp.name) / 'results'
        run_folder(self.tmp.name, 'results', [board('shared.example', local=4)])
        (root / 'row.json').write_text(json.dumps({'id': 'b01', 'city': 'Sofia'}), encoding='utf-8')
        post = Post()
        main([str(root), '--run', '77'], post, CI)
        self.assertEqual(len(post.requests), 1)
        self.assertEqual(json.loads(post.requests[0].data)['ci_boards'], [{'host': 'shared.example', 'countries': ['bg'], 'local': 4}])

    def test_a_row_that_names_no_person_or_a_night_person_adds_nothing(self):
        for index, content in enumerate(('not json', '[]', '{"id": 5}', '{"id": "17"}', '{"id": "zz9"}', '{"city": "x"}')):
            root = Path(self.tmp.name) / f'flat{index}'
            run_folder(self.tmp.name, f'flat{index}', [board('shared.example')])
            (root / 'row.json').write_text(content, encoding='utf-8')
            self.assertEqual(report_boards.collect(root), {}, content)

    def test_a_429_is_a_line_in_the_summary_and_the_note_never_a_red_run(self):
        root = self.artifacts(['b01', 'b02', 'c04'])
        summary, note = Path(self.tmp.name) / 'summary.md', Path(self.tmp.name) / 'table.md'
        note.write_text('| table |\n', encoding='utf-8')
        env = {**CI, 'GITHUB_STEP_SUMMARY': str(summary)}
        refused = urllib.error.HTTPError(report_boards.URL, 429, 'Too Many Requests', {}, None)
        self.assertEqual(main([str(root), '--run', '77', '--note', str(note)], Post(error=refused), env), 0)
        for text in (summary.read_text(encoding='utf-8'), note.read_text(encoding='utf-8')):
            self.assertIn('CI boards NOT told to the Scout (HTTP 429)', text)
            self.assertIn('3 search', text)

    def test_a_share_that_arrived_is_one_line_too_and_a_run_with_nothing_to_tell_adds_none(self):
        root = self.artifacts(['b01', 'b02'])
        summary = Path(self.tmp.name) / 'summary.md'
        main([str(root), '--run', '77'], Post(), {**CI, 'GITHUB_STEP_SUMMARY': str(summary)})
        self.assertIn('CI boards told to the Scout:', summary.read_text(encoding='utf-8'))
        empty, quiet = Path(self.tmp.name) / 'empty', Path(self.tmp.name) / 'quiet.md'
        run_folder(empty, 'search-profile-b01', [board('x.example.com', kind='employer feed')])
        main([str(empty), '--run', '77'], Post(), {**CI, 'GITHUB_STEP_SUMMARY': str(quiet)})
        self.assertFalse(quiet.exists())

    def test_the_summary_is_written_only_in_a_github_actions_run(self):
        root = self.artifacts(['b01'])
        summary = Path(self.tmp.name) / 'summary.md'
        main([str(root), '--run', '77'], Post(), {'GITHUB_STEP_SUMMARY': str(summary)})
        self.assertFalse(summary.exists())


if __name__ == '__main__':
    unittest.main()
