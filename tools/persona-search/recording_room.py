"""Whether the AI broker's lane has room for one Find jobs recording, read from the broker's public /health counts.

Why (8 Nov 2026, coordinator mac-9d: "A tape with a refused call must fail its own recording, never be kept"; Gitar on #3589): a recording that starts without room is cut by
refused calls after ~300 calls are spent, so it starts only when the broker says its lane's line, the Codex week and today's calls, and they leave room. An unread count is no room.
The lines come from /health `lines` (the owner's limits of 8 Nov 2026: "codex up to 100%, Claude up to 90%"); a broker from before that field has byhand at 100% and 800 a day.
Usage: curl -fsS <broker>/health | python3 tools/persona-search/recording_room.py <lane> [need_pct] [need_calls]   (exit 0 = room, 1 = no room)
"""
import json
import sys

OLD_BROKER_LINES = {'week': {'byhand': 100}, 'daily': {'byhand': 800}}   # the broker deployed before /health said its lines (web #489)


def room(health, lane, need_pct=4, need_calls=300):
    """Takes the /health JSON, a lane and the recording's need; returns (ok, line said in the job log). Invariant: any count it cannot read means no room."""
    lines = health.get('lines') or OLD_BROKER_LINES
    week = (lines.get('week') or {}).get(lane)
    cap = (lines.get('daily') or {}).get(lane)
    used = (health.get('limits') or {}).get('usedPercent')
    today = (health.get('daily') or {}).get(lane)
    if not isinstance(week, (int, float)):
        return False, f'the broker does not say the {lane} lane line: no recording on it'
    if not isinstance(used, (int, float)):
        return False, 'the broker does not say the Codex week: no recording without it'
    if cap is not None and not isinstance(today, int):
        return False, f"the broker does not say today's {lane} calls: no recording without it"
    said = f"lane {lane}: Codex week {used}% of its {week}% line; calls today {today if cap is not None else '-'}{'' if cap is None else f' of {cap}'}; this recording needs ~{need_pct}% and ~{need_calls} calls"
    if used + need_pct > week:
        return False, f'{said}. The Codex week reads {used}%, over {week - need_pct}%: no room on the {lane} lane today'
    if cap is not None and cap - today < need_calls:
        return False, f'{said}. Only {cap - today} {lane} calls left today (UTC): record this persona another day'
    return True, said


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
