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
            with open(os.path.join(folder, name), encoding='utf-8') as file:
                found[name[4:-6]] = [json.loads(line) for line in file if line.strip()]
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
    cut = {side: {name for line in lines[side] for name in UNFINISHED.findall(line)} for side in ('a', 'b')}
    for side, other in (('a', 'b'), ('b', 'a')):
        for name in sorted(cut[side] - cut[other]):
            flags.append(f"{name} still being read at the search's time on {side.upper()} only")
    return flags


def against_spread(difference, spread):
    """'inside' when a pair's difference in a count is no bigger than the person's own same-code spread (a control pair's difference), else 'outside'."""
    return 'inside' if abs(difference) <= abs(spread) else 'outside'
