"""The "Search before/after" row of a search PR's checks list: one verdict per pair, from the same numbers the PR comment shows (tools/persona-search/pair.py).
Why (13 Nov 2026, owner via sa: "Can we add the before/after as a CI check on the PR ?" · "instead of having \"DONT MERGE\"... we'll just have red check"): a pair's result lived only
in a comment and the search-hold label. A check run, not a commit status, because only a check run can be grey (neutral) and red; a status can only be green or hold the PR open.
The row's meaning (4/5, 14 Nov 2026, owner: "The PR CI check (search pair) should tell us"): GREEN = a valid pair, nobody lost beyond their usual difference (floor 7), and the gain the PR's Moves lines claim is beyond it
(one named person is enough; the others guard); RED = a loss, no proven gain for the people the Moves lines name, or not valid in the one re-run ("not valid twice: <reason>"); PENDING = not counted yet, with the next step.
A pair for people no Moves line names claims nothing: only a loss turns it red. 5/5 makes "All checks passed" read the row (tools/pr-verdict.py).
Tests: tests/tooling/ci/test_pair_row.py."""
import json
import re
import sys
from pathlib import Path

from engine_calls import HUNG_SHORT_MS  # beside this file; the one line (45 s) of a hung short call

BAND_FLOOR = 7   # right jobs a person may lose before a pair is red, whatever their own spread is (the same-minute noise floor, see band)
# Why (13 Nov 2026, sa): run 43498213279 (c04 + c10, the same code both sides, the same boards) gave 8 vs 15 right jobs for c04; a 1-job band would red honest PRs and the red would mean
# nothing. The band is the spread of the person's last 3 searches on main (the Trello middle-of-3 data) once that is stored; until then 7, or the night person's own kept spread.
# TODO(AI): the band from the last 3 main searches of a profile, when the Trello re-measure stores them (2026-11-13)
EXPECT_MIN = 11   # a pair's usual length (setup, draft, searches, judge): run 43498213279 took 10 min
OVERRIDE = 'A red row is not a dead end: the owner may merge by hand with the ruleset override.'


def band(spread):
    """The right jobs one person may lose before the row is red: their own spread when it is above BAND_FLOOR, else BAND_FLOOR.
    Why (13 Nov 2026, Gitar on #4114; sa's run 43498213279 gave 8 vs 15 for the same code, tr's c04 15 / 17 / 36 in three same-minute rounds): the night's spread is across days (1-2 jobs for a steady person), not main-vs-PR noise of one minute."""
    return max(spread, BAND_FLOOR) if spread is not None else BAND_FLOOR


def ends(started_hm, minutes=EXPECT_MIN):
    """'hh:mmZ' `minutes` after 'hh:mm' (a UTC clock time), for "running since 20:29Z, ends ~20:40Z"."""
    hour, minute = (int(part) for part in started_hm.split(':')[:2])
    total = hour * 60 + minute + minutes
    return f'{total // 60 % 24:02d}:{total % 60:02d}Z'


def running(started_hm, what='running'):
    """The title of a row that has not ended."""
    return f'{what} since {started_hm}Z, ends ~{ends(started_hm)}'


def why_not_counted(rows):
    """Why people's sides did not count, from their side rows ({person: {'main': [...], 'pr': [...]}}): boards not shared, refused AI calls, two AIs, a broker wait over the limit, or a side that failed."""
    reasons = []
    flat = [r for sides in rows.values() for r in sides['main'] + sides['pr']]
    if any(r.get('shared') is False for r in flat):
        reasons.append("boards not shared (the draft's proposal or its web search failed)")
    counted_in = [r for r in flat if not r.get('valid') and r.get('shared') is not False]
    if any(r.get('failed') for r in counted_in):
        reasons.append('a side had AI calls refused by the broker')
    if any(len(r.get('engines') or []) > 1 for r in counted_in):
        reasons.append('a side was answered by two AIs')
    if any((r.get('short_call_max_ms') or 0) > HUNG_SHORT_MS for r in counted_in):
        reasons.append(f'a side had a short AI call over {HUNG_SHORT_MS // 1000} s')
    # Why (13 Nov 2026): a side not valid for refused calls or two AIs is not "slow"; the wait is the reason only when neither is.
    if any(r.get('wait_p90_ms') is not None and not r.get('failed') and len(r.get('engines') or []) <= 1 and (r.get('short_call_max_ms') or 0) <= HUNG_SHORT_MS for r in counted_in):
        reasons.append('a side waited over 20 s at the broker')
    return '; '.join(reasons) or 'a side failed before its search'


