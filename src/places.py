"""Place words that stand for many places, worked out by AI instead of a list. "Germany" must find a job posted as "Leipzig", "Asia" one in "Singapore": a posting's
location is usually a city, rarely the country or the region. Nobody keeps a list of every city of every country, so a small model is asked once per word, the answer
is checked here and kept on this computer (data/places.json), and every later crawl reads the file: no AI call, no cost. (src/regions.py keeps Switzerland's fixed
table: deterministic, tested, works offline.)

What the model says is data, never a pattern: each name must be plain letters, spaces, hyphens, dots or apostrophes (otherwise it is dropped), it is escaped and matched
as a whole word, and a wrong or missing city costs one false or missed match, nothing else. A word the model calls a city is left as the user wrote it.
No CV and no personal data is sent: the place words of the search, nothing more.
"""
import json
import re
import unicodedata
from datetime import datetime, timezone
from .ai.models import SMALL_MODEL
from .ai.providers.contract import detail, reason

MODEL = SMALL_MODEL
MAX_WORDS = 12          # place words asked about in one call
MAX_NAMES = 80          # names kept per word
EXPAND_KINDS = ('country', 'region', 'state')
REGION_COUNTRIES = 60   # a region keeps every country it covers (26 Oct 2026: "Europe" kept its 10 biggest, Switzerland among them, and was read as Swiss)
NAME_OK = re.compile(r"[^\W\d_](?:[^\W\d_]|[ .'’\-])*[^\W\d_.]")

SCHEMA = {
    'type': 'object', 'additionalProperties': False, 'required': ['places'],
    'properties': {'places': {'type': 'array', 'items': {
        'type': 'object', 'additionalProperties': False, 'required': ['word', 'kind', 'names', 'countries'],
        'properties': {'word': {'type': 'string', 'description': 'The place word exactly as given'},
                       'countries': {'type': 'array', 'items': {'type': 'string'},
                                     'description': 'The country it is in, or the countries a region covers, by their English name'},
                       'kind': {'type': 'string', 'enum': ['country', 'region', 'state', 'city', 'other']},
                       'names': {'type': 'array', 'items': {'type': 'string'}}}}}},
}

SYSTEM = """You turn the place words of a job search into the places a job posting would name. For each word, say what it is:
- "country": a country. "region": several countries or a large area (Asia, Europe, DACH, Nordics, the Middle East). "state": a part of a country (a US state, a Canadian \\
province, a German Land, a UK nation or county, a Swiss canton).
- "city": one city or town. "other": anything else, or not a place.
For a country, region or state: names = the main cities and towns where employers post jobs (up to 70, the biggest first, then mid-size), each in the spellings postings use \\
(the local name and the English name when they differ, e.g. "München" and "Munich"), plus the states, provinces or countries inside it when it is a region or a country with \\
states. Short forms postings use, such as "UK", "USA", "NYC", count too. Only real places: never invent one, and leave out a name that is also a common word.
For a city or other: names = [] (up to three other spellings of the city that postings really use, if any).
countries = the country the place is in (a city, a state, a country itself), or for a region every country it covers (all of them, in no order of \
importance: each counts the same), by the English name Wikipedia uses ("Portugal", "United States", "Germany"); [] for "other".
Answer for every word given, with the word exactly as written."""


def _plain(text):
    return ''.join(c for c in unicodedata.normalize('NFKD', str(text)) if not unicodedata.combining(c))


def path():
    from .paths import DATA
    return DATA / 'places.json'


def load(file=None):
    try:
        return json.loads((file or path()).read_text())
    except (OSError, ValueError):
        return {}


def _key(word):
    from .regions import _key
    return _key(word)


def clean_names(names):
    """The names the model gave that are safe to match: plain place names, each once, at most MAX_NAMES."""
    out, seen = [], set()
    for name in names or []:
        if not isinstance(name, str):
            continue
        name = ' '.join(name.split())
        if not 2 <= len(name) <= 60 or not NAME_OK.fullmatch(name):
            continue
        key = _plain(name).lower()
        if key not in seen:
            seen.add(key)
            out.append(name)
    return out[:MAX_NAMES]


