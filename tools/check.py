"""Run consistent fast, area or full project verification with supported runtimes and actionable failures."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import tempfile

ROOT = Path(__file__).resolve().parents[1]
# Why (1 Nov 2026, owner: jobadabra is desktop + extension only): the `worker` suite's code moved to app-core/; the area key keeps its name so check names, caches and
# required checks stay (renaming it is parked in Linear).
AREA_DIR = {'worker': 'app-core'}
AREAS = ('python', 'worker', 'desktop')
WINDOWS_ARGS_BUDGET = 24000   # characters of test paths on one node command line, well under Windows' 32,767


def node_supported(version):
    parts = tuple(int(part) for part in version.strip().lstrip('v').split('.')[:3])
    return (parts[0] == 22 and parts >= (22, 13, 0)) or parts[0] >= 24


def find_node(env=None):
    env = os.environ if env is None else env
    candidates = [env.get('JOBADABRA_CHECK_NODE'), shutil.which('node')]
    nvm = Path(env.get('NVM_DIR', str(Path.home() / '.nvm'))) / 'versions/node'
    if nvm.exists():
        candidates += [str(path / 'bin/node') for path in sorted(nvm.glob('v*'), reverse=True)]
    for candidate in candidates:
        if not candidate:
            continue
        try:
            version = subprocess.check_output([candidate, '--version'], text=True, stderr=subprocess.DEVNULL)
            if node_supported(version):
                return str(Path(candidate).resolve()), version.strip()
        except (OSError, ValueError, subprocess.CalledProcessError):
            continue
    raise RuntimeError('Node 22.13+ or 24+ is required. Use nvm use 22 or set JOBADABRA_CHECK_NODE.')


def affected(base):
    """The tests a change can break (tools/affected-tests.py), or None: run everything. Local pushes and a PR's `Unit / desktop (Linux)` job; main never passes --affected-from."""
    if not base:
        return None
    listed = os.environ.get('JOBADABRA_AFFECTED_FILES', '').splitlines()   # the Stop hook: the changed files incl. uncommitted ones (a commit-only diff misses them)
    out = subprocess.run([sys.executable, str(ROOT / 'tools/affected-tests.py'), *(['--files', *listed] if listed else ['--base', base])], capture_output=True, text=True, check=False)
    try:
        return json.loads(out.stdout)
    except ValueError:
        return None


def desktop_test_flags(folder):
    """`npm test`'s own node flags, without its test globs: every desktop run keeps the no-live-site import and the reporter. Why (4 Nov 2026, PR time 2/2): a picked run went without them."""
    words = json.loads((folder / 'package.json').read_text())['scripts']['test'].split('&&')[-1].split()
    return [w for w in words[1:] if not w.strip('\'"').startswith('test/')]


def _app_tests():
    spec = importlib.util.spec_from_file_location('app_tests', ROOT / 'tools/app-tests.py')
    app_tests = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(app_tests)
    return app_tests


def desktop_app_only(folder, node, picked='all'):
    """The desktop area for the release pipeline and a PR's Windows job, without its lint (a rule about the code that CI · Tests checks on every push, not a release gate). Everything: `npm test`'s
    own node command on every test but the tooling ones (tools/app-tests.py). With `picked` (a PR: tools/affected-tests.py): the picked files only, the tooling tests among them too, none = no command.
    Why (5 Nov 2026, owner: "Yes: reached tests, every PR"): a PR's Windows job ran every test file; Linux already runs what the change reaches. A tooling test a change reaches stays: #3172 changed
    tools/fixer, its PR never ran Windows, and test/tooling/ci/fixer-loop.test.js was red on main 12 times."""
    stage = (folder, [node, 'scripts/stage.mjs'])
    if picked == 'all':
        return [stage, (folder, [node, *desktop_test_flags(folder), *_app_tests().desktop_glob()])]
    if not picked:
        return []
    if sum(len(p) + 1 for p in picked) > WINDOWS_ARGS_BUDGET:
        # Why (5 Nov 2026, Gitar on #3256): Windows' CreateProcess caps a command line at 32,767 characters (the full run uses globs for that reason, tools/app-tests.py); a long pick is every
        # non-tooling test by glob plus the tooling tests it reached, a superset of the pick.
        return [stage, (folder, [node, *desktop_test_flags(folder), *_app_tests().desktop_glob(), *[p for p in picked if p.startswith('test/tooling/')]])]
    return [stage, (folder, [node, *desktop_test_flags(folder), *picked])]


