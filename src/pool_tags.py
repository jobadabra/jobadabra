"""Finer fixed-list labels the pool shares (7 Oct 2026): country, metro area and role family of a user's own search settings.

Only these ids ever leave the machine; a search's own words never do. The site accepts the same lists (site/src/pool.js) and the central
scout publishes a label only when enough installs share it (src/scout.py fits). Which label a place or role word gets is decided by AI in
any language, from these fixed lists (src/ai/meanings.py labels; 8 Oct 2026: they were regexes in a few languages). No AI: no labels.
Tests: tests/unit/ai/test_pool_tags.py."""
from .ai import meanings

COUNTRIES = {
    'ch': 'Switzerland', 'de': 'Germany', 'at': 'Austria', 'fr': 'France', 'it': 'Italy', 'gb': 'United Kingdom', 'ie': 'Ireland',
    'nl': 'Netherlands', 'be': 'Belgium', 'lu': 'Luxembourg', 'es': 'Spain', 'pt': 'Portugal', 'se': 'Sweden', 'dk': 'Denmark',
    'no': 'Norway', 'fi': 'Finland', 'pl': 'Poland', 'cz': 'Czechia', 'ro': 'Romania', 'md': 'Moldova', 'gr': 'Greece',
    'us': 'United States', 'ca': 'Canada', 'au': 'Australia', 'sg': 'Singapore', 'in': 'India', 'ae': 'United Arab Emirates',
    'il': 'Israel', 'br': 'Brazil', 'mx': 'Mexico', 'jp': 'Japan', 'bg': 'Bulgaria', 'hr': 'Croatia', 'ee': 'Estonia', 'hu': 'Hungary',
    'sk': 'Slovakia', 'si': 'Slovenia', 'lt': 'Lithuania', 'lv': 'Latvia', 'cy': 'Cyprus', 'mt': 'Malta',
}
# The European ones: the columns of the central list's kind × country coverage (/admin/job-search/scouting). Every country the Lab's draws use
# (tools/persona-search/draws.json) is here; tests/unit/ai/test_pool_tags.py checks it.
EUROPE = ('ch', 'de', 'at', 'fr', 'it', 'gb', 'ie', 'nl', 'be', 'lu', 'es', 'pt', 'se', 'dk', 'no', 'fi', 'pl', 'cz', 'ro', 'md', 'gr', 'bg', 'hr', 'ee', 'hu',
          'sk', 'si', 'lt', 'lv', 'cy', 'mt')
METROS = {
    'ch-geneva': 'Geneva', 'ch-lausanne': 'Lausanne and Vaud', 'ch-zurich': 'Zurich', 'ch-basel': 'Basel', 'ch-bern': 'Bern',
    'ch-zug-luzern': 'Zug and Lucerne', 'ch-ticino': 'Ticino', 'ch-st-gallen': 'St. Gallen',
    'ch-fribourg-neuchatel': 'Fribourg and Neuchâtel', 'ch-valais': 'Valais', 'ch-aargau': 'Aargau (Aarau, Baden)', 'de-berlin': 'Berlin',
    'de-munich': 'Munich', 'de-hamburg': 'Hamburg', 'de-frankfurt': 'Frankfurt', 'de-cologne-dusseldorf': 'Cologne and Düsseldorf',
    'de-stuttgart': 'Stuttgart', 'at-vienna': 'Vienna', 'fr-paris': 'Paris', 'fr-lyon': 'Lyon', 'fr-annecy-grenoble': 'Annecy and Grenoble',
    'it-milan': 'Milan', 'gb-london': 'London', 'gb-manchester': 'Manchester', 'ie-dublin': 'Dublin', 'nl-amsterdam': 'Amsterdam',
    'nl-rotterdam-hague': 'Rotterdam and The Hague', 'be-brussels': 'Brussels', 'lu-luxembourg': 'Luxembourg', 'es-madrid': 'Madrid',
    'es-barcelona': 'Barcelona', 'pt-lisbon': 'Lisbon', 'pt-porto': 'Porto', 'se-stockholm': 'Stockholm', 'dk-copenhagen': 'Copenhagen',
    'no-oslo': 'Oslo', 'fi-helsinki': 'Helsinki', 'pl-warsaw': 'Warsaw', 'pl-krakow': 'Krakow', 'cz-prague': 'Prague',
    'ro-bucharest': 'Bucharest', 'md-chisinau': 'Chisinau', 'us-new-york': 'New York', 'us-bay-area': 'San Francisco Bay Area',
    'us-seattle': 'Seattle', 'us-boston': 'Boston', 'us-chicago': 'Chicago', 'us-los-angeles': 'Los Angeles', 'us-austin': 'Austin',
    'ca-toronto': 'Toronto', 'ca-vancouver': 'Vancouver', 'ca-montreal': 'Montreal', 'au-sydney': 'Sydney', 'au-melbourne': 'Melbourne',
    'sg-singapore': 'Singapore', 'in-bangalore': 'Bangalore', 'ae-dubai': 'Dubai', 'il-tel-aviv': 'Tel Aviv',
}
# Families inside the role kinds (src/role_kinds.py): what tells a photographer from a graphic designer, a nurse from a pharmacist.
FAMILIES = {
    'photography': 'photography, retouching', 'video_film': 'video, film, camera, motion',
    'graphic_design': 'graphic, UX/UI, visual design, illustration',
    'writing_content': 'writing, copywriting, journalism, content, editing',
    'marketing_social': 'marketing, social media, brand, SEO, communication', 'retail_sales': 'shop and retail sales, cashier',
    'b2b_sales': 'B2B sales, account management, business development', 'customer_service': 'customer service, call centre, help desk',
    'warehouse': 'warehouse, logistics, picking, forklift', 'driving_delivery': 'driving, delivery, courier',
    'kitchen': 'cooking, chef, pastry, bakery', 'service_hotel': 'waiting, bar, hotel, reception, housekeeping',
    'nursing_care': 'nursing, care work', 'medical': 'doctor, dentist, physiotherapy, therapy',
    'pharmacy_lab': 'pharmacy, laboratory, biology, chemistry', 'teaching': 'teaching, tutoring, lecturing',
    'childcare': 'childcare, nanny, early education', 'accounting_finance': 'accounting, controlling, finance',
    'admin_office': 'administration, office, assistant', 'hr_recruiting': 'HR, recruiting, talent',
    'legal': 'legal, lawyer, paralegal, compliance', 'construction': 'construction, carpentry, masonry, plumbing',
    'electrical_mechanical': 'electrician, mechanic, technician', 'cleaning_facility': 'cleaning, facility, caretaker',
    'security_guard': 'security guard', 'software_dev': 'software development',
    'sre_devops_cloud': 'SRE, DevOps, platform, cloud, infrastructure', 'data_ai': 'data, analytics, machine learning, AI',
    'product_project': 'product or project management', 'it_support': 'IT support, help desk',
}


