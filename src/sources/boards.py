#!/usr/bin/env python3
"""Discover employers from the job boards (TechTree: Europe, any place; jobs.ch and SwissDevJobs: only when the user's places
include Switzerland, they list nothing elsewhere), then follow career links."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
import hashlib
import json
from pathlib import Path
import re
import time
from urllib.parse import urljoin, urlsplit, urlencode
import os
from urllib.request import Request

from ..paths import DATA, REPORTS, keyword_regex, load_search_config
from . import page_bytes, posting_text, read_budget
from .feeds import wanted_title
from ..ai.models import SMALL_MODEL
from ..ai import meanings_pack, page_words, slots
from ..ai.providers.contract import detail, reason
from ..press import budget, resume, stage
_SEARCH = load_search_config()
ROLE = keyword_regex(_SEARCH['board_discovery_keywords'])
CAREER = meanings_pack.matcher('page-words', 'board_careers_link')   # the meanings pack: the old list (seed) + rows the site adds
ATS = {'greenhouse.io':'Greenhouse','lever.co':'Lever','ashbyhq.com':'Ashby','smartrecruiters.com':'SmartRecruiters','myworkdayjobs.com':'Workday','successfactors.com':'SAP SuccessFactors','successfactors.eu':'SAP SuccessFactors','teamtailor.com':'Teamtailor','personio.de':'Personio','personio.com':'Personio','recruitee.com':'Recruitee','apply.workable.com':'Workable','hr4you.com':'HR4YOU'}
# Of the press's 180 s (src/time_budget.py PLANNED, scaled to the run's budget): the job boards' step ends here and the search gets the rest
# (owner's 06:21 press, 26 Oct 2026: this step took 177 s of 269 with no clock; earlier presses 52-56 s). Tests: tests/unit/sources/test_three_minutes.py.
SHARE_S = budget.value('boards.SHARE_S')
CITIES = {'zurich':['zürich','zurich','zuerich'], 'geneva':['genève','geneva','genf'], 'lausanne':['lausanne'], 'basel':['basel','bâle'], 'bern':['bern','berne'], 'zug':['zug'], 'winterthur':['winterthur'], 'lucerne':['luzern','lucerne'], 'st. gallen':['st. gallen','st.gallen'], 'lugano':['lugano']}




def swiss_place_word(config):
    """The place word that makes the places the user searches in (config/search.json locations) Swiss, or None. A place is read as written and as plain
    words: the drafted fragment \\bz[uü]rich\\b is the word Zürich (5 Oct 2026: tested as written it matched nothing, so a Zurich-only search was not seen as Swiss)."""
    from .. import places as places_
    from ..notion.search_settings import terms
    places, cache = config.get('locations') or {}, places_.load()
    for key in ('top_tier', 'country_wide', 'abroad'):
        fragments = places.get(key) or []
        for word in [*fragments, *terms(fragments)]:
            if places_.in_switzerland(word, cache):   # the AI's country for the word first; Switzerland's fixed table before it knows
                return str(word)   # which word made the search Swiss: the job boards line says it
    return None


def swiss_places(config):
    """True when the places the user searches in include Switzerland (swiss_place_word)."""
    return swiss_place_word(config) is not None


def text(s):
    return re.sub(r'\s+', ' ', unescape(posting_text.strip_tags(s))).strip()   # real tags only: "Fluency in <German>" keeps its word (#3182)


def city(location):
    found = [name.title() for name, aliases in CITIES.items() if any(re.search(r'(?<!\w)'+re.escape(a)+r'(?!\w)',location,re.I) for a in aliases)]
    return ', '.join(found) or location or 'Unspecified'


def mode(value):
    if re.search(r'hybrid|hybride', value, re.I): return 'Hybrid (stated)'
    if re.search(r'fully remote|100.?% remote|TELECOMMUTE', value, re.I): return 'Remote (stated)'
    if re.search(r'remote|home.?office|télétravail', value, re.I): return 'Remote mentioned; verify conditions'
    return 'Not stated'


class Page(HTMLParser):
    def __init__(self, source):
        super().__init__(); self.links=[]; self.schemas=[]; self.anchor=None; self.script=None
        self.feed(source)
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if tag=='a' and a.get('href'): self.anchor=[a['href'],'']
        if tag=='script' and a.get('type')=='application/ld+json': self.script=''
    def handle_data(self, data):
        if self.anchor is not None: self.anchor[1]+=data+' '
        if self.script is not None: self.script+=data
    def handle_endtag(self, tag):
        if tag=='a' and self.anchor is not None: self.links.append(self.anchor);self.anchor=None
        if tag=='script' and self.script is not None:
            try: self.schemas.append(json.loads(self.script))
            except ValueError: pass
            self.script=None


def walk(value, kind):
    if isinstance(value,dict):
        if value.get('@type')==kind: yield value
        for v in value.values(): yield from walk(v,kind)
    elif isinstance(value,list):
        for v in value: yield from walk(v,kind)


class Client:
    def __init__(self, refresh=False): self.refresh=refresh
    def get(self,url):
        if urlsplit(url).scheme not in ('https','http'): raise ValueError('Not an HTTP URL')
        directory=DATA/'discovery-cache';directory.mkdir(parents=True,exist_ok=True)
        path=directory/(hashlib.sha256(url.encode()).hexdigest()+'.json')
        if not self.refresh and path.exists() and time.time()-path.stat().st_mtime<21600:
            return json.loads(path.read_text())
        from . import host_pace   # each site at its own learned pace (jobs.ch refused a fast burst, 403, 6 Oct 2026)
        with host_pace.open(Request(url,headers={'User-Agent':'Jobadabra/0.1 (personal job discovery)'}),15) as r:
            data={'url':r.url,'html':page_bytes.reply(r,5_000_000)}
        path.write_text(json.dumps(data));return data


def posting_places(posting):
    """The Swiss places of a JobPosting: each address's town, else its region (canton), as the posting writes them; [] when none is Swiss.
    7 Oct 2026: jobs.ch gave Manor's Geneva jobs only "addressRegion": "Geneve" (no town), and 4 in 10 search results only the country;
    saved as "Switzerland", they were closed as outside a Geneva search."""
    places=posting.get('jobLocation',[]);places=places if isinstance(places,list) else [places]
    swiss=[]
    for place in places:
        address=(place or {}).get('address',{}) if isinstance(place,dict) else {}
        country=address.get('addressCountry','')
        if isinstance(country,dict): country=country.get('name','')
        if str(country).lower() in ('ch','switzerland','schweiz','suisse'):
            swiss.append(str(address.get('addressLocality') or address.get('addressRegion') or 'Switzerland').strip())
    return swiss


def parse_jobs(source, source_url, label, roles=True):
    """The page's JobPostings in Switzerland. roles=False: every title, for the AI title check to judge (jobs.ch, 7 Oct 2026: "4 of 20 listed
    fit your roles" was a word match that dropped 16 titles no AI ever saw)."""
    result=[]
    # A jobs.ch posting whose address names only the country: its town from the page's own data, as the other two jobs.ch readers do
    # (8 Oct 2026: Manor's Morges and Nyon jobs were saved as "Switzerland" here, held back from scoring, yet counted as new).
    from .ats import jobsch_towns, posting_places as jobsch_places
    jobsch='jobs.ch' in source_url
    towns=jobsch_towns(source) if jobsch else {}
    for j in walk(Page(source).schemas,'JobPosting'):
        if roles and not ROLE.search(j.get('title','')): continue
        ident=re.search(r'/detail/([0-9a-f-]{36})',str(j.get('url') or ''))
        # Why (5 Nov 2026, #3242, Gitar): a jobs.ch page is read by the one jobs.ch reader the other two use (an address with no town,
        # no country or none at all keeps the page's town); this file's own copy dropped those shapes.
        swiss=(jobsch_places(j, towns.get(ident.group(1),'') if ident else '') or ['Switzerland']) if jobsch else posting_places(j)
        if not swiss: continue
        expiry=j.get('validThrough')
        if expiry and str(expiry)[:10] < datetime.now(timezone.utc).date().isoformat(): continue
        org=j.get('hiringOrganization',{})
        result.append({'company':org.get('name','Unknown employer'), 'profile':org.get('sameAs',''),
            'website':org.get('url',''), 'title':j['title'],'location':', '.join(swiss),
            'city':city(', '.join(swiss)), 'work_mode':mode(j['title']+' '+str(j.get('jobLocationType',''))),
            'url':urljoin(source_url,j.get('url',source_url)), 'source':label,
            'date_posted':j.get('datePosted',''), 'evidence':'Listed on job board; employer vacancy not independently confirmed'})
    return result


