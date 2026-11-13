"""The night Search check (search-personas.yml, a report since 4 Nov 2026): 18 fictional job seekers (6 until 6 Nov 2026) each press Find jobs once; a run is red when a press runs past 3 minutes; the
right jobs are shown per persona and pooled, red only from 10 measured main runs on (QUALITY_MIN_RUNS; owner, 27 Oct 2026, "Time only, until 10 runs"). Origin (owner, 27 Oct 2026: "Every time we improve search for an use-case, for a candidate,
for a profile, for a speed perspective.. We break other use-cases."; his four answers on the sketch: here with our own tools, all 6 in parallel,
right role + place by a blind judge).
  python3 tools/persona-search/gate.py cv <n> <out>                       the persona's fictional CV: <out>/draw/cv.pdf, cv.md, draw.json
  python3 tools/persona-search/gate.py extract <jobs.sqlite> <jobs.json>  the open jobs (title, company, place, source) for the judge
  python3 tools/persona-search/gate.py result <n> <out>                   <out>/result.json from presses.jsonl and judged.json
  python3 tools/persona-search/gate.py compare <results dir> <out dir> [<main run dir>...]   verdict.json + table.md; exit 1 when red
Judge: gate_judge.py. Personas: gate-personas.json (copied from the benchmark round). Tests: tests/test_search_personas_gate.py."""
import json
import os
import re
import sqlite3
import sys
from urllib.parse import urlparse
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))   # scores_rows.py sits beside this file, as for metrics.py
from scores_rows import table_rows  # noqa: E402
import funnel as funnel_mod  # noqa: E402
import verdicts  # noqa: E402
import engine_calls  # noqa: E402
import runs as runs_mod  # noqa: E402
import shown as shown_mod  # noqa: E402
PERSONAS = json.loads((HERE / 'gate-personas.json').read_text(encoding='utf-8'))['personas']
PRESS_LIMIT = 180   # Why (owner, 26 Oct 2026): "A find jobs session should take at most 3min" (CLAUDE.md, tests/unit/sources/test_three_minutes.py)
MAIN_RUNS = 3       # the per-persona "Main" column shows the newest 3 measured runs (numbers only; they decide nothing: see QUALITY_MIN_RUNS)
# Why (owner, 27 Oct 2026, "Time only, until 10 runs"): #2289 changed no search code and went red at 10 right jobs in total against main's 13 (main's own two
# measured runs: 13 and 16), each persona's lowest of 3 being 0-1 jobs. Until main has QUALITY_MIN_RUNS measured runs, quality is shown and never red; from then
# on a PR is red when its all-persona total falls below main's average minus twice its spread (sample standard deviation), computed here and switched on by
# itself: no guessed number.
QUALITY_MIN_RUNS = 10
QUALITY_SPREADS = 2
# Why (1 Nov 2026, #2901): main's last runs judged 0 jobs on all six personas (the press ran out of its 180 s before reading one), so "average minus two spreads" fell to -1.6..-6.3 and no total could be below it:
# a search that finds nothing stayed green. A floor below one right job is no floor; a run whose judges saw no job at all measured nothing (see _nothing).
QUALITY_FLOOR_MIN = 1
# Why (2 Nov 2026, owner: "Ship speed fix, fix the gate"; #2928): the floor of 1 above was red on a total of 0 although main's own last three totals were 7, 5 and 0:
# a PR was held to a higher bar than main itself reached (owner, 28 Oct 2026: "a PR is red only when its diff broke it"). The floor never rises above the lowest total
# of main's measured runs; while main's lowest is 1 or more, the floor of 1 above still holds, so a search that finds nothing is red on a healthy main.
PERSONA_CAP_USD = 0.10   # Why (30 Oct 2026, owner; supersedes 27 Oct): Codex runs report $0 API charge; this cap only guards legacy API-key measurements (#2259: $0.045-0.079).
# Why (2 Nov 2026, owner: "still, everything is 0"; run 41376694937): the header said "Codex subscription" while Claude answered, because Codex's week was used up.
# The engines come from the "AI: <engine> / <model> (<fell back from>)" line the CI client prints once per distinct answer (desktop/e2e/lib/broker-client.mjs aiLine).
ENGINE_LINE = re.compile(r'^AI: (\S+)(?: / (\S+))?(?: \(([^)]*)\))?\s*$', re.M)   # aiLine prints engine and model, or only one of them


def label(n):
    p = PERSONAS[int(n) - 1]
    return f"p{n} {p['title']}, {p['city']}"


