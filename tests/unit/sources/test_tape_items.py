"""A batched AI question replayed one item at a time (src/tape_items.py): the press's yardstick replays a re-ordered press, whose batches differ from the recording's."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from src import search_tape, tape_items  # noqa: E402
from src.ai.providers import contract  # noqa: E402


def question(items, system='Sort the titles.'):
    listed = '\n'.join(f'{n}. {item}' for n, item in enumerate(items, 1))
    return {'model': 'm', 'max_tokens': 1500, 'system': [{'type': 'text', 'text': system}],
            'messages': [{'role': 'user', 'content': f'The search (JSON): {{"roles": ["nurse"]}}\nThe titles:\n{listed}'}]}


class SplitTest(unittest.TestCase):
    def test_a_numbered_list_splits_into_its_prefix_and_items(self):
        prefix, items = tape_items.split('Their places: ["Dublin"]\nThe job locations:\n1. Dublin\n2. Cork, Ireland\n3. Remote')
        self.assertEqual((prefix, items), ('Their places: ["Dublin"]\nThe job locations:\n', ['Dublin', 'Cork, Ireland', 'Remote']))

    def test_an_item_over_several_lines_stays_one_item(self):
        _, items = tape_items.split('Jobs:\n1. Title: Nurse\nLocation field: Dublin\n\n2. Title: Carer\nLocation field: (none)')
        self.assertEqual(items, ['Title: Nurse\nLocation field: Dublin', 'Title: Carer\nLocation field: (none)'])

    def test_two_lists_or_no_list_is_not_split(self):
        self.assertIsNone(tape_items.split('Roles:\n1. nurse\n2. carer\nTitles:\n1. Nurse\n2. Cook'))
        self.assertIsNone(tape_items.split('score job 1'))
        self.assertIsNone(tape_items.split(['not', 'text']))


class PartsTest(unittest.TestCase):
    def test_a_list_of_numbers_becomes_each_items_rank_or_no(self):
        self.assertEqual(tape_items.parts('{"keep": [3, 1]}', 3), ('keep', {1: 1, 2: False, 3: 0}), 'a ranked answer keeps its order: 3 first')

    def test_rows_with_n_become_each_items_rows(self):
        field, got = tape_items.parts('{"locations": [{"n": 2, "answer": "best"}, {"n": 1, "answer": "out", "country": "FR"}]}', 2)
        self.assertEqual((field, got), ('locations', {1: [{'answer': 'out', 'country': 'FR'}], 2: [{'answer': 'best'}]}))

    def test_any_other_shape_is_not_split(self):
        for text in ('{"fit": [1], "why": "x"}', '{"fit": "1"}', 'not json', '{"rows": [{"answer": "best"}]}', '[1, 2]'):
            self.assertIsNone(tape_items.parts(text, 2), text)

    def test_join_renumbers_and_mixes_an_empty_numbers_part_with_rows(self):
        self.assertEqual(json.loads(tape_items.join('keep', [False, 1, 0])), {'keep': [3, 2]}, 'the recorded best comes first')
        rows = json.loads(tape_items.join('locations', [[{'answer': 'best'}], False, [{'answer': 'in'}]]))
        self.assertEqual(rows, {'locations': [{'n': 1, 'answer': 'best'}, {'n': 3, 'answer': 'in'}]})
        self.assertIsNone(tape_items.join('locations', [[{'answer': 'best'}], 0]), 'a number beside rows is two shapes')


class ReplayTest(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.env = {'JOBADABRA_SEARCH_TAPE': folder.name, 'JOBADABRA_TAPE_WAIT_SCALE': '0', 'JOBADABRA_TAPE_ITEMS': '1'}
        search_tape._index.clear()
        self.addCleanup(search_tape._index.clear)
        for key in search_tape.counts:
            search_tape.counts[key] = 0

    def mode(self, mode, **more):
        search_tape._index.clear()
        return mock.patch.dict(os.environ, {**self.env, 'JOBADABRA_SEARCH_TAPE_MODE': mode, **more})

    def client(self, asked, text):
        def build():
            def create(**params):
                asked.append(params)
                return contract.Response(content=[contract.TextBlock(text)], usage=contract.Usage(10, 2), model='m')
            return mock.Mock(messages=mock.Mock(create=create))
        return search_tape._Client(build)

    def test_a_reordered_batch_is_answered_from_its_items_and_a_new_item_misses(self):
        asked = []
        with self.mode('record'):
            self.client(asked, '{"fit": [1, 3]}').messages.create(**question(['Nurse', 'Cook', 'Ward nurse']))
        with self.mode('replay', JOBADABRA_TAPE_LIVE='0'):
            answer = self.client(asked, '').messages.create(**question(['Ward nurse', 'Cook']))
            self.assertEqual(json.loads(answer.content[0].text), {'fit': [1]}, 'Ward nurse is item 1 now')
            with self.assertRaises(RuntimeError):
                self.client(asked, '').messages.create(**question(['Ward nurse', 'Driver']))
            with self.assertRaises(RuntimeError, msg='another prompt is another question'):
                self.client(asked, '').messages.create(**question(['Cook'], system='Other.'))
        self.assertEqual(len(asked), 1, 'nothing asked live on the replay')
        self.assertEqual((search_tape.counts['ai_rebuilt'], search_tape.counts['ai_missing']), (1, 2))

    def test_a_ranked_answer_replays_in_its_recorded_order_in_any_batch_order(self):
        asked = []
        with self.mode('record'):
            self.client(asked, '{"keep": [3, 1]}').messages.create(**question(['a.test', 'b.test', 'c.test']))
        with self.mode('replay', JOBADABRA_TAPE_LIVE='0'):
            answer = self.client(asked, '').messages.create(**question(['a.test', 'c.test']))
        self.assertEqual(json.loads(answer.content[0].text), {'keep': [2, 1]}, 'c.test (now 2) was the recorded best')

    def test_another_cap_is_another_question_and_a_cut_answer_is_not_split(self):
        asked = []
        with self.mode('record'):
            self.client(asked, '{"fit": [1]}').messages.create(**question(['Nurse', 'Cook']))
        with self.mode('replay', JOBADABRA_TAPE_LIVE='0'), self.assertRaises(RuntimeError):
            self.client(asked, '').messages.create(**{**question(['Cook', 'Nurse']), 'max_tokens': 200})
        cut = contract.Response(content=[contract.TextBlock('{"fit": [1]}')], usage=contract.Usage(1, 1), model='m', stop_reason='max_tokens')
        with self.mode('record'):
            search_tape._Client(lambda: mock.Mock(messages=mock.Mock(create=lambda **params: cut))).messages.create(**question(['Driver', 'Pilot']))
        with self.mode('replay', JOBADABRA_TAPE_LIVE='0'), self.assertRaises(RuntimeError):
            self.client(asked, '').messages.create(**question(['Pilot', 'Driver']))

    def test_without_the_switch_a_reordered_batch_misses_as_before(self):
        asked = []
        with self.mode('record'):
            self.client(asked, '{"fit": [1]}').messages.create(**question(['Nurse', 'Cook']))
        with self.mode('replay', JOBADABRA_TAPE_LIVE='0', JOBADABRA_TAPE_ITEMS='0'), self.assertRaises(RuntimeError):
            self.client(asked, '').messages.create(**question(['Cook', 'Nurse']))


if __name__ == '__main__':
    unittest.main()
