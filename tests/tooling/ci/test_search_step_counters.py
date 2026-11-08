"""Guard: data — the nightly Search check's per-step counters (owner, 6 Nov 2026: "go ahead. Fix the search"): the numbers the Night search tab compares against each candidate's own last 7 nights come from the
press's own log lines, pinned below as the real lines of run 42152934954 (p1 and p10), so a wording change in src/ fails here instead of turning every counter to 0 on the tab."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import funnel  # noqa: E402
import gate  # noqa: E402
from src.press import step_yield  # noqa: E402   (the writer of the table funnel.step_yield reads)

P1 = ['[23s] Places: 1 place words placed', '[62s] ⏳ Reading employer job sites: 0 of 11', '[68s] Titles: asking Claude about 29 job title(s) in your places, in 1 batch(es) of up to 30',
      '[73s] EURES: 146 vacancies in your places read', '[112s] Titles: Claude sorted 29 new title(s) in your places; 9 could fit your search', '[136s] ⏳ Reading employer job sites: 0 of 3']   # p1's real lines (no "AI decide calls": it is printed at exit)
P10 = ['[52s] EURES: 200 vacancies in your places read', '[52s] ⏳ Reading employer job sites: 0 of 15', '[54s] ⏳ Reading employer job sites: 15 of 15 · 1,862 jobs listed',
       '[133s] AI decide calls: job site kind for a field 3, pool-country 1, pool-family 1, pool-metro 1, pool-region 1, pool-role 1, role-kind 1']   # p10's real lines


class TheLines(unittest.TestCase):
    def test_the_real_lines_of_the_6_nov_night_give_the_counters(self):
        one, ten = funnel.funnel(P1), funnel.funnel(P10)
        self.assertEqual((one['eu_jobs'], one['titles_asked'], one['ai_calls'], one['employer_sites_read']), (146, 29, 1, 0))   # the one title batch; p1's log has no decide line
        self.assertEqual((ten['eu_jobs'], ten['titles_asked'], ten['ai_calls'], ten['employer_sites_read']), (200, None, 9, 15))   # nine decide calls: 3 + six topics of 1

    def test_a_line_that_never_came_is_not_seen_never_a_zero_in_the_funnel(self):
        quiet = funnel.funnel(['[5s] Places: 1 place words placed'])
        self.assertEqual((quiet['eu_jobs'], quiet['titles_asked'], quiet['ai_calls']), (None, None, None))

    def test_a_read_cut_by_its_time_still_counts_the_jobs_it_kept(self):
        """src/sources/eures.py prints "still reading when its time ended, keeping the N read so far" and returns, so the "vacancies ... read" line never comes: the slow-press shape must not read 0 (review)."""
        got = funnel.funnel(['[150s] EURES: still reading when its time ended, keeping the 87 read so far; the rest waits for the next search'])
        self.assertEqual(got['eu_jobs'], 87)
        failed = funnel.funnel(['[40s] EURES: a page failed (URLError), keeping the 60 read', '[41s] EURES: 60 vacancies in your places read'])
        self.assertEqual(failed['eu_jobs'], 60, 'the failed-page line is followed by the final count: one read, counted once')

    def test_titles_and_ai_calls_count_what_was_answered_not_what_was_planned(self):
        """Gitar on #3353: "Titles: asking ... about 90 job title(s)... in 3 batch(es)" is printed before any batch runs; when the search's time is up the rest are skipped. Only the closing "sorted N" line counts."""
        slow = funnel.funnel(['[40s] Titles: asking Claude about 90 job title(s) in your places, in 3 batch(es) of up to 30', '[150s] Titles: Claude sorted 30 new title(s) in your places; 2 could fit your search'])
        self.assertEqual((slow['titles_asked'], slow['ai_calls']), (30, 1), 'one batch ran of three planned')
        cut = funnel.funnel(['[40s] Titles: asking Claude about 90 job title(s) in your places, in 3 batch(es) of up to 30'])
        self.assertEqual((cut['titles_asked'], cut['ai_calls']), (None, None), 'killed before the closing line: nothing was answered (0 on the tab, a fall)')
        full = funnel.funnel(['[60s] Titles: Claude sorted 61 new title(s) in your places; 9 could fit your search'])
        self.assertEqual((full['titles_asked'], full['ai_calls']), (61, 3), '61 titles are 3 batches of up to 30')

    def test_one_vacancy_counts(self):
        self.assertEqual(funnel.funnel(['[9s] EURES: 1 vacancy in your places read'])['eu_jobs'], 1)


