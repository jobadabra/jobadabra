// Context fetcher: how often one PostHog event fired per day (events and distinct people, counts only) through one read-only HogQL query; ref "events event=<name> days=<1-30>".
import {LIMITS, finish, guarded, json, token, unavailable} from '../lib.mjs';

export const name = 'posthog';
const HOGQL = 'select toDate(timestamp) as day, count() as events, count(distinct person_id) as people from events where event = {event} and toDate(timestamp) > today() - {days} group by day order by day';

/** Why (3 Nov 2026, harness map spec): the query endpoint only runs SELECTs; the key is a PostHog personal API key with the single scope "Query: read" (env POSTHOG_READ_KEY). The event name goes in as a bound value, never into the SQL text; only day, count and distinct count are selected, so no property or person ever leaves PostHog. */
export async function fetch(ref, {limits = LIMITS, env = {}, fetchImpl = globalThis.fetch} = {}) {
  return guarded(async () => {
    const m = /^events\s+event=([\w$.:-]{1,64})\s+days=(\d{1,2})$/.exec(String(ref || '').trim());
    const days = Number(m?.[2]), max = limits.windowDays ?? LIMITS.windowDays;
    if (!m || days < 1 || days > max) return unavailable(`a PostHog ref is "events event=<name> days=<1-${max}>"`);
    const base = String(env.POSTHOG_URL || 'https://eu.posthog.com').replace(/\/$/, '');
    if (!/^https:\/\/([a-z0-9-]+\.)*posthog\.com$/.test(base)) return unavailable('POSTHOG_URL must be an https posthog.com host');
    const headers = {authorization: `Bearer ${token(env, 'POSTHOG_READ_KEY')}`};
    // Why (3 Nov 2026): the project id is not kept in this public repo: POSTHOG_PROJECT_ID (a key with only "Query: read" may not list projects), else the one project the key can see; with several, guessing the first could show another project's numbers.
    let project = env.POSTHOG_PROJECT_ID;
    if (!project) {
      const list = (await json(fetchImpl, `${base}/api/projects/`, {method: 'GET', headers}, limits.timeoutMs))?.results;
      if (!Array.isArray(list) || list.length !== 1) return unavailable('the key sees none or several PostHog projects: set POSTHOG_PROJECT_ID');
      project = list[0]?.id;
    }
    if (!/^\d{1,12}$/.test(String(project ?? ''))) return unavailable('no PostHog project visible to the key');
    const data = await json(fetchImpl, `${base}/api/projects/${project}/query/`, {
      method: 'POST', headers: {...headers, 'content-type': 'application/json'},
      body: JSON.stringify({query: {kind: 'HogQLQuery', query: HOGQL, values: {event: m[1], days}}}),
    }, limits.timeoutMs);
    const rows = data?.results;
    if (!Array.isArray(rows)) return unavailable('PostHog answered in an unexpected shape');
    if (!rows.length) return unavailable(`no "${m[1]}" events in ${days} days (wrong event name?)`);
    const lines = [];
    for (const row of rows) {
      const [day, events, people] = Array.isArray(row) ? row : [];
      if (!/^\d{4}-\d\d-\d\d/.test(String(day)) || ![events, people].every(v => Number.isFinite(v) && v >= 0)) return unavailable('PostHog answered in an unexpected shape');
      lines.push(`${String(day).slice(0, 10)} | ${events} | ${people}`);
    }
    return finish(`# PostHog event ${m[1]}, last ${days} days (project time zone, today is partial)`, ['Day | events | distinct people', '--- | --- | ---', ...lines].join('\n'), limits, true);
  });
}
