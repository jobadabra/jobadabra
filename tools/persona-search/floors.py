"""Floors that only rise (finish-line spec G2, docs/superpowers/specs/2026-11-10-find-jobs-finish-line.md): per series, person and number, the best level held on
3 measured nights in a row; a night below a floor by more than the person's spread, twice in a row, is red. The one owner of the floors' state, which lives under
`refs/tags/search-floors` (owner, 2 Nov 2026: "let's use tags not branches for storing things"; sa's decision (d), 10 Nov 2026).
Why (10 Nov 2026, owner: "Let's not forget about guardrails. Fixed guardrails"): one session's gain was undone by the next and nothing said so: #3685's first
build halved scoring, and the week of 30 Oct to 5 Nov read 0 right jobs every night.
Invariants:
- a series is one measure: the scoreboard lock's fingerprint (G3), the check's AI chain and the EURES mode; a `Scoreboard-change` starts a new series, the old one is kept;
- only a scheduled night on the locked chain writes (`--night`); a by-hand, free-ai or not-run run reads and reports, never writes;
- a floor only rises (seconds to first job: a ceiling that only falls); it is lowered only by floors-reset.json with `Floor-change: "<owner's words>"`;
- "not run", unmeasured, fault and second-try rows never count, for or against a floor;
- unreadable state is "floors: not checked (<why>)": never red, never a guessed floor.
Split (sa, 10 Nov 2026): the compare job computes with read rights only (`check`; exit 3 = a red night); the floors-save job alone writes the one ref (`save`).

  python3 tools/persona-search/floors.py check <verdict.json> <new-state.json> [--night]   adds `measure` + `floors` to the verdict; exit 3 when a night is red
  python3 tools/persona-search/floors.py save <new-state.json>                           floors-save: validate, then move refs/tags/search-floors (compare-and-swap)
  printf '%s' "$BODY" | python3 tools/persona-search/floors.py --check-reset --base origin/main   pr-gate: a new reset needs the owner's words"""
import datetime
import hashlib
import json
import os
import re
import statistics
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import runs as runs_mod  # noqa: E402

HERE = Path(__file__).resolve().parent
REF = 'tags/search-floors'
FILE = 'floors.json'
RESETS = 'tools/persona-search/floors-reset.json'
LOCK = HERE / 'scoreboard.lock.json'
KEEP = 14   # levels kept per number: enough for a spread and for "3 in a row"
MAX_BYTES = 1_000_000
LOST_KEY = re.compile(r'(gone|unread|floor|not-run):[\w ,.-]{1,40}')   # G6's open cause keys (tools/persona-search/lost.py): one shape, checked on both sides
LOST_MAX = 50
RED = 3   # check's exit code for a red night: a crash (exit 1) is never read as a floor
COUNTED = ('measured', 'none-right', 'nothing')   # gate.row_verdict's kinds that measured the code


def eures_share(row):
    """EURES in = out as a share (out / in), None when the reference had no right job."""
    eures = ((row.get('inout') or {}).get('eures') or {})
    return round(eures['out'] / eures['in'], 3) if eures.get('in') else None


NO_FIRST_JOB_S = 180   # Why (Gitar on #3719, 11 Nov 2026): gate.PRESS_LIMIT; a press past it is a fault, so "no first job" reads as the worst time a measured press can have


def first_s(row):
    """Seconds to the first job in the person's places; a measured press that found none reads NO_FIRST_JOB_S, never a skipped night (Gitar on #3719:
    funnel.step_counters says a step that silently stopped must read as a fall). None only when the press wrote no counters."""
    counters = row.get('counters')
    if not isinstance(counters, dict):
        return None
    return counters['firstS'] if isinstance(counters.get('firstS'), (int, float)) else NO_FIRST_JOB_S


# number: (how to read it from a person's raw row, +1 higher is better / -1 lower is better, the spread used before 5 levels)
NUMBERS = {
    'right': (lambda row: row.get('local'), 1, 1),
    'eures_inout': (eures_share, 1, 0.1),
    'first_s': (first_s, -1, 15),   # seconds to first job: its floor is a ceiling that only falls
    'new_on_2': (lambda row: runs_mod.new_right(row, 2), 1, 1),   # the right jobs the second run listed first (owner, 11 Nov 2026: "each of the runs should provide new jobs")
}


def measure():
    """The scoreboard lock's fingerprint: two nights compare only under the same measure (G3)."""
    return hashlib.sha256(LOCK.read_bytes()).hexdigest()[:12]