def short(line):
    """A counted line as the row's title shows it ("c04 15 → 14 (within ±7, not a proven gain)"): the checks list shows only the title, 140 characters, so the long wording stays in the summary (Gitar on #4077)."""
    hit = re.match(r'(?P<head>\S+ \S+ → \S+) right jobs .*?(?P<kind>gain beyond|within) the usual difference of (?P<band>[\d.]+)', line)
    if not hit:
        return line[:60]
    return f"{hit['head']} ({'gain beyond' if hit['kind'] == 'gain beyond' else 'within'} ±{hit['band']}{'' if hit['kind'] == 'gain beyond' else ', not a proven gain'})"


def no_proven_gain(done, spreads, claims):
    """The people a PR's Moves lines name (`claims`) when none of them gained beyond their usual difference, else []. A named person who only guards (the change could hurt them) may stay
    level: the PR claims a gain once, by at least one of the people it names. Why (owner, 14 Nov 2026: "The PR CI check (search pair) should tell us" · a PR is "decided by its search pair"): a pair
    that shows no loss but no gain beyond the band proved nothing for the PR's claim, so the row says so instead of reading green. People measured but not named in a Moves line (a pair started by hand) claim nothing."""
    named = [person for person in sorted(done) if person in claims]
    if not named or any(done[person]['after'] - done[person]['before'] > band(spreads.get(person)) for person in named):
        return []
    return named


RERUN_NOT_STARTED = 'If the second run does not start, run the pair by hand (gh workflow run search-pair.yml -f pr=<n> -f people=<them>): it takes this row.'


def decide(done, ran, seen, spreads, attempt, rows, newer_head=False, earlier=(), claims=(), second_ran=True):
    """{conclusion, title, summary, rerun} of a pair. done: pair.measured() ({person: {before, after, d, line}}); ran: the people dispatched; seen: those with any side;
    spreads: {person: spread or None}; rows: pair.sides() (for the reason); earlier: the first run's counted lines (its row's text), kept in front when the re-run takes the row over (Gitar on #4059).
    claims: the people the PR's Moves lines name; second_ran: False when the second run was asked but never started (the row then stays pending, it is not "not valid twice").
    conclusion: success (no loss, and the PR's gain proven when it claims one), failure (a loss beyond the band, no proven gain, or not valid in both runs), neutral (superseded), pending (not counted: the row stays running)."""
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
        if attempt >= 2 and second_ran and again:
            # Design (14 Nov 2026, owner: "not valid or a swing → one re-run, then decide"): a pair not valid in the one re-run is red, never green and no longer open forever; the reason is in the title.
            red = f"not valid twice: {', '.join(str(p) for p in again)} ({why})"
            return {'conclusion': 'failure', 'title': red[:140], 'summary': '\n'.join(lines + [red, 'Run the pair again by hand when the cause is gone (gh workflow run search-pair.yml -f pr=<n> -f people=<them>), or close the PR. ' + OVERRIDE]), 'rerun': []}
        if attempt < 2 and again:
            # Why (#4103, Gitar): the row has no owner until the second run claims it, so a second run that never starts (cancelled in its queue, refused) leaves it open; the row says so and
            #   how to close it (a pair by hand takes an unowned rerunning row), instead of promising "running once more".
            return {'conclusion': 'pending', 'title': (title + '; a second run is asked')[:140], 'summary': '\n'.join(lines + [RERUN_NOT_STARTED]), 'rerun': again}
        return {'conclusion': 'pending', 'title': (title + '; run it again')[:140], 'summary': '\n'.join(lines + [title, 'Next step: run the pair again by hand (gh workflow run search-pair.yml -f pr=<n> -f people=<them>); a stalled call is not a loss.']), 'rerun': []}
    named = set(map(str, claims))
    flat = no_proven_gain(done, spreads, named)
    if any(line.split(' ', 1)[0] in named and 'gain beyond' in line for line in earlier):   # the first run (its row's text) already proved the claimed gain; this run only repeated others
        flat = []
    if flat:
        # Design (14 Nov 2026): the row's meaning is "valid, nobody worse, and the claimed gain beyond the usual difference"; a valid pair with no loss and no such gain is red, not green.
        red = 'no proven gain: ' + ' · '.join(short(line) for line in lines if line.split(' ', 1)[0] in flat)
        return {'conclusion': 'failure', 'title': red[:140], 'summary': '\n'.join(lines + ['The PR names ' + ', '.join(flat) + ' in its Moves lines but none moved beyond the usual difference: close the PR, or name the gain by hand and merge with the ruleset override. ' + OVERRIDE]), 'rerun': []}
    carried = [person for person in sorted(done) if person in named and done[person]['after'] - done[person]['before'] > band(spreads.get(person))] or [line.split(' ', 1)[0] for line in earlier if line.split(' ', 1)[0] in named and 'gain beyond' in line]
    said = f"gain proven by {', '.join(carried)}: " if carried else ''   # sa, 14 Nov 2026: the row says which person carried the yes
    return {'conclusion': 'success', 'title': (said + ' · '.join(short(line) for line in lines))[:140], 'summary': '\n'.join(([f'The yes is carried by {", ".join(carried)}.'] if carried else []) + lines), 'rerun': []}


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


