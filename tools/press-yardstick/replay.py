"""The Find jobs pipeline yardstick's replays, all in one job (.github/workflows/press-yardstick.yml; owner, 8 Nov 2026: "are we going to have so
many checks at PR, or group them in 5-10 most?" → "1 check, all 36 at once (Recommended)"): every persona's recording replayed by every side at once,
each a first and a repeat Find jobs run at the recorded pace, offline (no AI, no site), then laid out as ci.py reads them.
  python3 tools/press-yardstick/replay.py <recordings> <sides> <art>
<recordings>/p<N>/ holds each recording (fetched by main's tape-store.mjs); <sides> is a JSON object {side: checkout folder}, e.g.
{"main": "sides/main", "pr": "sides/pr"} or main-1..5 for the band. Each run gets its own copy of the recording (a replay appends its report there)
and its own TMPDIR (run.mjs keeps its state under the temp folder). A persona's main and PR replays start together, so a busy machine slows both alike;
the machine's lowest free memory and highest load are printed for the summary: reported only; if they show it overloaded, the persona list
goes to 6 per PR by hand (the owner's option, 8 Nov 2026). Each side runs with its own packages (<checkout>/.venv first on PATH)."""
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

AT_ONCE = 36       # one PR's 18 personas x 2 sides; the band's 18 x 5 runs in waves of this size
HANG_S = 15 * 60   # a replay still running after this is killed and counted as crashed (two 180 s runs take ~6 min)
DEADLINE_S = 30 * 60   # every wave together: past it, what is still running is killed, so ci.py always gets to run (Gitar on #3598)


def runs(recordings, sides):
    """[(persona, side, checkout)] for each recording and side, a persona's sides next to each other."""
    personas = sorted((p.name for p in Path(recordings).glob('p*') if p.is_dir()), key=lambda name: int(name[1:]))
    return [(persona, side, Path(checkout)) for persona in personas for side, checkout in sides.items()]


# Why (rf, 8 Nov 2026, gi): the value is press-tapes.yml:38 (`JOBADABRA_MODEL_OVERRIDE: claude-haiku-5-5`, since #3572). Every recording made so far used it but none says so (recorded.json is written from this PR on);
# a replay without it asks Sonnet for every main-tier step and misses every one. A tape without the file is a press-tapes recording of that time. Both sides get it here, because main's
# own run.mjs does not read recorded.json yet.
LEGACY_OVERRIDE = 'claude-haiku-5-5'


def recorded_override(tape):
    """The model override a recording was made with (its recorded.json), LEGACY_OVERRIDE for a recording made before the file existed; '' = none."""
    try:
        recorded = json.loads(Path(tape, 'recorded.json').read_text(encoding='utf-8'))
        found = recorded.get('model_override') if isinstance(recorded, dict) else None
    except FileNotFoundError:
        print(f'recording has no recorded.json: using {LEGACY_OVERRIDE}, the override press-tapes.yml recorded with ({tape})', flush=True)   # a change of that env shows up here, not as misses
        return LEGACY_OVERRIDE
    if not isinstance(found, str):
        raise ValueError(f'{tape}/recorded.json has no model_override: the recording does not say which model it was made with')
    return found


def start(recordings, art, persona, side, checkout):
    """Starts one replay in its own folder; returns (Popen, its log file)."""
    work = Path(art, f'yardstick-{persona}-{side}').resolve()
    shutil.rmtree(work, ignore_errors=True)
    (work / 'tmp').mkdir(parents=True)
    shutil.copytree(Path(recordings, persona), work / 'tape')
    out = work / 'out'
    script = (f'python3 tools/persona-search/gate.py cv {persona[1:]} "{out}" && '
              f'node tools/persona-search/run.mjs draw "{out}" --presses 2 --fresh --engine api --tag replay --draft "{work}/tape/draft.json" '
              f'--tape "{work}/tape" --replay --no-live --wait-scale 1')
    venv = (Path(checkout) / '.venv' / 'bin').resolve()
    env = {**os.environ, 'PATH': f"{venv}{os.pathsep}{os.environ.get('PATH', '')}", 'TMPDIR': str(work / 'tmp'), 'JOBADABRA_TAPE_ITEMS': '1', 'JOBADABRA_TAPE_BUDGET': '0'}
    override = recorded_override(work / 'tape')
    env.pop('JOBADABRA_MODEL_OVERRIDE', None)
    if override:
        env['JOBADABRA_MODEL_OVERRIDE'] = override
    log = open(work / 'run.log', 'w', encoding='utf-8')
    return subprocess.Popen(['bash', '-c', 'set -o pipefail; ' + script], cwd=checkout, env=env, stdout=log, stderr=subprocess.STDOUT), log


