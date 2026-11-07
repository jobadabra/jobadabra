#!/usr/bin/env python3
"""A PR that changes desktop/renderer carries the measured "Design system" table of `npm run design-check` (owner, 7 Nov 2026: "this Design checks on the PR seems stale and
inefficient"; chosen "Measured check (Recommended)"). It replaces the six `- [x]` ticks that tools/pr-body.sh used to count and nothing read.
  tools/design-table-check.py <base> <summary-file>   exit 1 with the reason: no table, a rule row missing, a ❌ cell, or a table measured on a different change.
The table says which commit it was measured on. That commit must still exist here and have the same renderer change as HEAD (same patch-id over desktop/renderer against the
base): ship.sh rebases, so a sha equal to HEAD would fail every PR; an edit to the renderer after the measure fails, a rebase or a docs commit does not."""
import re
import subprocess
import sys

HEADING = re.compile(r'^(?:\*\*|#{2,4} 🎨 )Design system \(measured on ([0-9a-f]{7,40})\)(?:\*\*)?\s*$', re.M)
RULES = ['Spacing scale', '1 primary / card', 'No ghost button', 'No card in card', 'Nothing clipped', 'Contrast AA']
HOWTO = 'run `npm run design-check -- --screens <the screens you changed>` from desktop/ on the committed change and paste its table into the summary'


def git(*args, stdin=None):
    """Run git with the arguments (text on stdin if given) and return its trimmed stdout; a failure gives '' (callers treat that as "not found")."""
    return subprocess.run(['git', *args], input=stdin, capture_output=True, text=True).stdout.strip()


def patch_id(a, b):
    """The stable patch-id of the renderer change between two commits ('' when there is none)."""
    return git('patch-id', '--stable', stdin=git('diff', a, b, '--', 'desktop/renderer')).split(' ')[0]


def problem(base, text):
    """Why the summary text fails the Design system rule against <base>, or None when it holds: the table, its six rows, no ❌, a commit we have, the same renderer change as HEAD."""
    match = HEADING.search(text)
    if not match:
        return f'this PR changes the desktop window but the summary has no "Design system (measured on <sha>)" table: {HOWTO}'
    sha = match.group(1)
    table = [line for line in text[match.end():].split('\n\n')[0].split('\n') if line.startswith('|')]
    missing = [rule for rule in RULES if not any(line.startswith(f'| {rule}') for line in table)]
    if missing:
        return f'the Design system table has no row for {", ".join(missing)}: {HOWTO}'
    bad = [line for line in table if '❌' in line]
    if bad:
        return f'the Design system table has a ❌ (a violation main does not have): {bad[0].split("|")[1].strip()}; fix the screen, or take the screen out of the PR'
    if subprocess.run(['git', 'cat-file', '-e', f'{sha}^{{commit}}'], capture_output=True).returncode:
        return f'the Design system table was measured on {sha}, a commit this checkout does not have: {HOWTO}'
    if patch_id(git('merge-base', base, sha), sha) != patch_id(git('merge-base', base, 'HEAD'), 'HEAD'):   # each from its own fork point: a base that moved on is not this change
        return f'the Design system table was measured on {sha}, but desktop/renderer has changed since: {HOWTO}'
    return None


if __name__ == '__main__':
    found = problem(sys.argv[1], open(sys.argv[2], encoding='utf-8').read())
    if found:
        print(found, file=sys.stderr)
        sys.exit(1)
