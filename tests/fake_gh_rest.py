"""A fake `gh api -i [-H 'If-None-Match: <etag>'] <path>` for the REST PR readers (tools/pr-rest-lib.sh): answers from files in $FAKE_GH_DIR, no network.
rest/<path, every non-alphanumeric as _>: the JSON body for that path, with an ETag of its hash (304 when the request sends that ETag). A missing file: [] for a list, else 404.
The watcher's looks (tests/test_ship_watch.py): when states exists, repos/<r>/pulls/<n> and the head's check-runs/status follow one line per look of
states (OPEN | MERGED <sha> | CLOSED | REFUSED), mergeables, checks (pending | <failing name> | empty = pass), runs (none | running | gate | ok | refused: a 403), verdicts (pending | none | ok),
variables (a repository variable's value per look, or 404 once deleted), heads (the head sha, default new1), labels (comma-separated names), titles (default "[t] A change"), reviews.json (the PR's reviews, REST shape), twins (a cancelled older run of the gate beside the green one: any text) and mergestates (GitHub's mergeable_state: clean | blocked | unstable | unknown ..., default clean, or draft for a draft).
Every call is appended to calls; any other gh command fails like an unknown call.
REST out (10 Nov 2026, the GraphQL fallback of tools/pr-rest-lib.sh): a refuse_rest file makes every REST read a 403 "API rate limit exceeded"; `gh api rate_limit` prints the number in rate_core (default 5000);
`gh api graphql` answers the query it recognises from graphql_view.json (pullRequest), graphql_checks.json (checkSuites) or graphql_runs.json (the aliased resource lookups), each a full {"data": ...} body, and
graphql_ofhead.json (pullRequests of a head branch: pr_of_head's fallback; 13 Nov 2026, pq); a `--jq .resources.core.reset` read prints rate_reset (default 0). It fails like GitHub on an unbalanced query or a missing file. It adds one "GRAPHQL <kind> <GH_GRAPHQL_WHY>" line to calls."""
import hashlib
import json
import os
import re
import sys
from pathlib import Path

d = Path(os.environ['FAKE_GH_DIR'])
argv = sys.argv[1:]
with open(d / 'calls', 'a') as f:
    f.write(' '.join(argv) + '\n')
if argv[:1] == ['api'] and 'Accept: application/vnd.github.raw' in argv:
    raw = d / 'rest' / re.sub(r'[^A-Za-z0-9]', '_', argv[-1])
    if raw.exists():
        print(raw.read_text())
        sys.exit(0)
    sys.exit(1)
if argv[:2] == ['api', 'rate_limit']:   # never counted, answers while REST is out
    if any('core.reset' in x for x in argv):
        print((d / 'rate_reset').read_text().strip() if (d / 'rate_reset').exists() else '0')
        sys.exit(0)
    print((d / 'rate_core').read_text().strip() if (d / 'rate_core').exists() else '5000')
    sys.exit(0)
if argv[:2] == ['api', 'graphql']:
    query = next((a[len('query='):] for a in argv if a.startswith('query=')), '')
    kind = 'ofhead' if 'pullRequests(' in query else 'view' if 'pullRequest(' in query else 'checks' if 'checkSuites(' in query else 'runs' if 'resource(' in query else 'unknown'
    with open(d / 'calls', 'a') as f:
        f.write(f"GRAPHQL {kind} {os.environ.get('GH_GRAPHQL_WHY', '')}\n")
    answer_file = d / f'graphql_{kind}.json'
    if query.count('{') != query.count('}') or not answer_file.exists():
        print('{"errors":[{"message":"Parse error"}]}')
        sys.exit(1)
    body = json.loads(answer_file.read_text())
    if kind == 'view' and 'full=false' in argv:   # @include(if: $full) false: GitHub leaves those fields out
        for name in ('comments', 'reviews', 'commits'):
            body['data']['repository']['pullRequest'].pop(name, None)
    print(json.dumps(body))
    sys.exit(0)
if argv[:2] in (['pr', 'comment'], ['pr', 'ready']):   # logged above; a posted comment or a draft flip changes nothing the watcher reads (the drafts file scripts it)
    sys.exit(0)
if argv[:1] != ['api'] or '-i' not in argv:
    print(f'fake gh: unknown call {argv}', file=sys.stderr)
    sys.exit(1)
if (d / 'refuse_rest').exists():
    print('HTTP/2.0 403 Forbidden\n\n{"message":"API rate limit exceeded"}')
    sys.exit(1)
path = argv[-1]
sent = next((a.split(': ', 1)[1] for a in argv if a.startswith('If-None-Match: ')), '')


def line(name, n, default=''):
    rows = (d / name).read_text().splitlines() if (d / name).exists() else []
    return rows[n - 1] if n <= len(rows) else (rows[-1] if rows and name == 'states' else default)


