"""The PR verdict starts a search PR's before/after pair and keeps its "Search before/after" row on the PR's current head (companion of tools/pr-verdict.py, plan 3/5).
Why (14 Nov 2026, owner via sa: "I want all the PRs like that, to start the pair by themselves, and to see the check at the PR level"; asked via AskUserQuestion: "Yes, only when search
files change (Recommended)"): today only a PR shipped with tools/ship.sh and pending Moves lines gets a pair, and a push leaves the row on the old commit (#4175, #4180).
Design: states / one owner / verdicts (14 Nov 2026, sa: four Gitar rounds on this file's row and start states = the design was wrong; no fifth patch). Plan docs/superpowers/plans/2026-11-14-pr-checks-rows-and-pair.md.
- ONE writer: this module, run by pr-verdict.py after each verdict for the PR's CURRENT open head only (same repository; `actions: write` stays on that one job; the verdict's group is per commit, so one run
  per head). An older head's verdict stops at the head check, so two heads of one PR never both start. tools/ship-search-hold.sh no longer dispatches.
- States of a head's start row are pair_row's own, none new, written only through pair_row.next_row (events `opened`, `carried`): none -> `waiting` (a dispatch is on its way; the pair claims the row) -> the pair's
  own running ... counted; or `unnamed`, whose title says why: "pair needed" / "pair limit" / "pair not started". `nothing` and `carried` are final.
- The verdicts for a head H whose files match SEARCH_FILES (tools/pr-body-check.py), in this order:
    row already on H, not `unnamed` / `waiting`                        -> nothing (once per head, whatever the PR number: a reopen keeps H and its row)
    the earlier measured head M moved to H by no search file          -> CARRY: "ran on <M7>, search files unchanged since: <its title>" (neutral link, no pair)
    Moves says nothing and no person is named                         -> row "nothing" (green, the why)
    no person named                                                   -> row "pair needed" (no timer: the next check after the body is fixed starts it)
    4 pairs started for this PR in a rolling 24 h                     -> row "pair limit"; it STARTS BY ITSELF at the first check after a place frees (the row says when), or by hand
    3 failed dispatches on this head                                  -> row "pair limit"; nothing more by itself on this head, a new commit or a hand start
    otherwise                                                         -> row "pair queued", THEN one dispatch (a failed one moves the row to "pair not started", tried again at a later check)
- One timer, JUST: a dispatch tried in the last 3 minutes is not tried again (see JUST). Nothing else waits.
- Never for a PR outside SEARCH_FILES. A fork PR gets nothing (current_open_head, tools/pr_verdict_rows.py).
"""
import importlib.util
import json
import os
import re
import sys
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
ROW = 'Search before/after'
FAILED = 'pair not started'   # the title of a row whose dispatch failed: written by publish(), counted by failed_starts()
# Why (14 Nov 2026, sa: the one remaining timer): a HANG GUARD for the gap between our dispatch and its run being listed (seconds), and for a failed dispatch that must not be hammered by the burst of verdicts
#   one push causes. Inside it a `waiting` row, or a row left by a failed dispatch, is not started again; past it a `waiting` row with no run listed is a dispatch that never happened (a verdict cancelled
#   between its row and its dispatch) and goes through the verdicts again. It decides nothing else: no other row waits on a clock.
JUST = timedelta(minutes=3)
CAP = (4, 24)   # pairs started per PR in this many hours: the BROKER bound (2 searches per person per pair), counted from the workflow's own runs, owner via sa 14 Nov 2026
FAIL_CAP = 3    # failed dispatches per head: the RETRY bound (a failed dispatch costs the broker nothing but a quota that is out is not asked every 3 minutes for ever), counted from the head's own rows
META = re.compile(r'<!-- search-pair-meta (\{.*?\}) -->')   # the pair comment's last line (tools/persona-search/pair.py table): the head it measured and its people


def _load(name, *parts):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, *parts))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    sys.path.insert(0, os.path.join(HERE, 'persona-search'))   # pair.py and pair_row.py import each other beside themselves
    spec.loader.exec_module(module)
    return module


def modules():
    """(pair, pair_row, pr-body-check): the persona-search modules and tools/pr-body-check.py (its SEARCH_FILES and MOVES are the one source of what a search change is and what a Moves line says), loaded from this file's own folder."""
    return _load('pair', 'persona-search', 'pair.py'), _load('pair_row', 'persona-search', 'pair_row.py'), _load('pr_body_check', 'pr-body-check.py')


