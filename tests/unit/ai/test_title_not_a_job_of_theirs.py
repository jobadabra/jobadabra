"""The title step's own examples for titles that are no job of theirs (#3793; night 42927975750, 11 Nov 2026), inside the owner's 7 Oct 2026 decision ("Only the location should be strict")."""
import json
import pathlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from src.ai import title_triage

SEARCH = {'role_keywords': ['menuisier', 'charpentier']}


class NotAJobOfTheirsTest(unittest.TestCase):
    """The night listed a carpenter in Brussels an "Open sollicitatie / Unsolicited application" and a software engineer in Amsterdam two
    pre-sales "Solutions Engineer" jobs: the title step said yes to all three. Its prompt now names both as left out, as data (examples), never a
    word list in code; a bare generic title ("Technicien") stays a "when unsure, include it" case (sa, 11 Nov 2026)."""

    def test_an_unsolicited_application_is_no_job_of_its_own(self):
        self.assertIn('an open or unsolicited application', title_triage.SYSTEM)
        for example in ('Candidature spontanée', 'Initiativbewerbung'):
            self.assertIn(example, title_triage.SYSTEM, 'examples in more than one language: the step reads any language')

    def test_selling_a_product_is_not_building_it(self):
        self.assertIn('"Solutions Engineer"', title_triage.SYSTEM)
        self.assertIn('pre-sales', title_triage.SYSTEM)

    def test_the_lenient_rule_still_holds(self):
        # Why-changed (12 Nov 2026, owner: "Three answers, neighbours wait (Recommended)"): an unsure title is still kept and scored, as a neighbour (`near`), no longer listed as a fit one.
        self.assertIn('when unsure whether to leave a title out, say `near`: a later step scores each neighbour before it is shown.', ' '.join(title_triage.SYSTEM.split()))
        self.assertIn('a close neighbour of their work at a similar level', ' '.join(title_triage.SYSTEM.split()))


class AnswersKeptUnderTheOldPromptTest(unittest.TestCase):
    """Gitar on #3803: the answers are kept per search, so the carpenter whose app said yes to "Open sollicitatie" before this prompt kept it listed:
    the new prompt reached only titles never seen. A yes kept under another prompt is asked again; a no stays (this prompt only adds "leave out" cases)."""

    def setUp(self):
        store = mock.patch.object(title_triage, 'STORE', pathlib.Path(tempfile.mkdtemp()) / 't.json')
        store.start()
        self.addCleanup(store.stop)
        old = {'open sollicitatie / unsolicited application': True, 'menuisier': True, 'comptable': False}   # an install's store from before: no prompt stamp
        title_triage.STORE.write_text(json.dumps({title_triage._key(SEARCH): old}))
        self.asked = []

        def create(**kwargs):
            listed = kwargs['messages'][0]['content'].split('The titles:\n', 1)[1].split('\n')
            self.asked.extend(line.split('. ', 1)[1] for line in listed)
            fit = [int(line.split('.', 1)[0]) for line in listed if 'menuisier' in line]
            return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps({'fit': fit}))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))
        self.client = SimpleNamespace(messages=SimpleNamespace(create=create))

    def test_a_yes_kept_under_the_old_prompt_is_asked_again_and_a_no_is_not(self):
        self.assertEqual(title_triage.known(SEARCH), {'comptable': False}, 'before asking: only the old no holds')
        got = title_triage.decide(['Open sollicitatie / Unsolicited application', 'Menuisier', 'Comptable'], SEARCH, self.client)
        self.assertEqual(sorted(self.asked), ['menuisier', 'open sollicitatie / unsolicited application'], 'the old yes titles are asked again, the old no is not')
        self.assertEqual(got, {'open sollicitatie / unsolicited application': False, 'menuisier': True, 'comptable': False})
        self.assertEqual(title_triage.known(SEARCH), got, 'kept under this prompt: the next run asks nothing')
        title_triage.decide(['Open sollicitatie / Unsolicited application', 'Menuisier'], SEARCH, self.client)
        self.assertEqual(len(self.asked), 2, 'asked once under this prompt')


if __name__ == '__main__':
    unittest.main()
