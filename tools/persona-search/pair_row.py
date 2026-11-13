"""The "Search before/after" row of a search PR's checks list: one verdict per pair, from the same numbers the PR comment shows (tools/persona-search/pair.py).
Why (13 Nov 2026, owner via sa: "Can we add the before/after as a CI check on the PR ?" · "instead of having \"DONT MERGE\"... we'll just have red check"): a pair's result lived only
in a comment and the search-hold label. A check run, not a commit status, because only a check run can be grey (neutral) and red; a status can only be green or hold the PR open.
The row never turns green or red for a pair that did not count: it stays pending with the next step. Step 1/3 shows the verdict; 3/3 makes "All checks passed" read it (tools/pr-verdict.py).
Tests: tests/tooling/ci/test_pair_row.py."""
import json
import re
import sys
from pathlib import Path

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


def short(line):
    """A counted line as the row's title shows it ("c04 15 → 14 (within ±7, not a proven gain)"): the checks list shows only the title, 140 characters, so the long wording stays in the summary (Gitar on #4077)."""
    hit = re.match(r'(?P<head>\S+ \S+ → \S+) right jobs .*?(?P<kind>gain beyond|within) the usual difference of (?P<band>[\d.]+)', line)
    if not hit:
        return line[:60]
    return f"{hit['head']} ({'gain beyond' if hit['kind'] == 'gain beyond' else 'within'} ±{hit['band']}{'' if hit['kind'] == 'gain beyond' else ', not a proven gain'})"


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
    return {'conclusion': 'success', 'title': ' · '.join(short(line) for line in lines)[:140], 'summary': '\n'.join(lines), 'rerun': []}


def safe(text):
    """A check run's text without the characters its API refuses in a title (control characters)."""
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', ' ', text)


# The row's states and who may move it (Design, 13 Nov 2026, after four Gitar rounds on 1/3; sa: "going in circles = the design is wrong"). ONE function, next_row(old_row, event), is the only place a row changes;
# the workflows only read the row, call it, and write what it returns. A finished row is never rewritten (a new pair gets a new row beside it); a run writes the row only while its run id is the row's owner.
#
#   state       is                                   moved by (event)                     to
#   (no row)    -                                    opened | carried (start workflow)    waiting | nothing | unnamed | carried
#                                                    started (a pair by hand)             running
#   waiting     queued; the other checks not green   started (claim: the dispatched pair) running      owner = that run
#                                                    opened (other people)                waiting / nothing / unnamed
#   running     a pair's attempt 1 in flight         ended: numbers, a loss               counted (failure)
#                                                    ended: numbers, no loss              counted (success)
#                                                    ended: not counted, a side ran       rerunning     owner = nobody until the second run claims it
#                                                    ended: not counted, any other        unproven
#                                                    ended / died: a newer head exists    superseded
#                                                    died: any other                      unproven
#   running | rerunning                              searching (the room is ours)         same state, title only (owner's run)
#   rerunning   attempt 2 asked or in flight         started (claim, or a pair by hand)   rerunning     owner = that run (only while nobody owns it)
#                                                    ended / died                         as running, attempt 2 (never asks a third)
#   unproven    ended without numbers; "run it again"  started (a pair by hand)            running
#   counted | carried | superseded | nothing | unnamed   FINISHED: no event rewrites it
# "ended"/"died" from a run that is not the row's owner change nothing (a duplicate or late run).
STATES = ('waiting', 'running', 'rerunning', 'unproven', 'counted', 'carried', 'superseded', 'nothing', 'unnamed')
FINISHED = ('counted', 'carried', 'superseded', 'nothing', 'unnamed')
IN_FLIGHT = ('running', 'rerunning')


def external_id(state, people, owner=''):
    """What the row keeps in its external_id: `search-pair:<state>:<people, sorted>:<owner run id>`; the whole state lives there, so any later event can read it without a database."""
    return f"search-pair:{state}:{','.join(sorted(str(p) for p in people))}:{owner}"


def parse_external_id(value):
    """(state, people as strings, owner run id) of a row's external_id, or (None, [], '') when it is not ours."""
    hit = re.fullmatch(r'search-pair:([a-z]+):([^:]*):?([^:]*)', value or '')
    if not hit or hit.group(1) not in STATES:
        return None, [], ''
    return hit.group(1), [p for p in hit.group(2).split(',') if p], hit.group(3)


def _out(state, people, status, title, summary, *, conclusion=None, owner='', rerun=(), new=False, now=None):
    """A row's next value: the body of the check-run call (`api`), the people to dispatch again (`rerun`) and whether it is a new row (`new`)."""
    api = {'status': status, 'external_id': external_id(state, people, owner), 'output': {'title': safe(title)[:140], 'summary': safe(summary)}}
    if conclusion:
        api['conclusion'] = conclusion
    if now and status == 'in_progress':
        api['started_at'] = now
    return {'noop': False, 'state': state, 'api': api, 'rerun': list(rerun), 'new': new}