MAX_SPELLINGS = 4   # the plain spellings one place fragment may stand for: "krak[oó]w" is 2, "m(ü|ue)nchen|munich" 3; more is a pattern, not one place's spellings


class _Open(Exception):
    """The pattern matches an open set of texts (".*", "[a-z]", "\\w", a lookaround), has an optional part ("st\\.? ?gallen", ledger L22), more than MAX_SPELLINGS
    texts, or does not parse: no spelling stands for it."""


class _Reader:
    """Every text a place pattern matches, in order, case kept: groups and their alternatives, letter choices ([oó]), escaped punctuation, word edges.
    Raises _Open for anything else (a quantifier, "?" included). An unescaped "." is the dot of a name ("st. gallen"), as the draft means it."""

    def __init__(self, text):
        self.text, self.at = text, 0

    def all(self):
        found = self.either()
        if self.at != len(self.text):
            raise _Open   # a stray ")"
        return found

    def either(self):
        options = self.row()
        while self.text[self.at:self.at + 1] == '|':
            self.at += 1
            options = options + self.row()
        return options

    def row(self):
        done = ['']
        while self.at < len(self.text) and self.text[self.at] not in '|)':
            options = self.one()
            if self.text[self.at:self.at + 1] in ('*', '+', '{', '?'):
                raise _Open   # a quantifier; "?" too: an optional part makes near-twin spellings ("stgallen"), each one more read of a site (L22 keeps it a pattern)
            done = list(dict.fromkeys(before + option for before in done for option in options))
            if len(done) > MAX_SPELLINGS:
                raise _Open
        return done

    def one(self):
        char = self.text[self.at]
        step = {'(': self.group, '[': self.choice, '\\': self.escape}.get(char)
        if step:
            return step()
        if char in '*+?{}])':
            raise _Open
        self.at += 1
        return [''] if char in '^$' else [char]

    def group(self):
        if self.text.startswith('(?:', self.at):
            self.at += 3
        elif self.text.startswith('(?', self.at):
            raise _Open   # a lookaround or a named group
        else:
            self.at += 1
        inside = self.either()
        if self.text[self.at:self.at + 1] != ')':
            raise _Open
        self.at += 1
        return inside

    def choice(self):
        close = self.text.find(']', self.at + 1)
        letters = self.text[self.at + 1:close]
        if close < 0 or not letters or not all(c.isalpha() for c in letters):
            raise _Open   # a range, a negation, an escape: an open set
        self.at = close + 1
        return list(dict.fromkeys(letters))

    def escape(self):
        after = self.text[self.at + 1:self.at + 2]
        self.at += 2
        if after in ('b', 's'):
            return [{'b': '', 's': ' '}[after]]
        if after and not after.isalnum():
            return [after]
        raise _Open   # \w, \d, …


def spellings(fragment):
    """The ONE reading of a place fragment as names: every plain spelling it stands for, in order, or None when it stands for an open set of texts (a real regex).
    Each top-level alternative is the page's own word when readable() has one ("z[uü]rich" -> zürich, "\\bzug\\b" -> zug), else every text it matches
    ("lisb(on|oa)" -> lisbon, lisboa; "krak[oó]w" -> krakow, kraków; "sofia|софия"); each must be a plain name (NAME_OK), at most MAX_SPELLINGS of them.
    Design (13 Nov 2026, run 43328194035 p10 Lisbon; the third fix after #2977 and #3520, each of which added one shape): a place pattern is the finite set of
    names it matches, read by one small parser instead of a rule per shape; a pattern with no such set is None, and refresh() names it in the run's lines.
    Expanding a spelling pattern is parsing, never a judgment of what a place is (that stays the places AI's)."""
    from .notion.search_settings import readable
    text = str(fragment).strip()
    word = readable(text).strip('"')
    if not word.startswith('/'):
        return [word]
    text = re.sub(r'^"(.*)"$', r'\1', text)
    from .fragment_words import _alternatives   # the top-level "|"s only: "lisb(on|oa)" is one part
    try:
        top = []
        for part in _alternatives(text):
            plain = readable(part).strip('"')
            top.extend([plain] if part and not plain.startswith('/') else _Reader(part).all())
    except _Open:
        return None
    names = list(dict.fromkeys(' '.join(name.split()) for name in top))
    return names if len(names) <= MAX_SPELLINGS and all(NAME_OK.fullmatch(name) for name in names) else None


