"""Where the person may work without a visa, as the engine reads it: Profile → Work eligibility, the one owner (owner, 12 Nov 2026, #3850: "Work rights
doesn't really make sense. They should be only in the Profile"). The app writes config/work-rights.json from the Profile (desktop/lib/work-rights.js);
an install that has not written it yet keeps reading the older Strategy list (preferences.work_rights), so no right is lost before the one-time move.
Readers: src/ai/place_triage.py (the visa question), src/digest.py (the "visa sponsorship needed" flag). Guarded by tests/unit/ai/test_work_rights.py."""
import json

from . import paths


def load(config=None):
    """{'work_rights': [words], 'permit_zones': [zone labels], 'unread': [older Profile lines]} from the Profile's file, else the older Strategy list."""
    config = config or paths.CONFIG   # read at call time: a test's (or a run's) patched src.paths.CONFIG holds
    try:
        kept = json.loads((config / 'work-rights.json').read_text(encoding='utf-8'))
        return {key: [str(each) for each in kept.get(key) or []] for key in ('work_rights', 'permit_zones', 'unread')}
    except (OSError, ValueError, AttributeError):
        pass
    try:
        older = json.loads((config / 'preferences.json').read_text(encoding='utf-8')).get('work_rights') or []
    except (OSError, ValueError, AttributeError):
        older = []
    return {'work_rights': [str(each) for each in older], 'permit_zones': [], 'unread': []}


def words(rights, own_places):
    """The rights as the place AI reads them. A permit zone clears only the countries of the person's own search places (owner, 12 Nov 2026, asked via
    AskUserQuestion: a Swiss permit gives no right to work in Germany), so it is said with those places, never as the whole zone; no own places, no word."""
    # Why (#3862 review): the cap holds the plain words only; capped after, a person open in a whole zone lost the permit sentence
    out = (list(rights.get('work_rights') or []) + list(rights.get('unread') or []))[:10]
    if own_places:
        out += [f'a work permit in {zone}, valid only in the country of: {", ".join(own_places[:5])}' for zone in rights.get('permit_zones') or []]
    return out
