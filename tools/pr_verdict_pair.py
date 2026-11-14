"""The PR verdict starts a search PR's before/after pair and keeps its "Search before/after" row on the PR's current head (companion of tools/pr-verdict.py, plan 3/5).
Why (14 Nov 2026, owner via sa: "I want all the PRs like that, to start the pair by themselves, and to see the check at the PR level"; asked via AskUserQuestion: "Yes, only when search
files change (Recommended)"): today only a PR shipped with tools/ship.sh and pending Moves lines gets a pair, and a push leaves the row on the old commit (#4175, #4180).
Design: states / one owner / verdicts. Plan docs/superpowers/plans/2026-11-14-pr-checks-rows-and-pair.md.
- ONE starter: this module, run by pr-verdict.py after each verdict write for the PR's current open head (same repository only; `actions: write` stays on that one job). tools/ship-search-hold.sh
  no longer dispatches. The row's content is written only through pair_row.next_row (events `opened`, `carried`): no new state.
- Verdicts for a head H of a PR whose files match SEARCH_FILES (tools/pr-body-check.py), in this order:
    row already on H ("Search before/after", not the "unnamed" one)  -> nothing: once per head, whatever the PR number (a reopen keeps H and its row)
    the earlier measured head M moved to H by no search file          -> CARRY: "ran on <M7>, search files unchanged since: <its title>" (neutral link, no pair)
    Moves says nothing and no person is named                         -> row "nothing" (green, the why): no pair, nothing to measure
    no person named (pending Moves lines, or the last pair's people)  -> row "pair needed: name the people in the body's Moves lines"
    4 pairs started for this PR in 24 h, or 3 failed tries on this head -> row "pair limit", with the command to start it by hand (two bounds, one source each: see CAP and FAIL_CAP)
    otherwise                                                         -> row "pair queued", THEN the dispatch (a failed dispatch moves the row to "pair not started: <why>; <command>")
- Never needed for a PR outside SEARCH_FILES. A fork PR gets nothing (current_open_head, tools/pr_verdict_rows.py).
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
JUST = timedelta(minutes=3)   # a dispatch is listed within seconds; a start tried this recently is not tried again
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
    busy: the row is `waiting` and a pair of this PR is queued, running or under 3 min old, or the row is `unnamed` and under 3 min old (one retry per 3 min after a failed dispatch).
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
    """(starts in the last CAP[1] hours, runs queued, running or started within 3 min) for PR `number`: the workflow's run list, whose run names start `Search pair · #<n> `.
    Read from the workflow's runs created in the window (REST, paged), not the newest N of every PR: a busy day cannot push a PR's own runs out of the list (Gitar on #4221).
    A start is a run that is not the pair's own second run (its name ends ` · again`, search-pair.yml run-name): the cap counts heads started, not reruns."""
    since = now - timedelta(hours=CAP[1])
    lines = gh('api', '-X', 'GET', '--paginate', f'repos/{repo}/actions/workflows/search-pair.yml/runs', '-f', f"created=>={since.strftime('%Y-%m-%dT%H:%M:%SZ')}", '-f', 'per_page=100',
               '--jq', '.workflow_runs[] | {createdAt: .created_at, displayTitle: .display_title, status}') or ''
    runs = [json.loads(line) for line in lines.splitlines() if line.strip()]   # one object per line, whatever the page
    mine = [r for r in runs if str(r.get('displayTitle', '')).startswith(f'Search pair · #{number} ')]
    return (sum(1 for r in mine if not str(r['displayTitle']).endswith(' · again') and datetime.fromisoformat(r['createdAt'].replace('Z', '+00:00')) >= since),
            sum(1 for r in mine if r.get('status') != 'completed' or datetime.fromisoformat(r['createdAt'].replace('Z', '+00:00')) >= now - JUST))


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
                        '[.check_runs[] | {id, external_id, completed_at, summary: (.output.summary // ""), title: (.output.title // "")}]') or '[]')
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
    starts, active = pairs_of(gh, repo, number, now) if open_row and people else (0, 0)
    failed = failed_starts(gh, repo, sha) if state == 'unnamed' and people else 0   # only a retry has failed rows to count
    done_at = datetime.fromisoformat(old['completed_at'].replace('Z', '+00:00')) if old.get('completed_at') else None   # a completed row (unnamed) knows when; a queued one does not
    busy = bool(active) if state == 'waiting' else done_at is not None and now - done_at < JUST
    action, why = decide(reach=reach, row=state, last=last, delta=delta, people=people, starts=starts, failed=failed, nothing=says_nothing(check, body), head=sha, busy=busy)
    print(f'search pair for #{number} {sha[:7]}: {action} ({why})')
    if dry_run or action == 'none':
        return action
    command = f"gh workflow run search-pair.yml -R {repo} -f pr={number} -f people='{json.dumps(people)}'"
    shown = ', '.join(str(p) for p in people)
    events = {'carry': lambda: carried(gh, repo, last, sha),
              'nothing': lambda: {'kind': 'opened', 'verdict': 'nothing', 'people': [], 'title': 'Moves says nothing moves: no pair',
                                  'summary': 'The PR body says `Moves: nothing (<why>)` and names no person: there is nothing to measure. The claim is judged in the PR text.'},
              'needed': lambda: {'kind': 'opened', 'verdict': 'unnamed', 'people': [], 'title': "pair needed: name the people in the body's Moves lines",
                                 'summary': "Add `Moves: p<n> <number> <before> -> pending (1 run a side, same minute, usual difference <d>)` for each person this change reaches (one could-hurt person too); the pair starts by itself on the next check."},
              'capped': lambda: {'kind': 'opened', 'verdict': 'unnamed', 'people': [],   # no people: a row with the failed tries' people would read as the same row (pair_row._place)
                                 'title': f'pair limit: {why}; start it by hand',
                                 'summary': f'Limit reached: {why} (at most {CAP[0]} pairs per PR in {CAP[1]} hours, each takes 2 AI searches per person from the broker; at most {FAIL_CAP} failed dispatches per commit). Start one by hand: `{command}`'},
              'start': lambda: {'kind': 'opened', 'verdict': 'waiting', 'people': people, 'title': 'pair queued: starting',
                                'summary': f'Before/after pair for {shown}, starting for this commit.'}}
    # the row first: a dispatch that fails then moves it, a PR never has none (Gitar on #4044/#4077)
    row_id = write_row(gh, repo, sha, pair_row, old, events[action]()) or str(old.get('id') or '')
    if action == 'start':
        # Why (Gitar on #4228, try 3 on the cap): two verdicts of different heads of one PR can both read starts=3 before either dispatches (the verdict's group is per commit). Read the count again after the
        #   row is written and before the dispatch: a rival whose run is already listed closes the gap. Residual, stated: a rival dispatched in the same second is not listed yet, so the bound is CAP[0],
        #   plus at most one under that race (2 AI searches per person). Closing it needs one serial starter job per PR: parked, impact low (a cost overshoot of one pair, no wrong verdict).
        again, _ = pairs_of(gh, repo, number, now)
        if again >= CAP[0]:
            why = f'{again} pairs started in {CAP[1]} h'
            write_row(gh, repo, sha, pair_row, row_on(gh, repo, sha), events['capped']())
            return 'capped'
        try:   # search-pair.yml's start job claims this row by its id (check_id), so one row exists per head
            # No --ref, on purpose (Gitar on #4228): this job runs in the default branch's context (workflow_run), so its checkout, pair.py/pair_row.py and this dispatch are all main's; a PR that edits
            #   search-pair.yml or pair_row.py is measured by main's copies and its own changes apply after the merge.
            gh('workflow', 'run', 'search-pair.yml', '-R', repo, '-f', f'pr={number}', '-f', f'people={json.dumps(people)}', '-f', f'check_id={row_id}')
        except Exception as error:   # gh printed its own words; the row says what to run
            write_row(gh, repo, sha, pair_row, row_on(gh, repo, sha), {'kind': 'opened', 'verdict': 'unnamed', 'people': people, 'title': f'{FAILED}: the dispatch failed; start it by hand',
                                                                       'summary': f'`gh workflow run` failed ({type(error).__name__}); the next check tries once more after 3 min, or start it by hand: `{command}`'})
    return action


def carried(gh, repo, last, sha):
    """The `carried` event: the earlier head's row title, kept on this head."""
    was = row_on(gh, repo, last['sha'])
    title = (was.get('title') or 'its pair ran').strip()
    return {'kind': 'carried', 'people': last.get('people', []), 'conclusion': 'neutral', 'title': f"ran on {last['sha'][:7]}, search files unchanged since: {title}"[:140],
            'summary': f"The pair measured {last['sha'][:7]}; no file the search reads changed since, so its numbers stand for {sha[:7]} (the PR comment holds the table)."}