def _noop(state, why):
    return {'noop': True, 'why': why, 'state': state, 'api': {}, 'rerun': [], 'new': False}


def _place(old_state, old_people, state, people, status, conclusion, title, summary):
    """A row from the start workflow (opened, carried): never over a pair in flight, never again for the same state and people, a new row beside a finished one."""
    if old_state in IN_FLIGHT:
        return _noop(old_state, 'a pair is in flight: its row stands')
    if old_state == state and old_people == [str(p) for p in sorted(people, key=str)]:
        return _noop(old_state, 'the row already says this')
    return _out(state, people, status, title, summary, conclusion=conclusion, new=old_state is None or old_state in FINISHED)


def next_row(old, event):
    """The row after `event`, given its `old` value ({external_id, summary} of the head's row, or {} for none): {noop, state, api, rerun, new}. Events (kind):
    opened {verdict: waiting|nothing|unnamed, people, title, summary} · carried {people, conclusion, title, summary} · started {run_id, run_url, started, now, people, claim} · searching {run_id, started}
    · ended {run_id, run_url, comment_url, done, ran, seen, spreads, rows, newer, rerun_failed} · died {run_id, run_url, ended, newer}. The table above says which moves exist; any other is a noop."""
    old = old or {}
    state, people_was, owner = parse_external_id(old.get('external_id'))
    kind, run = event['kind'], str(event.get('run_id') or '')
    summary_was = old.get('summary') or ''
    if kind == 'opened':
        verdict = event['verdict']
        shape = {'waiting': ('queued', None), 'nothing': ('completed', 'success'), 'unnamed': ('completed', 'failure')}[verdict]
        return _place(state, people_was, verdict, event.get('people', []), shape[0], shape[1], event['title'], event['summary'])
    if kind == 'carried':
        return _place(state, people_was, 'carried', event['people'], 'completed', event['conclusion'], event['title'], event['summary'])
    if kind == 'started':
        by_hand_ok = state is None or state in ('waiting', 'unproven', *FINISHED) or (state == 'rerunning' and not owner)
        if not (state in ('waiting', 'rerunning') if event['claim'] else by_hand_ok):
            return _noop(state, 'another pair holds this row, or it is not waiting for one')
        again = state == 'rerunning'
        title = running(event['started'], 'running once more' if again else 'waiting for room at the broker')
        text = summary_was if again else f"Before/after pair for {', '.join(str(p) for p in event['people'])}: main and the PR searched at the same minute, one run a side. The numbers land here and in the PR comment."
        return _out('rerunning' if again else 'running', event['people'], 'in_progress', title, text, owner=run, new=state is None or state in FINISHED, now=event.get('now'))
    if state not in IN_FLIGHT or owner != run:
        return _noop(state, 'not this run\'s row (a finished row, or another run owns it)')
    if kind == 'searching':   # the turn is ours: the title says the searches began ("ends ~" counts from the pair's own start)
        return _out(state, people_was, 'in_progress', running(event['started'], 'searching main and the PR'), summary_was, owner=run)
    where = f"\n\nOne run a side. Run: {event['run_url']}"
    if kind == 'died':
        if event['ended'] == 'cancelled' and event['newer']:
            return _out('superseded', people_was, 'completed', 'superseded: this run was cancelled', 'A newer head took over.' + where, conclusion='neutral')
        title = f"not counted: the pair ended ({event['ended']}) with no numbers; run it again (gh workflow run search-pair.yml)"
        return _out('unproven', people_was, 'in_progress', title, (summary_was + '\n\n' if summary_was else '') + title + where)
    earlier = [line for line in summary_was.splitlines() if ' right jobs ' in line] if state == 'rerunning' else []
    attempt = 2 if state == 'rerunning' or event.get('rerun_failed') else 1
    d = decide(event['done'], event['ran'], event['seen'], event['spreads'], attempt, event['rows'], newer_head=event['newer'], earlier=earlier)
    text = (d['summary'] or 'No numbers.') + f"\n\nThe table: the pair comment on {event['comment_url']}" + where
    title = d['title'] + (' (the second run did not start)' if event.get('rerun_failed') and d['conclusion'] == 'pending' else '')
    if d['conclusion'] == 'pending':
        return _out('rerunning' if d['rerun'] else 'unproven', people_was, 'in_progress', title, text, rerun=d['rerun'])
    final = {'neutral': 'superseded', 'failure': 'counted', 'success': 'counted'}[d['conclusion']]
    return _out(final, people_was, 'completed', title, text, conclusion=d['conclusion'])


def main(argv):
    """`pair_row.py next <old.json> '<event json>'` prints next_row's result as json (the workflows' only way to move a row, with pair.py row for an `ended` event)."""
    if len(argv) == 4 and argv[1] == 'next':
        old = json.loads(Path(argv[2]).read_text(encoding='utf-8') or '{}')
        print(json.dumps(next_row(old, json.loads(argv[3]))))
        return 0
    print(main.__doc__, file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
