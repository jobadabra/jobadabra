"""Checks that a PR description is laid out by tools/pr-body-format.py (owner, 16 Oct 2026: "this PR description missed our rules: didn't add separators,
didn't use headings"). #1043's body was replaced with `gh pr edit --body-file` on a raw summary, which skips the formatter that tools/ship.sh runs.
Reads the body on stdin; exit 1 naming what is missing. With `--base <ref>` (jobadabra's own pr-gate.yml and tools/ship.sh) it also asks the Find jobs admission line (moves_gap). Run by the step "PR description laid out" of .github/workflows/pr-gate.yml on every opened, pushed or edited PR. Guard: tests/tooling/ci/test_pr_images.py."""
import importlib.util
import os
import re
import subprocess
import sys

FIX = 'lay it out with tools/pr-body.sh <base> --body=<summary> (ship.sh does it), never a raw `gh pr edit --body-file`'


def missing(body, images=False):
    """The layout gaps of a PR body, as sentences. images=True also fetches every image URL (tools/pr-screens.py: a non-200 answer is a gap, no answer only a stderr note)."""
    lines = [line for line in body.replace('\r\n', '\n').split('\n')]
    first = next((line for line in lines if line.strip()), '')
    out = []
    if not first.startswith('## '):
        out.append('the verdict line is not a "## " heading')
    if not any(re.match(r'^-{3,}\s*$', line) for line in lines):
        out.append('no "---" separator between sections')
    if not any(line.startswith('### ') for line in lines):
        out.append('no "### " section heading (Impact, What changed, Before → After)')
    spec = importlib.util.spec_from_file_location('pr_screens', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pr-screens.py'))
    screens = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(screens)
    out += screens.problems(body)   # every image in a | What changed | Before | After | row (tools/pr-screens.py)
    if images:
        errors, notes = screens.image_report(body)   # every image URL answers 200; an unreachable one is only a note
        out += errors
        for note in notes:
            print('pr-description: ' + note, file=sys.stderr)
    return out


TAG_FIX = 'the title starts with the opening session\'s tag, e.g. "[75] Fix the thing": tools/ship.sh adds it (re-run it), or `gh pr edit <n> --title "[xx] <title>"`'


def title_gap(title):
    """21 Oct 2026: site#18 and #19 had no "[xx] " tag (opened or retitled by hand). PR_TITLE is set by pr-gate.yml / the site's tests.yml (empty for a bot's PR: no check)."""
    return None if not title or re.match(r'^\[[^\]]+\] \S', title) else f'the PR title "{title}" has no "[xx] " session tag: {TAG_FIX}'


# The files that decide what Find jobs reads, keeps, scores or orders (the finish-line spec, guardrail G4), and the ones that write its words and places before it reads.
# Why (13 Nov 2026, owner via sa: "let's close these gaps"): the strategy draft (desktop/lib/strategy*.js), the place reader (src/places.py, src/fragment_words.py), the board ideas
# (src/ai/board_ideas.py) and the search settings (src/notion/search_settings.py) change what a first search asks; #2977 (places.py) and #3857 (strategy places) changed it unmeasured.
SEARCH_FILES = re.compile(r'^(src/(sources/|press/|first_jobs\.py$|daily_search[^/]*\.py$|ai/(place_triage|title_triage|slots|board_ideas)\.py$|(ai/)?(time_budget|job_rank)\.py$'
                          r'|places\.py$|fragment_words\.py$|notion/search_settings\.py$)|desktop/lib/strategy(-draft[^/]*)?\.js$)')
# Why (lanes 4a, owner, 11 Nov 2026, asked via AskUserQuestion: "Accept your measure (Recommended)"): a move from saved runs (before) to the owner's
# chosen after-run is also a measure: `(<N> saved runs before, <M> run(s) after)`, its after-number `pending` while that run runs (the pair's row holds the PR's "All checks passed" until then, tools/pr_verdict_pair_gate.py).
# Why (12 Nov 2026, owner, quoted by coordinator sa: "Let's do only 1 live search before and after. not 3 (which are 6)"): a search PR's live proof is one search a side, started in the same minute, with the person's usual run-to-run difference beside it;
#   more runs a side with their spread still pass, and since 13 Nov its after-number may read `pending` until its pair writes it, as the saved-runs form above.
# Why (13 Nov 2026, sa's search-pair design): a person is a night person (p3) or one of the 30 profiles (b02, search-profiles.json); a profile has no night levels, so its
#   usual difference reads "not measured yet" (tools/persona-search/pair.py table); an after-number may be `pending` while its pair has not run: a ready PR may say so, because the pair's own row decides "All checks passed" (14 Nov 2026, the old pending_gap draft rule is gone).
PERSON = r'(?:p\d{1,2}|[a-z]\d{2})'
MOVES = re.compile(r'^\s*[-*]?\s*\**Moves:\**\s*(?:' + PERSON + r'\s+\S.*\d\S*\s*(?:→|->)\s*(?:\S*\d\S*|pending)\s*\([1-9]\d* runs? a side,[^)]*?\b(?:spread|usual difference)\s+(?:[^)\s]*\d|not measured yet)[^)]*\)'
                   r'|' + PERSON + r'\s+\S.*\d\S*\s*(?:→|->)\s*(?:\S*\d\S*|pending)\s*\([1-9]\d* saved runs? before, [1-9]\d* runs? after\b[^)]*\)'
                   r'|nothing\s*\([^)<>]*\w[^)<>]*\))', re.M)
MOVES_FIX = ('add a line `Moves: p<n> <number> <before> → <after> (1 run a side, same minute, usual difference <d>)` (the person, the number it moves, one search before and one after started in the same minute, and that person\'s usual run-to-run difference: a larger loss holds the PR, a gain needs its mechanism proven by a test), '
             '`Moves: p<n> <number> <before> → <after or pending> (<N> saved runs before, <M> run(s) after)` for a measure the owner chose, '
             'or `Moves: nothing (<why>)` for a change no person feels; skill check-job-search-locally step 10, spec docs/superpowers/specs/2026-11-10-find-jobs-finish-line.md')


def moves_gap(body, changed):
    """Find jobs admission line (owner, 10 Nov 2026, finish line, guardrail G4): a PR that changes a search file says which person and number it moves, one search a side (owner, 12 Nov 2026), or that it moves nothing.
    Why (10 Nov 2026, sa): 246 of 647 PRs in 30 days changed the search engine and each was graded by its author on one run (4 claims withdrawn on 10 Nov alone); ±10 jobs of spread per person hides any single run."""
    hit = sorted(f for f in changed if SEARCH_FILES.match(f))
    if not hit or MOVES.search(body or ''):
        return None
    return f'this PR changes search files ({", ".join(hit[:3])}{", ..." if len(hit) > 3 else ""}) but the body has no "Moves:" line: {MOVES_FIX}'


def changed_files(base):
    """The files this PR changes against `base` (from the merge base, so main moving on is not this PR's change), None when git cannot say (the caller refuses)."""
    try:
        start = subprocess.run(['git', 'merge-base', base, 'HEAD'], capture_output=True, text=True, check=True).stdout.strip() or base
        return subprocess.run(['git', 'diff', '--name-only', start, 'HEAD'], capture_output=True, text=True, check=True).stdout.split()
    except (subprocess.CalledProcessError, OSError):
        return None


STEP = re.compile(r'^\[[^\]]+\] (\d+)/(\d+) \S')
PLAN_ROWS = ('Done', 'This PR', 'Left')


def plan_gap(title, body):
    """A PR from a plan says where the plan stands. Why (owner, 28 Oct 2026, relayed by fl): "When we follow a plan, we should know from the beginning the name
    of the PRs, and we should show in the PR title 2/5 or 3/5... Also, we should have a short section in the PR body describing the overall progress on the plan.
    What's done, what's left." A title "[xx] n/N <what>" needs the "Plan progress" block of tools/pr-body-template.md: the plan's path and Done / This PR / Left rows."""
    step = STEP.match(title or '')
    if not step:
        return None
    n, total = int(step.group(1)), int(step.group(2))
    if not 1 <= n <= total:
        return f'the title says {n}/{total}: n must be between 1 and N'
    if 'Plan progress' not in body:
        return f'the title says {n}/{total} but the body has no "Plan progress" block (tools/pr-body-template.md)'
    gaps = [row for row in PLAN_ROWS if not re.search(rf'^\|[^|\n]*\b{row}\b[^|\n]*\|', body, re.M)]
    if not re.search(r'docs/superpowers/(plans|specs)/\S+\.md', body):
        gaps.append('the plan\'s path (docs/superpowers/plans/... or the spec with its PR list)')
    return f'"Plan progress" is missing: {", ".join(gaps)} (tools/pr-body-template.md)' if gaps else None


if __name__ == '__main__':
    text = sys.stdin.read()
    gaps = missing(text, images=True)
    gap = title_gap(os.environ.get('PR_TITLE', '').strip()) or plan_gap(os.environ.get('PR_TITLE', '').strip(), text)
    if gap:
        print('pr-title: ' + gap, file=sys.stderr)
        sys.exit(1)
    if '--base' in sys.argv[1:]:
        base = (sys.argv[sys.argv.index('--base') + 1:] or [''])[0]
        files = changed_files(base) if base else None
        # Why (Gitar on #3704, 11 Nov 2026): the caller asked for the admission check, so no answer from git is a refusal, never a silent pass (a shallow clone, a stale origin/main)
        admission = moves_gap(text, files) if files is not None else f'could not read the changed files against {base or "(no base given)"}, so the "Moves:" line was not checked: fetch the base and run again'
        if admission:
            print('pr-description: ' + admission, file=sys.stderr)
            sys.exit(1)
    if gaps:
        print('pr-description: ' + '; '.join(gaps) + ': ' + FIX, file=sys.stderr)
        sys.exit(1)
    print('pr-description: laid out (headings and separators)')
