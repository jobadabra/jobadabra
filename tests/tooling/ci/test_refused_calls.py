"""Guard: data — a search whose AI calls were refused, or answered by two AIs, is "not counted", never a number; the table prints the refused calls beside the wait.
Why (13 Nov 2026, sa, runs 43524290510 / 43524315186 / 43524339782): Claude's paid lane hit its day cap at 23:10:29Z and refused 358 calls (`status 503`, `waited na`,
so no wait p90 ever saw them). 6 searches (c18, d03 in each round) still read "valid" by wait; Chisinau's right jobs fell with its refusals: 14 refused 39, 65 refused 5, 119 refused 0.
The relay lines below are the shape codex.mjs writes for an answered call and for a refused one."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import pair  # noqa: E402
import pair_row  # noqa: E402
import profiles  # noqa: E402

ANSWERED = 'relay: small total 2400 broker 2392 waited 247 in-flight 3 prompt-chars 695 kind board_queries start 1794611186489 status 200 sent yes tools 0 out-tokens 344 engine claude\n'
REFUSED = 'relay: small total 343 broker na waited na in-flight 6 prompt-chars 716 kind decide start 1794611452109 status 503 sent yes tools 0 out-tokens na why broker: paid lane at its day cap\n'
TWO_AIS = ('claude / claude-haiku-5-5', 'codex / gpt-6-luna')


def folder(tmp, name, answered, refused, right, ai=('claude / claude-haiku-5-5', 'claude / claude-sonnet-5-5')):
    """A profile's folder as the workflow uploads it: run.log (AI lines + relay lines), the press, the judged rows."""
    out = Path(tmp) / name
    (out / 'draw').mkdir(parents=True)
    (out / 'draw' / 'presses.jsonl').write_text(json.dumps({'started': '2026-11-13T23:09:00Z', 'seconds': 150}) + '\n')
    rows = [{'role': 'yes', 'place': 'yes', 'first_seen': '2026-11-13T23:10:00Z'}] * right + [{'role': 'no', 'place': 'yes'}]
    (out / 'judged.json').write_text(json.dumps({'rows': rows, 'judged_jobs': len(rows), 'agreement': {'ai': ['codex']}}))
    (out / 'jobs.json').write_text(json.dumps(rows))
    (out / 'run.log').write_text(''.join(f'AI: {a}\n' for a in ai) + ANSWERED * answered + REFUSED * refused)
    return out


