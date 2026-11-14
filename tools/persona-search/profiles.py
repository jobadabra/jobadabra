"""The fictional profiles' first search on CI (search-profiles.yml): their CV, the blind judge on their jobs, one row each and the run's table.

Why (12 Nov 2026, owner, asked via AskUserQuestion by sa: "Move it to CI"): the profile round ran on the owner's Mac, one search at a time, and its numbers
followed the Mac's load (Cluj 18 -> 0 at load 24, 18 -> 21 at load 10, same code). This runs the same first search on fresh CI installs through the AI broker (Claude by default, Codex as an input).
It never touches the nightly Search check: the profiles come from search-profiles.json, the 18 locked people (gate-personas.json) and gate.py are only read,
and the judge is gate_judge.judge() itself, given this file's profiles. No night, no Admin, no floors, no reference, no red.
Usage: profiles.py ids '<json list or empty>' | free '<json list>' <at_once> | cv <id> <out> | judge <id> <jobs.json> <judged.json> | judge-pooled <id> <jobs.json> <judged.json> ... | row <id> <out> | table <dir> <out.md>
       | tell <rows.json> <run url> <message.txt>
"""
import json
import math
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROFILES = json.loads((HERE / 'search-profiles.json').read_text(encoding='utf-8'))['profiles']
IDS = [p['id'] for p in PROFILES]
# Why (13 Nov 2026, owner via sa: "First come, first serve" · "each workflow should take its necessary slots"): no workflow holds a profile run; the run claims its room at the
# broker (tools/persona-search/claim.py) and a profile starved anyway shows as waits p90 > 20 s and is reported not measured, never a low number (the 30 below is the at-once cap, not the profile count: sa, 13 Nov 2026, added profiles past 30).
MAX_AT_ONCE = 30   # Why (13 Nov 2026, owner: "make it very parallel" · "customizable"): any number up to 30 at once (the cap, not the profile count); the room is the broker's, read per run
MINUTES_EACH = 12   # one profile job: setup ~3 min, the first press ~4.5 min (search-personas.yml header), the judge 1-2 min, with room
NIGHT_UTC = (0, 0)   # app-core/src/scheduler.js SEARCH_SLOT: the Worker starts the night at 00:00 UTC
BOARD = re.compile(r'Job boards found: (.+?) (\d+) job\(s\), (\d+) relevant')
# Why (13 Nov 2026, sa for the owner: per profile "boards that gave jobs, boards refused, boards cut at the end"): the three counts come from the press log's own lines, as BOARD does.
REFUSED = re.compile(r'Job boards found: (.+?) \d+ job\(s\), \d+ relevant \(refuses automated reading|Job boards: (.+?) refuses automated reading')
CUT_BOARDS = re.compile(r'Time is up \([^)]*\) for job boards: (\d+) boards?(?: read)? waits?')   # the nouns found_boards.py writes (boards, board read, board); not 'board discovery' (boards_beside.py), 'searches' or 'employers' (boards.py)
RAN_OUT = re.compile(r'Time is up \([^)]*\) for ([^:]+):|No time left in this refresh for these: \d+ (\w+)')
ENGINE = re.compile(r'^AI: (\S+)(?: / (\S+))?', re.M)
# Why (13 Nov 2026, sa, after run 43354770712: b02 0 and c06 1 right jobs with waits p90 56-58 s, Cluj 18-21 on the Mac): a profile whose search waited this long on the broker ran
# out of time for job boards; its count measures the broker's queue, not the search, so the row says "not measured (waits p90 N s)" and is never counted as 0 or below target.
# The relay lines are parsed by gate.RELAY_WAIT (one parser). The statistic differs from the night's gate.STARVED_WAIT_S (45 s, the longest wait of a press) on purpose: a profile row
# is judged on its usual wait (p90, nearest rank), sa's rule for these runs.
WAIT_P90_LIMIT_S = 20


def profile(pid):
    """The profile row of an id; ValueError for an id that is not in search-profiles.json."""
    for p in PROFILES:
        if p['id'] == pid:
            return p
    raise ValueError(f'{pid!r} is not one of the profiles in search-profiles.json')


def ids(given):
    """The run's ids as `profiles=<json>`: the given JSON list (each checked), or all of them when empty."""
    chosen = json.loads(given) if given.strip() else IDS
    for pid in chosen:
        profile(pid)
    return 'profiles=' + json.dumps(chosen)