def _next_row(old, event):
    """The row after `event`, given its `old` value ({external_id, summary} of the head's row, or {} for none): {noop, state, api, rerun, new}. Events (kind):
    opened {verdict: waiting|nothing|unnamed, people, title, summary} · carried {people, conclusion, title, summary} · started {run_id, run_url, started, now, people, claim} · searching {run_id, started}
    · ended {run_id, run_url, comment_url, done, ran, seen, spreads, rows, newer, rerun_failed, claims} · died {run_id, run_url, ended, newer}. The table above says which moves exist; any other is a noop."""
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
        # Why (13 Nov 2026, mac-95 against the table): a claim takes a rerunning row only while nobody owns it, like a pair by hand; a second dispatched run must not steal it.
        claim_ok = state == 'waiting' or (state == 'rerunning' and not owner)
        if not (claim_ok if event['claim'] else by_hand_ok):
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
        # Why (13 Nov 2026, mac-95 against the table "ended / died: a newer head exists -> superseded"): a run that died for any reason on an old head is superseded, never "run it again".
        if event['newer']:
            return _out('superseded', people_was, 'completed', f"superseded: this run ended ({event['ended']}) and a newer head took over", 'A newer head took over.' + where, conclusion='neutral')
        title = f"not counted: the pair ended ({event['ended']}) with no numbers; run it again (gh workflow run search-pair.yml)"
        return _out('unproven', people_was, 'in_progress', title, (summary_was + '\n\n' if summary_was else '') + title + where)
    earlier = [line for line in summary_was.splitlines() if ' right jobs ' in line] if state == 'rerunning' else []
    attempt = 2 if state == 'rerunning' or event.get('rerun_failed') else 1
    d = decide(event['done'], event['ran'], event['seen'], event['spreads'], attempt, event['rows'], newer_head=event['newer'], earlier=earlier,
               claims=event.get('claims') or (), second_ran=not (event.get('rerun_failed') and state != 'rerunning'))
    text = (d['summary'] or 'No numbers.') + f"\n\nThe table: the pair comment on {event['comment_url']}" + where
    title = d['title'] + (' (the second run did not start)' if event.get('rerun_failed') and d['conclusion'] == 'pending' else '')
    if d['conclusion'] == 'pending':
        return _out('rerunning' if d['rerun'] else 'unproven', people_was, 'in_progress', title, text, rerun=d['rerun'])
    final = {'neutral': 'superseded', 'failure': 'counted', 'success': 'counted'}[d['conclusion']]
    return _out(final, people_was, 'completed', title, text, conclusion=d['conclusion'])


LINK = '[Open the search run]('


def next_row(old, event):
    """_next_row's row, with a link to the run as the summary's FIRST line whenever the event names the run.
    Why (14 Nov 2026, owner on #4187: "I don't see the actual run"; sa measured it): GitHub ignores `details_url` for a check run the github-actions app creates, so "Details" opens the row's own page, which had no link to the run;
    the summary is the one text that page shows. A link already first is replaced, never doubled."""
    out = _next_row(old, event)
    if out['noop'] or not event.get('run_url') or 'output' not in out['api']:
        return out
    rest = out['api']['output']['summary']
    if rest.startswith(LINK):
        rest = rest.split('\n\n', 1)[1] if '\n\n' in rest else ''
    out['api']['output']['summary'] = f"{LINK}{event['run_url']})" + (f'\n\n{rest}' if rest else '')
    return out


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