def parse_swissdevjobs(listing, wanted=None):
    """SwissDevJobs' public JSON list (/api/jobsLight), one dict per open job: the same job shape as parse_jobs.
    The list has no description, so one is written from its structured fields (level, technologies, language, visa, salary):
    facts the board states, nothing invented. `wanted(title)` picks the roles to keep (default: the board-discovery keywords; the
    crawl passes the search's own role keywords, so a "backend" job is not read and scored for an SRE search)."""
    wanted=wanted or (lambda title:bool(ROLE.search(title)))
    result=[]
    for j in listing if isinstance(listing,list) else []:
        if not isinstance(j,dict) or j.get('isPaused') or not j.get('jobUrl') or not wanted(j.get('name') or ''): continue
        place=text(j.get('actualCity') or j.get('cityCategory') or '') or 'Switzerland'
        facts=[('Level',j.get('expLevel')),('Type',j.get('jobType')),('Workplace',j.get('workplace')),('Technologies',', '.join(j.get('technologies') or [])),
               ('Working language',j.get('language')),('Visa sponsorship',j.get('hasVisaSponsorship')),('Company type',j.get('companyType')),('Company size',j.get('companySize'))]
        low,high=j.get('annualSalaryFrom'),j.get('annualSalaryTo')
        if low or high: facts.append(('Annual salary (CHF)',f'{low or "?"} to {high or "?"}'))
        description='\n'.join(f'{label}: {value}' for label,value in facts if value)
        website=j.get('companyWebsiteLink') or ''
        result.append({'company':j.get('company') or 'Unknown employer','profile':'','website':f'https://{website}' if website and '//' not in website else website,
            'title':j['name'],'location':f'{place}, Switzerland','city':city(place),'work_mode':mode(f"{j.get('workplace') or ''} {j['name']}"),
            'url':f"https://swissdevjobs.ch/jobs/{j['jobUrl']}",'source':'SwissDevJobs','date_posted':str(j.get('activeFrom') or '')[:10],
            'description':description,'salary':{'currency':'CHF','min':low,'max':high} if low or high else None,
            'evidence':'Listed on SwissDevJobs; employer vacancy not independently confirmed'})
    return result