def free(chosen, at_once, now=None):
    """(ok, why): at_once is 1-30 and the run's estimate ends before the night's 00:00 UTC start. at_once here is what really runs at once (the workflow passes min(at_once, the broker's claim capacity))."""
    now = now or datetime.now(timezone.utc)
    if not 1 <= at_once <= MAX_AT_ONCE:
        return False, f'at_once {at_once} is outside 1-{MAX_AT_ONCE}: not run'
    minutes = math.ceil(len(chosen) / max(1, at_once)) * MINUTES_EACH
    night = now.replace(hour=NIGHT_UTC[0], minute=NIGHT_UTC[1], second=0, microsecond=0)
    night += timedelta(days=1) if night <= now else timedelta(0)
    if now + timedelta(minutes=minutes) >= night:
        return False, f'about {minutes} min from {now:%H:%M} UTC would reach the night at 00:00 UTC: not run, start it after the night or with fewer profiles'
    return True, f'about {minutes} min, done before 00:00 UTC'


def cv(pid, out):
    """The profile's fictional CV through the random draw's own template (draw.cv), with its own city row (two cities are not in draws.json)."""
    sys.path.insert(0, str(HERE))
    import draw  # noqa: PLC0415
    from personas import pdf  # noqa: PLC0415
    p = profile(pid)
    # Why (13 Nov 2026, sa for the owner: 7 more Trello profiles, "actually let's leave it only for the Trello board"): music, financial analyst and IT project manager are not families in
    # draws.json, and adding one would move the seeded draws and the night people; a row may carry its own duty/education/tools, which win over a family of the same id.
    family = next((dict(f) for f in draw.DATA['families'] if f['id'] == p['family']), {})
    own = {k: p[k] for k in ('duty', 'education', 'tools') if k in p}
    if own or not family:   # Why (Gitar on #4010): a row without its own text keeps the family's title and text, so the CVs of b01-c20 stay byte-identical
        family.update(own, title=p['title'])
    missing = [k for k in ('duty', 'education', 'tools') if k not in family]
    if missing:
        raise ValueError(f"profile {pid}: family {p['family']!r} is not in draws.json and the row has no {', '.join(missing)}")
    lines = draw.cv(family, {k: p[k] for k in ('city', 'country', 'language')}, 'Alex Example')
    if p.get('area'):
        lines[-1] += f" Open to work {p['area']}."   # the CV and the judge tell one story (for_judge)
    folder = Path(out) / 'draw'
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'cv.pdf').write_bytes(pdf(lines))
    (folder / 'cv.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    (folder / 'draw.json').write_text(json.dumps({'seed': f'profiles-{pid}', 'family': p['family'], 'city': p['city'], 'country': p['country']}), encoding='utf-8')


def for_judge(p):
    """The row as the blind judge reads it: a row with an `area` is willing to work in it, said in the title the judge's profile line prints; a row without one is returned as it is.
    Why (13 Nov 2026, owner via sa: d06 "The Software Developer look in the entire Switzerland"; d05 and d07 were areas first and became one town each: "We should sarch also one town only, to be fair"):
    the judge's place rule is "their city or a short commute", and gate_judge.judge() builds its profile line from the title, city, country and language only. An `area` field in judge() would
    change what scoreboard.lock.json (S2) hashes, so the area goes through the title here, in this unlocked file; every row without `area` (the night people, b, c, d01-d05, d07) is byte-identical."""
    if not p.get('area'):
        return p
    return {**p, 'title': f"{p['title']} (willing to work {p['area']})"}


def judge_pooled(pid, files):
    """The pair's judge for a profile: gate_judge's `--pooled` path (one judge call over both sides' jobs), given this profile instead of a night person.
    files: <jobs.json> <judged.json> pairs, as gate_judge.main reads them."""
    sys.path.insert(0, str(HERE))
    import gate_judge  # noqa: PLC0415
    gate_judge.PERSONAS = [for_judge(p) for p in PROFILES]
    gate_judge.main(['--pooled', str(IDS.index(pid) + 1), *files])


def judge(pid, jobs_path, out):
    """The blind judge itself (gate_judge.judge: the locked prompt, 3 answers, the majority), given this profile instead of a night person."""
    sys.path.insert(0, str(HERE))
    import gate_judge  # noqa: PLC0415
    gate_judge.PERSONAS = [for_judge(p) for p in PROFILES]   # judge(n) reads PERSONAS[n - 1]; the night's list is not changed on disk
    pool = json.loads(Path(jobs_path).read_text(encoding='utf-8'))
    verdict = gate_judge.judge(IDS.index(pid) + 1, pool)
    Path(out).write_text(json.dumps(verdict, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f"{pid}: judged {verdict['judged_jobs']} distinct jobs, {sum(r['role'] == 'yes' and r['place'] == 'yes' for r in verdict['rows'])} right role and place")


def target(relevant, eures):
    """'meets' (N >= X), 'below' or 'not measured' (X = 0 or missing). Why (13 Nov 2026, sa: the Trello board's rule, owner: "Keep EURES as X, ours without it"): X = 0 is never a pass.
    Why (14 Nov 2026, owner via sa, ~03:25Z, undoing his earlier "With EURES on, 3 searches"): "But why we're running searches/benchmarks/tests with EURES on? EURES on should be only in production and never activated in development because we want a fair comparison", and (~03:30Z) "EURES should have been chosen only for the target, being an competitor": EURES is a rival that sets the target, never an input of the side being measured; N is ours without EURES, and no workflow switch turns EURES on."""
    if not eures:
        return 'not measured'
    return 'meets' if relevant >= eures else 'below'


def waits_p90_s(log):
    """The search's broker waits p90 in whole seconds (nearest rank: the ceil(0.9 n)-th smallest), from run.log's relay lines via gate.RELAY_WAIT; None when it has none."""
    sys.path.insert(0, str(HERE))
    import gate  # noqa: PLC0415
    waits = sorted(int(m) for m in gate.RELAY_WAIT.findall(log))
    return round(waits[math.ceil(0.9 * len(waits)) - 1] / 1000) if waits else None


def _when(text):
    try:
        return datetime.fromisoformat(text.replace('Z', '+00:00'))
    except (AttributeError, ValueError):
        return None


def row(pid, out):
    """One table row from the profile's folder: relevant, shown (open jobs, as the Mac round counted), first relevant at, boards, what ran out of time, the AIs and the commit."""
    out = Path(out)
    p = profile(pid)
    read = lambda name: (out / name).read_text(encoding='utf-8', errors='replace') if (out / name).exists() else ''   # noqa: E731
    result = {'id': pid, 'city': p['city'], 'title': p['title'], 'commit': os.environ.get('GITHUB_SHA', '')[:9]}
    if (out / 'not-run.txt').exists():
        return {**result, 'not_run': read('not-run.txt').strip()}
    judged = json.loads(read('judged.json') or 'null')
    if not judged:
        return {**result, 'not_measured': 'the press or the judge wrote no result (see run.log, judge.log)'}
    rows = judged['rows']
    right = [r for r in rows if r.get('role') == 'yes' and r.get('place') == 'yes']
    press = json.loads((read('draw/presses.jsonl').splitlines() or ['{}'])[0])
    started = _when(press.get('started'))
    seen = [t for t in (_when(r.get('first_seen')) for r in right) if t]
    log = '\n'.join(read(f'draw/{f.name}') for f in sorted((out / 'draw').glob('run-*.log')))
    boards = BOARD.findall(log)
    refused = sorted({(a or b).strip() for a, b in REFUSED.findall(log)})
    ran_out = sorted({(a or b).strip() for a, b in RAN_OUT.findall(log)})
    engines = sorted({' / '.join(x for x in m if x) for m in ENGINE.findall(read('run.log'))})
    p90 = waits_p90_s(read('run.log'))
    sys.path.insert(0, str(HERE))
    import engine_calls  # noqa: PLC0415
    refused_calls, short_ms = engine_calls.unanswered_calls(read('run.log')), engine_calls.longest_short_ms(read('run.log'))
    ais = sorted({e.split(' / ')[0] for e in engines})
    # Why (13-14 Nov 2026, sa; owner: "Drop the build, fix the measure"): refused calls, a hung short call and a second AI each change what the search found, so none is a number; the model names of one engine do not.
    # Order: refusals first (the root cause of a slow answered call too, Gitar on #4130), then the broker's queue (waits p90, which also makes short calls long), then one hung call, then two AIs.
    damage = {'refused_calls': refused_calls, 'short_call_max_s': round(short_ms / 1000, 1), 'waits_p90_s': p90}
    held = {'relevant_while_damaged': len(right), 'shown_while_damaged': len(rows)}
    if refused_calls:
        return {**result, 'not_measured': f'not measured ({refused_calls} AI call{"" if refused_calls == 1 else "s"} refused)', 'damaged': True, **damage, **held}
    if p90 is not None and p90 > WAIT_P90_LIMIT_S:
        return {**result, 'not_measured': f'not measured (waits p90 {p90} s)', 'starved': True, **damage, 'relevant_while_starved': len(right), 'shown_while_starved': len(rows)}
    if short_ms > engine_calls.HUNG_SHORT_MS:
        return {**result, 'not_measured': f'not measured (a short AI call took {short_ms / 1000:.1f} s)', 'damaged': True, **damage, **held}
    if len(ais) > 1:
        return {**result, 'not_measured': f'not measured (two AIs answered: {", ".join(ais)})', 'damaged': True, **damage, **held}
    return {**result, **damage, 'relevant': len(right), 'shown': len(rows), 'seconds': press.get('seconds'),
            'first_relevant_s': round((min(seen) - started).total_seconds()) if seen and started else None,
            'boards_read': len(boards), 'boards_gave_jobs': sum(int(j) > 0 for _, j, _ in boards), 'boards_with_relevant': sum(int(n) > 0 for _, _, n in boards),
            'boards_refused': len(refused), 'boards_cut': sum(int(n) for n in CUT_BOARDS.findall(log)), 'time_ran_out_for': ran_out,
            'engine': (', '.join(engines) or 'not said') + (' (no renderer)' if (out / 'no-renderer.txt').exists() else ''), 'judge': ', '.join((judged.get('agreement') or {}).get('ai') or []) or 'not said',
            'judge_tier': judged.get('tier', 'small'), 'eures': p.get('eures', 0), 'target': target(len(right), p.get('eures', 0))}


def ai_names(rows):
    """The AI(s) that answered the rows' search steps, from each row's engine column ("claude / model" -> Claude); '' when no row says. One reader for the table's header and the Telegram head (Gitar on #3971)."""
    return ', '.join(sorted({r['engine'].split(' / ')[0].split(' ')[0].capitalize() for r in rows if r.get('engine') and r['engine'] != 'not said'}))


def table(folder, out):
    """The run's table (markdown) from every profile's row.json under the folder, in id order; also written as rows.json beside it."""
    rows = sorted((json.loads(f.read_text(encoding='utf-8')) for f in Path(folder).rglob('row.json')), key=lambda r: r['id'])
    commits = sorted({r['commit'] for r in rows if r.get('commit')})
    lines = [f'## Search profiles on CI · {len(rows)} profiles · one run each · commit {", ".join(commits) or "?"}',
             f'CI rows ({ai_names(rows) or "AI"} through the broker, fresh installs, EURES off): a new series, never mixed with the Mac rows of 12 Nov 2026 or a round on another AI.', '',
             '| id | city | role | relevant | EURES (X) | target | shown | first relevant at | boards read | boards that gave jobs | boards with relevant | boards refused | boards cut at the end | time ran out for | broker waits p90 | AI calls refused | longest short AI call | engine | judge |',
             '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|']
    for r in rows:
        if 'relevant' not in r:
            waits = f"{r['waits_p90_s']} s" if r.get('waits_p90_s') is not None else ''
            lines.append(f"| {r['id']} | {r['city']} | {r['title']} | {r.get('not_run') or r.get('not_measured')} | | | | | | | | | | | {waits} | {r.get('refused_calls', '')} | {str(r['short_call_max_s']) + ' s' if r.get('short_call_max_s') is not None else ''} | | |")
            continue
        first = f"{r['first_relevant_s']} s" if r['first_relevant_s'] is not None else '—'
        lines.append(f"| {r['id']} | {r['city']} | {r['title']} | {r['relevant']} | {r.get('eures') or '—'} | {r.get('target', '—')} | {r['shown']} | {first} | {r['boards_read']} | {r.get('boards_gave_jobs', '—')} | {r['boards_with_relevant']} | {r.get('boards_refused', '—')} | {r.get('boards_cut', '—')} | "
                     f"{', '.join(r['time_ran_out_for']) or '—'} | {str(r['waits_p90_s']) + ' s' if r.get('waits_p90_s') is not None else '—'} | {r.get('refused_calls', '—')} | {str(r['short_call_max_s']) + ' s' if r.get('short_call_max_s') is not None else '—'} | {r['engine']} | {r['judge']} ({r['judge_tier']}) |")
    Path(out).write_text('\n'.join(lines) + '\n', encoding='utf-8')
    (Path(out).parent / 'rows.json').write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding='utf-8')


def tell(rows_path, url, out, profiles=None, outcome='success'):
    """The run's one Telegram text (sent by desktop/e2e/tell-owner.mjs --event search-profiles): what happened to the run, how many got 0 right jobs, how many meet N >= X, the link.
    Design (13 Nov 2026, the 3rd fix of this text: Gitar on #3945, the starved rows of #3968, mac-9a's cancelled run 43355710034):
      the run is finished or cancelled (GitHub's result of the profile jobs, passed in as outcome; one owner);
      each profile the run was asked for (profiles, the room job's list, never only the rows that came back) is exactly one of:
        measured (N right jobs; meets / below / no X), not measured because the broker was too busy (waits p90 > 20 s), not run (held, cancelled, failed, no row).
      Only measured rows are counted for "got 0" and "meet target"; every other profile is named in its group."""
    rows = json.loads(Path(rows_path).read_text(encoding='utf-8')) if Path(rows_path).exists() else []
    seen = {r.get('id') for r in rows}
    rows += [{'id': pid, 'not_run': 'no row'} for pid in (profiles or []) if pid not in seen]
    measured = [r for r in rows if 'relevant' in r]
    starved = [r for r in rows if r.get('starved')]
    other = [r for r in rows if 'relevant' not in r and not r.get('starved')]
    apart = ([f'{len(starved)} not measured, the broker was too busy (waits p90 > {WAIT_P90_LIMIT_S} s): ' + ', '.join(r.get('id', '?') for r in starved)] if starved else []) + \
            ([f'{len(other)} not run or not measured: ' + ', '.join(r.get('id', '?') for r in other)] if other else [])
    n = f'{len(rows)} profile{"" if len(rows) == 1 else "s"}'
    ai = ai_names(rows)
    where = f'Search profiles on CI{" · " + ai if ai else ""}'   # Why (13 Nov 2026, sa): a Codex round and a Claude round are two series; the text names its AI
    if outcome == 'cancelled':   # Why (13 Nov 2026, mac-9a for the owner): run 43355710034 was cancelled at 02:58Z and the text read "nothing measured (6 profiles)", 6 of 27, never "cancelled"
        head = f'⚪ {where} · cancelled on GitHub ' + (f'before measuring ({n})' if not measured else f'after {len(measured)} of {len(rows)} measured')
    elif not measured:   # Why (13 Nov 2026, Gitar on #3945): "0 of 0 got 0 right jobs" reads as a clean run
        head = f'🧪 {where} · nothing measured ({n})'
    else:
        head = f'🧪 {where} · {len(measured)} of {len(rows)} measured'
    lines = [head]
    if measured:
        zero = sum(r['relevant'] == 0 for r in measured)
        meets = sum(r.get('target') == 'meets' for r in measured)
        judged = sum(r.get('target') in ('meets', 'below') for r in measured)
        lines += [f'{zero} of {len(measured)} got 0 right jobs',
                  f'{meets} of {judged} meet target (N ≥ X, X = EURES)' + (f' · {len(measured) - judged} without an X' if len(measured) > judged else '')]
    lines += (apart or ['no rows']) if not measured and outcome != 'cancelled' else apart
    lines.append(url)
    Path(out).write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return lines


def main(argv):
    command, args = argv[0], argv[1:]
    if command == 'ids':
        print(ids(args[0] if args else ''))
    elif command == 'free':
        n = float(args[1])   # a number input may arrive as '6' or '6.0'
        if n != int(n):   # Why (13 Nov 2026, Gitar on #3964): 2.5 would pass here as 2 while max-parallel got 2.5; the check and the matrix see one whole number
            print(f'at_once {args[1]} is not a whole number: not run')
            sys.exit(1)
        ok, why = free(json.loads(args[0]), int(n))
        print(why)
        sys.exit(0 if ok else 1)
    elif command == 'cv':
        cv(*args[:2])
    elif command == 'judge':
        judge(*args[:3])
    elif command == 'judge-pooled':   # judge-pooled <id> <jobs.json> <judged.json> [<jobs.json> <judged.json> ...]
        judge_pooled(args[0], args[1:])
    elif command == 'row':
        result = row(*args[:2])
        (Path(args[1]) / 'row.json').write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding='utf-8')
        print(json.dumps(result, ensure_ascii=False))
    elif command == 'table':
        table(*args[:2])
    elif command == 'tell':
        print('\n'.join(tell(*args[:3], json.loads(args[3]) if len(args) > 3 and args[3] else None, args[4] if len(args) > 4 else 'success')))
    else:
        raise SystemExit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