def nothing_why(check, body):
    """The `<why>` of the body's `Moves: nothing (<why>)` line, as the author wrote it ('' when there is none): the row quotes it, so it never claims more than the author said."""
    for hit in check.MOVES.finditer(body or ''):
        found = re.search(r'Moves:\**\s*nothing\b[^(]*\((.*)\)\s*$', hit.group(0).strip())
        if found:
            return found.group(1).strip()
    return ''


def says_nothing(check, body):
    """True when the body has a valid `Moves: nothing (<why>)` line (the shape tools/pr-body-check.py accepts)."""
    return any(re.search(r'Moves:\**\s*nothing\b', hit.group(0)) for hit in check.MOVES.finditer(body or ''))


def people_of(pair, body, last):
    """The people to measure: the body's pending Moves lines, else the last pair's people (kept in its comment, only ids of the fixed shapes), else none: never a guess."""
    kept = [str(p) for p in (last or {}).get('people', []) if re.fullmatch(r'p\d{1,2}|[a-z]\d{2}', str(p))]
    return pair.pending(body) or [int(p[1:]) if p[0] == 'p' and p[1:].isdigit() else p for p in kept][:pair.MAX_PEOPLE]


def decide(*, reach, row, last, delta, nothing, people, starts, failed, head, busy=False):
    """-> (action, why) for head `head`. action: none | carry | nothing | needed | capped | start. Pure: every input is read by publish().
    row: the head's existing "Search before/after" row's state name or None; last: {sha, people} of the last pair comment or None; delta: head_verdict's (moved, newer) for last.sha...head or None;
    busy: JUST's one meaning: the row is `waiting` and a pair of this PR is queued, running or under 3 min old, or the row is one a failed dispatch left, under 3 min old.
    A row still `waiting` with no pair on its way is a dispatch that never happened (a verdict run cancelled between the row and the dispatch): it goes through the verdicts again."""
    if not reach:
        return 'none', 'no file the search reads'
    if row in ('waiting', 'unnamed') and busy:
        return 'none', 'its pair is queued or starting, or a start was just tried'
    if row and row not in ('unnamed', 'waiting'):
        return 'none', 'this head has its row'
    if last and last.get('sha') != head and delta is not None and not delta[1]:
        return 'carry', f"search files unchanged since {last['sha'][:7]}"
    if not people and nothing:
        return 'nothing', 'Moves says nothing moves'
    if not people:
        return 'needed', 'no person named'
    if starts >= CAP[0]:
        return 'capped', f'{starts} pairs started in {CAP[1]} h'
    if failed >= FAIL_CAP:
        return 'capped', f'the dispatch failed {failed} times on this head'
    return 'start', 'search files changed on this head'


def pairs_of(gh, repo, number, now):
    """(start times in the last CAP[1] hours, runs queued, running or started within JUST) for PR `number`: the workflow's run list, whose run names start `Search pair · #<n> `.
    Read from the workflow's runs created in the window (REST, paged), not the newest N of every PR: a busy day cannot push a PR's own runs out of the list (Gitar on #4221).
    A start is a run that is not the pair's own second run (its name ends ` · again`, search-pair.yml run-name): the cap counts heads started, not reruns."""
    since = now - timedelta(hours=CAP[1])
    lines = gh('api', '-X', 'GET', '--paginate', f'repos/{repo}/actions/workflows/search-pair.yml/runs', '-f', f"created=>={since.strftime('%Y-%m-%dT%H:%M:%SZ')}", '-f', 'per_page=100',
               '--jq', '.workflow_runs[] | {createdAt: .created_at, displayTitle: .display_title, status}') or ''
    runs = [json.loads(line) for line in lines.splitlines() if line.strip()]   # one object per line, whatever the page
    mine = [(r, datetime.fromisoformat(r['createdAt'].replace('Z', '+00:00'))) for r in runs if str(r.get('displayTitle', '')).startswith(f'Search pair · #{number} ')]
    return (sorted(at for r, at in mine if not str(r['displayTitle']).endswith(' · again') and at >= since),
            sum(1 for r, at in mine if r.get('status') != 'completed' or at >= now - JUST))


def frees_at(times):
    """When the cap has a place again: the start whose ageing out leaves CAP[0] - 1 starts, plus the window. None while under the cap."""
    over = len(times) - CAP[0] + 1
    return times[over - 1] + timedelta(hours=CAP[1]) if over > 0 else None