class TheRow(unittest.TestCase):
    def press(self, funnel_, first=57):
        out = Path(tempfile.mkdtemp())
        (out / 'draw').mkdir()
        (out / 'draw' / 'presses.jsonl').write_text(json.dumps({'press': 1, 'code': 0, 'billing': 'subscription', 'seconds': 159, 'scored_in_places': 3, 'funnel': funnel_, 'ttfr': {'first_in_places_s': first}}) + '\n')
        return gate.result(1, out)

    def test_a_press_that_ran_carries_the_five_counters_and_a_missing_line_reads_zero(self):
        row = self.press({**funnel.funnel(P1)})
        self.assertEqual(row['counters'], {'eu': 146, 'sites': 0, 'titles': 29, 'ai': 1, 'firstS': 57})
        quiet = self.press({**funnel.funnel([])}, first=None)
        self.assertEqual(quiet['counters'], {'eu': 0, 'sites': 0, 'titles': 0, 'ai': 0, 'firstS': None}, 'a press that ran and logged no EU line read none; no job in its places is "none", not 0 s')

    def test_a_press_that_wrote_no_numbers_claims_nothing(self):
        out = Path(tempfile.mkdtemp())
        self.assertNotIn('counters', gate.result(1, out))

    def test_the_counters_reach_the_verdict_rows_the_site_reads(self):
        counters = {'eu': 146, 'sites': 0, 'titles': 29, 'ai': 1, 'firstS': 57}
        pr = {n: {'persona': n, 'local': 1, 'found': 2, 'seconds': 100, 'code': 0, 'crashes': 0, 'usd': 0, 'billing': 'subscription', 'counters': counters} for n in range(1, len(gate.PERSONAS) + 1)}
        rows = gate.compare(pr, [])['rows']
        self.assertEqual(rows[0]['counters'], counters)
        self.assertIsNone(gate.compare({}, [])['rows'][0]['counters'], 'a persona with no result claims no counters')


class TheStepYield(unittest.TestCase):
    """8 Nov 2026, owner: "Can I get in Admin these stats as well?": each press row carries the step yield the engine saved in the persona's own job cache (src/press/step_yield.py)."""
    ROWS = [{'step': 'employer_sites', 'seconds': None, 'jobs': 12, 'local': 9, 'scored': 7, 'fit70': 3, 'local_fit70': 2},
            {'step': 'scoring', 'seconds': 31.5, 'jobs': 50, 'local': 40, 'scored': 50, 'fit70': 18, 'local_fit70': 15}]

    def cache(self, runs):
        import sqlite3
        path = Path(tempfile.mkdtemp()) / 'jobs.sqlite'
        db = sqlite3.connect(path)
        for run_at, rows in runs:
            step_yield.record(db, run_at, rows)
        db.close()
        return path

    def test_the_newest_run_since_the_press_started_is_read_back_as_the_writer_saved_it(self):
        path = self.cache([('2026-11-08T09:00:00+00:00', [{**self.ROWS[0], 'jobs': 1}]), ('2026-11-08T10:05:00+00:00', self.ROWS)])
        self.assertEqual(funnel.step_yield('2026-11-08T10:00:00', db=path), self.ROWS, 'an earlier night run is not this press')
        self.assertIsNone(funnel.step_yield('2026-11-08T11:00:00', db=path), 'no run since: nothing is claimed')

    def test_no_table_no_cache_or_a_build_before_the_table_claims_nothing_never_zeros(self):
        self.assertIsNone(funnel.step_yield('2026-11-08T10:00:00', db=Path(tempfile.mkdtemp()) / 'none.sqlite'))
        import sqlite3
        path = Path(tempfile.mkdtemp()) / 'old.sqlite'
        sqlite3.connect(path).close()
        self.assertIsNone(funnel.step_yield('2026-11-08T10:00:00', db=path))

    def test_the_step_yield_reaches_the_verdict_rows_the_site_reads(self):
        out = Path(tempfile.mkdtemp())
        (out / 'draw').mkdir()
        (out / 'draw' / 'presses.jsonl').write_text(json.dumps({'press': 1, 'code': 0, 'billing': 'subscription', 'seconds': 159, 'scored_in_places': 3, 'funnel': {**funnel.funnel(P1), 'step_yield': self.ROWS}, 'ttfr': {}}) + '\n')
        row = gate.result(1, out)
        self.assertEqual(row['step_yield'], self.ROWS)
        rows = gate.compare({n: {**row, 'persona': n} for n in range(1, len(gate.PERSONAS) + 1)}, [])['rows']
        self.assertEqual(rows[0]['step_yield'], self.ROWS)
        self.assertIsNone(gate.compare({}, [])['rows'][0]['step_yield'], 'a persona with no result claims no step yield')


if __name__ == '__main__':
    unittest.main()
