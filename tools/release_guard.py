#!/usr/bin/env python3
"""Only a desktop-v* release can be Latest (stable): re-point GitHub's "Latest" when something else holds it, and alert on Telegram.

    python3 tools/release_guard.py            # repair Latest, tell the owner (the switchboard, then TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)
    python3 tools/release_guard.py --dry-run  # print the plan only

Why (17 Oct 2026): a PR-screenshot release was created as a normal release, GitHub made it Latest, and for ~1h20m the website's Download link and the
updater's releases/latest pointed at screenshots. The pick of "stable" is now always among desktop-v* tags (`is_desktop`), never isLatest alone.
Run hourly by release-guard.yml. Guarded by tests/tooling/release/test_release_guard.py.
"""
import http.client
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src.repos import PUBLIC_REPO  # noqa: E402

REPO = PUBLIC_REPO
DESKTOP = re.compile(r'^desktop-v\d')


def is_desktop(tag):
    return bool(DESKTOP.match(tag or ''))


def desktop_only(releases):
    """The releases a stable/beta/build decision may look at: desktop-v* tags only."""
    return [r for r in releases if is_desktop(r.get('tagName'))]


def _key(tag):
    core, _, pre = tag[len('desktop-v'):].partition('-')
    return tuple(int(x) if x.isdigit() else 0 for x in core.split('.')), (0 if pre else 1)


def plan(releases):
    """-> {'strangers': every release whose tag is not desktop-v* (the list must show desktop builds only; deleting is the owner's), 'latest': tag that holds Latest or None, 'repoint': desktop tag to make Latest or None, 'demote': [non-desktop tags that are normal releases]}.
    Latest is healthy when a desktop-v* release holds it; otherwise the newest published non-pre-release desktop-v* release gets it back."""
    live = [r for r in releases if not r.get('isDraft')]
    latest = next((r['tagName'] for r in live if r.get('isLatest')), None)
    stable = sorted((r['tagName'] for r in live if is_desktop(r['tagName']) and not r.get('isPrerelease')), key=_key, reverse=True)
    repoint = None if is_desktop(latest) or not stable else stable[0]
    return {'latest': latest, 'repoint': repoint,
            'demote': [r['tagName'] for r in live if not is_desktop(r['tagName']) and not r.get('isPrerelease')],
            'strangers': [r['tagName'] for r in live if not is_desktop(r['tagName'])]}


def _gh(*args):
    return subprocess.run(['gh', *args], capture_output=True, text=True, check=True).stdout


SITE = os.environ.get('JOBADABRA_SITE', 'https://www.jobadabra.top')


def _post_switchboard(body):
    """POST to the owner's switchboard (jobadabra-web /ops/notify) -> its JSON answer, or None when it cannot be reached or answers anything but a clear 200."""
    key = os.environ.get('SELFHEAL_PUBLISH_KEY')
    if not key:
        return None
    request = urllib.request.Request(f'{SITE}/ops/notify', json.dumps(body).encode(), {'Content-Type': 'application/json', 'Authorization': f'Bearer {key}', 'User-Agent': 'jobadabra-ci'})   # a named client: the default Python-urllib one is what Cloudflare rules like to block
    try:
        with urllib.request.urlopen(request, timeout=10) as answer:
            parsed = json.loads(answer.read()) if answer.status == 200 else None
            return parsed if isinstance(parsed, dict) else None   # a 200 that is a list or a string is a proxy page, not the switchboard
    except (OSError, ValueError, http.client.HTTPException):   # Why (5 Nov 2026, nt 3/4e): fail-open. Any trouble reaching the switchboard means the old bot below sends the alert; this never raises.
        return None


def _tell(text):
    """Tells the owner: the switchboard first (event release-guard: the owner's on/off, "when" and bot), the CI-alerts bot when it cannot deliver; always prints it."""
    print(text)
    answer = _post_switchboard({'event': 'release-guard', 'text': text, 'level': 'problem'})
    if answer and (answer.get('sent') is True or (answer.get('sent') is False and answer.get('why'))):
        return   # sent, or held on purpose by the owner's switch: done
    token, chat = os.environ.get('TELEGRAM_BOT_TOKEN'), os.environ.get('TELEGRAM_CHAT_ID')
    if token and chat:
        data = urllib.parse.urlencode({'chat_id': chat, 'text': text}).encode()
        urllib.request.urlopen(f'https://api.telegram.org/bot{token}/sendMessage', data, timeout=20).read()
        _post_switchboard({'event': 'release-guard', 'fallback': True})   # Admin shows "sent without switchboard"


def main(argv):
    dry = '--dry-run' in argv
    releases = json.loads(_gh('release', 'list', '-R', REPO, '-L', '60', '--json', 'tagName,isPrerelease,isDraft,isLatest'))
    found = plan(releases)
    if is_desktop(found['latest']) and not found['strangers']:
        print(f"ok: Latest is {found['latest']}")
        return 0
    notes = []
    if not is_desktop(found['latest']):
        notes.append(f"Latest is {found['latest']!r}, not a desktop release; " + (f"re-pointing it to {found['repoint']}" if found['repoint'] else 'no stable desktop release to re-point to'))
        if found['repoint'] and not dry:
            _gh('release', 'edit', found['repoint'], '-R', REPO, '--latest')
    for tag in found['demote']:
        notes.append(f'{tag} is a normal release, not a desktop build: made a pre-release')
        if not dry:
            _gh('release', 'edit', tag, '-R', REPO, '--prerelease', '--latest=false')
    if found['strangers']:   # 24 Oct 2026: "it should be only desktop app releases"; the guard names them, the owner deletes them
        notes.append('not desktop releases, to be deleted by the owner (keep the tag): ' + ', '.join(found['strangers']))
    _tell('⚠️ Release guard: ' + '; '.join(notes))
    return 0 if found['repoint'] or is_desktop(found['latest']) else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
