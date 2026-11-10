"""The web search's answer, saved the moment its call returns and before the boards are judged (src/sources/board_web.py is the only user).
Why (E2b, 8 Nov 2026, persona 18's chain): the call returned at 115 s, judging needed ~30 s more, the run ended at 135 s and the paid answer was lost.
Tests: tests/unit/sources/test_web_search_kept.py."""
import json
import threading
from datetime import datetime, timedelta

RAW_HOURS = 24  # the web search's answer, saved before it is judged, waits this long for a search to judge it (a day: no judged stamp rests less, bar the very next run)

_lock = threading.Lock()


def _file():
    from ..paths import DATA
    return DATA / 'web_raw.json'


def _all():
    try:
        everything = json.loads(_file().read_text())
    except (OSError, ValueError):
        return {}
    return everything if isinstance(everything, dict) else {}


def name(key, places):
    """What a saved answer is for: the search's key (countries, roles, kinds) and its place words, so another strategy never takes it."""
    return key + '|' + ','.join(sorted(places))


def _fresh(entry, now):
    try:
        return now - datetime.fromisoformat(entry['at']) < timedelta(hours=RAW_HOURS)
    except (KeyError, TypeError, ValueError):
        return False


def keep(label, boards, at):
    """The boards the web search named, saved the moment its call returns, before they are judged; `at` is the search's own clock (its `now`), returned. Why (E2b,
    8 Nov 2026, persona 18's chain: the call returned at 115 s, judging needed ~30 s more, the run ended at 135 s and the answer was lost; run 2 paid
    ~116 s for it again): ASKED -> ANSWERED (here) -> JUDGED (search: the ideas and `web_used[key] = at`) -> READ NEXT RUN. Its own file, board_web
    the only writer: found_boards.read saves its copy of found_boards.json whole and would drop it. A failed write is said and never discards the answer."""
    from ..paths import write_whole
    try:
        with _lock:
            everything = {key: entry for key, entry in _all().items() if _fresh(entry, at)}
            everything[label] = {'at': at.isoformat(timespec='seconds'), 'boards': boards}
            _file().parent.mkdir(parents=True, exist_ok=True)
            write_whole(_file(), json.dumps(everything, ensure_ascii=False))
    except Exception as error:  # noqa: BLE001 — the answer is judged now; only the next run loses its copy
        print(f'Job boards: the web search answer could not be saved ({type(error).__name__})', flush=True)
    return at


def take(label, now, used):
    """(boards, time) of an earlier web search's answer for this key that no judged run has used yet, or None. `used` is found_boards.json's
    web_used[key], the time of the last answer a search judged (search sets it with the ideas, and it is saved with them): an answer judged in a run
    that ended before those reached the disk is taken again, and one that reached it is not (nothing is dropped before that is durable)."""
    entry = _all().get(label)
    if not isinstance(entry, dict) or not _fresh(entry, now) or not isinstance(entry.get('boards'), list):
        return None
    at = datetime.fromisoformat(entry['at'])
    return None if used == entry['at'] else (entry['boards'], at)