def make_cv(n, out):
    """The persona's fictional CV through the random draw's own template (draw.cv), as the benchmark round made it (search-bench/make-cv.py)."""
    sys.path.insert(0, str(HERE))
    import draw  # noqa: PLC0415
    from personas import pdf  # noqa: PLC0415
    p = PERSONAS[int(n) - 1]
    family = next(f for f in draw.DATA['families'] if f['id'] == p['family'])
    city = next(c for c in draw.DATA['cities'] if c['city'] == p['city'])
    folder = Path(out) / 'draw'
    folder.mkdir(parents=True, exist_ok=True)
    lines = draw.cv(family, city, 'Alex Example')
    (folder / 'cv.pdf').write_bytes(pdf(lines))
    (folder / 'cv.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    (folder / 'draw.json').write_text(json.dumps({'seed': f'gate-{n}', 'family': p['family'], 'city': p['city'], 'country': p['country']}), encoding='utf-8')
    return p


def extract(db_path, out, *, include_urls=False):
    """The open jobs of the persona's install, without posting text: what the judge reads. URLs are opt-in for the paired comparison's provenance check and never sent to the judge. A store the press never created, or created empty, reads as no jobs.
    Why (PR 3130, run 41813036119, personas 3 and 6, 4 Nov 2026): the press was cut by the 3-minute stop before any step opened the store, so this call died on "unable to open"
    or "no such table: jobs", the press step went red, and the judge never ran; the row should read as zero jobs, grey."""
    Path(out).parent.mkdir(parents=True, exist_ok=True)   # a tool makes its own output folder (6 Nov 2026, run 42191804037); it worked only because an earlier step had made it
    if not Path(db_path).exists():
        rows = []
    else:
        db = sqlite3.connect(db_path)
        selected = table_rows(db, 'jobs', "SELECT j.title, co.name, j.location, s.name, j.url, s.kind, j.notes, j.first_seen_at FROM jobs j LEFT JOIN companies co ON co.id = j.company_id "
                              "LEFT JOIN sources s ON s.id = j.source_id WHERE j.state = 'open'")
        kinds = dict(table_rows(db, 'sources', 'SELECT name, kind FROM sources'))   # kind and `also` (each other reader that listed the job: src/store.py notes "also on <reader>"): sources_count.py
        db.close()
        shown = shown_mod.keys(db_path)   # what the app's Jobs list shows once the search has ended (shown.py); None = unknown, no `shown` field
        rows = [{'title': t, 'company': c or '', 'location': loc or '', 'provider': source or '', 'kind': kind or '', 'also': [[name, kinds.get(name) or ''] for name in re.findall(r'also on (.+?)(?= · also on |$)', notes or '')],
                 'first_seen': first_seen or '', **({'url': url or ''} if include_urls else {}), **shown_mod.field(url, shown)}
                for t, c, loc, source, url, kind, notes, first_seen in selected]
    Path(out).write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding='utf-8')
    return rows


REFUSED = re.compile(r'ai-capped: [^\n(]*\((?:Codex broker: )?(?:broker: )?([^)\n]+)\)')


def refused_reason(log):
    """The first reason the press's AI was refused ("fallback:search-unsupported": the Codex broker cannot run a web search; or a spent plan), read from
    the press log's `ai-capped: <step> (Codex broker: broker: <reason>)` lines; '' when there is none or no log. Why (2 Nov 2026, #2928 run 41367786313):
    15 such lines and 0 jobs showed as a table of zeros that looked like a search that found nothing."""
    try:
        found = REFUSED.search(Path(log).read_text(encoding='utf-8', errors='replace'))
    except OSError:
        return ''
    return found.group(1).strip() if found else ''


RELAY_WAIT = re.compile(r'relay: .* waited (\d+) ')
CUT_FROM_S = 170   # the app stops its AI steps a little before 180 s (desktop/lib/search-steps.js); a press ending from here on was stopped by the budget
# Why (2 Nov 2026, mac-07: a flaky red must be fixed at its guard; runs 41369268108, 41373757641 green, 41373710207, 41372158033 red): the longest wait of a
# relay call was 9-35 s in every press of the two green runs and 61-167 s in the presses that overlapped another run on the broker (Claude answers 3 at a
# time while Codex is used up). 45 s sits between the two; a press stopped by the cap with that wait was starved of AI, so what it found says nothing about the code.
STARVED_WAIT_S = 45


RELAY_TOTAL = re.compile(r'relay: .* total (\d+) ')
# Why (3 Nov 2026, coordinator for the owner; main runs 41359673068 vs 41463124217 / 41582737531): the mean time of a relay call (its own plus the queue)
# was 7-10 s in the last run that found jobs, 12-16 s in a middle one that still read, and 18.6-34 s in every run since the Codex plan ran out and the
# broker fell back to Haiku: ~18 calls fit in 180 s instead of ~40, and no press reached the boards or scoring. 18 s sits in a thin gap between what
# measured (<= 16) and what was starved (>= 18.6; three runs, one regime). Only a press that scored NOTHING goes grey: one that scored jobs and found none right
# stays a measured 0, so a broken scorer still shows. While the broker is on the fallback this greys every empty persona and `_total` (the pooled gate)
# is None for a run with any grey row, so the pooled gate is off until the AI is fast again; that is the point (a 0 caused by speed must not set the baseline).
SLOW_CALL_S = 18