def failed_starts(gh, repo, sha):
    """How many dispatches failed for this head: its rows titled FAILED (a failed start leaves one; the next try writes a new row beside it).
    Why (Gitar on #4212 and #4221): a failed dispatch makes no run, so the run list never counted it and a quota that stays out was tried again every 3 minutes for ever. It is a bound of its own (FAIL_CAP per head),
    not part of CAP: a failed dispatch spends no broker search, so each new head may try again, once its own bound allows, when the quota is back."""
    from urllib.parse import quote
    titles = json.loads(gh('api', f'repos/{repo}/commits/{sha}/check-runs?per_page=100&filter=all&check_name={quote(ROW)}', '--jq', '[.check_runs[] | .output.title // ""]') or '[]')
    return sum(1 for title in titles if str(title).startswith(FAILED))


def row_on(gh, repo, sha):
    """The head's "Search before/after" check run as pair_row reads it ({id, external_id, summary}), or {}: asked by exact name."""
    from urllib.parse import quote
    got = json.loads(gh('api', f'repos/{repo}/commits/{sha}/check-runs?per_page=100&check_name={quote(ROW)}', '--jq',
                        '[.check_runs[] | {id, external_id, completed_at, conclusion, summary: (.output.summary // ""), title: (.output.title // "")}]') or '[]')
    return got[0] if got else {}


def last_pair(gh, repo, number):
    """{sha, people} the PR's pair comment names in its meta line, or None. Only the workflow's own comment counts (a PR author's comment could forge the line)."""
    text = gh('api', '--paginate', f'repos/{repo}/issues/{number}/comments', '--jq', '.[] | select(.user.login == "github-actions[bot]" and (.body | startswith("<!-- search-pair -->"))) | .body') or ''
    hit = META.findall(text)
    try:
        return json.loads(hit[-1]) if hit else None
    except ValueError:
        return None


def write_row(gh, repo, sha, pair_row, old, event):
    """One row move through pair_row.next_row (the only writer of a row's content); returns the row's check run id, '' when the row already says it."""
    out = pair_row.next_row(old, event)
    if out['noop']:
        return ''
    api = out['api']
    args = ['-f', f"status={api['status']}", '-f', f"external_id={api['external_id']}", '-f', f"output[title]={api['output']['title']}", '-f', f"output[summary]={api['output']['summary']}"]
    if api.get('conclusion'):
        args += ['-f', f"conclusion={api['conclusion']}"]
    if out['new'] or not old.get('id'):
        return str(json.loads(gh('api', f'repos/{repo}/check-runs', '-f', f'head_sha={sha}', '-f', f'name={ROW}', *args))['id'])
    gh('api', '-X', 'PATCH', f"repos/{repo}/check-runs/{old['id']}", *args)
    return str(old['id'])


