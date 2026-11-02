#!/usr/bin/env python3
"""Make the release list readable: every release's title says what it IS.

    python3 tools/sync_release_labels.py            # relabel the releases
    python3 tools/sync_release_labels.py --dry-run  # print what would change

Titles get a prefix (GitHub has no way to pin a release; the only badge it gives is "Latest"):
    ✅ STABLE · …                  the Latest release: what every user gets
    🧪 BETA (release candidate) · …  a pre-release a platform's release gate approved (`Beta-approved:` or `Beta-approved (Windows):`): offered to people who switched the beta on,
                                   and soaking towards stable
    🔨 Build · …                   any other pre-release (every push and nightly makes one): not offered to anyone
    📦 Previous stable · …         a release that was stable once and was replaced: where a manual rollback goes (tools/release-stable.sh <tag>)
Why (2 Nov 2026, owner: "let's disable this gh issue creation about \"Release channels\".. Its too noisy. and we see this information on the website on telegram"): no pinned issue any more; the site and Telegram show the channels.
Run by canary-promote.yml every 8 hours and after an approval or a promotion; safe to run any time (it only edits what differs).
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from release_guard import desktop_only, is_desktop  # noqa: E402  (only desktop-v* releases are ever stable, 17 Oct 2026)

REPO = os.environ.get('GITHUB_REPOSITORY') or 'jobadabra/jobadabra'   # Why (2 Nov 2026): the old GarryOne/ name made issue lookups come back empty after the org move
STABLE, BETA, BUILD, PREVIOUS = '✅ STABLE', '🧪 BETA (release candidate)', '🔨 Build', '📦 Previous stable'
PREFIX = re.compile(r'^(?:✅ STABLE|🧪 BETA(?: \(release candidate\))?|🔨 Build|📦 Previous stable) · ')


def base_name(name):
    return PREFIX.sub('', name or '')


def state_of(release, approved):
    """'stable' | 'previous' | 'beta' | 'build' for one release (draft releases are left alone by the caller)."""
    if release.get('isLatest') and is_desktop(release.get('tagName')):
        return 'stable'
    if not release.get('isPrerelease'):
        return 'previous'
    return 'beta' if approved else 'build'


def desired_title(release, approved):
    prefix = {'stable': STABLE, 'previous': PREVIOUS, 'beta': BETA, 'build': BUILD}[state_of(release, approved)]
    return f"{prefix} · {base_name(release.get('name') or release['tagName'])}"


def _gh(*args):
    return subprocess.run(['gh', *args], capture_output=True, text=True, check=True).stdout


def main(argv):
    # Why (2 Nov 2026): a `--help` ran the real relabel against GitHub; an unknown flag stops before any call.
    if any(arg != '--dry-run' for arg in argv[1:]):
        print(__doc__)
        return 2
    dry = '--dry-run' in argv
    releases = [r for r in json.loads(_gh('release', 'list', '-R', REPO, '-L', '40', '--json', 'name,tagName,isPrerelease,isLatest,isDraft')) if not r.get('isDraft')]
    releases = desktop_only(releases)   # a screenshot or other release is never relabelled, whatever GitHub calls it
    approved = set()
    for r in releases:
        if r.get('isPrerelease'):
            body = _gh('release', 'view', r['tagName'], '-R', REPO, '--json', 'body', '-q', '.body')
            if re.search(r'^Beta-approved(?: \(Windows\))?:', body, re.M):   # either platform's line: each is offered on its own
                approved.add(r['tagName'])
    changed = 0
    for r in releases:
        want = desired_title(r, r['tagName'] in approved)
        if want != r.get('name'):
            changed += 1
            print(f"{r['tagName']}: {r.get('name')!r} -> {want!r}")
            if not dry:
                _gh('release', 'edit', r['tagName'], '-R', REPO, '--title', want)
    print(f"{changed} title(s) {'would change' if dry else 'changed'}.")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