class RefusedCallsAreNotCountedTest(unittest.TestCase):
    def test_profile_round_plays_chisinau_of_the_three_rounds(self):
        """The three d03 searches of the night (answered 60 / 61 / 41, refused 14 / 65 / 119): none is a number; c04 with 0 refused stays one."""
        with tempfile.TemporaryDirectory() as tmp:
            for pid, answered, refused, right in (('d03', 60, 14, 39), ('d03', 61, 65, 5), ('d03', 41, 119, 0)):
                got = profiles.row(pid, folder(tmp, f'{pid}-{refused}', answered, refused, right))
                self.assertNotIn('relevant', got, f'{refused} refused calls: the count measures the cap, not the search')
                self.assertEqual((got['not_measured'], got['damaged'], got['refused_calls']), (f'not measured ({refused} AI calls refused)', True, refused))
            clean = profiles.row('c04', folder(tmp, 'c04', 85, 0, 36))
            self.assertEqual((clean['relevant'], clean['refused_calls']), (36, 0), 'positive control: a clean search with a high number stays a number')

    def test_one_refused_call_is_enough(self):
        with tempfile.TemporaryDirectory() as tmp:
            got = profiles.row('c18', folder(tmp, 'c18', 54, 1, 7))
            self.assertEqual(got['not_measured'], 'not measured (1 AI call refused)')

    def test_refusals_are_the_reason_even_when_the_answered_calls_were_slow(self):
        """Gitar on #4130: the p90 starved branch returned first, so 358 refusals read "waits p90 N s" with an empty refused cell."""
        with tempfile.TemporaryDirectory() as tmp:
            out = folder(tmp, 'slow', 0, 119, 3)
            (out / 'run.log').write_text('AI: claude / claude-sonnet-5-5\n' + ANSWERED.replace('waited 247', 'waited 56000') * 10 + REFUSED * 119)
            got = profiles.row('d03', out)
            self.assertEqual((got['not_measured'], got['refused_calls'], got['waits_p90_s']), ('not measured (119 AI calls refused)', 119, 56))
            self.assertNotIn('starved', got)
            slow = folder(tmp, 'slow-clean', 0, 0, 3)
            (slow / 'run.log').write_text('AI: claude / claude-sonnet-5-5\n' + ANSWERED.replace('waited 247', 'waited 56000') * 10)
            self.assertTrue(profiles.row('d03', slow)['starved'], 'positive control: a slow broker with no refusal is still "starved"')

    def test_two_engines_in_one_row_are_not_counted_but_two_models_of_one_engine_are(self):
        with tempfile.TemporaryDirectory() as tmp:
            two = profiles.row('c04', folder(tmp, 'two', 40, 0, 15, ai=TWO_AIS))
            self.assertEqual((two['not_measured'], two['damaged']), ('not measured (two AIs answered: claude, codex)', True))
            one = profiles.row('c15', folder(tmp, 'one', 40, 0, 2))
            self.assertEqual(one['relevant'], 2, 'claude / haiku + claude / sonnet is ONE engine (sa, 13 Nov 2026)')

    def test_the_table_prints_refused_calls_beside_the_wait(self):
        with tempfile.TemporaryDirectory() as tmp:
            for pid, refused, right in (('c04', 0, 17), ('d03', 14, 39)):
                (folder(tmp, pid, 60, refused, right) / 'row.json').write_text(json.dumps(profiles.row(pid, Path(tmp) / pid)))
            profiles.table(tmp, Path(tmp) / 'table.md')
            table = (Path(tmp) / 'table.md').read_text()
            self.assertIn('| broker waits p90 | AI calls refused | longest short AI call |', table)
            self.assertRegex(table, r'\| 17 \|.*\| 0 s \| 0 \| 2\.4 s \| claude')
            self.assertIn('| d03 | Chisinau | Programmer (Software Engineer) | not measured (14 AI calls refused) |', table)

    def test_a_pair_side_with_a_refused_call_is_not_valid(self):
        """The pair read the same wait-only test: a side with refusals and a p90 of 0 s was "valid"."""
        with tempfile.TemporaryDirectory() as tmp:
            clean = folder(tmp, 'clean', 60, 0, 5)
            damaged = folder(tmp, 'damaged', 60, 14, 5)
            for out in (clean, damaged):
                pair.side(out, 'pr')
            row = lambda out: json.loads((out / 'side.json').read_text())   # noqa: E731
            self.assertEqual((row(clean)['valid'], row(clean)['failed']), (True, 0), 'positive control')
            self.assertEqual((row(damaged)['valid'], row(damaged)['failed']), (False, 14))
            mixed = folder(tmp, 'mixed', 60, 0, 5)
            (mixed / 'run.log').write_text(ANSWERED + ANSWERED.replace('engine claude', 'engine codex'))
            pair.side(mixed, 'pr')
            self.assertFalse(row(mixed)['valid'], 'two engines answered one side')
            why_line = ANSWERED.replace('status 200 sent yes', 'status 200 sent yes why broker: fell back').replace('engine claude', 'engine free-ai')   # a call with a why, and a hyphenated engine (Gitar on #4130)
            (mixed / 'run.log').write_text(ANSWERED + why_line)
            pair.side(mixed, 'pr')
            self.assertEqual(row(mixed)['engines'], ['claude', 'free-ai'])
            self.assertFalse(row(mixed)['valid'])
            self.assertIn('0 refused', pair._wait(row(clean)))
            self.assertIn('14 refused', pair._wait(row(damaged)))

    def test_the_row_says_why_a_side_did_not_count(self):
        """Gitar rule logic-slips 4: the row's reason read every invalid side with a wait as "waited over 20 s", wrong for a refused side or two AIs."""
        side = lambda **kw: {'valid': False, 'shared': True, 'wait_p90_ms': 300, 'failed': 0, 'engines': ['claude'], **kw}   # noqa: E731
        why = lambda row: pair_row.why_not_counted({'c18': {'main': [{'valid': True, 'shared': True}], 'pr': [row]}})   # noqa: E731
        self.assertEqual(why(side(failed=14)), 'a side had AI calls refused by the broker')
        self.assertEqual(why(side(engines=['claude', 'codex'])), 'a side was answered by two AIs')
        self.assertEqual(why(side(wait_p90_ms=31000)), 'a side waited over 20 s at the broker', 'positive control: the old reason stays for a slow broker')

    def test_a_hung_short_call_is_not_counted_plays_pair_1_of_4100(self):
        """Owner via sa, 14 Nov 2026 ("Drop the build, fix the measure"): #4100 pair 1 had a 62.9 s title call (a short, small-tier call); 30.0 s is the line, over it hung."""
        hung = 'relay: small total 63000 broker 62900 waited 100 in-flight 2 prompt-chars 900 kind title start 1794611186489 status 200 sent yes tools 0 out-tokens 20 engine codex\n'
        edge = hung.replace('broker 62900', 'broker 30000')
        mid = hung.replace('relay: small', 'relay: mid')   # a long (mid-tier) call may take this long
        with tempfile.TemporaryDirectory() as tmp:
            for name, line, counted in (('hung', hung, False), ('edge', edge, True), ('mid', mid, True)):
                out = folder(tmp, name, 0, 0, 5, ai=('codex / gpt-6-luna',))
                (out / 'run.log').write_text('AI: codex / gpt-6-luna\n' + ANSWERED.replace('engine claude', 'engine codex') * 30 + line)
                got = profiles.row('c04', out)
                self.assertEqual('relevant' in got, counted, name)
                pair.side(out, 'pr')
                self.assertEqual(json.loads((out / 'side.json').read_text())['valid'], counted, name)
            self.assertEqual(profiles.row('c04', Path(tmp) / 'hung')['not_measured'], 'not measured (a short AI call took 62.9 s)')
            side = {'valid': False, 'shared': True, 'wait_p90_ms': 300, 'failed': 0, 'engines': ['codex'], 'short_call_max_ms': 62900}
            self.assertEqual(pair_row.why_not_counted({'p1': {'main': [{'valid': True, 'shared': True}], 'pr': [side]}}), 'a side had a short AI call over 30 s')


if __name__ == '__main__':
    unittest.main()