def series_key(verdict, chain):
    """The series a night belongs to: the lock's fingerprint, the check's AI chain (JOBADABRA_CHECK_CHAIN), the verdict's EURES mode ('on' when unsaid) and, for a
    night of more than one run per person (runs.py), the runs: a 2-run night never shares a floor with a 1-run one. The older 3-part keys stay readable; only
    `runs-2` is a floors series: more runs (the weekly 5) -> None, they keep their own record, never floors (Gitar on #3781: a runs-5 key would make the save refuse the state)."""
    count = max((len(row['runs']) for row in (verdict.get('personas') or {}).values() if isinstance(row, dict) and isinstance(row.get('runs'), list)), default=0)   # Why (Gitar on #3781): the night's runs, never one short person's
    if count > 2:
        return None
    return f"{measure()}|{chain}|eures-{verdict.get('eures') or 'on'}" + ('|runs-2' if count == 2 else '')


def worse(direction, now, floor, spread):
    """True when tonight's level is under the floor by more than the spread (over it, for a ceiling: direction -1)."""
    return now < floor - spread if direction > 0 else now > floor + spread


def held(levels, direction):
    """The best level held on 3 levels in a row (the worst of each window of 3, the best window), None before 3 levels."""
    values = [v for _, v in levels]
    windows = [values[i:i + 3] for i in range(len(values) - 2)]
    if not windows:
        return None
    pick = min if direction > 0 else max
    return (max if direction > 0 else min)(pick(w) for w in windows)


def spread_of(levels, default):
    """2 sd of the kept levels, never under the number's default; the default alone before 5 levels."""
    values = [v for _, v in levels]
    return max(default, round(2 * statistics.stdev(values), 3)) if len(values) >= 5 else default


def apply_resets(people, resets):
    """A reset on main (owner's words) drops a floor and the levels before its date, once."""
    for reset in resets:
        entry = people.get(str(reset['persona']), {}).get(reset['number'])
        if entry and entry.get('reset') != reset['from']:
            entry.update(floor=None, below=0, reset=reset['from'], levels=[lv for lv in entry.get('levels', []) if lv[0] >= reset['from']])


def update(state, verdict, chain, run, today, resets=(), sha=''):
    """-> (new state, report): tonight's levels against each floor, then floors raised. No network or environment; it reads only the scoreboard lock's
    fingerprint (series_key). `sha`: this run's commit, kept as the last green one."""
    state = json.loads(json.dumps(state or {'version': 1, 'series': {}}))
    key = series_key(verdict, chain)
    if key is None:
        return state, {'checked': False, 'why': 'more than 2 runs a person: the week keeps its own record, never floors', 'red': [], 'last_green': None}
    series = state['series'].setdefault(key, {'people': {}, 'last_green': None})
    apply_resets(series['people'], resets)
    kinds = {row['persona']: row['kind'] for row in verdict.get('rows', [])}
    inout = {row['persona']: row['inout'] for row in verdict.get('rows', []) if row.get('inout')}   # inout.attach writes it on the verdict rows (gate.py compare)
    red, levels = [], {}
    for n, row in sorted((int(k), v) for k, v in (verdict.get('personas') or {}).items()):
        if kinds.get(n) not in COUNTED or row.get('again'):   # `again`: a second try (again.py second, #3716)
            continue
        row = {**row, 'inout': row.get('inout') or inout.get(n)}
        for number, (read, direction, default) in NUMBERS.items():
            now = read(row)
            if now is None:
                continue
            entry = series['people'].setdefault(str(n), {}).setdefault(number, {'floor': None, 'since': None, 'levels': [], 'below': 0})
            spread = spread_of(entry['levels'][:len(entry['levels']) - entry['below']], default)   # the nights already under the floor never widen the spread
            below = entry['floor'] is not None and worse(direction, now, entry['floor'], spread)
            entry['below'] = entry['below'] + 1 if below else 0
            entry['levels'] = (entry['levels'] + [[today, now]])[-KEEP:]
            best = held(entry['levels'], direction)
            if best is not None and (entry['floor'] is None or (best - entry['floor']) * direction > 0):
                entry.update(floor=best, since={'run': run, 'date': today})
            levels.setdefault(str(n), {})[number] = {'floor': entry['floor'], 'now': now, 'spread': spread, 'below': entry['below']}
            if entry['below'] >= 2:
                red.append({'persona': n, 'number': number, 'floor': entry['floor'], 'now': now, 'spread': spread, 'below': entry['below']})
    report = {'checked': True, 'series': key, 'red': red, 'levels': levels, 'last_green': series['last_green']}
    if levels and not red:   # a night that measured nobody is no green night: the merges since the last real one stay named
        series['last_green'] = {'run': run, 'sha': sha}
    return state, report