def commands(area, fast, node, npm, picked='all', app_only=False):
    """picked: 'all' or the list of this area's test files/modules to run (everything else is left to CI)."""
    if app_only and area == 'desktop' and picked != 'all':
        return desktop_app_only(ROOT / 'desktop', node, picked)
    if area == 'python':
        if picked != 'all':
            return [(ROOT, [sys.executable, 'tools/py-shards.py', *picked])] if picked else []
        if os.environ.get('JOBADABRA_PY_SERIAL'):      # the old single-process run, to compare with the shards
            return [(ROOT, [sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-q'])]
        return [(ROOT, [sys.executable, 'tools/py-shards.py', *(['--app-only'] if app_only else [])])]
    folder = ROOT / AREA_DIR.get(area, area)
    if picked != 'all':
        pre = {'desktop': [(folder, [node, 'scripts/stage.mjs']), (folder, [npm, 'run', 'lint'])],
               'worker': [(folder, [node, 'scripts/stage-shared.mjs'])]}.get(area, [])
        return pre + ([(folder, [node, *(desktop_test_flags(folder) if area == 'desktop' else ['--test']), *picked])] if picked else [])
    if app_only and area == 'desktop':
        return desktop_app_only(folder, node)
    if fast and area == 'desktop':
        return [(folder, [node, 'scripts/stage.mjs']),
                (folder, [npm, 'run', 'lint']),
                (folder, [node, '--test', 'test/unit/main/lifecycle.test.js', 'test/unit/main/app-scenarios.test.js', 'test/unit/main/session-contracts.test.js', 'test/guards/rules/ipc.test.js', 'test/unit/main/codemap.test.js'])]
    return [(folder, [npm, 'test'])]


def clean_install(npm, env):
    """--clean-install: `npm ci` of each lockfile in a temporary folder; 0 when all install, else 1 (a pure move out of main)."""
    for area in [a for a in ('desktop', 'worker') if (ROOT / AREA_DIR.get(a, a)).is_dir()]:
        folder = ROOT / AREA_DIR.get(area, area)
        with tempfile.TemporaryDirectory(prefix='jobadabra-check-') as scratch:
            for name in ('package.json', 'package-lock.json'):
                shutil.copyfile(folder / name, Path(scratch) / name)
            print(f'check: {area} clean npm ci', flush=True)
            result = subprocess.run([npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=scratch, env=env, check=False)
            if result.returncode:
                print(f'check: {area} clean install failed', file=sys.stderr)
                return 1
    return 0


def print_plan(args):
    """`--plan`: print how many desktop test files this run would run (a count, or `all`) and nothing else on stdout; a workflow skips its installs when it is 0."""
    plan = affected(args.affected_from) or {}
    picked = plan.get('desktop', 'all')
    if picked == 'all' and args.affected_from:   # a picker outage must not look like a chosen full run
        reasons = plan.get('reasons') or {}
        print(f'check: plan: every test ({reasons.get("desktop") or reasons.get("all") or "the picker gave no answer"})', file=sys.stderr)
    # Why (5 Nov 2026, owner: "Yes: reached tests, every PR"): a PR whose change reaches no desktop test ends its Windows job green in seconds, before the install.
    print(picked if picked == 'all' else len(picked))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--area', choices=AREAS, action='append', help='repeat to select suites; default: all')
    parser.add_argument('--app-only', action='store_true', help='python, desktop: leave out the tests of the repo\'s own tooling (tools/app-tests.py; the release pipeline\'s unit legs); other areas ignore it')
    parser.add_argument('--fast', action='store_true', help='desktop lint and focused lifecycle/contract checks (default area: desktop)')
    parser.add_argument('--affected-from', metavar='REF', help='local pushes: run only the tests this change (HEAD vs REF) can break; without it everything runs, as on CI')
    parser.add_argument('--plan', action='store_true', help='print how many desktop test files this run would run (a number, or "all") and stop: a workflow skips its installs when it is 0')
    parser.add_argument('--clean-install', action='store_true', help='verify desktop and Worker lockfiles in temporary folders before checks')
    args = parser.parse_args(argv)
    areas = args.area or (['desktop'] if args.fast else list(AREAS))
    if args.plan:
        return print_plan(args)
    if sys.version_info < (3, 12):
        print('check: Python 3.12+ is required.', file=sys.stderr)
        return 2
    env = dict(os.environ)
    env['JOBADABRA_DISABLE'] = 'mail,notion,telegram,google_jobs'
    # Match CI even when the developer's global npm config skips peer dependencies.
    env['npm_config_legacy_peer_deps'] = 'false'
    node = npm = None
    try:
        if args.clean_install or any(area != 'python' for area in areas):
            node, version = find_node()
            env['PATH'] = str(Path(node).parent) + os.pathsep + env.get('PATH', '')
            npm = shutil.which('npm', path=env['PATH'])
            if not npm:
                raise RuntimeError('npm is missing beside the supported Node runtime.')
            print(f'check: Node {version}', flush=True)
        print(f'check: Python {sys.version.split()[0]}', flush=True)
        for area in areas:
            package = json.loads((ROOT / AREA_DIR.get(area, area) / 'package.json').read_text()) if area != 'python' else {}
            needs_modules = bool(package.get('dependencies') or package.get('devDependencies'))
            where = AREA_DIR.get(area, area)
            if needs_modules and not (ROOT / where / 'node_modules').is_dir():
                raise RuntimeError(f'{where}/node_modules is missing. Use tools/worktree.sh or run npm ci in {where}/.')
            if area == 'desktop' and not (ROOT / 'desktop/node_modules/eslint').exists():
                raise RuntimeError('Desktop dependencies are outdated: run npm ci in desktop/.')
    except RuntimeError as error:
        print(f'check: {error}', file=sys.stderr)
        return 2
    if args.clean_install and clean_install(npm, env):
        return 1
    failed = []
    plan = affected(args.affected_from)
    for area in dict.fromkeys(areas):
        started = time.monotonic()
        picked = plan.get(area, 'all') if plan else 'all'
        reason = (plan or {}).get('reasons', {}).get(area) or (plan or {}).get('reasons', {}).get('all')
        print(f'check: {area} started' + (f' (every test: {reason})' if picked == 'all' and reason else '' if picked == 'all' else f' ({len(picked)} test files: what this change reaches, its mentions, guards and tree scanners; main runs every test)'), flush=True)
        for folder, command in commands(area, args.fast, node, npm, picked, args.app_only):
            try:
                result = subprocess.run(command, cwd=folder, env=env, check=False)
            except OSError as error:
                print(f'check: could not launch {area}: {error}', file=sys.stderr)
                failed.append(area)
                break
            if result.returncode:
                failed.append(area)
                break
        print(f'check: {area} {"FAILED" if area in failed else "passed"} ({time.monotonic() - started:.1f}s)', flush=True)
    if failed:
        print('check: reproduce with tools/check.sh ' + ' '.join(f'--area {area}' for area in failed), file=sys.stderr)
        return 1
    print('check: all selected checks passed', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
