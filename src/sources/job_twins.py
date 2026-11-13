"""Twin links of one posting on a job list: the job page and an action on it (/jobs/<id>-<slug> and /jobs/<id>/apply) are one job, read once (one_per_posting).
Split out of careers_parse.py (owner rule: files stay under 500 lines; this is new code, so it starts here). Pure: addresses in, addresses out, no network, no AI, no state.
Guarded by tests/unit/sources/test_job_link_twins.py."""
import re
import urllib.parse

POSTING_ID = re.compile(r'(?<![0-9a-z])(\d{5,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-z])', re.I)   # a long number or a UUID standing alone in a path segment or beside a slug


def _posting_key(url):
    """(key, the segments after the id's segment, whether that segment holds a slug beside the id) of a job address, or None when its path carries no id. The key is the host,
    the path before the LAST id-carrying segment and the id in it: a company id earlier in the path never joins two postings."""
    parts = urllib.parse.urlsplit(url)
    segments = [segment for segment in parts.path.split('/') if segment]
    for at in range(len(segments) - 1, -1, -1):
        found = POSTING_ID.search(segments[at])
        if found:
            return (parts.netloc.lower(), tuple(segments[:at]), found.group(1).lower()), tuple(segment.lower() for segment in segments[at + 1:]), len(segments[at]) > len(found.group(1))
    return None


def one_per_posting(urls):
    """The job addresses with an action on a posting left out, in page order.
    Design (13 Nov 2026, sd; the third change to this rule, so the behaviour is written before the code; golden rule "going in circles"): a twin is a link that adds ONLY an
    action to a posting, like /jobs/<id>/apply beside /jobs/<id>-<slug>. It is dropped only when all three facts of the addresses hold; otherwise it is kept (shown twice, never
    lost: a lost job is worse than a shown twin, sa, 13 Nov 2026): (1) a link of the same host, path and id ends at its own <id>-<slug> segment (the posting); (2) the twin is the
    id's ONLY other link, so an employer with /welder and /driver is never collapsed; (3) its trailing segments repeat under at least two ids on the page (an action is on every
    card, a job's own name on one). Known limit, said plainly: an id with exactly ONE named sub-page whose name repeats under two ids looks the same as /apply by shape; whether a
    link is an action is a meaning, so its real owner is the AI's link-kind judgment (parked on the Work board), never a fourth case here.
    Why (13 Nov 2026, sd; bp's proof on an airline board, discovery run 43498167418 of jobadabra-lab): 39 rows of ~20 postings, each read from its job page and again from its apply
    page, so a person saw each job twice and the Scout counted 53 for ~27 postings."""
    keyed = [(url, _posting_key(url)) for url in dict.fromkeys(urls)]
    slugged = {found[0] for _, found in keyed if found and not found[1] and found[2]}
    tails_of, ids_with = {}, {}   # an id -> the trailing segments of its other links; a trailing segment -> the ids that carry it
    for _, found in keyed:
        if found and found[1]:
            tails_of.setdefault(found[0], set()).add(found[1])
            ids_with.setdefault(found[1], set()).add(found[0])
    twin = lambda found: bool(found and found[1] and found[0] in slugged and len(tails_of[found[0]]) == 1 and len(ids_with[found[1]]) >= 2)
    return [url for url, found in keyed if not twin(found)]
