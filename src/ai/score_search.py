"""The fit score's second view: how the posting's role matches the person's search, apart from their CV (owner, 26 Oct 2026: "Show them, flag
the gap", for a search in another field than the CV). The engine writes the search's roles into the request (block) and the scorer's fixed
answer has a `search` part: the fit to those roles (whatever the CV shows), whether the search is a career change (another field than the
profile's experience), one line on what the profile lacks, and whether a regulated credential is required.
The ring is the scorer's own overall score, never replaced by that fit (owner, 13 Nov 2026: "We should be realistic. When a person tries to do a
career change, for sure all the scoring will drop"; "The person needs to understand why the scoring is so low"; picked "Realistic ring, never
hidden"). On a career change the one line every place shows says why: `Career change: <what the CV lacks>`, the gap first among the gaps. The
26 Oct rule that lifted the ring to the fit (or to 70 on the title check) is gone: a lift showed 13 First Officer jobs at 70-85 for a software CV.
Career change is the AI's per-job answer (search.career_change); no stored profile field (owner, 13 Nov 2026: "Can't we just keep per-job, for now?").
A job stays listed and in the digest under the digest's bar only when it is a role of the search on a career change (`searched`: the AI's yes to
the title check AND to one fixed question on the title and the posting's first lines, so "Spécialiste Support Pilotage et Comptabilité" and a
flight-controls engineer stay out; tests/unit/ai/test_score_role_check.py).
A licence, certification or rating the posting requires the applicant to hold already, which the profile does not show, caps the fit at 49 (7 Nov 2026, required not preferred; cases: tests/fixtures/score-cases.json).
The AI judges all of it; no word lists. Tests: tests/unit/ai/test_score_realistic_ring.py."""
PART = {
    'type': 'object', 'additionalProperties': False, 'required': ['fit', 'career_change', 'cv_gap', 'needs_credential'],
    'properties': {
        'fit': {'type': 'integer', 'description': "0-100: how well the posting's role matches the roles the person searches for (their search, "
                                                  'given below the profile), whatever their experience; the same bands as the overall score. '
                                                  'A regulated or examined credential (a licence, rating, professional registration) the posting requires, '
                                                  'not prefers, the applicant to hold already, and the profile does not show (not one the employer '
                                                  'trains for, nor a health check or clearance done at entry) is a core gap: at most 49, however '
                                                  'well the role matches the search'},
        'career_change': {'type': 'boolean', 'description': "The searched roles are another field of work than the profile's experience "
                                                            '(a person changing careers); false when the profile is in the same field'},
        'cv_gap': {'type': 'string', 'description': 'One line, at most 90 characters: what the profile lacks for this role (a licence, hours, '
                                                    'years in the field); empty when the profile covers it'},
        'needs_credential': {'type': 'boolean', 'description': 'True when the posting requires a regulated or examined credential (a licence, rating, '
                                                               'professional registration) the applicant must hold already and the profile does not show: '
                                                               'the same test as the cap on fit; false otherwise'},
    },
}

# Why (7 Nov 2026, owner: "Right after, as 1b (Recommended)"): `needs_credential` — the title check lifted a capped licence-gated job back to 70 next to its Not eligible card; it cannot
# see the licence, the scorer's answer can, so apply() honours the AI's own boolean and skips the lift. No keyword rule, no code cap.
# Why (7 Nov 2026, owner: "Change the prompt (Recommended)"): `not prefers, the applicant` — a Cessna captain job (type rating, licence, 1,500 hours) scored 85 for
# a person with none of them while its card said Not eligible; search.fit ignored a licence the profile lacks. tools/score-cases.py (3 runs, title lift off): 95/85/55 before, 45/45/40 after.
RULE = """
- search: the person's search (their roles) is given after the profile. search.fit rates the posting's role against those roles alone, \
in the same bands, whatever the profile shows, except that a regulated or examined credential (a licence, rating, professional registration) the posting requires, not prefers, the applicant \
to hold already, which the profile does not show the person holds, caps it at 49 (a role the person cannot take up). Training the employer gives, \
a health check or clearance done at entry, and a credential the posting only prefers, are not such a requirement. search.needs_credential is true exactly when that cap applies. search.career_change is true when the searched roles are another field than the profile's \
experience. Then also name in search.cv_gap what the profile lacks for this role, and write reason about the fit to the search."""