def parse_tree(source):
    jobs=[]
    for url, block in re.findall(r'<a[^>]+href="(/job/[^"]+)"[^>]*>(.*?)</a>',source,re.S):
        title=re.search(r'<h3[^>]*>(.*?)</h3>',block,re.S)
        company=re.search(r'<p[^>]*>(.*?)</p>',block,re.S)
        loc=re.search(r'<span[^>]+class="[^"]*truncate text-foreground[^"]*"[^>]*>(.*?)</span>',block,re.S)
        if not(title and company and loc):continue
        title,company,loc=map(lambda x:text(x[1]),(title,company,loc))
        if not ROLE.search(title): continue   # TechTree lists Europe, not only Switzerland: any place is kept
        jobs.append({'company':company,'profile':'','website':'','title':title,'location':loc,'city':city(loc),
            'work_mode':mode(loc),'url':urljoin('https://jobs.techtree.dev',url),'source':'TechTree',
            'date_posted':'','evidence':'Listed on TechTree; employer identity may be undisclosed'})
    return jobs


def platform(url):
    host=(urlsplit(url).hostname or '').lower()
    return next((name for domain,name in ATS.items() if host==domain or host.endswith('.'+domain)),'Company website / unknown ATS')


def useful_links(page,base):
    found=[]
    pairs=[(label,urljoin(base,href)) for href,label in Page(page).links]
    pairs=[(label,url) for label,url in pairs if urlsplit(url).scheme in ('http','https') and not any(
        domain in urlsplit(url).netloc for domain in ('linkedin.com','xing.com','slideshare.net','facebook.com','instagram.com','youtube.com'))]
    words=page_words.link_words(((label,url) for label,url in pairs if platform(url)=='Company website / unknown ATS'),floor='board_careers_link')
    for label,url in pairs:
        now=words.get((str(label or ''),str(url or '')))
        if (now and (now.weak or now.strong)) or platform(url)!='Company website / unknown ATS':
            if url not in found:found.append(url)
    return sorted(found, key=lambda u: (bool(urlsplit(u).fragment), len(urlsplit(u).path)))