def mean_call_s(log):
    """The mean time in s of the relay calls in a press log (a call's own time plus its wait in the broker's queue), None when it names none or there is no log."""
    try:
        totals = [int(m[1]) for m in RELAY_TOTAL.finditer(Path(log).read_text(encoding='utf-8', errors='replace'))]
    except OSError:
        return None
    return sum(totals) / len(totals) / 1000 if totals else None


def cut_note(seconds, scored, log):
    """(note, longest wait in s or None) for a press the budget stopped before it scored one job, else ('', None). The note reads "cut by the cap after
    178 s with no job scored; longest wait for the AI 117 s"; the wait is the largest client-side wait of any relay call in the press log (the queue
    at the broker). Why (2 Nov 2026, run 41373710207): 4 of 6 presses waited for the AI until the cap, and the check showed a crash message."""
    if seconds < CUT_FROM_S or scored:
        return '', None
    try:
        waits = [int(m[1]) for m in RELAY_WAIT.finditer(Path(log).read_text(encoding='utf-8', errors='replace'))]
    except OSError:
        waits = []
    longest = round(max(waits) / 1000) if waits else None
    return f'cut by the cap after {seconds} s with no job scored' + (f'; longest wait for the AI {longest} s' if longest is not None else ''), longest


def engines_of(log):
    """The AI answers a press log names: "claude (claude-haiku-5-5; codex ran-out)", several joined by " + "; '' when it names none or there is no log."""
    try:
        text = Path(log).read_text(encoding='utf-8', errors='replace')
    except OSError:
        return ''
    found = []
    for engine, model, fell in ENGINE_LINE.findall(text):
        inner = '; '.join(x for x in (model, fell) if x)
        label = f"{engine} ({inner})" if inner else engine
        if label not in found:
            found.append(label)
    return ' + '.join(found)


def search_text(search):
    """"6 roles; places sofia, bulgaria; countries none known" from a press row's `search` (run.mjs searchSummary)."""
    return f"{search.get('roles', 0)} roles; places {', '.join(search.get('places') or []) or 'none'}; countries {', '.join(search.get('countries') or []) or 'none known'}"


def funnel_note(funnel):
    """One line on where a press's time went, from its funnel: "employers named at 43 s; time ran out for: job boards, employer sites", or the web search
    that never started; '' when there is nothing to say. Why (2 Nov 2026, run 41376694937): p2-p4 found 0 because the time ran out, p1/p5 because the web search never started."""
    parts = []
    if funnel.get('places_worked_out_s') is not None:
        parts.append(f"places worked out at {funnel['places_worked_out_s']} s")
    if funnel.get('web_search_started_s') is not None:
        parts.append(f"web search started at {funnel['web_search_started_s']} s")
    if funnel.get('web_search_skipped'):   # the engine's reason since 13 Nov 2026 (run 43328194035 p10: a place written "lisb(on|oa)"); True in older funnels
        why = funnel['web_search_skipped']
        parts.append(f'web search never started: {why}' if isinstance(why, str) else 'web search never started (no places or roles known)')
    if funnel.get('employers_named_s') is not None:
        parts.append(f"employers named at {funnel['employers_named_s']} s")
    if funnel.get('time_up'):
        parts.append('time ran out for: ' + ', '.join(funnel['time_up']))
    return '; '.join(parts)


def source_kind(row):
    """Fixed provenance category for counts: reader name or public EURES URL; never returns employer/source text."""
    if str(row.get('provider') or '').casefold() == 'eures':
        return 'eures'
    try:
        host = (urlparse(row.get('url') or '').hostname or '').lower()
    except ValueError:
        host = ''
    if host == 'eures.europa.eu' or (host == 'europa.eu' and '/eures/' in str(row.get('url') or '')):
        return 'eures'
    return 'other' if row.get('provider') else 'unknown'