def validate(state):
    """The shape floors-save accepts -> [problem]; anything else is never written (the state comes from a job that read scraped text)."""
    if not isinstance(state, dict) or not {'version', 'series'} <= set(state) <= {'version', 'series', 'lost'} or state['version'] != 1 or not isinstance(state['series'], dict):
        return ['not a floors state (version 1, series, optional lost)']
    out = []
    lost = state.get('lost', {'open': []})   # G6's causes open between nights (tools/persona-search/lost.py): fixed cause keys only, never scraped text
    if not isinstance(lost, dict) or set(lost) != {'open'} or not isinstance(lost['open'], list) or len(lost['open']) > LOST_MAX \
            or not all(isinstance(k, str) and LOST_KEY.fullmatch(k) for k in lost['open']):
        out.append('lost')
    for key, series in state['series'].items():
        if not re.fullmatch(r'[0-9a-f]{12}\|[\w,-]+\|eures-(on|off)(\|runs-2)?', key) or set(series) != {'people', 'last_green'}:
            out.append(f'series {key[:40]!r}')
            continue
        for n, numbers in (series['people'] or {}).items() if isinstance(series['people'], dict) else [('?', None)]:
            if not n.isdigit() or not isinstance(numbers, dict) or not set(numbers) <= set(NUMBERS) \
                    or not all(isinstance(e, dict) and isinstance(e.get('levels'), list) and isinstance(e.get('below'), int) for e in numbers.values()):
                out.append(f'{key[:12]} person {n[:10]!r}')
    if len(json.dumps(state)) > MAX_BYTES:
        out.append('over 1 MB')
    return out


def gh(*args, payload=None):
    """One GitHub API call through gh (GH_TOKEN), parsed JSON."""
    done = subprocess.run(['gh', 'api', *args, *(['--input', '-'] if payload is not None else [])], input=json.dumps(payload) if payload is not None else None,
                          capture_output=True, text=True, timeout=60)
    if done.returncode:
        raise RuntimeError((done.stderr or done.stdout).strip()[:200])
    return json.loads(done.stdout or 'null')


def read_state(repo):
    """-> (state commit sha or None when there is no state yet, state)."""
    try:
        sha = gh(f'repos/{repo}/git/ref/{REF}')['object']['sha']
    except RuntimeError as error:
        if 'Not Found' in str(error):
            return None, None
        raise
    text = subprocess.run(['gh', 'api', f'repos/{repo}/contents/{FILE}?ref={sha}', '-H', 'Accept: application/vnd.github.raw'], capture_output=True, text=True, timeout=60, check=True).stdout
    return sha, json.loads(text)


def save(repo, base, state):
    """Compare-and-swap: a commit whose parent is the state compare read; the ref moves only as a fast-forward (force=false), so a state moved meanwhile is refused."""
    tree = gh(f'repos/{repo}/git/trees', '-X', 'POST', payload={'tree': [{'path': FILE, 'mode': '100644', 'type': 'blob', 'content': json.dumps(state, indent=1)}]})['sha']
    commit = gh(f'repos/{repo}/git/commits', '-X', 'POST', payload={'message': 'Search floors', 'tree': tree, 'parents': [base] if base else []})['sha']
    if base:
        gh(f'repos/{repo}/git/refs/{REF}', '-X', 'PATCH', payload={'sha': commit, 'force': False})
    else:
        gh(f'repos/{repo}/git/refs', '-X', 'POST', payload={'ref': f'refs/{REF}', 'sha': commit})
    return commit


def merges_since(repo, last_green):
    """The merges since the floors were last green: the newest 10 first lines, 100 characters each (oe: what the site keeps)."""
    if not (last_green or {}).get('sha') or not os.environ.get('GITHUB_SHA'):
        return []
    try:
        commits = gh(f"repos/{repo}/compare/{last_green['sha']}...{os.environ['GITHUB_SHA']}")['commits']
    except (RuntimeError, KeyError, TypeError):
        return []
    return [c['commit']['message'].splitlines()[0][:100] for c in commits][-10:]


def reset_ok(reset):
    """A reset entry floors can apply: {persona: int, number: one of NUMBERS, from: YYYY-MM-DD, words: text}."""
    return isinstance(reset, dict) and isinstance(reset.get('persona'), int) and reset.get('number') in NUMBERS \
        and bool(re.fullmatch(r'\d{4}-\d\d-\d\d', str(reset.get('from')))) and bool(str(reset.get('words') or '').strip())


def resets_on(ref='HEAD', valid=True):
    """floors-reset.json at a ref; `valid`: only the entries floors can apply."""
    try:
        found = json.loads(subprocess.run(['git', 'show', f'{ref}:{RESETS}'], capture_output=True, text=True, check=True).stdout)
    except (subprocess.CalledProcessError, ValueError):
        return []
    found = found if isinstance(found, list) else []
    return [r for r in found if reset_ok(r)] if valid else found


