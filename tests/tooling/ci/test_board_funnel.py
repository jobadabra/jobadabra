"""Guard: privacy — the per-search funnel table goes into a public run summary and an artifact: it may carry counts, hosts and board names, never a job link,
a title or an employer, and a column whose source line is not merged must say so, never print a guessed number. Played on three fake folders (a read board with a
named-later reason, an older log with no place pass and a refused page, and a folder with no log). Code: tools/persona-search/board_funnel.py."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import board_funnel  # noqa: E402

SECRET_TITLE = 'Oficial Electricista Secretisimo'
SECRET_EMPLOYER = 'Empresa Reservada SL'


def folder(lines, judged=None, relay=()):
    root = Path(tempfile.mkdtemp())
    (root / 'draw').mkdir()
    (root / 'draw' / 'run-1.log').write_text('\n'.join(lines), encoding='utf-8')
    (root / 'run.log').write_text('\n'.join(['relay: small total 1 kind title_triage start 1 status 200', 'draw: search prepared in 3 s', *relay]), encoding='utf-8')
    rows = [{'title': SECRET_TITLE, 'company': company, 'provider': provider, 'kind': kind, 'role': role, 'place': 'yes', **({'host': host} if host else {})} for company, provider, kind, role, host in judged or []]
    (root / 'judged.json').write_text(json.dumps({'rows': rows}), encoding='utf-8')
    return root


class BoardFunnel(unittest.TestCase):
    def test_a_read_board_and_a_named_board_that_got_no_place(self):
        root = folder([
            '[5s] First jobs: reading jobijoba.es, airlinejobs.com, the job boards that gave people like you the most jobs',
            "[7s] Job boards: jobijoba.es round 'electricista' in madrid: 29 job(s) on the page, 29 new, 1 s (page 1 s) · https://www.jobijoba.es/ofertas/electricista",
            "[9s] Job boards: Zaplata round 'electrician': page not read (HTTP 404), 2 s · https://www.zaplata.bg/?q=electrician",
            '[12s] Job boards proposed for Spain: InfoJobs, Jobijoba (named without a search link: Doméstiko)',
            '[13s] Job boards named later: places left 0, held by jobijoba.es, airlinejobs.com',
            '[13s] Job boards named later: 1. InfoJobs (infojobs.net): no place left [rank 3, counted right 5, fit 70+ 2, browser False]',
            f'[38s] Stage: Job boards found kept https://www.jobijoba.es/ofertas/electricista#{SECRET_TITLE}',
            f'[38s] Stage: Job boards found ai_no https://www.jobijoba.es/ofertas/electricista#{SECRET_TITLE} two',
            f'[68s] Stage: Arbeitnow never_asked https://www.arbeitnow.com/jobs/{SECRET_EMPLOYER} | Spain',
            '[74s] ⏱ Time is up (1 min 13 s) for job boards: 1 board read waits for the next search',
            '[80s] Titles: Claude sorted 91 new title(s) in your places; 15 could fit your search',
            '[107s] Employers: read 4 of 11 sites in the time, best first',
        ], judged=[('via jobijoba.es', 'Job boards found', 'job board', 'yes', ''), (SECRET_EMPLOYER, 'Job boards found', 'job board', 'yes', 'jobijoba.es'), (SECRET_EMPLOYER, 'Fonio', 'employer feed', 'no', '')],
            relay=['relay: small total 1 kind decide start 2 status 200', 'relay: small total 1 kind decide start 3 status 200'])
        text = board_funnel.table(root)
        by_source = {line.split(' | ')[0].strip('| '): line for line in text.splitlines() if line.startswith('| ') and not line.startswith('| source')}
        self.assertIn('| jobijoba.es | AI, pack | read | 6 | 1 | 29 | 1 | - | - | 1 | - | - | 2 (shared page address) | 2 | 2 |', by_source['jobijoba.es'])
        self.assertIn('| infojobs.net | AI | #1: no place left |', by_source['infojobs.net'])   # the named board's own row says why it never read
        self.assertIn('1 page(s) refused', by_source['zaplata.bg'])
        self.assertIn('| employer sites | - | read 4 of 11 sites, best first |', by_source['employer sites'])
        self.assertIn('| Arbeitnow | - | free feed, always read |', by_source['Arbeitnow'])
        self.assertIn('Clocks: list arrived 12 s · board read cut 74 s · last title pass 80 s · last place pass not run · run end 107 s', text)
        self.assertIn('AI calls per stage: decide 2', text)
        self.assertIn('Places left for boards named later: 0 (held by jobijoba.es, airlinejobs.com)', text)

    def test_only_counts_and_hosts_leave(self):
        root = folder(['[5s] Job boards found: x 1 job(s), 1 relevant', f'[6s] Stage: Job boards found kept https://www.a.example/p#{SECRET_TITLE}'],
                      judged=[(SECRET_EMPLOYER, 'Fonio', 'employer feed', 'yes', '')])
        text = board_funnel.table(root)
        for secret in (SECRET_TITLE, SECRET_EMPLOYER, 'https://', '/p#'):
            self.assertNotIn(secret, text)

    def test_a_job_with_its_own_address_merges_nothing(self):
        text = board_funnel.table(folder(['[6s] Stage: Job boards found kept https://www.a.example/p#job:acme--welder--graz']))
        self.assertIn('| 1 (own address) |', text)

    def test_one_job_is_one_key_and_a_job_with_no_link_has_its_own_row(self):
        text = board_funnel.table(folder([
            '[6s] Stage: Job boards found read https://www.a.example/p#Welder',
            '[7s] Stage: Job boards found never_asked https://www.a.example/p#Welder | Berlin, DE',
            '[6s] Stage: Job boards found read -',
            '[6s] Stage: Job boards found read -',
            '[7s] Stage: Job boards found no_link -',
            '[7s] Stage: Job boards found no_link -']))
        rows = {line.split(' | ')[0].strip('| '): line for line in text.splitlines()}
        self.assertIn('| a.example | - | no reason logged | - | - | - | - | - | 1 |', rows['a.example'])   # read + never_asked, one job: counted once as never judged
        self.assertIn('| jobs with no link |', rows['jobs with no link'])
        self.assertIn(' | 2 | ', rows['jobs with no link'])   # two link-less jobs are two, each counted by its verdict line, not by its read line as well

    def test_unmerged_columns_are_named_not_guessed(self):
        text = board_funnel.table(folder(['[1s] Finding your first jobs…']))
        self.assertIn('n/a, this search logged no per-job stage', text)
        self.assertIn('draw/run-1.log is every line the engine printed', text)

    def test_an_unreadable_judge_file_is_not_zero_right_jobs(self):
        root = folder(['[6s] Stage: Job boards found kept https://www.a.example/p#job:acme--welder--graz'])
        (root / 'judged.json').unlink()
        self.assertIn('shown / right: n/a, judged.json is missing or unreadable', board_funnel.table(root))

    def test_a_folder_with_no_log_says_so(self):
        self.assertEqual('No search log in this folder.\n', board_funnel.table(Path(tempfile.mkdtemp())))


class RealRun(unittest.TestCase):
    """A slice of a real search's artifact (c04 Madrid, the PR side of a search pair, 14 Nov 2026; titles, employers and addresses replaced by job-N, hosts kept), counted
    by hand from its lines with grep and sort -u, not by board_funnel. The expected cells below are those hand counts: the 22 round lines include 10 `, the AI read the page,`
    rounds that the first ROUND pattern never matched (InfoJobs and four city sites had no row, airlinejobs read at 66 s with 1 word), found by this very check."""
    FIXTURE = Path(__file__).parent / 'fixtures' / 'board_funnel_c04'

    def cells(self, source):
        text = board_funnel.table(self.FIXTURE)
        for line in text.splitlines():
            if line.startswith(f'| {source} |'):
                return [cell.strip() for cell in line.strip('| ').split('|')]
        self.fail(f'no row for {source}')

    def test_every_round_line_gives_its_board_a_row(self):
        # source: named by, got a place, read at, words, jobs on pages (the hand sums of the log's round lines)
        for source, read_at, words, pages in (('jobijoba.es', '5', '2', '49'), ('airlinejobs.com', '6', '2', '27'), ('infojobs.net', '6', '2', '0'), ('domestiko.com', '40', '1', '10'),
                                              ('gremioempleo.es', '6', '2', '6'), ('jobtoday.com', '6', '2', '5'), ('tecnoempleo.com', '6', '1', '1'), ('mostolesemplea.es', '7', '2', '-'),
                                              ('alcorconemplea.es', '7', '2', '-'), ('portalempleoparla.ayuntamientoparla.es', '39', '2', '-')):
            cells = self.cells(source)
            self.assertEqual((read_at, words), (cells[3], cells[4].split(',')[0]), source)
            if pages != '-':
                self.assertEqual(pages, cells[5], source)
        self.assertEqual('2, 1 page(s) refused', self.cells('trabajos.com')[4])

    def test_the_stage_cells_equal_the_hand_counts(self):
        # kept, kept-then-dropped, never judged, judged no, place out, then shown and right (judged.json rows of the board by hand)
        for source, kept, waiting, no, shown, right in (('jobijoba.es', '47', '-', '2', '8', '8'), ('airlinejobs.com', '22', '-', '5', '2', '2'), ('trabajos.com', '10', '5', '6', '-', '-'),
                                                        ('domestiko.com', '9', '-', '1', '-', '-'), ('gremioempleo.es', '-', '3', '-', '-', '-'), ('jobtoday.com', '2', '1', '-', '-', '-'),
                                                        ('tecnoempleo.com', '1', '-', '-', '-', '-')):
            cells = self.cells(source)
            self.assertEqual((kept, waiting, no, shown, right), (cells[6], cells[8], cells[9], cells[-2], cells[-1]), source)

    def test_a_job_a_feed_lists_twice_counts_once(self):
        cells = self.cells('Arbeitnow')   # 26 never_asked lines, 23 distinct addresses (3 listed twice), 5 placed out
        self.assertEqual(('23', '5'), (cells[8], cells[10]))

    def test_the_judged_jobs_no_board_can_be_told_are_counted_apart(self):
        self.assertIn('21 judged job(s) had no host', board_funnel.table(self.FIXTURE))


if __name__ == '__main__':
    unittest.main()