def result(n, out):
    """One persona's numbers: local = jobs the blind judge called right role AND right place; seconds and code of press 1; a missing file is
    a failed press (silence is not success), never a zero that looks measured."""
    out = Path(out)
    # Why (11 Nov 2026, owner: "Did we decide if Luna is a too weak model for Find jobs ?"): a by-hand run on another search tier says so in its row; a night's row is unchanged.
    row = {'persona': int(n), 'label': label(n), **({'search_tier': tier} if (tier := os.environ.get('JOBADABRA_SEARCH_TIER') or 'small') != 'small' else {})}
    press_billing = ''
    starved_wait = None
    press_usd = None   # None = the press's cost was not measured; never shown or counted as $0 (gitar on #2259)
    try:
        press = json.loads((out / 'draw' / 'presses.jsonl').read_text(encoding='utf-8').splitlines()[0])
        press_billing = press.get('billing', '')
        ai = (press.get('funnel') or {}).get('ai_usd')
        note = funnel_note(press.get('funnel') or {})
        if note and (press.get('funnel') or {}).get('web_search_skipped') and press.get('search'):
            note += '; searched with ' + search_text(press['search'])   # the config the web search could not start with (run 41376694937)
        if note:
            row['funnel_note'] = note
        press_usd = None if ai is None else float(ai)   # the press's measured AI cost (funnel.py ai_usd); the strategy draft before it is not counted
        row['eures'] = press.get('eures') or (press.get('funnel') or {}).get('eures')   # 'on'/'off' as run.mjs ran it (--with-eures); else the press's own 'off' line, else None (an older build)
        row['as_app'] = 'yes' if (press.get('headless_boards') or {}).get('state') else 'no'   # the boards step ran (run.mjs writes null when it did not); Why (13 Nov 2026, owner, asked via AskUserQuestion by sa: "Yes, night reads like the app (Recommended)"): a press as the app's (renderer, run.mjs --beside) starts a new series
        row.update(seconds=int(press['seconds']), code=int(press.get('code') or 0), crashes=len(press.get('crashes') or []), counters=funnel_mod.step_counters(press), read=funnel_mod.step_read(press), step_yield=(press.get('funnel') or {}).get('step_yield'))
        if press.get('scored_in_places') is not None:   # a missing count stays unknown (read_of falls back to the judge's), never 0
            row['scored'] = int(press['scored_in_places'])
        cut, waited = cut_note(row['seconds'], int(press.get('scored_in_places') or 0), out / 'run.log')
        if cut:
            row['cut'] = cut
        starved_wait = waited if waited is not None and waited >= STARVED_WAIT_S else None
    except (OSError, IndexError, ValueError, KeyError, TypeError):
        row['error'] = 'the press wrote no numbers (see run.log)'
    row['after_repeat'], row['runs'] = runs_mod.after_repeat(out), runs_mod.read(out)   # None on a one-press night; runs: what each run added first (runs.py)
    engine = engines_of(out / 'run.log')
    if engine:
        row['engine'] = engine
    row.update(engine_calls.row_fields(out))
    unavailable = refused_reason(out / 'run.log')
    if unavailable:
        row['unavailable'] = unavailable
    judge_usd = 0.0
    subscription = False
    try:
        judged_file = json.loads((out / 'judged.json').read_text(encoding='utf-8'))
        subscription = judged_file.get('billing') == 'subscription'
        judge_usd = float(judged_file.get('usd') or 0)
        judged = judged_file['rows']
        relevant = [r for r in judged if r.get('role') == 'yes' and r.get('place') == 'yes']
        row.update(found=len(judged), local=len(relevant), **verdicts.counts(judged))   # place / role counts for the Night tab (verdicts.py)
        row.update(shown_mod.counts(judged))   # found / local = every open job; shown_* = what the app's list shows once the search ended (shown.py)
        # Fixed categories only: source names can be employer names; no such text belongs in the central night record.
        row['relevant_sources'] = {kind: sum(1 for r in relevant if source_kind(r) == kind)
                                   for kind in ('eures', 'other', 'unknown')}
    except (OSError, ValueError, KeyError):
        row.setdefault('error', 'the judge wrote no verdicts (see judge.log)')
    row['usd'] = None if press_usd is None else round(press_usd + float(judge_usd), 4)
    if subscription and press_billing == 'subscription' and press_usd is not None:
        # Why (30 Oct 2026, owner): the relay's engine may estimate tokens at API prices; the broker uses the ChatGPT plan, never API dollars.
        row.update(usd=0, billing='subscription')
    if press_usd is None:
        row['cost_unmeasured'] = True
    try:
        row['non_haiku'] = int((out / 'non-haiku-steps.txt').read_text().strip() or 0)
    except (OSError, ValueError):
        pass
    reason = grey_reason(row, out, starved_wait)
    if reason:
        row['not_measured'] = reason
    (out / 'result.json').write_text(json.dumps(row, ensure_ascii=False), encoding='utf-8')
    return row


