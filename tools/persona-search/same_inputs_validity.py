"""Is a same-inputs pair valid? The pure classification of each side's failed calls (the "Technical:" lines contract.detail writes), used by same_inputs_report.py.
Why (14 Nov 2026, sa, owner's pair rule): a failed call whose text starts with the engine's clock-rule words (cli_base.CLOCK_UP) is the press clock's own drop, counted per side and flagged only when the sides differ by more than 3; any other failed call, or one with no text, makes the pair NOT VALID."""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from src.ai.providers.cli_base import CLOCK_UP  # noqa: E402
from src.ai.providers.contract import TEXT_MARK  # noqa: E402

TECHNICAL = re.compile(r'^(\[\d+s\] )?Technical: ')   # contract.detail's line starts so, after the log's own "[12s] " prefix; a page or model text quoting the words is not one
GAP = 3   # clock-rule drops that may differ between the sides before the pair is flagged


def text_of(line):
    """The error text a Technical line carries after TEXT_MARK, or None when the line has none (a build without the capture)."""
    _, mark, text = line.partition(TEXT_MARK)
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
