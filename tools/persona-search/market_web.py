"""The market count's web search: for one fictional candidate, the open job postings a person finds by searching the web for the role in the city, found by the AI's own web search
tool (never a scraped results page: CLAUDE.md, bot checks) behind the persona relay (tools/persona-search/codex.mjs: the broker's `search` flag), as rows the blind judge reads.
Only finding here: no judging, no keeping. The judge (gate_judge.py) decides which are the right role in the right place, in the same pass as every other source.
Why (owner, 10 Nov 2026: "If I search for 'electrical engineer in Prague'… by searching on Google… summing all the jobs I found… should be the number what Jobadabra finds";
sa's finish-line plan, the fixed source list: web search, "the AI's web search tool, asked for postings of role + place"; [mc] 3/5).
Cost: one small-tier call with web search per person per count (18 a run), on the plan path through the relay; no API key is read here.
  node tools/persona-search/codex.mjs -- python3 tools/persona-search/market_web.py <persona n>     one person's rows, printed (one AI call)
Tests: tests/tooling/ci/test_market_web.py."""
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from gate import PERSONAS  # noqa: E402
from gate_judge import MODEL  # noqa: E402   the judge's small tier: one tier for the whole count

CAP = 30        # postings per person (sa's design, 10 Nov 2026): a person reads the first results, not every page
MAX_USES = 3    # web searches the AI may run for one person
SYSTEM = ('You search the web the way a job seeker does, to find job postings that are open now. Use web search. List single job postings (one job each) for the role in the city given; '
          'never a list page, a search page, a category page or a company\'s home page. For each posting give its title, the employer, the place it names and the link to the posting. '
          f'At most {CAP} postings. Answer with JSON only: {{"jobs":[{{"title":"...","company":"...","location":"...","url":"..."}}]}}; an empty list when you found none.')


def _relay(env):
    """The persona relay's base address, or ValueError: the web search runs only behind the relay (the plan path), never on a key of its own."""
    base = env.get('ANTHROPIC_BASE_URL', '')
    address = urlparse(base)
    if env.get('JOBADABRA_PERSONA_CODEX') != '1' or address.scheme != 'http' or address.hostname != '127.0.0.1':
        raise ValueError('the web search requires the local Codex relay')
    return base


def ask(persona, open_url=urlopen, env=None):
    """One web-search call for the persona -> the postings the AI listed, each {title, company, location, url} (at most CAP); raises on a refused call or an answer that is not the JSON."""
    base = _relay(os.environ if env is None else env)
    words = ', '.join(persona['reference']['words'])
    prompt = f'Role: {persona["title"]} (in {persona["language"]}: {words}). City: {persona["city"]}, {persona["country"]}.'
    body = {'model': MODEL, 'max_tokens': 8000, 'system': SYSTEM, 'messages': [{'role': 'user', 'content': prompt}],
            'tools': [{'type': 'web_search_20250305', 'name': 'web_search', 'max_uses': MAX_USES}]}
    request = Request(base + '/v1/messages', data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    with open_url(request, timeout=600) as response:
        reply = json.loads(response.read())
    text = ''.join(part.get('text', '') for part in reply.get('content', []) if part.get('type') == 'text')
    found = re.search(r'\{.*\}', text, re.S)
    if not found:
        raise ValueError('the web search answered without the JSON')
    listed = json.loads(found.group(0)).get('jobs')
    if not isinstance(listed, list):
        raise ValueError('the web search answered without a job list')
    rows = []
    for job in listed:
        row = {k: ' '.join(str(job.get(k) or '').split()) for k in ('title', 'company', 'location', 'url')} if isinstance(job, dict) else {}
        if row.get('title') and urlparse(row['url']).scheme in ('http', 'https'):   # a posting a person found has a link; one without is not a posting the count can stand behind
            rows.append(row)
    return rows[:CAP]


def read(persona, asker=ask):
    """-> {"source": "web_search", "status", "rows"}: "counted" with the postings found (none is a count of 0: the search ran and found nothing), or "not counted: <why>"
    (no relay, a refused call, an answer without the JSON): never 0 on a failure, never retried."""
    try:
        rows = asker(persona)
    except Exception as error:   # noqa: BLE001 - a failed search is that source not counted, never the end of the run
        return {'source': 'web_search', 'status': f'not counted: {type(error).__name__}', 'rows': []}
    return {'source': 'web_search', 'status': 'counted', 'rows': rows}


if __name__ == '__main__':
    got = read(PERSONAS[int(sys.argv[1]) - 1])
    print(got['status'], len(got['rows']), 'postings')
    for row in got['rows']:
        print(' |', row['title'][:60], '|', row['company'][:40], '|', row['location'][:40], '|', row['url'][:80])
