"""Checks the screens of a PR description (owner, 17 Oct 2026, on #1290: "Just screens, it's not clear. Let it follow ALWAYS the columns Before/After. And explain what changed.
Basically: where to look."). Every image sits in a table `| What changed | Before | After |`, one row per change: a caption of a few words (what changed, where to look),
the before image, the after image. A new screen has no before: "—" there, and the caption says why. Reads the body on stdin; exit 1 naming each gap.
Every image URL must also load (HTTP 200): `unloaded()` below. Used by tools/pr-body.sh (at ship time) and tools/pr-body-check.py (in CI, so a body edited on GitHub is checked too).
Guard: tests/tooling/ci/test_pr_images.py."""
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

IMAGE = re.compile(r'!\[[^\]]*\]\([^)]+\)|<img\b[^>]*>', re.I)
HEADER = re.compile(r'^\|\s*What changed\s*\|\s*Before\s*\|\s*After\s*\|\s*$', re.I)
ROW_FIX = 'every image sits in a row of | What changed | Before | After |, e.g. | The Availability card says "Start date" under the dropdown | ![before](url) | ![after](url) |'
NO_SIDE = {'', '—', '-', '–'}


URL = re.compile(r'!\[[^\]]*\]\(\s*<?([^)\s>]+)|<img\b[^>]*?\bsrc\s*=\s*["\']?([^"\'\s>]+)', re.I)
URL_FIX = 'copy the URL tools/pr-assets.mjs printed for this image (it reads back the tag it really published under), never retype the tag'
TRIES, TIMEOUT = 3, 10


def image_urls(body):
    """The http(s) URLs of the body's images, once each, in order of appearance."""
    urls = [a or b for a, b in URL.findall(body)]
    return list(dict.fromkeys(url for url in urls if re.match(r'https?://', url, re.I)))


def http_status(url):
    """The final HTTP status of a GET (redirects followed), or None when nothing answered (offline, DNS, timeout, 5xx after the retries): "could not check", never "broken"."""
    for attempt in range(TRIES):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'jobadabra-pr-images'}), timeout=TIMEOUT) as answer:
                return answer.status
        except urllib.error.HTTPError as error:
            if error.code < 500:
                return error.code
        except (urllib.error.URLError, OSError):
            pass
        if attempt < TRIES - 1:
            time.sleep(1 + attempt)
    return None


def unloaded(body, status=http_status):
    """(broken, unchecked): the image URLs that answered something other than 200, and those nothing answered for.
    Why (6 Nov 2026, owner: "some PRs have broken screenshots in the before/after", "actually many of the PRs shows screenshots broken"; chose "Yes, add it now"): three PRs in one week shipped
    404 images because the URL was typed by hand: jobadabra#3321 (a tag equal to its branch name: the URL resolves to the branch), jobadabra-web#450 (v2 shots published under
    pr-assets-hr-28-2, body typed pr-assets-hr-28) and jobadabra-web#420 (real tag pr-assets-em-footer-3, typed pr-assets-em-footer). Nothing checked that an image loads, only where it sits."""
    urls = image_urls(body)
    with ThreadPoolExecutor(max_workers=max(1, min(8, len(urls)))) as pool:
        answers = list(zip(urls, pool.map(status, urls)))
    return [(url, code) for url, code in answers if code is not None and code != 200], [url for url, code in answers if code is None]


def image_report(body, status=http_status):
    """(errors, notes) for the URL check: a broken image is an error naming its URL; an unreachable one only a note (a network blip must not fail a PR)."""
    broken, unchecked = unloaded(body, status)
    errors = [f'the image {url} answers HTTP {code}, so it shows broken in the PR: {URL_FIX}' for url, code in broken]
    notes = [f'could not check {url} (no answer from the network): not reported as broken' for url in unchecked]
    return errors, notes


def cells(line):
    return [cell.strip() for cell in line.strip().strip('|').split('|')]


def problems(body):
    out, in_table = [], False
    for number, line in enumerate(body.replace('\r\n', '\n').split('\n'), 1):
        found = IMAGE.findall(line)
        if HEADER.match(line.strip()):
            in_table = True
            continue
        if not line.strip().startswith('|'):
            in_table = False
        if re.match(r'^\|[\s:|-]+\|$', line.strip()):
            continue
        if not found:
            continue
        if not in_table:
            out.append(f'line {number}: an image outside the screens table: {ROW_FIX}')
            continue
        row = cells(line)
        if len(row) != 3:
            out.append(f'line {number}: a screens row has {len(row)} cells, not 3 (What changed | Before | After): {ROW_FIX}')
            continue
        caption, before, after = row
        if IMAGE.search(caption):
            out.append(f'line {number}: the image is in the "What changed" cell: the caption says what changed and where to look, the images go under Before and After')
            continue
        words = len(re.findall(r'\w+', caption))
        if words < 3:
            out.append(f'line {number}: a screens row has no caption (what changed, where to look): {ROW_FIX}')
        for side, text in (('Before', before), ('After', after)):
            if not IMAGE.search(text) and text not in NO_SIDE:
                out.append(f'line {number}: the {side} cell has neither an image nor "—"')
        if (before in NO_SIDE or after in NO_SIDE) and words < 6:
            out.append(f'line {number}: a row with only one side ("—") needs the reason in its caption (a new screen, a removed one)')
    return out


if __name__ == '__main__':
    text = sys.stdin.read()
    gaps = problems(text)
    if not gaps:   # a layout gap is fixed first; the URLs are fetched only for a body that is laid out
        gaps, notes = image_report(text)
        for note in notes:
            print('pr-screens: ' + note, file=sys.stderr)
    if gaps:
        print('pr-screens: ' + '; '.join(gaps), file=sys.stderr)
        sys.exit(1)