def answer(body, status='200 OK'):
    text = json.dumps(body)
    etag = 'W/"' + hashlib.sha1(text.encode()).hexdigest()[:12] + '"'
    if sent == etag:
        print('HTTP/2.0 304 Not Modified\netag: ' + etag + '\n')
        sys.exit(1)   # like gh: a 304 exits 1
    print(f'HTTP/2.0 {status}\netag: {etag}\ncontent-type: application/json\n\n{text}')
    sys.exit(0)


def look():
    return int((d / 'looks').read_text() or 0) if (d / 'looks').exists() else 0


m = re.fullmatch(r'repos/([^/]+/[^/]+)/pulls/(\d+)', path)
if (d / 'states').exists() and m:
    n = look() + 1
    (d / 'looks').write_text(str(n))
    state = line('states', n).split()
    if state[0] == 'REFUSED':
        print('HTTP/2.0 403 Forbidden\n\n{"message":"API rate limit exceeded"}')
        sys.exit(1)
    mergeable = {'CONFLICTING': False, 'UNKNOWN': None}.get(line('mergeables', n) or 'MERGEABLE', True)
    answer({'number': int(m[2]), 'html_url': f'https://github.com/{m[1]}/pull/{m[2]}', 'head': {'sha': line('heads', n) or 'new1', 'ref': 'feature'},
            'draft': line('drafts', n) == 'true', 'state': 'open' if state[0] == 'OPEN' else 'closed', 'merged_at': '2026-10-27T10:00:00Z' if state[0] == 'MERGED' else None,
            'merge_commit_sha': state[1] if state[0] == 'MERGED' else None, 'mergeable': mergeable, 'mergeable_state': line('mergestates', n) or ('draft' if line('drafts', n) == 'true' else 'clean'),
            'labels': [{'name': name} for name in line('labels', n).split(',') if name], 'title': line('titles', n) or '[t] A change'})
if (d / 'states').exists() and re.search(r'/commits/[^/]+/check-runs\?per_page=100$', path):
    n, runs, check = look(), line('runs', look()) or 'ok', line('checks', look())
    if runs == 'refused':
        print('HTTP/2.0 403 Forbidden\n\n{"message":"API rate limit exceeded"}')
        sys.exit(1)
    if runs == 'none': answer({'check_runs': []})
    if runs == 'gitar': answer({'check_runs': [{'name': 'Gitar', 'head_sha': line('heads', n) or 'new1', 'status': 'in_progress', 'conclusion': None}]})   # Gitar's check on the head: it has started
    if runs == 'running' or check == 'pending': answer({'check_runs': [{'name': 'x', 'head_sha': line('heads', n) or 'new1', 'status': 'in_progress', 'conclusion': None}]})
    one = {'name': check, 'status': 'completed', 'conclusion': 'failure'} if check else {'name': 'x', 'status': 'completed', 'conclusion': 'success'}
    gate = [{'name': 'All checks passed', 'status': 'completed', 'conclusion': 'success'}] if runs == 'gate' else []
    # twins (web #459, 6 Nov 2026): the gate's first run was cancelled by the second; both rows stay on the commit, the newer id is the green one
    twin = [{'name': 'All checks passed', 'id': 1, 'status': 'completed', 'conclusion': 'cancelled'}] if (d / 'twins').exists() and (d / 'twins').read_text().strip() else []
    for check_run in gate: check_run['id'] = 2
    for check_run in [one] + gate + twin:
        check_run['head_sha'] = line('heads', n) or 'new1'
    answer({'check_runs': [one] + gate + twin})
if (d / 'states').exists() and re.search(r'/commits/[^/]+/status$', path):
    runs = line('runs', look())   # like pr-verdict.yml: no status before the head's runs exist, pending while they run, none for runs older than the status
    verdict = line('verdicts', look()) or {'gate': 'none', 'none': 'none', 'running': 'pending'}.get(runs, 'ok')
    answer({'sha': line('heads', look()) or 'new1', 'statuses': [] if verdict == 'none' else [{'context': 'All checks passed', 'state': 'pending' if verdict == 'pending' else 'success', 'target_url': 'u'}]})
if (d / 'variables').exists() and re.search(r'/actions/variables/[A-Z_]+$', path):   # a repository variable per look: its value, or 404 (deleted)
    value = line('variables', look())
    if value == '404':
        print('HTTP/2.0 404 Not Found\n\n{"message":"Not Found"}')
        sys.exit(1)
    answer({'name': path.rsplit('/', 1)[1], 'value': value})
f = d / 'rest' / re.sub(r'[^A-Za-z0-9]', '_', path)
if f.exists():
    answer(json.loads(f.read_text()))
if '/reviews?' in path and (d / 'reviews.json').exists():   # the PR's reviews, REST shape (reviews.json)
    page = int((re.search(r'[?&]page=(\d+)', path) or [0, 1])[1])   # 100 a page, like GitHub
    answer(json.loads((d / 'reviews.json').read_text())[(page - 1) * 100:page * 100])
if re.search(r'/(comments|reviews|commits)\?|/pulls\?', path):
    answer([])
print('HTTP/2.0 404 Not Found\n\n{"message":"Not Found"}')
sys.exit(1)
