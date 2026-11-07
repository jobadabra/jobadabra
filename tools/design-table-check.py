#!/usr/bin/env python3
"""A PR that changes desktop/renderer carries the measured "Design system" report of `npm run design-check` (owner, 7 Nov 2026: "this Design checks on the PR seems stale and
inefficient"; chosen "Measured check (Recommended)"; the same day: "let's make it one green per column. I don't want to see 100 checkboxes", chosen "Verdict + only what fails").
  tools/design-table-check.py <base> <summary-file>   exit 1 with the reason: no report, no verdict, a ⛔ verdict (its failing rows named), or a report measured on a different change.
The report's first line says which commit it was measured on and the verdict: `Design system (measured on <sha>) ✅ all 6 rules pass on N screens`, or `... ⛔ N new problems`
followed by a table of only the failing cells. That commit must still exist here and have the same renderer change as HEAD (same patch-id over desktop/renderer against the
base): ship.sh rebases, so a sha equal to HEAD would fail every PR; an edit to the renderer after the measure fails, a rebase or a docs commit does not.
Why (7 Nov 2026): a ⛔ report is refused like the ❌ cell was: it is a problem main's render does not have; the writer is desktop/scripts/design-table.mjs, keep the two first lines in step."""
import re
import subprocess
import sys

HEADING = re.compile(r'^(?:\*\*|#{2,4} 🎨 )Design system \(measured on ([0-9a-f]{7,40})\)(?:\*\*)?[ \t]*(.*)$', re.M)   # the rest of the line is the verdict
RULES = 6   # the rules design-table.mjs measures; a report that says all of another number was edited or is out of date
HOWTO = 'run `npm run design-check -- --screens <the screens you changed>` from desktop/ on the committed change and paste its report into the summary'


def git(*args, stdin=None):
    """Run git with the arguments (text on stdin if given) and return its trimmed stdout; a failure gives '' (callers treat that as "not found")."""
    return subprocess.run(['git', *args], input=stdin, capture_output=True, text=True).stdout.strip()


def patch_id(a, b):
    """The stable patch-id of the renderer change between two commits ('' when there is none)."""
    return git('patch-id', '--stable', stdin=git('diff', a, b, '--', 'desktop/renderer')).split(' ')[0]


def failing_rows(text):
    """The table rows (as `Rule, screen, +n`) that follow the heading, up to the first line that is not part of the table."""
    rows = []
    for line in text.split('\n'):
        if line.startswith('|'):
            cells = [cell.strip() for cell in line.strip('|').split('|')]
            if len(cells) >= 3 and cells[0] != 'Rule' and not cells[0].startswith('-'):
                rows.append(f'{cells[0]} {cells[1]} {cells[2]}')
        elif rows:
            break
    return rows


def problem(base, text):
    """Why the summary text fails the Design system rule against <base>, or None when it holds: the report, a green verdict for all the rules, a commit we have, the same renderer change as HEAD."""
    match = HEADING.search(text)
    if not match:
        return f'this PR changes the desktop window but the summary has no "Design system (measured on <sha>)" report: {HOWTO}'
    sha, verdict = match.group(1), match.group(2)
    if '⛔' in verdict:
        rows = failing_rows(text[match.end():])
        return f'the Design system report has {verdict.split("⛔")[1].strip()} (a violation main does not have): {"; ".join(rows[:3]) or "see its table"}; fix the screen, or take the screen out of the PR'
    if f'✅ all {RULES} rules pass' not in verdict:
        return f'the Design system report line has no verdict "✅ all {RULES} rules pass on N screens" (it says "{verdict}"): {HOWTO}'
    if subprocess.run(['git', 'cat-file', '-e', f'{sha}^{{commit}}'], capture_output=True).returncode:
        return f'the Design system report was measured on {sha}, a commit this checkout does not have: {HOWTO}'
    if patch_id(git('merge-base', base, sha), sha) != patch_id(git('merge-base', base, 'HEAD'), 'HEAD'):   # each from its own fork point: a base that moved on is not this change
        return f'the Design system report was measured on {sha}, but desktop/renderer has changed since: {HOWTO}'
    return None


if __name__ == '__main__':
    found = problem(sys.argv[1], open(sys.argv[2], encoding='utf-8').read())
    if found:
        print(found, file=sys.stderr)
        sys.exit(1)