def floor_change_words(body):
    """{words} of each `Floor-change: "<owner's words>"` line of a PR body: the one way a bar is lowered (the floors here)."""
    return {m.strip() for m in re.findall(r'^\s*[-*]?\s*Floor-change:\s*["“](.+?)["”]\s*$', body or '', re.M)}


def reset_gaps(base_resets, head_resets, body):
    """New resets whose words are not in a `Floor-change: "<words>"` line of the PR body -> [text]."""
    said = floor_change_words(body)
    new = [r for r in head_resets if r not in base_resets]
    return [f'an entry floors cannot apply (persona int, number in {sorted(NUMBERS)}, from YYYY-MM-DD, words): {json.dumps(r)[:120]}' for r in new if not reset_ok(r)] + \
        [f"p{r['persona']} {r['number']} from {r['from']}" for r in new if reset_ok(r) and str(r.get('words')).strip() not in said]


def check(verdict_path, state_out, night):
    """compare: read the state (read rights only), add `measure` + `floors` to the verdict, write {base, state} for floors-save -> exit code (1: a red night)."""
    repo, verdict = os.environ.get('GITHUB_REPOSITORY', ''), json.loads(Path(verdict_path).read_text(encoding='utf-8'))
    verdict['measure'] = measure()
    if verdict.get('state') == 'not-run':
        verdict['floors'] = {'checked': False, 'why': 'not run: no AI answered'}
    else:
        try:
            base, state = read_state(repo)
            if state is not None and validate(state):
                raise ValueError('; '.join(validate(state))[:200])
            chain = os.environ.get('JOBADABRA_CHECK_CHAIN', 'codex,claude')
            new, report = update(state, verdict, chain, os.environ.get('GITHUB_RUN_ID', 'local'), os.environ.get('FLOORS_TODAY') or datetime.date.today().isoformat(),
                                 resets_on(), os.environ.get('GITHUB_SHA', ''))
            report['merges'] = merges_since(repo, report['last_green']) if report['red'] else []   # once per night, not per red number (the site's 64 KB upload cap)
            verdict['floors'] = report
            if night:
                Path(state_out).write_text(json.dumps({'base': base, 'state': new}), encoding='utf-8')
        except Exception as error:   # noqa: BLE001 (Why: /code-review on G2: any failure here is "not checked", never read as a red floor)
            verdict['floors'] = {'checked': False, 'why': f'state unreadable: {type(error).__name__}: {error}'[:200]}
    Path(verdict_path).write_text(json.dumps(verdict, ensure_ascii=False, indent=1), encoding='utf-8')
    floors = verdict['floors']
    print('floors: ' + (f"not checked ({floors['why']})" if not floors['checked'] else
                        '; '.join(f"p{r['persona']} {r['number']} {r['now']} under its floor {r['floor']} two nights in a row" for r in floors['red']) or 'every number at or above its floor'))
    return RED if night and floors.get('red') else 0


def save_main(state_file):
    """floors-save: write the state compare computed, only when its shape is the known one; up to 3 tries on a transient error, never forced."""
    repo, data = os.environ['GITHUB_REPOSITORY'], json.loads(Path(state_file).read_text(encoding='utf-8'))
    problems = validate(data.get('state'))
    if problems or (data.get('base') is not None and not re.fullmatch(r'[0-9a-f]{40}', str(data['base']))):
        print(f"floors: not saved (shape: {'; '.join(problems) or 'base'})")
        return 1
    for attempt in range(3):
        try:
            print(f"floors: saved {save(repo, data['base'], data['state'])[:8]}")
            return 0
        except RuntimeError as error:
            if 'fast forward' in str(error).lower() or 'already exists' in str(error).lower():
                print('floors: not saved (the state moved since compare read it); the next night reads the newer state')
                return 0
            print(f'floors: try {attempt + 1} failed: {error}')
    print('::error::floors: not saved after 3 tries (the floors stop persisting until this is fixed)')
    return 1


def main(argv):
    if argv[:1] == ['check']:
        sys.exit(check(argv[1], argv[2], '--night' in argv))
    if argv[:1] == ['save']:
        sys.exit(save_main(argv[1]))
    if '--check-reset' in argv:
        base = argv[argv.index('--base') + 1] if '--base' in argv else 'origin/main'
        gaps = reset_gaps(resets_on(base, valid=False), resets_on('HEAD', valid=False), sys.stdin.read())
        for gap in gaps:
            print(f'floors-reset.json: {gap}' if gap.startswith('an entry') else f'floors-reset.json lowers {gap} without the owner\'s words: add `Floor-change: "<exact words of the owner>"` to the PR description')
        sys.exit(1 if gaps else 0)
    sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
