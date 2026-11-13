"""Telegram digest: filtering, ranking, rotation, paging and message layout."""
from datetime import datetime, timedelta, timezone
from html import unescape
import json
import os
import random
import re

from . import store, digest_render, my_places, notification_language, work_rights
from .ai import enrich, score, score_search
from .notion import client as notion
from .paths import CONFIG, keyword_regex, load_search_config

WORK_MODE_BADGES = {'Hybrid': '🔀 Hybrid', 'Remote (stated)': '🌍 Remote', 'Remote mentioned': '🌍 Remote?'}
TELEGRAM_LIMIT = 4096
# Leave room for the footer and "part 2/3" suffix.
CHUNK_LIMIT = TELEGRAM_LIMIT - 200
PAGE_SIZE = 10  # Jobs per digest message; '➕ Next' loads the following page.
_SEARCH = load_search_config()
HOME = my_places.words_regex(_SEARCH, ('top_tier', 'country_wide'))
RELEVANT = keyword_regex(_SEARCH['role_keywords'])
PREFERENCES = json.loads((CONFIG / 'preferences.json').read_text())
MIN_DIGEST_SCORE = PREFERENCES.get('digest_min_score', 50)
# The tool's own name is "Jobadabra" (generic, any fork); this is your own digest's display name.
# `or`: a workflow passes an unset repository variable as '' ("✈️ · 🆕 173 new" on GitHub, 29 Sep 2026).
BRAND_NAME = os.getenv('DIGEST_BRAND_NAME') or 'Jobadabra'
LANGUAGE_FLAGS = {'German': '🇩🇪', 'French': '🇫🇷', 'Italian': '🇮🇹', 'Spanish': '🇪🇸', 'Portuguese': '🇵🇹', 'Dutch': '🇳🇱', 'English': '🇬🇧', 'Other': '🌐'}
SENIORITY_LABELS = {'junior': 'Junior', 'mid': 'Mid', 'senior': 'Senior', 'staff_principal': 'Staff/Principal',
                    'lead_manager': 'Lead/Manager'}


def visible_length(html_text):
    """Length Telegram counts against its limit: text without tags, entities decoded."""
    return len(unescape(re.sub(r'<[^>]+>', '', html_text)))


def _work_mode_badge(value):
    for prefix, badge in WORK_MODE_BADGES.items():
        if (value or '').startswith(prefix):
            return badge
    return None


def _placed(job):
    """Claude's answer for the job's location (src/ai/place_triage.py): 'best', 'in', 'out', or None when not placed yet."""
    from .sources import feeds
    return feeds.place_of(job)


def _mentions(pattern, text):
    from .sources import feeds
    return feeds.mentions(pattern, text)


def place_rank(job):
    """Where this job is for you, one answer for every path (digest labels and rank, insights; feeds.place_of underneath): 'best', 'in', or
    None (outside). Claude's answer when it placed the location; else your place words, whole words only (7 Oct 2026: each path had its own
    fallback, and they disagreed)."""
    verdict = _placed(job)
    if verdict is not None:
        return verdict if verdict in ('best', 'in') else None   # 'vague': not said to be in your places until its posting is read
    where = f"{job.get('location') or ''} {job.get('city') or ''}"
    if _mentions(BEST_PLACES, where):
        return 'best'
    return 'in' if bool(job.get('city')) or _mentions(HOME, job.get('location') or '') else None


def in_places(job):
    """True when the job is in one of your places (place_rank)."""
    return place_rank(job) is not None


BEST_PLACES = my_places.words_regex(_SEARCH, ('top_tier',))
PREFERRED_ABROAD = my_places.words_regex(_SEARCH, ('abroad',))
# Whether the person said anywhere they may work without a visa: Profile → Work eligibility (src/work_rights.py, #3850).
HAS_WORK_RIGHTS = any(work_rights.load().values())


def needs_sponsorship(job):
    """True when the job is in one of your places abroad and your citizenship / work rights do not cover it, so you would need a
    visa. Your own places never do. With work rights set, only the place AI's answer can say so; with none set, every place abroad does."""
    from .sources import feeds
    visa = feeds.needs_visa(job)   # Claude's answer from your work rights as you wrote them, when it placed the location
    if visa is not None:
        return visa
    if in_places(job):
        return False
    # Why (#3862, owner 12 Nov 2026, asked via AskUserQuestion: "No AI answer, no flag"): a name match was a guess ("United Kingdom" never
    # matched "London, UK"), so with work rights set and no AI answer the flag waits for the AI (CLAUDE.md: a busy AI leaves the item unknown).
    if HAS_WORK_RIGHTS:
        return False
    where = f"{job.get('location') or ''} {job.get('city') or ''}"
    # No places abroad: none needs a visa (7 Oct 2026: the empty pattern matched every place, and each Geneva job said "visa sponsorship needed").
    return bool(my_places.lists(_SEARCH)['abroad']) and _mentions(PREFERRED_ABROAD, where)


