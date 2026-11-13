"""A CI run's room at the AI broker, by claim (jobadabra-web workers/ai-broker/lib/claims.mjs): ask for the searches it runs at once, wait its turn, keep it, give it back.

  python3 tools/persona-search/claim.py wait <need>   # exit 0 once granted, 1 after WAIT_MINUTES in line, 2 on a need the broker refuses
  python3 tools/persona-search/claim.py hold <need>   # renew every RENEW_S until killed (start it in the background of each search job)
  python3 tools/persona-search/claim.py release       # give it back; never fails the job

Design (13 Nov 2026, owner via sa: "each workflow should take its necessary slots." · "If there is room. it takes it" · "First come, first serve" · "Not everyhting that's
available"): the broker owns room, one line, first come first served; a run asks for exactly what it runs at once. The run is named by the broker from this job's GitHub
run token (workflow file + run id), so every job of one run shares its claim. A run that stops renewing loses it after 10 min, a waiting place after 60 s.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

CLAIM = 'https://jobadabra-ai-broker.jobpilotto.workers.dev/claim'
AUDIENCE = 'jobadabra-ai-broker'   # the broker's audience (desktop/e2e/lib/broker-client.mjs AUDIENCE)
ASK_S, RENEW_S, WAIT_MINUTES = 15, 180, 55   # the broker drops a waiting place after 60 s and a held claim after 10 min (claims.mjs WAITING_MS, HELD_MS)
AGENT = {'User-Agent': 'jobadabra-ci'}   # Why (13 Nov 2026, #3969): Cloudflare refuses urllib's own agent (403, error 1010)


def _token(env=os.environ, opener=urllib.request.urlopen):
    """A fresh GitHub run token for the broker (the job needs `permissions: id-token: write`)."""
    url, bearer = env.get('ACTIONS_ID_TOKEN_REQUEST_URL'), env.get('ACTIONS_ID_TOKEN_REQUEST_TOKEN')
    if not url or not bearer:
        raise RuntimeError('no GitHub run token here (the job needs permissions: id-token: write)')
    with opener(urllib.request.Request(f'{url}&audience={AUDIENCE}', headers={**AGENT, 'Authorization': f'Bearer {bearer}'}), timeout=20) as answer:
        return json.loads(answer.read())['value']


def ask(method, need=None, env=os.environ, opener=urllib.request.urlopen):
    """(status, reply) of one POST (need) or DELETE at the broker; status 0 = not reached (network), 401 = no run token here or the broker refused it."""
    try:
        body = json.dumps({'need': need}).encode() if method == 'POST' else None
        request = urllib.request.Request(CLAIM, data=body, method=method, headers={**AGENT, 'Authorization': f'Bearer {_token(env, opener)}', 'Content-Type': 'application/json'})
        with opener(request, timeout=20) as answer:
            return answer.status, json.loads(answer.read() or b'{}')
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read() or b'{}')
        except ValueError:
            return error.code, {}
    except RuntimeError as error:   # no run token in this job: it never comes, so the caller stops like on the broker's own 401
        return 401, {'error': str(error)}
    except (OSError, ValueError, KeyError) as error:
        return 0, {'error': str(error)}


def said(status, reply):
    """One line for a claim answer."""
    if status == 200:
        return f'granted {reply.get("need")} of {reply.get("capacity")} searches'
    if status == 202:
        ahead = ', '.join(f'{c["who"]} ({c["need"]})' for c in reply.get('ahead') or []) or 'nobody'
        held = ', '.join(f'{c["who"]} ({c["need"]})' for c in reply.get('held') or []) or 'nobody'
        return f'in line at {reply.get("position")}: ahead {ahead}; holding {held}'
    return f'not reached ({status}): {reply.get("error") or reply}'


def wait(need, now=datetime.now, sleep=time.sleep, asker=ask):
    """Exit code: 0 once granted, 1 after WAIT_MINUTES, 2 on a 400 or 401 (a need outside the broker's room, or no run token it accepts). One line when the answer changes."""
    end, last = time.monotonic() + WAIT_MINUTES * 60, ''
    while time.monotonic() < end:
        status, reply = asker('POST', need)
        line = said(status, reply)
        if line != last:
            print(f'claim: {now(timezone.utc):%H:%M:%S} {line}', flush=True)
            last = line
        if status == 200:
            return 0
        if status in (400, 401):
            return 2
        sleep(ASK_S)
    print(f'claim: no room in {WAIT_MINUTES} min (last: {last}); start it again later', flush=True)
    asker('DELETE')
    return 1


def hold(need, sleep=time.sleep, asker=ask):
    """Renew every RENEW_S until killed; a lost claim (202) says so, and the next ask takes its place in line again."""
    while True:
        sleep(RENEW_S)
        status, reply = asker('POST', need)
        if status != 200:
            print(f'claim: renewal {said(status, reply)}', flush=True)


def main(argv):
    """The command line above."""
    command = argv[1] if len(argv) > 1 else ''
    if command in ('wait', 'hold') and len(argv) == 3 and argv[2].isdigit():
        return (wait if command == 'wait' else hold)(int(argv[2]))
    if command == 'release' and len(argv) == 2:
        status, reply = ask('DELETE')
        print(f'claim: released ({status}): {reply}', flush=True)
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
