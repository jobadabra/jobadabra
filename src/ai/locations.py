"""The person's places as the fit score reads them (Locations, owner 17 Oct 2026): fixed sentences the engine writes from the search settings (the AI
never writes a place), a fingerprint of their meaning, and the "based on previous preferences" bookkeeping. A change of places applies to FUTURE scores only:
the places are not part of a score's input hash, each new score records the fingerprint it used, older ones are marked (previous), and only an explicit
refresh queues the ACTIVE ones again (refresh). Guarded by tests/guards/data/test_score_locations.py."""
import hashlib
import json
import re

from ..notion.search_settings import readable


# The Profile's place rows (the template's "| Countries | … |", "Preferred cities", "Relocation"; desktop/renderer/preferences-model.js FIELDS editedIn
# 'locations'; and "Home base": Why (12 Nov 2026, owner: "Profile is having Location details in the Your Details. This should be used for filling
# forms.. The location in the strategy, should be only for the search", then via AskUserQuestion "Strategy only")), only in a row's form: a table row whose first cell is the label (Notion writes it without outer pipes, "Countries | …")
# or a "- **Label:** value" bullet. Why (#3850, owner 12 Nov 2026: "I can have one location in profile, but looking for another location in my search
# strategy" · "We should drop/delete the code"): the app hides these rows since 17 Oct and Strategy → Locations owns where the person searches (block
# below), so the scorer never reads them beside it. Why the form (#3857 review): a plain "Relocation: moved the team to Berlin" line is the person's
# own experience and stays.
PLACE_ROW = re.compile(r'^\s*(?:\|?\s*\**\s*(?:countries|preferred cities|relocation|home base)\s*\**\s*\||[-*]\s*\*\*\s*(?:countries|preferred cities|relocation|home base)\s*:?\s*\*\*)', re.I)


def without_place_rows(profile, strategy_block=None):
    """The scoring text without the Profile's older place rows (PLACE_ROW), once Strategy → Locations names a place (strategy_block, default block_now()).
    Why (#3857 review): with no Strategy places the rows are the only place the scorer has, and nothing beside them can conflict, so they stay.
    Only the text the AI reads: a score's input hash still covers the whole scoring text, so dropping these rows re-scores nothing (no paid re-run)."""
    if not (block_now() if strategy_block is None else strategy_block):
        return profile
    return '\n'.join(line for line in (profile or '').splitlines() if not PLACE_ROW.match(line))


def current():
    """The places as the person wrote them (no regions or AI place words added)."""
    from ..paths import load_search_config
    return load_search_config(matching=False)


def _words(fragments):
    out = []
    for fragment in fragments or []:
        word = readable(str(fragment)).strip('"').strip()
        if word and word.lower() not in [each.lower() for each in out]:
            out.append(word)
    return out


def places(search):
    """-> {preferred, acceptable, relocation: yes|no|unspecified, destinations}. No relocation key: yes when places abroad exist (as the crawl reads it)."""
    raw = (search or {}).get('locations') or {}
    abroad = _words(raw.get('abroad'))
    mode = str((raw.get('relocation') or [''])[0]).lower()
    if mode not in ('yes', 'no', 'unspecified'):
        mode = 'yes' if abroad else 'unspecified'
    return {'preferred': _words(raw.get('top_tier')), 'acceptable': _words(raw.get('country_wide')), 'relocation': mode,
            'destinations': [] if mode == 'no' else abroad}


def block(search):
    """The places as sentences for the scoring prompt ('' when none are set)."""
    found = places(search)
    lines = []
    if found['preferred']:
        lines.append(f"Preferred places: {', '.join(found['preferred'])}.")
    if found['acceptable']:
        lines.append(f"Acceptable places: {', '.join(found['acceptable'])}.")
    if found['relocation'] == 'yes' and found['destinations']:
        lines.append(f"Would relocate: yes ({', '.join(found['destinations'])}).")
    elif found['relocation'] == 'no':
        lines.append('Would relocate: no.')
    return '\n\nWhere the candidate wants to work:\n' + '\n'.join(lines) if lines else ''


def fingerprint(search):
    """A short hash of what the places MEAN (order, case, regex spelling and storage do not matter); '' when no place is set."""
    found = places(search)
    if not (found['preferred'] or found['acceptable'] or found['destinations'] or found['relocation'] == 'no'):
        return ''
    meaning = {'preferred': sorted(w.lower() for w in found['preferred']), 'acceptable': sorted(w.lower() for w in found['acceptable']),
               'relocation': found['relocation'], 'destinations': sorted(w.lower() for w in found['destinations'])}
    return hashlib.sha256(json.dumps(meaning, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]


def block_now():
    """block() of the settings as they are now; '' when they cannot be read. Never part of a score's input hash: a change of places re-scores nothing."""
    try:
        return block(current())
    except (OSError, ValueError):
        return ''


def fingerprint_now():
    try:
        return fingerprint(current())
    except (OSError, ValueError):
        return ''


def previous(scores, search):
    """Job ids whose score used other places than these ("based on previous preferences"). Scores that recorded none are not marked."""
    now = fingerprint(search)
    return [job_id for job_id, data in scores.items() if data.get('locations') and data['locations'] != now]


def refresh(db, search, active_ids):
    """The explicit refresh: queue the marked scores of ACTIVE jobs for a new score (the next searches do it). -> how many."""
    from . import score
    ids = [job_id for job_id in previous(score.load(db), search) if job_id in set(active_ids)]
    db.executemany("UPDATE scores SET input_hash='' WHERE job_id=?", [(job_id,) for job_id in ids])
    db.commit()
    return len(ids)


def active_ids(db, stages=None):
    """The jobs a refresh or a re-score may touch: the ones the search shows, minus any with an application (stages: job url -> stage, whatever the stage),
    and only those a run can score (src/ai/score_old.py rescorable: a posting text, a place known)."""
    from . import score_old
    hidden = frozenset(url for url, stage in (stages or {}).items() if stage)
    return {job['id'] for job in score_old.rescorable(db, hidden)}


def id_for_url(db, url):
    """The id of the shown job at this URL (a trailing slash is not another job), as a set: {} when it is not shown."""
    from .. import digest
    want = str(url or '').strip().rstrip('/')
    return {job['id'] for job in digest.eligible_jobs(db)[0] if (job.get('url') or '').strip().rstrip('/') == want}