def enrich(pair,client):
    name,jobs=pair
    c={'company':name,'jobs':jobs,'website':'','size':'Unknown','min_employees':None,'career_pages':[], 'platforms':[], 'notes':[]}
    for job in jobs:
        if job['source'] != 'jobs.ch': continue
        with stage.guard('job boards: jobs.ch detail') as caught:
            detail=client.get(job['url'])
            posting=next(walk(Page(detail['html']).schemas,'JobPosting'),{})
            description=text(posting.get('description',''))
            job['work_mode']=mode(job['title']+' '+str(posting.get('jobLocationType',''))+' '+description)
            job['description']=description[:12000]
        if caught:
            c['notes'].append(f'Job detail unavailable; remote conditions unverified: {caught.reason}')
    with stage.guard('job boards: enrichment') as enriched:
        profile=jobs[0]['profile']
        if profile and urlsplit(profile).hostname=='www.jobs.ch':
            p=client.get(profile)
            org=next((o for o in walk(Page(p['html']).schemas,'Organization') if o.get('url') and o.get('name')==name),{})
            c['website']=org.get('url','')
            n=org.get('numberOfEmployees',{})
            if isinstance(n,dict) and n.get('minValue') is not None:
                c['min_employees']=n['minValue'];c['size']=f"{n['minValue']}–{n.get('maxValue','+')} (board profile)"
        if not c['website']:c['website']=jobs[0].get('website','')
        if not c['website']:
            c['notes'].append('Official website unresolved; no domain guessed');return c
        if any(d in urlsplit(c['website']).netloc for d in ('jobs.ch','linkedin.com','swissdevjobs.ch')):
            c['notes'].append('Only a board profile found');c['website']='';return c
        home=client.get(c['website']); c['website']=home['url']
        candidates=useful_links(home['html'],home['url'])[:3]
        for url in candidates:
            with stage.guard('job boards: career link') as caught:
                p=client.get(url)
                c['career_pages'].append(p['url'])
                for link in [p['url']]+useful_links(p['html'],p['url']):
                    name_ats=platform(link)
                    if name_ats!='Company website / unknown ATS' and {'platform':name_ats,'url':link} not in c['platforms']:
                        c['platforms'].append({'platform':name_ats,'url':link})
            if caught:c['notes'].append(f'Career link unavailable: {url}: {caught.reason}')
        if not candidates:c['notes'].append('No career link found on homepage')
    if enriched:c['notes'].append(f'Enrichment incomplete: {enriched.reason}: {enriched.error}')
    return c


# Each job board, with the kind of role it lists (src/role_kinds.py; 'any' = every trade) and whether it lists Swiss employers only.
BOARDS = {'jobs.ch': {'kind': 'any', 'swiss': True}, 'SwissDevJobs': {'kind': 'software', 'swiss': True}, 'TechTree': {'kind': 'software', 'swiss': False}}


def boards(search):
    """The job boards a search reads, in order: those for its places and its kinds of role (a board of developer jobs is skipped for a
    photographer: 6 Oct 2026). Roles not known yet read every board, as before."""
    from ..role_kinds import of_search
    swiss, wanted = swiss_place_word(search) is not None, of_search(search)
    return [name for name, board in BOARDS.items()
            if (swiss or not board['swiss']) and (board['kind'] == 'any' or wanted is None or board['kind'] in wanted)]


PAGE_SIZE = 20   # jobs.ch shows 20 postings a page: a shorter page is the last one
MAX_TERMS = 8


def jobsch_places(search):
    """Every one of the user's places, as they wrote them (jobs.ch takes "geneva" as well as "Genève"), or [None] (all of Switzerland) when
    they want the whole country or name none. 7 Oct 2026: a list of ten known cities meant Nyon, Morges and Gland were never searched."""
    from ..places import plain_words
    places = (search or {}).get('locations') or {}
    words = plain_words([*places.get('top_tier', []), *places.get('country_wide', [])])
    whole = [w for w in words if re.fullmatch(r'switzerland|schweiz|suisse|svizzera|swiss|ch', w.lower())]
    from .feeds import plain
    found = list({plain(w).lower(): w for w in reversed(words) if w not in whole}.values())[::-1]   # "zurich" and "zürich": one search
    return found + ([None] if whole or not found else [])


QUERIES_MODEL = SMALL_MODEL
QUERIES_SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['queries'], 'properties': {'queries': {
    'type': 'array', 'maxItems': 8, 'items': {'type': 'string', 'description': 'One or two words a job board search box understands'}}}}
