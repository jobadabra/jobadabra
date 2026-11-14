"""Guard: no stage of the Find jobs pipeline sorts for priority outside src/press/rank.py (plan 5/6, docs/superpowers/plans/2026-11-07-the-press.md).
Why (owner, 7 Nov 2026: "one agent fixes an issue, then comes another agent and tries to improve the speed and moves that logic" · "we overwrite one another and we never get it right"):
"X first" was decided in 11 places, each with its own sort key; "your places first" alone was built in 7 places in 20 days (#3305, #3336, #3422, #3482, #3550, #3551, #2918), the last
ones overwriting the earlier. A stage file now names weights from rank.py (rank.sources / rank.titles / rank.jobs and their weights) and never calls `sorted`, `.sort`, `heapq` or
`min/max(key=)` itself. The allow-list below holds today's other sorts (a dedupe, a display order, a cache key); it only shrinks: an entry whose call is gone fails, and a
`debt` entry is a priority sort that has not moved yet (remove it by moving it into rank.py). Changing a weight's number is a behaviour PR with the yardstick table, not this file."""
import ast
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]

# The files that decide what a Find jobs run reads, places, asks and scores, and in what order (spec "The orderings today" + the stage files of plan 2/6).
STAGE_FILES = [
    'src/employer_index.py', 'src/source_rank.py', 'src/first_jobs.py', 'src/time_budget.py', 'src/daily_search_scoring.py', 'src/places.py',
    'src/sources/read_budget.py', 'src/sources/eures.py', 'src/sources/feed_order.py', 'src/sources/feed_scan.py', 'src/sources/boards_first.py',
    'src/sources/boards_ahead.py', 'src/sources/aggregators.py', 'src/sources/feeds.py', 'src/sources/boards.py', 'src/sources/found_boards.py',
    'src/sources/board_web.py', 'src/sources/web_search.py', 'src/sources/visits.py',
    'src/ai/title_triage.py', 'src/ai/title_queue.py', 'src/ai/place_triage.py', 'src/ai/score.py', 'src/ai/enrich.py', 'src/ai/slots.py',
]

# (file, the call's source) -> why it is not a priority; 'debt: ' marks a priority sort not moved yet (the list only shrinks).
ALLOWED = {
    ('src/source_rank.py', 'sorted(dead - set(proven))'): 'display: the proven-dead listed by name',
    ('src/sources/eures.py', 'sorted(table.items())'): 'the table printed for the AI prompt, by code',
    ('src/sources/eures.py', 'sorted(codes, key=len, reverse=True)'): 'the most specific code names the area, not a read order',
    ('src/sources/eures.py', 'sorted(c for c in table if len(c) > len(area) and c.startswith(area))'): "an area's parts listed by code in one request",
    ('src/ai/title_triage.py', "sorted(str(w) for w in search.get('role_keywords') or [])"): 'a cache key: the same words in any order',
    ('src/ai/title_triage.py', "sorted(str(w) for w in search.get('title_exclude_keywords') or [])"): 'a cache key: the same words in any order',
    ('src/sources/feed_scan.py', 'report["jobs"].sort(key=lambda j: ({"new": 0, "changed": 1, "seen": 2}[j["status"]], j["company"], j["title"]))'): 'display: the report of what was read',
    ('src/sources/aggregators.py', "sorted(map(str, search.get('role_keywords') or []))"): 'a cache key',
    ('src/sources/aggregators.py', "sorted(map(str, search.get('jobs_board_search_queries') or []))"): 'a cache key',
    ('src/sources/aggregators.py', "sorted(map(str, places.get(key) or []))"): 'a cache key',
    ('src/sources/aggregators.py', 'sorted(places)'): 'a cache key',
    ('src/ai/place_triage.py', 'sorted(set(countries.values()))'): 'a request text: the countries listed once, by name',
    ('src/sources/feeds.py', 'sorted(until for _, until in rows if until and until > now)'): 'display: when the first resting feed returns',
    ('src/sources/feeds.py', 'max(left, key=lambda k: (left[k], -k))'): 'the most common count of runs left, not a read order',
    ('src/sources/boards.py', 'sorted(found, key=lambda u: (bool(urlsplit(u).fragment), len(urlsplit(u).path)))'): 'debt: which URL of a board is its jobs page (a choice of one, not the run order)',
    ('src/sources/boards.py', "report['companies'].sort(key=lambda c:(not bool(c['career_pages']),-(c['min_employees'] or 0),c['company']))"): 'display: the companies report',
    ('src/sources/boards.py', 'sorted(roles)'): 'a cache key',
    ('src/sources/visits.py', "sorted(kept, key=lambda item: (item['kind'] != 'employer', item['last_read'] or ''))"): "debt: the visit list's order (employers first, the least recently read first); move it into rank.py",
    ('src/sources/visits.py', 'sorted(numbers)'): "the AI's numbers read in list order",
    ('src/sources/visits.py', "sorted(i['url'] for i in items)"): 'a cache key',
    ('src/sources/visits.py', 'sorted(roles)'): 'a cache key',
}


def _sites(path):
    """[(call source, line)] of every priority-shaped call in the file: sorted(), .sort(), heapq.x() and min()/max() with a key."""
    source = (ROOT / path).read_text()
    found = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        name = func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else ''
        base = func.value.id if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name) else ''
        if name in ('sorted', 'sort') or base == 'heapq' or (name in ('min', 'max') and any(k.arg == 'key' for k in node.keywords)):
            found.append((' '.join((ast.get_source_segment(source, node) or '').split()), node.lineno))
    return found


class OneRankerTest(unittest.TestCase):
    def test_no_stage_file_sorts_for_priority_outside_rank_py(self):
        loose = [f'{path}:{line}  {call[:110]}' for path in STAGE_FILES for call, line in _sites(path) if (path, call) not in ALLOWED]
        self.assertEqual(loose, [], 'a stage file sorts by itself: name the weight in src/press/rank.py and call rank.sources / rank.titles / rank.jobs '
                                    '(a sort that is not a priority, such as a cache key or a display order, goes on ALLOWED with its reason)')

    def test_the_allow_list_only_shrinks(self):
        present = {(path, call) for path in STAGE_FILES for call, _ in _sites(path)}
        self.assertEqual(sorted(set(ALLOWED) - present), [], 'an ALLOWED entry whose call is gone or changed: remove it (the list only shrinks)')

    def test_no_stage_file_imports_heapq(self):
        """`from heapq import heappush` or `import heapq as h` would slip past the call scan: the heap calls live in rank.py (rank.push / pop / reorder)."""
        imports = []
        for path in STAGE_FILES:
            for node in ast.walk(ast.parse((ROOT / path).read_text())):
                if (isinstance(node, ast.Import) and any(a.name == 'heapq' for a in node.names)) or (isinstance(node, ast.ImportFrom) and node.module == 'heapq'):
                    imports.append(f'{path}:{node.lineno}')
        self.assertEqual(imports, [], 'a stage file imports heapq: use rank.push / rank.pop / rank.reorder')

    def test_every_stage_file_exists(self):
        self.assertEqual([path for path in STAGE_FILES if not (ROOT / path).exists()], [], 'a renamed stage file leaves the guard blind: update STAGE_FILES')

    def test_rank_py_is_where_the_sorts_live(self):
        self.assertTrue(any(call.startswith('sorted(') for call, _ in _sites('src/press/rank.py')), 'rank.py sorts')


if __name__ == '__main__':
    unittest.main()