def fragment_place_words(fragment):
    """The plain place words one location fragment stands for (spellings), [] for a real regex: every reader takes a search's place words from here,
    place_words or plain_words, never from terms() (#2920). Why (2 Nov 2026, #2974 p1 "sofia|софия"; 7 Nov 2026, #2920 p5 "krak[oó]w"; 13 Nov 2026, run 43328194035
    p10 "lisb(on|oa)"): a fragment read as no place gave no country, no board web search and no places for the place AI; spellings() is the one reading."""
    return spellings(fragment) or []


def plain_words(fragments):
    """The plain place words of a list of location fragments, each once, in order: what `terms()` gave for places, plus the spellings of a letter choice or an alternation
    and an accented name. Every reader that types a place into a site or a prompt takes it from here or from place_words, never from terms() (#2920)."""
    return list(dict.fromkeys(word for fragment in fragments or [] for word in fragment_place_words(str(fragment))))


def place_words(search, groups=('top_tier', 'country_wide', 'abroad'), per_group=None, first_only=False):
    """The plain place words of a search, group by group in `groups` order, each once (at most `per_group` fragments that have a plain reading from each group; `first_only`: one word, the first spelling, of each fragment): the one reading every source uses
    (EURES, the employer-site reads): a fragment with no plain reading (a real regex) gives none."""
    found = []
    for group in groups:
        read = 0
        for fragment in (search.get('locations') or {}).get(group) or []:
            words = fragment_place_words(str(fragment))
            if not words:
                continue   # a real regex has no place word and does not use one of the per_group slots (as terms() did)
            found.extend(word for word in (words[:1] if first_only else words) if word not in found)
            read += 1
            if read == per_group:
                break
    return found


def words_of(search):
    """The plain place words of a search that may need working out: not a regex (an alternation of plain spellings is each spelling), not one of the fixed regions,
    not shorter than three letters."""
    from .regions import region_of
    found = []
    for key in ('top_tier', 'country_wide', 'abroad'):
        for fragment in ((search.get('locations') or {}).get(key) or []):
            for word in fragment_place_words(fragment):
                if len(word) < 3 or region_of(fragment) or region_of(word) or word in found:
                    continue
                found.append(word)
    return found


def unread(search):
    """The search's place fragments that stand for no name (spellings() is None) and are not a fixed region, each as the Strategy page shows it
    (src/fragment_words.py: never a raw pattern in a run line, tests/guards/rules/test_run_lines_plain.py): places no source can search by name.
    Pass the person's own words (load_search_config(matching=False)): the crawl's added region and place patterns are no entry of theirs (Gitar on #3953)."""
    from .fragment_words import fragment_words
    from .my_places import words
    from .regions import region_of
    return list(dict.fromkeys(fragment_words(fragment) or str(fragment) for fragment in words(search)
                              if not region_of(fragment) and spellings(fragment) is None))


def _country_named(word):
    """[the country] when the word is a country's English name (ISO table, src/country_codes.py), else []: a country needs no model's answer, so the
    central scout (no places cache in CI) and a first search still know "Moldova" is Moldova."""
    from .country_codes import NAMES
    lowered = str(word).strip().casefold()
    return next(([name] for name in NAMES.values() if name.casefold() == lowered), [])


