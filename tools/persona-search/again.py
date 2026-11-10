"""A person the AI was too slow or too busy for runs once more at the end of the same night, and that row says so (search-personas.yml `again`).
Why (10 Nov 2026, sa, WP5 3/6 of docs/superpowers/specs/2026-11-10-find-jobs-finish-line.md): 11 of the last 14 nights lost at least one person to "AI slow" or
"AI queue full" (28 person-nights), each a gap in that person's line although the press itself was fine. A second try, alone at the end, often meets a quiet AI.
Invariants: only those two causes run again (a "not run" night's broker is out, so it would be refused again; a fault is the code's and stays red); a row
measured on its second try always carries `again: 1` and its `first_try`, never shown silently as the better of two.

  python3 tools/persona-search/again.py list <results dir> <out dir>      prints personas=[...] for $GITHUB_OUTPUT; writes <out dir>/first-try.json {n: why}
  python3 tools/persona-search/again.py second <persona out dir>           this press is the second try: `again: 1` on its result.json
  python3 tools/persona-search/again.py mark <results dir> <first-try.json> a second try's row gets its first try's why (`first_try`)"""
import json
import sys
from pathlib import Path

SECOND_TRY = ('AI slow', 'AI queue full')   # gate.grey_reason's words for an AI that answered too slowly or not at all in time


def results(folder):
    """{persona n: (path, row)} for every result.json under a folder (a run's downloaded persona artifacts)."""
    found = {}
    for path in sorted(Path(folder).rglob('result.json')):
        try:
            row = json.loads(path.read_text(encoding='utf-8'))
        except ValueError:
            continue
        if isinstance(row, dict) and 'persona' in row:
            found[int(row['persona'])] = (path, row)
    return found


def wanted(folder):
    """{persona n: first try's why} for the rows that run once more: grey for a slow or busy AI, and not already a second try."""
    return {n: row['not_measured'] for n, (_, row) in sorted(results(folder).items())
            if str(row.get('not_measured') or '').startswith(SECOND_TRY) and not row.get('again')}


def second(out):
    """Mark this press's row as the night's second try; no row (or an unreadable one) is left as it is."""
    path = Path(out) / 'result.json'
    try:
        row = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return
    path.write_text(json.dumps({**row, 'again': 1}, ensure_ascii=False), encoding='utf-8')


def mark(folder, first_try_file):
    """Give each second try's row the why of its first try; returns the persons marked. A person whose second try left no row keeps its first row unmarked."""
    try:
        first = {int(n): why for n, why in json.loads(Path(first_try_file).read_text(encoding='utf-8')).items()}
    except (OSError, ValueError):
        return []
    marked = []
    for n, (path, row) in results(folder).items():
        if row.get('again') and n in first:
            path.write_text(json.dumps({**row, 'first_try': first[n]}, ensure_ascii=False), encoding='utf-8')
            marked.append(n)
    return marked


def main(argv):
    if argv[:1] == ['list']:
        again = wanted(argv[1])
        Path(argv[2]).mkdir(parents=True, exist_ok=True)
        (Path(argv[2]) / 'first-try.json').write_text(json.dumps({str(n): why for n, why in again.items()}, ensure_ascii=False), encoding='utf-8')
        print(f'personas={json.dumps(list(again))}')
    elif argv[:1] == ['second']:
        second(argv[1])
    elif argv[:1] == ['mark']:
        print(f'second tries: {mark(argv[1], argv[2]) or "none"}')
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