def collect(art, persona, side):
    """The replay's jobs, the recording's judge and ceiling in result/, the layout ci.py reads; False when the replay left no jobs."""
    work = Path(art, f'yardstick-{persona}-{side}')
    result = work / 'result'
    (result / 'ceiling').mkdir(parents=True, exist_ok=True)
    shutil.copy(work / 'tape' / 'judged.json', result)
    for ceiling in (work / 'tape').glob('jobs-*.json'):
        shutil.copy(ceiling, result / 'ceiling')
    found = list((work / 'out' / 'draw').glob('jobs-*.json'))
    for jobs in found:
        shutil.copy(jobs, result)
    if (work / 'tape' / 'report.jsonl').exists():   # what the replay found on the recording and what it lacked: why a replay finds few jobs
        shutil.copy(work / 'tape' / 'report.jsonl', work / 'tape-report.jsonl')
    shutil.rmtree(work / 'tape', ignore_errors=True)
    shutil.rmtree(work / 'tmp', ignore_errors=True)
    return bool(found)


class Machine:
    """The lowest free memory (MB) and highest 1-min load seen every 10 s while the replays run (Linux /proc; elsewhere nothing)."""
    def __init__(self):
        self.free_mb, self.load, self.stop = None, None, threading.Event()
        threading.Thread(target=self.watch, daemon=True).start()

    def watch(self):
        while not self.stop.wait(10):
            try:
                free = int(next(line for line in open('/proc/meminfo') if line.startswith('MemAvailable')).split()[1]) // 1024
                load = float(open('/proc/loadavg').read().split()[0])
            except (OSError, StopIteration, ValueError):
                return
            self.free_mb = free if self.free_mb is None else min(self.free_mb, free)
            self.load = load if self.load is None else max(self.load, load)


def main(argv):
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    recordings, sides, art = argv[0], json.loads(argv[1]), argv[2]
    todo = runs(recordings, sides)
    if not todo:
        print('No persona has a Find jobs recording yet: not measured.')
        return 0
    machine, crashed, started = Machine(), [], time.monotonic()
    deadline = started + DEADLINE_S
    for wave in range(0, len(todo), AT_ONCE):
        live = [(persona, side, *start(recordings, art, persona, side, checkout)) for persona, side, checkout in todo[wave:wave + AT_ONCE]]
        for persona, side, process, log in live:
            try:
                process.wait(timeout=max(1, min(HANG_S - (time.monotonic() - started), deadline - time.monotonic())))
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            log.close()
            ended_with_jobs = collect(art, persona, side)   # always laid out: ci.py names a crashed replay only when its recording is there
            if process.returncode != 0 or not ended_with_jobs:
                crashed.append(f'{persona} {side}')
        started = time.monotonic()
        if started >= deadline:
            crashed += [f'{persona} {side}' for persona, side, _ in todo[wave + AT_ONCE:]]   # never started: past the deadline
            break
    machine.stop.set()
    print(f'Replayed {len(todo)} Find jobs recordings x sides ({len(todo) - len(crashed)} ended with jobs); '
          f'the machine: lowest free memory {machine.free_mb} MB, highest load {machine.load}')
    if crashed:
        print('Crashed or no jobs (see art/yardstick-<persona>-<side>/run.log): ' + ', '.join(crashed))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
