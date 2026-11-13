"""The funnel of one Find jobs press, read from its log (tools/persona-search/run.mjs adds it to each press's row): employers picked for the role's kind,
employer sites and job boards read, web searches made, jobs listed and matched. The search robot's alarm (jobadabra-web jobs/persona-search) puts it in the
issue it files, so a thin search says where it went thin (owner, 26 Oct 2026: "pilot, Europe: 0 jobs" was found by hand, never by the robot).
A count whose log line never came is None, never 0: a missing line is "not seen", not "nothing found". Guard: tests/test_persona_funnel.py.
Usage: python3 tools/persona-search/funnel.py <run-N.log> [--since <ISO time the press started>]   -> one JSON line (with --since: ai_usd, the press's AI cost)
"""
import json
import re
import sys

STEP = re.compile(r'^\[\d+s\] ')
SECONDS = re.compile(r'^\[(\d+)s\] ')
PLACES = re.compile(r'^Places: (?:worked out|\d+ place words? placed)')
WEB_START = re.compile(r'^Job boards: searching the web for trade and local boards')
WEB_SKIPPED = re.compile(r'^Job boards: no web search: (?!searched)(.+)')   # any reason src/sources/board_web.py not_asked gives, kept; \"searched …\" is a rest or this run's earlier search, not a skip (Gitar on #3953)
TIME_UP = re.compile(r'^⏱ Time is up \([^)]*\) for ([^:]+):')
EMPLOYERS = re.compile(r'^Employers: ([\d,]+) of ([\d,]+) in your places hire for your kind of role')
EMPLOYER_READ = re.compile(r'Reading employer job sites: ([\d,]+) of ([\d,]+)(?: · ([\d,]+) jobs listed)?')
BOARD = re.compile(r'^Job boards found: (.+?) ([\d,]+) job\(s\), ([\d,]+) relevant')
BOARD_WEB = re.compile(r'^Job boards: (?:a web search found (.+)|the web search for trade and local boards did not answer)')
SCOUT_WEB = re.compile(r'^Scout: employers with no job site found are looked up with a web search')
COUNTS = re.compile(r'^Run counts: looked=(\d+) matches=(\d+) scored=(\d+) good=(\d+)')
EURES_OFF = re.compile(r'^EURES: off in this run')   # src/daily_search.py start_sources: the press ran without the EURES reader
EURES = re.compile(r'^EURES: (?:([\d,]+) vacanc|still reading when its time ended, keeping the ([\d,]+) read)')
TITLES = re.compile(r'^Titles: .+? sorted ([\d,]+) new title\(s\) in your places')
TITLE_BATCH = 30   # src/ai/title_triage.py BATCH: one AI call per up to 30 titles
AI_DECIDE = re.compile(r'^AI decide calls: (.+)$')
NO_BOARD = 'no trade or local board'


def number(text):
    return int(str(text).replace(',', ''))