QUERIES_SYSTEM = """You turn a job seeker's roles into searches for a job board's keyword box. You get their roles (in any language) and \
their places. Answer up to 8 searches, one or two words each, in the language most job titles in their places use (French in Geneva, \
German in Zurich), that together find the jobs of all their roles: one word per family where it covers it ("vendeur" finds "Vendeur", \
"Vendeuse en boutique"), a separate word where a role's titles use another one ("caissier", "magasinier", "photographe"). No place names."""


def _queries_key(search):
    """(roles, key) of a person's board searches in data/board_queries.json: the role words (at most 40) and the hash of them with the places."""
    from ..notion.search_settings import terms
    roles = terms((search or {}).get('role_keywords'))[:40]
    return roles, hashlib.sha256(json.dumps([sorted(roles), jobsch_places(search)], ensure_ascii=False).encode()).hexdigest()[:12]


def kept_queries(search, key=None):
    """The searches already worked out for this person's roles and places (data/board_queries.json), [] when none: never asks the AI."""
    from ..paths import DATA
    roles, key = _queries_key(search) if key is None else (True, key)
    try:
        return json.loads((DATA / 'board_queries.json').read_text()).get(key) or [] if roles else []
    except (OSError, ValueError):
        return []


def board_queries(search, client=None):
    """Searches for every role the user has (7 Oct 2026: 30 roles, and the board was asked about 5 words), by Claude once per set of roles
    and places, kept in data/board_queries.json; [] without AI. Claude sees the role words and places only."""
    from ..paths import DATA
    roles, key = _queries_key(search)
    if not roles:
        return []
    kept = kept_queries(search, key)
    if kept:
        return kept
    store = DATA / 'board_queries.json'
    with stage.guard('job boards: queries') as caught:
        from ..ai import cost, engine
        if not engine.ready():
            return []
        client = client or engine.client(action='board_queries')
        response = client.messages.create(model=QUERIES_MODEL, max_tokens=1500, system=[{'type': 'text', 'text': QUERIES_SYSTEM}],
                                          messages=[{'role': 'user', 'content': json.dumps({'roles': roles, 'places': [p for p in jobsch_places(search) if p]}, ensure_ascii=False)}],
                                          output_config=engine.structured(QUERIES_SCHEMA, QUERIES_MODEL, 'low'))
        cost.side(QUERIES_MODEL, response.usage)
        queries = [str(q).strip()[:40] for q in json.loads(next(b.text for b in response.content if b.type == 'text')).get('queries') or [] if str(q).strip()][:8]
    if caught:   # the user's own board searches only, this time
        print(f'Job boards: searches from your roles not worked out ({reason(caught.error)}); your own board searches only', flush=True)
        detail('job boards', caught.error)
        return []
    store.parent.mkdir(parents=True, exist_ok=True)
    store.write_text(json.dumps({key: queries}, ensure_ascii=False))
    print(f"Job boards: searches for all your roles worked out with AI: {', '.join(queries)}", flush=True)
    return queries


def jobsch_terms(search, client=None):
    """The user's own board searches, each of their words the board keywords name on its own ("vendeur magasin" -> also "vendeur": a two-word
    phrase finds only postings with both), then the searches worked out for all their roles (board_queries)."""
    out, role = [], keyword_regex((search or {}).get('board_discovery_keywords') or [])
    for phrase in (search or {}).get('jobs_board_search_queries') or []:
        for term in [phrase, *(word for word in str(phrase).split() if len(word) > 3 and role.search(word))]:
            if term.lower() not in (t.lower() for t in out):
                out.append(term)
    for term in board_queries(search, client) if search else []:
        if term.lower() not in (t.lower() for t in out):
            out.append(term)
    return out


MAX_REQUESTS = 24   # jobs.ch pages a refresh asks for (it refused more, 403, on 7 Oct 2026); the next refresh goes on from there


def rotation(pairs, now_key=None):
    """The (search, place) pairs in the order this refresh asks them: from where the last refresh stopped, then round again."""
    from ..paths import DATA
    store = DATA / 'board_rotation.json'
    key = hashlib.sha256(json.dumps(pairs, ensure_ascii=False).encode()).hexdigest()[:12]
    try:
        start = json.loads(store.read_text()).get(key, 0) % max(1, len(pairs))
    except (OSError, ValueError, AttributeError):
        start = 0
    def done(count):
        try:
            store.parent.mkdir(parents=True, exist_ok=True)
            store.write_text(json.dumps({key: (start + count) % max(1, len(pairs))}))
        except OSError:
            pass
    return pairs[start:] + pairs[:start], done


