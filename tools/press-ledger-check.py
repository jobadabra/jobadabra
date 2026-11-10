"""A PR that changes or removes a fix of the press's ledger carries the owner's words for it (owner, 7 Nov 2026: "we overwrite one another and we never get it right";
spec docs/superpowers/specs/2026-11-07-the-press-design.md). Compares tests/unit/press/ledger.lock.json on the base with this tree's; every fix whose lock row
is gone or changed needs a line `Ledger-change: L<nn> "<owner's words>"` in the PR body (stdin). Adding a fix needs nothing. Exit 1 naming the fixes.
Run by pr-gate.yml "Fix ledger kept": `printf '%s' "$BODY" | python3 tools/press-ledger-check.py --base origin/main`.
Why (7 Nov 2026, the research "Find jobs: why we go in circles"): #3089 removed #3074's scoring share 8 h later, #3336 rewrote test_ai_slots and #3551
flipped test_employer_index; each was a fix's test changed inside the PR that undid it."""
import json
import re
import subprocess
import sys
from pathlib import Path

LOCK = 'tests/unit/press/ledger.lock.json'


def read_base(base, lock=LOCK):
    """The lock on `base`, {} when the base has none yet (the lock's own first PR). `lock`: the scoreboard's lock reuses this (tools/persona-search/scoreboard.py)."""
    try:
        return json.loads(subprocess.run(['git', 'show', f'{base}:{lock}'], capture_output=True, text=True, check=True).stdout)
    except (subprocess.CalledProcessError, ValueError):
        return {}


def own_base(base):
    """The commit this tree started from: `git merge-base <base> HEAD`, else `base` itself (no history to ask). The PR's own change is what the owner's words are for, not whatever main moved to since.
    Why (10 Nov 2026, fr; #3643, rerun 01:03Z): the lock was read from the CURRENT origin/main, so a PR behind main (a rerun, a description edit, a run that started before another PR changed the lock)
    read main's newer rows as its own change and went red, 'changing' L01 and L04 it never touched. The lock changed on main 8 times between 7 and 10 Nov."""
    try:
        return subprocess.run(['git', 'merge-base', base, 'HEAD'], capture_output=True, text=True, check=True).stdout.strip() or base
    except (subprocess.CalledProcessError, OSError):
        return base


def gaps(base_lock, head_lock, body, word='Ledger-change', whole=False):
    """The rows changed or removed without the owner's words in the body -> ['L13 (changed: "...")', ...]. A line names its row (`Ledger-change: L13 "<words>"`);
    with `whole`, a line without a row id covers every row (the scoreboard's `Scoreboard-change: "<words>"`, one measure)."""
    lines = [m.group(1) for m in re.finditer(rf'^\s*[-*]?\s*{word}:\s*(?:([A-Z]\d+)\s+)?["“].+["”]', body or '', re.M)]
    allowed = {row for row in lines if row}
    out = []
    for fix, row in sorted(base_lock.items()):
        state = 'removed' if fix not in head_lock else 'changed' if head_lock[fix].get('hash') != row.get('hash') else None
        if state and fix not in allowed and not (whole and None in lines):
            out.append(f'{fix} ({state}: "{row.get("gets", "")}")')
    return out


if __name__ == '__main__':
    base = sys.argv[sys.argv.index('--base') + 1] if '--base' in sys.argv else 'origin/main'
    head = Path(LOCK)
    missing = gaps(read_base(own_base(base)), json.loads(head.read_text()) if head.exists() else {}, sys.stdin.read())
    if missing:
        print('press ledger: this PR changes or removes a past fix without the owner\'s yes: ' + '; '.join(missing) +
              '. Read the fix\'s PR (tests/unit/press/ledger.py), ask the owner, then add `Ledger-change: L<nn> "<owner\'s words>"` to the PR body.', file=sys.stderr)
        sys.exit(1)
    print('press ledger: no past fix changed or removed without the owner\'s yes')