def step_count(part, out):
    """Tally one log line of the per-step counters into `out` (eu_jobs, titles_asked, ai_calls); True when the line was one of them."""
    if EURES_OFF.match(part):
        out['eures'] = 'off'
    elif m := EURES.match(part):
        out['eu_jobs'] = number(m[1] or m[2])   # what OUR EURES read listed in the user's places (src/sources/eures.py), not what EURES holds
    elif m := TITLES.match(part):
        # Why (6 Nov 2026, Gitar on #3353): the "asking ... in N batch(es)" line is the plan, printed before any batch runs; the closing "sorted N" line counts what was answered, so a press cut by its time reads fewer.
        out['titles_asked'] = (out['titles_asked'] or 0) + number(m[1])
        out['ai_calls'] = (out['ai_calls'] or 0) + -(-number(m[1]) // TITLE_BATCH)
    elif m := AI_DECIDE.match(part):
        out['ai_calls'] = (out['ai_calls'] or 0) + sum(int(item.rsplit(' ', 1)[-1]) for item in m[1].split(', ') if item.rsplit(' ', 1)[-1].isdigit())
    else:
        return False
    return True


def funnel(lines):
    """{employers_picked, employers_in_places, employer_sites_read, boards_read, board_jobs, board_relevant, web_searches, web_found,
    scout_web, looked, matches, scored, good, eu_jobs, titles_asked, ai_calls} from a press's log lines; the CLI adds kinds (the role kinds the employers were picked by)."""
    out = dict.fromkeys(('employers_picked', 'employers_in_places', 'employer_sites_read', 'looked', 'matches', 'scored', 'good', 'eu_jobs', 'titles_asked', 'ai_calls', 'eures'))
    boards, web, found = {}, 0, 0
    scout_web = False
    # Why (2 Nov 2026, run 41376694937, mac-07: "everything is 0"): p2-p4 started their web search and still found 0 because the time budget ended before
    # any employer site or board was read; p1/p5 never started it. Seconds and phases below say which, in the funnel and the table.
    where = {'places_worked_out_s': None, 'web_search_started_s': None, 'employers_named_s': None}
    time_up, web_skipped = [], False
    for raw in lines:
        at = SECONDS.match(raw)
        at = int(at[1]) if at else None
        line = STEP.sub('', raw.rstrip('\n'))
        for part in line.split('⏳'):   # a progress line can follow another on the same line
            part = part.strip()
            if PLACES.match(part):
                where['places_worked_out_s'] = where['places_worked_out_s'] if where['places_worked_out_s'] is not None else at
            elif WEB_START.match(part):
                where['web_search_started_s'] = where['web_search_started_s'] if where['web_search_started_s'] is not None else at
            elif m := WEB_SKIPPED.match(part):
                web_skipped = m[1].strip() or True
            elif m := TIME_UP.match(part):
                if m[1] not in time_up:
                    time_up.append(m[1])
            elif m := EMPLOYERS.match(part):
                out['employers_picked'], out['employers_in_places'] = number(m[1]), number(m[2])
                where['employers_named_s'] = where['employers_named_s'] if where['employers_named_s'] is not None else at
            elif m := EMPLOYER_READ.search(part):
                out['employer_sites_read'] = max(out['employer_sites_read'] or 0, number(m[1]))
            elif m := BOARD.match(part):
                jobs, relevant = boards.get(m[1], (0, 0))
                boards[m[1]] = (max(jobs, number(m[2])), max(relevant, number(m[3])))   # a board read twice keeps its best read
            elif m := BOARD_WEB.match(part):
                web += 1
                found += 0 if not m[1] or m[1] == NO_BOARD else len(m[1].split(', '))
            elif SCOUT_WEB.match(part):
                scout_web = True
            elif step_count(part, out):
                pass
            elif m := COUNTS.match(part):
                out['looked'], out['matches'], out['scored'], out['good'] = map(int, m.groups())
    return {**out, 'boards_read': len(boards), 'board_jobs': sum(jobs for jobs, _ in boards.values()),
            'board_relevant': sum(relevant for _, relevant in boards.values()), 'web_searches': web, 'web_found': found, 'scout_web': scout_web,
            **where, 'web_search_skipped': web_skipped, 'time_up': time_up}


def step_counters(press):
    """The press's per-step counters for the Night search tab (owner, 6 Nov 2026: "go ahead. Fix the search"; report only): {eu: EU portal jobs OUR read listed, sites: employer sites read, titles: titles asked,
    ai: AI calls, firstS: seconds to the first job in the user's places}, from the funnel (funnel.py, the press's own log lines). A press that ran and logged no such line read none of it: 0, never unknown;
    no job in its places is None ("none"), not 0 s. Why: a step that silently stopped (the Toulouse shape, 6 Nov) must read as a fall against the candidate's own nights, not as a gap."""
    funnel, ttfr = press.get('funnel') or {}, press.get('ttfr') or {}
    return {'eu': funnel.get('eu_jobs') or 0, 'sites': funnel.get('employer_sites_read') or 0, 'titles': funnel.get('titles_asked') or 0, 'ai': funnel.get('ai_calls') or 0, 'firstS': ttfr.get('first_in_places_s')}


def step_read(press):
    """What one search read for the Finish line's "What a search read" card (owner, 11 Nov 2026, asked via AskUserQuestion by sa: "Build as shown"): {listed: the jobs listed in the person's places (metrics.py local_jobs: the job's place
    names their city or country, never worldwide remote), employers: the employers in their places (the funnel's employers_in_places)}, from the press row. Sites read and titles judged are already in step_counters. A number the press did
    not write is None ("not sent yet" on the card), never 0: an employers line that never came is not "no employers"."""
    funnel, listed = press.get('funnel') or {}, press.get('local_jobs')
    employers = funnel.get('employers_in_places')
    return {'listed': listed if type(listed) is int else None, 'employers': employers if type(employers) is int else None}


def kinds():
    """The role kinds the search looked for (src/role_kinds.of_search, the engine's own answer, from its decision cache), or None outside an install."""
    import os
    if not os.environ.get('JOBADABRA_CONFIG_DIR'):
        return None
    try:
        from src import role_kinds
        with open(os.path.join(os.environ['JOBADABRA_CONFIG_DIR'], 'search.json'), encoding='utf-8') as file:
            found = role_kinds.of_search(json.load(file))
        return sorted(found) if found else []
    except Exception:   # a funnel line never fails the press
        return None


def ai_usd(since):
    """The AI dollars the runs started since `since` (ISO, UTC) recorded in their details (src/run_details.py 'ai': per stage), rounded to a cent
    tenth, or None when no run recorded any: the search robot's measured cost per draw (the strategy draft before press 1 is not a run)."""
    import sqlite3
    try:
        from src.paths import DATA
        rows = sqlite3.connect(DATA / 'tracker.sqlite').execute('SELECT data FROM cron_runs WHERE started_at >= ?', (since,)).fetchall()
    except Exception:
        return None
    spent = [stage.get('usd') for (data,) in rows for stage in ((json.loads(data).get('details') or {}).get('ai') or {}).values()
             if isinstance(stage.get('usd'), (int, float))]
    return round(sum(spent), 3) if spent else None


def step_yield(since, db=None):
    """What each step of the Find jobs run started since `since` (ISO, UTC) brought, for the Night search tab (owner, 8 Nov 2026: "Can I get in Admin these stats as well?"): [{step, seconds, jobs, local,
    scored, fit70, local_fit70}] in the engine's step order, read from the persona's own job cache by the table's one reader (src/press/step_yield.py `latest`), or None when there is none (a build before
    8 Nov, or a run that died first): nothing is claimed, never zeros. Read-only. The newest run since `since` is the press just ended (the CLI runs right after each press, so a later press is not there yet)."""
    import sqlite3
    from contextlib import closing
    try:
        from src.press import step_yield as table
        if db is None:
            from src.paths import JOBS_DB as db
        with closing(sqlite3.connect(f'file:{db}?mode=ro', uri=True)) as conn:
            rows = table.latest(conn, since)
    except Exception:   # a funnel line never fails the press
        return None
    return [{key: row[key] for key in table.FIELDS} for row in rows] or None


if __name__ == '__main__':
    if len(sys.argv) not in (2, 4) or (len(sys.argv) == 4 and sys.argv[2] != '--since'):
        sys.exit(__doc__)
    with open(sys.argv[1], encoding='utf-8', errors='replace') as log:
        out = {**funnel(log), 'kinds': kinds()}
    print(json.dumps({**out, 'ai_usd': ai_usd(sys.argv[3]), 'step_yield': step_yield(sys.argv[3])} if len(sys.argv) == 4 else out))