def jobsch_status(listed, fit, fresh):
    """One jobs.ch page in the log: how many fit your role words (and are in Switzerland, not expired) of all listed, and how many of those this run
    had not already seen on an earlier search word ('0 of 20' once read as 'nothing fits' when they were all seen already)."""
    if not listed: return 'No listings on this page'
    seen = f', {fit-fresh} already seen this run' if fit > fresh else ''
    return f'{fit} of {listed} listed fit your roles{seen}'


def _board_label(url):
    """'jobs.ch · vendeur magasin · genève · page 2' for a board search URL; the URL itself when it isn't one."""
    import urllib.parse
    parts = urllib.parse.urlsplit(url)
    query = dict(urllib.parse.parse_qsl(parts.query))
    words = [query.get('term', ''), query.get('location', ''), f"page {query['page']}" if query.get('page', '1') != '1' else '']
    host = (parts.hostname or '').removeprefix('www.')
    return ' · '.join([host] + [w for w in words if w]) if query.get('term') else url

def _jobsch_pages(client,used,pages,sources):
    """jobs.ch's pages for every role x every place this refresh (the rotation goes on from here next time): [(url, listed, found, fresh)]."""
    seen_urls=set();pages_found=[];asked=0
    pairs=[[query,place] for query in (jobsch_terms(_SEARCH) if 'jobs.ch' in used else []) for place in jobsch_places(_SEARCH)]
    ordered,done=rotation(pairs);taken=0
    for query,place in ordered:   # every role x every place, MAX_REQUESTS pages a refresh, the next refresh going on from here
        if asked>=MAX_REQUESTS or read_budget.past_cut():break   # past this step's share of the press: the next refresh goes on from here
        taken+=1
        for page in range(1,pages+1):   # pages is the most read: a short page or one with nothing new ends the search
            if asked>=MAX_REQUESTS or read_budget.past_cut():break
            url='https://www.jobs.ch/en/vacancies/?'+urlencode({'term':query,**({'location':place} if place else {}),'page':page})
            with stage.guard('job boards: jobs.ch page') as caught:
                asked+=1
                result=client.get(url);found=parse_jobs(result['html'],url,'jobs.ch',roles=False)
                listed=sum(1 for _ in walk(Page(result['html']).schemas,'JobPosting'))
                fresh=[job for job in found if job['url'] not in seen_urls];seen_urls.update(job['url'] for job in found)
                pages_found.append((url,listed,found,fresh))
                if listed<PAGE_SIZE or (page>1 and not fresh and listed):break
            if caught:
                sources.append({'source':url,'status':str(caught.error)});break
    done(taken)
    if pairs and taken<len(pairs) and read_budget.past_cut():
        from .. import time_budget
        time_budget.later('job boards',len(pairs)-taken,'searches')
    elif pairs and taken<len(pairs):
        print(f'Job boards: {taken} of {len(pairs)} searches this refresh (your roles x your places); the next refresh goes on from there',flush=True)
    return pages_found


def _fit_jobs(pages_found,jobs,sources):
    """jobs.ch's titles judged (the AI title check), the fitting fresh ones added to jobs and one line per page to sources."""
    # Which titles are your kind of job: the AI title check, as for every source (7 Oct 2026: a word match dropped most titles here)
    from . import feed_places, feeds
    board_jobs=[job for _,_,_,fresh in pages_found for job in fresh]
    with stage.guard('job boards: title check') as caught:feed_places.triage_with_places(board_jobs)
    if caught:
        print(f'Warning: job board titles not checked by AI ({reason(caught.error)}): your role words decide',flush=True)
        detail("job board titles", caught.error)
    for url,listed,found,fresh in pages_found:
        fit=[job for job in found if feeds.wanted_title(job['title'])];fit_fresh=[job for job in fresh if feeds.wanted_title(job['title'])]
        jobs.extend(fit_fresh);sources.append({'source':url,'status':jobsch_status(listed,len(fit),len(fit_fresh))})


