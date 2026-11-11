"""Guard: release — the blind judge's verdict per job is the majority of 3 answers (owner, 11 Nov 2026, asked via AskUserQuestion: "Ask 3 times, take the majority
(Recommended)"); without it one answer decides, and 11.5% of jobs judged twice changed verdict with nothing else changed. Also: the result names the AI that answered."""
import io
import json
import sys
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import gate_judge  # noqa: E402
import judge_three  # noqa: E402

SOCOTEC = [{'title': t, 'company': 'SOCOTEC', 'location': 'Lyon, fr'} for t in
           ('Vérificateur technique electricité H/F', "Technicien d'inspection electricité H/F", 'Technicien d’inspection electricité et levage - chantiers H/F')]


def answers(*replies):
    """An asker that gives the n-th call the n-th reply: {'role', 'place', 'ai'} for every job of the list (or an exception to raise)."""
    lock, calls = threading.Lock(), []

    def asker(profile, jobs):
        with lock:
            reply = replies[len(calls)]
            calls.append(len(jobs))
        if isinstance(reply, Exception):
            raise reply
        return {j['n']: dict(reply) for j in jobs}
    asker.calls = calls
    return asker


YES = {'role': 'yes', 'place': 'yes', 'ai': 'gpt-6-luna'}
NO = {'role': 'no', 'place': 'yes', 'ai': 'gpt-6-luna'}


class Majority(unittest.TestCase):
    def test_p9s_three_jobs_take_the_answer_two_of_three_gave_and_keep_all_three(self):
        """The owner's scenario: p9's same 3 Socotec jobs read right at night and wrong at midday; now each verdict is what 2 of 3 answers say."""
        asker = answers(YES, NO, NO)
        result = gate_judge.judge(9, [dict(row) for row in SOCOTEC], asker)
        self.assertEqual(len(asker.calls), 3, 'the list is asked 3 times')
        self.assertEqual({row['role'] for row in result['rows']}, {'no'})
        self.assertEqual(sorted(a[0] for a in result['rows'][0]['answers']), ['no', 'no', 'yes'], 'every answer is kept')
        self.assertEqual((result['agreement']['jobs'], result['agreement']['not_unanimous'], result['agreement']['role_split']), (3, 3, 3))

    def test_a_failed_call_leaves_two_answers_and_a_split_is_unjudged_never_guessed(self):
        result = gate_judge.judge(9, [dict(SOCOTEC[0])], answers(YES, NO, ValueError('the judge left out 1 of 1 jobs')))
        row = result['rows'][0]
        self.assertEqual((row['role'], row['place']), ('not-judged', 'yes'), 'yes vs no is no majority; both said the place')
        self.assertEqual(result['agreement']['short'], 1)
        with self.assertRaises((RuntimeError, ValueError), msg='one answer is never a verdict: the step fails as before'):
            gate_judge.judge(9, [dict(SOCOTEC[0])], answers(YES, RuntimeError('relay down'), ValueError('refused')))

    def test_three_different_places_are_unjudged(self):
        place = lambda p: {'role': 'yes', 'place': p, 'ai': 'gpt-6-luna'}
        self.assertEqual(judge_three.majority([place('yes'), place('remote'), place('no')])[:2], ('yes', 'not-judged'))

    def test_each_row_names_the_ai_that_answered_and_a_mixed_one_says_so(self):
        haiku = {**YES, 'ai': 'claude-haiku-5-5'}
        result = gate_judge.judge(9, [dict(SOCOTEC[0])], answers(YES, YES, haiku))
        self.assertEqual(result['rows'][0]['ai'], 'gpt-6-luna + claude-haiku-5-5')
        self.assertEqual(result['agreement']['ai'], ['gpt-6-luna', 'claude-haiku-5-5'])
        self.assertNotIn('Codex', result['model'], 'never a fixed engine name: 27 of 187 saved results said Codex while Qwen, Haiku or Gemma answered')


class Ask(unittest.TestCase):
    ENV = {'JOBADABRA_PERSONA_CODEX': '1', 'ANTHROPIC_BASE_URL': 'http://127.0.0.1:9'}

    def ask(self, env, model='gpt-6-luna'):
        sent = []

        def open_url(request, timeout):
            sent.append(json.loads(request.data))
            reply = {'model': model, 'content': [{'type': 'text', 'text': json.dumps({'jobs': [{'n': 1, 'role': 'yes', 'place': 'no'}]})}]}
            return io.BytesIO(json.dumps(reply).encode())
        got = gate_judge.ask('Profile: x', [{'n': 1, 'title': 't', 'company': 'c', 'location': 'l'}], open_url=open_url, env=env)
        self.sent = sent[0]
        return sent[0]['model'], got[1]['ai']

    def test_the_reply_names_the_model_and_the_tier_is_small_unless_a_by_hand_run_names_another(self):
        self.assertEqual(self.ask(self.ENV, model='@cf/qwen/qwen3-30b-a3b-fp8'), ('claude-haiku-5-5', '@cf/qwen/qwen3-30b-a3b-fp8'))
        self.assertEqual(self.ask({**self.ENV, 'JOBADABRA_JUDGE_TIER': 'large'})[0], 'claude-opus-5-5')
        with self.assertRaises(ValueError):
            self.ask({**self.ENV, 'JOBADABRA_JUDGE_TIER': 'sonnet'})

    def test_small_high_asks_luna_to_reason_more_and_the_night_sends_no_effort(self):
        """Owner to sa, 11 Nov 2026: "or luan with higher reasoning": the same small model at effort high; the night's small call is unchanged."""
        self.assertEqual(self.ask({**self.ENV, 'JOBADABRA_JUDGE_TIER': 'small-high'})[0], 'claude-haiku-5-5')
        self.assertEqual(self.sent['output_config'], {'effort': 'high'})
        self.ask(self.ENV)
        self.assertNotIn('output_config', self.sent)


if __name__ == '__main__':
    unittest.main()