def location_points(job):
    """Your top-tier place (config/search.json) most preferred; country-wide, listed abroad or remote fine."""
    where = f"{job.get('location') or ''} {job.get('city') or ''}"
    remote = ((job.get('ai') or {}).get('work_mode', {}).get('value') == 'remote'
              or (job.get('work_mode') or '').startswith('Remote'))
    rank = place_rank(job)
    if rank == 'best':
        return 5
    if rank == 'in':
        return 4
    if _mentions(PREFERRED_ABROAD, where) or remote:
        return 3
    return 0


def rank_score(job):
    """Higher is better: preferred location first, then role_keywords titles, then remote."""
    score = location_points(job) + (3 if job.get('saved') else 0)
    if RELEVANT.search(job.get('title') or ''):
        score += 2
    if (job.get('work_mode') or '').startswith(('Remote', 'Hybrid')):
        score += 1
    ai = job.get('ai')
    if ai:
        if ai['english_is_enough']['value'] == 'yes':
            score += 1
        if any(l['level'] == 'nice_to_have' and l['language'] in PREFERENCES['disqualifying_languages']
               for l in ai['languages']):
            score -= 1
        if ai['employer_type']['value'] == 'recruiter':
            score -= 1
        if ai['seniority']['value'] == 'junior':
            score -= 3
    return score


def language_blocked(job):
    """True when AI extraction found a required language the profile can't meet."""
    ai = job.get('ai')
    return bool(ai) and any(l['level'] == 'required' and l['language'] in PREFERENCES['disqualifying_languages']
                            for l in ai['languages'])


LEGAL_SUFFIXES = {'sa', 'ag', 'gmbh', 'sarl', 'sàrl', 'inc', 'ltd', 'llc', 'plc', 'bv', 'nv', 'ab', 'oy', 'as', 'spa',
                  'srl', 'sas', 'co', 'corp', 'corporation', 'limited', 'company', 'se', 'kg', 'ug'}


def company_key(name):
    """A company name without case, punctuation or legal form: "AcmeSource SA" -> "acmesource"."""
    words = re.sub(r'[^\w]+', ' ', (name or '').casefold().replace('.', '')).split()
    while len(words) > 1 and words[-1] in LEGAL_SUFFIXES:
        words.pop()
    return ' '.join(words)


def company_excluded(job):
    """True when the job's company is on config/preferences.json's excluded_companies list (the same company
    whatever its legal form: "AcmeSource SA" is "AcmeSource")."""
    company = company_key(job.get('company'))
    return bool(company) and any(company == company_key(name) for name in PREFERENCES.get('excluded_companies', []))


def hard_filtered(job):
    return language_blocked(job) or company_excluded(job)


_CUR = r"(?:CHF|EUR|USD|GBP|SEK|NOK|DKK|PLN|BRL|CAD|AUD|MXN|INR|JPY|R\$|US\$|C\$|A\$|[£$€])"
_NUM = r"\d[\d'’,. ]*\d(?:\s?[kK])?|\d(?:\s?[kK])?"
SALARY_FIGURE = re.compile(rf"(?:{_CUR}\s?)?(?:{_NUM})(?:\s?{_CUR})?(?:\s?(?:-|–|to)\s?(?:{_CUR}\s?)?(?:{_NUM})(?:\s?{_CUR})?)?")


def _salary(text):
    """Just the salary figure or range ('SEK 878,578 - SEK 1,054,294'), or None if there is none.

    Needs a currency or a 'k' so that years, percentages and team sizes don't count."""
    for match in SALARY_FIGURE.finditer(re.sub(r'\s+', ' ', text or '')):
        figure = match.group(0).strip(" ,.;-–")
        if re.search(_CUR, figure) or re.search(r'\d\s?[kK]\b', figure):
            return figure if len(figure) <= 40 else figure[:39] + '…'
    return None


