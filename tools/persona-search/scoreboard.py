"""The scoreboard's lock (finish-line spec G3, docs/superpowers/specs/2026-11-10-find-jobs-finish-line.md): what the night Search check measures with
(the 18 people, the judge's prompt, the fixed source list, the check's AI chain) is fingerprinted into scoreboard.lock.json; a PR that changes one carries
`Scoreboard-change: "<owner's words>"` and rewrites the lock. The check reuses the fix ledger's (tools/press-ledger-check.py), with the parts computed live,
so a part changed without the lock rewritten is red too.
  python3 tools/persona-search/scoreboard.py --write-lock                 rewrite the lock after the owner's yes
  printf '%s' "$BODY" | python3 tools/persona-search/scoreboard.py --check --base origin/main     pr-gate.yml "Scoreboard kept"
Why (10 Nov 2026, owner: "Fixed guardrails"): in 30 days the measure changed under its own numbers 3 times with no line in its graph: the judge moved to
Haiku (8c6f107d, 27 Oct) then to Codex (d5faabd1, 30 Oct), and 6 people became 18 (#3340, 6 Nov)."""
import ast
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
LOCK = 'tools/persona-search/scoreboard.lock.json'
WORKFLOW = ROOT / '.github/workflows/search-personas.yml'
SPEC = ROOT / 'docs/superpowers/specs/2026-11-10-find-jobs-finish-line.md'
WHO = ('family', 'title', 'kind', 'city', 'country', 'language')   # a person's own fields; `reference` is the reference counter's (lj), not the measure


def people():
    """The 18 fixed people (who each one is) and the list a night runs."""
    rows = json.loads((HERE / 'gate-personas.json').read_text(encoding='utf-8'))['personas']
    night = re.search(r"fromJSON\(inputs\.personas \|\| '(\[[^']*\])'\)", WORKFLOW.read_text(encoding='utf-8'))
    return json.dumps({'people': [{k: p.get(k) for k in WHO} for p in rows], 'night': json.loads(night.group(1)) if night else None}, ensure_ascii=False, sort_keys=True)


def judge_prompt():
    """The judge's words and how a batch is asked: SYSTEM, MODEL, BATCH and the code of ask() and judge(), without comments or docstrings (a reworded comment is not a new measure)."""
    tree = ast.parse((HERE / 'gate_judge.py').read_text(encoding='utf-8'))
    kept = []
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, 'id', '') in ('SYSTEM', 'MODEL', 'BATCH') for t in node.targets):
            kept.append(node)
        elif isinstance(node, ast.FunctionDef) and node.name in ('ask', 'judge'):
            if node.body and isinstance(node.body[0], ast.Expr) and isinstance(getattr(node.body[0], 'value', None), ast.Constant):
                node.body = node.body[1:] or [ast.Pass()]
            kept.append(node)
    return '\n'.join(ast.unparse(node) for node in kept)


def sources():
    """The fixed source list: each row's source and whether it is in the market count (how it is counted may be filled in without a new measure)."""
    text = SPEC.read_text(encoding='utf-8') if SPEC.exists() else ''
    section = text.split('## The fixed source list', 1)[1].split('\n## ', 1)[0] if '## The fixed source list' in text else ''
    rows = [[cell.strip() for cell in line.strip().strip('|').split('|')] for line in section.splitlines() if line.startswith('|')]
    return json.dumps([row[:2] for row in rows[2:]], ensure_ascii=False)


def chain():
    """The AIs every call of the check may use, in order (JOBADABRA_CHECK_CHAIN in search-personas.yml: Codex, then Claude as its replacement), or 'none' while it has none."""
    found = re.search(r'^\s*JOBADABRA_CHECK_CHAIN:\s*([\w,-]+)', WORKFLOW.read_text(encoding='utf-8'), re.M)
    return found.group(1) if found else 'none'


PARTS = (('S1', 'the 18 people the check measures', people),
         ('S2', "the blind judge's prompt and model", judge_prompt),
         ('S3', 'the fixed source list of the market count', sources),
         ('S4', "the check's AI: Codex, Claude as its replacement, never Free AI", chain))


def lock():
    """{part id: its words and fingerprint}: what scoreboard.lock.json holds."""
    return {pid: {'gets': gets, 'hash': hashlib.sha256(read().encode()).hexdigest()[:16]} for pid, gets, read in PARTS}


def ledger_check():
    """tools/press-ledger-check.py as a module (its file name has dashes): the same base reading and gap rules as the fix ledger."""
    spec = importlib.util.spec_from_file_location('press_ledger_check', ROOT / 'tools/press-ledger-check.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def problems(base_lock, kept, body):
    """What stops the PR: a part changed without the owner's words, or the lock file not rewritten after a part changed -> [text]."""
    now = lock()
    out = ledger_check().gaps(base_lock, now, body, word='Scoreboard-change', whole=True)
    if kept != now:
        out.append('scoreboard.lock.json is not the measure in this tree: run `python3 tools/persona-search/scoreboard.py --write-lock`')
    return out


if __name__ == '__main__':
    path = ROOT / LOCK
    if '--write-lock' in sys.argv:
        path.write_text(json.dumps(lock(), indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
        print('scoreboard: lock written')
    elif '--check' in sys.argv:
        ledger = ledger_check()
        base = sys.argv[sys.argv.index('--base') + 1] if '--base' in sys.argv else 'origin/main'
        missing = problems(ledger.read_base(ledger.own_base(base), LOCK), json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}, sys.stdin.read())
        if missing:
            print('scoreboard: this PR changes what the Search check measures with: ' + '; '.join(missing) +
                  '. Ask the owner, add `Scoreboard-change: "<owner\'s words>"` to the PR body, then rewrite the lock.', file=sys.stderr)
            sys.exit(1)
        print('scoreboard: the measure is unchanged, or changed with the owner\'s words')
    else:
        print(json.dumps(lock(), indent=1, ensure_ascii=False))