def countries(search, cache=None, limit=3):
    """The countries the search's places are in, the user's first places first (at most `limit`; None: all, as a region's every country):
    Swiss region words from the fixed table (src/regions.py), every other word from what the model said. [] when none is known yet."""
    from .regions import region_of
    cache = load() if cache is None else cache
    found = []
    for key in ('top_tier', 'country_wide', 'abroad'):
        for fragment in ((search.get('locations') or {}).get(key) or []):
            for word in ([None] if region_of(fragment) else fragment_place_words(fragment)):
                for country in ['Switzerland'] if word is None or region_of(word) else (cache.get(_key(word)) or {}).get('countries') or _country_named(word):
                    if country not in found:
                        found.append(country)
    return found if limit is None else found[:limit]


def in_switzerland(word, cache=None):
    """True when this place word is in Switzerland: a Swiss region word, else the AI's countries for it (places.json), else Switzerland's fixed
    town table (src/regions.py: the first market works offline, before the AI placed the word). 18 Oct 2026, persona runs: a Nuremberg
    driver's "altdorf" (Altdorf bei Nürnberg, which the AI had placed in Germany) matched the Swiss town Altdorf, and jobs.ch was searched."""
    from .notion.search_settings import readable
    from .regions import SWITZERLAND, region_of
    if region_of(word):
        return True
    from . import geo
    mapped = geo.resolve([readable(str(word)).strip('"'), str(word)], ask=False).values()   # the map's country code, once the word is placed (as read or as given)
    for entry in mapped:
        if entry.get('cc'):
            return entry['cc'] == 'CH'
    cache = load() if cache is None else cache
    known = (cache.get(_key(readable(str(word)).strip('"'))) or {}).get('countries') or _expanded_from(word, cache)
    if known:   # a place in Switzerland; a region that covers it (Europe, DACH) is all its countries, never Switzerland alone (26 Oct 2026)
        return set(known) == {'Switzerland'}
    return bool(re.search(SWITZERLAND, str(word), re.I))


def _expanded_from(fragment, cache):
    """The countries of the place whose names `expand` added as this fragment: the added towns keep their place's country (18 Oct 2026:
    Franken's added "Baden-Württemberg" matched the Swiss town Baden in the fixed table). None for any other fragment."""
    from .notion.search_settings import readable
    for entry in cache.values():
        if isinstance(entry, dict) and entry.get('names') and entry.get('countries'):
            added = pattern(entry['names'])
            if fragment in (added, readable(added)):   # as loaded, or as a reader shows it (aggregators._countries)
                return entry['countries']
    return None


def pattern(names):
    """One regex fragment for these names: each as a whole word, accents ignored (the matcher also reads the posting without its accents)."""
    return '(?:' + '|'.join(rf"(?<!\w){re.escape(_plain(name).lower())}(?!\w)" for name in names) + ')'


def expand(fragments, cache=None):
    """The place fragments with what the cache knows added to each country, region or state word; the user's own word stays, so nothing already found is lost."""
    cache = load() if cache is None else cache
    out = []
    for fragment in fragments or []:
        out.append(fragment)
        keys = list(dict.fromkeys([_key(fragment), *(_key(word) for word in fragment_place_words(fragment))]))   # an alternation's spellings are asked one by one (Gitar on #2977)
        for key in keys:
            entry = cache.get(key)
            if entry and entry.get('kind') in EXPAND_KINDS + ('city',) and entry.get('names'):
                out.append(pattern(entry['names']))
    return out


def ask(client, words):
    """-> {normalized word: {word, kind, names, at}} for the words the model answered."""
    from .ai import cost, engine
    response = client.messages.create(
        model=MODEL, max_tokens=8000, system=[{'type': 'text', 'text': SYSTEM}],
        messages=[{'role': 'user', 'content': 'Place words (JSON): ' + json.dumps(words, ensure_ascii=False)}], output_config=engine.structured(SCHEMA, MODEL, 'low'))
    cost.side(MODEL, response.usage)
    if response.stop_reason != 'end_turn':
        raise RuntimeError(f'stopped with {response.stop_reason}')
    answer = json.loads(next(block.text for block in response.content if block.type == 'text'))
    asked = {_key(word): word for word in words}
    stamp = datetime.now(timezone.utc).date().isoformat()
    out = {}
    for item in answer.get('places') or []:
        key = _key(item.get('word', ''))
        if key in asked and item.get('kind') in ('country', 'region', 'state', 'city', 'other'):
            region = item['kind'] == 'region'
            out[key] = {'word': asked[key], 'kind': item['kind'], 'names': clean_names(item.get('names')) if item['kind'] != 'other' else [],
                        'countries': clean_names(item.get('countries'))[:REGION_COUNTRIES if region else 10] if item['kind'] != 'other' else [],
                        **({'every': True} if region else {}), 'at': stamp}
    return out