def grey_reason(row, out, starved_wait):
    """Why a press measured nothing about the code (no AI answered, AI queue full, AI slow), else ''. Only a clean press may be grey: a non-zero exit, a crash,
    a step off the small tier, a press that wrote no numbers or a run past 180 s stays a red fault (Gitar on #2955, /code-review on 2/6, Gitar on #3714). A starved press is cut at the app's own stop."""
    if row.get('error') or row.get('code') or row.get('crashes') or row.get('non_haiku') or row.get('seconds', 0) > PRESS_LIMIT:
        return ''
    if row.get('not_run'):   # no AI call answered (engine_calls.not_run): never a zero or a floor, every not_measured exclusion applies
        return f"not run: {row['not_run']}"
    if starved_wait is not None:
        return f'AI queue full (waited {starved_wait} s)'
    if row.get('local') == 0 and read_of(row) == 0 \
            and (not row.get('cost_unmeasured') or row.get('cut')) and (row.get('usd') or 0) <= PERSONA_CAP_USD:   # judge_one's cost reds stay (Gitar on #3082)
        mean = mean_call_s(out / 'run.log')   # nothing scored, nothing right, and an AI this slow: what the press found says nothing about the code
        return f'AI slow (a call took {round(mean)} s on average)' if mean is not None and mean >= SLOW_CALL_S else ''
    return ''


def load_results(folder):
    """{persona n: result} from the result.json / verdict.json files under a folder (a run's artifacts, downloaded)."""
    found = {}
    for path in sorted([*Path(folder).rglob('result.json'), *Path(folder).rglob('verdict.json')]):
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
        except ValueError:
            continue
        rows = data.get('personas', {}).values() if isinstance(data, dict) and 'personas' in data else [data]
        for row in rows:
            if isinstance(row, dict) and 'persona' in row:
                found[int(row['persona'])] = row
    return found


def judge_one(row, mains):
    """-> (red reasons, the main numbers shown) for one persona. Invariant: `mains` is newest first and holds only main's measured rows."""
    if row is None:
        return ['no result: the job did not finish'], []
    if row.get('not_measured'):
        return [], []
    reasons = []
    if row.get('error'):
        reasons.append(row['error'])
    if row.get('code') or row.get('crashes'):
        reasons.append(f"the press failed (exit {row.get('code')}, {row.get('crashes', 0)} crash(es))")
    if row.get('seconds', 0) > PRESS_LIMIT:
        reasons.append(f"press took {row['seconds']} s (> {PRESS_LIMIT})")
    if row.get('cost_unmeasured') and not row.get('cut'):   # a press the budget cut never reached the step that measures its cost (run 41379413905); the cut note says so
        reasons.append('the press cost was not measured')
    if (row.get('usd') or 0) > PERSONA_CAP_USD:
        reasons.append(f"cost ${row['usd']:.3f} over the ${PERSONA_CAP_USD} cap")
    if row.get('non_haiku'):
        reasons.append(f"{row['non_haiku']} AI step(s) outside the small tier")
    seen = [m['local'] for m in mains if isinstance(m.get('local'), int)][:MAIN_RUNS]
    return reasons, seen   # right jobs are shown, never red per persona (quality(): the pooled total)


def read_of(row):
    """Jobs the press scored: `scored` from the press row, else the judge's `found` (rows recorded before `scored` was kept); None = unknown, never 0."""
    return next((row[k] for k in ('scored', 'found') if type(row.get(k)) is int), None)


def row_verdict(row):
    """-> (mark, why, kind): THE rule for one persona's row; compare() builds the overall line from these and from nothing else (owner, 2 Nov 2026: the row
    and the overall line of #2969 disagreed: 🟢 rows with 0 right jobs under "⚪ not measured (1 of 6)").
    🔴 a fault (judge_one: failed press, over 180 s, cost, off the small tier, no result); ⚪ no right job, kind 'unmeasured' (AI queue full, no token),
    'nothing' (no job scored: cut by the cap, time ran out, AI refused), 'not-run' (no AI answered) or 'none-right' (jobs scored, none right role AND place); 🟢 a right job.
    Invariant: 'nothing' only on an explicit 0 (a missing count is 'none-right', unknown is not zero)."""
    reasons = judge_one(row, [])[0]
    if reasons:
        return '🔴', '; '.join(reasons) + (f" {row['cut']}" if row and row.get('cut') else ''), 'fault'
    if row.get('not_run') and str(row.get('not_measured', '')).startswith('not run: '):
        return '⚪', row['not_measured'], 'not-run'
    if row.get('not_measured'):
        return '⚪', f"not measured: {row['not_measured']}", 'unmeasured'
    if type(row.get('local')) is int and row['local'] > 0:
        return '🟢', '', 'measured'
    read = read_of(row)
    if read == 0:
        return '⚪', row.get('cut') or 'no job scored', 'nothing'
    return '⚪', f'scored {read}, none right role and place' if read else 'no right job', 'none-right'


LEGACY_PERSONAS = 6   # Why (6 Nov 2026, /code-review of 4/5): main's runs before the 18 have exactly personas 1-6; their zeros must still read "measured nothing"


