"""Guard: release — the night measures 2 runs per person (owner, 11 Nov 2026: "2 runs nightly, 5 runs weekly (Recommended)"; "each of the runs should provide new
jobs"): a job the first run listed must never count as new on the second, every number that existed before (right jobs, per source, in = out, the floors' `right`)
must stay the first run's, and a measured 0 new on run 2 is a 0, never grey. tools/persona-search/runs.py + gate.extract's first_seen + floors' runs series."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools/persona-search'))
import floors  # noqa: E402
import gate  # noqa: E402
import runs  # noqa: E402
import scoreboard  # noqa: E402

RUN1, RUN2 = '2026-11-11T00:00:00.250Z', '2026-11-11T00:04:30.900Z'


def stored(writes):
    """Jobs written through the real store at the given times (src/store.py upsert_job `now`), then gate.extract's rows: [(title, url, reader, now)]."""
    from src import store
    with tempfile.TemporaryDirectory() as tmp:
        db = store.connect(os.path.join(tmp, 'jobs.sqlite'))
        for title, url, reader, now in writes:
            store.upsert_job(db, {'company': 'Acme', 'title': title, 'url': url, 'location': 'Lyon'}, reader, now=now)
        db.commit()
        db.close()
        return gate.extract(os.path.join(tmp, 'jobs.sqlite'), os.path.join(tmp, 'jobs.json'))


def person(tmp, rows, presses):
    """A person's out folder: draw/presses.jsonl and the judge's judged.json."""
    out = Path(tmp)
    (out / 'draw').mkdir(parents=True, exist_ok=True)
    (out / 'draw' / 'presses.jsonl').write_text(''.join(json.dumps(p) + '\n' for p in presses), encoding='utf-8')
    (out / 'judged.json').write_text(json.dumps({'judged_jobs': len(rows), 'rows': rows}), encoding='utf-8')
    return out


def judged(rows, wrong=()):
    return [{**row, 'role': 'no' if row['title'] in wrong else 'yes', 'place': 'yes'} for row in rows]


TWO = [{'press': 1, 'started': RUN1, 'seconds': 170}, {'press': 2, 'started': RUN2, 'seconds': 120}]