def _badge_facts(ai, job=None):
    """Freeze typed authored signal choices and raw salary/language facts, without retaining the AI/job objects."""
    badges = []
    if ai['english_is_enough']['value'] == 'yes':
        badges.append(('🇬🇧 ', 'job.language.English', ()))
    for lang in ai['languages']:
        if lang['language'] == 'Other':
            if lang['level'] == 'required':
                badges.append(('⚠️ ', 'job.language.otherRequired', ()))
        elif lang['language'] != 'English':
            key = 'job.language.required' if lang['level'] == 'required' else 'job.language.extra'
            badges.append((LANGUAGE_FLAGS[lang['language']] + ' ', key, (('language', lang['language']),)))
    salary = _salary(ai['salary']['text']) if ai['salary']['stated'] else None
    if salary:
        badges.append(('💰 ', '', (('raw', salary),)))
    elif ai['salary']['stated']:
        badges.append(('💰 ', 'job.signal.salary', ()))
    if ai['employer_type']['value'] == 'recruiter':
        badges.append(('👤 ', 'job.signal.recruiter', ()))
    sponsorship = ai.get('visa_sponsorship', {}).get('value')
    if sponsorship == 'offered':
        badges.append(('🛂 ', 'job.signal.sponsorshipOffered', ()))
    elif sponsorship == 'not_offered' or (job and needs_sponsorship(job)):
        badges.append(('🔴 ', 'job.signal.sponsorshipNeeded', ()))
    return tuple(badges)


def _ai_badges(ai, job=None):
    """Preserve the canonical badge contract used by the persona rules and existing digest callers."""
    return digest_render.render_badges(_badge_facts(ai, job), 'en')


def rank_jobs(jobs, rng):
    """Sort by score; shuffle first so equally scored jobs rotate between digests."""
    jobs = list(jobs)
    rng.shuffle(jobs)
    return sorted(jobs, key=rank_score, reverse=True)


LEGAL_SUFFIX = re.compile(r"[\s,]+(AG|SA|S\.A\.|GmbH|Sàrl|S\.à\s?r\.l\.|Ltd\.?|Limited|Inc\.?|LLC|plc|SE|Co\.)$", re.I)
GENDER_TAG = re.compile(r"\s*\((?:[mwfdxa]\s*[/|,]?\s*)+\)|\s*\((?:all genders?|alle|tous genres)\)", re.I)


def short_company(name):
    """'Zürich Versicherungs-Gesellschaft AG / Zurich Insurance Company Ltd' -> 'Zürich Versicherungs-Gesellschaft'."""
    name = re.split(r'\s+/\s+|\s+\|\s+', (name or '').strip())[0]
    while LEGAL_SUFFIX.search(name):
        name = LEGAL_SUFFIX.sub('', name)
    return name or 'Unknown employer'


def short_title(title):
    """Drop gender tags such as (m/f/d), (a), (all genders); keep everything else."""
    return re.sub(r'\s{2,}', ' ', GENDER_TAG.sub('', title or '')).strip(' -–|') or title


MODE_LABELS = {'onsite': '🏢 On-site', 'hybrid': '🏠 Hybrid', 'remote': '🌍 Remote'}


def _job_facts(index, job):
    """Capture immutable existing render facts only; no store, live job dictionary or AI object enters the snapshot."""
    ai, fit = job.get('ai'), job.get('fit')
    seniority = ai['seniority']['value'] if ai and ai['seniority']['value'] in SENIORITY_LABELS else ''
    mode = MODE_LABELS.get(ai['work_mode']['value'] if ai else '') or _work_mode_badge(job.get('work_mode'))
    # Only the formatter's finite authored badge constants are mapped; raw employer wording is never searched or replaced.
    modes = {MODE_LABELS['onsite']: 'onsite', MODE_LABELS['hybrid']: 'hybrid', MODE_LABELS['remote']: 'remote',
             WORK_MODE_BADGES['Hybrid']: 'hybrid', WORK_MODE_BADGES['Remote mentioned']: 'remoteMaybe'}
    badges = _badge_facts(ai, job) if ai else (('🔴 ', 'job.signal.sponsorshipNeeded', ()),) if needs_sponsorship(job) else ()
    return (index, short_title(job['title']), job.get('url') or '', short_company(job['company']), job.get('location') or '',
            seniority, modes.get(mode, ''), bool(job.get('saved')), (fit['score'], (fit.get('reason') or '')[:110]) if fit else (), badges)


def _job_block(index, job):
    """Keep the original canonical English helper used by existing persona and digest-format checks."""
    return digest_render.render_job(_job_facts(index, job), 'en')