def extend(schema):
    """The scorer's answer form with the search part (a copy)."""
    import copy
    out = copy.deepcopy(schema)
    out['properties']['search'] = PART
    out['required'] = [*out['required'], 'search']
    return out


ROLE_TOPIC = 'search_role'   # src/ai/decide.py: kept per (topic, key), so a posting is asked once per set of roles
ROLE_ANSWERS = ['yes', 'no']
ROLE_TASK = ("Each item is a job posting (its title and first lines) and the roles a person searches for. Answer yes when this job hires "
             "someone to do one of those roles; no when it is other work that only shares a word with them (the word in another sense, or a "
             "job that designs, builds, sells or supports things for people in that role).")
FIRST_LINES = 400   # characters of the posting sent with its title


def _roles(search=None):
    """The current search's role titles (at most 12); [] when it has none or they cannot be read."""
    from .. import target_roles
    if search is None:
        try:
            from ..paths import load_search_config
            search = load_search_config(matching=False)
        except (OSError, ValueError):
            return []
    try:
        return [role['title'] for role in target_roles.view(search or {}) if role.get('title')][:12]
    except (TypeError, AttributeError, KeyError):   # an unreadable list: no roles
        return []


def block(search=None):
    """The search's roles as one fixed sentence the engine writes; '' when it has none."""
    roles = _roles(search)
    return f"\n\nThe person's search (the roles they look for): {', '.join(roles)}." if roles else ''


def _role_item(job, roles):
    """The role check's (key, text) for a posting: its title and first lines with the search's roles; kept per key (decide)."""
    import hashlib
    lines = ' '.join(str(job.get('description') or '').split())[:FIRST_LINES]
    text = f"Roles searched: {', '.join(roles)}\nPosting: {job['title']}\n{lines}"
    return hashlib.sha1(f"{'|'.join(roles)}\n{job['title']}\n{job.get('url') or ''}".encode()).hexdigest()[:16], text


def _role_check(job):
    """The AI's yes that this posting hires for one of the search's roles, read from its title and first lines (None or no: not a yes)."""
    from . import decide
    roles = _roles()
    if not roles:
        return False
    key, text = _role_item(job, roles)
    return decide.one(ROLE_TOPIC, key, text, ROLE_ANSWERS, ROLE_TASK) == 'yes'


def _search_role(job):
    """The AI's title check said this posting's title is a role of the current search, and its role check on the title and first lines says
    yes too (True only on both yeses; unjudged is not a yes)."""
    if not job or not job.get('title'):
        return False
    from ..sources import feeds
    try:
        return feeds.judged_title(job['title']) is True and _role_check(job)
    except Exception:  # noqa: BLE001 — a check we cannot read lifts nothing
        return False


def apply(data, job=None):
    """Keep the scorer's overall as the ring and, on a career change, say why it is low: reason = `Career change: <gap>`, the gap first among the
    gaps. search.searched = a career change AND the job is a role of the search (_search_role), read by the digest (searched)."""
    part = data.get('search') or {}
    try:
        fit = max(0, min(100, int(part.get('fit'))))
    except (TypeError, ValueError):   # an answer without the part (an engine without the answer form): kept as asked
        data['search'] = {}
        return data
    career = part.get('career_change') is True
    gap = str(part.get('cv_gap') or '')[:120]
    data['search'] = {**part, 'fit': fit, 'cv_gap': gap, 'searched': bool(career and _search_role(job))}
    if career and gap:
        # The one line every place shows (the Jobs row, the drawer, Job Matches, the Telegram card): a store's own field, no new column.
        data['reason'] = f'Career change: {gap}'
        data['gaps'] = [gap, *[other for other in data.get('gaps') or [] if other != gap]][:3]   # first among the gaps: the match panel shows them
    return data


def searched(data):
    """True for a stored score of a role of the search on a career change: the digest keeps it under its bar (apply)."""
    return bool(((data or {}).get('search') or {}).get('searched'))
