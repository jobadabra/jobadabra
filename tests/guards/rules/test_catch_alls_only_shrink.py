"""Raw catch-alls on the Find jobs search path only shrink (contract C2 of docs/superpowers/specs/2026-11-10-find-jobs-code-shape.md; owner, 10 Nov
2026: "each session that tries to improve a case, does this wihout worsening/affecting other improvements done previosuly").
Why (cr 1/5, sa option c, 10 Nov 2026): an `except Exception` that only warns turns a failure into a silent "0 jobs", so one session's error read as
another's empty result. The one catch-all is src/press/stage.py `guard` (it counts each failure on the run's details); a site that moves to it
leaves this list. A new raw one fails (a lower count passes and says which line to lower): use the guard. Narrowing to named errors comes after the stage runner (sf 7/8), from what the guard counted."""
import ast
import unittest
from pathlib import Path

from tests.guards.rules.test_run_state_only_shrinks import ROOT, SEARCH_PATH

EXEMPT = {'src/press/stage.py'}   # the guard itself

# Measured on main 05c6bfbf, then d24b6d0e (lj #3676 moved one from feeds.py to feed_places.py), 10 Nov 2026; cr 4/5 moved 34 reader sites to the guard: `except Exception` / `except BaseException` / bare, per file. Only shrinks.
KNOWN = {
    'src/press/clock.py': 1,
    'src/sources/board_check.py': 2,
    'src/sources/board_pages.py': 1,
    'src/sources/board_rendered.py': 1,
    'src/sources/careers.py': 2,
    'src/sources/careers_explore.py': 1,
    'src/sources/describe.py': 2,
    'src/sources/eures.py': 1,
    'src/sources/feed_places.py': 2,
    'src/sources/feed_scan.py': 2,
    'src/sources/feeds.py': 6,
    'src/sources/found_boards.py': 3,
    'src/sources/google.py': 5,
    'src/sources/google_jobs.py': 2,
    'src/sources/job_alerts.py': 2,
    'src/sources/late_reads.py': 1,
    'src/sources/nuts_names.py': 1,
    'src/sources/page_recipes.py': 1,
    'src/sources/read_budget.py': 1,
    'src/sources/render.py': 2,
    'src/sources/visits.py': 1,
    'src/sources/visits_jobpages.py': 3,
    'src/sources/visits_read.py': 1,
    'src/sources/web_answers.py': 1,
    'src/sources/web_search.py': 4,
    'src/ai/added.py': 1,
    'src/ai/apply_batch.py': 1,
    'src/ai/apply_record.py': 1,
    'src/ai/apply_run.py': 2,
    'src/ai/board_ideas.py': 2,
    'src/ai/budget.py': 1,
    'src/ai/call_log.py': 1,
    'src/ai/decide.py': 1,
    'src/ai/inbox.py': 1,
    'src/ai/inbox_notion.py': 4,
    'src/ai/interview_insights.py': 4,
    'src/ai/interviews.py': 1,
    'src/ai/kit.py': 4,
    'src/ai/mail.py': 1,
    'src/ai/mail_calendar.py': 2,
    'src/ai/mail_inbox.py': 1,
    'src/ai/mail_leads.py': 4,
    'src/ai/mail_sent.py': 3,
    'src/ai/mail_triage.py': 1,
    'src/ai/opportunity.py': 2,
    'src/ai/page_reader.py': 2,
    'src/ai/place_triage.py': 2,
    'src/ai/prep.py': 9,
    'src/ai/provenance.py': 1,
    'src/ai/reassign.py': 1,
    'src/ai/rejection.py': 1,
    'src/ai/role_ideas.py': 2,
    'src/ai/score.py': 1,
    'src/ai/score_search.py': 1,
    'src/ai/scout_ideas.py': 2,
    'src/ai/slots.py': 1,
    'src/ai/title_queue.py': 3,
    'src/ai/title_triage.py': 1,
    'src/first_jobs.py': 8,
    'src/daily_search.py': 16,
    'src/daily_search_reporting.py': 7,
    'src/daily_search_scoring.py': 6,
    'src/read_methods.py': 6,
    'src/places.py': 1,
    'src/employer_index.py': 3,
}


def catch_alls(source):
    """How many except clauses of `source` catch everything (bare, Exception or BaseException, alone or in a tuple)."""
    def broad(kind):
        if kind is None:
            return True
        if isinstance(kind, ast.Name):
            return kind.id in ('Exception', 'BaseException')
        return isinstance(kind, ast.Tuple) and any(broad(item) for item in kind.elts)
    return sum(1 for node in ast.walk(ast.parse(source)) if isinstance(node, ast.ExceptHandler) and broad(node.type))


class CatchAllsOnlyShrinkTest(unittest.TestCase):
    def test_the_counter_sees_every_kind_of_catch_all(self):
        source = ('try:\n    a()\nexcept Exception:\n    pass\ntry:\n    a()\nexcept:\n    pass\ntry:\n    a()\nexcept (OSError, BaseException):\n    pass\n'
                  'try:\n    a()\nexcept (OSError, ValueError):\n    pass\n')
        self.assertEqual(catch_alls(source), 3)   # the named pair is not one

    def test_no_new_catch_all_on_the_search_path(self):
        seen = {}
        for pattern in SEARCH_PATH:
            for path in sorted(ROOT.glob(pattern)):
                name = path.relative_to(ROOT).as_posix()
                count = catch_alls(path.read_text(encoding='utf-8'))
                if count and name not in EXEMPT:
                    seen[name] = count
        for name in sorted(set(seen) | set(KNOWN)):
            with self.subTest(name):
                now, known = seen.get(name, 0), KNOWN.get(name, 0)
                self.assertLessEqual(now, known, f'{name}: {now} catch-alls, {known} known; a failure goes through src/press/stage.py guard (it is counted), not a new except Exception. '
                                     'A catch-all moved here from another file: move its KNOWN entry with it')
                if now < known:   # Why (sf on #3679): a PR that removes one must not race the others on merge order; a later PR lowers the number
                    print(f'lower {name} to {now} in KNOWN of {Path(__file__).name}')


if __name__ == '__main__':
    unittest.main()