SHOWN_TABLE = """
CREATE TABLE IF NOT EXISTS shown (
    job_id INTEGER PRIMARY KEY REFERENCES jobs(id),
    last_shown_at TEXT NOT NULL,
    last_seed INTEGER NOT NULL,
    times INTEGER NOT NULL DEFAULT 1
);
"""
ROTATION_HOURS = 24


def recently_shown(db, seed, now=None):
    """Job ids sent in a digest within ROTATION_HOURS, except by this digest's own seed,
    so its later pages keep the order its first page was built with."""
    db.executescript(SHOWN_TABLE)
    now = now or datetime.now(timezone.utc)
    cutoff = (now - timedelta(hours=ROTATION_HOURS)).isoformat(timespec='seconds')
    return {row['job_id'] for row in db.execute(
        'SELECT job_id FROM shown WHERE last_shown_at >= ? AND last_seed != ?', (cutoff, seed))}


def last_sent(db):
    """When the last digest was sent (None if never): jobs first seen after it are the new ones."""
    db.executescript(SHOWN_TABLE)
    return db.execute('SELECT MAX(last_shown_at) FROM shown').fetchone()[0]


def mark_shown(db, job_ids, seed, now=None):
    db.executescript(SHOWN_TABLE)
    stamp = (now or datetime.now(timezone.utc)).isoformat(timespec='seconds')
    db.executemany("""INSERT INTO shown (job_id, last_shown_at, last_seed) VALUES (?, ?, ?)
        ON CONFLICT(job_id) DO UPDATE SET last_shown_at=excluded.last_shown_at,
        last_seed=excluded.last_seed, times=shown.times + 1""", [(i, stamp, seed) for i in job_ids])
    db.commit()


BEST_MATCH_SCORE = 70   # Older jobs at or above this fit score are grouped as best matches.
UNSCORED_SCORE = 45     # Where unscored jobs sit among scored ones.
ROTATION_PENALTY = 15   # Points a job loses if it was shown in the last ROTATION_HOURS.
ROTATION_JITTER = 8     # Random points added per digest, so near-equal matches take turns.
SAVED_BONUS = 10        # Saved (⭐) jobs rank higher until applied or dismissed.


def eligible_jobs(db, hidden_urls=frozenset()):
    """Open jobs the owner could apply to, with stage 1 facts attached; also returns the
    hard-filtered ones (required disqualifying language, or an excluded company). Applied jobs
    (hidden_urls) are excluded from both."""
    facts = enrich.load(db)
    jobs = [dict(j, ai=facts.get(j['id'])) for j in store.digest_jobs(db, limit=10_000, only_new=False)
            if (j.get('url') or '').strip() not in hidden_urls]
    return [j for j in jobs if not hard_filtered(j)], [j for j in jobs if hard_filtered(j)]


def place_unclear(job):
    """True when no refresh can place or score this job: its location is only a country and its posting has no text to read for the place
    (#323: such a job stayed hidden as "waiting" forever). The Jobs list and the digest show it, unscored, its place unclear (owner, 12 Oct 2026)."""
    from .sources import feeds
    return feeds.place_of(job) == 'vague' and not (job.get('description') or '').strip()


def waiting_for_score(job):
    """A job found but not read and scored yet: the Jobs list counts it as waiting instead of listing it (src/desktop_jobs.py), and so does the
    digest, so both say the same number. One you acted on or added yourself, or whose place can't be told, is listed."""
    return (not job.get('fit') and not place_unclear(job) and (job.get('application_status') or 'unreviewed') == 'unreviewed'
            and (job.get('notes') or '') != 'imported')