def from_pack(words):
    """{normalized word: entry} for the words the shared pack already places as a city (download only: the user's words are never sent; a country or region
    has no city list in the pack, so it is still asked). The entry has no extra spellings, like a city the model answered with none."""
    from . import geo
    stamp = datetime.now(timezone.utc).date().isoformat()
    out = {}
    for word in words:
        placed = geo._from_pack([geo.norm(word)]).get(geo.norm(word))
        name = placed and placed['kind'] == 'city' and geo.country_name(placed['cc'])
        if name:
            out[_key(word)] = {'word': word, 'kind': 'city', 'names': [], 'countries': [name], 'at': stamp}
    return out


def stale_words(search, cache):
    """The search's place words to ask (again): unknown ones; one kept before 8 Oct 2026 has no countries yet (Find new employers needs them);
    a region kept before 26 Oct 2026 has only its 10 biggest countries, not every one."""
    def stale(entry):
        return 'countries' not in entry or (entry.get('kind') == 'region' and not entry.get('every'))
    return [word for word in words_of(search) if stale(cache.get(_key(word), {}))]


def region_countries(word, cache=None):
    """Every country of this place word when it is a region (Europe, DACH, Nordics), else []."""
    from .notion.search_settings import readable
    cache = load() if cache is None else cache
    entry = cache.get(_key(readable(str(word)).strip('"'))) or cache.get(_key(str(word))) or {}
    return list(entry.get('countries') or []) if entry.get('kind') == 'region' else []


def refresh(search, client=None, file=None):
    """Work out the place words of this search that are not in the cache yet; returns how many it asked about. Nothing is asked when all are known."""
    file = file or path()
    cache = load(file)
    left = unread(search)
    if left:   # said, never silent (13 Nov 2026, run 43328194035 p10): a place read as no name gives no country, no board web search and no place for the place AI
        print(f"Places: not read as a place: {', '.join(left[:3])} (written as a pattern, not a place name); write {'it' if len(left) == 1 else 'each'} as a town or country name in Strategy", flush=True)
    words = stale_words(search, cache)[:MAX_WORDS]
    if not words:
        return 0
    shared = from_pack(words)
    if shared:
        from . import pool_served
        pool_served.count('places', len(shared))
        cache.update(shared)
        words = [word for word in words if _key(word) not in shared]
        if not words:
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(json.dumps(cache, indent=1, ensure_ascii=False) + '\n')
            print(f"Places: {len(shared)} place word{'' if len(shared) == 1 else 's'} placed from the shared pool")
            return 0
    if client is None:
        from .ai import engine
        if not engine.ready():
            return 0
        client = engine.client(action='places')
    cache.update(ask(client, words))
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(cache, indent=1, ensure_ascii=False) + '\n')
    print(f"Places: worked out {len(words)} place word{'' if len(words) == 1 else 's'} with AI: {', '.join(words)}")
    return len(words)


def refresh_quietly():
    """Before a crawl: a failure (offline, no AI set up, a refusal) leaves the crawl exactly as it was."""
    try:
        from .paths import CONFIG
        refresh(json.loads((CONFIG / 'search.json').read_text()))
    except Exception as error:  # noqa: BLE001 — the places stay as the user wrote them
        print(f'Warning: place names were not translated ({reason(error)}); matching them as written.')
        detail('place words', error)