def _size(run):
    """How many personas a stored run was made for: 6 for a run before 6 Nov 2026 (exactly personas 1-6), else all of PERSONAS."""
    return LEGACY_PERSONAS if len(PERSONAS) > LEGACY_PERSONAS and set(run) == set(range(1, LEGACY_PERSONAS + 1)) else len(PERSONAS)


def _nothing(run, size=None):
    """True when every persona's judge saw 0 jobs (explicit found == 0): this run measured nothing, so it is no main history. `size` = the personas that run had (_size for main's runs). It is the judge's count, never the press's
    `scored`: a press cut before scoring can leave jobs the judge still graded, and that run is a measurement (Gitar on #2974)."""
    rows = [run.get(n) for n in range(1, (size or len(PERSONAS)) + 1)]
    return all(r is not None and not r.get('error') and not r.get('not_measured') and type(r.get('found')) is int and r['found'] == 0 for r in rows)   # the count alone: a fault in a zero run does not make it measured


def _total(run):
    """All personas' right jobs added up, or None when this run did not measure every persona (an errored, failed or unmeasured one) or measured nothing."""
    rows = [run.get(n) for n in range(1, len(PERSONAS) + 1)]
    if any(r is None or r.get('not_measured') or r.get('error') or r.get('code') or r.get('crashes') or not isinstance(r.get('local'), int) for r in rows) or _nothing(run):
        return None
    return sum(r['local'] for r in rows)


def quality(pr, main_runs):
    """-> {mode: 'shown'|'gated', measured, total, floor, red}. 'shown' below QUALITY_MIN_RUNS measured main runs (a run that measured every persona, so the six-persona runs before 6 Nov 2026 are no history for the 18);
    then the newest QUALITY_MIN_RUNS of them give mean and sample spread, and the PR is red below mean - QUALITY_SPREADS x spread, at least 1 and
    at most the lowest of those totals (a PR is not held to more than main reached). When that lowest is below 1, main itself found nothing in
    one of the ten: 'shown' with a `why`, since a floor of 0 could never go red (Gitar on #2934)."""
    import statistics
    totals = [t for t in (_total(run) for run in main_runs) if t is not None][:QUALITY_MIN_RUNS]
    total = _total(pr)
    if len(totals) < QUALITY_MIN_RUNS:
        return {'mode': 'shown', 'measured': len(totals), 'total': total, 'floor': None, 'red': False}
    spread_floor = max(statistics.mean(totals) - QUALITY_SPREADS * statistics.stdev(totals), QUALITY_FLOOR_MIN)
    lowest = min(totals)
    if lowest < QUALITY_FLOOR_MIN:   # main itself found nothing in one of the ten: no floor can be enforced, so say so instead of a floor that always passes
        return {'mode': 'shown', 'measured': len(totals), 'total': total, 'floor': None, 'red': False, 'why': f"main reached {lowest} right jobs in one of its last {len(totals)} runs"}
    floor = min(spread_floor, lowest)
    return {'mode': 'gated', 'measured': len(totals), 'total': total, 'floor': round(floor, 1), 'red': total is not None and total < floor,
            'basis': "main's lowest" if floor < spread_floor else f"main's average minus {QUALITY_SPREADS} spreads"}


def grey_head(rows, pr):
    """-> (head, unavailable reason) of an overall line with no 🟢 row, from the rows' kinds. Why (1 Nov 2026, owner: "Guard grey now"): until the press reads jobs again
    on the engine CI uses (cause: each Codex relay call takes 13-17 s, #2635) this is grey, not red: a red would call a slow AI a broken search.
    TODO(AI): back to red once found > 0 on the Claude engine (#2901)"""
    kinds = [r['kind'] for r in rows]
    if _nothing(pr):   # every judge saw 0 jobs: the first line names the cause (the refused AI) instead of a table of zeros
        reason = next((r.get('unavailable') for r in (pr.get(n) or {} for n in range(1, len(PERSONAS) + 1)) if r.get('unavailable')), '')
        if reason:
            return f"⚪ {'web search' if 'search' in reason else 'AI'} unavailable: {reason}; no press read a job (not a pass)", reason
        return f'⚪ measured nothing: all {len(PERSONAS)} judges saw 0 jobs, so no press read a job (not a pass)', ''
    first = next((r['why'].removeprefix('not measured: ') for r in rows if r['kind'] == 'unmeasured'), '')
    blind = next((r['why'].removeprefix('not run: ') for r in rows if r['kind'] == 'not-run'), '')
    causes = {'not-run': f'{kinds.count("not-run")} of {len(PERSONAS)} not run ({blind})', 'unmeasured': f'not measured ({kinds.count("unmeasured")} of {len(PERSONAS)}): {first}', 'nothing': f'{kinds.count("nothing")} no job scored',
              'none-right': f'{kinds.count("none-right")} scored but none right'}
    parts = [text for k, text in causes.items() if k in kinds]
    if all(k in ('unmeasured', 'not-run') for k in kinds):   # nothing ran: no "found 0"
        return f"⚪ {', '.join(parts)} (not a pass)", ''
    every = len(PERSONAS)
    return (f'⚪ no right job on any of the {every} (not a pass): ' if {'unmeasured', 'not-run'} & set(kinds) else f'⚪ found 0 right jobs on all {every} (not a pass): ') + ', '.join(parts), ''


