"""One home for a person's places: the place lists, the Remote jobs word and the place words every step falls back to (owner, 11 Nov 2026).

Why (owner, 11 Nov 2026: "how we can fix this forever? How we can prevent fixing the location so many times?", asked via AskUserQuestion:
"One home + hold the number"): nine files each read the raw lists and decided "is this job in your places?" their own way, so each fix
landed in one of them and the next symptom came from another (#3792, #3808). A person's places have four parts:
- the towns and regions they named (`top_tier`);
- the whole country (`country_wide`): only their own pick, or their CV's or note's words (owner, 11 Nov 2026, "You, or CV/note words");
- cities abroad they would move to (`abroad`);
- Remote jobs: no, country (remote jobs that name their country) or yes.
The one question "is this job in my places?" is src/sources/feeds.py wanted_location: the AI's kept answer when it placed the location,
else these place words (owner, 11 Nov 2026, asked via AskUserQuestion: "Keep today's (Recommended)": a job naming your own town is listed
at once while the AI places the rest). Guard: tests/guards/rules/test_places_one_home.py (the files still reading the raw lists only shrink).
"""
from .paths import place_regex

GROUPS = ('top_tier', 'country_wide', 'abroad')
# The words that say No (#3808): the app's desktop/renderer/remote-word.js says the same (tests/unit/sources/test_places_one_home.py).
NO_WORDS = ('no', 'non', 'nein', 'none', 'never', 'off', 'false')


def lists(search, groups=GROUPS):
    """{group: [place words as written]} for these groups of the search's places; a missing group is an empty list."""
    places = (search or {}).get('locations') or {}
    return {group: list(places.get(group) or []) for group in groups}


def words(search, groups=GROUPS):
    """The place words of these groups, in group order (the search's places as the person wrote them)."""
    return [word for group in groups for word in lists(search, groups)[group]]


def words_regex(search, groups=GROUPS):
    """The place words of these groups as one whole-word pattern (src/paths.py place_regex); the fallback while the AI has not placed a location."""
    return place_regex(words(search, groups))


def remote_word(search):
    """'no', 'country' or 'yes': what the person's Remote jobs says, read the same way by every step (#3808). Missing or unknown words: 'yes'."""
    said = [str(value).strip().lower() for value in ((search or {}).get('remote_jobs') or [])]
    if any(value in NO_WORDS for value in said):
        return 'no'
    return 'country' if 'country' in said else 'yes'
