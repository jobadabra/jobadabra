"""Guard: privacy — centrally published search counts must never include employer, source, location or job text."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parents[3] / 'tools' / 'persona-search'
sys.path.insert(0, str(HERE))
import gate
import eures_comparison as comparison


class SearchCountsPrivacy(unittest.TestCase):
    def test_night_publishes_fixed_categories_and_no_job_or_source_text(self):
        rows = [dict(title='Private title', company='Private employer', location='Private place',
                     provider=provider, url=url, role='yes', place='yes') for provider, url in [
                         ('EURES', ''), ('Private source', 'https://europa.eu/eures/portal/jv-se/example'),
                         ('Private source', 'https://example.test/job'), ('', '')]]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / 'draw').mkdir()
            (out / 'draw' / 'presses.jsonl').write_text(json.dumps({'seconds': 90, 'code': 0, 'funnel': {'ai_usd': 0}, 'scored_in_places': 4}) + '\n')
            (out / 'judged.json').write_text(json.dumps({'rows': rows}))
            result = gate.result(1, out)
            self.assertEqual(result['relevant_sources'], {'eures': 2, 'other': 1, 'unknown': 1})
            serialized = (out / 'result.json').read_text()
            for private in ('Private title', 'Private employer', 'Private place', 'Private source', 'europa.eu'):
                self.assertNotIn(private, serialized)

    def test_paired_summary_has_counts_without_source_or_job_text(self):
        row = dict(title='Private title', company='Private employer', location='Private place', provider='Private source', role='yes', place='yes')
        result = comparison.summarize({'reference': [row], 'normal': [row], 'without_eures': [row]}, {arm: {'seconds': 90} for arm in ('normal', 'without_eures')})
        serialized = json.dumps(result)
        for private in ('Private title', 'Private employer', 'Private place', 'Private source'):
            self.assertNotIn(private, serialized)
