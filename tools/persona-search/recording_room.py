"""Whether the AI broker's lane has room for one Find jobs recording, read from the broker's public /health counts.

Why (8 Nov 2026, coordinator mac-9d: "A tape with a refused call must fail its own recording, never be kept"; Gitar on #3589): a recording that starts without room is cut by
refused calls after ~300 calls are spent, so it starts only when the broker says its lane's line, the Codex week and today's calls, and they leave room. An unread count is no room.
The lines come from /health `lines` (the owner's limits of 8 Nov 2026: "codex up to 100%, Claude up to 90%"); a broker from before that field has byhand at 100% and 800 a day.
Why (8 Nov 2026, owner via mac-9d: "One at a time, now, Codex then Claude (Recommended)"; web #492 lets every lane reach Claude under its 90% line): the lane has room when
Codex or Claude has it. Claude's 7-day percent is `lines.claudeWeek.usedPercent` (web #493), else the CLI window `chain[claude].limits.sevenDay` (a 0..1 fraction, as the
broker's claudeWeekPercent reads it). The broker treats a reported null (never read, or the window reset) as allowed, so does this; a broker that reports neither is no Claude room.
Usage: curl -fsS <broker>/health | python3 tools/persona-search/recording_room.py <lane> [need_pct] [need_calls]   (exit 0 = room, 1 = no room)
"""
import json
import sys
import time

OLD_BROKER_LINES = {'week': {'byhand': 100}, 'daily': {'byhand': 800}}   # the broker deployed before /health said its lines (web #489)


def claude_week(health, now):
    """Claude's 7-day used percent as the broker reads it: (known, percent or None). known False = the broker says nothing about it (no Claude room)."""
    lines = health.get('lines') or {}
    if 'claudeWeek' in lines:
        used = (lines.get('claudeWeek') or {}).get('usedPercent')
        return True, used if isinstance(used, (int, float)) else None
    claude = next((e for e in health.get('chain') or [] if isinstance(e, dict) and e.get('name') == 'claude'), None)
    if not claude or not claude.get('configured') or 'limits' not in claude:
        return False, None
    week = (claude.get('limits') or {}).get('sevenDay') or {}
    used, resets = week.get('utilization'), week.get('resetsAt')
    if not isinstance(used, (int, float)) or not 0 <= used <= 1 or not isinstance(resets, (int, float)) or resets <= now:
        return True, None   # the broker's claudeWeekPercent: unknown or reset, Claude may start
    return True, round(used * 1000) / 10


def room(health, lane, need_pct=4, need_calls=300, now=None):
    """Takes the /health JSON, a lane and the recording's need; returns (ok, line said in the job log).
    Invariants: room = the lane's day cap has room AND (Codex or Claude has room); a count it cannot read gives that engine no room."""
    now = time.time() if now is None else now
    lines = health.get('lines') or OLD_BROKER_LINES
    week = (lines.get('week') or {}).get(lane)
    cap = (lines.get('daily') or {}).get(lane)
    used = (health.get('limits') or {}).get('usedPercent')
    today = (health.get('daily') or {}).get(lane)
    claude_line = lines.get('claude')
    known, claude_used = claude_week(health, now)
    if cap is not None and not isinstance(today, int):
        return False, f"the broker does not say today's {lane} calls: no recording without it"
    codex = f'{used}% of its {week}% line' if isinstance(used, (int, float)) and isinstance(week, (int, float)) else 'unknown'
    claude = ('unknown' if not known or not isinstance(claude_line, (int, float)) else
              f"{'not read yet (allowed)' if claude_used is None else f'{claude_used}%'} of its {claude_line}% line")
    said = (f"lane {lane}: Codex week {codex}; Claude week {claude}; calls today {today if cap is not None else '-'}"
            f"{'' if cap is None else f' of {cap}'}; this recording needs ~{need_pct}% and ~{need_calls} calls")
    if cap is not None and cap - today < need_calls:
        return False, f'{said}. Only {cap - today} {lane} calls left today (UTC): record this persona another day'
    codex_room = codex != 'unknown' and used + need_pct <= week
    claude_room = claude != 'unknown' and (claude_used is None or claude_used + need_pct <= claude_line)
    if codex_room:
        return True, f'{said}. Codex has room'
    if claude_room:
        return True, f'{said}. Codex has no room; Claude has'
    if codex == 'unknown' and claude == 'unknown':
        return False, f'{said}. The broker does not say the Codex or the Claude week: no recording without them'
    return False, f'{said}. Neither Codex nor Claude has ~{need_pct}% left under its line: no room on the {lane} lane today'


if __name__ == '__main__':
    lane = sys.argv[1]
    try:
        health = json.load(sys.stdin)
    except ValueError:
        print("::error::the broker's counts could not be read: no recording without them")
        sys.exit(1)
    ok, said = room(health, lane, *(float(a) if '.' in a else int(a) for a in sys.argv[2:4]))
    print(said if ok else f'::error::{said}')
    sys.exit(0 if ok else 1)
