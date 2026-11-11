"""Guard: release — the night Search check's numbers stop being comparable when what it measures with changes unseen (the judge moved twice and 6 people became 18 in 30 days).
The lock (tools/persona-search/scoreboard.py, pr-gate.yml "Scoreboard kept"): the 18 people, the judge's prompt, the fixed source list and the check's AI chain change only with
`Scoreboard-change: "<owner's words>"` in the PR body and the lock rewritten."""
import importlib.util
import json
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('scoreboard', ROOT / 'tools/persona-search/scoreboard.py')
scoreboard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scoreboard)
KEPT = json.loads((ROOT / scoreboard.LOCK).read_text(encoding='utf-8'))
YES = 'Scoreboard-change: "the night measures 20 people now"'


def changed(part, text='changed'):
    """The lock as it would be with one part's input changed."""
    reads = {pid: read for pid, _, read in scoreboard.PARTS}
    patched = tuple((pid, gets, (lambda: text) if pid == part else reads[pid]) for pid, gets, _ in scoreboard.PARTS)
    return mock.patch.object(scoreboard, 'PARTS', patched)


class ScoreboardLocked(unittest.TestCase):
    def test_the_lock_in_the_tree_is_the_measure_in_the_tree(self):
        self.assertEqual(scoreboard.lock(), KEPT, 'run `python3 tools/persona-search/scoreboard.py --write-lock` (with the owner\'s words in the PR when a part changed)')

    def test_each_part_changed_without_the_owners_words_is_red_and_with_them_passes_once_the_lock_is_rewritten(self):
        for part in KEPT:
            with self.subTest(part=part), changed(part):
                rewritten = scoreboard.lock()
                self.assertEqual([p.split(' ')[0] for p in scoreboard.problems(KEPT, rewritten, 'a body with no owner words')], [part])
                self.assertEqual(scoreboard.problems(KEPT, rewritten, YES), [])
                self.assertEqual(len(scoreboard.problems(KEPT, KEPT, YES)), 1, 'the owner\'s words never excuse a lock left behind the measure')

    def test_the_parts_read_what_the_check_runs_with(self):
        self.assertEqual(len(json.loads(scoreboard.people())['people']), 18)
        self.assertIn('role: would a person with this profile', scoreboard.judge_prompt())
        self.assertIn('EURES', scoreboard.sources())
        self.assertNotIn('free-ai', scoreboard.chain(), 'the check never finishes on Free AI (owner on #3703)')

    def test_an_edit_to_how_the_judge_dedupes_or_accepts_a_batch_is_a_new_measure(self):
        """Gitar on #3708 (owner, 11 Nov 2026, asked via AskUserQuestion: "Lock them too (Recommended)"): key() decides which jobs the judge sees as one,
        complete() when a batch reply is accepted; either changes the numbers as much as the prompt does."""
        source = (ROOT / 'tools/persona-search/gate_judge.py').read_text(encoding='utf-8')
        original = Path.read_text
        for old, new in (("row['title'].strip().lower()", "row['title'].lower()"),   # key(): titles that differ by a space become two jobs
                         ("missing = [j['n'] for j in jobs if j['n'] not in got]", 'missing = []')):   # complete(): a reply that left jobs out is accepted
            with self.subTest(edit=old):
                self.assertEqual(source.count(old), 1, old)
                edited = source.replace(old, new)
                with mock.patch.object(Path, 'read_text', lambda self, *a, **k: edited if self.name == 'gate_judge.py' else original(self, *a, **k)):
                    self.assertNotEqual(scoreboard.lock()['S2'], KEPT['S2'], f'{old} → {new} changes what the judge measures')

    def test_a_reworded_comment_or_a_new_reference_word_is_not_a_new_measure(self):
        source = (ROOT / 'tools/persona-search/gate_judge.py').read_text(encoding='utf-8')
        line = '    env = os.environ if env is None else env\n'
        self.assertIn(line, source)
        reworded = source.replace('def ask(', '# a new comment\ndef ask(').replace(line, line[:-1] + '   # a reworded note inside ask()\n')
        original = Path.read_text
        with mock.patch.object(Path, 'read_text', lambda self, *a, **k: reworded if self.name == 'gate_judge.py' else original(self, *a, **k)):
            self.assertEqual(scoreboard.lock()['S2'], KEPT['S2'])
        people = json.loads((ROOT / 'tools/persona-search/gate-personas.json').read_text(encoding='utf-8'))
        people['personas'][0]['reference']['words'].append('a new word')
        with mock.patch.object(Path, 'read_text', lambda self, *a, **k: json.dumps(people) if self.name == 'gate-personas.json' else original(self, *a, **k)):
            self.assertEqual(scoreboard.lock()['S1'], KEPT['S1'], 'the reference counter\'s words are its own (lj), not the measure')


if __name__ == '__main__':
    unittest.main()
