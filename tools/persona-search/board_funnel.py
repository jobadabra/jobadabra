"""Where one search's jobs were lost, per source: one table read from a measured search's folder (draw/run-1.log, run.log, judged.json), no new log line needed.
Why (14 Nov 2026, owner via sa: "let's fix also this"): a low right-jobs number said nothing about where the jobs went (the full board read cut at 68 s in 12 of 12
searches, the place pass not run in 7 of 12, jobs dropped after the last hand-over in 4 of 12: each found by hand from the log).
Rows: each job board (by host), the employer sites, each free feed. Columns: named by, got a place (or why not), first read at, search words asked, jobs on the pages,
kept, never judged (= waiting for the after-search queue), judged no, place out, shown, right (role and place, the blind judge). Then the clocks and AI calls per stage.
Counts and hosts only: no link, title or employer leaves (tests/tooling/ci/test_board_funnel.py guards it). A column whose source line is not merged is listed
under "Not shown yet" with the PR that adds it, never guessed. A report: it never fails a run (the workflow ignores its exit code).
Usage: python3 tools/persona-search/board_funnel.py <folder>   (folder holds draw/run-1.log or run-1.log, run.log, judged.json)  -> markdown on stdout"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlparse

from inout import LINE as STAGE   # the one parser of a Stage line (its `rest` is what follows the link)

SEC = re.compile(r'^\[(\d+)s\] (.*)$')
ROUND = re.compile(r"^Job boards: (?P<name>.+?) round '(?P<word>[^']*)'(?: in [^:]+)?: (?:(?P<jobs>\d+) job\(s\) on the page, (?P<new>\d+) new|page not read \((?P<why>[^)]*)\)), (?P<d>\d+) s.* · (?P<url>\S+)$")
LATER = re.compile(r'^Job boards named later: (?P<pos>\d+)\. (?P<name>.+?) \((?P<host>\S+)\): (?P<reason>.+?) \[rank')
LATER_FREE = re.compile(r'^Job boards named later: places left (\d+), held by (.+)$')
NAMED = (('pack', re.compile(r'^First jobs: reading (.+?), the job boards that gave people like you')), ('AI', re.compile(r'^Job boards proposed for [^:]+: (.+)$')),
         ('AI', re.compile(r'^Job boards of your field: (.+)$')), ('web search', re.compile(r'^Job boards: a web search found (.+)$')))
EMPLOYERS = re.compile(r'^Employers: read (\d+) of (\d+) sites')
EMPLOYER_JOBS = re.compile(r'Reading employer job sites: (\d+) of (\d+)(?: · (\d+) jobs listed)?')
RELAY = re.compile(r'^relay: .* kind (\w+) start (\d+) ')
NEEDS = (('pages per round', "ab's board-read PR"), ('place asked, title judged, read-but-never-staged per board', "xb's board-pass PR"), ('how many link-less jobs the save merged', 'a line from the save; xc counts it by replay'))   # TODO(AI): drop each when its PR is merged and parsed (14 Nov 2026); named by owner, not number: a reopened PR changes its number


def norm(text):
    """A name or host with only its lowercase letters and digits, to match 'Jobijoba' to jobijoba.es."""
    return re.sub(r'[^a-z0-9]', '', text.lower())


def host_of(url):
    """The host of a link without its www."""
    return (urlparse(url).hostname or '').removeprefix('www.')


def lines_of(folder):
    """[(second, text)] of the search's own log (draw/run-1.log, else run-1.log) as strings; [] when the folder has none."""
    for path in (Path(folder) / 'draw' / 'run-1.log', Path(folder) / 'run-1.log'):
        if path.is_file():
            return [m.groups() for m in map(SEC.match, path.read_text(encoding='utf-8', errors='replace').splitlines()) if m]
    return []


def board_round(rows, host_of_name, hit, sec):
    """One round line of a board: its host's row counts the round, its jobs, a refused page, and the second the board was first read at (the line's second minus its length)."""
    row = rows[host_of(hit['url'])]
    host_of_name[norm(hit['name'])] = host_of(hit['url'])
    row['rounds'] += 1
    row['jobs'] += int(hit['jobs'] or 0)
    row['refused'] += hit['jobs'] is None
    row['first'] = min(row['first'] if row['first'] is not None else sec, max(0, sec - int(hit['d'])))


