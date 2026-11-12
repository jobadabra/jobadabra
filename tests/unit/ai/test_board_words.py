"""The search words a country's job boards are searched with, in its language (src/ai/board_words.py): one call, the code keeps short plain words only.
12 Nov 2026, owner, asked via AskUserQuestion: "Scout asks once per country (Recommended)": a Slovak board gave 0 jobs for "cooking" and 5 for its own
word for a cook. A stub client only: no network, no AI."""
import json
import unittest
from types import SimpleNamespace

from src.ai import board_words


class FakeClient:
    def __init__(self, answer=None, stop='end_turn', error=None):
        self.answer, self.stop, self.error, self.calls = answer, stop, error, []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        block = SimpleNamespace(type='text', text=json.dumps(self.answer))
        return SimpleNamespace(stop_reason=self.stop, content=[block], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


ASKED = {'kitchen': 'cooking, chef', 'nursing_care': 'nursing, care work'}


class Words(unittest.TestCase):
    def test_one_call_names_every_family_and_the_code_keeps_short_plain_words(self):
        client = FakeClient({'families': [
            {'family': 'kitchen', 'words': ['kuchár', ' kuchár ', 'čašník', 'pomocná sila v kuchyni', 'x' * 41, 'a\nb']},
            {'family': 'nursing_care', 'words': []},
            {'family': 'not_asked', 'words': ['slovo']},
            {'family': 'kitchen', 'words': ['second answer']}]})
        self.assertEqual(board_words.words('Slovakia', ASKED, client), {'kitchen': ['kuchár', 'čašník', 'pomocná sila v kuchyni']})
        self.assertEqual(len(client.calls), 1)
        sent = json.loads(client.calls[0]['messages'][0]['content'])
        self.assertEqual(sent, {'country': 'Slovakia', 'kinds': [{'id': 'kitchen', 'words': 'cooking, chef'}, {'id': 'nursing_care', 'words': 'nursing, care work'}]})

    def test_a_failed_or_cut_call_gives_none_and_the_english_words_still_search(self):
        self.assertIsNone(board_words.words('Slovakia', ASKED, FakeClient(error=RuntimeError('503'))))
        self.assertIsNone(board_words.words('Slovakia', ASKED, FakeClient({'families': []}, stop='max_tokens')))


if __name__ == '__main__':
    unittest.main()
