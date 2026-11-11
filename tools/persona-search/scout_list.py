"""What the Central Scout's shared employer list gave one test person (scout measure, sm, owner 11 Nov 2026: "How much the Central Scout is helping us? Do we measure this ?").
Sets `scout` on the person's result.json, counts only: the list served to the press, the employers of it in the person's places (N), the ones that hire for their kind of role (K),
why N - K were left out (the scout knows their kind and it is not theirs, or it has not counted their kind yet: missing data, not a no), the publish id (`generated`), and the person's
jobs and right jobs whose employer is on the list. It calls the engine's OWN functions (employer_index.relevant, role_kinds.fits) on the list the press cached, so the numbers are the ones
the press logged ("Employers: K of N in your places"), also when K == N, where the log prints nothing.
Privacy (sa, 11 Nov 2026: the list is private learned data, the night's artifacts are downloadable): the employers' names are read in memory to join the person's jobs to the list and never
written; only counts and the publish id leave this file. Safety: it reads the person's own temp folders (both JOBADABRA_DATA_DIR and JOBADABRA_CONFIG_DIR must be set, else it stops), makes no
network or AI call, and a person it cannot read gets no `scout`, never zeros.
A count that is not measured is None, never 0 (`kinds_known` False: the person's kind of role was not decided, so K and the split are None).
  JOBADABRA_DATA_DIR=<data> JOBADABRA_CONFIG_DIR=<config> JOBADABRA_NO_DOTENV=1 python3 tools/persona-search/scout_list.py <result.json> <judged.json>   (the night's persona job, after the judge)"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORDS = ('served', 'served_with_mix', 'in_places', 'for_role', 'kind_not_theirs', 'no_kind_mix', 'kinds_known', 'generated', 'listed_from_list', 'right_from_list', 'employers_right_from_list', 'right_from_role')


def key(feed):
    """A feed's identity in the list: (ats, slug), the engine's own key (employer_index.merge)."""
    return (feed.get('ats', 'greenhouse'), feed.get('slug') or feed.get('board'))


def split(index, in_places, kinds, countries):
    """-> the list's counts for one person. index: the served feeds (employer_index.clean); in_places: the engine's place test (feeds.could_be_in_places); kinds: the person's role kinds
    (role_kinds.of_search) or None when not decided; countries: the person's countries. N, K and the split are the log's own numbers: relevant() with and without the kinds."""
    from src import employer_index, role_kinds
    places = employer_index.relevant(index, in_places)
    out = {'served': len(index), 'served_with_mix': sum(1 for f in index if role_kinds.valid(f.get('kinds')) or role_kinds.valid_counts(f.get('kind_counts'))), 'in_places': len(places), 'for_role': None, 'kind_not_theirs': None, 'no_kind_mix': None, 'kinds_known': kinds is not None}
    if kinds is None:
        return out
    kept = {key(f) for f in employer_index.relevant(index, in_places, kinds, countries=countries)}
    left = [f for f in places if key(f) not in kept]
    mixless = [f for f in left if not role_kinds.valid(role_kinds.located(f, countries))]
    out.update(for_role=len(kept), no_kind_mix=len(mixless), kind_not_theirs=len(left) - len(mixless))
    return out


def join(index, kept_names, judged):
    """-> the person's listed and right jobs whose employer is on the list, from judged.json rows (employers by name, in memory only). 'right' = the blind judge's right role AND right place."""
    from src import store
    names = {store.label(f['company']).casefold() for f in index if f.get('company')}
    mine = [row for row in judged if isinstance(row, dict) and str(row.get('provider') or '').casefold() in names and row.get('kind') == 'employer feed']
    right = [row for row in mine if row.get('role') == 'yes' and row.get('place') == 'yes']
    in_role = [row for row in right if str(row.get('provider') or '').casefold() in kept_names]
    return {'listed_from_list': len(mine), 'right_from_list': len(right), 'employers_right_from_list': len({str(row.get('provider')).casefold() for row in right}), 'right_from_role': len(in_role)}


def measure(judged, env=None, places=None):
    """-> {counts, generated, joined} for the person this process's folders belong to, or None when the press never cached a list. Reads the engine's own cache and decisions only."""
    env = os.environ if env is None else env
    if not (env.get('JOBADABRA_DATA_DIR') and env.get('JOBADABRA_CONFIG_DIR')):
        raise SystemExit('scout_list: JOBADABRA_DATA_DIR and JOBADABRA_CONFIG_DIR must both be set to the persona\'s own folders')
    sys.path.insert(0, str(ROOT))
    from src import employer_index, role_kinds, store
    if places is None:
        from src.sources import feeds   # reads the persona's search.json at import: after the folder check, with the persona's own env
        places = feeds.could_be_in_places
    cached = employer_index._read(employer_index.CACHE)
    if not cached or not cached.get('feeds'):
        return None
    index = cached['feeds']
    me = employer_index.me_now()
    try:
        kinds = role_kinds.of_search(json.loads((Path(env['JOBADABRA_CONFIG_DIR']) / 'search.json').read_text(encoding='utf-8')))
    except Exception:   # noqa: BLE001 (Why: no search or an undecided kind is "not measured" for K and the split, never a guess)
        kinds = None
    out = split(index, places, kinds, me.get('countries'))
    kept_names = set()
    if kinds is not None:
        kept_names = {store.label(f['company']).casefold() for f in employer_index.relevant(index, places, kinds, countries=me.get('countries'))}
    return {**out, 'generated': cached.get('generated'), **join(index, kept_names, judged)}


def annotate(result_path, judged_path, places=None):
    """Set `scout` on a person's result.json; True when set. Report only: any trouble leaves the row as it is and says so, never failing the night."""
    try:
        judged = json.loads(Path(judged_path).read_text(encoding='utf-8'))['rows']
        found = measure(judged, places=places)
        if found is None:
            print('scout: no list cached by this press: nothing claimed', flush=True)
            return False
        row = json.loads(Path(result_path).read_text(encoding='utf-8'))
        row['scout'] = {word: found.get(word) for word in WORDS}
        Path(result_path).write_text(json.dumps(row, ensure_ascii=False), encoding='utf-8')
        return True
    except SystemExit:
        raise
    except Exception as error:   # noqa: BLE001 (Why: report only; one person's odd file never costs the night its compare, floors and send)
        print(f'scout: not counted ({type(error).__name__})', flush=True)
        return False


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    print('scout counted' if annotate(sys.argv[1], sys.argv[2]) else 'scout not counted')
