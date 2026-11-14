"""The PR's "Search before/after" row decides a search PR's "All checks passed" (companion of tools/pr-verdict.py, plan 5/5).
Why (14 Nov 2026, owner: "I'm tired of having PRs with \"DONT Merge\"... The PR CI check (search pair) should tell us" · "Each PR should have a search pair, which is either a yes, either a no"): a search PR's
proof was a draft titled DONT MERGE that a tool lifted; now the pair's own row is the proof and the one required check reads it.
Design: states / one owner / verdicts.
- Owner: the pair writes its row (tools/persona-search/pair_row.py, one writer); this module only READS it, once, for a PR whose files match SEARCH_FILES (tools/pr-body-check.py). It never writes.
- It speaks only when everything else is green (state `success`): a red or pending verdict keeps its own words, and the row never turns a PR green that something else holds.
- What the row says (its state is in its external_id `search-pair:<state>:...`, its conclusion is the check run's):
    no row                                     -> pending "no row yet", but ONLY once something on this commit of main starts pairs by itself (tools/pr_verdict_pair.py beside this file); before that
                                                  a pair is started by ship or by hand, a PR without one is no fault of its own, and the verdict is unchanged
    waiting, running, rerunning, unproven      -> pending, with the row's title (the pair has not decided)
    superseded                                 -> pending (a newer head took the pair; its row is on that head)
    counted, carried, nothing + success/neutral -> unchanged (the row is a yes, or says no pair is needed)
    unnamed: "pair needed"                     -> failure (the PR names nobody: its author's to fix); "pair limit" / "pair not started" -> pending (retried by the starter, or started by hand: not a PR's red)
    anything else completed (red)              -> failure, with the row's title: the row's red IS the PR's red (a loss, no proven gain, not valid twice)
- The row ends in the pair's workflow, which then asks for a new verdict (search-pair.yml `status`); the 10-minute sweep repairs a lost ask.
- Fail-open on a read error: a row that cannot be read leaves the verdict as it was and says so (display of a check, never a new way to block on a broken API).
"""
import importlib.util
import json
import os
import re
from urllib.parse import quote

HERE = os.path.dirname(os.path.abspath(__file__))
ROW = 'Search before/after'
PENDING_STATES = {'waiting', 'running', 'rerunning', 'unproven', 'superseded'}
NEEDED = 'pair needed'   # tools/pr_verdict_pair.py's title for a PR whose Moves lines name nobody: the author's to fix, so it is red
STARTER = 'pr_verdict_pair.py'   # its presence on this commit of main is "pairs start by themselves"


def search_files():
    """The one list of files a search change is (tools/pr-body-check.py SEARCH_FILES), loaded from this file's folder; None when it is not there."""
    path = os.path.join(HERE, 'pr-body-check.py')
    if not os.path.exists(path):
        return None
    spec = importlib.util.spec_from_file_location('pr_body_check', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.SEARCH_FILES


def row_of(repo, sha, gh):
    """The head's "Search before/after" check run ({external_id, status, conclusion, title}), or {}: asked by exact name, the latest of it."""
    got = json.loads(gh('api', f'repos/{repo}/commits/{sha}/check-runs?per_page=100&check_name={quote(ROW)}', '--jq',
                        '[.check_runs[] | {external_id: (.external_id // ""), status, conclusion, title: (.output.title // "")}]') or '[]')
    return got[0] if got else {}


def decide(row, starter_present):
    """-> (state, words) the row makes of a green PR, or None for no change. Pure."""
    if not row:
        return ('pending', 'search pair: no row yet, its pair starts by itself') if starter_present else None
    kind = (re.match(r'search-pair:([a-z]+):', row.get('external_id', '')) or [None, ''])[1]
    title = (row.get('title') or 'no title')
    if row.get('status') != 'completed' or kind in PENDING_STATES:
        return 'pending', f'search pair: {title}'
    if kind == 'unnamed' and not title.startswith(NEEDED):   # a limit or a failed dispatch is the system's to retry or a person's to start by hand, not a PR's red (sa, 14 Nov 2026: no red through no fault of its own)
        return 'pending', f'search pair: {title}'
    if row.get('conclusion') in ('success', 'neutral'):
        return None
    return 'failure', f'search pair: {title}'


def apply(repo, sha, pulls, files, state, why, gh):
    """-> (state, why) after the row's word. Only for the PR's current open head in this repository whose files match SEARCH_FILES, and only when `state` is success."""
    mine = next((p for p in pulls if p.get('state') == 'open' and not p.get('merged_at') and p.get('head_sha') == sha and not p.get('cross_repo')), None)
    if state != 'success' or not mine or files is None:
        return state, why
    match = search_files()
    if match is None or not any(match.match(name) for name in files):
        return state, why
    try:
        said = decide(row_of(repo, sha, gh), os.path.exists(os.path.join(HERE, STARTER)))
    except Exception as error:   # fail open, said: the status above stands
        print(f'search pair row not read ({type(error).__name__}): {str(error)[:200]}; the verdict is unchanged')
        return state, why
    return (said[0], said[1][:140]) if said else (state, why)
