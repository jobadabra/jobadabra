"""Starts a search PR's before/after pair by itself: what the row "Search before/after" says when the PR opens, when a pair may start, and when a finished pair carries over.
Why (13 Nov 2026, owner via sa: "Can we add the before/after as a CI check on the PR ?"; sa on 2/3: "do not run a pair a push does not need"): the PR's own session started the pair by hand
(or ship did, with a draft and a DONT MERGE title). Now the PR's opening puts the row on the head, "waiting for the other checks"; once they are green the pair is dispatched and takes the row over
(search-pair.yml's check_id input); a head whose search files are the same as the last paired head carries that pair's result instead of running another (a review fix costs no 11 min of broker room).
In reach = SEARCH_FILES of tools/pr-body-check.py, the one list that already asks a PR for its "Moves:" line. The people are the ones its Moves lines name (up to 3).
Commands (the workflow search-pair-start.yml): decide <changed.txt> <body.txt> <row-external-id|''>, ready <check-runs.json> <statuses.json>, carry <changed-between.txt>, people-json <row-external-id>.
Tests: tests/tooling/ci/test_pair_start.py."""
import importlib.util
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MAX_PEOPLE = 3   # a dispatch's people (pair.py MAX_PEOPLE; sa, 13 Nov 2026)
ROW = 'Search before/after'
OTHERS_EXCLUDED = {ROW, 'All checks passed'}   # the row is this check; "All checks passed" will read it (3/3), so waiting for it would wait for ourselves
_SPEC = importlib.util.spec_from_file_location('pr_body_check', HERE.parents[1] / 'tools' / 'pr-body-check.py')
_CHECK = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_CHECK)
PERSON_LINE = re.compile(r'^\s*[-*]?\s*\**Moves:\**\s*(?P<person>p\d{1,2}|[a-z]\d{2})\b', re.M)
NOTHING_LINE = re.compile(r'^\s*[-*]?\s*\**Moves:\**\s*nothing\s*\((?P<why>[^)<>]*\w[^)<>]*)\)', re.M)


def in_reach(changed):
    """The changed files that decide what Find jobs reads, keeps, scores or orders."""
    return sorted(path for path in changed if _CHECK.SEARCH_FILES.match(path))


def named(body):
    """The people the body's Moves lines name, in order, up to MAX_PEOPLE: night people as numbers (p3 -> 3), profiles as ids; the form `gh workflow run search-pair.yml -f people=` takes."""
    out = []
    for hit in PERSON_LINE.finditer(body or ''):
        person = hit.group('person')
        one = int(person[1:]) if re.fullmatch(r'p\d{1,2}', person) else person
        if one not in out:
            out.append(one)
    return out[:MAX_PEOPLE]


def external_id(state, people):
    """What the row keeps in its external_id: its state (waiting, running, done) and the people, so a later event can tell "the same pair" without a database."""
    return f"search-pair:{state}:{','.join(str(p) for p in people)}"


def parse_external_id(value):
    """(state, people as the strings after the last colon) of a row's external_id, or (None, []) when it is not ours."""
    hit = re.fullmatch(r'search-pair:(waiting|running|done|carried):([^:]*)', value or '')
    return (hit.group(1), [p for p in hit.group(2).split(',') if p]) if hit else (None, [])


def decide(changed, body, row_external_id=''):
    """What to do for a PR event: {action, title, summary, people, external_id}. action: none (not in reach, or this head's row already stands for these people),
    green (the body says the change moves nothing: the row is green with that reason), red (no person named), wait (the row is created: waiting for the other checks)."""
    reach = in_reach(changed)
    if not reach:
        return {'action': 'none', 'title': '', 'summary': '', 'people': [], 'external_id': ''}
    nothing = NOTHING_LINE.search(body or '')
    if nothing:
        why = nothing.group('why').strip()
        return {'action': 'green', 'title': f'no search change: {why}'[:140], 'summary': f'The body says this PR moves nothing a person feels: {why}\nSearch files it touches: {", ".join(reach[:5])}.',
                'people': [], 'external_id': external_id('done', [])}
    people = named(body)
    if not people:
        fix = _CHECK.MOVES_FIX
        return {'action': 'red', 'title': 'name up to 3 people in a Moves line', 'summary': f'This PR changes search files ({", ".join(reach[:3])}) and names no person: {fix}',
                'people': [], 'external_id': ''}
    state, was = parse_external_id(row_external_id)
    if state in ('waiting', 'running', 'done', 'carried') and was == [str(p) for p in people]:
        # Why (sa, 13 Nov 2026): an edit of the body alone, with the same people, must not restart a pair that runs or counted
        return {'action': 'none', 'title': '', 'summary': '', 'people': people, 'external_id': row_external_id}
    return {'action': 'wait', 'title': 'waiting for the other checks, then the pair starts', 'summary': f'Search files this PR changes: {", ".join(reach[:5])}. People: {", ".join(str(p) for p in people)}. One run a side.',
            'people': people, 'external_id': external_id('waiting', people)}


COMPARE_CAP = 300   # GitHub's compare lists at most 300 files: a list that long may be cut, so it can not prove "no search file differs"


def carry(changed_between):
    """'carry' when no search file differs between the last paired head and this one (its finished pair still holds), else 'search' (a new pair).
    Invariant: a file list at GitHub's cap (COMPARE_CAP) is never read as "nothing differs"."""
    return 'search' if len(changed_between) >= COMPARE_CAP or in_reach(changed_between) else 'carry'


def ready(check_runs, statuses):
    """(True, '') when every check on the head except the row and "All checks passed" has ended well, else (False, why).
    check_runs: the head's check runs ({name, status, conclusion}); statuses: its commit statuses ({context, state})."""
    for run in check_runs:
        if run.get('name') in OTHERS_EXCLUDED:
            continue
        if run.get('status') != 'completed':
            return False, f"{run.get('name')} has not ended"
        if run.get('conclusion') not in ('success', 'neutral', 'skipped'):
            return False, f"{run.get('name')} ended {run.get('conclusion')}"
    for status in statuses:
        if status.get('context') in OTHERS_EXCLUDED:
            continue
        if status.get('state') != 'success':
            return False, f"{status.get('context')} is {status.get('state')}"
    return True, ''


def people_json(external):
    """The people of a row's external_id as the JSON list `search-pair.yml -f people=` takes (night people as numbers, profiles as ids); '[]' for a row that is not ours."""
    return json.dumps([int(p) if p.isdigit() else p for p in parse_external_id(external)[1]])


def main(argv):
    """The command line above."""
    command = argv[1] if len(argv) > 1 else ''
    if command == 'decide' and len(argv) == 5:
        changed = Path(argv[2]).read_text(encoding='utf-8').split()
        out = decide(changed, Path(argv[3]).read_text(encoding='utf-8'), argv[4])
        Path('decision.json').write_text(json.dumps(out), encoding='utf-8')
        print(out['action'])
        return 0
    if command == 'ready' and len(argv) == 4:
        ok, why = ready(json.loads(Path(argv[2]).read_text(encoding='utf-8')), json.loads(Path(argv[3]).read_text(encoding='utf-8')))
        print('ready' if ok else f'wait {why}')
        return 0
    if command == 'people-json' and len(argv) == 3:
        print(people_json(argv[2]))
        return 0
    if command == 'carry' and len(argv) == 3:
        print(carry(Path(argv[2]).read_text(encoding='utf-8').split()))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
