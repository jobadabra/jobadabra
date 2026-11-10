"""Guard: money + data — the market count's web search (tools/persona-search/market_web.py, [mc] 3/5) runs only behind the local persona relay (the plan path), never on an API key of
its own; it asks the AI's own web search tool (never a scraped results page); a failed or unreadable search is "not counted", never 0. Fakes only: no relay, broker or web is called."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import market_web  # noqa: E402

RELAY = {'ANTHROPIC_BASE_URL': 'http://127.0.0.1:8123', 'JOBADABRA_PERSONA_CODEX': '1'}
P6 = market_web.PERSONAS[5]   # Digital Marketing Manager, Zagreb


class Answer:
    def __init__(self, reply):
        self.body = json.dumps(reply).encode()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self.body


def replying(text, sent=None):
    """A fake relay answering `text` in one text block (after a search block the reader must skip); `sent` collects each request."""
    def open_url(request, timeout):
        if sent is not None:
            sent.append((request.full_url, json.loads(request.data), dict(request.header_items())))
        return Answer({'content': [{'type': 'server_tool_use', 'name': 'web_search'}, {'type': 'text', 'text': text}]})
    return open_url


def posting(i, **over):
    return {'title': f'Marketing menadžer {i}', 'company': 'ACME d.o.o.', 'location': 'Zagreb', 'url': f'https://jobs.example/{i}', **over}


class TheCall(unittest.TestCase):
    def test_it_runs_only_behind_the_local_relay(self):
        for env in ({}, {**RELAY, 'JOBADABRA_PERSONA_CODEX': ''}, {**RELAY, 'ANTHROPIC_BASE_URL': 'https://api.anthropic.com'}, {**RELAY, 'ANTHROPIC_BASE_URL': 'http://10.0.0.5:8123'}):
            with self.assertRaises(ValueError, msg=env):
                market_web.ask(P6, replying('{"jobs": []}'), env)
        self.assertEqual(market_web.read(P6, lambda persona: market_web.ask(persona, replying('{"jobs": []}'), {}))['status'], 'not counted: ValueError')

    def test_one_call_with_the_web_search_tool_the_role_in_both_languages_and_the_city(self):
        sent = []
        market_web.ask(P6, replying('{"jobs": []}', sent), RELAY)
        self.assertEqual(len(sent), 1)
        url, body, headers = sent[0]
        self.assertEqual(url, 'http://127.0.0.1:8123/v1/messages')
        self.assertEqual(body['tools'], [{'type': 'web_search_20250305', 'name': 'web_search', 'max_uses': market_web.MAX_USES}])
        self.assertEqual(body['model'], market_web.MODEL)
        self.assertGreaterEqual(body['max_tokens'], 1000)
        prompt = body['messages'][0]['content']
        for word in ('Digital Marketing Manager', 'digitalni marketing', 'marketing menadžer', 'Zagreb', 'Croatia'):
            self.assertIn(word, prompt)
        self.assertFalse({k.lower() for k in headers} & {'x-api-key', 'authorization'}, 'no key of its own: the relay holds the plan')


class TheRows(unittest.TestCase):
    def test_postings_come_back_as_rows_cleaned_and_capped(self):
        listed = [posting(i) for i in range(market_web.CAP + 5)] + [posting(99, title=' ')]
        rows = market_web.ask(P6, replying('Here they are:\n' + json.dumps({'jobs': listed})), RELAY)
        self.assertEqual(len(rows), market_web.CAP)
        self.assertEqual(rows[0], {'title': 'Marketing menadžer 0', 'company': 'ACME d.o.o.', 'location': 'Zagreb', 'url': 'https://jobs.example/0'})

    def test_a_posting_without_a_link_or_a_title_is_dropped(self):
        listed = [posting(1, url=''), posting(2, url='javascript:void(0)'), posting(3, title=''), 'not a posting', posting(4)]
        rows = market_web.ask(P6, replying(json.dumps({'jobs': listed})), RELAY)
        self.assertEqual([r['url'] for r in rows], ['https://jobs.example/4'])

    def test_an_answer_without_the_list_is_not_counted_never_zero(self):
        for text in ('I could not search right now.', '{"postings": []}', '{"jobs": "none"}'):
            got = market_web.read(P6, lambda persona, text=text: market_web.ask(persona, replying(text), RELAY))
            self.assertEqual((got['status'], got['rows']), ('not counted: ValueError', []), text)

    def test_the_list_is_found_after_prose_with_braces(self):
        text = 'I searched {three times} and found:\n```json\n' + json.dumps({'jobs': [posting(1)]}) + '\n```'
        self.assertEqual([r['url'] for r in market_web.ask(P6, replying(text), RELAY)], ['https://jobs.example/1'])

    def test_an_empty_list_is_a_count_of_zero(self):
        got = market_web.read(P6, lambda persona: market_web.ask(persona, replying('{"jobs": []}'), RELAY))
        self.assertEqual((got['status'], got['rows']), ('counted', []))


if __name__ == '__main__':
    unittest.main()
