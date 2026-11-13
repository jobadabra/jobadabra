"""The Always on LinkedIn trial, the engine's side: a cloud run asks the site for a turn before each GET of LinkedIn's public job search and says afterwards what LinkedIn answered
(the site's side: jobadabra-web api/linkedin-turn.js; spec docs/superpowers/specs/2026-11-13-linkedin-guest-search-design.md, Caps).
Why (owner, 13 Nov 2026, asked via AskUserQuestion: "Both ways", "By hand, right after merge (Recommended)"; the caps "Approve as written", "Yes, 6 h cache"): the site is the one gate
and holds every cap (the owner's install only, one GET at a time, 30 a day, a 24 h stop), so the cloud's shared addresses never read more than the site allows.
Invariants: in a cloud run (TURN set) no LinkedIn GET starts without the site's "go"; a site that does not answer is a "no" (never a read on a guess); a "wait" never sleeps past the read cut;
the credential is the run's own (a run token on our servers, the repo key in a GitHub run), never a LinkedIn cookie or session. Tests: tests/unit/sources/test_linkedin_turn.py."""
import http.client
import json
import os
import time
import urllib.request

from .ats import USER_AGENT

TURN = 'JOBADABRA_LINKEDIN_TURN'   # the site's address: set only by cloud runs (src/hosted_run.py, .github/workflows/daily.yml)
WAITS, TIMEOUT, BODY_MAX = 3, 15, 400_000
# Why (Gitar on #4004): a reply cut mid-body (http.client.IncompleteRead) or one that will not decode is not an OSError; one tuple for the site's reads and LinkedIn's
BROKEN = (OSError, ValueError, http.client.HTTPException)
_open = urllib.request.urlopen
_sleep = time.sleep


def active(env=None):
    """True in a cloud run that must ask the site before each LinkedIn GET."""
    return bool((os.environ if env is None else env).get(TURN, '').strip())


def _headers(env):
    headers = {'Content-Type': 'application/json', 'User-Agent': USER_AGENT}   # Why (#3218): Cloudflare refuses urllib's own agent before our Worker sees the call
    token, key = env.get('JOBADABRA_RUN_TOKEN', '').strip(), env.get('JOBADABRA_TRIAL_KEY', '').strip()
    if token:
        headers['Authorization'] = f'Bearer {token}'
    elif key:
        headers['x-api-key'] = key
    return headers


def _post(path, body, env):
    request = urllib.request.Request(env[TURN].rstrip('/') + path, data=json.dumps(body).encode(), headers=_headers(env), method='POST')
    with _open(request, timeout=TIMEOUT) as response:
        return json.load(response)


def ask(url, seconds_left=None, env=None):
    """The site's answer for one GET of `url`: ('cached', page text), ('go', lease) or ('no', why). A 'wait' is slept here, at most WAITS times and never past `seconds_left`
    (the read cut, or None for no cut); after that, or when the site does not answer, it is a 'no'."""
    env = os.environ if env is None else env
    for _ in range(WAITS + 1):
        try:
            got = _post('/api/linkedin/turn', {'url': url}, env)
        except BROKEN as error:   # a network error, a reply cut short or not JSON: no answer from the site means no LinkedIn GET, never a read on a guess
            return 'no', f'the site gave no turn ({type(error).__name__})'
        answer = got.get('answer') if isinstance(got, dict) else None
        if answer == 'cached' and isinstance(got.get('body'), str):
            return 'cached', got['body']
        if answer == 'go' and got.get('lease'):
            return 'go', str(got['lease'])
        if answer == 'wait' and isinstance(got.get('seconds'), (int, float)) and got['seconds'] > 0:
            if seconds_left is not None and got['seconds'] >= seconds_left:
                return 'no', 'the read time is up'
            _sleep(got['seconds'])
            if seconds_left is not None:
                seconds_left -= got['seconds']
            continue
        return 'no', str(got.get('why') or 'the site gave no turn') if isinstance(got, dict) else 'the site gave no turn'
    return 'no', 'the site kept saying wait'


def tell(lease, status, word, body=None, env=None):
    """Says what LinkedIn answered to the lease's GET: the HTTP status (0 when none came back), one word, and a 200's text for the site's cache. A failure is ignored:
    the lease ends on its own after 90 s, and a stop the site did not hear is still this run's stop."""
    env = os.environ if env is None else env
    given = {'lease': lease, 'status': int(status or 0), 'word': word}
    if body is not None and status == 200 and len(body) <= BODY_MAX:
        given['body'] = body
    try:
        _post('/api/linkedin/answer', given, env)
    except BROKEN:   # see the docstring
        pass
