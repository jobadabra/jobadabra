"""Is a same-inputs pair valid? The pure classification of each side's failed calls (the "Technical:" lines contract.detail writes), used by same_inputs_report.py.
Why (14 Nov 2026, sa, owner's pair rule): a failed call whose text starts with the engine's clock-rule words (cli_base.CLOCK_UP) is the press clock's own drop, counted per side and flagged only when the sides differ by more than 3; any other failed call, or one with no text, makes the pair NOT VALID."""
import json
import os
import re
import sys
from urllib.parse import urlparse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from src.ai.providers.cli_base import CLOCK_UP  # noqa: E402
from src.ai.providers.contract import TEXT_MARK  # noqa: E402

TECHNICAL = re.compile(r'^(\[[^\]]*\] )*Technical: ')   # contract.detail's line starts so, after any "[12s] "-style log prefixes; a page or model text quoting the words is not one
GAP = 3   # clock-rule drops that may differ between the sides before the pair is flagged


def text_of(line):
    """The error text a Technical line carries after the LAST TEXT_MARK (detail writes it last; a marker inside the facts' provider text is not the start), or None when the line has none.
    Why (14 Nov 2026, Gitar on #4326): the first marker could sit in a provider's `said "..."` text and hand a real fault the clock-rule words."""
    _, mark, text = line.rpartition(TEXT_MARK)
    return text.strip() if mark and text.strip() else None


def classify(lines):
    """lines: {'a': [log lines], 'b': [log lines]} -> {'verdict', 'why', 'counts': {side: {'failed','clock','other','notext'}}, 'shown': [(side, line)]}."""
    counts, shown = {}, []
    for side, side_lines in lines.items():
        failed = [line for line in side_lines if TECHNICAL.match(line)]
        texts = [(line, text_of(line)) for line in failed]
        clock = [line for line, text in texts if text and text.startswith(CLOCK_UP)]
        notext = [line for line, text in texts if text is None]
        other = [line for line, text in texts if text and not text.startswith(CLOCK_UP)]
        counts[side] = {'failed': len(failed), 'clock': len(clock), 'other': len(other), 'notext': len(notext)}
        shown += [(side, line) for line in (other + notext)[:3]]
    empty = [side for side, side_lines in lines.items() if not side_lines]   # a side with no log lines crashed before logging: never 'zero failures'
    faults = bool(empty) or any(c['other'] or c['notext'] for c in counts.values())
    gap = abs(counts['a']['clock'] - counts['b']['clock'])
    verdict = 'NOT VALID' if faults else 'valid, clock-rule gap over %d (flag)' % GAP if gap > GAP else 'valid'
    why = ' (no log lines for side %s)' % ', '.join(side.upper() for side in empty) if empty else ' (text not captured: a build without the same-inputs text capture, cause unknown)' if faults and not any(c['other'] for c in counts.values()) else ''
    return {'verdict': verdict, 'why': why, 'counts': counts, 'shown': shown}


LIVE_ASKS = ('ai_live', 'ai_live_after_wait', 'ai_own_again', 'ai_failed')   # a request this side asked the model itself (the last: it failed)
PAGES_MIN, PAGES_RATIO = 30, 2.0   # a host is flagged when its larger side read at least this many pages and at least this many times the other side's
UNFINISHED = re.compile(r"Job boards: (.+?) still being read at the search's time")
READ_KINDS = ('live', 'shared', 'own_again', 'live_after_wait')   # the shared layer's page rows (src/same_inputs.py _log), not its AI rows


def reads_by_side(rows, sides):
    """rows: {log id: [the shared layer's jsonl rows]}, sides: {'a': id, 'b': id} -> {'a': {host: pages read}, 'b': {...}}; a log of no side is ignored."""
    out = {side: {} for side in sides}
    for side, log_id in sides.items():
        for row in rows.get(log_id, []):
            if row.get('kind') in READ_KINDS and str(row.get('url', '')).startswith('http'):
                host = urlparse(row['url']).netloc
                out[side][host] = out[side].get(host, 0) + 1
    return out


def read_logs(folder):
    """The shared layer's logs kept by same-inputs.mjs in <work>/logs -> {log id: rows}."""
    found = {}
    for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        if name.startswith('log-') and name.endswith('.jsonl'):
            rows = []
            with open(os.path.join(folder, name), encoding='utf-8', errors='replace') as file:
                for line in file:
                    try:
                        rows.append(json.loads(line))
                    except ValueError:   # a run cut mid-write leaves a truncated last row: skipped, never a crash
                        pass
            found[name[4:-6]] = rows
    return found