class Split(unittest.TestCase):
    def test_a_job_the_first_run_listed_is_never_new_on_the_second(self):
        rows = stored([('Joiner A', 'https://a.example/1', 'Board', '2026-11-11T00:01:00+00:00'),
                       ('Joiner B', 'https://a.example/2', 'Board', '2026-11-11T00:02:00+00:00'),
                       ('Joiner A', 'https://a.example/1?utm=x', 'Board', '2026-11-11T00:05:00+00:00'),   # the same link again on run 2: the store keeps run 1's time
                       ('Joiner B', 'https://b.example/9', 'Other feed', '2026-11-11T00:05:10+00:00'),    # the same job from another reader on run 2
                       ('Joiner C', 'https://a.example/3', 'Board', '2026-11-11T00:06:00+00:00'),
                       ('Welder D', 'https://a.example/4', 'Board', '2026-11-11T00:06:30+00:00')])
        with tempfile.TemporaryDirectory() as tmp:
            out = person(tmp, judged(rows, wrong={'Welder D'}), TWO)
            (out / 'jobs.json').write_text(json.dumps(rows), encoding='utf-8')   # what gate.extract wrote: every listed job of both runs
            found = runs.split(out)
            kept = json.loads((out / 'judged.json').read_text(encoding='utf-8'))
            every = json.loads((out / 'judged-all.json').read_text(encoding='utf-8'))
            listed = json.loads((out / 'jobs.json').read_text(encoding='utf-8'))
            listed_all = json.loads((out / 'jobs-all.json').read_text(encoding='utf-8'))
        self.assertEqual(found, [{'run': 1, 'new_listed': 2, 'new_right': 2, 'right_after': 2, 'seconds': 170}, {'run': 2, 'new_listed': 2, 'new_right': 1, 'right_after': 3, 'seconds': 120}])
        self.assertEqual(sorted(r['title'] for r in kept['rows']), ['Joiner A', 'Joiner B'], 'judged.json: the first run only, so every older number stays the first run\'s')
        self.assertEqual(kept['judged_jobs'], 2)
        self.assertEqual({r['title']: r['run'] for r in every['rows']}, {'Joiner A': 1, 'Joiner B': 1, 'Joiner C': 2, 'Welder D': 2})
        self.assertEqual(sorted(j['title'] for j in listed), ['Joiner A', 'Joiner B'], 'Gitar on #3781: in = out reads jobs.json\'s links, so it holds run 1 only')
        self.assertEqual(len(listed_all), 4)

    def test_each_of_more_runs_counts_what_it_listed_first(self):
        """The weekly presses 5 times in a row (2/3); any run count splits the same way."""
        three = TWO + [{'press': 3, 'started': '2026-11-11T00:09:00Z', 'seconds': 100}]
        one = lambda title, seen: {'title': title, 'company': 'Acme', 'location': 'Lyon', 'first_seen': seen}
        rows = judged([one('A', '2026-11-11T00:01:00+00:00'), one('B', '2026-11-11T00:05:00+00:00'), one('C', '2026-11-11T00:09:00+00:00'),
                       one('D', '2026-11-11T00:10:00+00:00')], wrong={'D'})
        with tempfile.TemporaryDirectory() as tmp:
            found = runs.split(person(tmp, rows, three))
        self.assertEqual([(r['run'], r['new_listed'], r['new_right'], r['seconds']) for r in found], [(1, 1, 1, 170), (2, 1, 1, 120), (3, 2, 1, 100)])

    def test_two_stored_rows_of_one_judged_job_belong_to_the_earlier_run(self):
        """The store kept two rows the judge reads as one job (gate_judge.key: title, employer, place): the job is run 1's, its run-2 copy is not new."""
        one = {'title': 'Joiner A', 'company': 'Acme', 'location': 'Lyon'}
        rows = judged([{**one, 'first_seen': '2026-11-11T00:05:00+00:00'}, {**one, 'first_seen': '2026-11-11T00:01:00+00:00'}])
        with tempfile.TemporaryDirectory() as tmp:
            found = runs.split(person(tmp, rows, TWO))
        self.assertEqual([(r['new_listed'], r['new_right']) for r in found], [(1, 1), (0, 0)])

    def test_one_press_or_an_older_press_row_leaves_the_judge_answer_as_it_was(self):
        rows = judged([{'title': 'Joiner A', 'company': 'Acme', 'location': 'Lyon', 'first_seen': '2026-11-11T00:06:00+00:00'}])
        for presses in ([{'press': 1, 'started': RUN1, 'seconds': 170}], [{'press': 1, 'seconds': 170}, {'press': 2, 'seconds': 99}]):
            with self.subTest(presses=presses), tempfile.TemporaryDirectory() as tmp:
                out = person(tmp, rows, presses)
                before = (out / 'judged.json').read_text(encoding='utf-8')
                found = runs.split(out)
                self.assertEqual(found[0]['new_right'], 1)
                self.assertEqual(len(found), 1, 'no start times: everything is run 1')
                self.assertEqual((out / 'judged.json').read_text(encoding='utf-8'), before)
                self.assertFalse((out / 'judged-all.json').exists())

    def test_a_press_without_a_start_time_says_so_and_counts_every_job_as_run_one(self):
        """Gitar on #3781: one press without `started` (a resumed run from an older run.mjs) cannot be split; the log says which press, never a silent one-run person."""
        import contextlib
        import io
        rows = judged([{'title': 'A', 'company': 'Acme', 'location': 'Lyon', 'first_seen': '2026-11-11T00:06:00+00:00'}])
        said = io.StringIO()
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(said):
            found = runs.split(person(tmp, rows, [TWO[0], {'press': 2, 'seconds': 120}]))
        self.assertEqual([r['run'] for r in found], [1])
        self.assertIn('press 2 has no start time', said.getvalue())

    def test_each_run_says_the_right_jobs_found_so_far_each_job_once(self):
        """The week (2/3; owner, 11 Nov 2026: "each of the runs should provide new jobs"): right_after is the right jobs of runs 1..n, a job listed again counted once."""
        three = TWO + [{'press': 3, 'started': '2026-11-11T00:09:00Z', 'seconds': 100}]
        one = lambda title, seen: {'title': title, 'company': 'Acme', 'location': 'Lyon', 'first_seen': seen}
        rows = judged([one('A', '2026-11-11T00:01:00+00:00'), one('A', '2026-11-11T00:09:30+00:00'), one('B', '2026-11-11T00:05:00+00:00'),
                       one('C', '2026-11-11T00:09:10+00:00'), one('D', '2026-11-11T00:10:00+00:00')], wrong={'D'})
        with tempfile.TemporaryDirectory() as tmp:
            found = runs.split(person(tmp, rows, three))
        self.assertEqual([(r['new_right'], r['right_after']) for r in found], [(1, 1), (1, 2), (1, 3)])

    def test_the_cli_never_fails_the_person_without_a_judge_answer(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(os.system(f'python3 {ROOT}/tools/persona-search/runs.py split {tmp} > /dev/null'), 0)


class Night(unittest.TestCase):
    def test_a_measured_zero_on_run_two_is_a_zero_never_grey(self):
        """sa, 11 Nov 2026: run 2 meets rested sources today, so 0 is the honest baseline the lanes must move."""
        rows = [{'runs': [{'run': 1, 'new_right': 5}, {'run': 2, 'new_right': 0}]}, {'runs': [{'run': 1, 'new_right': 2}, {'run': 2, 'new_right': 3}]},
                {'runs': [{'run': 1, 'new_right': 9}, {'run': 2, 'new_right': 4}], 'not_run': True}, {'runs': [{'run': 1, 'new_right': 1}]}]
        self.assertEqual(runs.night(rows), {'measured': 2, 'people_new_on_2': 1, 'right_after_2': 10})
        self.assertEqual(runs.night([{'runs': [{'run': 1, 'new_right': 0}, {'run': 2, 'new_right': 0}]}]), {'measured': 1, 'people_new_on_2': 0, 'right_after_2': 0})
        self.assertIsNone(runs.night([{'runs': [{'run': 1, 'new_right': 4}]}, {}]), 'a one-run night says nothing about run 2')

    def test_the_week_says_for_each_run_how_many_people_it_gave_new_right_jobs(self):
        """The week's 5 runs (2/3): per run, the people measured on it, how many got at least one new right job, and those jobs; a measured 0 is a 0."""
        week = lambda *new: {'runs': [{'run': n, 'new_right': v} for n, v in enumerate(new, 1)]}
        rows = [week(4, 1, 0, 0, 2), week(3, 0, 0, 1, 0), {**week(9, 9, 9, 9, 9), 'not_measured': True}, week(2, 0, 0)]
        self.assertEqual(runs.by_run(rows), [{'run': 1, 'measured': 3, 'people_new': 3, 'new_right': 9}, {'run': 2, 'measured': 3, 'people_new': 1, 'new_right': 1},
                                             {'run': 3, 'measured': 3, 'people_new': 0, 'new_right': 0}, {'run': 4, 'measured': 2, 'people_new': 1, 'new_right': 1},
                                             {'run': 5, 'measured': 2, 'people_new': 1, 'new_right': 2}])
        self.assertIsNone(runs.by_run([week(4), {}]), 'one run says nothing run by run')

    def test_the_floors_keep_a_two_run_night_in_its_own_series_and_read_new_on_two(self):
        verdict = {'eures': 'off', 'personas': {'1': {'runs': [{'run': 1, 'new_right': 3}, {'run': 2, 'new_right': 1}]}}}
        key = floors.series_key(verdict, 'codex,claude')
        self.assertTrue(key.endswith('|eures-off|runs-2'), key)
        short_first = {'eures': 'off', 'personas': {'1': {'runs': [{'run': 1, 'new_right': 2}]}, '2': verdict['personas']['1']}}
        self.assertTrue(floors.series_key(short_first, 'codex,claude').endswith('|runs-2'), 'Gitar on #3781: one person who lost a press never moves the night into the 1-run series')
        self.assertFalse(floors.series_key({'eures': 'off', 'personas': {'1': {}}}, 'codex,claude').endswith('runs-2'), 'a one-run night keeps the older key')
        for k in (key, key.removesuffix('|runs-2')):
            self.assertEqual(floors.validate({'version': 1, 'series': {k: {'people': {}, 'last_green': None}}}), [], k)
        self.assertNotEqual(floors.validate({'version': 1, 'series': {key.replace('runs-2', 'runs-5'): {'people': {}, 'last_green': None}}}), [],
                            'the weekly 5 runs keep their own record, never a floors series')
        self.assertEqual(floors.NUMBERS['new_on_2'][0](verdict['personas']['1']), 1)
        week = {'eures': 'off', 'personas': {'1': {'runs': [{'run': n, 'new_right': 1} for n in range(1, 6)]}}, 'rows': [{'persona': 1, 'kind': 'measured'}]}
        state, report = floors.update(None, week, 'codex,claude', '1', '2026-11-12')
        self.assertEqual((report['checked'], state['series']), (False, {}), 'Gitar on #3781: a 5-run week is never a floors series, so the save is never refused')
        self.assertIsNone(floors.NUMBERS['new_on_2'][0]({'runs': [{'run': 1, 'new_right': 3}]}))

    def test_the_lock_holds_how_many_runs_a_night_presses(self):
        """A later 2 -> 1 changes what the night measures: S1 reads the `presses` input's default, so it needs the owner's words (G3)."""
        self.assertEqual(json.loads(scoreboard.people())['runs'], 2)


if __name__ == '__main__':
    unittest.main()