def _dev_boards(client,used,jobs,sources):
    """SwissDevJobs and TechTree, when used and before the read's cut: their matching listings added to jobs."""
    for label,url in [('SwissDevJobs','https://swissdevjobs.ch/api/jobsLight'),('TechTree','https://jobs.techtree.dev/')]:
        if label not in used or read_budget.past_cut():continue
        with stage.guard('job boards: dev boards') as caught:
            page=client.get(url)['html']
            found=parse_tree(page) if label=='TechTree' else parse_swissdevjobs(json.loads(page),wanted_title);jobs.extend(found)
            sources.append({'source':label,'status':f'{len(found)} matching listings on fetched page' if found else 'No compatible listings parsed; requires another adapter'})
        if caught:sources.append({'source':label,'status':f'Unavailable: {caught.error}'})

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--pages',type=int,default=1);p.add_argument('--max-companies',type=int,default=30);p.add_argument('--refresh',action='store_true');p.add_argument('--budget',type=int,default=0,help='seconds of the Find jobs press (src/time_budget.py): this step ends at its share of them; 0 = none');args=p.parse_args()
    if not 1<=args.pages<=10 or not 1<=args.max_companies<=200:p.error('pages: 1–10; max-companies: 1–200')
    from ..features import disabled
    if disabled('discover'):
        print('job board discovery is off (JOBADABRA_DISABLE includes discover).');return 0
    if os.getenv('JOBADABRA_FIXTURE_DIR'):   # the end-to-end journey (desktop/e2e): only its fixture feeds, no live crawl
        print('job board discovery is off (fixture feeds only).');return 0
    if args.budget:   # one Find jobs press, one deadline: this step counts from the press and ends at its share; the boards left wait for the next search
        from .. import time_budget
        time_budget.start(args.budget,stage=SHARE_S,name='discover')
    return discover(args.pages,args.max_companies,args.refresh)


def discover(pages,max_companies,refresh=False,beside=False):
    """The step's work on whatever clock this process runs (main's own, or the search's when beside: src/sources/boards_beside.py). beside: the
    search reads the found boards itself (src/sources/boards_ahead.py), so only the fixed boards' employers are discovered here."""
    resume.ran('job boards')   # this process ran the step: its end-of-run count may say 0 (src/press/resume.py)
    client=Client(refresh);jobs=[];sources=[]
    used=boards(_SEARCH)
    if not used and beside:return 0
    if not used:   # nothing fixed for these roles and places: the boards found for them (any country)
        from . import board_yield
        for item in board_yield.step(_SEARCH):print(f"Job board: {item['source']} · {item['status']}")
        return 0
    print('Job boards: '+', '.join(used)+('' if 'TechTree' in used else '; developer boards left out: your roles are outside IT'),flush=True)   # the app's activity list shows these names as they are, so the line says only the boards (the regex that made the search Swiss is no line for a person)
    pages_found=_jobsch_pages(client,used,pages,sources)
    _fit_jobs(pages_found,jobs,sources)
    _dev_boards(client,used,jobs,sources)
    groups={};seen=set()
    for job in jobs:
        if job['url'] in seen:continue
        seen.add(job['url']);groups.setdefault(job['company'],[]).append(job)
    report={'checked_at':datetime.now(timezone.utc).isoformat(timespec='seconds'),'sources':sources,'discovered_companies':len(groups),'companies':[]}
    with ThreadPoolExecutor(max_workers=3) as pool:   # an employer's career links not followed by the cut: the next search finds it on the board again
        for company in pool.map(slots.carry(lambda pair:None if read_budget.past_cut() else enrich(pair,client)),list(groups.items())[:max_companies]):
            if company is None:continue
            report['companies'].append(company);print('Checked:',company['company'],flush=True)
    if (unchecked:=min(len(groups),max_companies)-len(report['companies'])):
        from .. import time_budget
        time_budget.later('job boards',unchecked,'employers')
    report['companies'].sort(key=lambda c:(not bool(c['career_pages']),-(c['min_employees'] or 0),c['company']))
    from . import boards_report
    boards_report.write(report,REPORTS)
    # Readable lines, not a JSON dump: the app shows this output live (owner, 7 Oct 2026: "remove that json, it's not readable").
    for item in sources:
        print(f"Job board: {_board_label(item['source'])} · {item['status']}")
    print(f"From the job boards: {len(groups)} employer(s), {sum(bool(c['career_pages']) for c in report['companies'])} with a careers page")

if __name__=='__main__':main()