def places(texts):
    """(countries, metros) named by these place words, as fixed-list ids. Switzerland, the first market, also from its fixed table
    (src/regions.py), so a Swiss search is Swiss offline and on its first run."""
    from .together import together   # Why (#2913, 2 Nov 2026): the country and the metro are independent AI lookups
    found, metros = together(lambda: countries(texts), lambda: meanings.labels('pool-metro', texts, METROS, 'A place a job seeker searches in. Answer its metro area, or none when it is a '
                                                                                'whole country, a region, or a place outside these areas.'))
    return found, metros


COUNTRY_TASK = 'A place a job seeker searches in. Answer the country it is in.'


def countries(texts):
    """The countries these place words name, as fixed-list ids: a search's places, or where an employer's jobs are (the central scout's
    kind × country coverage, 19 Oct 2026). Each place is asked once and kept (src/ai/decide.py)."""
    return countries_read(texts)[0]


def countries_read(texts, ask=None):
    """(countries, unanswered): countries' ids, and the place words no table, cache or AI answered this run (the central scout keeps an earlier answer for those).
    `ask(texts)` -> (ids, unanswered) answers the words the tables do not; none: the pool-country AI question (the scout passes its own place answers, src/scout_kind_counts.py)."""
    from . import places as places_
    cache = places_.load()
    swiss = {t for t in texts if places_.in_switzerland(t, cache)}
    # a region is every country it covers, each the same (26 Oct 2026: "europe" was labelled 'ch' alone)
    regions = {t: {code for name in places_.region_countries(t, cache) for code, known in COUNTRIES.items() if known == name} for t in texts}
    asked, unanswered = (ask or (lambda rest: meanings.labels_read('pool-country', rest, COUNTRIES, COUNTRY_TASK)))(texts)
    found = sorted({*(['ch'] if swiss else []), *(code for codes in regions.values() for code in codes), *asked})
    answered = {t.strip() for t in texts if t in swiss or regions.get(t)}   # labels_read strips its texts
    return found, [t for t in unanswered if t not in answered]


def countries_each(texts):
    """({place word: its country ids}, unanswered): countries() per word, every word in ONE batch (meanings.labels_each, 50 words a model call), never a
    call per word. A word nothing answered has no ids and is listed in unanswered: unknown, never a guess.
    Why (12 Nov 2026, owner: "Reserve kinds + batch places"): the central scout's board pass asked one call per place, and in the France trial its 24 calls
    went to places, none to the kinds of work its boards needed (src/scout_boards.py local_of)."""
    from . import places as places_
    cache = places_.load()
    each, unanswered = meanings.labels_each('pool-country', texts, COUNTRIES, COUNTRY_TASK)
    found = {}
    for text in texts:
        regions = {code for name in places_.region_countries(text, cache) for code, known in COUNTRIES.items() if known == name}
        found[text] = set(each.get(str(text).strip(), ())) | regions | ({'ch'} if places_.in_switzerland(text, cache) else set())
    return found, [t for t in unanswered if not found.get(t)]


FAMILY_TASK = 'A role a job seeker looks for, in any language. Answer its family of jobs.'


def families(texts):
    """Role families named by these role words, as fixed-list ids."""
    return meanings.labels('pool-family', texts, FAMILIES, FAMILY_TASK)


def families_each(texts):
    """({text: its family ids}, unanswered): the family of each text, in one batch; the role words nothing answered this run (the AI capped or failed) are
    unanswered: "not asked" is not "none". (src/scout_boards.py counts the jobs of each family with it.)"""
    return meanings.labels_each('pool-family', texts, FAMILIES, FAMILY_TASK)
