"""The scoreboard's lock (finish-line spec G3, docs/superpowers/specs/2026-11-10-find-jobs-finish-line.md): what the night Search check measures with
(the 18 people, the judge's prompt, the fixed source list, the check's AI chain, what counts as a listed job) is fingerprinted into scoreboard.lock.json; a PR that changes one carries
`Scoreboard-change: "<owner's words>"` and rewrites the lock. The check reuses the fix ledger's (tools/press-ledger-check.py), with the parts computed live,
so a part changed without the lock rewritten is red too.
  python3 tools/persona-search/scoreboard.py --write-lock                 rewrite the lock after the owner's yes
  printf '%s' "$BODY" | python3 tools/persona-search/scoreboard.py --check --base origin/main     pr-gate.yml "Scoreboard kept"
Why (10 Nov 2026, owner: "Fixed guardrails"): in 30 days the measure changed under its own numbers 3 times with no line in its graph: the judge moved to
Haiku (8c6f107d, 27 Oct) then to Codex (d5faabd1, 30 Oct), and 6 people became 18 (#3340, 6 Nov)."""
import ast
import hashlib
import importlib.util
import io
import json
import re
import sys
import tokenize
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
LOCK = 'tools/persona-search/scoreboard.lock.json'
WORKFLOW = ROOT / '.github/workflows/search-personas.yml'
SPEC = ROOT / 'docs/superpowers/specs/2026-11-10-find-jobs-finish-line.md'
WHO = ('family', 'title', 'kind', 'city', 'country', 'language')   # a person's own fields; `reference` is the reference counter's (lj), not the measure


def people():
    """The 18 fixed people (who each one is), the list a night runs and how many runs a night presses per person (the `presses` input's default; owner,
    11 Nov 2026: "2 runs nightly, 5 runs weekly (Recommended)")."""
    rows = json.loads((HERE / 'gate-personas.json').read_text(encoding='utf-8'))['personas']
    text = WORKFLOW.read_text(encoding='utf-8')
    night = re.search(r"fromJSON\(inputs\.personas \|\| '(\[[^']*\])'\)", text)
    runs = re.search(r"\n      presses:\n(?:        .*\n)*?        default: '(\d+)'", text)
    return json.dumps({'people': [{k: p.get(k) for k in WHO} for p in rows], 'night': json.loads(night.group(1)) if night else None,
                       'runs': int(runs.group(1)) if runs else None}, ensure_ascii=False, sort_keys=True)


def judge_prompt():
    """The judge's words and how a batch is asked and voted: SYSTEM, MODEL, BATCH, TIERS and the code of ask(), judge(), key() and complete() in gate_judge.py, and how many
    answers make a verdict (judge_three.py), as their source tokens without comments or docstrings (a reworded comment is not a new measure).
    Why (10 Nov 2026, #3708 red): ast.unparse prints the same code differently across Python builds (3.12.6 here, 3.12.16 on CI, 3.9), so the fingerprint is the source's own
    text, which no Python version rewrites. Why (11 Nov 2026, the owner's majority of 3): the vote decides each verdict as much as the prompt does, so it is the same part."""
    return '\n'.join(_code('gate_judge.py', ('SYSTEM', 'MODEL', 'BATCH', 'TIERS'), ('ask', 'judge', 'key', 'complete')) +
                     _code('judge_three.py', ('ANSWERS', 'AGREE', 'ROLE', 'PLACE', 'UNJUDGED'), ('answered_three', '_vote', 'majority')))


def _code(name, constants, functions):
    """The named constants' and functions' source tokens of one file next to this one, in file order, each function without its docstring."""
    source = (HERE / name).read_text(encoding='utf-8')
    kept = []
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and any(getattr(t, 'id', '') in constants for t in node.targets):
            kept.append(tokens(ast.get_source_segment(source, node)))
        elif isinstance(node, ast.FunctionDef) and node.name in functions:
            code = ast.get_source_segment(source, node)
            if node.body and isinstance(node.body[0], ast.Expr) and isinstance(getattr(node.body[0], 'value', None), ast.Constant):
                code = code.replace(ast.get_source_segment(source, node.body[0]), '', 1)
            kept.append(tokens(code))
    return kept


def tokens(code):
    """The code's own text without its comments, whitespace runs as one space. Only the comments' positions come from tokenize (the same in every Python);
    re-printed tokens are not stable (3.12 splits f-strings into new token kinds, PEP 701), nor is ast.unparse."""
    lines = code.splitlines(keepends=True)
    comments = [token for token in tokenize.generate_tokens(io.StringIO(code).readline) if token.type == tokenize.COMMENT]
    for token in reversed(comments):
        (row, start), (_, end) = token.start, token.end
        lines[row - 1] = lines[row - 1][:start] + lines[row - 1][end:]
    return ' '.join(''.join(lines).split())


def sources():
    """The fixed source list: each row's source and whether it is in the market count (how it is counted may be filled in without a new measure)."""
    text = SPEC.read_text(encoding='utf-8') if SPEC.exists() else ''
    section = text.split('## The fixed source list', 1)[1].split('\n## ', 1)[0] if '## The fixed source list' in text else ''
    rows = [[cell.strip() for cell in line.strip().strip('|').split('|')] for line in section.splitlines() if line.startswith('|')]
    return json.dumps([row[:2] for row in rows[2:]], ensure_ascii=False)


def chain():
    """The night's AIs, in order (JOBADABRA_CHECK_CHAIN in search-personas.yml: Codex, then Claude as its replacement; the default of `inputs.chain` when a by-hand run may name
    another series, such as free-ai alone, which is never a night), or 'none' while it has none."""
    found = re.search(r"^\s*JOBADABRA_CHECK_CHAIN:\s*(?:\$\{\{\s*inputs\.chain\s*\|\|\s*'([\w,-]+)'\s*\}\}|([\w,-]+))", WORKFLOW.read_text(encoding='utf-8'), re.M)
    return (found.group(1) or found.group(2)) if found else 'none'



def listed():
    """What counts as a listed job: the shown count's person and how it is read (shown.py ENV, keys(), counts(), _list()), as source tokens.
    Why (owner, 11 Nov 2026, asked via AskUserQuestion by sa: "Count what the list shows, then 4/5 (Recommended)"): which jobs count as listed moves every number of the check."""
    return '\n'.join(_code('shown.py', ('ENV',), ('keys', 'counts', '_list')))


PARTS = (('S1', 'the 18 people the check measures', people),
         ('S2', "the blind judge's prompt and model", judge_prompt),
         ('S3', 'the fixed source list of the market count', sources),
         ('S4', "the check's AI: Codex, Claude as its replacement, never Free AI", chain),
         ('S5', "what counts as a listed job: the app's Jobs list once the search has ended, beside every open job", listed))


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