def job_stage(rows, stage):
    """One per-job Stage line: a board's job goes to its host's row ('jobs with no link' when the line's link is `-`), any other reader's to the reader's.
    A job is told by its link, plus the title after `#` of a link-less one; a never_asked line adds ` | <place>` (job_stage.say_one), cut off so one job is one key
    (a title holding ` | ` with no place on its line loses its tail: rare, and then it counts twice)."""
    link, rest = stage['url'], stage['rest']
    key = (host_of(link) or 'jobs with no link') if stage['reader'] == 'Job boards found' else stage['reader']
    job = link
    if '#' in link:
        job = link + (rest.rsplit(' | ', 1)[0] if stage['stage'] == 'never_asked' else rest)
    rows[key]['urls'].setdefault(job, []).append(stage['stage'])
    rows[key]['feed'] = stage['reader'] != 'Job boards found'


def named_rows(rows, host_of_name, named_at):
    """Puts who named each board on its row: the host it was read at, else the host whose name it matches, else a row under its own name."""
    by_host = {host: norm(host) for host in rows}
    for how, names in named_at:
        for name in names:
            key = host_of_name.get(norm(name)) or next((host for host, flat in by_host.items() if flat == norm(name) or norm(host.split('.')[0]) == norm(name)), name)
            rows[key]['named'].append(how)


def read(folder):
    """-> {'rows': {key: {...}}, 'clock': {...}}: every count from the log's own lines; a key is a host (a board), 'employer sites' or a feed's name."""
    rows = defaultdict(lambda: {'named': [], 'place': None, 'first': None, 'rounds': 0, 'refused': 0, 'jobs': 0, 'urls': {}, 'feed': False, 'right': 0, 'shown': 0})
    clock, host_of_name, named_at = {}, {}, []
    last = {'sorted': None, 'placed': None}
    for sec, text in ((int(s), t) for s, t in lines_of(folder)):
        clock['end'] = sec
        hit = ROUND.match(text)
        if hit:
            board_round(rows, host_of_name, hit, sec)
        later = LATER.match(text)
        if later:
            host_of_name[norm(later['name'])] = later['host']
            rows[later['host']]['place'] = f"#{later['pos']}: {later['reason']}"
        free = LATER_FREE.match(text)
        if free:
            clock['later_free'] = f'{free[1]} (held by {free[2]})'
        for how, pattern in NAMED:
            if pattern.match(text):
                names = re.sub(r' \(named without a search link: [^)]*\)', '', pattern.match(text)[1])
                named_at.append((how, [name.strip() for name in names.split(', ') if name.strip()]))
                if how == 'AI':   # the pack's names are known at the start; the list that arrives is the AI's proposal
                    clock.setdefault('list', sec)
        stage = STAGE.search(text)
        if stage:
            job_stage(rows, stage)
            clock['stage_lines'] = True
        if EMPLOYERS.match(text):
            rows['employer sites']['place'] = 'read {} of {} sites, best first'.format(*EMPLOYERS.match(text).groups())
        listed = EMPLOYER_JOBS.search(text)
        if listed and listed[3]:
            rows['employer sites']['jobs'] = int(listed[3])
        if text.startswith('⏱ Time is up') and 'for job boards' in text:
            clock['cut'] = sec
        for word, tag in (('Titles: Claude sorted', 'sorted'), ('Places: Claude placed', 'placed')):
            if text.startswith(word):
                last[tag] = sec
    clock.update({'titles': last['sorted'], 'places': last['placed']})
    named_rows(rows, host_of_name, named_at)
    return {'rows': rows, 'clock': clock, 'names': host_of_name}   # rows still a defaultdict: judged() adds a source the log never named