def page_flags(reads, lines):
    """Where the two searches did not get the same pages: [text, ...], empty when they did.
    A host one side read at least PAGES_MIN pages of and the other less than 1/PAGES_RATIO of that; a board whose read the search's time cut on one side only.
    Why (14 Nov 2026, sa for the owner: "is the same-input pair reporting wrong?"): the same-code control of b01 read 113 pages of one board on one side and 37 on the other and still said valid, because only failed calls were counted."""
    flags = []
    for host in sorted(set(reads['a']) | set(reads['b'])):
        a, b = reads['a'].get(host, 0), reads['b'].get(host, 0)
        if max(a, b) >= PAGES_MIN and max(a, b) >= PAGES_RATIO * min(a, b):
            flags.append(f'{host} read {a} times on A, {b} on B')
    cut = {side: {name for line in lines[side] for group in UNFINISHED.findall(line) for name in group.split(', ')} for side in ('a', 'b')}   # found_boards.py joins the boards left with ', ' in completion order: compare them one by one
    for side, other in (('a', 'b'), ('b', 'a')):
        for name in sorted(cut[side] - cut[other]):
            flags.append(f"{name} still being read at the search's time on {side.upper()} only")
    return flags


def against_spread(difference, spread):
    """'inside' when a pair's difference in a count is no bigger than the person's own same-code spread (a control pair's difference), else 'outside'."""
    return 'inside' if abs(difference) <= abs(spread) else 'outside'


def read_requests(folder):
    """The request texts the shared layer kept (<work>/logs/req/<key>.req) -> {key: text}; a file that cannot be read is skipped, never a failed report."""
    found = {}
    for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        if name.endswith('.req'):
            try:
                with open(os.path.join(folder, name), encoding='utf-8', errors='replace') as file:
                    found[name[:-4]] = file.read()
            except OSError:
                pass
    return found


ASKED_KINDS = ('ai_live', 'ai_shared', 'ai_live_after_wait', 'ai_own_again')   # a request that was asked and answered; a failed ask (ai_failed) is not the same request on the other side


def request_differences(logs, sides, texts, per_side=3, around=40):
    """AI requests only one side asked live (the keys of the log, each once), per side at most `per_side` lines and a count of the rest: [line, ...].
    Each says the first place its text differs from the nearest request of the other side for the same step (the longest shared prefix; the layer keeps the first
    src.same_inputs.KEEP_CHARS of a request, so a difference past it reads as 'at char KEEP_CHARS'), or why that cannot be said (no text kept, no request of that step).
    Why (14 Nov 2026, sa): two same-code sides asked different AI keys and nothing said what differed in the request text."""
    rows = {side: [row for row in logs.get(sides[side], []) if row.get('url', '').startswith('ai-')] for side in ('a', 'b')}
    keys = {side: {row['url'] for row in rows[side] if row.get('kind') in ASKED_KINDS} for side in ('a', 'b')}
    steps = {side: {row['url']: row.get('step', '') for row in rows[side]} for side in ('a', 'b')}
    out = []
    for side, other in (('a', 'b'), ('b', 'a')):
        alone = list(dict.fromkeys(row['url'] for row in rows[side] if row.get('kind') in LIVE_ASKS and row['url'] not in keys[other]))
        for key in alone[:per_side]:
            row = next(r for r in rows[side] if r['url'] == key)
            what = f'{side.upper()} asked live alone: step {row.get("step") or "?"} "{row.get("head", "")}"'
            same_step = [k for k in keys[other] if steps[other].get(k) == row.get('step', '')]
            near = [k for k in same_step if k in texts]
            if key not in texts:
                out.append(f'{what}: request text not kept')
            elif not same_step:
                out.append(f'{what}: {other.upper()} has no request of that step')
            elif not near:
                out.append(f'{what}: {other.upper()} requests of that step have no kept text')
            else:
                lengths = {k: len(os.path.commonprefix([texts[key], texts[k]])) for k in near}
                best = max(lengths, key=lengths.get)
                at, here, there = lengths[best], texts[key], texts[best]
                out.append(f'{what}: first difference at char {at}: {side.upper()} ...{here[max(0, at - 10):at + around]!r} | {other.upper()} ...{there[max(0, at - 10):at + around]!r}')
        if len(alone) > per_side:
            out.append(f'{side.upper()}: {len(alone) - per_side} more asked alone, not shown')
    return out
