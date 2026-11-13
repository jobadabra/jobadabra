"""Guard: data — the words and fields that decide a fit may not change without a new rules version, or every score made under the old rules stays unmarked.
13 Nov 2026 (owner: "Re-score scores made before a rule change"): the licence cap of 7 Nov (#3357, #3361) and the 26 Oct role-check lifts changed what a score means
and score.SCORER_VERSION stayed 2, so the owner's pilot scores (70 to 85) were never marked old. Escapes in the last 30 days: 5 rule changes in src/ai/score_search.py
(f61b347d, b4142398, 0c7c2c40 on 26 Oct, 5a304405, f15c6d83 on 7 Nov), none with a new version.
The lock (tests/fixtures/scorer-rules.lock.json) holds the version and the fingerprint of what decides a fit: the scorer's prompt, its answer fields and the
score_search.apply rule (what a career change shows). A change to them fails here until the lock is written again: raise score.SCORER_VERSION when what a score MEANS changed (a cap, a band, a
lift, a field the fit reads), and only the fingerprint when it did not (a typo)."""
import hashlib
import inspect
import json
import unittest
from pathlib import Path

from src.ai import score, score_search

LOCK = Path(__file__).resolve().parents[2] / 'fixtures' / 'scorer-rules.lock.json'


def fingerprint():
    return hashlib.sha256((score.SYSTEM + json.dumps(score.SCHEMA, sort_keys=True) + inspect.getsource(score_search.apply)).encode()).hexdigest()


class ScorerRulesVersionTests(unittest.TestCase):
    def test_what_decides_a_fit_changed_only_with_a_new_version(self):
        lock = json.loads(LOCK.read_text())
        now = {'version': score.SCORER_VERSION, 'fingerprint': fingerprint()}
        if lock == now:
            return
        if lock['version'] == now['version']:
            self.fail(f'The scorer\'s prompt, fields or apply rule changed (fingerprint {now["fingerprint"]}). If a score now MEANS something else (a cap, a band, a lift), '
                      f'raise score.SCORER_VERSION: every older score is then marked and re-scored by Re-score. If not (a typo), only write the new fingerprint into {LOCK.name}.')
        self.assertEqual(lock['version'] + 1, now['version'], 'one step at a time: the lock names the version the fingerprint belongs to')
        self.fail(f'score.SCORER_VERSION is {now["version"]} now: write {json.dumps(now)} into {LOCK.name}.')


if __name__ == '__main__':
    unittest.main()