def judged(folder, rows, names):
    """Adds each judged job to its source's row: a board's by its `host` (gate.board_host), else by the board name after `via ` matched to a host the log named (an older artifact),
    an employer site's by kind, a feed's by provider; -> the number of jobs no source could be told for, None when judged.json is missing or unreadable."""
    try:
        data = json.loads((Path(folder) / 'judged.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    unknown = 0
    for job in data.get('rows', []):
        company, kind = job.get('company') or '', job.get('kind') or ''
        if kind == 'job board':
            key = job.get('host') or (names.get(norm(company[4:])) if company.startswith('via ') else None)
        else:
            key = 'employer sites' if kind == 'employer feed' else job.get('provider') or None
        if key is None:
            unknown += 1
            continue
        rows[key]['shown'] += 1
        rows[key]['right'] += job.get('role') == 'yes' and job.get('place') == 'yes'
    return unknown


def calls(folder):
    """AI calls per stage from run.log's relay lines, those after the search started when the log says where that is."""
    try:
        text = (Path(folder) / 'run.log').read_text(encoding='utf-8', errors='replace').splitlines()
    except OSError:
        return None
    started = next((i for i, line in enumerate(text) if line.startswith('draw: search prepared')), -1)
    return Counter(hit[1] for hit in map(RELAY.match, text[started + 1:]) if hit)


def linkless(jobs):
    """Jobs read without a link of their own, from the stage lines' addresses (xc, #4183): `page#<title>` before the fix, where the save may merge copies sharing the
    page (how many it merged is not in the log: xc's replay counted 54 read, 8 saved on Madrid's board); `page#job:<employer>--<title>--<place>` after it, which merges none."""
    tokens = [key.split(' ')[0] for key in jobs if '#' in key.split(' ')[0]]
    if not tokens:
        return '-'
    if all(token.split('#', 1)[1].startswith('job:') for token in tokens):
        return f'{len(tokens)} (own address, since #4183)'
    return f'{len(tokens)} (shared page address)'


def seen(value):
    """A clock's second for the Clocks line, or 'not run' for a step whose line never came."""
    return 'not run' if value is None else f'{value} s'


def table(folder):
    """The markdown of one search's table, clocks and AI calls."""
    data = read(folder)
    rows, clock = data['rows'], data['clock']
    unknown = judged(folder, rows, data['names'])
    if not rows and not clock.get('end'):
        return 'No search log in this folder.\n'
    out = ['| source | named by | got a place | read at (s) | words asked | jobs on pages | kept | kept, then dropped | never judged (waiting) | judged no | place out | no link (never listed) | no link of its own | shown | right |', '|' + '---|' * 15]
    for key, row in sorted(rows.items(), key=lambda item: (-item[1]['right'], -item[1]['jobs'], item[0])):
        verdict = {url: [s for s in said if s != 'read'][-1:] or ['never_asked'] for url, said in row['urls'].items()}
        count = Counter(v[0] for v in verdict.values())
        count['dropped'] = sum(v[0] != 'kept' and 'kept' in row['urls'][url] for url, v in verdict.items())   # passed the first pass, lost in a later one
        place = row['place'] or ('free feed, always read' if row['feed'] else 'read' if row['rounds'] else 'no reason logged')
        refused = f", {row['refused']} page(s) refused" if row['refused'] else ''
        out.append(f"| {key} | {', '.join(sorted(set(row['named']))) or '-'} | {place} | {'-' if row['first'] is None else row['first']} | {row['rounds'] or '-'}{refused} | "
                   f"{row['jobs'] or '-'} | " + ' | '.join(str(count[s] or '-') for s in ('kept', 'dropped', 'never_asked', 'ai_no', 'placed_out', 'no_link')) + f" | {linkless(row['urls'])} | {row['shown'] or '-'} | {row['right'] or '-'} |")
    out += ['', f"Clocks: list arrived {seen(clock.get('list'))} · board read cut {seen(clock.get('cut'))} · last title pass {seen(clock.get('titles'))} · "
                f"last place pass {seen(clock.get('places'))} · run end {seen(clock.get('end'))}"]
    if clock.get('later_free'):
        out.append(f"Places left for boards named later: {clock['later_free']}")
    used = calls(folder)
    out.append('AI calls per stage: ' + (' · '.join(f'{kind} {n}' for kind, n in used.most_common()) if used else 'n/a (no run.log)'))
    if not clock.get('stage_lines'):
        out.append('Per-board kept / never judged / judged no / place out: n/a, this search logged no per-job stage (dispatch the pair with stage_log=true).')
    if unknown is None:
        out.append('shown / right: n/a, judged.json is missing or unreadable (the blind judge did not finish).')
    elif unknown:
        out.append(f'{unknown} judged job(s) had no host (judged before the host was kept): in no row above.')
    out.append('Logs in this artifact: draw/run-1.log is every line the engine printed (rounds, Stages, Board pass, Waiting, stacks at time-up); run.log is only the AI relay.')
    out.append('Not shown yet: ' + '; '.join(f'{name} (needs {pr})' for name, pr in NEEDS))
    return '\n'.join(out) + '\n'


if __name__ == '__main__':
    sys.stdout.write(table(sys.argv[1]))