def compare(pr, main_runs):
    """pr: {n: result}; main_runs: [{n: result}] newest first. -> {state: success|failure|neutral|not-run, rows, head}. Every row is decided by row_verdict, the
    overall state only adds the rows up: any 🔴 row or a pooled total below main's range is red, no 🟢 row is grey, else green "measured k of 6"; every row 'not-run' is state 'not-run' (no zero, no floor)."""
    rows = []
    for n in range(1, len(PERSONAS) + 1):
        row = pr.get(n)
        _, seen = judge_one(row, [run[n] for run in main_runs if n in run and not run[n].get('not_measured') and not _nothing(run, _size(run))])   # a run that measured nothing shows no zeros
        mark, why, kind = row_verdict(row)
        rows.append({'persona': n, 'label': label(n), 'main': seen, 'local': (row or {}).get('local'), 'found': (row or {}).get('found'), 'shown_local': (row or {}).get('shown_local'), 'shown_found': (row or {}).get('shown_found'), 'seconds': (row or {}).get('seconds'),
                     'usd': (row or {}).get('usd'), 'billing': (row or {}).get('billing'), 'mark': mark, 'why': why, 'kind': kind, 'reasons': why.split('; ') if kind == 'fault' else [], 'engine': (row or {}).get('engine', ''),
                     'funnel_note': (row or {}).get('funnel_note', ''), 'counters': (row or {}).get('counters'), 'read': (row or {}).get('read'), 'step_yield': (row or {}).get('step_yield'), 'relevant_sources': (row or {}).get('relevant_sources'), 'place': (row or {}).get('place'), 'role': (row or {}).get('role'),
                     'sources': (row or {}).get('sources'), 'scout': (row or {}).get('scout')})   # Why (11 Nov 2026, owner: the Admin Sources card was empty): sources_count.py and scout_list.py set `sources` and `scout` on the result and the Admin reads rows, so a field left out here shows as "not sent"
    quality_ = quality(pr, main_runs)
    red, green, reason = sum(r['mark'] == '🔴' for r in rows), sum(r['mark'] == '🟢' for r in rows), ''
    if red or quality_['red']:
        # Why (2 Nov 2026, mac-07): a red from the pooled total has no red row, so the line names the personas below main's newest measured number ("p2 3→0 right").
        dropped = ', '.join(f"p{r['persona']} {r['main'][0]}→{r['local']} right" for r in rows if r['main'] and type(r['local']) is int and r['local'] < r['main'][0])
        parts = ([f'{red} persona(s) red'] if red else []) + ([f"total {quality_['total']} right jobs, below main's floor {quality_['floor']}" + (f' ({dropped})' if dropped else '')] if quality_['red'] else [])
        state, head = 'failure', '🔴 ' + ' · '.join(parts)
    elif green:
        state, head = 'success', f'🟢 measured {green} of {len(PERSONAS)} · every press ≤ 180 s'
    elif rows and all(r['kind'] == 'not-run' for r in rows):   # no AI answered anyone (sa, 2/6): the night is "not run", never drawn as zeros (jobadabra-web #523)
        state, head = 'not-run', f"⚪ not run: no AI answered ({rows[0]['why'].removeprefix('not run: ')}); start it again by hand: gh workflow run search-personas.yml"
    else:
        state = 'neutral'
        head, reason = grey_head(rows, pr)
    head += ' · ' + ((f"quality: shown, not gated ({quality_['why']})" if quality_.get('why') else f"quality: shown, gate starts at {QUALITY_MIN_RUNS} measured main runs, {quality_['measured']} so far") if quality_['mode'] == 'shown' else
                     f"quality: gated at total {quality_['floor']} ({quality_['basis']} over {quality_['measured']} runs)")
    modes = {(row or {}).get('eures') for row in pr.values()} - {None}
    # Why (10 Nov 2026, owner): the site compares a night only with nights of its own kind (jobadabra-web admin/search-night-judge.js euresOf); 'off' only when every press that said so said off.
    eures = 'off' if modes == {'off'} else 'on'
    as_app = 'yes' if {(row or {}).get('as_app') for row in pr.values()} - {None} == {'yes'} else 'no'   # the site starts a new series at the first 'yes' night
    return {'state': state, 'head': head, 'eures': eures, 'as_app': as_app, 'rows': rows, 'main_runs': len(main_runs), 'quality': quality_, 'unavailable': reason, 'runs': runs_mod.night(pr.values()), 'by_run': runs_mod.by_run(pr.values())}


