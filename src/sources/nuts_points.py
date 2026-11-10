"""Where a EURES job's area lies on the map, from Eurostat's own point for it (GISCO NUTS 2021 label points, kept in nuts_points.json as {code: [lat, lon, name]}):
a public fact shipped with the app, so no AI call and no fetch places it. EURES gives each job a NUTS code and names it "<area>, <country>" (src/sources/eures.py _where);
this turns that name back into the area's point, so the run's distance key (time_budget.near_best) knows Rhône from Finistère the moment the jobs are read.
Why (#3670, run 42731674115 p9, Lyon): the areas waited for AI placing calls answered at 81 s and 113 s, the title batches were picked at 66 s and the scores at 92 s,
so the 7 jobs scored were in Isère, Finistère, Seine-Saint-Denis and Seine-et-Marne while 21 waited in Rhône. Ordering only: never a filter.
Rebuild: GISCO .../distribution/v2/nuts/geojson/NUTS_LB_2021_4326.geojson, levels 1-3, LAT/LON rounded to 3 decimals, NAME_LATN.
Tests: tests/unit/press/test_home_region_first.py."""
import json
from pathlib import Path

TABLE = Path(__file__).with_name('nuts_points.json')
_by_name = [None]   # the built table, set once whole: a thread never reads it half-built (code review, sf 1/8)


def _load():
    """{normalized "<area>, <country>": {lat, lon}}, built once; on a name two levels share, the deepest code's point (as _where names the deepest)."""
    if _by_name[0] is None:
        from .. import geo
        table, built = json.loads(TABLE.read_text(encoding='utf-8')), {}
        for code in sorted(table, key=len):
            lat, lon, name = table[code]
            country = code[:2]
            built[geo.norm(f'{name}, {geo.country_name(country) or country}')] = {'lat': lat, 'lon': lon}
        _by_name[0] = built
    return _by_name[0]


def point(location):
    """{lat, lon} of the NUTS area a EURES location names, None for any other location."""
    from .. import geo
    return _load().get(geo.norm(location or ''))
