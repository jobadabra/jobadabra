# Guard: release — a PR that changes a module a search run imports (src/geo.py, #4280) got no "Moves:" line and no pair, and "All checks passed" went green; tools/pr-body-check.py SEARCH_FILES must name every one.
import ast
import importlib.util
import os
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location('pr_body_check', ROOT / 'tools' / 'pr-body-check.py')
check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check)

# The files a search run starts from: the first-jobs hub, the press, the daily search. What THEY import is what a search run reaches (one hop: a deeper closure is the whole app).
ENTRY = ['src/first_jobs.py'] + sorted(str(p.relative_to(ROOT)) for p in (ROOT / 'src' / 'press').glob('*.py')) + sorted(str(p.relative_to(ROOT)) for p in (ROOT / 'src').glob('daily_search*.py'))

# Imported by a search entry file, but not what a search reads, keeps, scores or orders: the infrastructure it runs on, the store, notices and reports.
# Why (14 Nov 2026, mac-95 via sa): each line needs its reason, so a new import is a decision, never a silent pass. A module here that a search PR really changes belongs in SEARCH_FILES.
NOT_SEARCH = {
    'src/__init__.py': 'package marker', 'src/ai/__init__.py': 'package marker', 'src/notion/__init__.py': 'package marker', 'src/stores/__init__.py': 'package marker',
    'src/ai/budget.py': 'AI spend caps, not a search decision', 'src/ai/cost.py': 'AI cost numbers', 'src/ai/engine.py': 'the AI engine every feature shares',
    'src/ai/decide.py': 'the one way every AI judgment is asked (apply, mail, search): the caller files carry the search change',
    'src/ai/enrich.py': 'AI stage 1 (facts), its prompt is measured by its own case set', 'src/ai/score.py': 'AI stage 2 (fit score), its prompt is measured by its own case set; test_pr_moves keeps it a non-search file',
    'src/ai/insights.py': 'Reports text', 'src/ai/interviews.py': 'interview prep', 'src/ai/kit.py': 'application kit',
    'src/budget_tape.py': 'tape of time-budget decisions (a recorder)', 'src/contribute.py': 'tells the pool which pages an install reads (a report)',
    'src/coverage.py': 'the crawl funnel report', 'src/daily_helpers.py': 'jobs-check helpers', 'src/digest.py': 'the digest message', 'src/doctor.py': 'readiness check',
    'src/features.py': 'optional-feature switches', 'src/jobs_so_far.py': 'shows jobs as sources are read', 'src/ledger_store.py': 'application ledger',
    'src/notification_cards.py': 'notices', 'src/notification_language.py': 'notices', 'src/notify.py': 'notices', 'src/notion/client.py': 'Notion client',
    'src/notion/funnel.py': 'Notion funnel report', 'src/paths.py': 'folders', 'src/read_methods.py': 'counts per read method (a report)', 'src/run_counts.py': 'the run\'s counts line',
    'src/run_details.py': 'what a run saves for Reports', 'src/scout.py': 'the scout grows the feed list outside a press', 'src/source_yield.py': 'yield per source (a report)',
    'src/store.py': 'the store', 'src/store_access.py': 'the store', 'src/stores/beside.py': 'the store', 'src/telegram.py': 'Telegram message',
}


def one_hop():
    """Every src file the entry files import (absolute or relative, at any depth of the file)."""
    found = set()
    for entry in ENTRY:
        package = os.path.dirname(entry).replace('/', '.')
        for node in ast.walk(ast.parse((ROOT / entry).read_text(encoding='utf-8'))):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                base = node.module or ''
                if node.level:
                    parts = package.split('.')[:len(package.split('.')) - (node.level - 1)]
                    base = '.'.join(parts + ([base] if base else []))
                names = [base] + [base + '.' + a.name for a in node.names]
            for name in names:
                if name.startswith('src'):
                    stem = name.replace('.', '/')
                    for candidate in (stem + '.py', stem + '/__init__.py'):
                        if (ROOT / candidate).exists():
                            found.add(candidate)
    return found


class SearchFilesReach(unittest.TestCase):
    def test_every_module_a_search_run_imports_is_listed_or_named_not_search(self):
        loose = sorted(f for f in one_hop() if not check.SEARCH_FILES.match(f) and f not in NOT_SEARCH)
        self.assertEqual(loose, [], 'a search entry file imports these: add each to SEARCH_FILES (tools/pr-body-check.py) or to NOT_SEARCH here with its reason')

    def test_the_not_search_list_has_no_stale_or_contradicting_line(self):
        for name in NOT_SEARCH:
            self.assertTrue((ROOT / name).exists(), f'{name} no longer exists: remove its line')
            self.assertFalse(check.SEARCH_FILES.match(name), f'{name} is in SEARCH_FILES: remove it from NOT_SEARCH')

    def test_the_place_map_is_a_search_file(self):
        self.assertTrue(check.SEARCH_FILES.match('src/geo.py'))


if __name__ == '__main__':
    unittest.main()