def cost_label(verdict):
    """The AI line of the header: the engines the presses logged ("claude (claude-haiku-5-5; codex ran-out)"), else that none was reported; subscription runs say no API charge."""
    engines = []
    for r in verdict['rows']:
        for one in (r.get('engine') or '').split(' + '):
            if one and one not in engines:
                engines.append(one)
    label = ' + '.join(engines) or 'AI engine not reported'
    return label + (' · subscription, no API charge' if any(r.get('billing') == 'subscription' for r in verdict['rows']) else '')


def table(verdict):
    spent = sum(r['usd'] or 0 for r in verdict['rows'])
    mode = f" · EURES: {verdict.get('eures', 'on')}"   # Why (10 Nov 2026, sa): every measure says its mode, so "ours without EURES" is never read as a drop
    cap = '' if any(r.get('billing') == 'subscription' for r in verdict['rows']) else f' (legacy API cap ${PERSONA_CAP_USD * len(PERSONAS):.2f})'
    if verdict.get('unavailable'):   # no table of zeros: nothing was searched, so there is nothing to compare
        return f"🔍 **Search check:** {verdict['head']} · {cost_label(verdict)}{mode}\n\n<sub>Presses ran, but their AI was refused ({verdict['unavailable']}), so no job was read and nothing was judged. Grey, never a pass; it measures again once the AI answers.</sub>\n"
    lines = [f"🔍 **Search check:** {verdict['head']} · {cost_label(verdict)}{mode} · cost ${spent:.2f}{cap}", '',
             f"| Persona | Main (last {MAIN_RUNS}) | This PR | Found | Shown: right / listed | Press | Cost | |", '|---|---|---|---|---|---|---|---|']
    for r in verdict['rows']:
        main = ' · '.join(str(x) for x in r['main']) or '—'
        mark = f"{r['mark']} {r['why']}".strip()
        cell = lambda v, unit='': '—' if v is None else f'{v}{unit}'   # noqa: E731
        lines.append(f"| {r['label']} | {main} | {cell(r['local'])} | {cell(r['found'])} | {cell(r.get('shown_local'))} / {cell(r.get('shown_found'))} | {cell(r['seconds'], ' s')} | {'—' if r['usd'] is None else '$%.3f' % r['usd']} | {mark} |")
    notes = [f"{r['label'].split(' ')[0]}: {r['funnel_note']}" for r in verdict['rows'] if r.get('funnel_note') and r['mark'] != '🟢']
    if notes:   # where a press that found no right job spent its time (funnel.py), one line each
        lines += ['', '<sub>Where the time went: ' + ' · '.join(notes) + '</sub>']
    lines += ['', '<sub>This PR / Main = jobs a blind judge (Codex small tier) called right role AND right place, of every open job found; Shown = of the jobs the Jobs list in the app shows once the search has ended (every found job, scored or waiting for its score); one press each, '
              'a fresh install. Red: a press over 180 s, or (from 10 measured main runs) the all-persona total below main\'s average minus twice its spread (never below 1, never above main\'s lowest of those runs; not gated while that lowest is 0). A row is green with at least one right job, grey without (it says why: AI queue full, no job scored, none right); the whole check is grey when no row is green (not a pass).</sub>']
    return '\n'.join(lines) + '\n'


def main(argv):
    kind = argv[0]
    if kind == 'cv':
        print(json.dumps(make_cv(argv[1], argv[2]), ensure_ascii=False))
    elif kind == 'extract':
        print(len(extract(argv[1], argv[2], include_urls='--urls' in argv[3:])), 'open jobs')
    elif kind == 'result':
        print(json.dumps(result(argv[1], argv[2]), ensure_ascii=False))
    elif kind == 'compare':
        results, out, mains = argv[1], Path(argv[2]), argv[3:]
        verdict = compare(load_results(results), [load_results(m) for m in mains])
        if os.environ.get('SEARCH_REFERENCE_JOBS'):   # in = out per source (tools/persona-search/inout.py): the night's reference job's keys
            import inout
            print(f"in = out: {inout.attach(verdict['rows'], results, os.environ['SEARCH_REFERENCE_JOBS'])} persona(s)")
        out.mkdir(parents=True, exist_ok=True)
        (out / 'verdict.json').write_text(json.dumps({**verdict, 'personas': {str(k): v for k, v in load_results(results).items()}}, ensure_ascii=False, indent=1))
        (out / 'table.md').write_text(table(verdict), encoding='utf-8')
        print(table(verdict))
        return 1 if verdict['state'] == 'failure' else 0
    else:
        raise SystemExit(__doc__)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
