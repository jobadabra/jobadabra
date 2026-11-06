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

P1 = ['[23s] Places: 1 place words placed', '[62s] ⏳ Reading employer job sites: 0 of 11', '[68s] Titles: asking Claude about 29 job title(s) in your places, in 1 batch(es) of up to 30',
      '[73s] EURES: 146 vacancies in your places read', '[133s] AI decide calls: job site kind for a field 3, pool-country 1, pool-family 1, pool-metro 1, pool-region 1, pool-role 1, role-kind 1']
P10 = ['[52s] EURES: 200 vacancies in your places read', '[53s] ⏳ Reading employer job sites: 15 of 15 · 120 jobs listed', '[133s] AI decide calls: role-kind 1']


class TheLines(unittest.TestCase):
    def test_the_real_lines_of_the_6_nov_night_give_the_counters(self):
        one, ten = funnel.funnel(P1), funnel.funnel(P10)
        self.assertEqual((one['eu_jobs'], one['titles_asked'], one['ai_calls'], one['employer_sites_read']), (146, 29, 9 + 1, 0))   # 9 decide calls + the one title batch
        self.assertEqual((ten['eu_jobs'], ten['titles_asked'], ten['ai_calls'], ten['employer_sites_read']), (200, None, 1, 15))

    def test_a_line_that_never_came_is_not_seen_never_a_zero_in_the_funnel(self):
        quiet = funnel.funnel(['[5s] Places: 1 place words placed'])
        self.assertEqual((quiet['eu_jobs'], quiet['titles_asked'], quiet['ai_calls']), (None, None, None))

    def test_a_read_cut_by_its_time_still_counts_the_jobs_it_kept(self):
        """src/sources/eures.py prints "still reading when its time ended, keeping the N read so far" and returns, so the "vacancies ... read" line never comes: the slow-press shape must not read 0 (review)."""
        got = funnel.funnel(['[150s] EURES: still reading when its time ended, keeping the 87 read so far; the rest waits for the next search'])
        self.assertEqual(got['eu_jobs'], 87)
        failed = funnel.funnel(['[40s] EURES: a page failed (URLError), keeping the 60 read', '[41s] EURES: 60 vacancies in your places read'])
        self.assertEqual(failed['eu_jobs'], 60, 'the failed-page line is followed by the final count: one read, counted once')

    def test_one_vacancy_and_several_title_batches_add_up(self):
        got = funnel.funnel(['[9s] EURES: 1 vacancy in your places read', '[10s] Titles: asking Claude about 30 job title(s) in your places, in 1 batch(es) of up to 30',
                             '[20s] Titles: asking Claude about 5 job title(s) in your places, in 1 batch(es) of up to 30'])
        self.assertEqual((got['eu_jobs'], got['titles_asked'], got['ai_calls']), (1, 35, 2))


class TheRow(unittest.TestCase):
    def press(self, funnel_, first=57):
        out = Path(tempfile.mkdtemp())
        (out / 'draw').mkdir()
        (out / 'draw' / 'presses.jsonl').write_text(json.dumps({'press': 1, 'code': 0, 'billing': 'subscription', 'seconds': 159, 'scored_in_places': 3, 'funnel': funnel_, 'ttfr': {'first_in_places_s': first}}) + '\n')
        return gate.result(1, out)

    def test_a_press_that_ran_carries_the_five_counters_and_a_missing_line_reads_zero(self):
        row = self.press({**funnel.funnel(P1)})
        self.assertEqual(row['counters'], {'eu': 146, 'sites': 0, 'titles': 29, 'ai': 10, 'firstS': 57})
        quiet = self.press({**funnel.funnel([])}, first=None)
        self.assertEqual(quiet['counters'], {'eu': 0, 'sites': 0, 'titles': 0, 'ai': 0, 'firstS': None}, 'a press that ran and logged no EU line read none; no job in its places is "none", not 0 s')

    def test_a_press_that_wrote_no_numbers_claims_nothing(self):
        out = Path(tempfile.mkdtemp())
        self.assertNotIn('counters', gate.result(1, out))

    def test_the_counters_reach_the_verdict_rows_the_site_reads(self):
        counters = {'eu': 146, 'sites': 0, 'titles': 29, 'ai': 10, 'firstS': 57}
        pr = {n: {'persona': n, 'local': 1, 'found': 2, 'seconds': 100, 'code': 0, 'crashes': 0, 'usd': 0, 'billing': 'subscription', 'counters': counters} for n in range(1, len(gate.PERSONAS) + 1)}
        rows = gate.compare(pr, [])['rows']
        self.assertEqual(rows[0]['counters'], counters)
        self.assertIsNone(gate.compare({}, [])['rows'][0]['counters'], 'a persona with no result claims no counters')


if __name__ == '__main__':
    unittest.main()