def build_digest(db, limit=50, rng=None, hidden_urls=frozenset(), page=1, seed=None, shown_ids=None,
                 saved_urls=frozenset(), hide_unscored=False):
    """Return (messages, new_count, keyboards) for one page of the digest.

    All eligible jobs are ranked once (new first, then "more to explore", shuffled
    within each score using `seed`, so page 2 continues page 1's order). A page
    shows PAGE_SIZE jobs in one message, with '✅ n' buttons and, when more jobs
    remain, a '➕ Next' button that asks for page+1 with the same seed.

    Rotation: among older jobs, those sent in the last ROTATION_HOURS go after the
    ones not seen yet, so consecutive digests don't open with the same ten.
    The ids of the jobs on this page are appended to shown_ids when given.
    """
    seed = seed if seed is not None else random.randrange(1, 10**9)
    rng = rng or random.Random(seed)
    everything, blocked = eligible_jobs(db, hidden_urls)
    fits = score.load(db)
    for job in everything:
        job['fit'] = fits.get(job['id'])
        job['saved'] = (job.get('url') or '').strip() in saved_urls
    # Scored jobs below digest_min_score stay in Notion Job Matches but don't use digest space;
    # saved ones always show, and unscored ones are shown so the digest still works without AI.
    # Why (13 Nov 2026, owner: "Realistic ring, never hidden"): a role of the search on a career change stays, low score and all (score_search.searched).
    low_fit = {j['id'] for j in everything if j['fit'] and j['fit']['score'] < MIN_DIGEST_SCORE and not j['saved'] and not score_search.searched(j['fit'])}
    everything = [j for j in everything if j['id'] not in low_fit]
    if hide_unscored:   # an AI is ready: list what the app's Jobs list lists (16 Oct 2026: "506 new" in Telegram, 487 jobs in the app)
        everything = [j for j in everything if not waiting_for_score(j)]
    # New = added since the last digest was sent (the newest mark in the shown table); with none sent yet, everything is new.
    since = last_sent(db)
    new_ids = {j['id'] for j in everything if since is None or (j.get('first_seen_at') or '') > since}
    recent = recently_shown(db, seed)
    new = rank_jobs([j for j in everything if j['id'] in new_ids], rng)
    new.sort(key=lambda j: -(j['fit'] or {}).get('score', -1))   # stable: unscored keep rule order
    older = rank_jobs([j for j in everything if j['id'] not in new_ids], rng)
    if any(j['fit'] for j in older):
        # Best matches lead every digest, with light rotation: a match shown in the last
        # 24 h loses ROTATION_PENALTY points and every score gets a little random jitter.
        def effective(job):
            base = (job['fit']['score'] if job['fit'] else UNSCORED_SCORE) + (SAVED_BONUS if job.get('saved') else 0)
            return base - (ROTATION_PENALTY if job['id'] in recent else 0) + rng.uniform(0, ROTATION_JITTER)
        older.sort(key=effective, reverse=True)
    else:
        # Stable sort: unseen first, each group keeping its score order.
        older.sort(key=lambda j: j['id'] in recent)
    ranked = [('new', j) for j in new]
    # Each section once: all best matches (in their rotated order), then the rest. Rotation alone could
    # put a 56 between two 80s and repeat the "Best matches" heading.
    is_best = lambda j: (j['fit'] or {}).get('score', 0) >= BEST_MATCH_SCORE
    ranked += [('best', j) for j in older if is_best(j)] + [('older', j) for j in older if not is_best(j)]
    total = len(ranked)   # the real count: `limit` only caps how many the pages reach
    ranked = ranked[:limit]
    first = (page - 1) * PAGE_SIZE
    shown = ranked[first:first + PAGE_SIZE]

    SECTION_LABELS = ('new', 'best', 'older')
    # One heading per group, jobs in the order they are listed: why they are listed first (new, best, more), your places before elsewhere. The ranking mixes the two
    # (a 62 outside your places sits between two 58s inside them), and a heading per change of group printed "In your preferred locations · 3 jobs" three times
    # with the same count (5 Oct 2026). The sort is stable: inside a group the ranking stays.
    shown = sorted(shown, key=lambda entry: (SECTION_LABELS.index(entry[0]), 0 if in_places(entry[1]) else 1))
    group_sizes = {}
    for kind, job in shown:
        key = (kind, in_places(job))
        group_sizes[key] = group_sizes.get(key, 0) + 1
    rows, entries = [], []
    for offset, (kind, job) in enumerate(shown):
        index, place = first + offset + 1, in_places(job)
        rows.append((kind, place, group_sizes[kind, place], _job_facts(index, job)))
        if shown_ids is not None:
            shown_ids.append(job['id'])
        if job.get('url'):
            entries.append((index, notion.job_code(job['url'])))
    remaining = len(ranked) - (first + len(shown))
    snapshot = (page, first, len(new), len(ranked), tuple(rows), tuple(entries), remaining, min(PAGE_SIZE, remaining), seed)
    text, keyboard = digest_render.render_page(snapshot, 'en')
    return [notification_language.projected_text(text, snapshot, digest_render.render_page)], len(new), [keyboard]


def notification_projection(message, keyboard, locale='en'):
    """Explicit end-user view only: known immutable snapshots localize; ordinary canonical strings stay untouched."""
    return notification_language.projection(message, locale=locale) or (message, keyboard)


def format_digest(db, limit=50, rng=None, hidden_urls=frozenset(), page=1, seed=None, saved_urls=frozenset()):
    return '\n\n'.join(build_digest(db, limit, rng, hidden_urls, page, seed, saved_urls=saved_urls)[0])
