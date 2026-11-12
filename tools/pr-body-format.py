"""Lays out a PR summary for GitHub (owner, 15 Oct 2026: "use headings, font sizes, proper spacing; a run number is a link, not plain text").
Reads the session's summary (tools/pr-body-template.md shape) on stdin, prints it with: the verdict as a big heading, Why / Unblocks / Root cause / Design each in its own coloured callout,
a small heading over each block (impact, what changed, before/after, screens), a quiet "No screenshots" line, and every "run <id>" linked
to its Actions run. Lines the CI reads (live-row: ...) and anything already under a heading stay as written. Guard: tests/test_pr_body.py.
Usage: python3 tools/pr-body-format.py <owner/repo or ''> < summary.md"""
import re
import sys

RUN = re.compile(r'(?<![\[/\w])run (\d{8,})\b(?![\]\w])')
DESIGN = re.compile(r'^\*\*Design system \(measured on ([^)]+)\)\*\*[ \t]*(.*)$')   # npm run design-check's first line: the commit, then the verdict (✅ all N rules pass on N screens, or ⛔ N new problems)
HEADINGS = [   # (what starts the block, its heading)
    (re.compile(r'^\|\s*Area\s*\|\s*Impact\b', re.I), '### 📊 Impact'),
    (re.compile(r'^\|\s*What changed\s*\|\s*Before\s*\|\s*After\b', re.I), '### 🖼️ Screens'),   # the screens table (tools/pr-screens.py), before the numbers table
    (re.compile(r'^\|(?!\s*What changed\s*\|)[^|]*\|[^|]*\bBefore\s*\|[^|]*\bAfter\b', re.I), '### 🔍 Before → After'),   # also after style_before_after's emoji headers
    (re.compile(r'^\*\*Plan progress\*\*'), '### 🗺️ Plan progress'),   # a PR titled "[xx] n/N ..." (tools/pr-body-check.py plan_gap)
    (re.compile(r'^- '), '### ✅ What changed'),
    (re.compile(r'^(\*\*Before\*\*|!\[|<img |\|\s*!\[)', re.I), '### 🖼️ Screens'),
]
NOTE = re.compile(r'^\*\*(Why|Unblocks|Root cause|Design):?\*\*:?', re.I)
# Why (owner, 28 Oct 2026: "Why, What it Unblockes and Root cause, should be 3 panels with 3 differnt colors"; 29 Oct 2026: "let Design also be properly formatted with a panel, just like the 2 above"): GitHub alert kinds.
PANEL = {'why': 'NOTE', 'unblocks': 'TIP', 'root cause': 'CAUTION', 'design': 'IMPORTANT'}   # blue, green, red, purple


def panels(note):
    """One GitHub alert per Why / Unblocks / Root cause / Design line, each in its own colour, a blank line between them."""
    out = []
    for line in note:
        out += ['', f'> [!{PANEL[NOTE.match(line).group(1).lower()]}]', '> ' + line]
    return out


def link_runs(line, repo):
    return RUN.sub(lambda m: f'[run {m.group(1)}](https://github.com/{repo}/actions/runs/{m.group(1)})', line) if repo else line


BEFORE_AFTER = re.compile(r'^\|(?!\s*What changed\s*\|)([^|]*)\|\s*Before\s*\|\s*After\s*\|\s*$', re.I)   # not the screens table: its cells are images


def cells(line):
    return [cell.strip() for cell in line.strip().strip('|').split('|')]


def style_before_after(lines):
    """The Before/After table (owner, 15 Oct 2026: "make it more beautiful"): coloured headers, centred values, the label and a changed After in bold,
    an unchanged After marked as such. Only a plain 3-column table is restyled; anything else is left as written."""
    out, at = [], 0
    while at < len(lines):
        line = lines[at]
        if BEFORE_AFTER.match(line) and at + 1 < len(lines) and re.match(r'^\|[\s:|-]+\|$', lines[at + 1].strip()):
            label = cells(line)[0] or 'What'
            out += [f'| 📏 {label} | 🔴 Before | 🟢 After |', '|:---|:---:|:---:|']
            at += 2
            while at < len(lines) and lines[at].startswith('|'):
                row = cells(lines[at])
                if len(row) != 3:
                    out.append(lines[at])
                else:
                    name, before, after = row
                    name = name if not name or name.startswith('**') else f'**{name}**'
                    after = f'↔ {after} <sub>(unchanged)</sub>' if after == before else (after if after.startswith('**') or not after else f'**{after}**')
                    out.append(f'| {name} | {before} | {after} |')
                at += 1
            continue
        out.append(line)
        at += 1
    return out


FOOTER = re.compile(r'^🤖 Generated with (\[Claude Code\]\([^)]*\)|Claude Code)\s*$')
GENERATED = re.compile(r'^(#{2,4} 🧾 Facts|<details><summary>📄 The commit messages?\b)')   # the two blocks tools/pr-body.sh prints after the summary


def drop_generated_tail(lines):
    """The summary without anything tools/pr-body.sh generates: the Facts block and the commit-message block (and everything after the first of them, so every older copy goes too), and every
    "🤖 Generated with Claude Code" line. Why (12 Nov 2026, owner: "we get duplicated footnote on PR bodies"; #3893 had 5 commit blocks): pr-body.sh appends one tail and one footer to the summary file, so a summary that
    already held an old tail (a body fetched back with `gh pr view`) or its own footer line (the attribution reminder asks for one) made a body with several. A body always ends with exactly one of each."""
    cut = next((at for at, line in enumerate(lines) if GENERATED.match(line)), len(lines))
    kept = [line for line in lines[:cut] if not FOOTER.match(line.strip())]
    while kept and kept[-1].strip() in ('', '---'):
        kept.pop()
    return kept


def lay_out(text, repo=''):
    lines = style_before_after(drop_generated_tail(text.rstrip('\n').split('\n')))
    if any(line.startswith('### ') or line.startswith('## ') for line in lines[1:]):
        return '\n'.join(link_runs(line, repo) for line in lines) + '\n'   # the author laid it out already: links only
    out, used, note, first = [], set(), [], True
    for line in lines:
        line = link_runs(line, repo)
        if first and line.strip():
            first = False
            out.append(line if line.startswith('#') else '## ' + line)
            continue
        if NOTE.match(line):
            note.append(line)
            continue
        if note and not line.strip():
            continue
        if note:   # the Why/Unblocks/Root cause/Design lines end: one callout each
            out += panels(note) + ['']
            note = []
        if line.startswith(('No screenshots:', 'No visual:', 'No visible change:')):
            out.append('<sub>📷 ' + line + '</sub>')
            continue
        for start, heading in HEADINGS:
            if heading not in used and start.match(line) and (not out or not out[-1].startswith('|') and not out[-1].startswith('- ')):
                used.add(heading)
                if out and out[-1].strip():
                    out.append('')
                out += ['---', '', heading, '']   # a rule between sections (owner, 15 Oct 2026); the blank line above keeps it a rule, never a setext heading
                break
        design = DESIGN.match(line)
        if design:   # the measured report's bold title becomes its heading, the commit it names and the verdict kept on it (tools/design-table-check.py reads both)
            out += ['---', '', f'### 🎨 Design system (measured on {design.group(1)}) {design.group(2)}'.rstrip(), '']
            continue
        if line.startswith('**Plan progress**'):
            continue
        out.append(line)
    if note:
        out += panels(note)
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(out)).strip('\n') + '\n'


if __name__ == '__main__':
    sys.stdout.write(lay_out(sys.stdin.read(), sys.argv[1] if len(sys.argv) > 1 else ''))
