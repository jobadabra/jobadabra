"""The order board discovery fills its (country, role family) cells in: the pairs people really search first, then every country for the most searched fields.
Why (13 Nov 2026, owner via sa, asked via AskUserQuestion: "Searched pairs first (Recommended)"; plan docs/superpowers/plans/2026-11-13-proven-boards.md, sketch
https://claude.ai/artifact/YPkXa1B2BDQg4WjDbrQLfx): the fill took the weakest cell first, so a full pass (930 cells, 310 passes, ~33 h on one lane) reached the pairs people search
last. One ordered list, one owner for each part:
  1. the cells the lab names (SCOUT_BOARD_PRIORITY), in the order it names them;
  2. the profile pairs: the b and c people of tools/persona-search/search-profiles.json (all of them: cards move, the list must not), their family derived from the role title with
     pool_tags (never typed by hand), their country from its name. Profiles added 13 Nov 2026 (d01-d07) are held out: they are the check that the fill also works for people nobody
     tuned it for (owner via sa, "Searched pairs first (Recommended)"); so are the random draws;
  3. the pairs installs really searched: the index's board cells that installs gave (no `right`, no `measured`: those are the Scout's own), the most installs first. Never a second demand
     signal (src/scout_need.py is whether one install's search has enough employers, not what people search);
  4. every country for the fields installs and the profiles search most, the most searched field first.
The list only orders cells with the same number of proven boards (src/scout_board_cells.py pick): a cell with fewer proven boards always goes first. Tests: tests/unit/sources/test_scout_board_priority.py."""
import json
import re
from collections import Counter
from pathlib import Path

from . import pool_tags, scout_cells

PROFILES = Path(__file__).resolve().parent.parent / 'tools' / 'persona-search' / 'search-profiles.json'
COUNTED = re.compile(r'[bc]\d{2}')   # the 12 Nov 2026 round (b01-b10, c01-c20); d01-d07 (13 Nov 2026) and anything later are held out


def profile_pairs(path=PROFILES, families=None):
    """[(country code, family)] of the b and c profiles, in the file's order, each once; a profile whose country or family is not known is left out.
    The family is the first pool family of the role title (families: titles -> ids, default src/pool_tags.py families: the meanings pack, then the AI)."""
    families = families or pool_tags.families
    from .scout_boards import named_country
    try:
        profiles = json.loads(Path(path).read_text()).get('profiles') or []
    except (OSError, ValueError):
        return []
    pairs = []
    for person in profiles:
        if not isinstance(person, dict) or not COUNTED.fullmatch(str(person.get('id') or '')):
            continue
        try:
            country = named_country(person.get('country'))
        except ValueError:
            continue
        family = (families([str(person.get('title') or '')]) or [None])[0]
        if country and family in pool_tags.FAMILIES:
            pairs.append((country, family))
    return list(dict.fromkeys(pairs))


def searched_pairs(facts):
    """Counter {(country, family): installs} from the pool's board facts (src/sources/visits_jobpages.py pool_facts): the cells installs gave. A cell the Scout counted
    (`right`) or marked (`measured`) is the Scout's own and is no demand."""
    out = Counter()
    for board in ((facts or {}).get('board') or {}).values():
        for cell in board.get('relevant') or []:
            if 'right' in cell or cell.get('measured') or cell.get('country') not in scout_cells.EUROPE or cell.get('family') not in pool_tags.FAMILIES:
                continue
            out[(cell['country'], cell['family'])] += cell['installs']
    return out


def order(named=(), profiles=(), demand=None):
    """The ordered cells: the lab's, the profiles', the installs' pairs (most installs first), then every country for each field, the most searched first (installs' counts, plus one
    for each profile that searches it). Each cell once."""
    demand = demand or Counter()
    fields = Counter()
    for (_, family), installs in demand.items():
        fields[family] += installs
    for _, family in profiles:
        fields[family] += 1
    pairs = [cell for cell, _ in sorted(demand.items(), key=lambda item: (-item[1], scout_cells.EUROPE.index(item[0][0]), item[0][1]))]
    wide = [(country, family) for family, _ in sorted(fields.items(), key=lambda item: (-item[1], item[0])) for country in scout_cells.EUROPE]
    return list(dict.fromkeys([*named, *profiles, *pairs, *wide]))


def priority(named=(), path=PROFILES, families=None, facts=None):
    """The cells to fill first, in order (see the module docstring); `named` is the lab's SCOUT_BOARD_PRIORITY cells. Reads the index this machine downloaded when `facts` is None;
    without one, the profiles and the lab's list alone."""
    if facts is None:
        from .sources import visits_jobpages
        facts = visits_jobpages.pool_facts()
    profiles = profile_pairs(path, families)
    return order(named, profiles, searched_pairs(facts))