def publish(repo, sha, pulls, files, gh, now, dry_run=False):
    """Decide and act for the PR whose current open head is `sha`. Nothing for a head that is not one, a fork PR, or a PR outside SEARCH_FILES. Returns the action taken."""
    mine = next((p for p in pulls if p.get('state') == 'open' and not p.get('merged_at') and p.get('head_sha') == sha and not p.get('cross_repo')), None)
    if not mine or files is None:
        return 'none'
    pair, pair_row, check = modules()
    reach = any(check.SEARCH_FILES.match(name) for name in files)
    if not reach:
        return 'none'
    number, body, old = mine['number'], mine.get('body') or '', row_on(gh, repo, sha)
    state = pair_row.parse_external_id(old.get('external_id'))[0] if old else None
    open_row = state is None or state in ('unnamed', 'waiting')   # a row that is none of these has this head's say: nothing more to read
    last = last_pair(gh, repo, number) if open_row else None
    delta = None
    if last and last.get('sha') and last['sha'] != sha:
        try:
            compare = json.loads(gh('api', f"repos/{repo}/compare/{last['sha']}...{sha}", '--jq', '{status, count: (.files | length), files: [.files[] | .filename, (.previous_filename // empty)]}') or '{}')
        except Exception:   # an unreadable compare is a doubt: it counts as newer
            compare = {}
        delta = pair.head_verdict('OPEN', last['sha'], sha, compare)
    people = people_of(pair, body, last)
    times, active = pairs_of(gh, repo, number, now) if open_row and people else ([], 0)
    starts = len(times)
    failed = failed_starts(gh, repo, sha) if state == 'unnamed' and people else 0   # only a retry has failed rows to count
    done_at = datetime.fromisoformat(old['completed_at'].replace('Z', '+00:00')) if old.get('completed_at') else None   # a completed row (unnamed) knows when; a queued one does not
    busy = bool(active) if state == 'waiting' else done_at is not None and now - done_at < JUST and str(old.get('title', '')).startswith(FAILED)   # a "pair needed" or "pair limit" row is never waited on
    action, why = decide(reach=reach, row=state, last=last, delta=delta, people=people, starts=starts, failed=failed, nothing=says_nothing(check, body), head=sha, busy=busy)
    print(f'search pair for #{number} {sha[:7]}: {action} ({why})')
    if dry_run or action == 'none':
        return action
    command = f"gh workflow run search-pair.yml -R {repo} -f pr={number} -f people='{json.dumps(people)}'"
    shown = ', '.join(str(p) for p in people)
    events = {'carry': lambda: carried(gh, repo, last, sha),
              'nothing': lambda: {'kind': 'opened', 'verdict': 'nothing', 'people': [], 'title': f'no pair: the body says "{nothing_why(check, body)}"'[:140],
                                  'summary': f'The PR body says `Moves: nothing ({nothing_why(check, body)})` and names no person, so no pair is started for this commit. What the PR claims is judged in its text, not by a pair; the row says only what the author wrote.'},
              'needed': lambda: {'kind': 'opened', 'verdict': 'unnamed', 'people': [], 'title': "pair needed: name the people in the body's Moves lines",
                                 'summary': "Add `Moves: p<n> <number> <before> -> pending (1 run a side, same minute, usual difference <d>)` for each person this change reaches (one could-hurt person too); the pair starts by itself on the next check."},
              'capped': lambda: {'kind': 'opened', 'verdict': 'unnamed', 'people': [],   # no people: a row with the failed tries' people would read as the same row (pair_row._place)
                                 'title': f'pair limit: {why}; ' + ('starts by itself once a place frees' if starts >= CAP[0] else 'start it by hand'),
                                 'summary': (f'{starts} pairs were started for this PR in the last {CAP[1]} hours (the most is {CAP[0]}; each pair takes 2 AI searches per person from the broker). '
                                             f'A place frees at {frees_at(times):%H:%M}Z, when the oldest of them is {CAP[1]} hours old: the first check after that starts the pair by itself. To start it now: `{command}`'
                                             if starts >= CAP[0] else
                                             f'The dispatch failed {failed} times on this commit (the most is {FAIL_CAP}). Nothing more starts by itself on this commit: push a new commit, or start it by hand: `{command}`')},
              'start': lambda: {'kind': 'opened', 'verdict': 'waiting', 'people': people, 'title': 'pair queued: starting',
                                'summary': f'Before/after pair for {shown}, starting for this commit.'}}
    # the row first: a dispatch that fails then moves it, a PR never has none (Gitar on #4044/#4077)
    row_id = write_row(gh, repo, sha, pair_row, old, events[action]()) or str(old.get('id') or '')
    if action == 'start':
        try:   # search-pair.yml's start job claims this row by its id (check_id), so one row exists per head
            # No --ref, on purpose (Gitar on #4228): this job runs in the default branch's context (workflow_run), so its checkout, pair.py/pair_row.py and this dispatch are all main's; a PR that edits
            #   search-pair.yml or pair_row.py is measured by main's copies and its own changes apply after the merge.
            gh('workflow', 'run', 'search-pair.yml', '-R', repo, '-f', f'pr={number}', '-f', f'people={json.dumps(people)}', '-f', f'check_id={row_id}')
        except Exception as error:   # gh printed its own words; the row says what to run
            write_row(gh, repo, sha, pair_row, row_on(gh, repo, sha), {'kind': 'opened', 'verdict': 'unnamed', 'people': people, 'title': f'{FAILED}: the dispatch failed; start it by hand',
                                                                       'summary': f'`gh workflow run` failed ({type(error).__name__}); a later check tries again after 3 minutes (at most {FAIL_CAP} times on this commit), or start it by hand: `{command}`'})
    return action


def carried(gh, repo, last, sha):
    """The `carried` event: the earlier head's row title kept on this head, with the earlier row's verdict: a red stays red (a docs-only commit never turns a lost pair green), anything else is neutral.
    Why (14 Nov 2026, found reading #4225 for sa's live proof of the gate): `carried` was always neutral, and the PR verdict now reads this row (tools/pr_verdict_pair_gate.py)."""
    was = row_on(gh, repo, last['sha'])
    title = (was.get('title') or 'its pair ran').strip()
    red = was.get('conclusion') == 'failure'
    return {'kind': 'carried', 'people': last.get('people', []), 'conclusion': 'failure' if red else 'neutral', 'title': f"ran on {last['sha'][:7]}, search files unchanged since: {title}"[:140],
            'summary': f"The pair measured {last['sha'][:7]}; no file the search reads changed since, so its {'red stands' if red else 'numbers stand'} for {sha[:7]} (the PR comment holds the table)."}
