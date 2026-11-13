"""The "Search before/after" row of a search PR's checks list: one verdict per pair, from the same numbers the PR comment shows (tools/persona-search/pair.py).
Why (13 Nov 2026, owner via sa: "Can we add the before/after as a CI check on the PR ?" · "instead of having \"DONT MERGE\"... we'll just have red check"): a pair's result lived only
in a comment and the search-hold label. A check run, not a commit status, because only a check run can be grey (neutral) and red; a status can only be green or hold the PR open.
The row never turns green or red for a pair that did not count: it stays pending with the next step. Step 1/3 shows the verdict; 3/3 makes "All checks passed" read it (tools/pr-verdict.py).
Tests: tests/tooling/ci/test_pair_row.py."""
import re

UNMEASURED_BAND = 7   # right jobs a person may lose before a pair is red, while their own spread is not measured
# Why (13 Nov 2026, sa): run 43498213279 (c04 + c10, the same code both sides, the same boards) gave 8 vs 15 right jobs for c04; a 1-job band would red honest PRs and the red would mean
# nothing. The band is the spread of the person's last 3 searches on main (the Trello middle-of-3 data) once that is stored; until then 7, or the night person's own kept spread.
# TODO(AI): the band from the last 3 main searches of a profile, when the Trello re-measure stores them (2026-11-13)
EXPECT_MIN = 11   # a pair's usual length (setup, draft, searches, judge): run 43498213279 took 10 min
OVERRIDE = 'A red row is not a dead end: the owner may merge by hand with the ruleset override.'


def band(spread):
    """The right jobs one person may lose before the row is red: their own spread when it is measured (a number), else UNMEASURED_BAND."""
    return spread if spread is not None else UNMEASURED_BAND


def ends(started_hm, minutes=EXPECT_MIN):
    """'hh:mmZ' `minutes` after 'hh:mm' (a UTC clock time), for "running since 20:29Z, ends ~20:40Z"."""
    hour, minute = (int(part) for part in started_hm.split(':')[:2])
    total = hour * 60 + minute + minutes
    return f'{total // 60 % 24:02d}:{total % 60:02d}Z'


def running(started_hm, what='running'):
    """The title of a row that has not ended."""
    return f'{what} since {started_hm}Z, ends ~{ends(started_hm)}'


def why_not_counted(rows):
    """Why people's sides did not count, from their side rows ({person: {'main': [...], 'pr': [...]}}): boards not shared, a broker wait over the limit, or a side that failed."""
    reasons = []
    flat = [r for sides in rows.values() for r in sides['main'] + sides['pr']]
    if any(r.get('shared') is False for r in flat):
        reasons.append("boards not shared (the draft's proposal or its web search failed)")
    if any(r.get('wait_p90_ms') is not None and not r.get('valid') and r.get('shared') is not False for r in flat):
        reasons.append('a side waited over 20 s at the broker')
    return '; '.join(reasons) or 'a side failed before its search'


def decide(done, ran, seen, spreads, attempt, rows, newer_head=False, earlier=()):
    """{conclusion, title, summary, rerun} of a pair. done: pair.measured() ({person: {before, after, d, line}}); ran: the people dispatched; seen: those with any side;
    spreads: {person: spread or None}; rows: pair.sides() (for the reason); earlier: the first run's counted lines (its row's text), kept in front when the re-run takes the row over (Gitar on #4059). conclusion: success, failure (a loss beyond the band), neutral (superseded), pending (not counted: the row stays running)."""
    if newer_head:
        return {'conclusion': 'neutral', 'title': 'superseded: the PR has a newer head, its pair runs on that', 'summary': '', 'rerun': []}
    lines, fell = list(earlier), []
    for person, m in sorted(done.items()):
        allowed = band(spreads.get(person))
        runs = len(rows.get(person, {}).get('pr', [])) or 1
        gain = m['after'] - m['before']
        line = f"{person} {m['before']:g} → {m['after']:g} right jobs ({'one run' if runs == 1 else f'{runs} runs'} a side"
        if m['before'] - m['after'] > allowed:
            fell.append(f"{line}, lost more than the usual difference of {allowed:g})")
        elif gain > allowed:
            lines.append(f'{line}, gain beyond the usual difference of {allowed:g})')
        else:
            lines.append(f'{line}, within the usual difference of {allowed:g}: not a proven gain)')
    missing = [p for p in ran if p not in done]
    if fell:
        title = 'fell: ' + '; '.join(fell)
        return {'conclusion': 'failure', 'title': title[:140], 'summary': '\n'.join(fell + lines + [OVERRIDE]), 'rerun': []}
    if missing:
        why = why_not_counted({p: rows[p] for p in missing if p in rows})
        title = f"not counted: {', '.join(str(p) for p in missing)} ({why})"
        # Why (13 Nov 2026, sa after 1/3: "a stalled call is not a loss"; the day's false 40 → 22 was one 63 s call): a pair that did not count is never red; it runs once more by itself,
        #   then the row stays PENDING (running, so the PR is not mergeable on an unproven pair) with the next step in its text. Red stays the loss beyond the band.
        # Why (Gitar on #4065, and on #3967: "the turn found no room, the workflow must not queue a second long wait"): only a person who HAD a side is run again; one whose search never started goes straight to "run it again".
        again = [person for person in missing if person in seen]
        if attempt < 2 and again:
            return {'conclusion': 'pending', 'title': (title + '; running once more')[:140], 'summary': '\n'.join(lines), 'rerun': again}
        return {'conclusion': 'pending', 'title': (title + '; run it again')[:140], 'summary': '\n'.join(lines + [title, 'Next step: run the pair again by hand (gh workflow run search-pair.yml -f pr=<n> -f people=<them>); a stalled call is not a loss.']), 'rerun': []}
    return {'conclusion': 'success', 'title': ' · '.join(lines)[:140], 'summary': '\n'.join(lines), 'rerun': []}


def safe(text):
    """A check run's text without the characters its API refuses in a title (control characters)."""
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', ' ', text)
