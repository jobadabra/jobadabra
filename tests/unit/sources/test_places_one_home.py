"""Every step reads a person's places from one home, src/my_places.py (#3808; owner, 11 Nov 2026: "how we can fix this forever?").

#3808: "None", "Nein" or "never" in Remote jobs was No for Find jobs (src/sources/feeds.py) but Yes for the step that tells the AI where a job
is (src/ai/place_triage.py read only the exact word "no"), so one run answered both ways for the same remote job.
"""
import pathlib
import re
import unittest

from src import my_places
from src.ai import place_triage
from src.sources import feeds

ROOT = pathlib.Path(__file__).resolve().parents[3]
WORDS = [(['No'], 'no'), (['none'], 'no'), (['Nein'], 'no'), (['never'], 'no'), (['off'], 'no'), (['false'], 'no'), (['non'], 'no'),
         (['Country'], 'country'), (['country'], 'country'), (['Yes'], 'yes'), ([], 'yes'), (None, 'yes')]
TO_AI = {'no': 'no', 'country': 'only_their_country', 'yes': 'yes'}


def search(said):
    return {'remote_jobs': said, 'locations': {'top_tier': ['leipzig'], 'country_wide': [], 'abroad': []}}


class OneRemoteWordTest(unittest.TestCase):
    def test_every_engine_step_reads_the_remote_word_the_same_way(self):
        for said, word in WORDS:
            with self.subTest(said=said):
                self.assertEqual(my_places.remote_word(search(said)), word)
                self.assertEqual(feeds.remote_wanted(search(said)), word != 'no')
                self.assertEqual(feeds.remote_country_only(search(said)), word == 'country')
                self.assertEqual(place_triage.places_words(search(said))['remote_jobs'], TO_AI[word], 'what the place step tells the AI')

    def test_the_app_reads_the_same_no_words(self):
        """The app's reader (desktop/renderer/remote-word.js) and the engine's say No for the same words."""
        text = (ROOT / 'desktop' / 'renderer' / 'remote-word.js').read_text(encoding='utf-8')
        app = set(re.findall(r"'([a-z]+)'", re.search(r'NO_WORDS = new Set\(\[([^\]]*)\]\)', text).group(1)))
        self.assertEqual(app, set(my_places.NO_WORDS))


if __name__ == '__main__':
    unittest.main()
